// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// The planning layer of the application on the real site data: it must give
// what the engine's planning module gives for the same windows, and what the
// command-line tool prints (docs/engine/planning.md).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { landingCalendar, summarize } from '../../engine/src/index.ts';
import { computeSeries } from '../../engine/src/geometry.ts';
import { analyze } from './compute.ts';
import type { AppData } from './data.ts';
import { calendarOf, eclipsesOf, findBest, lookaheadDays, operatingWindowOf, planningStepS, rankableSites, searchEndMs } from './planner.ts';
import type { MissionRequest } from './planner.ts';

const HOUR = 3600000, DAY = 86400000;
const read = (file: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../public/data/${file}`, import.meta.url)), 'utf8'));
const catalogue = read('sites.json') as { sites: AppData['sites']; mastHeightsM: number[] };
const app: AppData = { sites: catalogue.sites, mastHeightsM: catalogue.mastHeightsM, terrain: read('terrain.json') as AppData['terrain'] };
const thresholds = { sunMinDiskFraction: 0, earthMinElevationAboveHorizonDeg: 0 };
const request: MissionRequest = { missionDays: 14, toleranceH: 0, mastM: 2, fromMs: Date.UTC(2027, 0, 1), searchDays: 365, thresholds };

describe('planning layer of the application', () => {
  it('ranks the sites that have a real skyline', () => {
    const sites = rankableSites(app, 2);
    expect(sites.length).toBe(25);
    expect(sites.every((s) => s.latDeg <= -80)).toBe(true);
    expect(rankableSites(app, 3)).toEqual([]);
  });

  it('finds the best sites and dates of 2027 for a 14-day mission, as the command-line tool does', async () => {
    const progress: number[] = [];
    const best = await findBest(app, request, { count: 6, onProgress: (done) => { progress.push(done); } });
    expect(progress).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(best.map((r) => [r.candidateId, new Date(r.landingMs).toISOString().slice(0, 16)])).toEqual([
      ['sunlit-8', '2027-08-15T06:00'], ['sunlit-3', '2027-08-15T09:00'], ['sunlit-1', '2027-08-15T23:00'],
      ['sunlit-5', '2027-09-11T18:00'], ['sunlit-7', '2027-09-09T09:00'], ['sunlit-2', '2027-09-11T16:00'],
    ]);
    expect(best.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const r of best) { expect(r.missionCoverage).toBe(1); expect(r.earthFraction).toBeCloseTo(1, 6); expect(r.earthAtLanding).toBe(true); }
    // The first three stretches all end at the total eclipse of 12 January 2028.
    for (const r of best.slice(0, 3)) {
      const end = r.landingMs + r.powerHours * HOUR;
      expect(Math.abs(end - Date.UTC(2028, 0, 12, 3, 46))).toBeLessThan(3 * 60000);
    }
  });

  it('puts the ridge near Mons Malapert first for a 90-day mission with a day of tolerance', async () => {
    const best = await findBest(app, { ...request, missionDays: 90, toleranceH: 24 }, { count: 2 });
    expect(best[0]!.candidateId).toBe('sunlit-7');
    expect(new Date(best[0]!.landingMs).toISOString().slice(0, 16)).toBe('2027-09-09T09:00');
    expect(best[0]!.earthFraction).toBeGreaterThan(0.74);
    expect(best[1]!.earthFraction).toBeLessThan(0.65);
  });

  it('can be abandoned', async () => {
    const controller = new AbortController();
    const pending = findBest(app, request, { signal: controller.signal, onProgress: (done) => { if (done === 3) controller.abort(); } });
    expect(await pending).toEqual([]);
  });

  it('gives the operating window and the eclipses of an analysed scenario', () => {
    const scenario = { id: 1, siteId: 'sunlit-8', custom: null, mastM: 2, startMs: Date.UTC(2027, 7, 15, 6) };
    const a = analyze(scenario, app, null, null, 365, thresholds)!;
    const none = operatingWindowOf(a, 0), oneHour = operatingWindowOf(a, 1);
    // Checked with the exact ephemeris (docs/engine/planning.md): sunlight until 12 January 2028 03:45:46, then 46 minutes of eclipse.
    expect(Math.abs(none.endMs - Date.UTC(2028, 0, 12, 3, 45, 46))).toBeLessThan(60000);
    expect(none.openEnded).toBe(false);
    expect(none.endedByNightH! * 60).toBeGreaterThan(44);
    expect(none.endedByNightH! * 60).toBeLessThan(48);
    expect(oneHour.hours).toBeGreaterThan(none.hours + 24 * 10);
    const eclipses = eclipsesOf(a);
    expect(eclipses.map((e) => new Date(e.maxAtMs).toISOString().slice(0, 10))).toEqual(['2027-08-17', '2028-01-12', '2028-07-06']);
    expect(eclipses[1]!.totalStartMs).not.toBeNull();
  });

  it('builds the landing calendar of a scenario from the same windows as an exact computation', () => {
    const scenario = { id: 1, siteId: 'sunlit-7', custom: null, mastM: 2, startMs: Date.UTC(2027, 8, 9, 9) };
    const a = analyze(scenario, app, null, null, 29.53, thresholds)!;
    const short: MissionRequest = { ...request, fromMs: Date.UTC(2027, 8, 1), searchDays: 20, missionDays: 5 };
    const calendar = calendarOf(a, short);
    expect(calendar.cells).toBe(20 * 24);
    // The same calendar from the exact ephemeris sampled every ten minutes.
    const endMs = short.fromMs + (short.searchDays + lookaheadDays(short.missionDays)) * DAY;
    const exact = summarize(computeSeries(a.site, short.fromMs, endMs, 600), a.terrain.profile, thresholds);
    const reference = landingCalendar(exact.sunWindows, exact.earthWindows, exact.bothWindows, short.fromMs, endMs, short, { searchDays: 20 });
    expect(calendar.best.map((o) => o.landingMs)).toEqual(reference.best.map((o) => o.landingMs));
    for (let i = 0; i < calendar.cells; i += 7) {
      expect(calendar.powerHours[i]).toBeCloseTo(reference.powerHours[i]!, 2);
      expect(calendar.earthFraction[i]).toBeCloseTo(reference.earthFraction[i]!, 4);
    }
  });

  it('refuses a search that reaches beyond the dates the ephemeris covers', async () => {
    const late: MissionRequest = { ...request, fromMs: Date.UTC(2050, 5, 1) };
    expect(searchEndMs(late)).toBeGreaterThan(Date.UTC(2051, 0, 1));
    await expect(findBest(app, late)).rejects.toThrow(RangeError);
    const inside: MissionRequest = { ...request, fromMs: Date.UTC(2049, 7, 1), searchDays: 30 };
    expect(searchEndMs(inside)).toBeLessThan(Date.UTC(2051, 0, 1));
    expect((await findBest(app, inside, { count: 1 })).length).toBe(1);
  });

  it('keeps long searches within the sample limit', () => {
    expect(lookaheadDays(14)).toBe(120);
    expect(lookaheadDays(365)).toBe(367);
    expect(planningStepS(485)).toBe(600);
    expect(planningStepS(732)).toBe(1200);
    expect((732 * 86400) / planningStepS(732)).toBeLessThan(100000);
  });
});
