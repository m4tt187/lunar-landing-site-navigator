// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
import { signal } from '@preact/signals';
import type { EventKind } from '@engine/index';
import { SEARCH_LIMIT_DAYS, bestWindows, fromLanding, instantAt, landingCalendar, nextChange } from './compute';
import type { Analysis } from './compute';
import type { AppData, CatalogSite } from './data';
import { FinderPanel } from './finder';
import { compass, deg, fmtDate, fmtLatLon, fmtSpan, fmtUtc, fromInputValue, pct, toInputValue } from './format';
import { MapPanel } from './map/panel';
import { PRESETS } from './presets';
import type { Preset } from './presets';
import { analyses, demError, selectedAnalysis, selectedIndex } from './session';
import {
  DAY, DURATIONS, EARTH_RULES, HOUR, MAX_LANDING_MS, MAX_SCENARIOS, MIN_LANDING_MS, SCENARIO_COLORS, SUN_RULES,
  addScenario, clampTime, cursorH, data, defaultStart, durationDays, earthRule, loadError, mapLayer, playing,
  removeScenario, scenarios, selectedId, setScenarios, sunRule, updateScenario,
} from './state';
import type { Scenario } from './state';
import { BOTH, CloseUp, EARTH, LandingCalendar, SUN, SkyView, Timeline } from './views';
import type { CalendarRow } from './views';

