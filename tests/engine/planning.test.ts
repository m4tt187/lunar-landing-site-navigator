// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// Planning answers against cases worked by hand and against an independent
// minute-by-minute simulation of a lander that dies when a darkness outlasts
// what it can bridge.
import { describe, expect, it } from 'vitest';
import { landingCalendar, operatingWindow, recommend, topCells } from '../../engine/src/planning.ts';
import type { Candidate, MissionNeeds } from '../../engine/src/planning.ts';
import type { Interval } from '../../engine/src/types.ts';

const MIN = 60000;
const HOUR = 3600000;
const T0 = Date.UTC(2027, 0, 1);

/** Windows given in hours from T0. */
const hours = (...pairs: [number, number][]): Interval[] => pairs.map(([a, b]) => ({ startMs: T0 + a * HOUR, endMs: T0 + b * HOUR }));

/** Small deterministic generator. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}

/** Alternating gaps and windows of whole minutes inside [T0, T0 + spanMin minutes]. */
function randomWindows(next: () => number, spanMin: number, meanMin: number): Interval[] {
  const out: Interval[] = [];
  let cursor = Math.floor(next() * meanMin);
  for (;;) {
    const length = 1 + Math.floor(next() * 2 * meanMin);
    if (cursor + length > spanMin) break;
    out.push({ startMs: T0 + cursor * MIN, endMs: T0 + (cursor + length) * MIN });
    cursor += length + Math.floor(next() * 2 * meanMin);   // a gap of zero makes two windows touch
  }
  return out;
}

const clip = (windows: Interval[], fromMs: number, toMs: number): Interval[] =>
  windows.map((w) => ({ startMs: Math.max(w.startMs, fromMs), endMs: Math.min(w.endMs, toMs) })).filter((w) => w.endMs > w.startMs);

/**
 * Independent reference: walk minute by minute from the landing. The lander is
 * lost when the darkness it is in has lasted longer than the tolerance; the
 * mission is then counted up to the last sunlight. Reaching the end of the data
 * alive means the window is open-ended.
 */
function simulate(sun: Interval[], landingMs: number, endMs: number, toleranceMin: number): { minutes: number; open: boolean } {
  const lit = (tMs: number): boolean => sun.some((w) => w.startMs <= tMs && tMs < w.endMs);
  let lastLight = landingMs, dark = 0;
  for (let tMs = landingMs; tMs < endMs; tMs += MIN) {
    if (lit(tMs)) { dark = 0; lastLight = tMs + MIN; } else if (++dark > toleranceMin) return { minutes: (lastLight - landingMs) / MIN, open: false };
  }
  return { minutes: (endMs - landingMs) / MIN, open: true };
}

