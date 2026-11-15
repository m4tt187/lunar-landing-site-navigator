// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
import { effect, signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { dataUrl } from '../data';
import type { AppData, TerrainMeta } from '../data';
import { fmtLatLon, pct } from '../format';
import { analyses, moveSelectedTo, selectedAnalysis, selectedIndex, thresholds } from '../session';
import {
  DURATIONS, HOUR, MAP_LAYERS, SCENARIO_COLORS, cursorH, data, durationDays, mapLayer, playing, selectedId, updateScenario,
} from '../state';
import type { MapLayer } from '../state';
import { mapError, mapGrid, missionResult, nowResult, requestMission, requestNow, startMapEngine } from './engine';
import type { LayerResult, MapGrid } from './engine';

const R_M = 1737400;
const NEARBY_KM = 5;

const isComputed = (layer: MapLayer): boolean => layer === 'now' || layer === 'sun' || layer === 'earth' || layer === 'both';

// Ask the background workers for the layer on display whenever its inputs change.
effect(() => {
  const app = data.value, layer = mapLayer.value;
  if (!app || !isComputed(layer)) return;
  startMapEngine(app.terrain);
  if (!mapGrid.value) return;
  const a = selectedAnalysis.value;
  if (!a) return;
  const t = thresholds.value;
  const rule = { mastM: a.scenario.mastM, sunFraction: t.sunMinDiskFraction, earthMarginDeg: t.earthMinElevationAboveHorizonDeg };
  if (layer === 'now') {
    const tMs = a.scenario.startMs + cursorH.value * HOUR;
    requestNow({ ...rule, startMs: tMs, endMs: tMs, coarse: playing.value });
  } else requestMission({ ...rule, startMs: a.series.startMs, endMs: a.series.endMs });
});

/** Map position (0..1 from the left and from the top) of a latitude/longitude. */
export function project(meta: TerrainMeta, latDeg: number, lonDeg: number): { x: number; y: number } {
  const r = (2 * R_M * Math.tan(((90 + latDeg) * Math.PI) / 360)) / (2 * meta.map.halfWidthM);
  return { x: 0.5 + r * Math.sin((lonDeg * Math.PI) / 180), y: 0.5 - r * Math.cos((lonDeg * Math.PI) / 180) };
}
export function unproject(meta: TerrainMeta, x: number, y: number): { latDeg: number; lonDeg: number } {
  const dx = (x - 0.5) * 2 * meta.map.halfWidthM, dy = (0.5 - y) * 2 * meta.map.halfWidthM;
  return {
    latDeg: -90 + (2 * Math.atan(Math.hypot(dx, dy) / (2 * R_M)) * 180) / Math.PI,
    lonDeg: (Math.atan2(dx, dy) * 180) / Math.PI,
  };
}

/** Index of the grid cell under a latitude/longitude, or -1 outside the computed area. */
function cellAt(grid: MapGrid, latDeg: number, lonDeg: number): number {
  const r = 2 * R_M * Math.tan(((90 + latDeg) * Math.PI) / 360), centre = grid.n / 2 - 0.5;
  const col = Math.round(centre + (r * Math.sin((lonDeg * Math.PI) / 180)) / grid.scaleM) - grid.origin;
  const row = Math.round(centre - (r * Math.cos((lonDeg * Math.PI) / 180)) / grid.scaleM) - grid.origin;
  if (col < 0 || row < 0 || col >= grid.size || row >= grid.size) return -1;
  const k = row * grid.size + col;
  return grid.inside[k] ? k : -1;
}
function cellPosition(grid: MapGrid, k: number): { latDeg: number; lonDeg: number } {
  const centre = grid.n / 2 - 0.5;
  const x = (grid.origin + (k % grid.size) - centre) * grid.scaleM, y = (centre - (grid.origin + Math.floor(k / grid.size))) * grid.scaleM;
  return { latDeg: -90 + (2 * Math.atan(Math.hypot(x, y) / (2 * R_M)) * 180) / Math.PI, lonDeg: (Math.atan2(x, y) * 180) / Math.PI };
}

type Rgb = readonly [number, number, number];
const RAMP: Record<'sun' | 'earth' | 'both', Rgb> = { sun: [255, 191, 71], earth: [88, 166, 255], both: [111, 220, 140] };
const DARK: Rgb = [6, 8, 18];
/** Share-of-mission colours: dark at 0, the layer colour at one half, a pale tint at 1. */
const SHARE: Record<'sun' | 'earth' | 'both', readonly [Rgb, Rgb, Rgb]> = {
  sun: [DARK, [204, 128, 22], [255, 246, 176]],
  earth: [DARK, [38, 108, 214], [206, 236, 255]],
  both: [DARK, [40, 150, 84], [216, 255, 196]],
};
const css = (c: readonly number[]): string => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
const shareGradient = (kind: 'sun' | 'earth' | 'both'): string =>
  `linear-gradient(to right, ${css(SHARE[kind][0])}, ${css(SHARE[kind][1])} 50%, ${css(SHARE[kind][2])})`;
function shareColor(kind: 'sun' | 'earth' | 'both', t: number, out: Uint8Array, at: number): void {
  const [a, b, c] = SHARE[kind];
  const lo = t < 0.5 ? a : b, hi = t < 0.5 ? b : c, f = t < 0.5 ? t * 2 : t * 2 - 1;
  for (let j = 0; j < 3; j++) out[at + j] = Math.round(lo[j]! + (hi[j]! - lo[j]!) * f);
}

function paint(canvas: HTMLCanvasElement, grid: MapGrid, layer: MapLayer, result: LayerResult | null): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const image = context.createImageData(grid.size, grid.size);
  const px = image.data, inside = grid.inside;
  if (result && result.samples > 0) {
    if (layer === 'now') {
      const { sun, earth } = result;
      for (let k = 0; k < inside.length; k++) {
        if (!inside[k]) continue;
        const o = 4 * k, s = sun[k]!, e = earth[k]!;
        const c = s && e ? RAMP.both : s ? RAMP.sun : e ? RAMP.earth : DARK;
        px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = s || e ? 150 : 200;
      }
    } else {
      const kind = layer === 'sun' ? 'sun' : layer === 'earth' ? 'earth' : 'both';
      const values = result[kind], n = result.samples;
      // One colour per possible count.
      const lut = new Uint8Array((n + 1) * 3);
      for (let i = 0; i <= n; i++) shareColor(kind, i / n, lut, 3 * i);
      for (let k = 0; k < inside.length; k++) {
        if (!inside[k]) continue;
        const o = 4 * k, i = 3 * Math.min(n, values[k]!);
        px[o] = lut[i]!; px[o + 1] = lut[i + 1]!; px[o + 2] = lut[i + 2]!; px[o + 3] = 215;
      }
    }
  }
  context.putImageData(image, 0, 0);
}

