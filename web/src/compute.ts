// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
import {
  MAX_TIME_MS, MIN_TIME_MS, computeSample, earthVisible, moonFixedVectors, nextEvent, sampleMargins, seriesFromTable, seriesMargins,
  summarize, sunVisible,
} from '@engine/index';
import type {
  EventKind, Interval, Margins, PolarDem, Sample, Series, SeriesMargins, Site, Summary, Thresholds, VectorTable,
} from '@engine/index';
import { catalogSiteAt, catalogTerrain, customTerrain } from './data';
import type { AppData, CatalogSite, FineTerrain, SiteTerrain } from './data';
import { DAY, HOUR } from './state';
import type { Scenario } from './state';

export interface Analysis {
  scenario: Scenario;
  catalog: CatalogSite | null;
  name: string;
  site: Site;
  terrain: SiteTerrain;
  thresholds: Thresholds;
  series: Series;
  margins: SeriesMargins;
  summary: Summary;
}

/** The engine's own visibility rules, so that the pictures and the numbers can never disagree. */
export const sunUp = (marginDeg: number, t: Thresholds): boolean => sunVisible(marginDeg, t);
export const earthUp = (marginDeg: number): boolean => earthVisible(marginDeg);

/**
 * Every mission is analysed from samples ten minutes apart: the skyline is known
 * every 0.25 degrees of azimuth and the Sun moves about half a degree an hour at
 * the poles, a third of a skyline bin between two samples. An event shorter than
 * the step can still be missed.
 */
export const ANALYSIS_STEP_S = 600;

/** Step of the samples used for drawing the paths in the sky: a few thousand points whatever the span. */
export function stepSeconds(durationDays: number): number {
  return durationDays <= 31 ? ANALYSIS_STEP_S : durationDays <= 100 ? 1800 : 10800;
}

// Sun and Earth vectors do not depend on the site. They are computed exactly at
// knots two hours apart on a fixed grid of times and interpolated in between
// (engine/src/ephemeris.ts). The knots are kept, so spans that overlap (another
// scenario, the same scenario a day later, the landing calendar) share them.
const KNOT_MS = 7200000;
const MAX_KNOTS_KEPT = 60000;
const knots = new Map<number, Float64Array>();

function knotAt(index: number): Float64Array {
  let k = knots.get(index);
  if (!k) {
    if (knots.size >= MAX_KNOTS_KEPT) knots.clear();
    const v = moonFixedVectors(index * KNOT_MS);
    k = Float64Array.of(v.sun[0], v.sun[1], v.sun[2], v.earth[0], v.earth[1], v.earth[2]);
    knots.set(index, k);
  }
  return k;
}

const tableCache = new Map<string, VectorTable>();
function tableFor(startMs: number, endMs: number): VectorTable {
  // One knot to spare on each side, inside the dates the ephemeris supports.
  const first = Math.max(Math.ceil(MIN_TIME_MS / KNOT_MS), Math.floor(startMs / KNOT_MS) - 1);
  const last = Math.min(Math.floor(MAX_TIME_MS / KNOT_MS), Math.ceil(endMs / KNOT_MS) + 1);
  const key = `${first}|${last}`;
  let table = tableCache.get(key);
  if (!table) {
    if (tableCache.size >= 8) tableCache.delete(tableCache.keys().next().value!);
    const n = last - first + 1;
    const sun = new Float64Array(3 * n), earth = new Float64Array(3 * n);
    for (let i = 0; i < n; i++) {
      const k = knotAt(first + i);
      sun.set(k.subarray(0, 3), 3 * i);
      earth.set(k.subarray(3, 6), 3 * i);
    }
    table = { startMs: first * KNOT_MS, stepMs: KNOT_MS, n, sun, earth, validFromMs: first * KNOT_MS, validToMs: last * KNOT_MS };
    tableCache.set(key, table);
  }
  return table;
}

