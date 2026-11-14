// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude and reviewed with OpenAI Codex under the direction of the team.
//
// Turns Sun/Earth directions into mission answers: is the Sun above the local
// skyline (power), is the Earth above it (direct-to-Earth link), for how long,
// and when the next change happens.
import { computeSample, validateSite, validateTime } from './geometry';
import type { HorizonProfile, Interval, Sample, Series, Site, Summary, Thresholds } from './types';

export type EventKind = 'sunrise' | 'sunset' | 'earthrise' | 'earthset';

const HOUR_MS = 3600000;
const DAY_MS = 86400000;

/** A flat skyline: the horizon of a smooth sphere seen from its surface. */
export const FLAT_HORIZON: HorizonProfile = { azStepDeg: 360, elDeg: new Float32Array([0]) };

export function validateProfile(profile: HorizonProfile): void {
  validateProfileShape(profile);
  for (const elevation of profile.elDeg)
    if (!Number.isFinite(elevation) || Math.abs(elevation) > 90)
      throw new RangeError('Horizon elevations must be finite and between -90 and 90 degrees.');
}

function validateProfileShape(profile: HorizonProfile): void {
  const n = profile.elDeg.length;
  if (n < 1 || !Number.isFinite(profile.azStepDeg) || !(profile.azStepDeg > 0) || Math.abs(n * profile.azStepDeg - 360) > 1e-6)
    throw new RangeError('Horizon profile must cover exactly 360 degrees of azimuth.');
}

export function validateThresholds(t: Thresholds): void {
  if (!(t.sunMinDiskFraction >= 0 && t.sunMinDiskFraction <= 1))
    throw new RangeError('Minimum solar-disk fraction must be between 0 and 1.');
  if (!Number.isFinite(t.earthMinElevationAboveHorizonDeg) || Math.abs(t.earthMinElevationAboveHorizonDeg) > 90)
    throw new RangeError('Earth elevation margin must be between -90 and 90 degrees.');
}

/** Skyline elevation (degrees) at an azimuth, by periodic linear interpolation. */
export function horizonElevationAt(profile: HorizonProfile, azDeg: number): number {
  validateProfileShape(profile);
  if (!Number.isFinite(azDeg)) throw new RangeError('Azimuth must be finite.');
  return horizonAtUnchecked(profile, azDeg, true);
}

function horizonAtUnchecked(profile: HorizonProfile, azDeg: number, checkValues = false): number {
  const el = profile.elDeg;
  const n = el.length;
  if (n === 1) { if (checkValues) validateElevation(el[0]!); return el[0]!; }
  const x = ((((azDeg % 360) + 360) % 360) / profile.azStepDeg) % n;
  const i = Math.floor(x);
  const f = x - i;
  if (checkValues) { validateElevation(el[i % n]!); validateElevation(el[(i + 1) % n]!); }
  return el[i % n]! * (1 - f) + el[(i + 1) % n]! * f;
}

/**
 * Fraction (0..1) of the solar disk that is above a locally straight skyline.
 * d is the height of the skyline above the disk centre in units of disk radii.
 */
export function sunDiskFractionVisible(sunElDeg: number, sunRadiusDeg: number, horizonElDeg: number): number {
  validateElevation(sunElDeg); validateElevation(horizonElDeg); validateRadius(sunRadiusDeg);
  return diskFractionUnchecked(sunElDeg, sunRadiusDeg, horizonElDeg);
}

function validateElevation(value: number): void {
  if (!Number.isFinite(value) || Math.abs(value) > 90)
    throw new RangeError('Elevation must be finite and between -90 and 90 degrees.');
}

function validateRadius(value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > 90)
    throw new RangeError('Angular radius must be finite, positive, and at most 90 degrees.');
}

function diskFractionUnchecked(sunElDeg: number, sunRadiusDeg: number, horizonElDeg: number): number {
  const d = (horizonElDeg - sunElDeg) / sunRadiusDeg;
  if (d <= -1) return 1;
  if (d >= 1) return 0;
  return (Math.acos(d) - d * Math.sqrt(1 - d * d)) / Math.PI;
}

