// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// The best site-and-date pairs for a mission among the catalogue sites that have
// a real skyline (NASA LOLA 120 m terrain): the planning module run from the
// command line, to check its answers and to print them.
//
// Usage: npx tsx tools/planning/recommend.ts [--from 2027-01-01] [--search-days 365]
//          [--mission-days 14] [--tolerance-h 0] [--mast 2] [--count 10] [--per-site 1]
//          [--sun-fraction 0] [--earth-margin 0] [--no-earth-at-landing] [--json]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { summarize } from '../../engine/src/analysis.ts';
import { buildVectorTable, seriesFromTable } from '../../engine/src/ephemeris.ts';
import { recommend } from '../../engine/src/planning.ts';
import type { Candidate } from '../../engine/src/planning.ts';
import type { Thresholds } from '../../engine/src/types.ts';

interface CatalogueSite {
  id: string; name: string; latDeg: number; lonDeg: number;
  terrain: null | { groundHeightM: number; azStepDeg: number; profiles: Record<string, number[]> };
}

const DAY = 86400000;
const STEP_S = 600;
const root = fileURLToPath(new URL('../../', import.meta.url));

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(`--${name}`);
function value(name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
}
function number(name: string, fallback: number): number {
  const v = Number(value(name, String(fallback)));
  if (!Number.isFinite(v)) throw new RangeError(`--${name} must be a number.`);
  return v;
}

const fromMs = Date.parse(`${value('from', '2027-01-01')}T00:00:00Z`);
if (!Number.isFinite(fromMs)) throw new RangeError('--from must be a date such as 2027-01-01.');
const searchDays = number('search-days', 365), missionDays = number('mission-days', 14), toleranceH = number('tolerance-h', 0);
const mast = value('mast', '2');
const thresholds: Thresholds = { sunMinDiskFraction: number('sun-fraction', 0), earthMinElevationAboveHorizonDeg: number('earth-margin', 0) };

// Data well past the last landing examined, so that long stretches of power are measured and not cut short.
const lookaheadDays = Math.max(missionDays + 2, 120);
const toMs = fromMs + (searchDays + lookaheadDays) * DAY;
if ((toMs - fromMs) / (STEP_S * 1000) + 1 > 100000)
  throw new RangeError('Search and mission together are too long for a ten-minute step: shorten --search-days.');

const started = performance.now();
const catalogue = JSON.parse(readFileSync(`${root}web/public/data/sites.json`, 'utf8')) as { sites: CatalogueSite[] };
const table = buildVectorTable(fromMs, toMs);
const candidates: Candidate[] = [];
for (const site of catalogue.sites) {
  const profile = site.terrain?.profiles[mast];
  if (!site.terrain || !profile) continue;
  const series = seriesFromTable(
    { id: site.id, name: site.name, latDeg: site.latDeg, lonDeg: site.lonDeg, heightM: site.terrain.groundHeightM + Number(mast) },
    table, fromMs, toMs, STEP_S);
  const summary = summarize(series, { azStepDeg: site.terrain.azStepDeg, elDeg: Float32Array.from(profile) }, thresholds);
  candidates.push({ id: site.id, name: site.name, sunWindows: summary.sunWindows, earthWindows: summary.earthWindows, bothWindows: summary.bothWindows });
}
const picks = recommend(candidates, fromMs, toMs, { missionDays, toleranceH, earthAtLanding: !flag('no-earth-at-landing') },
  { searchDays, count: number('count', 10), perCandidate: number('per-site', 1) });
const elapsedMs = performance.now() - started;

if (flag('json')) {
  console.log(JSON.stringify({ fromMs, searchDays, missionDays, toleranceH, mastM: Number(mast), thresholds, candidates: candidates.length, picks }, null, 1));
} else {
  const span = (h: number): string => `${Math.floor(h / 24)} d ${Math.round(h % 24)} h`;
  const pct = (f: number): string => `${Math.round(f * 100)}%`;
  console.log(`Mission of ${missionDays} days, lander survives ${toleranceH} h of darkness, mast ${mast} m; ` +
    `landings from ${new Date(fromMs).toISOString().slice(0, 10)} for ${searchDays} days; ${candidates.length} sites, ` +
    `sampled every ${STEP_S / 60} minutes; computed in ${Math.round(elapsedMs)} ms.\n`);
  console.log('| Rank | Site | Landing (UTC) | Power lasts | Covers the mission | Earth in view | Power and Earth | Longest link gap |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const p of picks)
    console.log(`| ${p.rank} | ${p.candidateName} | ${new Date(p.landingMs).toISOString().slice(0, 16).replace('T', ' ')} | ` +
      `${span(p.powerHours)}${p.openEnded ? ' or more' : ''} | ${p.missionCoverage >= 1 ? 'yes' : `no (${pct(p.missionCoverage)})`} | ` +
      `${pct(p.earthFraction)} | ${pct(p.bothFraction)} | ${span(p.longestLinkGapH)} |`);
}
