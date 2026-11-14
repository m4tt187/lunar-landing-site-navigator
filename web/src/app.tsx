// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
import { computed, effect, signal } from '@preact/signals';
import { nextEvent } from '@engine/index';
import type { EventKind, Interval, PolarDem, Thresholds } from '@engine/index';
import { SEARCH_LIMIT_DAYS, analyze, instantAt, landingCalendar } from './compute';
import type { Analysis, Instant } from './compute';
import { loadDem, mapUrl } from './data';
import type { AppData, CatalogSite } from './data';
import { compass, deg, fmtLatLon, fmtSpan, fmtUtc, fromInputValue, pct, toInputValue } from './format';
import {
  DAY, DURATIONS, EARTH_RULES, HOUR, MAX_SCENARIOS, SCENARIO_COLORS, SUN_RULES, addScenario, clampTime, cursorH,
  data, durationDays, earthRule, encodeState, loadError, playing, removeScenario, scenarios, selectedId, sunRule,
  updateScenario,
} from './state';
import type { Scenario } from './state';
import { LandingCalendar, SkyView, Timeline } from './views';

const R_M = 1737400;
const LUNAR_MONTH_DAYS = 29.530589;

const dem = signal<PolarDem | null>(null);
const demError = signal<string | null>(null);
const copied = signal(false);

const thresholds = computed<Thresholds>(() => ({ sunMinDiskFraction: sunRule.value, earthMinElevationAboveHorizonDeg: earthRule.value }));

const analyses = computed<(Analysis | null)[]>(() => {
  const app = data.value;
  if (!app) return [];
  return scenarios.value.map((s) => analyze(s, app, dem.value, durationDays.value, thresholds.value));
});

// Fetch the elevation model the first time a custom polar site needs it.
effect(() => {
  const app = data.value;
  if (!app || dem.value || demError.value) return;
  if (scenarios.value.some((s) => s.custom && s.custom.latDeg <= app.terrain.map.minLatDeg))
    loadDem(app.terrain).then((d) => { dem.value = d; }, (e: unknown) => { demError.value = String(e); });
});

// Keep the cursor inside the span and the URL in step with the state.
effect(() => { if (cursorH.value > durationDays.value * 24) cursorH.value = durationDays.value * 24; });
effect(() => { if (data.value && scenarios.value.length) history.replaceState(null, '', `#${encodeState()}`); });

let lastFrame = 0;
function frame(now: number): void {
  if (!playing.value) return;
  const span = durationDays.value * 24;
  const next = cursorH.value + ((now - lastFrame) / 20000) * span;
  lastFrame = now;
  cursorH.value = next >= span ? 0 : next;
  requestAnimationFrame(frame);
}
function togglePlay(): void {
  playing.value = !playing.value;
  if (playing.value) { lastFrame = performance.now(); requestAnimationFrame(frame); }
}

/** Next change of state, read from the computed windows; searched further only past the end of the span. */
const beyond = new WeakMap<Analysis, Map<EventKind, number | null>>();
function nextChange(a: Analysis, windows: Interval[], tMs: number, up: boolean, kind: EventKind): number | null {
  const end = a.series.endMs;
  if (up) {
    const w = windows.find((x) => x.startMs <= tMs && tMs < x.endMs);
    if (w && w.endMs < end) return w.endMs;
  } else {
    const w = windows.find((x) => x.startMs > tMs);
    if (w) return w.startMs;
  }
  let cache = beyond.get(a);
  if (!cache) beyond.set(a, (cache = new Map()));
  if (!cache.has(kind)) cache.set(kind, nextEvent(a.site, a.terrain.profile, a.thresholds, end, kind, SEARCH_LIMIT_DAYS, 3600));
  return cache.get(kind)!;
}

function siteOptions(app: AppData) {
  const groups: [CatalogSite['group'], string][] = [['robotic', 'Robotic landers'], ['feature', 'South-pole features'], ['apollo', 'Apollo']];
  return groups.map(([group, label]) => (
    <optgroup label={label}>
      {app.sites.filter((s) => s.group === group).map((s) => <option value={s.id}>{s.name}</option>)}
    </optgroup>
  ));
}

