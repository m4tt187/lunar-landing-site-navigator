// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// The Earth in front of the Sun, seen from the Moon:
// - the geometry of the two discs against independent numerical references;
// - NASA's contact times for every lunar eclipse from 2025 to 2030
//   (data/eclipses/nasa-lunar-eclipses.json);
// - what a lander on the Moon saw: Firefly Aerospace's Blue Ghost Mission 1 on
//   14 March 2025;
// - the eclipses inside the mission analysis (margins, windows, summary).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MakeTime } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { marginsOf, sampleMargins, summarize, sunDiskFractionVisible } from '../../engine/src/analysis.ts';
import {
  EARTH_ATMOSPHERE_KM, EARTH_MEAN_RADIUS_FACTOR, MAX_SEPARATION_RATE_DEG_PER_H, earthOffsetFromSun, eclipseMarginDeg, eclipseState,
  eclipsesInSeries, enlargedEarthRadiusDeg, findEclipses, separationDeg, sunCoverAt, sunDiskFractionVisibleWithEarth,
  sunFractionCoveredByEarth, sunMarginWithEarth,
} from '../../engine/src/eclipse.ts';
import { buildVectorTable, seriesFromTable } from '../../engine/src/ephemeris.ts';
import { MOON_RADIUS_KM, computeSample, moonFixedVectors, sampleFromVectors } from '../../engine/src/geometry.ts';
import type { EclipseEvent, HorizonProfile, Site, Thresholds } from '../../engine/src/types.ts';

const DEG = Math.PI / 180;
const MIN = 60000;
const HOUR = 3600000;
const DAY = 86400000;

type Vec3 = [number, number, number];
const unit = (v: readonly number[]): Vec3 => { const l = Math.hypot(v[0]!, v[1]!, v[2]!); return [v[0]! / l, v[1]! / l, v[2]! / l]; };
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** East, north, up components of a direction given by azimuth and elevation. */
const direction = (azDeg: number, elDeg: number): Vec3 =>
  [Math.cos(elDeg * DEG) * Math.sin(azDeg * DEG), Math.cos(elDeg * DEG) * Math.cos(azDeg * DEG), Math.sin(elDeg * DEG)];

/** Small deterministic generator. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}

/**
 * Independent reference for areas: the solar disc (radius a, centred on the
 * origin) cut into 20,000 vertical strips; in each strip the part above the line
 * y = floor and outside the Earth's disc (radius b, centre (ex, ey)) is exact.
 * The module integrates horizontal strips with a different rule.
 */
function visibleFractionByStrips(a: number, floor: number, ex: number, ey: number, b: number): number {
  const strips = 20000, dx = (2 * a) / strips;
  let area = 0;
  for (let k = 0; k < strips; k++) {
    const x = -a + (k + 0.5) * dx;
    const top = Math.sqrt(a * a - x * x), bottom = Math.max(-top, floor);
    if (!(top > bottom)) continue;
    let length = top - bottom;
    if (Math.abs(x - ex) < b) {
      const half = Math.sqrt(b * b - (x - ex) * (x - ex));
      length -= Math.max(0, Math.min(top, ey + half) - Math.max(bottom, ey - half));
    }
    area += length * dx;
  }
  return area / (Math.PI * a * a);
}

/**
 * Every sample of a long span, taken from vector tables a hundred days at a time
 * (one series holds at most 100,000 samples).
 */
function scan(
  site: Site, fromMs: number, toMs: number, stepS: number,
  visit: (tMs: number, separation: number, sunRadius: number, earthRadius: number) => void,
): void {
  const chunkMs = Math.floor((90000 * stepS * 1000) / DAY) * DAY;
  for (let startMs = fromMs; startMs < toMs; startMs += chunkMs) {
    const endMs = Math.min(toMs, startMs + chunkMs);
    const series = seriesFromTable(site, buildVectorTable(startMs, endMs), startMs, endMs, stepS);
    // The first sample of every chunk but the first repeats the last one of the chunk before.
    for (let i = startMs === fromMs ? 0 : 1; i < series.n; i++)
      visit(series.timesMs[i]!, separationDeg(series.sunAz[i]!, series.sunEl[i]!, series.earthAz[i]!, series.earthEl[i]!),
        series.sunRadius[i]!, series.earthRadius[i]!);
  }
}

const SUN_R = 0.2666;      // typical angular radius of the Sun from the Moon, degrees
const EARTH_R = 0.9507;    // typical geometric angular radius of the Earth from the Moon, degrees

describe('two directions in the sky', () => {
  it('measures the angle between them, also when it is tiny', () => {
    expect(separationDeg(0, 0, 90, 0)).toBeCloseTo(90, 12);
    expect(separationDeg(10, 20, 10, 20)).toBe(0);
    expect(separationDeg(0, 90, 123, 0)).toBeCloseTo(90, 12);
    expect(separationDeg(0, 45, 180, 45)).toBeCloseTo(90, 12);
    expect(separationDeg(350, 0, 10, 0)).toBeCloseTo(20, 12);
    // A millionth of a degree apart: the arccosine of a dot product would give zero or noise here.
    expect(separationDeg(40, 30, 40, 30 + 1e-6)).toBeCloseTo(1e-6, 12);
    expect(separationDeg(40, 0, 40 + 1e-6, 0)).toBeCloseTo(1e-6, 12);
    const next = generator(5);
    for (let i = 0; i < 500; i++) {
      const az1 = 360 * next(), el1 = 180 * next() - 90, az2 = 360 * next(), el2 = 180 * next() - 90;
      const p = direction(az1, el1), q = direction(az2, el2);
      const expected = Math.atan2(Math.hypot(...cross(p, q)), dot(p, q)) / DEG;
      expect(separationDeg(az1, el1, az2, el2)).toBeCloseTo(expected, 10);
    }
  });

  it('places the Earth relative to the Sun in the plane of the sky, also near the zenith', () => {
    const next = generator(9);
    for (let i = 0; i < 500; i++) {
      // Elevations up to 89.9 degrees, the Earth within a couple of degrees of the Sun.
      const sunAz = 360 * next(), sunEl = i % 5 === 0 ? 89.9 - next() : 170 * next() - 85;
      const p = direction(sunAz, sunEl);
      const across: Vec3 = [Math.cos(sunAz * DEG), -Math.sin(sunAz * DEG), 0];
      const up: Vec3 = [-Math.sin(sunEl * DEG) * Math.sin(sunAz * DEG), -Math.sin(sunEl * DEG) * Math.cos(sunAz * DEG), Math.cos(sunEl * DEG)];
      // A direction at a known offset from the Sun, built with vectors.
      const angle = 2 * Math.PI * next(), size = 2 * next() * DEG;
      const q: Vec3 = [0, 1, 2].map((k) => Math.cos(size) * p[k]! + Math.sin(size) * (Math.cos(angle) * across[k]! + Math.sin(angle) * up[k]!)) as Vec3;
      const earthEl = Math.asin(q[2]) / DEG, earthAz = Math.atan2(q[0], q[1]) / DEG;
      const offset = earthOffsetFromSun(sunAz, sunEl, earthAz, earthEl);
      expect(offset.separationDeg).toBeCloseTo(size / DEG, 9);
      expect(offset.acrossDeg).toBeCloseTo((size / DEG) * Math.cos(angle), 9);
      expect(offset.upDeg).toBeCloseTo((size / DEG) * Math.sin(angle), 9);
    }
    expect(earthOffsetFromSun(10, 5, 10, 5)).toEqual({ acrossDeg: 0, upDeg: 0, separationDeg: 0 });
    expect(earthOffsetFromSun(10, 5, 10, 6).upDeg).toBeCloseTo(1, 12);
    expect(earthOffsetFromSun(10, 0, 11, 0).acrossDeg).toBeCloseTo(1, 12);
  });

  it('rejects directions that are not numbers or elevations beyond the zenith', () => {
    expect(() => separationDeg(Number.NaN, 0, 0, 0)).toThrow(RangeError);
    expect(() => separationDeg(0, 91, 0, 0)).toThrow(RangeError);
    expect(() => earthOffsetFromSun(0, 0, Number.POSITIVE_INFINITY, 0)).toThrow(RangeError);
    expect(() => earthOffsetFromSun(0, 0, 0, -90.5)).toThrow(RangeError);
  });
});

