// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// Planning answers for the interface, on top of engine/src/planning.ts: how long
// a scenario can operate from its landing, what every landing date would give at
// its site, and the best site and date for a mission among the sites that have a
// real skyline. Nothing here draws anything.
import { landingCalendar, operatingWindow, recommend, summarize } from '@engine/index';
import type {
  Candidate, EclipseEvent, LandingCalendar, MissionNeeds, OperatingWindow, Recommendation, Site, Thresholds,
} from '@engine/index';
import { ANALYSIS_STEP_S, seriesOnce } from './compute';
import type { Analysis } from './compute';
import { catalogTerrain } from './data';
import type { AppData, CatalogSite } from './data';
import { DAY } from './state';

/** A mission to plan: what it needs, and the landing dates to consider. */
export interface MissionRequest extends MissionNeeds {
  /** Height of the panels and antenna above the ground, metres (one of the heights the catalogue has skylines for). */
  mastM: number;
  /** First landing date considered, UTC milliseconds, and for how many days after it. */
  fromMs: number;
  searchDays: number;
  /** What counts as "Sun up" and "Earth in view". */
  thresholds: Thresholds;
}

/** Data beyond the last landing date considered, so that long stretches of power are measured and not cut short. */
export function lookaheadDays(missionDays: number): number {
  return Math.max(missionDays + 2, 120);
}

/**
 * The last instant a search needs data for. It must not be later than the
 * ephemeris covers (MAX_TIME_MS): a search that reaches beyond it is refused
 * with a RangeError.
 */
export function searchEndMs(request: MissionRequest): number {
  return request.fromMs + (request.searchDays + lookaheadDays(request.missionDays)) * DAY;
}

/** Ten minutes, or the next multiple of it that keeps the search within 100,000 samples. */
export function planningStepS(spanDays: number): number {
  return ANALYSIS_STEP_S * Math.max(1, Math.ceil((spanDays * 86400) / ANALYSIS_STEP_S / 99999));
}

/** How long the scenario can operate from its landing: until the first darkness longer than the lander can bridge. */
export function operatingWindowOf(a: Analysis, toleranceH: number): OperatingWindow {
  return operatingWindow(a.summary.sunWindows, a.series.startMs, a.series.endMs, toleranceH);
}

/** The eclipses that fall inside the scenario's mission. */
export function eclipsesOf(a: Analysis): EclipseEvent[] {
  return a.summary.eclipses;
}

interface Windows { candidate: Candidate; startMs: number; endMs: number }

function windowsOf(
  id: string, name: string, site: Site, profile: Analysis['terrain']['profile'], request: MissionRequest,
): Windows {
  const spanDays = request.searchDays + lookaheadDays(request.missionDays);
  const startMs = request.fromMs, endMs = searchEndMs(request);
  const summary = summarize(seriesOnce(site, startMs, endMs, planningStepS(spanDays)), profile, request.thresholds);
  return {
    candidate: { id, name, sunWindows: summary.sunWindows, earthWindows: summary.earthWindows, bothWindows: summary.bothWindows },
    startMs, endMs,
  };
}

/**
 * What every landing date of the search would give at the scenario's site (its
 * skyline and height), and the best landing of each stretch of power.
 */
export function calendarOf(a: Analysis, request: MissionRequest, count = 3): LandingCalendar {
  const w = windowsOf(a.site.id, a.name, a.site, a.terrain.profile, request);
  return landingCalendar(w.candidate.sunWindows, w.candidate.earthWindows, w.candidate.bothWindows, w.startMs, w.endMs, request,
    { searchDays: request.searchDays, count });
}

/** The catalogue sites that can be ranked: those with a skyline computed from the terrain for this height. */
export function rankableSites(app: AppData, mastM: number): CatalogSite[] {
  return app.sites.filter((s) => s.terrain !== null && s.terrain.profiles[String(mastM)] !== undefined);
}

export interface FindOptions {
  /** How many site-and-date pairs to return (default 5). */
  count?: number;
  /** Called after each site, so that a long search can show its progress. */
  onProgress?: (done: number, total: number) => void;
  /** Lets the caller abandon a search that is no longer wanted. */
  signal?: AbortSignal;
}

/**
 * The best site-and-date pairs for a mission among the catalogue sites with a
 * real skyline: power for the whole mission first, then the most contact with the
 * Earth. One site at a time, giving the page a turn in between: a year of landing
 * dates for 25 sites takes about a second in all. Resolves with an empty list
 * when the search is abandoned.
 */
export async function findBest(app: AppData, request: MissionRequest, options: FindOptions = {}): Promise<Recommendation[]> {
  const sites = rankableSites(app, request.mastM);
  const candidates: Candidate[] = [];
  let startMs = request.fromMs, endMs = request.fromMs;
  for (let i = 0; i < sites.length; i++) {
    if (options.signal?.aborted) return [];
    const catalogue = sites[i]!;
    const terrain = catalogTerrain(catalogue, request.mastM);
    const site: Site = {
      id: catalogue.id, name: catalogue.name, latDeg: catalogue.latDeg, lonDeg: catalogue.lonDeg,
      heightM: terrain.groundHeightM + request.mastM,
    };
    const w = windowsOf(catalogue.id, catalogue.name, site, terrain.profile, request);
    candidates.push(w.candidate);
    startMs = w.startMs; endMs = w.endMs;
    options.onProgress?.(i + 1, sites.length);
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  }
  if (options.signal?.aborted || candidates.length === 0) return [];
  return recommend(candidates, startMs, endMs, request, { searchDays: request.searchDays, count: options.count ?? 5 });
}
