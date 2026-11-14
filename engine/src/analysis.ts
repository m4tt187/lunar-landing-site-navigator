// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
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
  const n = profile.elDeg.length;
  if (n < 1 || !(profile.azStepDeg > 0) || Math.abs(n * profile.azStepDeg - 360) > 1e-6)
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
  const el = profile.elDeg;
  const n = el.length;
  if (n === 1) return el[0]!;
  const x = ((((azDeg % 360) + 360) % 360) / profile.azStepDeg) % n;
  const i = Math.floor(x);
  const f = x - i;
  return el[i % n]! * (1 - f) + el[(i + 1) % n]! * f;
}

/**
 * Fraction (0..1) of the solar disk that is above a locally straight skyline.
 * d is the height of the skyline above the disk centre in units of disk radii.
 */
export function sunDiskFractionVisible(sunElDeg: number, sunRadiusDeg: number, horizonElDeg: number): number {
  const d = (horizonElDeg - sunElDeg) / sunRadiusDeg;
  if (d <= -1) return 1;
  if (d >= 1) return 0;
  return (Math.acos(d) - d * Math.sqrt(1 - d * d)) / Math.PI;
}

/** Inverse of the disk-fraction function: the d at which exactly `fraction` of the disk shows. */
function diskOffsetForFraction(fraction: number): number {
  if (fraction <= 0) return 1;
  if (fraction >= 1) return -1;
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
  const sunHorizon = horizonElevationAt(profile, sunAz);
  return {
    sunDeg: sunEl - sunHorizon + diskOffset * sunRadius,
    earthDeg: earthEl - horizonElevationAt(profile, earthAz) - thresholds.earthMinElevationAboveHorizonDeg,
    sunDiskFraction: sunDiskFractionVisible(sunEl, sunRadius, sunHorizon),
  };
}

export function sampleMargins(sample: Sample, profile: HorizonProfile, thresholds: Thresholds): Margins {
  return marginsOf(sample.sun.azDeg, sample.sun.elDeg, sample.sun.angularRadiusDeg,
    sample.earth.azDeg, sample.earth.elDeg, profile, thresholds);
}

/** Intervals where a sampled margin is positive; crossings are linearly interpolated. */
function positiveIntervals(times: Float64Array, margin: Float64Array): Interval[] {
  const out: Interval[] = [];
  const n = times.length;
  let start: number | null = margin[0]! > 0 ? times[0]! : null;
  for (let i = 1; i < n; i++) {
    const a = margin[i - 1]!, b = margin[i]!;
    if ((a > 0) === (b > 0)) continue;
    const t = times[i - 1]! + ((times[i]! - times[i - 1]!) * a) / (a - b);
    if (b > 0) start = t;
    else if (start !== null) { out.push({ startMs: start, endMs: t }); start = null; }
  }
  if (start !== null) out.push({ startMs: start, endMs: times[n - 1]! });
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

export function seriesMargins(series: Series, profile: HorizonProfile, thresholds: Thresholds): SeriesMargins {
  validateProfile(profile); validateThresholds(thresholds);
  const n = series.n;
  const out: SeriesMargins = { sun: new Float64Array(n), earth: new Float64Array(n), sunDiskFraction: new Float64Array(n) };
  const offset = diskOffsetForFraction(thresholds.sunMinDiskFraction);
  for (let i = 0; i < n; i++) {
    const m = marginsOf(series.sunAz[i]!, series.sunEl[i]!, series.sunRadius[i]!,
      series.earthAz[i]!, series.earthEl[i]!, profile, thresholds, offset);
    out.sun[i] = m.sunDeg; out.earth[i] = m.earthDeg; out.sunDiskFraction[i] = m.sunDiskFraction;
  }
  return out;
}

export function summarize(series: Series, profile: HorizonProfile, thresholds: Thresholds): Summary {
  const m = seriesMargins(series, profile, thresholds);
  const t = series.timesMs;
  const span = series.endMs - series.startMs;
  const sunWindows = positiveIntervals(t, m.sun);
  const earthWindows = positiveIntervals(t, m.earth);
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
 * Time of the next rise or set after `fromMs`, to about one second, or null if
 * none happens within `maxSearchDays`. Null does not mean "never".
 */
export function nextEvent(
  site: Site, profile: HorizonProfile, thresholds: Thresholds, fromMs: number, kind: EventKind,
  maxSearchDays: number, coarseStepS = 1800,
): number | null {
  validateSite(site); validateTime(fromMs); validateProfile(profile); validateThresholds(thresholds);
  if (!(maxSearchDays > 0)) throw new RangeError('Search span must be positive.');
  const offset = diskOffsetForFraction(thresholds.sunMinDiskFraction);
  const sun = kind === 'sunrise' || kind === 'sunset';
  const rising = kind === 'sunrise' || kind === 'earthrise';
  const marginAt = (tMs: number): number => {
    const s = computeSample(site, tMs);
    const m = marginsOf(s.sun.azDeg, s.sun.elDeg, s.sun.angularRadiusDeg, s.earth.azDeg, s.earth.elDeg, profile, thresholds, offset);
    return sun ? m.sunDeg : m.earthDeg;
  };
  const endMs = fromMs + maxSearchDays * DAY_MS;
  let t0 = fromMs, m0 = marginAt(t0);
  while (t0 < endMs) {
    const t1 = Math.min(endMs, t0 + coarseStepS * 1000);
    const m1 = marginAt(t1);
    if (rising ? m0 <= 0 && m1 > 0 : m0 > 0 && m1 <= 0) {
      let lo = t0, hi = t1;
      while (hi - lo > 1000) {
        const mid = (lo + hi) / 2;
        if (marginAt(mid) > 0 === rising) hi = mid; else lo = mid;
      }
      return Math.round((lo + hi) / 2);
    }
    t0 = t1; m0 = m1;
  }
  return null;
}