describe('operating window from touchdown', () => {
  const end = T0 + 100 * HOUR;

  it('runs until the first darkness longer than the lander can bridge', () => {
    const sun = hours([0, 10], [12, 30], [40, 60]);
    expect(operatingWindow(sun, T0, end, 0)).toEqual({ hours: 10, endMs: T0 + 10 * HOUR, openEnded: false, endedByNightH: 2 });
    expect(operatingWindow(sun, T0, end, 2)).toEqual({ hours: 30, endMs: T0 + 30 * HOUR, openEnded: false, endedByNightH: 10 });
    expect(operatingWindow(sun, T0, end, 10)).toEqual({ hours: 60, endMs: T0 + 60 * HOUR, openEnded: false, endedByNightH: null });
    expect(operatingWindow(sun, T0, end, 40)).toEqual({ hours: 100, endMs: end, openEnded: true, endedByNightH: null });
  });

  it('counts a landing in the dark only when sunrise comes within the tolerance', () => {
    const sun = hours([5, 20]);
    expect(operatingWindow(sun, T0, end, 0).hours).toBe(0);
    expect(operatingWindow(sun, T0, end, 4.9).hours).toBe(0);
    expect(operatingWindow(sun, T0, end, 5).hours).toBe(20);
    expect(operatingWindow(sun, T0, end, 0).endedByNightH).toBe(5);
  });

  it('is open-ended when sunlight lasts to the end of the data, and zero with no sunlight at all', () => {
    expect(operatingWindow(hours([0, 100]), T0, end, 0)).toEqual({ hours: 100, endMs: end, openEnded: true, endedByNightH: null });
    expect(operatingWindow([], T0, end, 0)).toEqual({ hours: 0, endMs: T0, openEnded: false, endedByNightH: null });
    expect(operatingWindow([], T0, end, 100).openEnded).toBe(true);
  });

  it('agrees with a minute-by-minute simulation on 300 random cases', () => {
    const next = generator(7);
    for (let c = 0; c < 300; c++) {
      const spanMin = 600 + Math.floor(next() * 2000), toleranceMin = Math.floor(next() * 120);
      const sun = randomWindows(next, spanMin, 60), dataEnd = T0 + spanMin * MIN;
      const landingMs = T0 + Math.floor(next() * spanMin) * MIN;
      const got = operatingWindow(clip(sun, landingMs, dataEnd), landingMs, dataEnd, toleranceMin / 60);
      const want = simulate(sun, landingMs, dataEnd, toleranceMin);
      expect(got.hours * 60).toBeCloseTo(want.minutes, 6);
      expect(got.openEnded).toBe(want.open);
    }
  });

  it('rejects bad input', () => {
    expect(() => operatingWindow([], T0, T0, 0)).toThrow(RangeError);
    expect(() => operatingWindow([], T0, end, -1)).toThrow(RangeError);
    expect(() => operatingWindow([], T0, end, Number.NaN)).toThrow(RangeError);
    expect(() => operatingWindow(hours([20, 30], [0, 10]), T0, end, 0)).toThrow(/sorted/);
    expect(() => operatingWindow(hours([0, 10], [5, 30]), T0, end, 0)).toThrow(/disjoint/);
    expect(() => operatingWindow(hours([-1, 10]), T0, end, 0)).toThrow(RangeError);
    expect(() => operatingWindow(hours([0, 101]), T0, end, 0)).toThrow(RangeError);
    expect(() => operatingWindow(hours([10, 10]), T0, end, 0)).toThrow(RangeError);
  });
});

