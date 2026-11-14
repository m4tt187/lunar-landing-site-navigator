// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// From windows of sunlight and of Earth visibility to planning answers: how
// long a mission can run from a given landing, what each possible landing date
// would give, and which site and date suit a mission best.
//
// Everything here works on intervals (the windows that summarize() returns), not
// on samples, so the answers do not depend on how the windows were sampled and
// the functions never call the ephemeris.
import type { Interval } from './types';

const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const MAX_CELLS = 1000000;
/** Differences smaller than this are treated as ties, so that rounding never decides a ranking. */
const TIE = 1e-9;

function requireSpan(startMs: number, endMs: number): void {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !(endMs > startMs))
    throw new RangeError('The analysed span must have a finite start and a later finite end.');
}

function requireTolerance(toleranceH: number): void {
  if (!Number.isFinite(toleranceH) || toleranceH < 0)
    throw new RangeError('The darkness a lander can bridge must be a finite number of hours, zero or more.');
}

function requireWindows(windows: Interval[], startMs: number, endMs: number, what: string): void {
  let previousEnd = startMs;
  for (const w of windows) {
    if (!Number.isFinite(w.startMs) || !Number.isFinite(w.endMs) || !(w.endMs > w.startMs))
      throw new RangeError(`${what} windows must have a finite start and a later finite end.`);
    if (w.startMs < previousEnd || w.endMs > endMs)
      throw new RangeError(`${what} windows must be sorted, disjoint and inside the analysed span.`);
    previousEnd = w.endMs;
  }
}

/**
 * How long a mission can run from touchdown: until the first darkness longer
 * than the lander can bridge on its own energy. A landing in the dark counts
 * only if sunrise comes within that same tolerance.
 */
export interface OperatingWindow {
  hours: number;
  /** End of the last sunlight before the darkness that ends the mission. */
  endMs: number;
  /** The window reaches the end of the analysed span: it may be longer than shown. */
  openEnded: boolean;
  /** Length in hours of the darkness that ends it, when its end lies inside the span. */
  endedByNightH: number | null;
}

export function operatingWindow(sunWindows: Interval[], startMs: number, endMs: number, toleranceH: number): OperatingWindow {
  requireSpan(startMs, endMs); requireTolerance(toleranceH); requireWindows(sunWindows, startMs, endMs, 'Sunlight');
  const tolerance = toleranceH * HOUR_MS;
  let lit = startMs; // end of the sunlight reached so far
  for (const w of sunWindows) {
    if (w.startMs - lit > tolerance)
      return { hours: (lit - startMs) / HOUR_MS, endMs: lit, openEnded: false, endedByNightH: (w.startMs - lit) / HOUR_MS };
    lit = w.endMs;
  }
  // Darkness from `lit` to the end of the span: longer than the tolerance, or still being bridged.
  if (endMs - lit > tolerance) return { hours: (lit - startMs) / HOUR_MS, endMs: lit, openEnded: false, endedByNightH: null };
  return { hours: (endMs - startMs) / HOUR_MS, endMs, openEnded: true, endedByNightH: null };
}

/** What a mission asks of a landing site and date. */
export interface MissionNeeds {
  /** Days of surface operations wanted. */
  missionDays: number;
  /** Longest darkness the lander survives on its own energy, hours (0: none). */
  toleranceH: number;
  /** The Earth must be in view at touchdown, for a direct link during the landing (default true). */
  earthAtLanding?: boolean;
}

/** One possible landing, and what it gives. */
export interface LandingOption {
  landingMs: number;
  /** Hours of operation from this landing until a darkness longer than the tolerance begins. */
  powerHours: number;
  /** The power window runs to the end of the analysed data: it may be longer. */
  openEnded: boolean;
  /** Share of the wanted mission that has power: min(1, powerHours / mission hours). */
  missionCoverage: number;
  /** Share of the operated part of the mission, [landing, landing + min(mission, power)], with the Earth in view. */
  earthFraction: number;
  /** Share of that same period with sunlight and the Earth together. */
  bothFraction: number;
  /** Longest stretch of that same period without the Earth, hours. */
  longestLinkGapH: number;
  earthAtLanding: boolean;
}