/** Inverse of the disk-fraction function: the d at which exactly `fraction` of the disk shows. */
function diskOffsetForFraction(fraction: number): number {
  if (fraction <= 0) return 1;
  if (fraction >= 1) return -1;
  if (fraction === 0.5) return 0;
  let lo = -1, hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const f = (Math.acos(mid) - mid * Math.sqrt(1 - mid * mid)) / Math.PI;
    if (f > fraction) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Signed margins in degrees. Positive sun margin: at least the required fraction
 * of the solar disk is above the skyline. Positive earth margin: the Earth's
 * centre is above the skyline by at least the required elevation.
 */
export interface Margins { sunDeg: number; earthDeg: number; sunDiskFraction: number }

export function marginsOf(
  sunAz: number, sunEl: number, sunRadius: number, earthAz: number, earthEl: number,
  profile: HorizonProfile, thresholds: Thresholds, diskOffset = diskOffsetForFraction(thresholds.sunMinDiskFraction),
): Margins {
  validateProfile(profile); validateThresholds(thresholds);
  if (!Number.isFinite(sunAz) || !Number.isFinite(earthAz) || !Number.isFinite(diskOffset) || Math.abs(diskOffset) > 1)
    throw new RangeError('Azimuths and the disk offset must be finite; disk offset must be within [-1, 1].');
  validateElevation(sunEl); validateElevation(earthEl); validateRadius(sunRadius);
  return marginsUnchecked(sunAz, sunEl, sunRadius, earthAz, earthEl, profile, thresholds, diskOffset);
}

function marginsUnchecked(
  sunAz: number, sunEl: number, sunRadius: number, earthAz: number, earthEl: number,
  profile: HorizonProfile, thresholds: Thresholds, diskOffset: number,
): Margins {
  const sunHorizon = horizonAtUnchecked(profile, sunAz);
  return {
    sunDeg: sunEl - sunHorizon + diskOffset * sunRadius,
    earthDeg: earthEl - horizonAtUnchecked(profile, earthAz) - thresholds.earthMinElevationAboveHorizonDeg,
    sunDiskFraction: diskFractionUnchecked(sunEl, sunRadius, sunHorizon),
  };
}

export function sampleMargins(sample: Sample, profile: HorizonProfile, thresholds: Thresholds): Margins {
  return marginsOf(sample.sun.azDeg, sample.sun.elDeg, sample.sun.angularRadiusDeg,
    sample.earth.azDeg, sample.earth.elDeg, profile, thresholds);
}

/** Intervals where a sampled margin is positive; crossings are linearly interpolated. */
function positiveIntervals(times: Float64Array, margin: Float64Array, inclusive = false): Interval[] {
  const out: Interval[] = [];
  const n = times.length;
  const active = (value: number): boolean => inclusive ? value >= 0 : value > 0;
  let start: number | null = active(margin[0]!) ? times[0]! : null;
  for (let i = 1; i < n; i++) {
    const a = margin[i - 1]!, b = margin[i]!;
    if (active(a) === active(b)) continue;
    const t = times[i - 1]! + ((times[i]! - times[i - 1]!) * a) / (a - b);
    if (active(b)) start = t;
    else if (start !== null) { if (t > start) out.push({ startMs: start, endMs: t }); start = null; }
  }
  if (start !== null && times[n - 1]! > start) out.push({ startMs: start, endMs: times[n - 1]! });
  return out;
}

function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i]!.startMs, b[j]!.startMs);
    const e = Math.min(a[i]!.endMs, b[j]!.endMs);
    if (e > s) out.push({ startMs: s, endMs: e });
    if (a[i]!.endMs < b[j]!.endMs) i++; else j++;
  }
  return out;
}

const total = (xs: Interval[]): number => xs.reduce((sum, x) => sum + (x.endMs - x.startMs), 0);
const longest = (xs: Interval[]): number => xs.reduce((m, x) => Math.max(m, x.endMs - x.startMs), 0);

/** Longest stretch of [startMs, endMs] not covered by the given intervals. */
function longestGap(xs: Interval[], startMs: number, endMs: number): number {
  let gap = 0, cursor = startMs;
  for (const x of xs) { gap = Math.max(gap, x.startMs - cursor); cursor = x.endMs; }
  return Math.max(gap, endMs - cursor);
}

export interface SeriesMargins { sun: Float64Array; earth: Float64Array; sunDiskFraction: Float64Array }

function validateSeries(series: Series): void {
  if (!Number.isInteger(series.n) || series.n < 2 || series.n > 100000)
    throw new RangeError('A series must have between 2 and 100000 samples.');
  if (!Number.isFinite(series.startMs) || !Number.isFinite(series.endMs) || series.endMs <= series.startMs ||
      !Number.isFinite(series.stepS) || series.stepS <= 0)
    throw new RangeError('A series must have a positive finite time span and step.');
  const arrays = [series.timesMs, series.sunAz, series.sunEl, series.sunRadius,
    series.earthAz, series.earthEl, series.earthRadius];
  if (arrays.some((a) => a.length !== series.n)) throw new RangeError('Series array lengths must match n.');
  if (series.timesMs[0] !== series.startMs || series.timesMs[series.n - 1] !== series.endMs)
    throw new RangeError('Series timestamps must include both specified endpoints.');
  for (let i = 0; i < series.n; i++) {
    if (arrays.some((a) => !Number.isFinite(a[i]!))) throw new RangeError('Series samples must be finite.');
    if (i > 0 && series.timesMs[i]! <= series.timesMs[i - 1]!)
      throw new RangeError('Series timestamps must increase strictly.');
    validateElevation(series.sunEl[i]!); validateElevation(series.earthEl[i]!);
    validateRadius(series.sunRadius[i]!); validateRadius(series.earthRadius[i]!);
  }
}