describe('landing calendar', () => {
  const needs = (missionDays: number, toleranceH: number, earthAtLanding = true): MissionNeeds => ({ missionDays, toleranceH, earthAtLanding });

  it('gives every landing time the operating window of the lander that lands then (400 random cases)', () => {
    const next = generator(11);
    for (let c = 0; c < 40; c++) {
      const spanMin = 900 + Math.floor(next() * 1500), toleranceMin = c % 4 === 0 ? 0 : Math.floor(next() * 90);
      const sun = randomWindows(next, spanMin, 70), earth = randomWindows(next, spanMin, 110), dataEnd = T0 + spanMin * MIN;
      const calendar = landingCalendar(sun, earth, [], T0, dataEnd, needs(0.2, toleranceMin / 60), { searchDays: 1e6, gridS: 60 });
      expect(calendar.cells).toBe(spanMin);
      for (let k = 0; k < 10; k++) {
        const i = k === 0 ? calendar.cells - 1 : Math.floor(next() * calendar.cells);
        const landingMs = T0 + i * MIN;
        const direct = operatingWindow(clip(sun, landingMs, dataEnd), landingMs, dataEnd, toleranceMin / 60);
        const walked = simulate(sun, landingMs, dataEnd, toleranceMin);
        expect(calendar.powerHours[i]! * 60).toBeCloseTo(direct.hours * 60, 2);
        expect(calendar.powerHours[i]! * 60).toBeCloseTo(walked.minutes, 2);
        expect(calendar.earthAtLanding[i]).toBe(earth.some((w) => w.startMs <= landingMs && landingMs <= w.endMs) ? 1 : 0);
      }
    }
  });

  it('measures Earth contact over the operated part of the mission', () => {
    // Sunlight 0-100 h; Earth 10-30 h and 50-60 h; both where they overlap.
    const sun = hours([0, 100]), earth = hours([10, 30], [50, 60]), both = hours([10, 30], [50, 60]);
    const calendar = landingCalendar(sun, earth, both, T0, T0 + 200 * HOUR, needs(2, 0, false), { searchDays: 5, gridS: 3600, count: 1 });
    // Landing at 0 h, mission 48 h: Earth in view 20 h of 48.
    expect(calendar.powerHours[0]).toBe(100);
    expect(calendar.earthFraction[0]).toBeCloseTo(20 / 48, 6);
    // Landing at 20 h: operated 20-68 h; Earth 20-30 and 50-60 = 20 h of 48.
    expect(calendar.earthFraction[20]).toBeCloseTo(20 / 48, 6);
    // Landing at 90 h: only 10 h of power are left, none with the Earth.
    expect(calendar.powerHours[90]).toBe(10);
    expect(calendar.earthFraction[90]).toBe(0);
    // After the sunlight ends there is no power.
    expect(calendar.powerHours[100]).toBe(0);
    expect(calendar.powerHours[110]).toBe(0);
    const best = calendar.best[0]!;
    // No 48 h hold both Earth windows whole: the most is 28 h (10-30 h and 50-58 h), for landings from 10 h to 12 h.
    // Among those the earliest wins, having the most power.
    expect(best.landingMs).toBe(T0 + 10 * HOUR);
    expect(best.powerHours).toBe(90);
    expect(best.missionCoverage).toBe(1);
    expect(best.earthFraction).toBeCloseTo(28 / 48, 12);
    expect(best.bothFraction).toBeCloseTo(28 / 48, 12);
    expect(best.longestLinkGapH).toBeCloseTo(20, 9);   // 30-50 h
    expect(best.openEnded).toBe(false);
    expect(best.earthAtLanding).toBe(true);
  });

  it('prefers a later landing in the same stretch when it has more Earth and still powers the whole mission', () => {
    // Power 0-200 h; the Earth only from 120 h to 200 h. Mission: 2 days.
    const calendar = landingCalendar(hours([0, 200]), hours([120, 200]), hours([120, 200]), T0, T0 + 400 * HOUR,
      needs(2, 0, false), { searchDays: 10, count: 1 });
    expect(calendar.best[0]!.landingMs).toBe(T0 + 120 * HOUR);
    expect(calendar.best[0]!.earthFraction).toBe(1);
    expect(calendar.best[0]!.missionCoverage).toBe(1);
  });

  it('does not give up power for more Earth: a landing that cannot power the whole mission loses', () => {
    // Power 0-60 h, mission 48 h. The Earth from 40 h: landing at 40 h would see it all the time but have only 20 h.
    const calendar = landingCalendar(hours([0, 60]), hours([40, 60]), hours([40, 60]), T0, T0 + 400 * HOUR,
      needs(2, 0, false), { searchDays: 10, count: 1 });
    const best = calendar.best[0]!;
    expect(best.missionCoverage).toBe(1);
    expect(best.landingMs).toBe(T0 + 12 * HOUR);   // the latest landing that still has 48 h of power: the most Earth among those
    expect(best.earthFraction).toBeCloseTo(20 / 48, 12);
  });

  it('requires the Earth at touchdown unless told otherwise', () => {
    const sun = hours([0, 100]), earth = hours([30, 100]);
    const withEarth = landingCalendar(sun, earth, earth, T0, T0 + 300 * HOUR, needs(1, 0), { searchDays: 10, count: 1 });
    expect(withEarth.best[0]!.landingMs).toBe(T0 + 30 * HOUR);
    expect(withEarth.best[0]!.earthAtLanding).toBe(true);
    const never = landingCalendar(sun, [], [], T0, T0 + 300 * HOUR, needs(1, 0), { searchDays: 10 });
    expect(never.best).toEqual([]);
    const blind = landingCalendar(sun, [], [], T0, T0 + 300 * HOUR, needs(1, 0, false), { searchDays: 10, count: 1 });
    expect(blind.best[0]!.landingMs).toBe(T0);
    expect(blind.best[0]!.earthFraction).toBe(0);
    expect(blind.best[0]!.longestLinkGapH).toBe(24);
  });

  it('bridges short nights, allows a landing shortly before dawn, and returns one option per stretch, best first', () => {
    // Three stretches of sunlight: 10-50 h, 52-90 h (a 2 h night between them), 200-230 h.
    const sun = hours([10, 50], [52, 90], [200, 230]), earth = hours([0, 400]);
    const strict = landingCalendar(sun, earth, sun, T0, T0 + 400 * HOUR, needs(1, 0), { searchDays: 15 });
    expect(strict.best.map((o) => [(o.landingMs - T0) / HOUR, o.powerHours])).toEqual([[10, 40], [52, 38], [200, 30]]);
    const bridging = landingCalendar(sun, earth, sun, T0, T0 + 400 * HOUR, needs(1, 3), { searchDays: 15 });
    // With 3 h of tolerance the first two merge, and a landing may come up to 3 h before dawn.
    expect(bridging.best.map((o) => [(o.landingMs - T0) / HOUR, o.powerHours])).toEqual([[7, 83], [197, 33]]);
    expect(bridging.powerHours[6]).toBe(0);
    expect(bridging.powerHours[7]).toBe(83);
    expect(bridging.powerHours[51]).toBe(39);
    expect(landingCalendar(sun, earth, sun, T0, T0 + 400 * HOUR, needs(1, 0), { searchDays: 15, count: 2 }).best.length).toBe(2);
  });

  it('marks a window that reaches the end of the data as open-ended, and drops landings with less than an hour of power', () => {
    const open = landingCalendar(hours([0, 100]), hours([0, 100]), hours([0, 100]), T0, T0 + 100 * HOUR, needs(10, 0), { searchDays: 2, count: 1 });
    expect(open.best[0]!.openEnded).toBe(true);
    expect(open.best[0]!.missionCoverage).toBeCloseTo(100 / 240, 12);
    const brief = landingCalendar(hours([0, 0.5]), hours([0, 100]), hours([0, 0.5]), T0, T0 + 100 * HOUR, needs(1, 0), { searchDays: 2 });
    expect(brief.best).toEqual([]);
    expect(brief.powerHours[0]).toBe(0.5);
  });

  it('handles a year of hourly landing times at once', () => {
    const next = generator(3);
    const spanMin = 500 * 24 * 60;
    const sun = randomWindows(next, spanMin, 3000), earth = randomWindows(next, spanMin, 9000);
    const calendar = landingCalendar(sun, earth, [], T0, T0 + spanMin * MIN, needs(14, 6), { searchDays: 365 });
    expect(calendar.cells).toBe(8760);
    expect(calendar.best.length).toBeGreaterThan(0);
    for (let i = 1; i < calendar.best.length; i++)
      expect(calendar.best[i - 1]!.missionCoverage).toBeGreaterThanOrEqual(calendar.best[i]!.missionCoverage - 1e-9);
  });

  it('rejects bad input', () => {
    const ok = hours([0, 10]);
    const run = (n: Partial<MissionNeeds>, o: object = {}): unknown =>
      landingCalendar(ok, ok, ok, T0, T0 + 100 * HOUR, { missionDays: 1, toleranceH: 0, ...n }, { searchDays: 1, ...o });
    expect(() => run({ missionDays: 0 })).toThrow(RangeError);
    expect(() => run({ missionDays: Number.NaN })).toThrow(RangeError);
    expect(() => run({ toleranceH: -1 })).toThrow(RangeError);
    expect(() => run({}, { searchDays: 0 })).toThrow(RangeError);
    expect(() => run({}, { gridS: 0 })).toThrow(RangeError);
    expect(() => run({}, { count: 0 })).toThrow(RangeError);
    expect(() => run({}, { count: 1.5 })).toThrow(RangeError);
    expect(() => run({}, { searchDays: 1e6, gridS: 1e-3 })).toThrow(/million/);
    expect(() => landingCalendar(ok, hours([5, 3]), ok, T0, T0 + 100 * HOUR, { missionDays: 1, toleranceH: 0 }, { searchDays: 1 })).toThrow(RangeError);
    expect(() => landingCalendar(ok, ok, ok, T0, T0, { missionDays: 1, toleranceH: 0 }, { searchDays: 1 })).toThrow(RangeError);
  });
});