export interface CalendarOptions {
  /** Landing dates examined: from the start of the data for this many days. */
  searchDays: number;
  /** Spacing of the landing times examined, seconds (default 3600). */
  gridS?: number;
  /** How many options to return (default 3 for a calendar, 5 for a recommendation). */
  count?: number;
}

/** What every landing time on a grid would give at one site. */
export interface LandingCalendar {
  startMs: number;
  stepMs: number;
  cells: number;
  /** Hours of operation after a landing at each grid time (0: no power, or a night too long to bridge). */
  powerHours: Float32Array;
  /** Share of the operated part of the mission with the Earth in view, for a landing at each grid time. */
  earthFraction: Float32Array;
  /** 1 where the Earth is in view at that grid time. */
  earthAtLanding: Uint8Array;
  /** The best landing of each stretch of power, best first. */
  best: LandingOption[];
}

/** A stretch of power: a landing anywhere in [fromMs, endMs] runs until endMs. */
interface Stretch { fromMs: number; endMs: number; open: boolean }

/**
 * Sunlight windows separated by a darkness the lander can bridge make one
 * stretch. A landing may come up to the tolerance before a stretch begins. A
 * darkness cut short by the end of the data is still being bridged, so the
 * stretch that reaches it is open-ended (it may go on).
 */
function powerStretches(sunWindows: Interval[], dataEndMs: number, toleranceMs: number): Stretch[] {
  const out: Stretch[] = [];
  for (let i = 0; i < sunWindows.length;) {
    const firstLight = sunWindows[i]!.startMs;
    let lastLight = sunWindows[i]!.endMs;
    i++;
    while (i < sunWindows.length && sunWindows[i]!.startMs - lastLight <= toleranceMs) { lastLight = sunWindows[i]!.endMs; i++; }
    const open = dataEndMs - lastLight <= toleranceMs;
    out.push({ fromMs: firstLight - toleranceMs, endMs: open ? dataEndMs : lastLight, open });
  }
  const last = out[out.length - 1];
  if (!last || !last.open) out.push({ fromMs: dataEndMs - toleranceMs, endMs: dataEndMs, open: true });
  return out;
}

/** Running totals: totals[j] is the summed length of the first j windows. */
function runningTotals(windows: Interval[]): Float64Array {
  const totals = new Float64Array(windows.length + 1);
  for (let j = 0; j < windows.length; j++) totals[j + 1] = totals[j]! + (windows[j]!.endMs - windows[j]!.startMs);
  return totals;
}

/** Index of the first window that ends after x. */
function firstEndingAfter(windows: Interval[], x: number): number {
  let lo = 0, hi = windows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (windows[mid]!.endMs > x) hi = mid; else lo = mid + 1;
  }
  return lo;
}

/** Window time earlier than x. */
function timeBefore(windows: Interval[], totals: Float64Array, x: number): number {
  const j = firstEndingAfter(windows, x);
  return j === windows.length ? totals[j]! : totals[j]! + Math.max(0, x - windows[j]!.startMs);
}

/** Longest part of [fromMs, toMs] not covered by the windows. */
function longestGapIn(windows: Interval[], fromMs: number, toMs: number): number {
  let gap = 0, cursor = fromMs;
  for (let j = firstEndingAfter(windows, fromMs); j < windows.length && windows[j]!.startMs < toMs; j++) {
    gap = Math.max(gap, windows[j]!.startMs - cursor);
    cursor = windows[j]!.endMs;
  }
  return Math.max(gap, toMs - cursor);
}

/** True when the first landing is the better one: enough power first, then the most Earth, then the most power, then the earlier date. */
function better(a: LandingOption, b: LandingOption): boolean {
  if (Math.abs(a.missionCoverage - b.missionCoverage) > TIE) return a.missionCoverage > b.missionCoverage;
  if (Math.abs(a.earthFraction - b.earthFraction) > TIE) return a.earthFraction > b.earthFraction;
  if (Math.abs(a.powerHours - b.powerHours) > TIE) return a.powerHours > b.powerHours;
  return a.landingMs < b.landingMs;
}

function requireNeeds(needs: MissionNeeds): void {
  if (!Number.isFinite(needs.missionDays) || !(needs.missionDays > 0))
    throw new RangeError('Mission length must be a positive finite number of days.');
  requireTolerance(needs.toleranceH);
}

