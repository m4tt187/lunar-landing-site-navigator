// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// Compares this project's terrain + ephemeris chain with two NASA LOLA-team map
// products: average solar illumination and average Earth visibility south of
// 85 S (AVGVISIB_85S_060M_201608 and ..._EARTH, Mazarico et al. 2011 method).
//
// Usage: npx tsx tools/validation/illumination.ts [points]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  computeTerrainHorizon, horizonElevationAt, makePolarDem, moonFixedVectors, sampleFromVectors,
} from '../../engine/src/index.ts';
import type { MoonFixedVectors, PolarDem, Site } from '../../engine/src/index.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const R_M = 1737400;
const POINTS = Number(process.argv[2] ?? 400);
// One full 18.6-year cycle of the lunar orbit's precession, so every Sun/Earth geometry is sampled.
const START = Date.UTC(2010, 0, 1), YEARS = 18.6, STEP_H = 6;

function load(path: string, n: number, scaleM: number, heightScale: number): PolarDem {
  const buf = readFileSync(root + path);
  return makePolarDem(new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2), n, scaleM, heightScale);
}
function nearest(grid: PolarDem, latDeg: number, lonDeg: number): number {
  const r = 2 * R_M * Math.tan(((90 + latDeg) * Math.PI) / 360), c = grid.n / 2 - 0.5;
  const col = Math.round(c + (r * Math.sin((lonDeg * Math.PI) / 180)) / grid.scaleM);
  const row = Math.round(c - (r * Math.cos((lonDeg * Math.PI) / 180)) / grid.scaleM);
  return grid.raw[row * grid.n + col]! * grid.heightScale;
}

const dem = load('data/raw/ldem_75s_120m.img', 7624, 120, 0.5);
const nasaSun = load('data/raw/avgvisib_85s_060m_201608.img', 5058, 60, 0.00004);
const nasaEarth = load('data/raw/avgvisib_85s_060m_201608_earth.img', 5058, 60, 0.00004);

const steps = Math.floor((YEARS * 365.25 * 24) / STEP_H);
const vectors: MoonFixedVectors[] = [];
for (let i = 0; i < steps; i++) vectors.push(moonFixedVectors(START + i * STEP_H * 3600000));

// Deterministic pseudo-random points, uniform over the disc south of about 85.4 S.
let seed = 20261114;
const random = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const rows: { latDeg: number; lonDeg: number; sun: number; nasaSun: number; earth: number; nasaEarth: number }[] = [];
while (rows.length < POINTS) {
  const radiusM = 140000 * Math.sqrt(random()), lonDeg = random() * 360 - 180;
  const latDeg = -90 + (2 * Math.atan(radiusM / (2 * R_M)) * 180) / Math.PI;
  const horizon = computeTerrainHorizon(dem, latDeg, lonDeg, 0);
  const site: Site = { id: 'p', name: 'p', latDeg, lonDeg, heightM: horizon.groundHeightM };
  let sun = 0, earth = 0;
  for (let i = 0; i < steps; i++) {
    const s = sampleFromVectors(site, 0, vectors[i]!);
    if (s.sun.elDeg + s.sun.angularRadiusDeg > horizonElevationAt(horizon.profile, s.sun.azDeg)) sun++;
    if (s.earth.elDeg + s.earth.angularRadiusDeg > horizonElevationAt(horizon.profile, s.earth.azDeg)) earth++;
  }
  rows.push({ latDeg, lonDeg, sun: sun / steps, nasaSun: nearest(nasaSun, latDeg, lonDeg), earth: earth / steps, nasaEarth: nearest(nasaEarth, latDeg, lonDeg) });
}

function stats(ours: number[], nasa: number[]): Record<string, number> {
  const n = ours.length, diff = ours.map((v, i) => v - nasa[i]!);
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  const mo = mean(ours), mn = mean(nasa);
  const cov = mean(ours.map((v, i) => (v - mo) * (nasa[i]! - mn)));
  const so = Math.sqrt(mean(ours.map((v) => (v - mo) ** 2))), sn = Math.sqrt(mean(nasa.map((v) => (v - mn) ** 2)));
  const abs = diff.map(Math.abs).sort((a, b) => a - b);
  const r3 = (v: number): number => Math.round(v * 1000) / 1000;
  return {
    points: n, correlation: r3(cov / (so * sn)), meanDifference: r3(mean(diff)), meanAbsoluteDifference: r3(mean(abs)),
    medianAbsoluteDifference: r3(abs[Math.floor(n / 2)]!), p90AbsoluteDifference: r3(abs[Math.floor(n * 0.9)]!),
    within0p05: r3(abs.filter((v) => v <= 0.05).length / n), within0p10: r3(abs.filter((v) => v <= 0.1).length / n),
  };
}
const report = {
  reference: 'NASA LOLA team, AVGVISIB_85S_060M_201608 and AVGVISIB_85S_060M_201608_EARTH (PDS LRO-L-LOLA-4-GDR-V1.0 extras)',
  method: `${POINTS} pseudo-random surface points south of 85.4 S; skyline from LDEM_75S_120M; ${YEARS} years from 2010-01-01 at ${STEP_H} h steps; a body counts as visible when any part of its disc is above the skyline`,
  sunIllumination: stats(rows.map((r) => r.sun), rows.map((r) => r.nasaSun)),
  earthVisibility: stats(rows.map((r) => r.earth), rows.map((r) => r.nasaEarth)),
};
console.log(JSON.stringify(report, null, 1));
writeFileSync(root + 'docs/validation-illumination.json', JSON.stringify({ ...report, samples: rows.map((r) => [r.latDeg, r.lonDeg, r.sun, r.nasaSun, r.earth, r.nasaEarth].map((v) => Math.round(v * 10000) / 10000)) }) + '\n');
