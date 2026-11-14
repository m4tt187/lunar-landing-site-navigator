// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
import {
  MAX_TIME_MS, MIN_TIME_MS, computeSample, moonFixedVectors, nextEvent, sampleFromVectors, sampleMargins, seriesMargins, summarize,
  validateSite,
} from '@engine/index';
import type {
  EventKind, Interval, Margins, MoonFixedVectors, PolarDem, Sample, Series, SeriesMargins, Site, Summary, Thresholds,
} from '@engine/index';
import { catalogSiteAt, catalogTerrain, customTerrain } from './data';
import type { AppData, CatalogSite, SiteTerrain } from './data';
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

/** The engine's visibility rules: "any part of the Sun" is strict, the other rules include equality. */
export const sunUp = (marginDeg: number, t: Thresholds): boolean => (t.sunMinDiskFraction > 0 ? marginDeg >= 0 : marginDeg > 0);
export const earthUp = (marginDeg: number): boolean => marginDeg >= 0;

export function stepSeconds(durationDays: number): number {
  return durationDays <= 31 ? 1800 : durationDays <= 100 ? 3600 : 10800;
}

/** Sun and Earth positions do not depend on the site: computed once per time grid, shared by all scenarios. */
const vectorCache = new Map<string, MoonFixedVectors[]>();
function vectorsFor(startMs: number, endMs: number, stepS: number, n: number): MoonFixedVectors[] {
  const key = `${startMs}|${endMs}|${stepS}`;
  let vectors = vectorCache.get(key);
  if (!vectors) {
    if (vectorCache.size >= 8) vectorCache.delete(vectorCache.keys().next().value!);
    vectors = [];
    for (let i = 0; i < n; i++) vectors.push(moonFixedVectors(Math.min(endMs, startMs + i * stepS * 1000)));
    vectorCache.set(key, vectors);
  }
  return vectors;
}

/** Same sampling as the engine's computeSeries (both end points included), built from the shared vectors. */
function buildSeries(site: Site, startMs: number, endMs: number, stepS: number): Series {
  validateSite(site);
  const n = Math.ceil((endMs - startMs) / (stepS * 1000)) + 1;
  const vectors = vectorsFor(startMs, endMs, stepS, n);
  const series: Series = {
    site: { ...site }, startMs, endMs, stepS, n, timesMs: new Float64Array(n),
    sunAz: new Float64Array(n), sunEl: new Float64Array(n), sunRadius: new Float64Array(n),
    earthAz: new Float64Array(n), earthEl: new Float64Array(n), earthRadius: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    const tMs = Math.min(endMs, startMs + i * stepS * 1000);
    const s = sampleFromVectors(site, tMs, vectors[i]!);
    series.timesMs[i] = tMs;
    series.sunAz[i] = s.sun.azDeg; series.sunEl[i] = s.sun.elDeg; series.sunRadius[i] = s.sun.angularRadiusDeg;
    series.earthAz[i] = s.earth.azDeg; series.earthEl[i] = s.earth.elDeg; series.earthRadius[i] = s.earth.angularRadiusDeg;
  }
  return series;
}

const seriesCache = new Map<string, Series>();
function cachedSeries(site: Site, startMs: number, endMs: number, stepS: number): Series {
  const key = [site.latDeg, site.lonDeg, site.heightM, startMs, endMs, stepS].join('|');
  let s = seriesCache.get(key);
  if (!s) {
    if (seriesCache.size > 40) seriesCache.delete(seriesCache.keys().next().value!);
    s = buildSeries(site, startMs, endMs, stepS);
    seriesCache.set(key, s);
  }
  return s;
}

export interface Resolved { catalog: CatalogSite | null; name: string; site: Site; terrain: SiteTerrain }

export function resolve(scenario: Scenario, app: AppData, dem: PolarDem | null): Resolved | null {
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
  if (c.latDeg <= app.terrain.map.minLatDeg && !dem) return null; // waiting for the elevation model
  const terrain = customTerrain(dem!, app.terrain, c.latDeg, c.lonDeg, scenario.mastM);
  return {
    catalog: null, name: c.name, terrain,
    site: { id: 'custom', name: c.name, latDeg: c.latDeg, lonDeg: c.lonDeg, heightM: terrain.groundHeightM + scenario.mastM },
  };
}

export function analyze(scenario: Scenario, app: AppData, dem: PolarDem | null, durationDays: number, thresholds: Thresholds): Analysis | null {
  const r = resolve(scenario, app, dem);
  if (!r) return null;
  const series = cachedSeries(r.site, scenario.startMs, scenario.startMs + durationDays * DAY, stepSeconds(durationDays));
  return {
    scenario, ...r, thresholds, series,
    margins: seriesMargins(series, r.terrain.profile, thresholds),
    summary: summarize(series, r.terrain.profile, thresholds),
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