function project(app: AppData, latDeg: number, lonDeg: number): { x: number; y: number } {
  const r = 2 * R_M * Math.tan(((90 + latDeg) * Math.PI) / 360) / (2 * app.terrain.map.halfWidthM);
  return { x: 0.5 + r * Math.sin((lonDeg * Math.PI) / 180), y: 0.5 - r * Math.cos((lonDeg * Math.PI) / 180) };
}
function unproject(app: AppData, x: number, y: number): { latDeg: number; lonDeg: number } {
  const dx = (x - 0.5) * 2 * app.terrain.map.halfWidthM, dy = (0.5 - y) * 2 * app.terrain.map.halfWidthM;
  return {
    latDeg: -90 + (2 * Math.atan(Math.hypot(dx, dy) / (2 * R_M)) * 180) / Math.PI,
    lonDeg: (Math.atan2(dx, dy) * 180) / Math.PI,
  };
}
const round4 = (v: number): number => Math.round(v * 10000) / 10000;

function setCustom(latDeg: number, lonDeg: number): void {
  if (!(Math.abs(latDeg) <= 90) || !(Math.abs(lonDeg) <= 180)) return;
  updateScenario(selectedId.value, { siteId: null, custom: { name: 'Custom site', latDeg: round4(latDeg), lonDeg: round4(lonDeg) } });
}

function MapPanel({ app }: { app: AppData }) {
  const selected = scenarios.value.find((s) => s.id === selectedId.value);
  const index = scenarios.value.findIndex((s) => s.id === selectedId.value);
  return (
    <section class="panel map-panel">
      <h2>South pole <span class="muted">— south of 80° S, NASA LOLA terrain</span></h2>
      <p class="hint">Click the map to move <b style={{ color: SCENARIO_COLORS[index] }}>scenario {index + 1}</b> there, or pick a marked site.</p>
      <div class="map">
        <img src={mapUrl(app.terrain)} alt="Shaded relief of the lunar south pole rendered from NASA LOLA elevation data" draggable={false} />
        <svg viewBox="0 0 1000 1000" onClick={(event) => {
          const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
          const p = unproject(app, (event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
          if (p.latDeg <= app.terrain.map.minLatDeg) setCustom(p.latDeg, p.lonDeg);
        }}>
          {[-88, -86, -84, -82].map((lat) => (
            <circle cx="500" cy="500" r={project(app, lat, 90).x * 1000 - 500} class="graticule" />
          ))}
          {[-88, -86, -84, -82].map((lat) => <text x="503" y={project(app, lat, 0).y * 1000 - 3} class="map-label faint">{-lat}°S</text>)}
          <text x="500" y="16" class="map-label" text-anchor="middle">0° — towards Earth</text>
          <text x="988" y="504" class="map-label" text-anchor="end">90° E</text>
          <text x="12" y="504" class="map-label">90° W</text>
          <text x="500" y="992" class="map-label" text-anchor="middle">180° — far side</text>
          {app.sites.filter((s) => s.latDeg <= app.terrain.map.minLatDeg).map((s) => {
            const p = project(app, s.latDeg, s.lonDeg);
            return (
              <g class="site-dot" onClick={(event) => { event.stopPropagation(); updateScenario(selectedId.value, { siteId: s.id, custom: null }); }}>
                <title>{`${s.name} — ${fmtLatLon(s.latDeg, s.lonDeg)}`}</title>
                <circle cx={p.x * 1000} cy={p.y * 1000} r="9" fill="transparent" />
                <circle cx={p.x * 1000} cy={p.y * 1000} r={s.group === 'robotic' ? 5 : 3.5} class={s.group} />
                <text x={p.x * 1000 + 8} y={p.y * 1000 + 4} class="map-label">{s.name.replace(' crater (centre)', '')}</text>
              </g>
            );
          })}
          {analyses.value.map((a, i) => {
            if (!a || a.site.latDeg > app.terrain.map.minLatDeg) return null;
            const p = project(app, a.site.latDeg, a.site.lonDeg);
            return (
              <g class="scenario-pin">
                <circle cx={p.x * 1000} cy={p.y * 1000} r="13" fill="none" stroke={SCENARIO_COLORS[i]} stroke-width="4" />
                <text x={p.x * 1000} y={p.y * 1000 - 18} text-anchor="middle" fill={SCENARIO_COLORS[i]} class="pin-label">{i + 1}</text>
              </g>
            );
          })}
        </svg>
      </div>
      {selected ? <CustomCoordinates scenario={selected} /> : null}
    </section>
  );
}

function CustomCoordinates({ scenario }: { scenario: Scenario }) {
  const site = analyses.value.find((a) => a?.scenario.id === scenario.id)?.site;
  return (
    <form class="coords" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget as HTMLFormElement);
      setCustom(Number(form.get('lat')), Number(form.get('lon')));
    }}>
      <label>Latitude (°, north positive)
        <input name="lat" type="number" step="0.0001" min="-90" max="90" required value={site?.latDeg ?? ''} key={`lat${site?.latDeg}`} />
      </label>
      <label>Longitude (°, east positive)
        <input name="lon" type="number" step="0.0001" min="-180" max="180" required value={site?.lonDeg ?? ''} key={`lon${site?.lonDeg}`} />
      </label>
      <button type="submit">Use coordinates</button>
    </form>
  );
}