describe("the Earth's opaque disc", () => {
  it('is the mean Earth at latitude 45 degrees plus a 75 km layer of air (Danjon, as in the NASA canon)', () => {
    expect(EARTH_ATMOSPHERE_KM).toBe(75);
    expect(EARTH_MEAN_RADIUS_FACTOR).toBe(0.998340);
    // NASA writes the combined factor as 1.01, "1 + 1/85 - 1/594" (https://eclipse.gsfc.nasa.gov/LEcat5/shadow.html).
    const factor = EARTH_MEAN_RADIUS_FACTOR + EARTH_ATMOSPHERE_KM / 6378.137;
    expect(factor).toBeCloseTo(1 + 1 / 85 - 1 / 594, 4);
    expect(Math.sin(enlargedEarthRadiusDeg(EARTH_R) * DEG) / Math.sin(EARTH_R * DEG)).toBeCloseTo(factor, 12);
    expect(enlargedEarthRadiusDeg(EARTH_R)).toBeGreaterThan(EARTH_R * 1.0100);
    expect(enlargedEarthRadiusDeg(EARTH_R)).toBeLessThan(EARTH_R * 1.0102);
    expect(() => enlargedEarthRadiusDeg(0)).toThrow(RangeError);
    expect(() => enlargedEarthRadiusDeg(Number.NaN)).toThrow(RangeError);
  });
});

describe('how much of the Sun the Earth covers', () => {
  const b = enlargedEarthRadiusDeg(EARTH_R);

  it('is nothing until the discs touch, everything once the Sun is inside the Earth', () => {
    expect(sunFractionCoveredByEarth(b + SUN_R, SUN_R, EARTH_R)).toBe(0);
    expect(sunFractionCoveredByEarth(b + SUN_R + 1e-9, SUN_R, EARTH_R)).toBe(0);
    expect(sunFractionCoveredByEarth(5, SUN_R, EARTH_R)).toBe(0);
    expect(sunFractionCoveredByEarth(b - SUN_R, SUN_R, EARTH_R)).toBe(1);
    expect(sunFractionCoveredByEarth(0, SUN_R, EARTH_R)).toBe(1);
    // Just inside each tangency: a sliver, without numerical trouble.
    expect(sunFractionCoveredByEarth(b + SUN_R - 1e-9, SUN_R, EARTH_R)).toBeGreaterThanOrEqual(0);
    expect(sunFractionCoveredByEarth(b + SUN_R - 1e-9, SUN_R, EARTH_R)).toBeLessThan(1e-9);
    expect(sunFractionCoveredByEarth(b - SUN_R + 1e-9, SUN_R, EARTH_R)).toBeGreaterThan(1 - 1e-9);
  });

  it('matches an independent strip integration and grows steadily as the discs approach', () => {
    let previous = 0, worst = 0;
    for (let k = 0; k <= 200; k++) {
      const separation = b + SUN_R - (2 * SUN_R * k) / 200;
      const covered = sunFractionCoveredByEarth(separation, SUN_R, EARTH_R);
      expect(covered).toBeGreaterThanOrEqual(previous);
      previous = covered;
      worst = Math.max(worst, Math.abs(covered - (1 - visibleFractionByStrips(SUN_R, -2 * SUN_R, separation, 0, b))));
    }
    expect(worst).toBeLessThan(2e-6);
  });

  it('a disc smaller than the Sun covers at most the ratio of the areas', () => {
    // Not the Earth seen from the Moon, but the formula must hold: radius 0.1 against a Sun of 0.25 (no enlargement to speak of).
    const small = 0.1, covered = sunFractionCoveredByEarth(0, 0.25, small);
    const enlarged = enlargedEarthRadiusDeg(small);
    expect(covered).toBeCloseTo((enlarged * enlarged) / (0.25 * 0.25), 12);
  });

  it('rejects bad input', () => {
    expect(() => sunFractionCoveredByEarth(-1, SUN_R, EARTH_R)).toThrow(RangeError);
    expect(() => sunFractionCoveredByEarth(181, SUN_R, EARTH_R)).toThrow(RangeError);
    expect(() => sunFractionCoveredByEarth(1, 0, EARTH_R)).toThrow(RangeError);
    expect(() => sunFractionCoveredByEarth(1, SUN_R, -1)).toThrow(RangeError);
  });
});