const LUNAR_MONTH_DAYS = 29.530589;
const copied = signal(false);
const theme = signal<'light' | 'dark'>(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

function setTheme(next: 'light' | 'dark'): void {
  theme.value = next;
  if (next === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('theme', next); } catch { /* the choice is simply not remembered */ }
}

function ThemeSwitch() {
  return (
    <div class="segmented theme" role="group" aria-label="Theme">
      <button type="button" aria-pressed={theme.value === 'light'} onClick={() => setTheme('light')}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3" /></svg>Light
      </button>
      <button type="button" aria-pressed={theme.value === 'dark'} onClick={() => setTheme('dark')}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 9.8A5.8 5.8 0 0 1 6.2 2.5a5.8 5.8 0 1 0 7.3 7.3z" /></svg>Dark
      </button>
    </div>
  );
}
const activePreset = signal<string | null>(null);

let lastFrame = 0;
function frame(now: number): void {
  if (!playing.value) return;
  const span = durationDays.value * 24;
  // The whole mission plays in about 25 seconds.
  const next = cursorH.value + ((now - lastFrame) / 25000) * span;
  lastFrame = now;
  cursorH.value = next >= span ? 0 : next;
  requestAnimationFrame(frame);
}
function togglePlay(): void {
  playing.value = !playing.value;
  if (playing.value) { lastFrame = performance.now(); requestAnimationFrame(frame); }
}

function applyPreset(preset: Preset): void {
  const start = defaultStart();
  durationDays.value = preset.durationDays;
  mapLayer.value = preset.layer;
  setScenarios(preset.scenarios.map((s) => ({
    siteId: s.siteId, custom: null, mastM: s.mastM, startMs: s.start ? fromInputValue(s.start) : start,
  })));
  activePreset.value = preset.id;
}

function Presets() {
  return (
    <label class="inline">Examples
      <select value={activePreset.value ?? ''} onChange={(e) => {
        const preset = PRESETS.find((p) => p.id === (e.currentTarget as HTMLSelectElement).value);
        if (preset) applyPreset(preset);
      }}>
        <option value="">Choose a Ready-Made Comparison…</option>
        {PRESETS.map((p) => <option value={p.id}>{p.label}</option>)}
      </select>
    </label>
  );
}

function Toolbar() {
  const span = durationDays.value * 24;
  const first = scenarios.value[0];
  const active = PRESETS.find((p) => p.id === activePreset.value);
  return (
    <div class="controlbar">
      <div class="controlbar-inner">
        <div class="settings">
          <label>Mission Span
            <select value={String(durationDays.value)} onChange={(e) => { durationDays.value = Number((e.currentTarget as HTMLSelectElement).value); }}>
              {DURATIONS.map((d) => <option value={String(d.days)}>{d.label}</option>)}
            </select>
          </label>
          <label>Sun Counts as Up
            <select value={String(sunRule.value)} onChange={(e) => { sunRule.value = Number((e.currentTarget as HTMLSelectElement).value); }}>
              {SUN_RULES.map((r) => <option value={String(r.value)}>{r.label}</option>)}
            </select>
          </label>
          <label>Earth Counts as in View
            <select value={String(earthRule.value)} onChange={(e) => { earthRule.value = Number((e.currentTarget as HTMLSelectElement).value); }}>
              {EARTH_RULES.map((r) => <option value={String(r.value)}>{r.label}</option>)}
            </select>
          </label>
        </div>
        <div class="scrub">
          <button type="button" class="play" onClick={togglePlay} aria-pressed={playing.value} aria-label={playing.value ? 'Pause' : 'Play'}>
            {playing.value
              ? <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="2.5" width="3" height="11" rx="1" /><rect x="9.5" y="2.5" width="3" height="11" rx="1" /></svg>
              : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.6v10.8a.6.6 0 0 0 .9.5l8.4-5.4a.6.6 0 0 0 0-1L5.4 2.1a.6.6 0 0 0-.9.5z" /></svg>}
            {playing.value ? 'Pause' : 'Play'}
          </button>
          <div class="grow scrub-track">
            <div class="scrub-meta">
              <span>Time since landing <b>{fmtSpan(cursorH.value)}</b></span>
              {first ? <span class="muted">{fmtUtc(first.startMs + cursorH.value * HOUR)} · Scenario 1</span> : null}
            </div>
            <input type="range" min="0" max={span} step={span / 2000} value={cursorH.value} aria-label="Time since landing"
              style={{ '--fill': `${(cursorH.value / span) * 100}%` }}
              onInput={(e) => { cursorH.value = Number((e.currentTarget as HTMLInputElement).value); }} />
          </div>
        </div>
      </div>
      {active ? <p class="preset-hint"><b>{active.label}.</b> {active.hint}</p> : null}
    </div>
  );
}

function ComparisonPanel() {
  const rows = analyses.value.map((a, i) => ({ a, i })).filter((r): r is { a: Analysis; i: number } => r.a !== null);
  if (rows.length < 2) return null;
  const light = (a: Analysis): { hours: number; openEnded: boolean } => fromLanding(a.summary.bothWindows, a);
  const columns: { label: string; value: (a: Analysis) => number; text: (a: Analysis) => string; best: 'max' | 'min' }[] = [
    { label: 'Sunlight', value: (a) => a.summary.sunlitFraction, text: (a) => pct(a.summary.sunlitFraction), best: 'max' },
    { label: 'Longest Night', value: (a) => a.summary.longestDarkH, text: (a) => fmtSpan(a.summary.longestDarkH), best: 'min' },
    { label: 'Earth in View', value: (a) => a.summary.earthVisibleFraction, text: (a) => pct(a.summary.earthVisibleFraction), best: 'max' },
    { label: 'Longest Link Gap', value: (a) => a.summary.longestCommGapH, text: (a) => fmtSpan(a.summary.longestCommGapH), best: 'min' },
    { label: 'Power + Link Together', value: (a) => a.summary.bothFraction, text: (a) => pct(a.summary.bothFraction), best: 'max' },
    { label: 'Power + Link from Touchdown', value: (a) => light(a).hours, text: (a) => (light(a).hours === 0 ? 'None at Landing' : `${light(a).openEnded ? 'Whole Span, ' : ''}${fmtSpan(light(a).hours)}`), best: 'max' },
    { label: 'Highest Sun', value: (a) => a.summary.maxSunElDeg, text: (a) => deg(a.summary.maxSunElDeg), best: 'max' },
  ];
  const winners = columns.map((c) => {
    const values = rows.map((r) => c.value(r.a));
    const target = c.best === 'max' ? Math.max(...values) : Math.min(...values);
    return values.every((v) => v === target) ? null : target;
  });
  return (
    <section class="panel">
      <header class="panel-head">
        <div>
          <h2>Side by Side</h2>
          <p class="sub">Over {DURATIONS.find((d) => d.days === durationDays.value)?.phrase} from each landing. Green marks the better value in each column.</p>
        </div>
      </header>
      <div class="table-wrap">
        <table class="compare">
          <thead><tr><th scope="col">Scenario</th><th scope="col">Landing (UTC)</th>{columns.map((c) => <th scope="col">{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map(({ a, i }) => (
              <tr class={a.scenario.id === selectedId.value ? 'selected' : ''} onClick={() => { selectedId.value = a.scenario.id; }}>
                <th scope="row"><span class="badge small" style={{ background: SCENARIO_COLORS[i] }}>{i + 1}</span> {a.name}{a.scenario.mastM !== 2 ? `, ${a.scenario.mastM} m Mast` : ''}</th>
                <td>{fmtUtc(a.scenario.startMs).replace(' UTC', '')}</td>
                {columns.map((c, k) => <td class={winners[k] !== null && c.value(a) === winners[k] ? 'best' : ''}>{c.text(a)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function siteOptions(app: AppData) {
  const groups: [CatalogSite['group'], string][] = [
    ['sunlit', "Best-Lit Points in NASA's Illumination Map"], ['robotic', 'Robotic Landers'], ['planned', 'Planned Targets'],
    ['feature', 'South-Pole Features'], ['apollo', 'Apollo'],
  ];
  return groups.map(([group, label]) => {
    const sites = app.sites.filter((s) => s.group === group);
    return sites.length ? <optgroup label={label}>{sites.map((s) => <option value={s.id}>{s.name}</option>)}</optgroup> : null;
  });
}

function explain(a: Analysis): string {
  const s = a.summary;
  const days = Math.round((a.series.endMs - a.series.startMs) / DAY);
  const sun = s.sunlitFraction === 0 ? `The Sun never clears the skyline in these ${days} days`
    : s.sunlitFraction > 0.999 ? `The Sun stays above the skyline for all ${days} days`
    : `The Sun is above the skyline ${pct(s.sunlitFraction)} of the time; the longest night lasts ${fmtSpan(s.longestDarkH)}`;
  const earth = s.earthVisibleFraction === 0 ? 'the Earth never comes into view, so a relay satellite would be needed to talk to it'
    : s.earthVisibleFraction > 0.999 ? 'the Earth is always in view'
    : `the Earth is in view ${pct(s.earthVisibleFraction)} of the time, with gaps of up to ${fmtSpan(s.longestCommGapH)}`;
  const low = s.maxSunElDeg < 5 ? ` The Sun never climbs higher than ${deg(s.maxSunElDeg)}: shadows are very long and one hill can hide it.` : '';
  return `${sun}, and ${earth}.${low}`;
}

const EVENT_VERB: Record<EventKind, string> = { sunset: 'set', sunrise: 'rise', earthset: 'set', earthrise: 'rise' };

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
      {scenarios.value.length > 1 ? <button type="button" class="ghost" aria-label={`Remove scenario ${index + 1}`} onClick={(e) => { e.stopPropagation(); removeScenario(scenario.id); }}>×</button> : null}
    </header>
  );
  const controls = (
    <div class="card-controls">
      <label>Site
        <select value={a?.catalog?.id ?? scenario.siteId ?? ''} onChange={(e) => {
          const v = (e.currentTarget as HTMLSelectElement).value;
          if (v) updateScenario(scenario.id, { siteId: v, custom: null });
        }}>
          {a?.catalog || scenario.siteId ? null : <option value="">Custom Coordinates</option>}
          {siteOptions(app)}
        </select>
      </label>
      <label>Landing (UTC)
        <input type="datetime-local" value={toInputValue(scenario.startMs)} min={toInputValue(MIN_LANDING_MS)} max={toInputValue(MAX_LANDING_MS)}
          onChange={(e) => {
            const ms = fromInputValue((e.currentTarget as HTMLInputElement).value);
            if (Number.isFinite(ms)) updateScenario(scenario.id, { startMs: clampTime(ms) });
          }} />
      </label>
      <label>Panels / Antenna Height
        <select value={String(scenario.mastM)} onChange={(e) => updateScenario(scenario.id, { mastM: Number((e.currentTarget as HTMLSelectElement).value) })}>
          {app.mastHeightsM.map((m) => <option value={String(m)}>{m} m Above the Ground</option>)}
        </select>
      </label>
    </div>
  );
  if (!a) {
    return (
      <article class={`card ${selected ? 'selected' : ''}`} style={{ '--accent': color }}>
        {header}{controls}
        <p class="hint">{demError.value ? `The terrain model could not be loaded: ${demError.value}` : 'Loading the terrain model (7 MB) for these coordinates…'}</p>
      </article>
    );
  }
  const instant = instantAt(a, cursorH.value);
  const nextSun = nextChange(a, a.summary.sunWindows, instant.tMs, instant.sunUp, instant.sunUp ? 'sunset' : 'sunrise');
  const nextEarth = nextChange(a, a.summary.earthWindows, instant.tMs, instant.earthUp, instant.earthUp ? 'earthset' : 'earthrise');
  const change = (kind: EventKind, at: number | null) => (at === null
    ? <>does not {EVENT_VERB[kind]} for at least <b>{Math.round((a.series.endMs - instant.tMs) / DAY + SEARCH_LIMIT_DAYS)} days</b></>
    : <>{EVENT_VERB[kind]}s in <b>{fmtSpan((at - instant.tMs) / HOUR)}</b></>);
  const s = a.summary;
  const terrainNote = a.terrain.kind === 'lola-120m' ? 'Skyline from NASA LOLA terrain on a 120 m grid, out to 400 km.'
    : a.terrain.kind === 'lola-120m-near' ? 'Skyline from NASA LOLA terrain: the 120 m grid for at least 30 km around the site, a 480 m grid beyond, out to 400 km.'
    : a.terrain.kind === 'lola-480m' ? 'Skyline from NASA LOLA terrain on a coarser 480 m grid: an estimate. Small ridges close to the site are smoothed out, and sunlight can differ by ten points or more from a 120 m result. The marked sites use the finer model.'
    : 'No terrain model for this latitude yet: the horizon is that of a smooth sphere, so hills and crater walls are not counted.';
  return (
    <article class={`card ${selected ? 'selected' : ''}`} style={{ '--accent': color }}>
      {header}{controls}
      <div class="verdict">
        <div class="metric sun"><span>Sunlight</span><b>{pct(s.sunlitFraction)}</b><small>Longest Night {fmtSpan(s.longestDarkH)}</small></div>
        <div class="metric earth"><span>Earth in View</span><b>{pct(s.earthVisibleFraction)}</b><small>Longest Gap {fmtSpan(s.longestCommGapH)}</small></div>
        <div class="metric both"><span>Power + Link Together</span><b>{pct(s.bothFraction)}</b><small>Highest Sun {deg(s.maxSunElDeg)}</small></div>
      </div>
      <p class="explain">{explain(a)}</p>
      <SkyView a={a} instant={instant} />
      <div class="closeups">
        <CloseUp a={a} instant={instant} body="sun" />
        <CloseUp a={a} instant={instant} body="earth" />
        <div class="now">
          <div><span class="dot sun" /><b>Sun {instant.sunUp ? 'Up' : 'Down'}</b> · {change(instant.sunUp ? 'sunset' : 'sunrise', nextSun)}<br />
            <span class="muted">{deg(instant.sample.sun.elDeg, 2)} elevation, towards {compass(instant.sample.sun.azDeg)} ({deg(instant.sample.sun.azDeg, 0)})</span></div>
          <div><span class="dot earth" /><b>Earth {instant.earthUp ? 'in View' : 'Hidden'}</b> ·{change(instant.earthUp ? 'earthset' : 'earthrise', nextEarth)}<br />
            <span class="muted">{deg(instant.sample.earth.elDeg, 2)} elevation, towards {compass(instant.sample.earth.azDeg)} ({deg(instant.sample.earth.azDeg, 0)})</span></div>
          <div class="muted">{fmtUtc(instant.tMs)} · {fmtSpan(cursorH.value)} after landing</div>
        </div>
      </div>
      <Timeline a={a} cursorH={cursorH.value} onCursor={(h) => { cursorH.value = h; }} />
      <p class="muted small">{terrainNote}{a.terrain.modelEdgeReached ? ' The terrain model ends before the far horizon in some directions.' : ''}{a.terrain.kind !== 'none' ? ` Ground ${a.terrain.groundHeightM} m above the reference sphere.` : ''}
        {a.catalog?.nasaLongTerm ? ` NASA's long-term average for this spot, at ground level: ${pct(a.catalog.nasaLongTerm.sunlight)} sunlight, ${pct(a.catalog.nasaLongTerm.earth)} Earth in view.` : ''}
        {a.catalog ? <> Coordinates: <a href={a.catalog.source.url} target="_blank" rel="noreferrer">{a.catalog.source.title}</a>.</> : null}
        {a.catalog?.note ? ` ${a.catalog.note}.` : ''}</p>
      <div class="card-actions">
        <button type="button" disabled={scenarios.value.length >= MAX_SCENARIOS} onClick={() => addScenario({ ...scenario, startMs: clampTime(scenario.startMs + LUNAR_MONTH_DAYS * DAY) })}>+ Same Site, One Lunar Month Later</button>
        <button type="button" disabled={scenarios.value.length >= MAX_SCENARIOS} onClick={() => addScenario({ ...scenario })}>+ Copy, Then Change Site or Height</button>
      </div>
    </article>
  );
}

function CalendarPanel() {
  const own = selectedAnalysis.value;
  if (!own) return null;
  const index = selectedIndex.value;
  const start = new Date(own.scenario.startMs);
  const from = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1);
  const calendar = landingCalendar(own, from, 365);
  const rows: CalendarRow[] = [
    { label: `${index + 1} · Sun`, color: SUN, values: calendar.sunRunH, title: `${own.name}: sunlight` },
    { label: `${index + 1} · Earth`, color: EARTH, values: calendar.earthRunH, title: `${own.name}: Earth in view` },
    { label: `${index + 1} · Power + Link`, color: BOTH, values: calendar.bothRunH, title: `${own.name}: power + link` },
  ];
  analyses.value.forEach((other, i) => {
    if (!other || i === index) return;
    // The same site at another date would repeat the same row.
    if (other.site.latDeg === own.site.latDeg && other.site.lonDeg === own.site.lonDeg && other.scenario.mastM === own.scenario.mastM) return;
    rows.push({ label: `${i + 1} · Power + Link`, color: BOTH, values: landingCalendar(other, from, 365).bothRunH, title: `${other.name}: power + link` });
  });
  const best = bestWindows(calendar, 3);
  return (
    <section class="panel">
      <header class="panel-head">
        <div>
          <h2>When to Land</h2>
          <p class="sub">One year of possible landing days</p>
        </div>
      </header>
      <p class="hint">Each column is a landing day. Brighter means a longer unbroken stretch after touchdown; dark means landing into night, or with no link. Rows show scenario {index + 1} ({own.name}){rows.length > 3 ? ' and the power + link row of the other sites' : ''}. Hover for the numbers, click a day to move the landing of scenario {index + 1} there.</p>
      <LandingCalendar calendar={calendar} rows={rows} currentMs={own.scenario.startMs} best={best} onPick={(ms) => updateScenario(own.scenario.id, { startMs: clampTime(ms) })} />
      {best.length ? (
        <p class="advice">▼ Longest unbroken power + link at {own.name}:{' '}
          {best.map((w) => (
            <button type="button" onClick={() => updateScenario(own.scenario.id, { startMs: clampTime(w.startMs) })}>
              Land {fmtDate(w.startMs)} → {w.capped ? 'More than ' : ''}{fmtSpan(w.hours)}
            </button>
          ))}
        </p>
      ) : <p class="advice">At {own.name} power and link never coincide in this year.</p>}
    </section>
  );
}

export function App() {
  const app = data.value;
  if (loadError.value) return <main><p class="error">The site data could not be loaded: {loadError.value}</p></main>;
  if (!app) return <main><p class="hint">Loading…</p></main>;
  return (
    <>
      <header class="appbar">
        <div class="appbar-inner">
          <div class="brand">
            <svg class="mark" viewBox="0 0 32 32" aria-hidden="true">
              <rect x="1" y="1" width="30" height="30" rx="8" class="mark-bg" />
              <path d="M10 21.5a6 6 0 0 1 12 0z" class="mark-sun" />
              <path d="M5.5 21.5h21" class="mark-ridge" />
              <circle cx="23" cy="9.5" r="2.4" class="mark-earth" />
            </svg>
            <div>
              <h1>Lunar Landing Site Navigator</h1>
              <p class="lead">If we land here, on this day, will we have power, and can we talk to Earth?</p>
            </div>
          </div>
          <div class="appbar-actions">
            <Presets />
            <button type="button" onClick={() => {
              void navigator.clipboard?.writeText(location.href).then(() => { copied.value = true; setTimeout(() => { copied.value = false; }, 1500); });
            }}>{copied.value ? 'Link Copied' : 'Copy Link to This Comparison'}</button>
            <ThemeSwitch />
          </div>
        </div>
      </header>
      <Toolbar />
      <main>
      <MapPanel app={app} />
      <ComparisonPanel />
      <div class="cards" style={{ '--columns': Math.min(2, scenarios.value.length) }}>
        {scenarios.value.map((s, i) => <Card key={s.id} scenario={s} index={i} app={app} />)}
      </div>
      <CalendarPanel />
      <FinderPanel app={app} />
      <footer>
        <p><b>How far to trust it.</b> Sun and Earth directions are computed in your browser and checked against NASA/JPL Horizons at 9,810 reference moments (nine sites, 2026–2035): the largest difference is 0.004°. Skylines come from NASA's Lunar Orbiter Laser Altimeter (LOLA) terrain; the sunlight and Earth-visibility shares they give were compared with the NASA LOLA-team illumination maps at 400 places (correlation 0.98). What is shown is geometric line of sight, with eclipses of the Sun by the Earth included: the lander's own shadow, dust, slopes and radio link budgets are not modelled. A planning aid, not a flight product.</p>
        <p>Built for the 2026 NASA Space Apps Challenge by team Eallweald, Inc. Not affiliated with or endorsed by NASA. <a href="https://github.com/m4tt187/lunar-landing-site-navigator" target="_blank" rel="noreferrer">Source code, methods, data sources and AI-use statement</a>.</p>
      </footer>
      </main>
    </>
  );
}