function Toolbar() {
  const span = durationDays.value * 24;
  const first = scenarios.value[0];
  return (
    <section class="panel toolbar">
      <label>Mission span
        <select value={String(durationDays.value)} onChange={(e) => { durationDays.value = Number((e.currentTarget as HTMLSelectElement).value); }}>
          {DURATIONS.map((d) => <option value={String(d.days)}>{d.label}</option>)}
        </select>
      </label>
      <label>Sun counts as up when
        <select value={String(sunRule.value)} onChange={(e) => { sunRule.value = Number((e.currentTarget as HTMLSelectElement).value); }}>
          {SUN_RULES.map((r) => <option value={String(r.value)}>{r.label}</option>)}
        </select>
      </label>
      <label>Earth counts as in view when
        <select value={String(earthRule.value)} onChange={(e) => { earthRule.value = Number((e.currentTarget as HTMLSelectElement).value); }}>
          {EARTH_RULES.map((r) => <option value={String(r.value)}>{r.label}</option>)}
        </select>
      </label>
      <div class="scrub">
        <button type="button" onClick={togglePlay} aria-pressed={playing.value}>{playing.value ? 'Pause' : 'Play'}</button>
        <label class="grow">Time since landing: <b>{fmtSpan(cursorH.value)}</b>
          <input type="range" min="0" max={span} step={span / 2000} value={cursorH.value}
            onInput={(e) => { cursorH.value = Number((e.currentTarget as HTMLInputElement).value); }} />
        </label>
        {first ? <span class="muted">{fmtUtc(first.startMs + cursorH.value * HOUR)} for scenario 1</span> : null}
      </div>
      <button type="button" onClick={() => {
        void navigator.clipboard?.writeText(location.href).then(() => { copied.value = true; setTimeout(() => { copied.value = false; }, 1500); });
      }}>{copied.value ? 'Link copied' : 'Copy link to this comparison'}</button>
    </section>
  );
}

function explain(a: Analysis): string {
  const s = a.summary;
  const days = (a.series.endMs - a.series.startMs) / DAY;
  const sun = s.sunlitFraction === 0 ? `The Sun never rises above the skyline during these ${Math.round(days)} days`
    : s.sunlitFraction > 0.999 ? `The Sun stays above the skyline for all ${Math.round(days)} days`
    : `The Sun is above the skyline ${pct(s.sunlitFraction)} of the time; the longest night lasts ${fmtSpan(s.longestDarkH)}`;
  const earth = s.earthVisibleFraction === 0 ? 'the Earth never comes into view, so a relay would be needed'
    : s.earthVisibleFraction > 0.999 ? 'the Earth is always in view'
    : `the Earth is in view ${pct(s.earthVisibleFraction)} of the time, with gaps of up to ${fmtSpan(s.longestCommGapH)}`;
  const low = s.maxSunElDeg < 5 ? ` The Sun never climbs higher than ${deg(s.maxSunElDeg)}, so shadows are very long and a small hill can hide it.` : '';
  return `${sun}, and ${earth}.${low}`;
}

function eventLabel(kind: EventKind): string {
  return { sunset: 'Sunset in', sunrise: 'Sunrise in', earthset: 'Earth sets in', earthrise: 'Earth rises in' }[kind];
}