export function seriesMargins(series: Series, profile: HorizonProfile, thresholds: Thresholds): SeriesMargins {
  validateSeries(series); validateProfile(profile); validateThresholds(thresholds);
  const n = series.n;
  const out: SeriesMargins = { sun: new Float64Array(n), earth: new Float64Array(n), sunDiskFraction: new Float64Array(n) };
  const offset = diskOffsetForFraction(thresholds.sunMinDiskFraction);
  for (let i = 0; i < n; i++) {
    const m = marginsUnchecked(series.sunAz[i]!, series.sunEl[i]!, series.sunRadius[i]!,
      series.earthAz[i]!, series.earthEl[i]!, profile, thresholds, offset);
    out.sun[i] = m.sunDeg; out.earth[i] = m.earthDeg; out.sunDiskFraction[i] = m.sunDiskFraction;
  }
  return out;
}

export function summarize(series: Series, profile: HorizonProfile, thresholds: Thresholds): Summary {
  const m = seriesMargins(series, profile, thresholds);
  const t = series.timesMs;
  const span = series.endMs - series.startMs;
  const sunWindows = positiveIntervals(t, m.sun, thresholds.sunMinDiskFraction > 0);
  const earthWindows = positiveIntervals(t, m.earth, true);
  const bothWindows = intersect(sunWindows, earthWindows);
  let diskIntegral = 0, maxSunEl = -Infinity;
  for (let i = 0; i < series.n; i++) {
    maxSunEl = Math.max(maxSunEl, series.sunEl[i]!);
    if (i > 0) diskIntegral += ((m.sunDiskFraction[i - 1]! + m.sunDiskFraction[i]!) / 2) * (t[i]! - t[i - 1]!);
  }
  return {
    sunlitFraction: total(sunWindows) / span,
    meanSunDiskFraction: diskIntegral / span,
    maxSunElDeg: maxSunEl,
    sunWindows,
    longestSunlitH: longest(sunWindows) / HOUR_MS,
    longestDarkH: longestGap(sunWindows, series.startMs, series.endMs) / HOUR_MS,
    earthVisibleFraction: total(earthWindows) / span,
    earthWindows,
    longestCommGapH: longestGap(earthWindows, series.startMs, series.endMs) / HOUR_MS,
    bothFraction: total(bothWindows) / span,
    bothWindows,
  };
}

/**
 * Time of the next detected rise or set, or null when none is detected in the
 * bounded scan. A bracket is refined to about one second; shorter events can
 * fall between coarse samples, so this is not a one-second accuracy guarantee.
 */
export function nextEvent(
  site: Site, profile: HorizonProfile, thresholds: Thresholds, fromMs: number, kind: EventKind,
  maxSearchDays: number, coarseStepS = 1800,
): number | null {
  validateSite(site); validateTime(fromMs); validateProfile(profile); validateThresholds(thresholds);
  if (!Number.isFinite(maxSearchDays) || !(maxSearchDays > 0)) throw new RangeError('Search span must be finite and positive.');
  if (!Number.isFinite(coarseStepS) || coarseStepS <= 0 || fromMs + coarseStepS * 1000 <= fromMs)
    throw new RangeError('Search step must be finite, positive, and advance the timestamp.');
  const endMs = fromMs + maxSearchDays * DAY_MS;
  validateTime(endMs);
  if (endMs <= fromMs || Math.ceil((endMs - fromMs) / (coarseStepS * 1000)) > 100000)
    throw new RangeError('Search must advance time and use at most 100000 coarse intervals.');
  if (!(['sunrise', 'sunset', 'earthrise', 'earthset'] as string[]).includes(kind))
    throw new RangeError('Unknown rise/set event kind.');
  const offset = diskOffsetForFraction(thresholds.sunMinDiskFraction);
  const sun = kind === 'sunrise' || kind === 'sunset';
  const rising = kind === 'sunrise' || kind === 'earthrise';
  const marginAt = (tMs: number): number => {
    const s = computeSample(site, tMs);
    const m = marginsUnchecked(s.sun.azDeg, s.sun.elDeg, s.sun.angularRadiusDeg, s.earth.azDeg, s.earth.elDeg, profile, thresholds, offset);
    return sun ? m.sunDeg : m.earthDeg;
  };
  const active = (margin: number): boolean => !sun || thresholds.sunMinDiskFraction > 0 ? margin >= 0 : margin > 0;
  let t0 = fromMs, m0 = marginAt(t0);
  let intervals = 0;
  while (t0 < endMs) {
    if (++intervals > 100000) throw new RangeError('Event search exceeded 100000 coarse intervals.');
    const t1 = Math.min(endMs, t0 + coarseStepS * 1000);
    if (!(t1 > t0)) throw new RangeError('Search step no longer advances the timestamp; increase the step.');
    const m1 = marginAt(t1);
    if (rising ? !active(m0) && active(m1) : active(m0) && !active(m1)) {
      let lo = t0, hi = t1;
      while (hi - lo > 1000) {
        const mid = (lo + hi) / 2;
        if (active(marginAt(mid)) === rising) hi = mid; else lo = mid;
      }
      return Math.round((lo + hi) / 2);
    }
    t0 = t1; m0 = m1;
  }
  return null;
}