/** Width of the map over its height: the square south of 80° S sits in the middle. */
const aspectOf = (meta: TerrainMeta): number => meta.map.aspect ?? 1;

/** Position of a centred square overlay whose half-width is `halfWidthM`, as percentages of the map. */
function overlayBox(meta: TerrainMeta, halfWidthM: number): Record<string, string> {
  const f = halfWidthM / meta.map.halfWidthM, w = (f * 100) / aspectOf(meta);
  return { left: `${50 - w / 2}%`, top: `${(1 - f) * 50}%`, width: `${w}%`, height: `${f * 100}%` };
}

function LayerCanvas({ grid, layer, result, meta }: { grid: MapGrid; layer: MapLayer; result: LayerResult | null; meta: TerrainMeta }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) paint(ref.current, grid, layer, result); }, [grid, layer, result]);
  return <canvas ref={ref} width={grid.size} height={grid.size} class="layer" style={overlayBox(meta, (grid.size * grid.scaleM) / 2)} />;
}

const hover = signal<{ x: number; y: number } | null>(null);

function readout(app: AppData, layer: MapLayer, x: number, y: number): string {
  const p = unproject(app.terrain, x, y);
  if (p.latDeg > app.terrain.map.minLatDeg) return `${fmtLatLon(p.latDeg, p.lonDeg)} · Outside the Computed Area`;
  let text = fmtLatLon(p.latDeg, p.lonDeg);
  const grid = mapGrid.value;
  if (!grid || !isComputed(layer)) return text;
  const k = cellAt(grid, p.latDeg, p.lonDeg);
  if (k < 0) return text;
  if (layer === 'now') {
    const now = nowResult.value;
    if (now && now.samples) text += ` · Sun ${now.sun[k] ? 'in View' : 'Hidden'} · Earth ${now.earth[k] ? 'in View' : 'Hidden'}`;
  } else {
    const m = missionResult.value;
    if (m && m.samples) text += ` · Sunlight ${pct(m.sun[k]! / m.samples)} · Earth ${pct(m.earth[k]! / m.samples)} · Both ${pct(m.both[k]! / m.samples)}`;
  }
  return text;
}