// Most recently used series, within a budget of samples (a year at ten minutes is 52,561 of them).
const SAMPLES_KEPT = 500000;
const seriesCache = new Map<string, Series>();
let samplesKept = 0;
function cachedSeries(site: Site, startMs: number, endMs: number, stepS: number): Series {
  const key = [site.latDeg, site.lonDeg, site.heightM, startMs, endMs, stepS].join('|');
  let s = seriesCache.get(key);
  if (s) seriesCache.delete(key);
  else {
    s = seriesFromTable(site, tableFor(startMs, endMs), startMs, endMs, stepS);
    samplesKept += s.n;
    while (samplesKept > SAMPLES_KEPT && seriesCache.size > 0) {
      const oldest = seriesCache.keys().next().value!;
      samplesKept -= seriesCache.get(oldest)!.n;
      seriesCache.delete(oldest);
    }
  }
  seriesCache.set(key, s);
  return s;
}

export interface Resolved { catalog: CatalogSite | null; name: string; site: Site; terrain: SiteTerrain }

/**
 * `fine` is the 120 m tile store when the tiles around a picked site are loaded,
 * 'pending' while they are on their way, and null when there are none to wait for.
 */
export function resolve(scenario: Scenario, app: AppData, dem: PolarDem | null, fine: FineTerrain | 'pending' | null): Resolved | null {
  const fromCatalog = (catalog: CatalogSite, name: string): Resolved => {
    const terrain = catalogTerrain(catalog, scenario.mastM);
    return {
      catalog, name, terrain,
      site: { id: catalog.id, name, latDeg: catalog.latDeg, lonDeg: catalog.lonDeg, heightM: terrain.groundHeightM + scenario.mastM },
    };
  };
  if (scenario.siteId) {
    const catalog = app.sites.find((s) => s.id === scenario.siteId);
    return catalog ? fromCatalog(catalog, catalog.name) : null;
  }
  const c = scenario.custom!;
  // Coordinates that match a catalogue site reuse its finer skyline.
  const match = catalogSiteAt(app, c.latDeg, c.lonDeg);
  if (match) return fromCatalog(match, match.name);
  if (c.latDeg <= app.terrain.map.minLatDeg && (!dem || fine === 'pending')) return null; // waiting for the elevation data
  const terrain = customTerrain(dem!, app.terrain, c.latDeg, c.lonDeg, scenario.mastM, fine === 'pending' ? null : fine);
  return {
    catalog: null, name: c.name, terrain,
    site: { id: 'custom', name: c.name, latDeg: c.latDeg, lonDeg: c.lonDeg, heightM: terrain.groundHeightM + scenario.mastM },
  };
}

export function analyze(
  scenario: Scenario, app: AppData, dem: PolarDem | null, fine: FineTerrain | 'pending' | null, durationDays: number, thresholds: Thresholds,
): Analysis | null {
  const r = resolve(scenario, app, dem, fine);
  if (!r) return null;
  const endMs = scenario.startMs + durationDays * DAY;
  // The numbers come from the ten-minute samples; the drawn paths may use fewer points.
  const detailed = cachedSeries(r.site, scenario.startMs, endMs, ANALYSIS_STEP_S);
  const drawStep = stepSeconds(durationDays);
  const series = drawStep === ANALYSIS_STEP_S ? detailed : cachedSeries(r.site, scenario.startMs, endMs, drawStep);
  return {
    scenario, ...r, thresholds, series,
    margins: seriesMargins(series, r.terrain.profile, thresholds),
    summary: summarize(detailed, r.terrain.profile, thresholds),
  };
}

export interface Instant { tMs: number; sample: Sample; margins: Margins; sunUp: boolean; earthUp: boolean }

export function instantAt(a: Analysis, cursorHours: number): Instant {
  const tMs = a.scenario.startMs + cursorHours * HOUR;
  const sample = computeSample(a.site, tMs);
  const margins = sampleMargins(sample, a.terrain.profile, a.thresholds);
  return { tMs, sample, margins, sunUp: sunUp(margins.sunDeg, a.thresholds), earthUp: earthUp(margins.earthDeg) };
}

