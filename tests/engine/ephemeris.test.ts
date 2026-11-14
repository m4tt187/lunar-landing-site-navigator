// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// The interpolated vector table against the exact ephemeris: how large the
// interpolation error is, that the series it builds are the series the exact
// path builds, and that the finer sampling it makes affordable finds a short
// darkness that a three-hour step walks over.
import { describe, expect, it } from 'vitest';
import { summarize } from '../../engine/src/analysis.ts';
import {
  DEFAULT_KNOT_STEP_S, buildVectorTable, sampleFromTable, seriesFromTable, tableCovers, vectorsAt,
} from '../../engine/src/ephemeris.ts';
import type { VectorTable } from '../../engine/src/ephemeris.ts';
import {
  MAX_TIME_MS, MIN_TIME_MS, computeSample, computeSeries, moonFixedVectors, sampleFromVectors,
} from '../../engine/src/geometry.ts';
import type { HorizonProfile, Site, Thresholds } from '../../engine/src/types.ts';

const DEG = Math.PI / 180;
const HOUR = 3600000;
const DAY = 86400000;

/** Great-circle angle in degrees between two azimuth/elevation directions (safe for tiny angles). */
function separationDeg(az1: number, el1: number, az2: number, el2: number): number {
  const v = (az: number, el: number): [number, number, number] =>
    [Math.cos(el * DEG) * Math.sin(az * DEG), Math.cos(el * DEG) * Math.cos(az * DEG), Math.sin(el * DEG)];
  const p = v(az1, el1), q = v(az2, el2);
  const cross = Math.hypot(p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]);
  return Math.atan2(cross, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]) / DEG;
}

/** Small deterministic generator, so every run tests the same instants. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}

const SITES: Site[] = [
  { id: 'south-pole', name: 'South pole', latDeg: -90, lonDeg: 0, heightM: 0 },
  { id: 'north-pole', name: 'North pole', latDeg: 90, lonDeg: 0, heightM: 0 },
  { id: 'sub-earth', name: 'Sub-Earth point', latDeg: 0, lonDeg: 0, heightM: 0 },
  { id: 'far-side', name: 'Far side', latDeg: 0, lonDeg: 180, heightM: 5000 },
  { id: 'mid-south', name: 'Mid south', latDeg: -45, lonDeg: 90, heightM: 0 },
  { id: 'ridge', name: 'Polar ridge', latDeg: -89.5, lonDeg: -137, heightM: 1500 },
  { id: 'mid-north', name: 'Mid north', latDeg: 30, lonDeg: -120, heightM: -2000 },
  { id: 'massif', name: 'Polar massif', latDeg: -85, lonDeg: 31, heightM: 5000 },
];

interface Errors { sun: number; earth: number; range: number; radius: number }

/** Largest differences between the table and the exact ephemeris over pseudo-random sites and instants, 2026-2035. */
function measure(knotStepS: number, blocks: number, perBlock: number): Errors {
  const next = generator(20261114);
  const from = Date.UTC(2026, 0, 1), span = Date.UTC(2036, 0, 1) - from - 30 * DAY;
  const worst: Errors = { sun: 0, earth: 0, range: 0, radius: 0 };
  for (let b = 0; b < blocks; b++) {
    const start = from + Math.floor(next() * span);
    const table = buildVectorTable(start, start + 20 * DAY, knotStepS);
    for (let k = 0; k < perBlock; k++) {
      const tMs = start + next() * 20 * DAY;
      const site = SITES[Math.floor(next() * SITES.length)]!;
      const a = sampleFromTable(site, table, tMs), e = computeSample(site, tMs);
      worst.sun = Math.max(worst.sun, separationDeg(a.sun.azDeg, a.sun.elDeg, e.sun.azDeg, e.sun.elDeg));
      worst.earth = Math.max(worst.earth, separationDeg(a.earth.azDeg, a.earth.elDeg, e.earth.azDeg, e.earth.elDeg));
      worst.range = Math.max(worst.range, Math.abs(a.sun.rangeKm / e.sun.rangeKm - 1), Math.abs(a.earth.rangeKm / e.earth.rangeKm - 1));
      worst.radius = Math.max(worst.radius,
        Math.abs(a.sun.angularRadiusDeg / e.sun.angularRadiusDeg - 1), Math.abs(a.earth.angularRadiusDeg / e.earth.angularRadiusDeg - 1));
    }
  }
  return worst;
}