interface Nearby { latDeg: number; lonDeg: number; both: number; hereBoth: number; same: boolean }

/** The cell with the largest "power + link" share within a few kilometres of a site. */
function bestNearby(grid: MapGrid, result: LayerResult, latDeg: number, lonDeg: number): Nearby | null {
  const k0 = cellAt(grid, latDeg, lonDeg);
  if (k0 < 0 || result.samples === 0) return null;
  const r0 = Math.floor(k0 / grid.size), c0 = k0 % grid.size, reach = Math.floor((NEARBY_KM * 1000) / grid.scaleM);
  let best = k0, bestScore = -1;
  for (let dr = -reach; dr <= reach; dr++)
    for (let dc = -reach; dc <= reach; dc++) {
      const distance = Math.hypot(dr, dc);
      if (distance > reach) continue;
      const r = r0 + dr, c = c0 + dc;
      if (r < 0 || c < 0 || r >= grid.size || c >= grid.size) continue;
      const k = r * grid.size + c;
      if (!grid.inside[k]) continue;
      // Power + link first, then sunlight, then the shorter move.
      const score = result.both[k]! * 1e6 + result.sun[k]! * 1e3 - distance;
      if (score > bestScore) { bestScore = score; best = k; }
    }
  const p = cellPosition(grid, best);
  return { ...p, both: result.both[best]! / result.samples, hereBoth: result.both[k0]! / result.samples, same: best === k0 };
}

function Legend({ layer }: { layer: MapLayer }) {
  const span = DURATIONS.find((d) => d.days === durationDays.value)?.phrase ?? '';
  const index = selectedIndex.value + 1;
  if (layer === 'terrain') return <p class="legend muted">Shaded relief computed from NASA LOLA elevation data. Lighter tones are higher ground.</p>;
  if (layer === 'nasa-sun' || layer === 'nasa-earth') {
    return (
      <div class="legend">
        <div class="ramp" style={{ background: `linear-gradient(to right, rgb(10, 12, 22), ${css(RAMP[layer === 'nasa-sun' ? 'sun' : 'earth'])})` }} />
        <div class="ramp-labels"><span>Never</span><span style={{ left: '50%' }}>25%</span><span style={{ left: '70.7%' }}>50%</span><span class="end">Always</span></div>
        <p class="muted">NASA LOLA team (Mazarico et al. 2011 method): share of time, averaged over many years, in which any part of the {layer === 'nasa-sun' ? "Sun's" : "Earth's"} disc is above the terrain, at ground level. Covers the area south of about 85° S.</p>
      </div>
    );
  }
  const error = mapError.value;
  if (error) return <p class="legend error">The map layer could not be computed: {error}</p>;
  if (!mapGrid.value) return <p class="legend muted">Loading the elevation model (7 MB) to compute this layer in your browser…</p>;
  if (layer === 'now') {
    return (
      <div class="legend">
        <div class="swatches">
          <span><i style={{ background: css(RAMP.both) }} />Sun and Earth in View</span>
          <span><i style={{ background: css(RAMP.sun) }} />Sun Only</span>
          <span><i style={{ background: css(RAMP.earth) }} />Earth Only</span>
          <span><i style={{ background: css(DARK) }} />Neither</span>
        </div>
        <p class="muted">Computed in your browser for the moment shown by the time slider (scenario {index}): every place south of 80° S, {selectedAnalysis.value?.scenario.mastM ?? 2} m above the ground. Press Play to watch the shadows move.</p>
      </div>
    );
  }
  const m = missionResult.value;
  const what = layer === 'sun' ? 'with sunlight' : layer === 'earth' ? 'with the Earth in view' : 'with sunlight and the Earth in view at the same time';
  return (
    <div class="legend">
      <div class="ramp" style={{ background: shareGradient(layer as 'sun' | 'earth' | 'both') }} />
      <div class="ramp-labels"><span>0%</span><span style={{ left: '50%' }}>50%</span><span class="end">100%</span></div>
      <p class="muted">Share of the {span} after the landing of scenario {index} {what}, for every place south of 80° S. Computed in your browser from NASA LOLA terrain (480 m grid)
        {m && m.samples < m.total ? ` — ${Math.round((100 * m.samples) / m.total)}% done` : m ? `, ${m.total} moments sampled` : ''}.</p>
    </div>
  );
}

