// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
import { effect, signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { dataUrl } from '../data';
import type { AppData, TerrainMeta } from '../data';
import { fmtLatLon, pct } from '../format';
import { analyses, moveSelectedTo, selectedAnalysis, selectedIndex, thresholds } from '../session';
import {
  DURATIONS, HOUR, MAP_LAYERS, SCENARIO_COLORS, cursorH, data, durationDays, mapLayer, playing, scenarios, selectedId, updateScenario,
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

/** Zoom and pan of the map: scale `k`, and the offset of the drawing as fractions of the frame. */
const MAX_ZOOM = 6;
const view = signal({ k: 1, x: 0, y: 0 });
/** True while (and just after) the map is dragged, so that the drag is not taken for a click. */
let dragged = false;

function clampView(k: number, x: number, y: number): { k: number; x: number; y: number } {
  const kk = Math.min(MAX_ZOOM, Math.max(1, k));
  return { k: kk, x: Math.min(0, Math.max(1 - kk, x)), y: Math.min(0, Math.max(1 - kk, y)) };
}
/** Zoom by `factor` keeping the point at (fx, fy) of the frame where it is. */
function zoomAt(fx: number, fy: number, factor: number): void {
  const { k, x, y } = view.value;
  const next = Math.min(MAX_ZOOM, Math.max(1, k * factor));
  view.value = clampView(next, fx - ((fx - x) / k) * next, fy - ((fy - y) / k) * next);
}

/** The visible frame of the map: wheel to zoom, drag to move. */
function MapFrame({ aspect, children }: { aspect: number; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const wheel = (event: WheelEvent): void => {
      // The page keeps scrolling over the whole map: the wheel zooms only with Ctrl or ⌘
      // (a trackpad pinch sends Ctrl), or once the map is already zoomed in.
      const k = view.value.k;
      if (!(event.ctrlKey || event.metaKey || k > 1)) return;
      const factor = Math.exp(-event.deltaY * 0.0018);
      const next = Math.min(MAX_ZOOM, Math.max(1, k * factor));
      if (next === k) return;
      event.preventDefault();
      const box = el.getBoundingClientRect();
      zoomAt((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height, factor);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  const down = (event: PointerEvent): void => {
    if (event.button !== 0 || view.value.k === 1) return;
    const el = ref.current!, box = el.getBoundingClientRect(), start = { cx: event.clientX, cy: event.clientY, ...view.value };
    let moved = false;
    const move = (e: PointerEvent): void => {
      const dx = e.clientX - start.cx, dy = e.clientY - start.cy;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true; dragged = true; el.classList.add('dragging');
      view.value = clampView(start.k, start.x + dx / box.width, start.y + dy / box.height);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      el.classList.remove('dragging');
      // The click that ends a drag arrives right after this: let it pass first.
      setTimeout(() => { dragged = false; }, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return <div ref={ref} class={`map ${view.value.k > 1 ? 'zoomed' : ''}`} style={{ aspectRatio: String(aspect) }} onPointerDown={down}>{children}</div>;
}

interface Box { x0: number; y0: number; x1: number; y1: number }
const overlaps = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Places the map's labels at zoom `k` (in drawing units; labels keep their size on screen).
 * Direction labels, scenario pins and site marks come first; then site names by importance,
 * to the right of their mark, else to the left, else not at all; then the latitude rings.
 * Sets `place` on each site and returns the ring labels that fit.
 */
function layoutLabels(
  k: number, left: number, right: number, pins: { x: number; y: number }[],
  sites: { s: { group: string }; p: { x: number; y: number }; label: string; place: { anchor: 'start' | 'end'; dy: number } | null }[],
  order: Record<string, number>, rings: { x: number; y: number; text: string }[],
): { rings: { x: number; y: number; text: string }[] } {
  const taken: Box[] = [];
  const text = (x: number, y: number, chars: number, size: number, anchor: 'start' | 'end'): Box => {
    const w = (chars * size * 0.56) / k, h = size / k;
    const x0 = anchor === 'start' ? x : x - w;
    return { x0, x1: x0 + w, y0: y - h * 0.8, y1: y + h * 0.3 };
  };
  taken.push(text(left + 14, 30, 20, 20, 'start'), text(left + 14, 984, 18, 20, 'start'));
  taken.push(text(right - 12, 530, 5, 20, 'end'), text(left + 12, 530, 5, 20, 'start'));
  for (const p of pins) taken.push({ x0: p.x * 1000 - 14 / k, x1: p.x * 1000 + 14 / k, y0: p.y * 1000 - 36 / k, y1: p.y * 1000 + 2 / k });
  for (const { p } of sites) taken.push({ x0: p.x * 1000 - 8 / k, x1: p.x * 1000 + 8 / k, y0: p.y * 1000 - 8 / k, y1: p.y * 1000 + 8 / k });
  const ranked = [...sites].sort((a, b) => (order[a.s.group] ?? 9) - (order[b.s.group] ?? 9));
  const inside = (b: Box): boolean => b.y0 >= 0 && b.y1 <= 1000 && b.x0 >= left && b.x1 <= right;
  const SPOTS = [{ anchor: 'start', dy: 6 }, { anchor: 'end', dy: 6 }, { anchor: 'start', dy: 26 }, { anchor: 'end', dy: 26 }] as const;
  for (const site of ranked) {
    const size = site.s.group === 'feature' ? 17 : 20, x = site.p.x * 1000;
    site.place = null;
    for (const spot of SPOTS) {
      const box = text(spot.anchor === 'start' ? x + 10 / k : x - 10 / k, site.p.y * 1000 + spot.dy / k, site.label.length, size, spot.anchor);
      if (inside(box) && !taken.some((t) => overlaps(t, box))) { taken.push(box); site.place = { anchor: spot.anchor, dy: spot.dy }; break; }
    }
  }
  const fitting = rings.filter((r) => {
    const box = text(r.x, r.y, r.text.length, 17, 'start');
    if (taken.some((t) => overlaps(t, box))) return false;
    taken.push(box);
    return true;
  });
  return { rings: fitting };
}

/** The scenarios at a glance, next to the map: click one to select it. */
function ScenarioList() {
  const list = analyses.value;
  return (
    <div class="scenario-list">
      <span class="field-label">Scenarios</span>
      <ul>
        {scenariosOf(list).map(({ a, i, id }) => (
          <li class={id === selectedId.value ? 'selected' : ''}>
            <button type="button" onClick={() => { selectedId.value = id; }}>
              <span class="badge small" style={{ background: SCENARIO_COLORS[i] }}>{i + 1}</span>
              <span class="name">{a?.name ?? '…'}</span>
              {a ? (
                <span class="figures">
                  <span class="sun" title="Sunlight">{pct(a.summary.sunlitFraction)}</span>
                  <span class="earth" title="Earth in View">{pct(a.summary.earthVisibleFraction)}</span>
                  <span class="both" title="Power + Link Together">{pct(a.summary.bothFraction)}</span>
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      <div class="figures-key"><span class="sun">Sunlight</span><span class="earth">Earth</span><span class="both">Both</span></div>
    </div>
  );
}
const scenariosOf = (list: typeof analyses.value) =>
  scenarios.value.map((s, i) => ({ a: list[i] ?? null, i, id: s.id }));

export function MapPanel({ app }: { app: AppData }) {
  const meta = app.terrain, layer = mapLayer.value, grid = mapGrid.value;
  const index = selectedIndex.value;
  const nasa = layer === 'nasa-sun' || layer === 'nasa-earth'
    ? meta.layers?.items.find((item) => item.id === (layer === 'nasa-sun' ? 'sun' : 'earth')) : undefined;
  const result = layer === 'now' ? nowResult.value : missionResult.value;
  const at = hover.value;
  const aspect = aspectOf(meta), left = -500 * (aspect - 1), right = 1000 - left;
  const { k, x: tx, y: ty } = view.value;
  // Pointer position as a fraction of the central square (0..1 from its left and top edges).
  // The box is that of the zoomed drawing, so the answer holds at any zoom.
  const fraction = (event: MouseEvent): { x: number; y: number } => {
    const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
    return { x: ((event.clientX - box.left) / box.width - 0.5) * aspect + 0.5, y: (event.clientY - box.top) / box.height };
  };
  const ring = (lat: number): number => project(meta, lat, 90).x * 1000 - 500;
  // Symbols and labels keep their size on screen while the terrain is enlarged.
  const at1 = (px: number, py: number, children: ComponentChildren) =>
    <g transform={`translate(${px} ${py}) scale(${1 / k})`}>{children}</g>;
  // Labels that would overlap at this zoom are moved to the other side of their mark, or left out
  // (the name stays in the mark's tooltip, and appears as soon as zooming in makes room for it).
  const pins = analyses.value.flatMap((a) => (a && a.site.latDeg <= meta.map.minLatDeg ? [project(meta, a.site.latDeg, a.site.lonDeg)] : []));
  const ORDER: Record<string, number> = { robotic: 0, planned: 1, apollo: 2, sunlit: 3, feature: 4 };
  const sites = app.sites.filter((s) => s.latDeg <= meta.map.minLatDeg).map((s) => ({
    s, p: project(meta, s.latDeg, s.lonDeg), place: null as { anchor: 'start' | 'end'; dy: number } | null,
    label: s.group === 'sunlit' ? s.name.split(' (')[0]!.replace('Sunlit Peak ', '') : s.name.replace(' Crater (Centre)', ''),
  }));
  const labels = layoutLabels(k, left, right, pins, sites, ORDER, [-88, -86, -84, -82].map((lat) => ({ x: 503, y: project(meta, lat, 0).y * 1000 - 3, text: `${-lat}°S` }))
    .concat([-80, -78, -76].map((lat) => ({ x: 500 + ring(lat) + 4, y: 490, text: `${-lat}°S` }))));
  return (
    <section class="panel map-panel">
      <header class="panel-head">
        <div>
          <h2>South Pole Map</h2>
          <p class="sub">Everything south of 80° S, computed live in your browser from NASA LOLA terrain</p>
        </div>
        <div class="map-tools">
          <div class="segmented layers" role="group" aria-label="Map layer">
            {MAP_LAYERS.filter((l) => !l.id.startsWith('nasa') || meta.layers).map((l) => (
              <button type="button" aria-pressed={layer === l.id} title={l.title} onClick={() => { mapLayer.value = l.id; }}>{l.label}</button>
            ))}
          </div>
          <div class="segmented zoom" role="group" aria-label="Zoom">
            <button type="button" aria-label="Zoom Out" title="Zoom Out" disabled={k <= 1} onClick={() => zoomAt(0.5, 0.5, 1 / 1.6)}>−</button>
            <span class="zoom-level">{Math.round(k * 100)}%</span>
            <button type="button" aria-label="Zoom In" title="Zoom In" disabled={k >= MAX_ZOOM} onClick={() => zoomAt(0.5, 0.5, 1.6)}>+</button>
            <button type="button" title="Show the Whole Map" disabled={k === 1} onClick={() => { view.value = { k: 1, x: 0, y: 0 }; }}>Fit</button>
          </div>
        </div>
      </header>
      <div class="map-body">
      <MapFrame aspect={aspect}>
        <div class="map-stage" style={{ transform: `translate(${tx * 100}%, ${ty * 100}%) scale(${k})` }}>
        <img src={dataUrl(meta.map.file)} alt="Shaded relief of the lunar south pole computed from NASA LOLA elevation data" draggable={false} />
        {nasa ? <img class="layer" src={dataUrl(nasa.file)} alt="" draggable={false} style={overlayBox(meta, nasa.halfWidthM)} /> : null}
        {grid && isComputed(layer) ? <LayerCanvas grid={grid} layer={layer} result={result} meta={meta} /> : null}
        <svg viewBox={`${left} 0 ${right - left} 1000`}
          onClick={(event) => {
            if (dragged) return;
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
          {at1(left + 14, 30, <text class="map-label">↑ 0°, Towards Earth</text>)}
          {at1(left + 14, 984, <text class="map-label">↓ 180°, Far Side</text>)}
          {at1(right - 12, 530, <text class="map-label" text-anchor="end">90° E</text>)}
          {at1(left + 12, 530, <text class="map-label">90° W</text>)}
          {labels.rings.map((r) => at1(r.x, r.y, <text class="map-label faint">{r.text}</text>))}
          {sites.map(({ s, p, label, place }) => (
            <g class="site-dot" onClick={(event) => { event.stopPropagation(); if (!dragged) updateScenario(selectedId.value, { siteId: s.id, custom: null }); }}>
              <title>{`${s.name} — ${fmtLatLon(s.latDeg, s.lonDeg)}${s.note ? ` — ${s.note}` : ''}`}</title>
              {at1(p.x * 1000, p.y * 1000, <>
                <circle r="11" fill="transparent" />
                {s.group === 'sunlit'
                  ? <path d="M0,-8l7,8l-7,8l-7,-8z" class="sunlit" />
                  : <circle r={s.group === 'feature' ? 3.5 : 5} class={s.group} />}
                {place ? <text x={place.anchor === 'start' ? 10 : -10} y={place.dy} text-anchor={place.anchor} class={`map-label ${s.group === 'feature' ? 'faint' : ''}`}>{label}</text> : null}
              </>)}
            </g>
          ))}
          {analyses.value.map((a, i) => {
            if (!a || a.site.latDeg > meta.map.minLatDeg) return null;
            const p = project(meta, a.site.latDeg, a.site.lonDeg);
            return (
              <g class="scenario-pin">
                {at1(p.x * 1000, p.y * 1000, <>
                  <path d="M0,0c-3-6-13-11-13-21a13,13 0 0 1 26,0c0,10-10,15-13,21z" fill={SCENARIO_COLORS[i]} stroke="#fff" stroke-width="2.5" class="pin-shape" />
                  <text y="-15.5" text-anchor="middle" class="pin-label">{i + 1}</text>
                </>)}
              </g>
            );
          })}
        </svg>
        </div>
      </MapFrame>
      <aside class="map-side">
        <ScenarioList />
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
        <div>
          <span class="field-label">Symbols</span>
          <ul class="symbols">
            <li><svg viewBox="-12 -12 24 24" aria-hidden="true"><path d="M0,-8l7,8l-7,8l-7,-8z" fill="#ffbf47" stroke="#000" stroke-width="1.5" /></svg>Best-Lit Point in NASA's Map</li>
            <li><svg viewBox="-12 -12 24 24" aria-hidden="true"><circle r="5" fill="#fff" stroke="#000" /></svg>Robotic Lander</li>
            <li><svg viewBox="-12 -12 24 24" aria-hidden="true"><circle r="5" fill="#d9b3ff" stroke="#000" /></svg>Planned Target</li>
            <li><svg viewBox="-12 -12 24 24" aria-hidden="true"><circle r="3.5" fill="#c9d3e3" stroke="#000" stroke-opacity="0.6" /></svg>Named Feature</li>
            <li><svg viewBox="-14 -26 28 28" aria-hidden="true"><path d="M0,0c-3-6-13-11-13-21a13,13 0 0 1 26,0c0,10-10,15-13,21z" fill={SCENARIO_COLORS[0]} stroke="#fff" stroke-width="2" /></svg>Scenario Site</li>
            <li><svg viewBox="-12 -12 24 24" aria-hidden="true"><circle r="10" fill="none" stroke="#6a6862" stroke-width="1.5" stroke-dasharray="3 2.5" /></svg>Edge of the Computed Area (80° S)</li>
          </ul>
          <p class="hint" style={{ margin: '6px 0 0' }}>Zoom with + and −, or Ctrl + scroll (pinch on a trackpad); drag to move. Names hidden where they would overlap appear as you zoom in.</p>
        </div>
      </aside>
      </div>
    </section>
  );
}