describe('eclipse margin', () => {
  const b = enlargedEarthRadiusDeg(EARTH_R);

  it('is zero at the inner tangency for "any part shows" and at the outer tangency for "the whole disc shows"', () => {
    expect(eclipseMarginDeg(b - SUN_R, SUN_R, EARTH_R, 0)).toBeCloseTo(0, 14);
    expect(eclipseMarginDeg(b + SUN_R, SUN_R, EARTH_R, 1)).toBeCloseTo(0, 14);
    expect(eclipseMarginDeg(b - SUN_R + 0.01, SUN_R, EARTH_R, 0)).toBeCloseTo(0.01, 12);
    expect(eclipseMarginDeg(b + SUN_R - 0.01, SUN_R, EARTH_R, 1)).toBeCloseTo(-0.01, 12);
    expect(eclipseMarginDeg(0, SUN_R, EARTH_R, 0)).toBeLessThan(0);
    expect(eclipseMarginDeg(30, SUN_R, EARTH_R, 1)).toBeGreaterThan(0);
  });

  it('is zero where exactly the required fraction is left uncovered, for fractions in between', () => {
    for (const fraction of [0.01, 0.25, 0.5, 0.75, 0.99]) {
      // Find the zero by bisection on the margin itself, then ask how much is covered there.
      let lo = b - SUN_R, hi = b + SUN_R;
      for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2;
        if (eclipseMarginDeg(mid, SUN_R, EARTH_R, fraction) > 0) hi = mid; else lo = mid;
      }
      expect(1 - sunFractionCoveredByEarth(lo, SUN_R, EARTH_R)).toBeCloseTo(fraction, 9);
    }
  });

  it('rises one degree per degree of separation, without a jump anywhere', () => {
    for (const fraction of [0, 0.3, 0.5, 1]) {
      let previous = eclipseMarginDeg(0, SUN_R, EARTH_R, fraction);
      for (let k = 1; k <= 400; k++) {
        const separation = (2 * k) / 400;
        const margin = eclipseMarginDeg(separation, SUN_R, EARTH_R, fraction);
        expect(margin - previous).toBeCloseTo(2 / 400, 12);
        previous = margin;
      }
    }
  });

  it('never goes negative for a fraction that a small disc cannot cover', () => {
    // A disc of radius 0.1 covers at most 16% of a Sun of radius 0.25: "at least half shows" always holds.
    for (const separation of [0, 0.05, 0.2, 1]) expect(eclipseMarginDeg(separation, 0.25, 0.1, 0.5)).toBeGreaterThan(0);
    // "At least 90% shows" can fail for that disc (it covers up to 16%).
    expect(eclipseMarginDeg(0, 0.25, 0.1, 0.9)).toBeLessThan(0);
  });

  it('rejects bad input', () => {
    expect(() => eclipseMarginDeg(1, SUN_R, EARTH_R, -0.1)).toThrow(RangeError);
    expect(() => eclipseMarginDeg(1, SUN_R, EARTH_R, 1.1)).toThrow(RangeError);
    expect(() => eclipseMarginDeg(1, SUN_R, EARTH_R, Number.NaN)).toThrow(RangeError);
    expect(() => eclipseMarginDeg(Number.NaN, SUN_R, EARTH_R, 0)).toThrow(RangeError);
    expect(() => eclipseMarginDeg(1, 91, EARTH_R, 0)).toThrow(RangeError);
  });
});

describe('the Sun above a skyline and outside the Earth', () => {
  const b = enlargedEarthRadiusDeg(EARTH_R);

  it('is the skyline-only fraction while the Earth is away, and agrees with the analysis module', () => {
    for (const horizon of [-1, -0.2, -0.05, 0, 0.1, 0.25, 1]) {
      const alone = sunDiskFractionVisible(0, SUN_R, horizon);
      expect(sunDiskFractionVisibleWithEarth(0, SUN_R, horizon, 3, 0, EARTH_R)).toBe(alone);
      expect(sunDiskFractionVisibleWithEarth(0, SUN_R, horizon, 0, b + SUN_R, EARTH_R)).toBe(alone);
    }
  });

  it('is what the Earth leaves uncovered when the skyline is far below', () => {
    for (const separation of [0.7, 0.8, 0.9, 1.0, 1.1, 1.2]) {
      const visible = sunDiskFractionVisibleWithEarth(10, SUN_R, 0, separation * 0.6, separation * 0.8, EARTH_R);
      expect(visible).toBeCloseTo(1 - sunFractionCoveredByEarth(separation, SUN_R, EARTH_R), 12);
    }
  });

  it('matches an independent strip integration when the skyline and the Earth both cut the disc (2,000 cases)', () => {
    const next = generator(21);
    let worst = 0, mixed = 0;
    for (let i = 0; i < 2000; i++) {
      const a = 0.26 + 0.015 * next();
      const skyline = (2.2 * next() - 1.1) * a;                    // above the Sun's centre
      const separation = b - a + (2 * a + 0.1) * next() - 0.05;   // around the partial phase
      const angle = 2 * Math.PI * next();
      const ex = separation * Math.cos(angle), ey = separation * Math.sin(angle);
      const got = sunDiskFractionVisibleWithEarth(0, a, skyline, ex, ey, EARTH_R);
      const want = visibleFractionByStrips(a, skyline, ex, ey, b);
      worst = Math.max(worst, Math.abs(got - want));
      if (want > 0.01 && want < 0.99) mixed++;
      expect(got).toBeGreaterThanOrEqual(0);
      expect(got).toBeLessThanOrEqual(1);
    }
    console.log(`visible fraction with skyline and Earth: largest difference from the strip integration ${worst.toExponential(2)} (${mixed} partly visible cases)`);
    expect(worst).toBeLessThan(1e-5);
    expect(mixed).toBeGreaterThan(500);
  });

  it('judges "any part shows" exactly: the Earth can cover just what the skyline leaves', () => {
    const next = generator(33);
    let checked = 0, bothMarginsPositiveButHidden = 0;
    for (let i = 0; i < 4000; i++) {
      const a = 0.26 + 0.015 * next();
      const horizon = (2.4 * next() - 1.2) * a;
      const separation = b - a + (2 * a + 0.2) * next() - 0.1;
      const angle = 2 * Math.PI * next();
      const state = eclipseState(0, 0, a, 0, 0, EARTH_R)!;   // any overlapping state; its offset is replaced below
      state.acrossDeg = separation * Math.cos(angle); state.upDeg = separation * Math.sin(angle); state.separationDeg = separation;
      if (separation >= a + b) continue;
      const skylineMargin = a - horizon;                   // "any part shows" above the skyline alone
      const margin = sunMarginWithEarth(skylineMargin, 0, a, horizon, state, 0);
      const visible = visibleFractionByStrips(a, horizon, state.acrossDeg, state.upDeg, b);
      // Away from the razor's edge, the sign of the margin says whether anything is visible.
      if (Math.abs(margin) < 2e-3) continue;
      checked++;
      expect(margin > 0).toBe(visible > 0);
      if (visible === 0 && skylineMargin > 0 && separation - (b - a) > 0) bothMarginsPositiveButHidden++;
    }
    expect(checked).toBeGreaterThan(2500);
    // The cases that judging the skyline and the Earth one at a time would get wrong.
    expect(bothMarginsPositiveButHidden).toBeGreaterThan(20);
  });

  it('judges "the whole disc shows" and "half shows" with the right sign', () => {
    const next = generator(41);
    for (let i = 0; i < 2000; i++) {
      const a = 0.26 + 0.015 * next();
      const horizon = (2.4 * next() - 1.2) * a;
      const separation = b - a + (2 * a) * next();
      const angle = 2 * Math.PI * next();
      const state = eclipseState(0, 0, a, 0, 0, EARTH_R)!;
      state.acrossDeg = separation * Math.cos(angle); state.upDeg = separation * Math.sin(angle); state.separationDeg = separation;
      const visible = visibleFractionByStrips(a, horizon, state.acrossDeg, state.upDeg, b);
      // The whole disc can never show while the Earth overlaps it.
      expect(sunMarginWithEarth(-a - horizon, 0, a, horizon, state, 1)).toBeLessThan(0);
      const half = sunMarginWithEarth(-horizon, 0, a, horizon, state, 0.5);
      if (Math.abs(visible - 0.5) > 1e-4) expect(half >= 0).toBe(visible >= 0.5);
    }
  });

  it('knows the Earth is near from 1.5 degrees before the discs touch, and never misses that with the quick test', () => {
    const next = generator(55);
    let overlaps = 0, near = 0;
    for (let i = 0; i < 20000; i++) {
      const sunAz = 360 * next(), sunEl = 20 * next() - 10;
      const earthAz = sunAz + 8 * next() - 4, earthEl = Math.max(-90, Math.min(90, sunEl + 6 * next() - 3));
      const state = eclipseState(sunAz, sunEl, SUN_R, earthAz, earthEl, EARTH_R);
      const separation = separationDeg(sunAz, sunEl, earthAz, earthEl);
      expect(state !== null).toBe(separation < SUN_R + b + 1.5);
      if (!state) continue;
      near++;
      expect(state.separationDeg).toBeCloseTo(separation, 12);
      expect(state.earthDiscDeg).toBeCloseTo(b, 12);
      expect(state.coveredFraction).toBeCloseTo(sunFractionCoveredByEarth(separation, SUN_R, EARTH_R), 12);
      expect(state.coveredFraction > 0).toBe(separation < SUN_R + b);
      if (state.coveredFraction > 0) overlaps++;
    }
    expect(near).toBeGreaterThan(overlaps);
    expect(overlaps).toBeGreaterThan(1000);
  });

  it('gives margins that pass through first contact without a jump', () => {
    // The Earth approaching a Sun that stands clear of the skyline: under the "whole disc" rule the margin is
    // the gap between the discs, on both sides of the moment they touch.
    for (const gap of [1.2, 0.4, 0.05, 0, -0.05]) {
      const state = eclipseState(0, 5, SUN_R, 0, 5 + SUN_R + b + gap, EARTH_R)!;
      expect(state).not.toBeNull();
      expect(sunMarginWithEarth(3, 5, SUN_R, 0, state, 1)).toBeCloseTo(gap, 9);
      // "Any part shows": the far side of the Sun is a whole solar diameter further from the Earth than the near side.
      expect(sunMarginWithEarth(3, 5, SUN_R, 0, state, 0)).toBeCloseTo(Math.min(3, 2 * SUN_R + gap), 9);
      // "Half shows" is not affected until the discs overlap.
      if (gap >= 0) expect(sunMarginWithEarth(3, 5, SUN_R, 0, state, 0.5)).toBe(3);
      else expect(sunMarginWithEarth(3, 5, SUN_R, 0, state, 0.5)).toBeGreaterThan(0);
    }
    expect(eclipseState(0, 5, SUN_R, 0, 5 + SUN_R + b + 1.6, EARTH_R)).toBeNull();
  });

  it('rejects bad input', () => {
    expect(() => sunDiskFractionVisibleWithEarth(91, SUN_R, 0, 0, 0, EARTH_R)).toThrow(RangeError);
    expect(() => sunDiskFractionVisibleWithEarth(0, 0, 0, 0, 0, EARTH_R)).toThrow(RangeError);
    expect(() => sunDiskFractionVisibleWithEarth(0, SUN_R, Number.NaN, 0, 0, EARTH_R)).toThrow(RangeError);
    expect(() => sunDiskFractionVisibleWithEarth(0, SUN_R, 0, Number.NaN, 0, EARTH_R)).toThrow(RangeError);
    expect(() => sunDiskFractionVisibleWithEarth(0, SUN_R, 0, 0, 0, 0)).toThrow(RangeError);
  });
});