function NearbyAdvice({ app }: { app: AppData }) {
  const layer = mapLayer.value, grid = mapGrid.value, result = missionResult.value, a = selectedAnalysis.value;
  if (!grid || !result || !a || !(layer === 'sun' || layer === 'earth' || layer === 'both')) return null;
  if (result.samples < result.total || a.site.latDeg > app.terrain.map.minLatDeg) return null;
  const best = bestNearby(grid, result, a.site.latDeg, a.site.lonDeg);
  if (!best) return null;
  const index = selectedIndex.value + 1;
  if (best.same || best.both - best.hereBoth < 0.01)
    return <p class="advice">Within {NEARBY_KM} km of scenario {index} no place does better for power + link on this mission.</p>;
  return (
    <p class="advice">
      Within {NEARBY_KM} km of scenario {index}, the best place for power + link is {fmtLatLon(best.latDeg, best.lonDeg)}: <b>{pct(best.both)}</b> of the mission instead of {pct(best.hereBoth)} on this map.{' '}
      <button type="button" onClick={() => moveSelectedTo(best.latDeg, best.lonDeg)}>Move Scenario {index} There</button>
    </p>
  );
}

function CustomCoordinates() {
  const site = selectedAnalysis.value?.site;
  return (
    <form class="coords" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget as HTMLFormElement);
      moveSelectedTo(Number(form.get('lat')), Number(form.get('lon')));
    }}>
      <label>Latitude (°, North +)
        <input name="lat" type="number" step="0.0001" min="-90" max="90" required value={site?.latDeg ?? ''} key={`lat${site?.latDeg}`} />
      </label>
      <label>Longitude (°, East +)
        <input name="lon" type="number" step="0.0001" min="-180" max="180" required value={site?.lonDeg ?? ''} key={`lon${site?.lonDeg}`} />
      </label>
      <button type="submit">Use Coordinates</button>
    </form>
  );
}