describe('recommending a site and a date', () => {
  const end = T0 + 1000 * HOUR;
  const site = (id: string, sun: Interval[], earth: Interval[]): Candidate =>
    ({ id, name: id.toUpperCase(), sunWindows: sun, earthWindows: earth, bothWindows: earth });
  const needs: MissionNeeds = { missionDays: 2, toleranceH: 0 };

  it('puts sites that power the whole mission first, then the most Earth, then the most power', () => {
    const candidates = [
      site('short', hours([0, 30]), hours([0, 30])),          // 30 h of power for a 48 h mission
      site('long-blind', hours([0, 300]), hours([0, 20])),    // power, little Earth
      site('long-linked', hours([0, 200]), hours([0, 200])),  // power and Earth
      site('longer-linked', hours([0, 250]), hours([0, 250])),
    ];
    const got = recommend(candidates, T0, end, needs, { searchDays: 20 });
    expect(got.map((r) => r.candidateId)).toEqual(['longer-linked', 'long-linked', 'long-blind', 'short']);
    expect(got.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(got[0]!.candidateName).toBe('LONGER-LINKED');
    expect(got[3]!.missionCoverage).toBeCloseTo(30 / 48, 12);
  });

  it('limits the options per site, the total, and breaks exact ties by the order given', () => {
    const twoStretches = site('two', hours([0, 100], [300, 420]), hours([0, 1000]));
    const one = site('one', hours([0, 100]), hours([0, 1000]));
    expect(recommend([twoStretches, one], T0, end, needs, { searchDays: 30 }).map((r) => r.candidateId)).toEqual(['two', 'one']);
    const both = recommend([twoStretches, one], T0, end, needs, { searchDays: 30, perCandidate: 2 });
    expect(both.map((r) => [r.candidateId, (r.landingMs - T0) / HOUR])).toEqual([['two', 300], ['two', 0], ['one', 0]]);
    expect(recommend([twoStretches, one], T0, end, needs, { searchDays: 30, perCandidate: 2, count: 1 }).length).toBe(1);
    expect(recommend([one, { ...one, id: 'twin' }], T0, end, needs, { searchDays: 30 }).map((r) => r.candidateId)).toEqual(['one', 'twin']);
    expect(recommend([], T0, end, needs, { searchDays: 30 })).toEqual([]);
    expect(() => recommend([one], T0, end, needs, { searchDays: 30, perCandidate: 0 })).toThrow(RangeError);
    expect(() => recommend([one], T0, end, needs, { searchDays: 30, count: 0 })).toThrow(RangeError);
  });
});

describe('best cells of a map layer', () => {
  it('takes the largest values, keeps them apart, and breaks ties by position', () => {
    //  9 8 1
    //  8 7 1
    //  1 1 9
    const values = [9, 8, 1, 8, 7, 1, 1, 1, 9];
    expect(topCells(values, 3, 3, 0).map((p) => p.index)).toEqual([0, 8, 1]);
    // Kept 1.5 cells apart, the 8s and the 7 are too close to a 9: the third pick is a far corner worth 1.
    expect(topCells(values, 3, 3, 1.5).map((p) => p.index)).toEqual([0, 8, 2]);
    expect(topCells(values, 3, 2, 1.5).map((p) => p.index)).toEqual([0, 8]);
    expect(topCells(values, 3, 5, 1).map((p) => p.index)).toEqual([0, 8, 1, 3, 4]);
    expect(topCells(values, 3, 1, 0)).toEqual([{ index: 0, col: 0, row: 0, value: 9 }]);
    expect(topCells(values, 3, 2, 0)[1]).toEqual({ index: 8, col: 2, row: 2, value: 9 });
    expect(topCells(values, 3, 0, 0)).toEqual([]);
  });

  it('skips cells outside the mask and cells without a number', () => {
    const values = [9, Number.NaN, 5, 4];
    expect(topCells(values, 2, 4, 0, [0, 1, 1, 1]).map((p) => p.index)).toEqual([2, 3]);
    expect(topCells(new Uint16Array([3, 3, 3, 3]), 2, 2, 0).map((p) => p.index)).toEqual([0, 1]);
  });

  it('rejects bad input', () => {
    expect(() => topCells([1, 2, 3], 2, 1, 0)).toThrow(RangeError);
    expect(() => topCells([1, 2, 3, 4], 2, -1, 0)).toThrow(RangeError);
    expect(() => topCells([1, 2, 3, 4], 2, 1, -1)).toThrow(RangeError);
    expect(() => topCells([1, 2, 3, 4], 2, 1, 0, [1, 1])).toThrow(RangeError);
    expect(() => topCells([1, 2, 3, 4], 0, 1, 0)).toThrow(RangeError);
  });
});
