// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// Measures the interpolated vector table (engine/src/ephemeris.ts) against the
// exact ephemeris: for each spacing of the knots, the largest difference in the
// direction of the Sun and of the Earth, and in their range and angular radius,
// at 25,000 pseudo-random sites and instants between 2026 and 2035 (100 tables of
// twenty days, 250 instants in each). The table of docs/engine/ephemeris.md is
// this output.
//
// Usage: npx tsx tools/validation/ephemeris.ts > docs/validation-ephemeris.json
// The speed of this machine is printed to the error stream and is not part of the report.
import { buildVectorTable, sampleFromTable, seriesFromTable } from '../../engine/src/ephemeris.ts';
import { computeSample, computeSeries, moonFixedVectors } from '../../engine/src/geometry.ts';
import type { Site } from '../../engine/src/types.ts';

const DEG = Math.PI / 180, DAY = 86400000;
const BLOCKS = 100, PER_BLOCK = 250, BLOCK_DAYS = 20;
const KNOT_STEPS_S = [1800, 3600, 7200, 21600, 43200];

/** Angle between two directions given by azimuth and elevation, degrees (arctangent form: exact for tiny angles). */
function separationDeg(az1: number, el1: number, az2: number, el2: number): number {
  const vector = (az: number, el: number): number[] => [Math.cos(el * DEG) * Math.sin(az * DEG), Math.cos(el * DEG) * Math.cos(az * DEG), Math.sin(el * DEG)];
  const p = vector(az1, el1), q = vector(az2, el2);
  const cx = p[1]! * q[2]! - p[2]! * q[1]!, cy = p[2]! * q[0]! - p[0]! * q[2]!, cz = p[0]! * q[1]! - p[1]! * q[0]!;
  return Math.atan2(Math.hypot(cx, cy, cz), p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]!) / DEG;
}

const SITES: Site[] = [
  { id: 'south-pole', name: 'South pole', latDeg: -90, lonDeg: 0, heightM: 0 },
  { id: 'north-pole', name: 'North pole', latDeg: 90, lonDeg: 0, heightM: 0 },
  { id: 'sub-earth', name: 'Sub-Earth point', latDeg: 0, lonDeg: 0, heightM: 0 },
  { id: 'far-side', name: 'Far side', latDeg: 0, lonDeg: 180, heightM: 5000 },
  { id: 'mid-south', name: 'Mid southern latitude', latDeg: -45, lonDeg: 90, heightM: 0 },
  { id: 'ridge', name: 'Polar ridge', latDeg: -89.5, lonDeg: -137, heightM: 1500 },
  { id: 'mid-north', name: 'Mid northern latitude', latDeg: 30, lonDeg: -120, heightM: -2000 },
  { id: 'massif', name: 'Polar massif', latDeg: -85, lonDeg: 31, heightM: 5000 },
];

const from = Date.UTC(2026, 0, 1), span = Date.UTC(2036, 0, 1) - from - 30 * DAY;
const rows = KNOT_STEPS_S.map((knotStepS) => {
  // The same sites and instants for every spacing.
  let seed = 12345;
  const next = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let sunDeg = 0, earthDeg = 0, rangeRelative = 0, radiusRelative = 0;
  for (let block = 0; block < BLOCKS; block++) {
    const start = from + Math.floor(next() * span);
    const table = buildVectorTable(start, start + BLOCK_DAYS * DAY, knotStepS);
    for (let k = 0; k < PER_BLOCK; k++) {
      const tMs = start + next() * BLOCK_DAYS * DAY;
      const site = SITES[Math.floor(next() * SITES.length)]!;
      const a = sampleFromTable(site, table, tMs), e = computeSample(site, tMs);
      sunDeg = Math.max(sunDeg, separationDeg(a.sun.azDeg, a.sun.elDeg, e.sun.azDeg, e.sun.elDeg));
      earthDeg = Math.max(earthDeg, separationDeg(a.earth.azDeg, a.earth.elDeg, e.earth.azDeg, e.earth.elDeg));
      rangeRelative = Math.max(rangeRelative, Math.abs(a.sun.rangeKm / e.sun.rangeKm - 1), Math.abs(a.earth.rangeKm / e.earth.rangeKm - 1));
      radiusRelative = Math.max(radiusRelative,
        Math.abs(a.sun.angularRadiusDeg / e.sun.angularRadiusDeg - 1), Math.abs(a.earth.angularRadiusDeg / e.earth.angularRadiusDeg - 1));
    }
  }
  return { knotStepS, largestSunErrorDeg: sunDeg, largestEarthErrorDeg: earthDeg, largestRangeErrorRelative: rangeRelative, largestAngularRadiusErrorRelative: radiusRelative };
});

console.log(JSON.stringify({
  license: 'Apache-2.0', aiAssisted: 'Anthropic Claude under the direction of the team',
  scope: { years: '2026-2035', tables: BLOCKS, tableDays: BLOCK_DAYS, instantsPerTable: PER_BLOCK, cases: BLOCKS * PER_BLOCK, sites: SITES },
  method: 'Direction, range and angular radius of the Sun and of the Earth from the interpolated table (four-point Lagrange between exact knots) against the exact ephemeris at the same site and instant; the largest difference for each spacing of the knots.',
  limitations: 'Numerical agreement between two ways of evaluating the same ephemeris, not a validation of the ephemeris itself (for that, see the comparison with NASA/JPL Horizons).',
  rows,
}, null, 2));

// Speed of this machine, for the reader of the terminal only.
const year = [Date.UTC(2027, 0, 1), Date.UTC(2028, 0, 1)] as const;
let t = performance.now();
for (let i = 0; i < 2000; i++) moonFixedVectors(from + i * 3600000);
console.error(`exact ephemeris: ${((performance.now() - t) / 2000).toFixed(3)} ms per call`);
t = performance.now();
const table = buildVectorTable(year[0], year[1]);
console.error(`table for one year, knots every 2 h: ${table.n} knots in ${(performance.now() - t).toFixed(0)} ms`);
t = performance.now();
const series = seriesFromTable(SITES[5]!, table, year[0], year[1], 600);
console.error(`one site, one year, every 10 minutes: ${series.n} samples in ${(performance.now() - t).toFixed(1)} ms`);
t = performance.now();
const exact = computeSeries(SITES[5]!, year[0], year[1], 10800);
console.error(`one site, one year, every 3 hours, exact: ${exact.n} samples in ${(performance.now() - t).toFixed(0)} ms`);