export function MapPanel({ app }: { app: AppData }) {
  const meta = app.terrain, layer = mapLayer.value, grid = mapGrid.value;
  const index = selectedIndex.value;
  const nasa = layer === 'nasa-sun' || layer === 'nasa-earth'
    ? meta.layers?.items.find((item) => item.id === (layer === 'nasa-sun' ? 'sun' : 'earth')) : undefined;
  const result = layer === 'now' ? nowResult.value : missionResult.value;
  const at = hover.value;
  const aspect = aspectOf(meta), left = -500 * (aspect - 1), right = 1000 - left;
  // Pointer position as a fraction of the central square (0..1 from its left and top edges).
  const fraction = (event: MouseEvent): { x: number; y: number } => {
    const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
    return { x: ((event.clientX - box.left) / box.width - 0.5) * aspect + 0.5, y: (event.clientY - box.top) / box.height };
  };
  const ring = (lat: number): number => project(meta, lat, 90).x * 1000 - 500;
  return (
    <section class="panel map-panel">
      <header class="panel-head">
        <div>
          <h2>South Pole Map</h2>
          <p class="sub">Everything south of 80° S, computed live in your browser from NASA LOLA terrain</p>
        </div>
        <div class="segmented layers" role="group" aria-label="Map layer">
          {MAP_LAYERS.filter((l) => !l.id.startsWith('nasa') || meta.layers).map((l) => (
            <button type="button" aria-pressed={layer === l.id} title={l.title} onClick={() => { mapLayer.value = l.id; }}>{l.label}</button>
          ))}
        </div>
      </header>
      <div class="map-body">
      <div class="map" style={{ aspectRatio: String(aspect) }}>
        <img src={dataUrl(meta.map.file)} alt="Shaded relief of the lunar south pole computed from NASA LOLA elevation data" draggable={false} />
        {nasa ? <img class="layer" src={dataUrl(nasa.file)} alt="" draggable={false} style={overlayBox(meta, nasa.halfWidthM)} /> : null}
        {grid && isComputed(layer) ? <LayerCanvas grid={grid} layer={layer} result={result} meta={meta} /> : null}
        <svg viewBox={`${left} 0 ${right - left} 1000`}
          onClick={(event) => {
            const f = fraction(event), p = unproject(meta, f.x, f.y);
            if (p.latDeg <= meta.map.minLatDeg) moveSelectedTo(p.latDeg, p.lonDeg);
          }}
          onMouseMove={(event) => { hover.value = fraction(event); }}
          onMouseLeave={() => { hover.value = null; }}>
          {Array.from({ length: 12 }, (_, i) => i * 30).map((lon) => {
            const a = (lon * Math.PI) / 180, reach = right - 500;
            return <line x1={500 + 30 * Math.sin(a)} y1={500 - 30 * Math.cos(a)} x2={500 + reach * 1.3 * Math.sin(a)} y2={500 - reach * 1.3 * Math.cos(a)} class="graticule spoke" />;
          })}
          {[-88, -86, -84, -82, -78, -76].map((lat) => <circle cx="500" cy="500" r={ring(lat)} class="graticule" />)}
          <circle cx="500" cy="500" r={ring(meta.map.minLatDeg)} class="graticule edge" />
          {[-88, -86, -84, -82].map((lat) => <text x="503" y={project(meta, lat, 0).y * 1000 - 3} class="map-label faint">{-lat}°S</text>)}
          {[-80, -78, -76].map((lat) => <text x={500 + ring(lat) + 4} y="490" class="map-label faint">{-lat}°S</text>)}
          <text x="500" y="24" class="map-label" text-anchor="middle">0° — Towards Earth</text>
          <text x={right - 12} y="530" class="map-label" text-anchor="end">90° E</text>
          <text x={left + 12} y="530" class="map-label">90° W</text>
          <text x="500" y="986" class="map-label" text-anchor="middle">180° — Far Side</text>
          {app.sites.filter((s) => s.latDeg <= meta.map.minLatDeg).map((s) => {
            const p = project(meta, s.latDeg, s.lonDeg);
            const label = s.group === 'sunlit' ? s.name.split(' (')[0]!.replace('Sunlit Peak ', '') : s.name.replace(' Crater (Centre)', '');
            return (
              <g class="site-dot" onClick={(event) => { event.stopPropagation(); updateScenario(selectedId.value, { siteId: s.id, custom: null }); }}>
                <title>{`${s.name} — ${fmtLatLon(s.latDeg, s.lonDeg)}${s.note ? ` — ${s.note}` : ''}`}</title>
                <circle cx={p.x * 1000} cy={p.y * 1000} r="11" fill="transparent" />
                {s.group === 'sunlit'
                  ? <path d={`M${p.x * 1000},${p.y * 1000 - 8}l7,8l-7,8l-7,-8z`} class="sunlit" />
                  : <circle cx={p.x * 1000} cy={p.y * 1000} r={s.group === 'feature' ? 3.5 : 5} class={s.group} />}
                <text x={p.x * 1000 + 9} y={p.y * 1000 + 5} class={`map-label ${s.group === 'feature' ? 'faint' : ''}`}>{label}</text>
              </g>
            );
          })}
          {analyses.value.map((a, i) => {
            if (!a || a.site.latDeg > meta.map.minLatDeg) return null;
            const p = project(meta, a.site.latDeg, a.site.lonDeg);
            return (
              <g class="scenario-pin">
                <circle cx={p.x * 1000} cy={p.y * 1000} r="14" fill="none" stroke="#fff" stroke-width="8" stroke-opacity="0.9" />
                <circle cx={p.x * 1000} cy={p.y * 1000} r="14" fill="none" stroke={SCENARIO_COLORS[i]} stroke-width="4" />
                <text x={p.x * 1000} y={p.y * 1000 - 20} text-anchor="middle" fill={SCENARIO_COLORS[i]} class="pin-label">{i + 1}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <aside class="map-side">
        <div class="readout" aria-live="off">
          <span class="field-label">Under the Pointer</span>
          <p>{at ? readout(app, layer, at.x, at.y) : <>Click the map to move <b style={{ color: SCENARIO_COLORS[index] }}>scenario {index + 1}</b> there, or pick a marked site. ◆ marks the best-lit points in NASA's map.</>}</p>
        </div>
        <div>
          <span class="field-label">Legend</span>
          <Legend layer={layer} />
        </div>
        <NearbyAdvice app={app} />
        <div>
          <span class="field-label">Go to Coordinates</span>
          <CustomCoordinates />
        </div>
      </aside>
      </div>
    </section>
  );
}
