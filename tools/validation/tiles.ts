// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// Measures what the 120 m terrain tiles buy for a site picked on the map.
// For every catalogue site south of the tile cap, three skylines at 2 m are compared:
//   - catalogue: stored in web/public/data/sites.json, computed by tools/terrain/build.ts
//     from the complete NASA LOLA 120 m model (the reference);
//   - composite: what a picked site gets with tiles, 120 m terrain in the 3 x 3 tiles
//     around the site and the shipped 480 m model beyond;
//   - 480 m: what a picked site gets without tiles, the shipped 480 m model alone.
// Then the answers the application gives (share of 2027 with sunlight and with the
// Earth in view) are computed with each skyline.
//
// That part uses only files that are in the repository. When the source file of the
// 120 m model is also present (data/raw, not committed), two more things are measured
// against skylines computed from the complete grid, which have no rounding in them:
// the catalogue sites again, and pseudo-random points over the whole cap, because the
// catalogue sites (peaks and crater centres) are not a fair sample of where people click.
//
// Usage: npx tsx tools/validation/tiles.ts [random points, default 100]
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { summarize } from '../../engine/src/analysis.ts';
import { moonFixedVectors, sampleFromVectors } from '../../engine/src/geometry.ts';
import type { MoonFixedVectors } from '../../engine/src/geometry.ts';
import { computeTerrainHorizon, makePolarDem, polarDemField } from '../../engine/src/terrain.ts';
import type { PolarDem, TerrainHorizon } from '../../engine/src/terrain.ts';
import { addTile, compositeField, createTileStore, decodeTile, tileField, tilesAround } from '../../engine/src/tiles.ts';
import type { TileSetSpec } from '../../engine/src/tiles.ts';
import type { HorizonProfile, Series, Site, Thresholds } from '../../engine/src/types.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const DATA = root + 'web/public/data/';
const TILES = DATA + 'tiles/120m/';
const FULL_GRID = 'data/raw/ldem_75s_120m.img';
const R_M = 1737400;
const MAST_M = 2;
// The same request the application makes for a picked site.
const SKYLINE = { azStepDeg: 0.25, maxDistanceKm: 400 };
const THRESHOLDS: Thresholds = { sunMinDiskFraction: 0, earthMinElevationAboveHorizonDeg: 0 };
const START = Date.UTC(2027, 0, 1), END = Date.UTC(2028, 0, 1), STEP_S = 3600;
const RANDOM_POINTS = Number(process.argv[2] ?? 100);
if (!Number.isInteger(RANDOM_POINTS) || RANDOM_POINTS < 0) throw new Error('The number of random points must be a non-negative integer.');

interface TileIndex extends TileSetSpec {
  sourceSha256: string; encoding: string; capLatDeg: number; tiles: [number, number][]; totalBytes: number;
}
interface CatalogueSite {
  id: string; name: string; latDeg: number; lonDeg: number;
  terrain: { groundHeightM: number; azStepDeg: number; profiles: Record<string, number[]> } | null;
}
interface Shares { sunlightPct: number; earthPct: number }

const index = JSON.parse(readFileSync(TILES + 'index.json', 'utf8')) as TileIndex;
const meta = JSON.parse(readFileSync(DATA + 'terrain.json', 'utf8')) as { coarse: { file: string; n: number; scaleM: number; heightScale: number } };
const catalogue = JSON.parse(readFileSync(DATA + 'sites.json', 'utf8')) as { sites: CatalogueSite[] };

/** Little-endian Int16 samples, read one by one so the machine's byte order does not matter. */
function samplesOf(bytes: Buffer): Int16Array {
  const raw = new Int16Array(bytes.length / 2);
  for (let i = 0; i < raw.length; i++) raw[i] = bytes.readInt16LE(2 * i);
  return raw;
}

const coarse = makePolarDem(samplesOf(readFileSync(DATA + meta.coarse.file)), meta.coarse.n, meta.coarse.scaleM, meta.coarse.heightScale);

/** The complete 120 m grid when its source file is on this machine, otherwise null. */
function loadFullGrid(): PolarDem | null {
  if (!existsSync(root + FULL_GRID)) return null;
  const bytes = readFileSync(root + FULL_GRID);
  if (createHash('sha256').update(bytes).digest('hex') !== index.sourceSha256) throw new Error(`Unexpected checksum for ${FULL_GRID}`);
  return makePolarDem(samplesOf(bytes), index.n, index.scaleM, index.heightScale);
}
const full = loadFullGrid();

const times: number[] = [];
for (let t = START; t <= END; t += STEP_S * 1000) times.push(t);
const vectors: MoonFixedVectors[] = times.map((t) => moonFixedVectors(t));