function Card({ scenario, index, app }: { scenario: Scenario; index: number; app: AppData }) {
  const a = analyses.value[index] ?? null;
  const color = SCENARIO_COLORS[index]!;
  const selected = scenario.id === selectedId.value;
  const header = (
    <header onClick={() => { selectedId.value = scenario.id; }}>
      <span class="badge" style={{ background: color }}>{index + 1}</span>
      <div class="grow">
        <h3>{a?.name ?? scenario.custom?.name ?? '…'}</h3>
        {a ? <div class="muted">{fmtLatLon(a.site.latDeg, a.site.lonDeg)}{a.catalog ? ` · ${a.catalog.agency}` : ''}</div> : null}
      </div>
      {scenarios.value.length > 1 ? <button type="button" class="ghost" aria-label="Remove scenario" onClick={(e) => { e.stopPropagation(); removeScenario(scenario.id); }}>×</button> : null}
    </header>
  );
  const controls = (
    <div class="card-controls">
      <label>Site
        <select value={scenario.siteId ?? ''} onChange={(e) => {
          const v = (e.currentTarget as HTMLSelectElement).value;
          if (v) updateScenario(scenario.id, { siteId: v, custom: null });
        }}>
          {scenario.siteId ? null : <option value="">Custom coordinates</option>}
          {siteOptions(app)}
        </select>
      </label>
      <label>Landing (UTC)
        <input type="datetime-local" value={toInputValue(scenario.startMs)} onChange={(e) => {
          const ms = fromInputValue((e.currentTarget as HTMLInputElement).value);
          if (Number.isFinite(ms)) updateScenario(scenario.id, { startMs: clampTime(ms) });
        }} />
      </label>
      <label>Panel / antenna height
        <select value={String(scenario.mastM)} onChange={(e) => updateScenario(scenario.id, { mastM: Number((e.currentTarget as HTMLSelectElement).value) })}>
          {app.mastHeightsM.map((m) => <option value={String(m)}>{m} m above ground</option>)}
        </select>
      </label>
    </div>
  );
  if (!a) {
    return (
      <article class={`card ${selected ? 'selected' : ''}`} style={{ '--accent': color }}>
        {header}{controls}
        <p class="hint">{demError.value ? `Terrain model could not be loaded: ${demError.value}` : 'Loading the terrain model (7 MB) for these coordinates…'}</p>
      </article>
    );
  }
  const instant: Instant = instantAt(a, cursorH.value);
  const tMs = scenario.startMs + cursorH.value * HOUR;
  const sunUp = instant.margins.sunDeg > 0, earthUp = instant.margins.earthDeg > 0;
  const nextSun = nextChange(a, a.summary.sunWindows, tMs, sunUp, sunUp ? 'sunset' : 'sunrise');
  const nextEarth = nextChange(a, a.summary.earthWindows, tMs, earthUp, earthUp ? 'earthset' : 'earthrise');
  const countdown = (at: number | null): string => (at === null ? `more than ${Math.round((a.series.endMs - tMs) / DAY + SEARCH_LIMIT_DAYS)} d` : fmtSpan((at - tMs) / HOUR));
  const s = a.summary;
  const terrainNote = a.terrain.kind === 'lola-120m' ? 'Skyline from NASA LOLA terrain, 120 m grid'
    : a.terrain.kind === 'lola-480m' ? 'Skyline from NASA LOLA terrain, 480 m grid (coarser: nearby boulders and small ridges are not resolved)'
    : 'No terrain model at this latitude: smooth-sphere horizon';
  return (
    <article class={`card ${selected ? 'selected' : ''}`} style={{ '--accent': color }}>
      {header}{controls}
      <div class="verdict">
        <div class="metric sun"><b>{pct(s.sunlitFraction)}</b><span>sunlight</span><small>longest night {fmtSpan(s.longestDarkH)}</small></div>
        <div class="metric earth"><b>{pct(s.earthVisibleFraction)}</b><span>Earth in view</span><small>longest gap {fmtSpan(s.longestCommGapH)}</small></div>
        <div class="metric both"><b>{pct(s.bothFraction)}</b><span>power + link together</span><small>highest Sun {deg(s.maxSunElDeg)}</small></div>
      </div>
      <p class="explain">{explain(a)}</p>
      <SkyView a={a} instant={instant} />
      <div class="now">
        <div><span class="dot sun" /> Sun {sunUp ? 'up' : 'down'} · {deg(instant.sample.sun.elDeg, 2)} elevation, {compass(instant.sample.sun.azDeg)} ({deg(instant.sample.sun.azDeg, 0)}) · {pct(instant.margins.sunDiskFraction)} of disc visible · <b>{eventLabel(sunUp ? 'sunset' : 'sunrise')} {countdown(nextSun)}</b></div>
        <div><span class="dot earth" /> Earth {earthUp ? 'in view' : 'hidden'} · {deg(instant.sample.earth.elDeg, 2)} elevation, {compass(instant.sample.earth.azDeg)} ({deg(instant.sample.earth.azDeg, 0)}) · <b>{eventLabel(earthUp ? 'earthset' : 'earthrise')} {countdown(nextEarth)}</b></div>
        <div class="muted">{fmtUtc(tMs)} · {fmtSpan(cursorH.value)} after landing</div>
      </div>
      <Timeline a={a} cursorH={cursorH.value} onCursor={(h) => { cursorH.value = h; }} />
      <p class="muted small">{terrainNote}{a.terrain.modelEdgeReached ? ' · the terrain model ends before the far horizon in some directions' : ''}{a.terrain.kind !== 'none' ? ` · ground ${a.terrain.groundHeightM} m` : ''}
        {a.catalog ? <> · coordinates: <a href={a.catalog.source.url} target="_blank" rel="noreferrer">{a.catalog.source.title}</a></> : null}</p>
      <div class="card-actions">
        <button type="button" disabled={scenarios.value.length >= MAX_SCENARIOS} onClick={() => addScenario({ ...scenario, startMs: clampTime(scenario.startMs + LUNAR_MONTH_DAYS * DAY) })}>Compare: same site, one lunar month later</button>
        <button type="button" disabled={scenarios.value.length >= MAX_SCENARIOS} onClick={() => addScenario({ ...scenario })}>Compare: copy, then change the site</button>
      </div>
    </article>
  );
}