/* NASA's predictions ------------------------------------------------------------- */

interface NasaEclipse {
  date: string; type: 'total' | 'partial' | 'penumbral'; figureUrl: string; greatestEclipseTd: string; deltaTSeconds: number;
  gamma: number; penumbralMagnitude: number; umbralMagnitude: number;
  durationsMinutes: { penumbral: number; partial: number | null; total: number | null };
  contactsUt: Record<string, string>;
}
const nasa = JSON.parse(readFileSync(fileURLToPath(new URL('../../data/eclipses/nasa-lunar-eclipses.json', import.meta.url)), 'utf8')) as
  { eclipses: NasaEclipse[] };

/**
 * NASA's contacts are those of the Moon's limb with the Earth's shadows. Seen
 * from the Moon, a point is in the penumbra while the Earth covers part of the
 * Sun and in the umbra while it covers all of it. So, over the points of the
 * limb (where the line to the Earth's centre touches the lunar sphere):
 * the smallest outer gap crosses zero at P1 and P4, the smallest inner gap at U1
 * and U4, and the largest inner gap at U2 and U3.
 */
function limbGaps(tMs: number): { minOuter: number; minInner: number; maxInner: number } {
  const vectors = moonFixedVectors(tMs);
  const toEarth = unit(vectors.earth), distanceKm = Math.hypot(...vectors.earth);
  const u = unit(cross(toEarth, Math.abs(toEarth[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), w = cross(toEarth, u);
  const cosine = MOON_RADIUS_KM / distanceKm, sine = Math.sqrt(1 - cosine * cosine);
  let minOuter = Infinity, minInner = Infinity, maxInner = -Infinity;
  for (let k = 0; k < 360; k++) {
    const c = Math.cos(k * DEG), s = Math.sin(k * DEG);
    const normal = [0, 1, 2].map((i) => cosine * toEarth[i]! + sine * (c * u[i]! + s * w[i]!));
    const site: Site = { id: 'limb', name: 'Limb point', latDeg: Math.asin(normal[2]!) / DEG, lonDeg: Math.atan2(normal[1]!, normal[0]!) / DEG, heightM: 0 };
    const sample = sampleFromVectors(site, tMs, vectors);
    const separation = separationDeg(sample.sun.azDeg, sample.sun.elDeg, sample.earth.azDeg, sample.earth.elDeg);
    const inner = eclipseMarginDeg(separation, sample.sun.angularRadiusDeg, sample.earth.angularRadiusDeg, 0);
    const outer = eclipseMarginDeg(separation, sample.sun.angularRadiusDeg, sample.earth.angularRadiusDeg, 1);
    minOuter = Math.min(minOuter, outer); minInner = Math.min(minInner, inner); maxInner = Math.max(maxInner, inner);
  }
  return { minOuter, minInner, maxInner };
}

const CONTACT_GAP: Record<string, (g: ReturnType<typeof limbGaps>) => number> = {
  P1: (g) => g.minOuter, P4: (g) => g.minOuter, U1: (g) => g.minInner, U4: (g) => g.minInner, U2: (g) => g.maxInner, U3: (g) => g.maxInner,
};

/** Instant in [fromMs, toMs] at which a quantity changes sign, to half a second. */
function signChange(f: (tMs: number) => number, fromMs: number, toMs: number): number {
  let lo = fromMs, hi = toMs, atLo = f(lo);
  if (atLo * f(hi) > 0) return Number.NaN;
  while (hi - lo > 500) {
    const mid = (lo + hi) / 2, atMid = f(mid);
    if (atLo * atMid <= 0) hi = mid; else { lo = mid; atLo = atMid; }
  }
  return (lo + hi) / 2;
}

describe("NASA's lunar eclipse predictions, 2025-2030 (Five Millennium Canon of Lunar Eclipses)", () => {
  it('holds every eclipse of the six years, with contacts consistent with the catalogue durations', () => {
    expect(nasa.eclipses.length).toBe(14);
    expect(nasa.eclipses.filter((e) => e.type === 'total').length).toBe(6);
    expect(nasa.eclipses.filter((e) => e.type === 'partial').length).toBe(4);
    expect(nasa.eclipses.filter((e) => e.type === 'penumbral').length).toBe(4);
    for (const e of nasa.eclipses) {
      const minutes = (from: string, to: string): number => (Date.parse(e.contactsUt[to]!) - Date.parse(e.contactsUt[from]!)) / MIN;
      expect(Math.abs(minutes('P1', 'P4') - e.durationsMinutes.penumbral)).toBeLessThan(0.06);
      if (e.durationsMinutes.partial !== null) expect(Math.abs(minutes('U1', 'U4') - e.durationsMinutes.partial)).toBeLessThan(0.06);
      if (e.durationsMinutes.total !== null) expect(Math.abs(minutes('U2', 'U3') - e.durationsMinutes.total)).toBeLessThan(0.06);
      expect(Object.keys(e.contactsUt).length).toBe(e.type === 'total' ? 6 : e.type === 'partial' ? 4 : 2);
    }
  });

  it('uses the same difference between Dynamical and Universal Time as this engine (within a second)', () => {
    for (const e of nasa.eclipses) {
      const time = MakeTime(new Date(Date.parse(`${e.greatestEclipseTd}Z`)));
      expect(Math.abs((time.tt - time.ut) * 86400 - e.deltaTSeconds)).toBeLessThan(1);
    }
  });

  it('reproduces all 60 contact times: within 10 seconds, and within a minute for the eclipse that only grazes the Moon', () => {
    const residuals: number[] = [];
    let worst = 0, worstGrazing = 0;
    for (const e of nasa.eclipses) {
      // 18 July 2027: 0.14% of the Moon's diameter enters the penumbra, for 11.8 minutes. At such a grazing
      // contact a second of time is a hundredth of an arcsecond of depth; the difference found (about 50 s at
      // each end) is 0.7 arcseconds between the limb and the edge of the penumbra.
      const grazing = e.penumbralMagnitude < 0.01;
      const span = grazing ? 4 * MIN : 20 * MIN;
      for (const [name, isoTime] of Object.entries(e.contactsUt)) {
        const predicted = Date.parse(isoTime);
        const found = signChange((tMs) => CONTACT_GAP[name]!(limbGaps(tMs)), predicted - span, predicted + span);
        expect(Number.isNaN(found)).toBe(false);
        const residualS = (found - predicted) / 1000;
        if (grazing) worstGrazing = Math.max(worstGrazing, Math.abs(residualS));
        else { residuals.push(residualS); worst = Math.max(worst, Math.abs(residualS)); }
      }
    }
    const rms = Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length);
    console.log(`NASA contact times: ${residuals.length} contacts of 13 eclipses, largest difference ${worst.toFixed(1)} s, rms ${rms.toFixed(1)} s; ` +
      `grazing eclipse of 2027-07-18: ${worstGrazing.toFixed(0)} s`);
    expect(residuals.length).toBe(58);
    expect(worst).toBeLessThan(10);
    expect(rms).toBeLessThan(5);
    expect(worstGrazing).toBeLessThan(60);
  });

  it('puts greatest eclipse within 5 seconds of NASA, for all 14', () => {
    for (const e of nasa.eclipses) {
      const predictedTd = Date.parse(`${e.greatestEclipseTd}Z`);
      const time = MakeTime(new Date(predictedTd));
      const deltaTMs = (time.tt - time.ut) * 86400000;
      // Greatest eclipse: the Sun and the Earth closest together as seen from the Moon's centre.
      const angle = (tMs: number): number => {
        const v = moonFixedVectors(tMs), s = unit(v.sun), earth = unit(v.earth);
        return Math.atan2(Math.hypot(...cross(s, earth)), dot(s, earth));
      };
      let lo = predictedTd - 30 * MIN, hi = predictedTd + 30 * MIN;
      while (hi - lo > 500) {
        const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
        if (angle(m1) < angle(m2)) hi = m2; else lo = m1;
      }
      expect(Math.abs((lo + hi) / 2 + deltaTMs - predictedTd)).toBeLessThan(5000);
    }
  });
});

/* Eclipses at a site ------------------------------------------------------------- */

const SOUTH_POLE: Site = { id: 'south-pole', name: 'South pole', latDeg: -90, lonDeg: 0, heightM: 0 };
const NORTH_POLE: Site = { id: 'north-pole', name: 'North pole', latDeg: 90, lonDeg: 0, heightM: 0 };

describe('eclipses seen from a site', () => {
  const from = Date.UTC(2025, 0, 1), to = Date.UTC(2031, 0, 1);
  const south = findEclipses(SOUTH_POLE, from, to), north = findEclipses(NORTH_POLE, from, to);
  const nasaOf = (event: EclipseEvent): NasaEclipse | undefined =>
    nasa.eclipses.find((e) => event.startMs >= Date.parse(e.contactsUt.P1!) - 1000 && event.endMs <= Date.parse(e.contactsUt.P4!) + 1000);

  it('are NASA lunar eclipses, every one of them, inside the penumbral contacts', () => {
    expect(south.length).toBe(11);
    expect(north.length).toBe(12);
    for (const event of [...south, ...north]) {
      const e = nasaOf(event);
      expect(e).toBeDefined();
      // A point of the Moon is in total darkness only if the umbra reaches the Moon at all.
      if (event.totalStartMs !== null) {
        expect(e!.umbralMagnitude).toBeGreaterThan(0);
        expect(event.totalStartMs).toBeGreaterThanOrEqual(Date.parse(e!.contactsUt.U1!) - 1000);
        expect(event.totalEndMs!).toBeLessThanOrEqual(Date.parse(e!.contactsUt.U4!) + 1000);
        expect(event.maxCoveredFraction).toBe(1);
      } else expect(event.maxCoveredFraction).toBeLessThan(1);
      expect(event.maxAtMs).toBeGreaterThan(event.startMs);
      expect(event.maxAtMs).toBeLessThan(event.endMs);
    }
  });

  it('between the two poles cover 13 of the 14; the last one touches 0.14% of the Moon', () => {
    const seen = new Set([...south, ...north].map((event) => nasaOf(event)!.date));
    const missed = nasa.eclipses.filter((e) => !seen.has(e.date));
    expect(missed.map((e) => e.date)).toEqual(['2027-07-18']);
    expect(missed[0]!.penumbralMagnitude).toBe(0.0014);
    // The Moon passing north of the shadow's axis (gamma > 0) dips its south into it, and the other way round.
    const penumbralOnly = nasa.eclipses.filter((e) => e.type === 'penumbral' && e.penumbralMagnitude > 0.1);
    for (const e of penumbralOnly) {
      const atSouth = south.some((event) => nasaOf(event)!.date === e.date), atNorth = north.some((event) => nasaOf(event)!.date === e.date);
      expect(atSouth).toBe(e.gamma > 0);
      expect(atNorth).toBe(e.gamma < 0);
    }
  });

  it('match a search of the samples themselves, every two minutes for a year and a half', () => {
    const a = Date.UTC(2025, 0, 1), b = Date.UTC(2026, 5, 1);
    for (const site of [SOUTH_POLE, { id: 'crisium', name: 'Mare Crisium', latDeg: 18.5623, lonDeg: 61.8103, heightM: 0 }]) {
      const exact = findEclipses(site, a, b);
      // Runs of samples with some of the Sun covered.
      const runs: { first: number; last: number; deepest: number }[] = [];
      scan(site, a, b, 120, (tMs, separation, sunRadius, earthRadius) => {
        const covered = separation < 3 ? sunFractionCoveredByEarth(separation, sunRadius, earthRadius) : 0;
        if (covered === 0) return;
        const run = runs[runs.length - 1];
        if (run && tMs - run.last <= 120000) { run.last = tMs; run.deepest = Math.max(run.deepest, covered); }
        else runs.push({ first: tMs, last: tMs, deepest: covered });
      });
      expect(exact.length).toBe(runs.length);
      expect(exact.length).toBeGreaterThanOrEqual(3);
      exact.forEach((event, k) => {
        // The true contacts lie within one sampling step outside the first and last covered samples.
        expect(runs[k]!.first - event.startMs).toBeGreaterThanOrEqual(0);
        expect(runs[k]!.first - event.startMs).toBeLessThan(121000);
        expect(event.endMs - runs[k]!.last).toBeGreaterThanOrEqual(0);
        expect(event.endMs - runs[k]!.last).toBeLessThan(121000);
        expect(event.maxCoveredFraction).toBeGreaterThanOrEqual(runs[k]!.deepest - 1e-9);
        expect(event.maxCoveredFraction - runs[k]!.deepest).toBeLessThan(0.01);
      });
    }
  });

  it('clips an eclipse in progress at the ends of the search, and returns nothing when there is none', () => {
    const whole = south[0]!;
    const middle = Math.round((whole.startMs + whole.endMs) / 2);
    const firstHalf = findEclipses(SOUTH_POLE, whole.startMs - HOUR, middle), secondHalf = findEclipses(SOUTH_POLE, middle, whole.endMs + HOUR);
    expect(firstHalf.length).toBe(1);
    expect(firstHalf[0]!.endMs).toBe(middle);
    expect(Math.abs(firstHalf[0]!.startMs - whole.startMs)).toBeLessThanOrEqual(1000);
    expect(secondHalf.length).toBe(1);
    expect(secondHalf[0]!.startMs).toBe(middle);
    expect(Math.abs(secondHalf[0]!.endMs - whole.endMs)).toBeLessThanOrEqual(1000);
    expect(findEclipses(SOUTH_POLE, whole.endMs + DAY, whole.endMs + 20 * DAY)).toEqual([]);
  });

  it('agrees with the cover computed at single instants', () => {
    for (const event of south.slice(0, 4)) {
      expect(sunCoverAt(SOUTH_POLE, event.startMs - 5000).coveredFraction).toBe(0);
      expect(sunCoverAt(SOUTH_POLE, event.startMs + 5000).coveredFraction).toBeGreaterThan(0);
      expect(sunCoverAt(SOUTH_POLE, event.endMs - 5000).coveredFraction).toBeGreaterThan(0);
      expect(sunCoverAt(SOUTH_POLE, event.endMs + 5000).coveredFraction).toBe(0);
      expect(sunCoverAt(SOUTH_POLE, event.maxAtMs).coveredFraction).toBeCloseTo(event.maxCoveredFraction, 9);
      if (event.totalStartMs !== null) {
        expect(sunCoverAt(SOUTH_POLE, event.totalStartMs - 5000).coveredFraction).toBeLessThan(1);
        expect(sunCoverAt(SOUTH_POLE, event.totalStartMs + 5000).coveredFraction).toBe(1);
        expect(sunCoverAt(SOUTH_POLE, event.totalEndMs! - 5000).coveredFraction).toBe(1);
        expect(sunCoverAt(SOUTH_POLE, event.totalEndMs! + 5000).coveredFraction).toBeLessThan(1);
      }
    }
  });

  it('never sees the gap between the discs change faster than the bound the search relies on', () => {
    // Two years with close perigees, six sites, every ten minutes.
    let fastest = 0;
    for (const [latDeg, lonDeg] of [[-90, 0], [90, 0], [0, 0], [0, 90], [0, -90], [0, 180]] as const) {
      let previous = Number.NaN;
      scan({ id: 'p', name: 'Point', latDeg, lonDeg, heightM: 0 }, Date.UTC(2044, 0, 1), Date.UTC(2046, 0, 1), 600,
        (_tMs, separation, sunRadius, earthRadius) => {
          const gap = separation - (sunRadius + enlargedEarthRadiusDeg(earthRadius));
          if (!Number.isNaN(previous)) fastest = Math.max(fastest, Math.abs(gap - previous) * 6);
          previous = gap;
        });
    }
    console.log(`fastest change of the gap between the discs, 2044-2045: ${fastest.toFixed(4)} degrees per hour (bound ${MAX_SEPARATION_RATE_DEG_PER_H})`);
    expect(fastest).toBeGreaterThan(0.5);
    expect(fastest).toBeLessThan(MAX_SEPARATION_RATE_DEG_PER_H * 0.9);
  });

  it('rejects bad requests', () => {
    expect(() => findEclipses(SOUTH_POLE, to, from)).toThrow(RangeError);
    expect(() => findEclipses(SOUTH_POLE, from, from)).toThrow(RangeError);
    expect(() => findEclipses(SOUTH_POLE, Date.UTC(1990, 0, 1), from)).toThrow(RangeError);
    expect(() => findEclipses({ ...SOUTH_POLE, latDeg: -91 }, from, to)).toThrow(RangeError);
    expect(() => sunCoverAt({ ...SOUTH_POLE, heightM: Number.NaN }, from)).toThrow(RangeError);
  });
});

/* A lander that watched one ------------------------------------------------------- */

describe('Blue Ghost Mission 1 in Mare Crisium, 14 March 2025', () => {
  // Firefly Aerospace, "Blue Ghost Mission 1: Live Updates", https://fireflyspace.com/news/blue-ghost-mission-1-live-updates/
  // - 13 March 2025, the prediction: "The eclipse will last nearly 5 hours starting at 12 am CST through 4:52 am CST
  //   at Firefly's landing site in Mare Crisium and will include approximately 2 hours and 16 minutes of totality,
  //   starting at 1:18 am CST."
  // - 14 March 2025, what the lander photographed: "her first look at the solar eclipse from the Moon around
  //   12:30 am CDT ... as Earth began to block the sun"; "captured around 2:30 am CDT during the totality of the
  //   solar eclipse"; "around 3:30 am CDT, the photo shows the sun about to emerge from totality behind Earth".
  // Time zone: the prediction says CST, the reports say CDT. Daylight time was in force in Texas on that date, so
  // the reports' CDT (UTC-5) is the local time; read as UTC-6 the predicted end (10:52 UTC) would fall after NASA's
  // P4 (10:00:01 UT), when the penumbra has left the whole Moon. All times are therefore taken as UTC-5.
  // Coordinates: LROC, https://www.lroc.asu.edu/images/1407 (data/sites/catalog.json); height not considered.
  const site: Site = { id: 'blue-ghost-1', name: 'Blue Ghost Mission 1', latDeg: 18.5623, lonDeg: 61.8103, heightM: 0 };
  const utc = (hhmm: string): number => Date.parse(`2025-03-14T${hhmm}:00Z`);
  const events = findEclipses(site, utc('00:00'), utc('23:59'));

  it("starts and ends within a minute of the mission's own prediction; totality within three minutes", () => {
    expect(events.length).toBe(1);
    const event = events[0]!;
    const minutes = (ms: number): string => `${ms >= 0 ? '+' : ''}${(ms / MIN).toFixed(1)} min`;
    const totalityMin = (event.totalEndMs! - event.totalStartMs!) / MIN;
    console.log(`Blue Ghost eclipse against Firefly's prediction: start ${minutes(event.startMs - utc('05:00'))}, ` +
      `totality starts ${minutes(event.totalStartMs! - utc('06:18'))}, totality lasts ${totalityMin.toFixed(1)} min (predicted about 136), ` +
      `end ${minutes(event.endMs - utc('09:52'))}`);
    expect(Math.abs(event.startMs - utc('05:00'))).toBeLessThan(1 * MIN);        // "starting at 12 am"
    expect(Math.abs(event.endMs - utc('09:52'))).toBeLessThan(1 * MIN);          // "through 4:52 am"
    expect(event.totalStartMs).not.toBeNull();
    expect(Math.abs(event.totalStartMs! - utc('06:18'))).toBeLessThan(3 * MIN);  // "totality, starting at 1:18 am"
    expect(Math.abs(totalityMin - 136)).toBeLessThan(5);                         // "approximately 2 hours and 16 minutes"
    expect((event.endMs - event.startMs) / HOUR).toBeGreaterThan(4.8);           // "nearly 5 hours"
    expect((event.endMs - event.startMs) / HOUR).toBeLessThan(5);
  });

  it('agrees with what the lander photographed', () => {
    const event = events[0]!;
    // Around 12:30 am CDT: the Earth has begun to block the Sun.
    const first = sunCoverAt(site, utc('05:30')).coveredFraction;
    expect(first).toBeGreaterThan(0.05);
    expect(first).toBeLessThan(0.95);
    // Around 2:30 am CDT: totality.
    expect(sunCoverAt(site, utc('07:30')).coveredFraction).toBe(1);
    // Around 3:30 am CDT: still total, the Sun about to emerge (the "diamond ring").
    expect(sunCoverAt(site, utc('08:30')).coveredFraction).toBe(1);
    expect(event.totalEndMs! - utc('08:30')).toBeGreaterThan(0);
    expect(event.totalEndMs! - utc('08:30')).toBeLessThan(10 * MIN);
  });

  it('falls inside the contacts NASA gives for the whole Moon, late on both sides as a trailing-limb site should', () => {
    const e = nasa.eclipses.find((x) => x.date === '2025-03-14')!, event = events[0]!;
    const contact = (name: string): number => Date.parse(e.contactsUt[name]!);
    expect(event.startMs).toBeGreaterThan(contact('P1'));
    expect(event.totalStartMs!).toBeGreaterThan(contact('U1'));
    expect(event.totalStartMs!).toBeLessThan(contact('U2'));
    expect(event.totalEndMs!).toBeGreaterThan(contact('U3'));
    expect(event.totalEndMs!).toBeLessThan(contact('U4'));
    expect(event.endMs).toBeLessThan(contact('P4'));
    // Mare Crisium is on the limb that follows: it enters the umbra in the last quarter of the ingress.
    expect(contact('U2') - event.totalStartMs!).toBeLessThan((contact('U2') - contact('U1')) / 4);
  });
});

/* Inside the mission analysis ------------------------------------------------------ */

describe('eclipses in the mission analysis', () => {
  // A mast 5 km high near the pole keeps the Sun above the smooth horizon, and the skyline is set far below:
  // whatever darkness appears is the Earth's doing.
  const site: Site = { id: 'tower', name: 'Polar tower', latDeg: -89.5, lonDeg: 0, heightM: 5000 };
  const openSky: HorizonProfile = { azStepDeg: 360, elDeg: new Float32Array([-10]) };
  const rule = (fraction: number): Thresholds => ({ sunMinDiskFraction: fraction, earthMinElevationAboveHorizonDeg: 0 });
  // The total eclipse of 26 June 2029, the deepest of the decade.
  const exact = findEclipses(site, Date.UTC(2029, 5, 25), Date.UTC(2029, 5, 27))[0]!;
  const start = Date.UTC(2029, 5, 25), end = Date.UTC(2029, 5, 27);
  const series = seriesFromTable(site, buildVectorTable(start, end), start, end, 600);

  it('takes the sunlight away for the time the rule says', () => {
    expect(exact.totalStartMs).not.toBeNull();
    const any = summarize(series, openSky, rule(0)), whole = summarize(series, openSky, rule(1)), half = summarize(series, openSky, rule(0.5));
    // "Any part shows": dark during totality only.
    expect(any.sunWindows.length).toBe(2);
    expect(Math.abs(any.sunWindows[0]!.endMs - exact.totalStartMs!)).toBeLessThan(20000);
    expect(Math.abs(any.sunWindows[1]!.startMs - exact.totalEndMs!)).toBeLessThan(20000);
    expect(any.longestDarkH).toBeCloseTo((exact.totalEndMs! - exact.totalStartMs!) / HOUR, 2);
    // "The whole disc shows": dark from first to last contact.
    expect(whole.sunWindows.length).toBe(2);
    expect(Math.abs(whole.sunWindows[0]!.endMs - exact.startMs)).toBeLessThan(20000);
    expect(Math.abs(whole.sunWindows[1]!.startMs - exact.endMs)).toBeLessThan(20000);
    // "Half shows": dark between the two moments when half the disc is covered.
    expect(half.sunWindows.length).toBe(2);
    expect(sunCoverAt(site, half.sunWindows[0]!.endMs).coveredFraction).toBeCloseTo(0.5, 2);
    expect(sunCoverAt(site, half.sunWindows[1]!.startMs).coveredFraction).toBeCloseTo(0.5, 2);
    expect(half.longestDarkH).toBeGreaterThan(any.longestDarkH);
    expect(half.longestDarkH).toBeLessThan(whole.longestDarkH);
    // The Earth is in view all along: it is in front of the Sun.
    expect(any.earthVisibleFraction).toBe(1);
  });

  it('lists the eclipse in the summary, with contacts within a quarter of a minute of the exact search', () => {
    const summary = summarize(series, openSky, rule(0));
    expect(summary.eclipses.length).toBe(1);
    const event = summary.eclipses[0]!;
    expect(Math.abs(event.startMs - exact.startMs)).toBeLessThan(15000);
    expect(Math.abs(event.endMs - exact.endMs)).toBeLessThan(15000);
    expect(Math.abs(event.totalStartMs! - exact.totalStartMs!)).toBeLessThan(15000);
    expect(Math.abs(event.totalEndMs! - exact.totalEndMs!)).toBeLessThan(15000);
    expect(Math.abs(event.maxAtMs - exact.maxAtMs)).toBeLessThan(MIN);
    expect(event.maxCoveredFraction).toBe(1);
    expect(eclipsesInSeries(series)).toEqual(summary.eclipses);
  });

  it('finds the same eclipses from ten-minute samples as the exact search, over a year and a half', () => {
    const a = Date.UTC(2025, 0, 1), b = Date.UTC(2026, 5, 1);
    const table = buildVectorTable(a, b);
    for (const place of [SOUTH_POLE, NORTH_POLE, site]) {
      const fromSamples = eclipsesInSeries(seriesFromTable(place, table, a, b, 600)), searched = findEclipses(place, a, b);
      expect(fromSamples.length).toBe(searched.length);
      fromSamples.forEach((event, k) => {
        const reference = searched[k]!;
        expect(Math.abs(event.startMs - reference.startMs)).toBeLessThan(20000);
        expect(Math.abs(event.endMs - reference.endMs)).toBeLessThan(20000);
        expect(event.totalStartMs === null).toBe(reference.totalStartMs === null);
        if (reference.totalStartMs !== null) {
          expect(Math.abs(event.totalStartMs! - reference.totalStartMs)).toBeLessThan(20000);
          expect(Math.abs(event.totalEndMs! - reference.totalEndMs!)).toBeLessThan(20000);
        }
        expect(Math.abs(event.maxAtMs - reference.maxAtMs)).toBeLessThan(MIN);
        expect(event.maxCoveredFraction).toBeCloseTo(reference.maxCoveredFraction, 3);
      });
    }
    // A series that begins in the middle of an eclipse reports it from its first sample.
    const middle = Math.round((exact.startMs + exact.endMs) / 2 / 600000) * 600000;
    const late = eclipsesInSeries(seriesFromTable(site, buildVectorTable(middle, middle + DAY), middle, middle + DAY, 600));
    expect(late.length).toBe(1);
    expect(late[0]!.startMs).toBe(middle);
  });

  it('reports the covered fraction at an instant, and leaves the skyline-only answer when the Earth is left out', () => {
    const sample = computeSample(site, exact.maxAtMs);
    const during = sampleMargins(sample, openSky, rule(0));
    expect(during.eclipseFraction).toBe(1);
    expect(during.sunDiskFraction).toBe(0);
    expect(during.sunDeg).toBeLessThan(0);
    expect(during.earthDeg).toBeGreaterThan(0);
    const before = sampleMargins(computeSample(site, exact.startMs - HOUR), openSky, rule(0));
    expect(before.eclipseFraction).toBe(0);
    expect(before.sunDiskFraction).toBe(1);
    expect(before.sunDeg).toBeGreaterThan(0);
    // Without the Earth's radius the eclipse is not considered: the Sun is simply above the skyline.
    const skylineOnly = marginsOf(sample.sun.azDeg, sample.sun.elDeg, sample.sun.angularRadiusDeg, sample.earth.azDeg, sample.earth.elDeg,
      openSky, rule(0));
    expect(skylineOnly.sunDeg).toBeGreaterThan(0);
    expect(skylineOnly.eclipseFraction).toBe(0);
    expect(() => marginsOf(0, 0, 0.25, 0, 1, openSky, rule(0), undefined, 0)).toThrow(RangeError);
    expect(() => marginsOf(0, 0, 0.25, 0, 1, openSky, rule(0), undefined, Number.NaN)).toThrow(RangeError);
  });

  it('counts the Sun as hidden when the Earth covers exactly the part that the skyline leaves showing', () => {
    // The skyline hides the lowest part of the Sun; the Earth, just above, covers all the rest. Judged one at a
    // time, each obstruction leaves "some part" showing; together they leave nothing.
    const skyline: HorizonProfile = { azStepDeg: 360, elDeg: new Float32Array([-0.1]) };
    const margins = marginsOf(40, 0, 0.25, 40, 0.85, skyline, rule(0), undefined, 1);
    expect(0 - (-0.1) + 0.25).toBeGreaterThan(0);                                            // skyline alone: some part shows
    expect(eclipseMarginDeg(0.85, 0.25, 1, 0)).toBeGreaterThan(0);                           // Earth alone: some part shows
    expect(margins.sunDeg).toBeLessThan(0);                                                  // together: nothing does
    expect(margins.sunDiskFraction).toBe(0);
    expect(margins.eclipseFraction).toBeGreaterThan(0.5);
    expect(margins.eclipseFraction).toBeLessThan(1);
    // Lower the skyline below the disc and the uncovered bottom of the Sun shows again.
    const lower: HorizonProfile = { azStepDeg: 360, elDeg: new Float32Array([-0.3]) };
    const again = marginsOf(40, 0, 0.25, 40, 0.85, lower, rule(0), undefined, 1);
    expect(again.sunDeg).toBeGreaterThan(0);
    expect(again.sunDiskFraction).toBeGreaterThan(0);
    expect(again.sunDiskFraction).toBeCloseTo(1 - again.eclipseFraction, 9);
  });
});
