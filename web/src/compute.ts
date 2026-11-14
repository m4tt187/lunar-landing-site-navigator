// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
import { computeSample, computeSeries, nextEvent, sampleMargins, seriesMargins, summarize } from '@engine/index';
import type { EventKind, Margins, PolarDem, Sample, Series, SeriesMargins, Site, Summary, Thresholds } from '@engine/index';
import { catalogTerrain, customTerrain } from './data';
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

export function stepSeconds(durationDays: number): number {
  return durationDays <= 31 ? 1800 : durationDays <= 100 ? 3600 : 10800;
}

const seriesCache = new Map<string, Series>();
function cachedSeries(site: Site, startMs: number, endMs: number, stepS: number): Series {
  const key = [site.latDeg, site.lonDeg, site.heightM, startMs, endMs, stepS].join('|');
  let s = seriesCache.get(key);
  if (!s) {
    if (seriesCache.size > 40) seriesCache.delete(seriesCache.keys().next().value!);
    s = computeSeries(site, startMs, endMs, stepS);
    seriesCache.set(key, s);
  }
  return s;
}

export function resolve(scenario: Scenario, app: AppData, dem: PolarDem | null): { catalog: CatalogSite | null; name: string; site: Site; terrain: SiteTerrain } | null {
  if (scenario.siteId) {
    const catalog = app.sites.find((s) => s.id === scenario.siteId);
    if (!catalog) return null;
    const terrain = catalogTerrain(catalog, scenario.mastM);
    return {
      catalog, name: catalog.name, terrain,
      site: { id: catalog.id, name: catalog.name, latDeg: catalog.latDeg, lonDeg: catalog.lonDeg, heightM: terrain.groundHeightM + scenario.mastM },
    };
  }
  const c = scenario.custom!;
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

export interface Instant { sample: Sample; margins: Margins; next: { kind: EventKind; atMs: number | null }[] }

const SEARCH_DAYS = 60;
export function instantAt(a: Analysis, cursorHours: number): Instant {
  const tMs = a.scenario.startMs + cursorHours * HOUR;
  const sample = computeSample(a.site, tMs);
  const margins = sampleMargins(sample, a.terrain.profile, a.thresholds);
  const kinds: EventKind[] = [margins.sunDeg > 0 ? 'sunset' : 'sunrise', margins.earthDeg > 0 ? 'earthset' : 'earthrise'];
  return {
    sample, margins,
    next: kinds.map((kind) => ({ kind, atMs: nextEvent(a.site, a.terrain.profile, a.thresholds, tMs, kind, SEARCH_DAYS, 3600) })),
  };
}
export const SEARCH_LIMIT_DAYS = SEARCH_DAYS;

/** Landing calendar: for each possible landing date, the unbroken hours of sunlight / Earth view that follow. */
export interface Calendar { startMs: number; stepMs: number; lookaheadH: number; sunRunH: Float32Array; earthRunH: Float32Array; bothRunH: Float32Array }

const LOOKAHEAD_DAYS = 120;
export function landingCalendar(a: Analysis, fromMs: number, spanDays: number): Calendar {
  const stepS = 7200;
  const series = cachedSeries(a.site, fromMs, fromMs + (spanDays + LOOKAHEAD_DAYS) * DAY, stepS);
  const m = seriesMargins(series, a.terrain.profile, a.thresholds);
  const n = series.n;
  const cells = Math.floor((spanDays * 86400) / stepS);
  const lookaheadH = LOOKAHEAD_DAYS * 24;
  const run = (flag: (i: number) => boolean): Float32Array => {
    const out = new Float32Array(cells);
    let length = 0;
    for (let i = n - 1; i >= 0; i--) {
      length = flag(i) ? length + 1 : 0;
      if (i < cells) out[i] = Math.min(lookaheadH, (length * stepS) / 3600);
    }
    return out;
  };
  return {
    startMs: fromMs, stepMs: stepS * 1000, lookaheadH,
    sunRunH: run((i) => m.sun[i]! > 0), earthRunH: run((i) => m.earth[i]! > 0),
    bothRunH: run((i) => m.sun[i]! > 0 && m.earth[i]! > 0),
  };
}