function CalendarPanel() {
  const a = analyses.value.find((x) => x?.scenario.id === selectedId.value) ?? null;
  const index = scenarios.value.findIndex((s) => s.id === selectedId.value);
  if (!a) return null;
  const start = new Date(a.scenario.startMs);
  const from = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1);
  const calendar = landingCalendar(a, from, 365, durationDays.value);
  return (
    <section class="panel">
      <h2>When to land <span class="muted">— scenario {index + 1}, {a.name}</span></h2>
      <p class="hint">Each day is a possible landing date. Brighter means a larger share of the following {DURATIONS.find((d) => d.days === durationDays.value)?.label} with sunlight, with the Earth in view, or with both. Click a day to move the landing there.</p>
      <LandingCalendar calendar={calendar} currentMs={a.scenario.startMs} onPick={(ms) => updateScenario(a.scenario.id, { startMs: clampTime(ms) })} />
    </section>
  );
}

export function App() {
  const app = data.value;
  if (loadError.value) return <main><p class="error">Could not load the site data: {loadError.value}</p></main>;
  if (!app) return <main><p class="hint">Loading…</p></main>;
  return (
    <main>
      <header class="top">
        <h1>Lunar Landing Site Navigator</h1>
        <p>Compare landing sites and dates on the Moon: where the Sun and the Earth sit against the real skyline, and what that means for solar power and a direct radio link to Earth.</p>
      </header>
      <Toolbar />
      <div class="layout">
        <div class="side">
          <MapPanel app={app} />
        </div>
        <div class="cards" style={{ '--columns': Math.min(2, scenarios.value.length) }}>
          {scenarios.value.map((s, i) => <Card key={s.id} scenario={s} index={i} app={app} />)}
        </div>
      </div>
      <CalendarPanel />
      <footer>
        <p>Sun and Earth positions are computed in your browser and tested against NASA/JPL Horizons (largest difference 0.004° over 9,810 reference samples). Terrain: NASA Lunar Orbiter Laser Altimeter (LOLA). Visibility here is geometric line of sight: it does not model eclipses, the lander's own shadow, dust, or radio link budgets. Not a flight-planning product.</p>
        <p>Built for the 2026 NASA Space Apps Challenge by team Eallweald, Inc. Not affiliated with or endorsed by NASA. <a href="https://github.com/m4tt187/lunar-landing-site-navigator" target="_blank" rel="noreferrer">Source code, methods and references</a>.</p>
      </footer>
    </main>
  );
}