describe('interpolated vector table against the exact ephemeris', () => {
  it('differs by far less than a ten-thousandth of a degree with the default knots (20,000 samples, 2026-2035)', () => {
    const worst = measure(DEFAULT_KNOT_STEP_S, 40, 500);
    console.log(`knots every ${DEFAULT_KNOT_STEP_S} s: Sun ${worst.sun.toExponential(2)} deg, Earth ${worst.earth.toExponential(2)} deg, ` +
      `range ${worst.range.toExponential(2)} (relative), angular radius ${worst.radius.toExponential(2)} (relative)`);
    // Measured: about 1.4e-7 degrees. NASA/JPL Horizons and this engine differ by up to 0.004 degrees.
    expect(worst.sun).toBeLessThan(5e-6);
    expect(worst.earth).toBeLessThan(5e-6);
    expect(worst.range).toBeLessThan(1e-7);
    expect(worst.radius).toBeLessThan(1e-7);
  });

  it('degrades gracefully with sparser knots, and the default has a wide margin', () => {
    const sixHours = measure(21600, 10, 300), twelveHours = measure(43200, 10, 300);
    console.log(`knots every 6 h: Sun ${sixHours.sun.toExponential(2)}, Earth ${sixHours.earth.toExponential(2)} deg; ` +
      `every 12 h: Sun ${twelveHours.sun.toExponential(2)}, Earth ${twelveHours.earth.toExponential(2)} deg`);
    expect(Math.max(sixHours.sun, sixHours.earth)).toBeLessThan(5e-5);
    expect(Math.max(twelveHours.sun, twelveHours.earth)).toBeLessThan(1e-3);
  });

  it('returns the knot values themselves at the knots', () => {
    const table = buildVectorTable(Date.UTC(2027, 2, 1), Date.UTC(2027, 2, 3), 3600);
    for (const i of [0, 1, 7, table.n - 2, table.n - 1]) {
      const tMs = table.startMs + i * table.stepMs;
      const got = vectorsAt(table, tMs), exact = moonFixedVectors(tMs);
      expect(got.sun).toEqual([...exact.sun]);
      expect(got.earth).toEqual([...exact.earth]);
    }
  });

  it('projects exactly as the geometry module does', () => {
    const tMs = Date.UTC(2028, 5, 17, 9), table = buildVectorTable(tMs - DAY, tMs + DAY, 3600);
    for (const site of SITES) {
      const a = sampleFromTable(site, table, tMs), e = sampleFromVectors(site, tMs, moonFixedVectors(tMs));
      for (const body of ['sun', 'earth'] as const) {
        expect(separationDeg(a[body].azDeg, a[body].elDeg, e[body].azDeg, e[body].elDeg)).toBeLessThan(1e-11);
        expect(a[body].angularRadiusDeg).toBeCloseTo(e[body].angularRadiusDeg, 13);
        expect(Math.abs(a[body].rangeKm / e[body].rangeKm - 1)).toBeLessThan(1e-14);
      }
    }
  });
});

