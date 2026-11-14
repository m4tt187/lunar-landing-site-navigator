// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
import { describe, expect, it } from 'vitest';
import {
  FLAT_HORIZON, computeSample, computeSeries, horizonElevationAt, nextEvent, sampleMargins,
  summarize, sunDiskFractionVisible,
} from '../../engine/src/index.ts';
import type { HorizonProfile, Site, Thresholds } from '../../engine/src/index.ts';

const T: Thresholds = { sunMinDiskFraction: 0, earthMinElevationAboveHorizonDeg: 0 };
const equator: Site = { id: 'eq', name: 'Equator', latDeg: 0.7, lonDeg: 23.5, heightM: 0 };
const pole: Site = { id: 'sp', name: 'South pole', latDeg: -89.9, lonDeg: 0, heightM: 0 };
const farSide: Site = { id: 'fs', name: 'Far side', latDeg: 0, lonDeg: 180, heightM: 0 };
const start = Date.UTC(2027, 0, 1);
const DAY = 86400000;

describe('horizon profile', () => {
  const profile: HorizonProfile = { azStepDeg: 90, elDeg: new Float32Array([0, 4, 0, -4]) };
  it('interpolates and wraps around 360 degrees', () => {
    expect(horizonElevationAt(profile, 0)).toBeCloseTo(0);
    expect(horizonElevationAt(profile, 45)).toBeCloseTo(2);
    expect(horizonElevationAt(profile, 90)).toBeCloseTo(4);
    expect(horizonElevationAt(profile, 315)).toBeCloseTo(-2);
    expect(horizonElevationAt(profile, 405)).toBeCloseTo(2);
    expect(horizonElevationAt(profile, -45)).toBeCloseTo(-2);
    expect(horizonElevationAt(FLAT_HORIZON, 123)).toBe(0);
  });
});

describe('solar disk fraction', () => {
  it('is 0, 0.5 and 1 at the obvious positions and symmetric', () => {
    expect(sunDiskFractionVisible(-1, 0.27, 0)).toBe(0);
    expect(sunDiskFractionVisible(0, 0.27, 0)).toBeCloseTo(0.5, 12);
    expect(sunDiskFractionVisible(1, 0.27, 0)).toBe(1);
    const a = sunDiskFractionVisible(0.1, 0.27, 0), b = sunDiskFractionVisible(-0.1, 0.27, 0);
    expect(a + b).toBeCloseTo(1, 12);
    expect(a).toBeGreaterThan(0.5);
  });
});

describe('summaries', () => {
  it('equatorial site: about half of a year in sunlight, night of about two weeks', () => {
    const s = summarize(computeSeries(equator, start, start + 365 * DAY, 3600), FLAT_HORIZON, T);
    expect(s.sunlitFraction).toBeGreaterThan(0.47);
    expect(s.sunlitFraction).toBeLessThan(0.53);
    expect(s.longestDarkH).toBeGreaterThan(13.5 * 24);
    expect(s.longestDarkH).toBeLessThan(15.5 * 24);
    expect(s.earthVisibleFraction).toBe(1); // near side: the Earth never sets
    expect(s.longestCommGapH).toBe(0);
    expect(s.bothFraction).toBeCloseTo(s.sunlitFraction, 10);
  });
  it('far side: the Earth is never visible', () => {
    const s = summarize(computeSeries(farSide, start, start + 60 * DAY, 3600), FLAT_HORIZON, T);
    expect(s.earthVisibleFraction).toBe(0);
    expect(s.longestCommGapH).toBeCloseTo(60 * 24, 6);
    expect(s.bothWindows).toHaveLength(0);
  });
  it('near the pole: Sun stays within about two degrees of the horizon; Earth comes and goes', () => {
    const series = computeSeries(pole, start, start + 365 * DAY, 3600);
    const s = summarize(series, FLAT_HORIZON, T);
    expect(s.maxSunElDeg).toBeLessThan(2);
    expect(s.maxSunElDeg).toBeGreaterThan(1);
    expect(s.earthVisibleFraction).toBeGreaterThan(0.35);
    expect(s.earthVisibleFraction).toBeLessThan(0.65);
    expect(s.earthWindows.length).toBeGreaterThan(10);
  });
  it('a skyline raised by 3 degrees removes all sunlight at the pole', () => {
    const wall: HorizonProfile = { azStepDeg: 360, elDeg: new Float32Array([3]) };
    const s = summarize(computeSeries(pole, start, start + 365 * DAY, 3600), wall, T);
    expect(s.sunlitFraction).toBe(0);
    expect(s.longestDarkH).toBeCloseTo(365 * 24, 6);
  });
  it('window totals are consistent', () => {
    const series = computeSeries(pole, start, start + 90 * DAY, 1800);
    const s = summarize(series, FLAT_HORIZON, { sunMinDiskFraction: 0.5, earthMinElevationAboveHorizonDeg: 2 });
    const sum = (xs: { startMs: number; endMs: number }[]): number => xs.reduce((a, x) => a + x.endMs - x.startMs, 0);
    expect(sum(s.sunWindows) / (90 * DAY)).toBeCloseTo(s.sunlitFraction, 12);
    expect(s.bothFraction).toBeLessThanOrEqual(Math.min(s.sunlitFraction, s.earthVisibleFraction) + 1e-12);
    for (const w of s.bothWindows) expect(w.endMs).toBeGreaterThan(w.startMs);
  });
});

describe('next event', () => {
  it('finds a sunset where the margin really changes sign', () => {
    const t = nextEvent(equator, FLAT_HORIZON, T, start, 'sunset', 40);
    expect(t).not.toBeNull();
    const before = sampleMargins(computeSample(equator, t! - 60000), FLAT_HORIZON, T).sunDeg;
    const after = sampleMargins(computeSample(equator, t! + 60000), FLAT_HORIZON, T).sunDeg;
    expect(before).toBeGreaterThan(0);
    expect(after).toBeLessThan(0);
    const rise = nextEvent(equator, FLAT_HORIZON, T, t!, 'sunrise', 40);
    expect((rise! - t!) / DAY).toBeGreaterThan(13.5);
    expect((rise! - t!) / DAY).toBeLessThan(15.5);
  });
  it('returns null when nothing happens in the search span', () => {
    expect(nextEvent(equator, FLAT_HORIZON, T, start, 'earthset', 30)).toBeNull();
    expect(nextEvent(farSide, FLAT_HORIZON, T, start, 'earthrise', 30)).toBeNull();
  });
});

describe('performance', () => {
  it('computes one year at one-hour steps quickly', () => {
    const t0 = performance.now();
    computeSeries(pole, start, start + 365 * DAY, 3600);
    const ms = performance.now() - t0;
    console.log(`one year, 1 h step: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(2000);
  });
});