export const SEARCH_LIMIT_DAYS = 60;

/**
 * Time of the next change of state (rise or set) after `tMs`, read from the
 * computed windows; searched further only beyond the end of the span. Null means
 * none within the search limit.
 */
const beyond = new WeakMap<Analysis, Map<EventKind, number | null>>();
export function nextChange(a: Analysis, windows: Interval[], tMs: number, up: boolean, kind: EventKind): number | null {
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
  if (!cache.has(kind)) {
    const days = Math.min(SEARCH_LIMIT_DAYS, (MAX_TIME_MS - end) / DAY - 1);
    cache.set(kind, days > 0 ? nextEvent(a.site, a.terrain.profile, a.thresholds, end, kind, days, 3600) : null);
  }
  return cache.get(kind)!;
}

/** Landing calendar: for each possible landing time, the unbroken hours of sunlight / Earth view that follow. */
export interface Calendar { startMs: number; stepMs: number; lookaheadH: number; sunRunH: Float32Array; earthRunH: Float32Array; bothRunH: Float32Array }

const LOOKAHEAD_DAYS = 120;
const CALENDAR_STEP_S = 7200;

export function landingCalendar(a: Analysis, fromMs: number, spanDays: number): Calendar {
  const start = Math.max(fromMs, MIN_TIME_MS);
  const end = Math.min(start + (spanDays + LOOKAHEAD_DAYS) * DAY, MAX_TIME_MS);
  const series = cachedSeries(a.site, start, end, CALENDAR_STEP_S);
  const m = seriesMargins(series, a.terrain.profile, a.thresholds);
  const n = series.n;
  const cells = Math.min(n, Math.floor((spanDays * 86400) / CALENDAR_STEP_S));
  const lookaheadH = LOOKAHEAD_DAYS * 24;
  const run = (flag: (i: number) => boolean): Float32Array => {
    const out = new Float32Array(cells);
    let length = 0;
    for (let i = n - 1; i >= 0; i--) {
      length = flag(i) ? length + 1 : 0;
      if (i < cells) out[i] = Math.min(lookaheadH, (length * CALENDAR_STEP_S) / 3600);
    }
    return out;
  };
  const sun = (i: number): boolean => sunUp(m.sun[i]!, a.thresholds), earth = (i: number): boolean => earthUp(m.earth[i]!);
  return {
    startMs: start, stepMs: CALENDAR_STEP_S * 1000, lookaheadH,
    sunRunH: run(sun), earthRunH: run(earth), bothRunH: run((i) => sun(i) && earth(i)),
  };
}

export interface LandingWindow { startMs: number; hours: number; capped: boolean }

/** The longest unbroken "power + link" stretches in the calendar: land at the start of one to use all of it. */
export function bestWindows(calendar: Calendar, count: number): LandingWindow[] {
  const runs = calendar.bothRunH;
  const found: LandingWindow[] = [];
  for (let i = 0; i < runs.length; i++) {
    if (runs[i]! > 0 && (i === 0 || runs[i - 1]! === 0))
      found.push({ startMs: calendar.startMs + i * calendar.stepMs, hours: runs[i]!, capped: runs[i]! >= calendar.lookaheadH });
  }
  return found.sort((x, y) => y.hours - x.hours).slice(0, count).sort((x, y) => x.startMs - y.startMs);
}

/** Length in hours of the stretch that starts at the landing itself (0 when the landing is outside every window). */
export function fromLanding(windows: Interval[], a: Analysis): { hours: number; openEnded: boolean } {
  const first = windows[0];
  if (!first || first.startMs > a.series.startMs) return { hours: 0, openEnded: false };
  return { hours: (first.endMs - first.startMs) / HOUR, openEnded: first.endMs >= a.series.endMs };
}