describe('series from the table', () => {
  const site = SITES[5]!;
  const start = Date.UTC(2027, 3, 2, 5, 17), end = start + 9.37 * DAY;
  const table = buildVectorTable(start, end);

  it('has the time stamps of computeSeries, both end instants included, for a step that does not divide the span', () => {
    const fast = seriesFromTable(site, table, start, end, 5000), exact = computeSeries(site, start, end, 5000);
    expect(fast.n).toBe(exact.n);
    expect([...fast.timesMs]).toEqual([...exact.timesMs]);
    expect(fast.timesMs[0]).toBe(start);
    expect(fast.timesMs[fast.n - 1]).toBe(end);
    expect(fast.site).toEqual(site);
    expect(fast.site).not.toBe(site);
  });

  it('matches computeSeries in every column', () => {
    const fast = seriesFromTable(site, table, start, end, 1800), exact = computeSeries(site, start, end, 1800);
    let worst = 0;
    for (let i = 0; i < exact.n; i++) {
      worst = Math.max(worst,
        separationDeg(fast.sunAz[i]!, fast.sunEl[i]!, exact.sunAz[i]!, exact.sunEl[i]!),
        separationDeg(fast.earthAz[i]!, fast.earthEl[i]!, exact.earthAz[i]!, exact.earthEl[i]!),
        Math.abs(fast.sunRadius[i]! - exact.sunRadius[i]!), Math.abs(fast.earthRadius[i]! - exact.earthRadius[i]!));
    }
    expect(worst).toBeLessThan(5e-6);
  });

  it('gives the two end instants when the cadence is longer than the span', () => {
    const series = seriesFromTable(site, table, start, start + HOUR, 1e9);
    expect([...series.timesMs]).toEqual([start, start + HOUR]);
    expect(series.stepS).toBe(1e9);
  });

  it('rejects what computeSeries rejects, and spans the table does not cover', () => {
    expect(() => seriesFromTable(site, table, end, start, 600)).toThrow(RangeError);
    expect(() => seriesFromTable(site, table, start, start, 600)).toThrow(RangeError);
    expect(() => seriesFromTable(site, table, start, end, 0)).toThrow(RangeError);
    expect(() => seriesFromTable(site, table, start, end, Number.NaN)).toThrow(RangeError);
    expect(() => seriesFromTable(site, table, start, end, 1)).toThrow(/100000 samples/);
    expect(() => seriesFromTable(site, table, start, start + 1, 1e-9)).toThrow(RangeError);
    expect(() => seriesFromTable({ ...site, latDeg: 91 }, table, start, end, 600)).toThrow(RangeError);
    expect(() => seriesFromTable(site, table, start - 30 * DAY, end, 600)).toThrow(/does not cover/);
    expect(() => seriesFromTable(site, table, start, end + 30 * DAY, 600)).toThrow(/does not cover/);
    expect(() => seriesFromTable(site, table, MIN_TIME_MS - 1, end, 600)).toThrow(RangeError);
  });
});