function positiveInteger(value: number | undefined, fallback: number, what: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${what} must be a whole number, one or more.`);
  return value;
}

/**
 * What every landing time of the search would give at one site, and the best
 * landing of each stretch of power.
 *
 * The windows are those of summarize() over [dataStartMs, dataEndMs]. That span
 * should reach at least the mission length past the last landing date examined;
 * where it does not, the power window of a late landing is cut by the end of the
 * data and marked open-ended.
 *
 * Inside a stretch the chosen landing is the one that powers the whole mission
 * (or the most of it), then has the Earth in view for the largest share of it,
 * then has the most power, then comes first.
 */
export function landingCalendar(
  sunWindows: Interval[], earthWindows: Interval[], bothWindows: Interval[],
  dataStartMs: number, dataEndMs: number, needs: MissionNeeds, options: CalendarOptions,
): LandingCalendar {
  requireSpan(dataStartMs, dataEndMs); requireNeeds(needs);
  requireWindows(sunWindows, dataStartMs, dataEndMs, 'Sunlight');
  requireWindows(earthWindows, dataStartMs, dataEndMs, 'Earth');
  requireWindows(bothWindows, dataStartMs, dataEndMs, 'Sunlight-and-Earth');
  if (!Number.isFinite(options.searchDays) || !(options.searchDays > 0))
    throw new RangeError('The search must cover a positive finite number of days.');
  const gridS = options.gridS ?? 3600;
  if (!Number.isFinite(gridS) || !(gridS > 0)) throw new RangeError('The landing grid must be a positive finite number of seconds.');
  const count = positiveInteger(options.count, 3, 'The number of options');
  const stepMs = gridS * 1000;
  if (!Number.isFinite(stepMs)) throw new RangeError('The landing grid must be finite when expressed in milliseconds.');
  const searchMs = Math.min(options.searchDays * DAY_MS, dataEndMs - dataStartMs);
  // Every grid time earlier than the end of the search, also when the search is not a whole number of steps.
  const cells = Math.max(1, Math.ceil(searchMs / stepMs));
  if (cells > MAX_CELLS) throw new RangeError('The search has more than a million landing times; use a coarser grid.');

  const toleranceMs = needs.toleranceH * HOUR_MS, missionMs = needs.missionDays * DAY_MS;
  const needEarth = needs.earthAtLanding !== false;
  const stretches = powerStretches(sunWindows, dataEndMs, toleranceMs);
  const earthTotals = runningTotals(earthWindows), bothTotals = runningTotals(bothWindows);

  const option = (landingMs: number, stretch: Stretch, earthAtLanding: boolean): LandingOption => {
    const powerMs = stretch.endMs - landingMs;
    const operatedMs = Math.min(missionMs, powerMs), untilMs = landingMs + operatedMs;
    const share = (windows: Interval[], totals: Float64Array): number =>
      operatedMs > 0 ? (timeBefore(windows, totals, untilMs) - timeBefore(windows, totals, landingMs)) / operatedMs : 0;
    return {
      landingMs, powerHours: powerMs / HOUR_MS, openEnded: stretch.open,
      missionCoverage: Math.min(1, powerMs / missionMs),
      earthFraction: share(earthWindows, earthTotals), bothFraction: share(bothWindows, bothTotals),
      longestLinkGapH: operatedMs > 0 ? longestGapIn(earthWindows, landingMs, untilMs) / HOUR_MS : 0,
      earthAtLanding,
    };
  };

  const powerHours = new Float32Array(cells), earthFraction = new Float32Array(cells), earthAtLanding = new Uint8Array(cells);
  const bestOf: (LandingOption | null)[] = stretches.map(() => null);
  let k = 0, e = 0;
  for (let i = 0; i < cells; i++) {
    const tMs = dataStartMs + i * stepMs;
    while (k < stretches.length && stretches[k]!.endMs < tMs) k++;
    while (e < earthWindows.length && earthWindows[e]!.endMs < tMs) e++;
    const inView = e < earthWindows.length && earthWindows[e]!.startMs <= tMs;
    earthAtLanding[i] = inView ? 1 : 0;
    const stretch = stretches[k];
    if (!stretch || tMs < stretch.fromMs) continue;
    const powerMs = stretch.endMs - tMs;
    if (!(powerMs > 0)) continue;
    const operatedMs = Math.min(missionMs, powerMs);
    powerHours[i] = powerMs / HOUR_MS;
    earthFraction[i] = (timeBefore(earthWindows, earthTotals, tMs + operatedMs) - timeBefore(earthWindows, earthTotals, tMs)) / operatedMs;
    if (powerMs < HOUR_MS || (needEarth && !inView)) continue;
    const candidate = option(tMs, stretch, inView);
    const current = bestOf[k]!;
    if (!current || better(candidate, current)) bestOf[k] = candidate;
  }
  const best = bestOf.filter((o): o is LandingOption => o !== null).sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0)).slice(0, count);
  return { startMs: dataStartMs, stepMs, cells, powerHours, earthFraction, earthAtLanding, best };
}

/** A site to consider, with its windows over the analysed span. */
export interface Candidate {
  id: string;
  name: string;
  sunWindows: Interval[];
  earthWindows: Interval[];
  bothWindows: Interval[];
}

export interface Recommendation extends LandingOption {
  candidateId: string;
  candidateName: string;
  /** 1 for the best. */
  rank: number;
}

/**
 * The best site-and-date pairs for a mission among the candidates: the best
 * landings of each site (at most `perCandidate`, default 1), ordered as inside a
 * calendar: power for the whole mission first, then the most contact with the
 * Earth, then the most power, then the earlier date.
 */
export function recommend(
  candidates: Candidate[], dataStartMs: number, dataEndMs: number, needs: MissionNeeds,
  options: CalendarOptions & { perCandidate?: number },
): Recommendation[] {
  const count = positiveInteger(options.count, 5, 'The number of recommendations');
  const perCandidate = positiveInteger(options.perCandidate, 1, 'The number of options per site');
  const all: { option: LandingOption; candidate: Candidate; order: number }[] = [];
  candidates.forEach((candidate, order) => {
    const calendar = landingCalendar(candidate.sunWindows, candidate.earthWindows, candidate.bothWindows,
      dataStartMs, dataEndMs, needs, { searchDays: options.searchDays, gridS: options.gridS, count: perCandidate });
    for (const option of calendar.best) all.push({ option, candidate, order });
  });
  all.sort((a, b) => (better(a.option, b.option) ? -1 : better(b.option, a.option) ? 1 : a.order - b.order));
  return all.slice(0, count).map(({ option, candidate }, i) => ({ ...option, candidateId: candidate.id, candidateName: candidate.name, rank: i + 1 }));
}

export interface CellPick { index: number; col: number; row: number; value: number }

/**
 * The cells with the largest values of a square, row-major grid, no two of them
 * closer than `minSeparation` cells centre to centre: the best places of a map
 * layer, spread out rather than crowded on one ridge. Cells where `inside` is 0
 * and cells that are not finite numbers are skipped; equal values are taken in
 * index order.
 */
export function topCells(values: ArrayLike<number>, size: number, count: number, minSeparation: number, inside?: ArrayLike<number>): CellPick[] {
  if (!Number.isInteger(size) || size < 1 || values.length !== size * size)
    throw new RangeError('Grid values must fill a square grid of the given size.');
  if (inside && inside.length !== values.length) throw new RangeError('The mask must have one entry per grid cell.');
  if (!Number.isInteger(count) || count < 0) throw new RangeError('The number of cells must be a whole number, zero or more.');
  if (!Number.isFinite(minSeparation) || minSeparation < 0) throw new RangeError('The separation must be a finite number of cells, zero or more.');
  const order: number[] = [];
  for (let index = 0; index < values.length; index++)
    if ((!inside || inside[index]) && Number.isFinite(values[index]!)) order.push(index);
  order.sort((a, b) => values[b]! - values[a]! || a - b);
  const picks: CellPick[] = [];
  const limit = minSeparation * minSeparation;
  for (const index of order) {
    if (picks.length >= count) break;
    const col = index % size, row = (index - col) / size;
    if (picks.every((p) => (p.col - col) ** 2 + (p.row - row) ** 2 >= limit)) picks.push({ index, col, row, value: values[index]! });
  }
  return picks;
}