/** Shares of the year (percent) with sunlight and with the Earth in view, for one skyline. */
function yearShares(latDeg: number, lonDeg: number, groundM: number, profile: HorizonProfile): Shares {
  // Site height as the application builds it: rounded ground height plus the mast.
  const site: Site = { id: 'site', name: 'site', latDeg, lonDeg, heightM: Math.round(groundM) + MAST_M };
  const n = times.length;
  const series: Series = {
    site, startMs: START, endMs: END, stepS: STEP_S, n, timesMs: Float64Array.from(times),
    sunAz: new Float64Array(n), sunEl: new Float64Array(n), sunRadius: new Float64Array(n),
    earthAz: new Float64Array(n), earthEl: new Float64Array(n), earthRadius: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    const s = sampleFromVectors(site, times[i]!, vectors[i]!);
    series.sunAz[i] = s.sun.azDeg; series.sunEl[i] = s.sun.elDeg; series.sunRadius[i] = s.sun.angularRadiusDeg;
    series.earthAz[i] = s.earth.azDeg; series.earthEl[i] = s.earth.elDeg; series.earthRadius[i] = s.earth.angularRadiusDeg;
  }
  const summary = summarize(series, profile, THRESHOLDS);
  return { sunlightPct: summary.sunlitFraction * 100, earthPct: summary.earthVisibleFraction * 100 };
}

const loadMs: number[] = [], compositeMs: number[] = [], coarseMs: number[] = [];

