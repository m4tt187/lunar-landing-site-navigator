// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with OpenAI Codex under the direction of the team.
// Numerical convergence of window contacts on the shipped skylines, not a
// physical validation of sunrise times. Run: npx tsx tools/validation/timing.ts
// Prints JSON; redirect to docs/validation-timing.json to retain the report.
import { readFileSync } from 'node:fs';
import { summarize, sampleMargins } from '../../engine/src/analysis.ts';
import { buildVectorTable, seriesFromTable } from '../../engine/src/ephemeris.ts';
import { computeSample } from '../../engine/src/geometry.ts';
import type { HorizonProfile, Site, Thresholds } from '../../engine/src/types.ts';

interface CatalogueSite {
  id: string; name: string; latDeg: number; lonDeg: number;
  terrain: null | { groundHeightM: number; azStepDeg: number; profiles: Record<string, number[]> };
}
interface ResolvedSite { site: Site; profile: HorizonProfile }
type Body = 'sun' | 'earth';
type Contact = 'startMs' | 'endMs';
interface Match {
  id: string; month: number; body: Body; contact: Contact;
  fineMs: number; coarseMs: number; errorS: number;
  exactIso?: string; exactMs?: number; exactErrorS?: number; refinement?: string;
}
interface Unmatched {
  id: string; month: number; body: Body; contact: Contact;
  fineCount: number; coarseCount: number; unmatchedFine: string[]; unmatchedCoarse: string[];
}

const YEAR = 2027, MONTHS = [3, 6, 9, 12], MAST_M = 2;
const COARSE_S = 600, FINE_S = 60, PAIR_LIMIT_MS = 1200000;
const thresholds: Thresholds = { sunMinDiskFraction: 0, earthMinElevationAboveHorizonDeg: 0 };
const catalogue = JSON.parse(readFileSync(new URL('../../web/public/data/sites.json', import.meta.url), 'utf8')) as { sites: CatalogueSite[] };
const sites: ResolvedSite[] = [];
for (const c of catalogue.sites) {
  const heights = c.terrain?.profiles[String(MAST_M)];
  if (!c.terrain || !heights) continue;
  sites.push({
    site: { id: c.id, name: c.name, latDeg: c.latDeg, lonDeg: c.lonDeg, heightM: c.terrain.groundHeightM + MAST_M },
    profile: { azStepDeg: c.terrain.azStepDeg, elDeg: Float32Array.from(heights) },
  });
}
if (!sites.length) throw new Error('No catalogue skylines for the chosen observer height.');

const matches: Match[] = [], unmatched: Unmatched[] = [];
let fineContacts = 0, coarseContacts = 0;
for (const month of MONTHS) {
  const start = Date.UTC(YEAR, month - 1, 1), end = Date.UTC(YEAR, month, 1);
  const table = buildVectorTable(start, end);
  for (const { site, profile } of sites) {
    const fine = summarize(seriesFromTable(site, table, start, end, FINE_S), profile, thresholds);
    const coarse = summarize(seriesFromTable(site, table, start, end, COARSE_S), profile, thresholds);
    for (const body of ['sun', 'earth'] as const) for (const contact of ['startMs', 'endMs'] as const) {
      const f = fine[`${body}Windows`].map((w) => w[contact]).filter((t) => t > start && t < end);
      const c = coarse[`${body}Windows`].map((w) => w[contact]).filter((t) => t > start && t < end);
      fineContacts += f.length; coarseContacts += c.length;
      // One-to-one closest pairs of the same body and contact kind. Never reuse
      // a coarse contact to conceal the two extra edges of a missed short event.
      const pairs: { i: number; j: number; distance: number }[] = [];
      f.forEach((t, i) => c.forEach((u, j) => {
        const distance = Math.abs(t - u);
        if (distance <= PAIR_LIMIT_MS) pairs.push({ i, j, distance });
      }));
      pairs.sort((a, b) => a.distance - b.distance || a.i - b.i || a.j - b.j);
      const usedFine = new Set<number>(), usedCoarse = new Set<number>();
      for (const { i, j } of pairs) {
        if (usedFine.has(i) || usedCoarse.has(j)) continue;
        usedFine.add(i); usedCoarse.add(j);
        matches.push({ id: site.id, month, body, contact, fineMs: f[i]!, coarseMs: c[j]!, errorS: (c[j]! - f[i]!) / 1000 });
      }
      if (usedFine.size !== f.length || usedCoarse.size !== c.length) unmatched.push({
        id: site.id, month, body, contact, fineCount: f.length, coarseCount: c.length,
        unmatchedFine: f.filter((_, i) => !usedFine.has(i)).map((t) => new Date(t).toISOString()),
        unmatchedCoarse: c.filter((_, i) => !usedCoarse.has(i)).map((t) => new Date(t).toISOString()),
      });
    }
  }
}

matches.sort((a, b) => Math.abs(b.errorS) - Math.abs(a.errorS));
const worst = matches.slice(0, 12);
for (const row of worst) {
  const { site, profile } = sites.find((r) => r.site.id === row.id)!;
  const margin = (tMs: number): number => sampleMargins(computeSample(site, tMs), profile, thresholds)[`${row.body}Deg`];
  let lo = Math.floor(row.fineMs / (FINE_S * 1000)) * FINE_S * 1000, hi = lo + FINE_S * 1000;
  let lower = margin(lo);
  if ((lower > 0) === (margin(hi) > 0)) { row.refinement = 'No sign change inside the fine-sample interval'; continue; }
  while (hi - lo > 100) {
    const mid = (lo + hi) / 2, atMid = margin(mid);
    if ((lower > 0) === (atMid > 0)) { lo = mid; lower = atMid; } else hi = mid;
  }
  row.exactMs = (lo + hi) / 2;
  row.exactIso = new Date(row.exactMs).toISOString();
  row.exactErrorS = (row.coarseMs - row.exactMs) / 1000;
}
const absolute = matches.map((m) => Math.abs(m.errorS)).sort((a, b) => a - b);
const quantile = (p: number): number | null => absolute[Math.min(absolute.length - 1, Math.floor(absolute.length * p))] ?? null;
console.log(JSON.stringify({
  license: 'Apache-2.0', aiAssisted: 'OpenAI Codex under the direction of the team',
  scope: { year: YEAR, months: MONTHS, sites: sites.length, mastM: MAST_M, thresholds, coarseStepS: COARSE_S, fineStepS: FINE_S },
  method: 'Same vector table and shipped skyline at both cadences; one-to-one nearest contacts of the same kind within 20 minutes. Worst 12 refined with exact ephemeris to a 0.1-second bracket. Span endpoints excluded.',
  limitations: 'Numerical convergence within this model, not NASA or physical event validation. One-minute sampling can also miss short events. This sample is not a universal timing bound.',
  fineContacts, coarseContacts, matchedContacts: matches.length,
  medianAbsoluteDifferenceS: quantile(.5), p95AbsoluteDifferenceS: quantile(.95), worst, unmatched,
}, null, 2));