describe('building and checking a table', () => {
  it('covers the requested span with a knot to spare on each side', () => {
    const from = Date.UTC(2027, 0, 1), to = Date.UTC(2027, 0, 11);
    const table = buildVectorTable(from, to, 3600);
    expect(table.validFromMs).toBe(from - HOUR);
    expect(table.validToMs).toBeGreaterThanOrEqual(to + HOUR);
    expect(table.sun.length).toBe(3 * table.n);
    expect(table.earth.length).toBe(3 * table.n);
    expect(tableCovers(table, from, to)).toBe(true);
    expect(tableCovers(table, from - 2 * HOUR, to)).toBe(false);
    expect(tableCovers(table, from, to + 3 * HOUR)).toBe(false);
    expect(tableCovers(table, to, from)).toBe(false);
  });

  it('holds at least four knots even for a single instant', () => {
    const tMs = Date.UTC(2030, 6, 1);
    const table = buildVectorTable(tMs, tMs);
    expect(table.n).toBe(4);
    const a = sampleFromTable(SITES[0]!, table, tMs), e = computeSample(SITES[0]!, tMs);
    expect(separationDeg(a.sun.azDeg, a.sun.elDeg, e.sun.azDeg, e.sun.elDeg)).toBeLessThan(5e-6);
  });

  it('works at the first and at the last supported instants, where the spare knot is on the inner side', () => {
    const first = buildVectorTable(MIN_TIME_MS, MIN_TIME_MS + DAY);
    expect(first.validFromMs).toBe(MIN_TIME_MS);
    const last = buildVectorTable(MAX_TIME_MS - DAY, MAX_TIME_MS);
    expect(last.validToMs).toBe(MAX_TIME_MS);
    const cases: [VectorTable, number][] = [
      [first, MIN_TIME_MS], [first, MIN_TIME_MS + 0.4 * HOUR], [first, MIN_TIME_MS + 1.3 * HOUR],
      [last, MAX_TIME_MS], [last, MAX_TIME_MS - 0.4 * HOUR], [last, MAX_TIME_MS - 1.3 * HOUR],
    ];
    for (const [table, tMs] of cases) {
      const a = sampleFromTable(SITES[5]!, table, tMs), e = computeSample(SITES[5]!, tMs);
      expect(separationDeg(a.sun.azDeg, a.sun.elDeg, e.sun.azDeg, e.sun.elDeg)).toBeLessThan(5e-6);
      expect(separationDeg(a.earth.azDeg, a.earth.elDeg, e.earth.azDeg, e.earth.elDeg)).toBeLessThan(5e-6);
    }
    const whole = seriesFromTable(SITES[5]!, last, MAX_TIME_MS - DAY, MAX_TIME_MS, 600);
    expect(whole.timesMs[whole.n - 1]).toBe(MAX_TIME_MS);
  });

  it('rejects bad requests and instants outside the table', () => {
    const from = Date.UTC(2027, 0, 1);
    expect(() => buildVectorTable(from, from - 1)).toThrow(RangeError);
    expect(() => buildVectorTable(from, from + DAY, 0)).toThrow(RangeError);
    expect(() => buildVectorTable(from, from + DAY, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => buildVectorTable(MIN_TIME_MS - 1, from)).toThrow(RangeError);
    expect(() => buildVectorTable(from, MAX_TIME_MS + 1)).toThrow(RangeError);
    expect(() => buildVectorTable(from, from + 3 * 365 * DAY, 60)).toThrow(/200000 knots/);
    expect(() => buildVectorTable(from, from + DAY, 1e12)).toThrow(/too long/);
    const table = buildVectorTable(from, from + DAY);
    expect(() => vectorsAt(table, table.validFromMs - 1)).toThrow(RangeError);
    expect(() => vectorsAt(table, table.validToMs + 1)).toThrow(RangeError);
    expect(() => vectorsAt(table, Number.NaN)).toThrow(RangeError);
    expect(() => vectorsAt({ ...table, n: 3 }, from)).toThrow(RangeError);
    expect(() => sampleFromTable({ ...SITES[0]!, heightM: Number.NaN }, table, from)).toThrow(RangeError);
  });
});

describe('what the finer sampling is for', () => {
  it('finds a darkness of about an hour that a three-hour step walks over', () => {
    const site: Site = { id: 'demo', name: 'Polar site', latDeg: -89.5, lonDeg: 0, heightM: 0 };
    const thresholds: Thresholds = { sunMinDiskFraction: 0, earthMinElevationAboveHorizonDeg: 0 };
    // A moment in 2027 when the Sun is well above the horizontal at this site.
    let eventMs = 0;
    for (let tMs = Date.UTC(2027, 0, 1); tMs < Date.UTC(2028, 0, 1); tMs += 6 * HOUR)
      if (computeSample(site, tMs).sun.elDeg > 1.2) { eventMs = tMs + 40 * HOUR; break; }
    expect(eventMs).toBeGreaterThan(0);
    const sunAz = computeSample(site, eventMs).sun.azDeg;
    // A skyline far below the Sun everywhere, except a spike three bins wide in front of it at that moment.
    const profile: HorizonProfile = { azStepDeg: 0.25, elDeg: new Float32Array(1440).fill(-5) };
    const centre = Math.round(sunAz / 0.25);
    for (const offset of [-1, 0, 1]) profile.elDeg[(centre + offset + 1440) % 1440] = 5;

    // Reference: the exact ephemeris every minute around the event.
    const reference = summarize(computeSeries(site, eventMs - 6 * HOUR, eventMs + 6 * HOUR, 60), profile, thresholds);
    expect(reference.longestDarkH).toBeGreaterThan(0.7);
    expect(reference.longestDarkH).toBeLessThan(2.2);

    // Thirty days sampled every three hours, with the samples falling 1.5 h before and after the middle of the spike.
    const start = eventMs - 1.5 * HOUR - 80 * 3 * HOUR, end = start + 30 * DAY;
    const coarse = summarize(computeSeries(site, start, end, 10800), profile, thresholds);
    const table = buildVectorTable(start, end);
    const fine = summarize(seriesFromTable(site, table, start, end, 600), profile, thresholds);
    console.log(`darkness behind the spike: reference ${reference.longestDarkH.toFixed(3)} h, ` +
      `10-minute table ${fine.longestDarkH.toFixed(3)} h, 3-hour sampling ${coarse.longestDarkH.toFixed(3)} h`);
    expect(coarse.longestDarkH).toBe(0);
    expect(Math.abs(fine.longestDarkH - reference.longestDarkH)).toBeLessThan(10 / 60);
    expect(fine.sunWindows.length).toBe(2);
  });
});