/** The two skylines a picked site can get: with the tiles around it, and from the 480 m model alone. */
function pickedSite(latDeg: number, lonDeg: number): { composite: TerrainHorizon; alone: TerrainHorizon } {
  let clock = performance.now();
  const store = createTileStore(index);
  for (const { tx, ty } of tilesAround(index, latDeg, lonDeg))
    addTile(store, tx, ty, decodeTile(gunzipSync(readFileSync(`${TILES}t_${ty}_${tx}.i16.gz`)), index.tile, index.encoding));
  loadMs.push(performance.now() - clock);
  clock = performance.now();
  const composite = computeTerrainHorizon(compositeField(tileField(store), polarDemField(coarse)), latDeg, lonDeg, MAST_M, SKYLINE);
  compositeMs.push(performance.now() - clock);
  clock = performance.now();
  const alone = computeTerrainHorizon(coarse, latDeg, lonDeg, MAST_M, SKYLINE);
  coarseMs.push(performance.now() - clock);
  return { composite, alone };
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const round = (v: number, digits: number): number => Math.round(v * 10 ** digits) / 10 ** digits;

/** Absolute difference between two skylines, per azimuth bin, in degrees. */
function absDifference(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  if (a.length !== b.length) throw new Error('Skylines must have the same number of azimuth bins.');
  return Array.from(a, (v, i) => Math.abs(v - b[i]!));
}
function spread(abs: number[]): { mean: number; p95: number; max: number } {
  const sorted = [...abs].sort((x, y) => x - y);
  return { mean: round(mean(sorted), 4), p95: round(sorted[Math.floor(sorted.length * 0.95)]!, 4), max: round(sorted[sorted.length - 1]!, 4) };
}
/** Mean and largest absolute difference of the two answers, in percentage points. */
function answerSpread(pairs: { ours: Shares; reference: Shares }[]): Record<'sunlight' | 'earth', { mean: number; max: number }> {
  const of = (key: keyof Shares): { mean: number; max: number } => {
    const abs = pairs.map((p) => Math.abs(p.ours[key] - p.reference[key]));
    return { mean: round(mean(abs), 3), max: round(Math.max(...abs), 3) };
  };
  return { sunlight: of('sunlightPct'), earth: of('earthPct') };
}

// Part 1: the catalogue sites, against the stored catalogue skylines.
const rows = [];
const pooled = { composite: [] as number[], coarse: [] as number[], compositeVsFull: [] as number[], catalogueVsFull: [] as number[] };
const answers = { composite: [] as { ours: Shares; reference: Shares }[], coarse: [] as { ours: Shares; reference: Shares }[], compositeVsFull: [] as { ours: Shares; reference: Shares }[] };
for (const entry of catalogue.sites) {
  if (!entry.terrain || entry.latDeg > index.capLatDeg) continue;
  if (entry.terrain.azStepDeg !== SKYLINE.azStepDeg) throw new Error(`${entry.id}: unexpected azimuth step`);
  const reference = entry.terrain.profiles[String(MAST_M)]!;
  const { composite, alone } = pickedSite(entry.latDeg, entry.lonDeg);
  const dComposite = absDifference(composite.profile.elDeg, reference), dCoarse = absDifference(alone.profile.elDeg, reference);
  pooled.composite.push(...dComposite); pooled.coarse.push(...dCoarse);

  const shares = {
    catalogue: yearShares(entry.latDeg, entry.lonDeg, entry.terrain.groundHeightM, { azStepDeg: SKYLINE.azStepDeg, elDeg: Float32Array.from(reference) }),
    composite: yearShares(entry.latDeg, entry.lonDeg, composite.groundHeightM, composite.profile),
    coarse: yearShares(entry.latDeg, entry.lonDeg, alone.groundHeightM, alone.profile),
  };
  answers.composite.push({ ours: shares.composite, reference: shares.catalogue });
  answers.coarse.push({ ours: shares.coarse, reference: shares.catalogue });
  if (full) {
    const direct = computeTerrainHorizon(full, entry.latDeg, entry.lonDeg, MAST_M, SKYLINE);
    pooled.compositeVsFull.push(...absDifference(composite.profile.elDeg, direct.profile.elDeg));
    pooled.catalogueVsFull.push(...absDifference(reference, direct.profile.elDeg));
    answers.compositeVsFull.push({ ours: shares.composite, reference: yearShares(entry.latDeg, entry.lonDeg, direct.groundHeightM, direct.profile) });
  }
  rows.push({
    id: entry.id, latDeg: entry.latDeg, lonDeg: entry.lonDeg,
    groundHeightM: { catalogue: entry.terrain.groundHeightM, composite: round(composite.groundHeightM, 1), coarse480m: round(alone.groundHeightM, 1) },
    skylineAbsDifferenceDeg: { composite: spread(dComposite), coarse480m: spread(dCoarse) },
    sunlightPct: { catalogue: round(shares.catalogue.sunlightPct, 2), composite: round(shares.composite.sunlightPct, 2), coarse480m: round(shares.coarse.sunlightPct, 2) },
    earthPct: { catalogue: round(shares.catalogue.earthPct, 2), composite: round(shares.composite.earthPct, 2), coarse480m: round(shares.coarse.earthPct, 2) },
    modelEdgeReached: { composite: composite.truncated, coarse480m: alone.truncated },
  });
}

// Part 2: pseudo-random points over the whole cap, against the complete grid.
function randomPoints(grid: PolarDem): object {
  // Deterministic generator and seed, as in tools/validation/illumination.ts: the same points on every run.
  let seed = 20261114;
  const random = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const capRadiusM = 2 * R_M * Math.tan(((90 + index.capLatDeg) * Math.PI) / 360);
  const skyline = { composite: [] as number[], coarse: [] as number[] };
  const shares = { composite: [] as { ours: Shares; reference: Shares }[], coarse: [] as { ours: Shares; reference: Shares }[] };
  const samples: number[][] = [];
  for (let i = 0; i < RANDOM_POINTS; i++) {
    // Uniform over the area of the cap.
    const radiusM = capRadiusM * Math.sqrt(random()), lonDeg = random() * 360 - 180;
    const latDeg = -90 + (2 * Math.atan(radiusM / (2 * R_M)) * 180) / Math.PI;
    const { composite, alone } = pickedSite(latDeg, lonDeg);
    const direct = computeTerrainHorizon(grid, latDeg, lonDeg, MAST_M, SKYLINE);
    const dComposite = absDifference(composite.profile.elDeg, direct.profile.elDeg), dCoarse = absDifference(alone.profile.elDeg, direct.profile.elDeg);
    skyline.composite.push(...dComposite); skyline.coarse.push(...dCoarse);
    const reference = yearShares(latDeg, lonDeg, direct.groundHeightM, direct.profile);
    const ours = yearShares(latDeg, lonDeg, composite.groundHeightM, composite.profile);
    const rough = yearShares(latDeg, lonDeg, alone.groundHeightM, alone.profile);
    shares.composite.push({ ours, reference }); shares.coarse.push({ ours: rough, reference });
    samples.push([round(latDeg, 4), round(lonDeg, 4), round(Math.max(...dComposite), 4), round(Math.max(...dCoarse), 4),
      round(reference.sunlightPct, 2), round(ours.sunlightPct, 2), round(rough.sunlightPct, 2),
      round(reference.earthPct, 2), round(ours.earthPct, 2), round(rough.earthPct, 2)]);
  }
  return {
    note: `${RANDOM_POINTS} pseudo-random points, uniform over the area at or south of ${index.capLatDeg} degrees, compared with skylines from the complete 120 m grid (${FULL_GRID}).`,
    points: RANDOM_POINTS,
    skylineAbsDifferenceDeg: { composite: spread(skyline.composite), coarse480m: spread(skyline.coarse) },
    answerAbsDifferencePoints: { composite: answerSpread(shares.composite), coarse480m: answerSpread(shares.coarse) },
    sampleColumns: ['latDeg', 'lonDeg', 'largest skyline difference composite (deg)', 'largest skyline difference 480 m (deg)',
      'sunlight % complete grid', 'sunlight % composite', 'sunlight % 480 m', 'earth % complete grid', 'earth % composite', 'earth % 480 m'],
    samples,
  };
}

const notMeasured = { note: `Not measured: ${FULL_GRID} is not on this machine.` };
const report = {
  reference: 'Catalogue skylines in web/public/data/sites.json: computed by tools/terrain/build.ts from the complete NASA LOLA LDEM_75S_120M grid (2 m above ground, 0.25 degree azimuth step, 400 km), stored rounded to 0.01 degree',
  method: `Every catalogue site with a terrain skyline at or south of ${index.capLatDeg} degrees. Composite: 120 m tiles in the 3 x 3 block around the site, shipped 480 m model beyond. 480 m: the shipped 480 m model alone. Answers: share of 2027 (UTC, one sample per hour, both ends included) with any part of the solar disc above the skyline and with the centre of the Earth above it. Skyline statistics pool all azimuth bins of all sites; answer differences are in percentage points.`,
  tileSet: { capLatDeg: index.capLatDeg, tiles: index.tiles.length, totalBytes: index.totalBytes, encoding: index.encoding },
  catalogueSites: {
    sites: rows.length,
    skylineAbsDifferenceDeg: { composite: spread(pooled.composite), coarse480m: spread(pooled.coarse) },
    answerAbsDifferencePoints: { composite: answerSpread(answers.composite), coarse480m: answerSpread(answers.coarse) },
    againstCompleteGrid: full ? {
      note: `The same sites against skylines recomputed from the complete 120 m grid (${FULL_GRID}), not rounded: the composite differs from them only through the 480 m terrain beyond the tiles.`,
      skylineAbsDifferenceDeg: { composite: spread(pooled.compositeVsFull), catalogue: spread(pooled.catalogueVsFull) },
      answerAbsDifferencePoints: { composite: answerSpread(answers.compositeVsFull) },
    } : notMeasured,
    perSite: rows,
  },
  randomPoints: full && RANDOM_POINTS > 0 ? randomPoints(full) : notMeasured,
  timingMs: {
    note: 'Measured with Node on the machine that ran this tool; it changes from run to run and is not a browser guarantee. Loading = gunzip and decode of the nine tiles, read from disk.',
    skylines: compositeMs.length,
    compositeSkylineMedian: round(median(compositeMs), 0), compositeSkylineMax: round(Math.max(...compositeMs), 0),
    coarse480mSkylineMedian: round(median(coarseMs), 0),
    loadNineTilesMedian: round(median(loadMs), 0),
  },
};

const f = (v: number, digits: number): string => v.toFixed(digits);
console.log('| Site | Latitude | Composite skyline (mean / 95th / largest, deg) | 480 m skyline (mean / 95th / largest, deg) | Sunlight % (catalogue / composite / 480 m) | Earth % (catalogue / composite / 480 m) |');
console.log('|---|---|---|---|---|---|');
for (const r of rows) {
  const s = r.skylineAbsDifferenceDeg;
  console.log(`| ${r.id} | ${f(r.latDeg, 2)} | ${f(s.composite.mean, 3)} / ${f(s.composite.p95, 3)} / ${f(s.composite.max, 3)} | ${f(s.coarse480m.mean, 3)} / ${f(s.coarse480m.p95, 3)} / ${f(s.coarse480m.max, 3)} ` +
    `| ${f(r.sunlightPct.catalogue, 2)} / ${f(r.sunlightPct.composite, 2)} / ${f(r.sunlightPct.coarse480m, 2)} | ${f(r.earthPct.catalogue, 2)} / ${f(r.earthPct.composite, 2)} / ${f(r.earthPct.coarse480m, 2)} |`);
}
console.log(JSON.stringify(report, (key, value: unknown) => (key === 'perSite' || key === 'samples' ? undefined : value), 1));
writeFileSync(root + 'docs/validation-tiles.json', JSON.stringify(report, (_key, value: unknown) =>
  // Keep each row of numbers on one line: the file stays readable and small.
  (Array.isArray(value) && value.every((v) => typeof v !== 'object') ? JSON.stringify(value) : value), 1)
  .replace(/"\[(.*?)\]"/g, (_m, inner: string) => `[${inner.replace(/\\"/g, '"')}]`) + '\n');
