// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { computeTerrainHorizon, demHeightAt, demPixel, makePolarDem, polarDemField } from '../../engine/src/terrain.ts';
import type { HeightField, PolarDem } from '../../engine/src/terrain.ts';
import {
  addTile, compositeField, createTileStore, decodeTile, encodeTile, tileField, tilesAround,
} from '../../engine/src/tiles.ts';
import type { TileSetSpec, TileStore } from '../../engine/src/tiles.ts';

const R_M = 1737400;
const DEG = Math.PI / 180;
const ENCODINGS = ['int16le-left-gzip', 'int16le-plane-gzip'] as const;

/** Deterministic pseudo-random numbers in [0, 1). */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}

/** Smooth hills plus a little noise, like real terrain: neighbouring samples are close. */
function syntheticDem(n: number, seed: number): PolarDem {
  const random = generator(seed);
  const waves = Array.from({ length: 6 }, () => ({
    kx: (random() - 0.5) * 0.08, ky: (random() - 0.5) * 0.08, phase: random() * 2 * Math.PI, amplitude: 300 + 900 * random(),
  }));
  const raw = new Int16Array(n * n);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      let h = 20 * (random() - 0.5);
      for (const w of waves) h += w.amplitude * Math.sin(w.kx * c + w.ky * r + w.phase);
      raw[r * n + c] = Math.round(h);
    }
  return makePolarDem(raw, n, 120, 0.5);
}

const specOf = (dem: PolarDem, tile: number): TileSetSpec =>
  ({ n: dem.n, scaleM: dem.scaleM, heightScale: dem.heightScale, tile, maxHeightM: dem.maxHeightM });

/** One tile cut from a grid; cells beyond the grid get `padding`. */
function cutTile(dem: PolarDem, tile: number, tx: number, ty: number, padding: number): Int16Array {
  const out = new Int16Array(tile * tile).fill(padding);
  for (let r = 0; r < tile && ty * tile + r < dem.n; r++)
    for (let c = 0; c < tile && tx * tile + c < dem.n; c++) out[r * tile + c] = dem.raw[(ty * tile + r) * dem.n + tx * tile + c]!;
  return out;
}

/** Every tile of a grid, except those listed in `missing` as 'tx,ty'. */
function storeOf(dem: PolarDem, tile: number, missing: string[] = [], padding = 0): TileStore {
  const store = createTileStore(specOf(dem, tile));
  const perSide = Math.ceil(dem.n / tile);
  for (let ty = 0; ty < perSide; ty++)
    for (let tx = 0; tx < perSide; tx++)
      if (!missing.includes(`${tx},${ty}`)) addTile(store, tx, ty, cutTile(dem, tile, tx, ty, padding));
  return store;
}

/** Latitude and longitude of a fractional column and row of a polar grid. */
function latLonOf(dem: { n: number; scaleM: number }, col: number, row: number): { latDeg: number; lonDeg: number } {
  const centre = dem.n / 2 - 0.5;
  const x = (col - centre) * dem.scaleM, y = (centre - row) * dem.scaleM;
  return { latDeg: -90 + (2 * Math.atan(Math.hypot(x, y) / (2 * R_M))) / DEG, lonDeg: Math.atan2(x, y) / DEG };
}

/** Test points in pixel coordinates: random, on every tile border, at the grid edges. */
function probePixels(n: number, tile: number, seed: number): [number, number][] {
  const random = generator(seed);
  const points: [number, number][] = [];
  for (let i = 0; i < 6000; i++) points.push([random() * (n + 3) - 2, random() * (n + 3) - 2]);
  const offsets = [-1, -0.5, -1e-6, 0, 1e-6, 0.5, 1];
  const lines = [0, n - 1];
  for (let b = tile; b < n; b += tile) lines.push(b - 1, b);
  for (const line of lines)
    for (const offset of offsets) {
      // Along a border, and where two borders cross.
      for (let i = 0; i < 12; i++) {
        points.push([line + offset, random() * (n - 1)], [random() * (n - 1), line + offset]);
      }
      for (const other of lines) for (const second of offsets) points.push([line + offset, other + second]);
    }
  return points;
}

describe.each([
  // 1024 puts the pole exactly on a corner shared by four tiles.
  { n: 1024, tile: 256 },
  // 1000 leaves the last tile of every row and column partly outside the grid.
  { n: 1000, tile: 256 },
  { n: 97, tile: 16 },
])('tile field on a synthetic $n grid cut into $tile-sample tiles', ({ n, tile }) => {
  const dem = syntheticDem(n, 20261114 + n);
  // Padding with the largest Int16 value would show at once if a padded cell were ever read.
  const complete = tileField(storeOf(dem, tile, [], 32767));
  const pixels = probePixels(n, tile, 7 + n);

  it('equals demHeightAt exactly at thousands of points, tile borders and grid edges included', () => {
    let different = 0, known = 0, unknown = 0, acrossTiles = 0;
    for (const [col, row] of pixels) {
      const { latDeg, lonDeg } = latLonOf(dem, col, row);
      const expected = demHeightAt(dem, latDeg, lonDeg), actual = complete.heightAt(latDeg, lonDeg);
      if (!Object.is(actual, expected)) different++;
      if (Number.isNaN(expected)) { unknown++; continue; }
      known++;
      const p = demPixel(dem, latDeg, lonDeg);
      if (Math.floor(p.col) % tile === tile - 1 || Math.floor(p.row) % tile === tile - 1) acrossTiles++;
    }
    expect(different).toBe(0);
    expect(known).toBeGreaterThan(5000);
    // Points outside the grid are unknown for both; points whose four neighbours span tiles were really exercised.
    expect(unknown).toBeGreaterThan(20);
    expect(acrossTiles).toBeGreaterThan(300);
  });

  it('equals demHeightAt at the pole for any longitude', () => {
    for (const lonDeg of [0, 45.3, 90, 180, -180, -90, -0.001]) {
      const expected = demHeightAt(dem, -90, lonDeg);
      expect(Number.isFinite(expected)).toBe(true);
      expect(complete.heightAt(-90, lonDeg)).toBe(expected);
    }
  });

  it('is NaN exactly where one of the four neighbouring samples is in a missing tile', () => {
    const perSide = Math.ceil(n / tile);
    const gone = [`1,${perSide - 2}`, `${perSide - 1},0`];
    const partial = tileField(storeOf(dem, tile, gone));
    let wrong = 0, holes = 0, borderHoles = 0;
    for (const [col, row] of pixels) {
      const { latDeg, lonDeg } = latLonOf(dem, col, row);
      const expected = demHeightAt(dem, latDeg, lonDeg), actual = partial.heightAt(latDeg, lonDeg);
      if (Number.isNaN(expected)) { if (!Number.isNaN(actual)) wrong++; continue; }
      const p = demPixel(dem, latDeg, lonDeg);
      const c0 = Math.min(n - 2, Math.floor(p.col)), r0 = Math.min(n - 2, Math.floor(p.row));
      const inMissing = (c: number, r: number): boolean => gone.includes(`${Math.floor(c / tile)},${Math.floor(r / tile)}`);
      const needsMissing = inMissing(c0, r0) || inMissing(c0 + 1, r0) || inMissing(c0, r0 + 1) || inMissing(c0 + 1, r0 + 1);
      if (needsMissing) {
        holes++;
        if (!inMissing(c0, r0)) borderHoles++;
        if (!Number.isNaN(actual)) wrong++;
      } else if (actual !== expected) wrong++;
    }
    expect(wrong).toBe(0);
    expect(holes).toBeGreaterThan(100);
    // Points just outside a missing tile that still need one of its samples.
    expect(borderHoles).toBeGreaterThan(0);
  });

  it('gives the same skyline as the full grid', () => {
    const site = latLonOf(dem, n * 0.4, n * 0.55);
    const options = { azStepDeg: 5, maxDistanceKm: 80 };
    const direct = computeTerrainHorizon(dem, site.latDeg, site.lonDeg, 2, options);
    const tiled = computeTerrainHorizon(complete, site.latDeg, site.lonDeg, 2, options);
    expect(tiled.groundHeightM).toBe(direct.groundHeightM);
    expect(tiled.truncated).toBe(direct.truncated);
    expect(Array.from(tiled.profile.elDeg)).toEqual(Array.from(direct.profile.elDeg));
    expect(Array.from(tiled.distanceKm)).toEqual(Array.from(direct.distanceKm));
  });
});

describe('tile store', () => {
  const dem = syntheticDem(64, 5);
  const spec = specOf(dem, 16);

  it('reports the grid resolution and the declared height bound', () => {
    const field = tileField(storeOf(dem, 16));
    expect(field.resolutionM).toBe(120);
    expect(field.maxHeightM).toBe(dem.maxHeightM);
  });

  it('sees tiles added after the field was made', () => {
    const store = createTileStore(spec);
    const field = tileField(store);
    const { latDeg, lonDeg } = latLonOf(dem, 20.25, 37.5);
    expect(field.heightAt(latDeg, lonDeg)).toBeNaN();
    addTile(store, 1, 2, cutTile(dem, 16, 1, 2, 0));
    expect(field.heightAt(latDeg, lonDeg)).toBe(demHeightAt(dem, latDeg, lonDeg));
    expect(store.tiles.get(2 * 65536 + 1)).toBeInstanceOf(Int16Array);
  });

  it('keeps its own copy of the description', () => {
    const mutable = { ...spec };
    const store = createTileStore(mutable);
    mutable.n = 5;
    expect(store.spec.n).toBe(64);
  });

  it.each([
    { ...spec, n: 1 }, { ...spec, n: 64.5 }, { ...spec, tile: 0 }, { ...spec, tile: 2.5 }, { ...spec, tile: 5000 },
    { ...spec, scaleM: 0 }, { ...spec, scaleM: NaN }, { ...spec, heightScale: -1 }, { ...spec, heightScale: Infinity },
    { ...spec, maxHeightM: NaN }, { ...spec, maxHeightM: Infinity }, { ...spec, maxHeightM: -R_M },
    { ...spec, n: 70000, tile: 1 },
  ])('rejects the invalid description %o', (bad) => {
    expect(() => createTileStore(bad)).toThrow(RangeError);
    expect(() => tileField({ spec: bad, tiles: new Map() })).toThrow(RangeError);
    expect(() => tilesAround(bad, -90, 0)).toThrow(RangeError);
  });

  it('rejects tiles that do not belong to the set', () => {
    const store = createTileStore(spec);
    const tile = cutTile(dem, 16, 0, 0, 0);
    for (const [tx, ty] of [[-1, 0], [0, -1], [4, 0], [0, 4], [0.5, 0], [0, NaN]])
      expect(() => addTile(store, tx!, ty!, tile)).toThrow(RangeError);
    expect(() => addTile(store, 0, 0, new Int16Array(255))).toThrow(RangeError);
    expect(() => addTile(store, 0, 0, new Float32Array(256) as unknown as Int16Array)).toThrow(RangeError);
    expect(store.tiles.size).toBe(0);
  });

  it('rejects a tile higher than the declared maximum, but ignores padding outside the grid', () => {
    const store = createTileStore(spec);
    const tooHigh = cutTile(dem, 16, 1, 1, 0);
    tooHigh[5] = Math.ceil(dem.maxHeightM / dem.heightScale) + 1;
    expect(() => addTile(store, 1, 1, tooHigh)).toThrow(RangeError);
    const partial = syntheticDem(40, 9);
    const padded = createTileStore(specOf(partial, 16));
    expect(() => addTile(padded, 2, 2, cutTile(partial, 16, 2, 2, 32767))).not.toThrow();
  });

  it('rejects invalid coordinates like demHeightAt does', () => {
    const field = tileField(storeOf(dem, 16));
    for (const [lat, lon] of [[NaN, 0], [-91, 0], [91, 0], [-89, 181], [-89, Infinity]])
      expect(() => field.heightAt(lat!, lon!)).toThrow(RangeError);
  });
});

describe('tile encoding', () => {
  const tile = 32;
  const random = generator(99);
  const smooth = Int16Array.from({ length: tile * tile }, (_, i) =>
    Math.round(4000 * Math.sin((i % tile) / 7) + 3000 * Math.cos(Math.floor(i / tile) / 5)));
  const noise = Int16Array.from({ length: tile * tile }, () => Math.floor(random() * 65536) - 32768);
  const extremes = Int16Array.from({ length: tile * tile }, (_, i) => ((i + Math.floor(i / tile)) % 2 === 0 ? -32768 : 32767));
  const lowest = new Int16Array(tile * tile).fill(-32768), highest = new Int16Array(tile * tile).fill(32767);
  const cases: [string, Int16Array][] = [['smooth', smooth], ['random', noise], ['alternating extremes', extremes], ['all lowest', lowest], ['all highest', highest]];

  it.each(ENCODINGS.flatMap((encoding) => cases.map(([name, heights]) => ({ encoding, name, heights }))))(
    '$encoding decodes $name data exactly',
    ({ encoding, heights }) => {
      const bytes = encodeTile(heights, tile, encoding);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBe(tile * tile * 2);
      expect(decodeTile(bytes, tile, encoding)).toEqual(heights);
      expect(decodeTile(new Uint8Array(gunzipSync(gzipSync(bytes, { level: 9 }))), tile, encoding)).toEqual(heights);
    });

  it('follows the documented predictors (bytes worked out by hand)', () => {
    // Heights 10 13 / 7 20. Left: 10, 13-10, 7-10 (first of a row minus the one above), 20-7.
    expect(Array.from(decodeTile(Uint8Array.of(10, 0, 3, 0, 0xfd, 0xff, 13, 0), 2, 'int16le-left-gzip'))).toEqual([10, 13, 7, 20]);
    // Plane: the last sample is predicted as left + up - upleft = 7 + 13 - 10, so its residual is 10.
    expect(Array.from(decodeTile(Uint8Array.of(10, 0, 3, 0, 0xfd, 0xff, 10, 0), 2, 'int16le-plane-gzip'))).toEqual([10, 13, 7, 20]);
    expect(Array.from(encodeTile(Int16Array.of(10, 13, 7, 20), 2, 'int16le-left-gzip'))).toEqual([10, 0, 3, 0, 0xfd, 0xff, 13, 0]);
    expect(Array.from(encodeTile(Int16Array.of(10, 13, 7, 20), 2, 'int16le-plane-gzip'))).toEqual([10, 0, 3, 0, 0xfd, 0xff, 10, 0]);
  });

  it('wraps around in 16 bits at the extreme values', () => {
    const heights = Int16Array.of(32767, -32768, -32768, 32767);
    // -32768 - 32767 = -65535 wraps to 1; 32767 + 32768 = 65535 wraps to -1; plane: 32767 + 98303 wraps to -2.
    expect(Array.from(encodeTile(heights, 2, 'int16le-left-gzip'))).toEqual([0xff, 0x7f, 1, 0, 1, 0, 0xff, 0xff]);
    expect(Array.from(encodeTile(heights, 2, 'int16le-plane-gzip'))).toEqual([0xff, 0x7f, 1, 0, 1, 0, 0xfe, 0xff]);
  });

  it('reads bytes one by one, whatever their alignment in memory', () => {
    const bytes = encodeTile(smooth, tile, 'int16le-plane-gzip');
    const shifted = new Uint8Array(bytes.length + 1);
    shifted.set(bytes, 1);
    expect(decodeTile(shifted.subarray(1), tile, 'int16le-plane-gzip')).toEqual(smooth);
  });

  it('makes smooth terrain compress better with the plane predictor than raw samples', () => {
    const rawSize = gzipSync(new Uint8Array(smooth.buffer), { level: 9 }).length;
    expect(gzipSync(encodeTile(smooth, tile, 'int16le-plane-gzip'), { level: 9 }).length).toBeLessThan(rawSize);
  });

  it('rejects wrong sizes and unknown encodings', () => {
    const bytes = encodeTile(smooth, tile, 'int16le-left-gzip');
    expect(() => decodeTile(bytes.subarray(1), tile, 'int16le-left-gzip')).toThrow(RangeError);
    expect(() => decodeTile(bytes, tile + 1, 'int16le-left-gzip')).toThrow(RangeError);
    expect(() => decodeTile(bytes, 0, 'int16le-left-gzip')).toThrow(RangeError);
    expect(() => decodeTile(bytes, 1.5, 'int16le-left-gzip')).toThrow(RangeError);
    expect(() => decodeTile(bytes, tile, 'int16le-gzip')).toThrow(RangeError);
    expect(() => decodeTile(bytes, tile, '')).toThrow(RangeError);
    expect(() => decodeTile(Array.from(bytes) as unknown as Uint8Array, tile, 'int16le-left-gzip')).toThrow(RangeError);
    expect(() => encodeTile(smooth, tile + 1, 'int16le-left-gzip')).toThrow(RangeError);
    expect(() => encodeTile(smooth, tile, 'plane')).toThrow(RangeError);
  });
});

describe('tiles around a point', () => {
  const spec: TileSetSpec = { n: 1024, scaleM: 120, heightScale: 0.5, tile: 256, maxHeightM: 1000 };
  const names = (keys: { tx: number; ty: number }[]): string => keys.map((k) => `${k.tx},${k.ty}`).join(' ');

  it('returns the tile itself, the 3 x 3 block and the clipped 5 x 5 block at the pole', () => {
    // The pole is at column and row 511.5: in tile (1, 1).
    expect(names(tilesAround(spec, -90, 0, 0))).toBe('1,1');
    expect(names(tilesAround(spec, -90, 0))).toBe('0,0 1,0 2,0 0,1 1,1 2,1 0,2 1,2 2,2');
    expect(names(tilesAround(spec, -90, 0, 1))).toBe(names(tilesAround(spec, -90, 0)));
    const wide = tilesAround(spec, -90, 0, 2);
    expect(wide).toHaveLength(16);
    expect(wide[0]).toEqual({ tx: 0, ty: 0 });
    expect(wide[15]).toEqual({ tx: 3, ty: 3 });
  });

  it('clips the block in a corner of the grid', () => {
    const topLeft = latLonOf(spec, 3, 2);
    expect(names(tilesAround(spec, topLeft.latDeg, topLeft.lonDeg, 0))).toBe('0,0');
    expect(names(tilesAround(spec, topLeft.latDeg, topLeft.lonDeg, 1))).toBe('0,0 1,0 0,1 1,1');
    expect(tilesAround(spec, topLeft.latDeg, topLeft.lonDeg, 2)).toHaveLength(9);
    const partial = { ...spec, n: 1000 };
    const bottomRight = latLonOf(partial, 997, 998);
    expect(names(tilesAround(partial, bottomRight.latDeg, bottomRight.lonDeg, 0))).toBe('3,3');
    expect(names(tilesAround(partial, bottomRight.latDeg, bottomRight.lonDeg))).toBe('2,2 3,2 2,3 3,3');
    expect(tilesAround(partial, bottomRight.latDeg, bottomRight.lonDeg, 9)).toHaveLength(16);
  });

  it('picks the tile that holds the samples used at the point', () => {
    const random = generator(3);
    for (let i = 0; i < 500; i++) {
      const col = random() * 1023, row = random() * 1023;
      const { latDeg, lonDeg } = latLonOf(spec, col, row);
      const pixel = demPixel({ ...spec, raw: new Int16Array(0) }, latDeg, lonDeg);
      expect(tilesAround(spec, latDeg, lonDeg, 0)).toEqual([{ tx: Math.floor(pixel.col / 256), ty: Math.floor(pixel.row / 256) }]);
    }
  });

  it('has no tile for a point outside the grid', () => {
    expect(tilesAround(spec, -80, 10)).toEqual([]);
    expect(tilesAround(spec, 45, -120, 2)).toEqual([]);
  });

  it('rejects invalid rings and coordinates', () => {
    for (const ring of [-1, 0.5, NaN, Infinity]) expect(() => tilesAround(spec, -90, 0, ring)).toThrow(RangeError);
    for (const [lat, lon] of [[NaN, 0], [-91, 0], [-89, 200]]) expect(() => tilesAround(spec, lat!, lon!)).toThrow(RangeError);
  });
});

describe('composite field', () => {
  const flat = (heightM: number, resolutionM: number, maxHeightM = heightM): HeightField =>
    ({ heightAt: () => heightM, resolutionM, maxHeightM });

  it('uses the near field where it is known and the far field elsewhere', () => {
    let farReads = 0;
    const near: HeightField = { heightAt: (lat) => (lat < -89 ? 100 : NaN), resolutionM: 120, maxHeightM: 100 };
    const far: HeightField = { heightAt: () => { farReads++; return 7; }, resolutionM: 480, maxHeightM: 900 };
    const field = compositeField(near, far);
    expect(field.heightAt(-89.5, 10)).toBe(100);
    expect(farReads).toBe(0);
    expect(field.heightAt(-88, 10)).toBe(7);
    expect(farReads).toBe(1);
    expect(field.resolutionM).toBe(120);
    expect(field.maxHeightM).toBe(900);
    expect(compositeField(far, near).maxHeightM).toBe(900);
    expect(compositeField(far, near).resolutionM).toBe(480);
  });

  it('is unknown only where both fields are unknown', () => {
    const hole: HeightField = { heightAt: () => NaN, resolutionM: 120, maxHeightM: 0 };
    expect(compositeField(hole, hole).heightAt(-89, 0)).toBeNaN();
    expect(compositeField(hole, flat(3, 480)).heightAt(-89, 0)).toBe(3);
  });

  it('feeds computeTerrainHorizon: fine tiles near the site, coarse grid beyond, nothing unknown', () => {
    const dem = syntheticDem(1024, 11);
    const coarseRaw = new Int16Array(256 * 256);
    for (let r = 0; r < 256; r++)
      for (let c = 0; c < 256; c++) {
        let sum = 0;
        for (let dr = 0; dr < 4; dr++) for (let dc = 0; dc < 4; dc++) sum += dem.raw[(r * 4 + dr) * 1024 + c * 4 + dc]!;
        coarseRaw[r * 256 + c] = Math.round(sum / 16);
      }
    const coarse = makePolarDem(coarseRaw, 256, 480, 0.5);
    const spec = specOf(dem, 128);
    const store = createTileStore(spec);
    const site = latLonOf(dem, 500, 530);
    const around = tilesAround(spec, site.latDeg, site.lonDeg);
    expect(around).toHaveLength(9);
    for (const { tx, ty } of around) addTile(store, tx, ty, cutTile(dem, 128, tx, ty, 0));
    const options = { azStepDeg: 2, maxDistanceKm: 50 };
    const composite = computeTerrainHorizon(compositeField(tileField(store), polarDemField(coarse)), site.latDeg, site.lonDeg, 2, options);
    const exact = computeTerrainHorizon(dem, site.latDeg, site.lonDeg, 2, options);
    const rough = computeTerrainHorizon(coarse, site.latDeg, site.lonDeg, 2, options);
    expect(composite.truncated).toBe(false);
    expect(composite.groundHeightM).toBe(exact.groundHeightM);
    const meanDifference = (a: Float32Array, b: Float32Array): number => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]!), 0) / a.length;
    expect(meanDifference(composite.profile.elDeg, exact.profile.elDeg)).toBeLessThan(meanDifference(rough.profile.elDeg, exact.profile.elDeg) / 5);
  });

  it('rejects fields without a sampler, a resolution or a usable height bound', () => {
    const good = flat(0, 120);
    const bad = [
      { ...good, heightAt: undefined }, { ...good, resolutionM: 0 }, { ...good, resolutionM: NaN },
      { ...good, maxHeightM: Infinity }, { ...good, maxHeightM: -R_M }, null,
    ] as unknown as HeightField[];
    for (const field of bad) {
      expect(() => compositeField(field, good)).toThrow(RangeError);
      expect(() => compositeField(good, field)).toThrow(RangeError);
    }
  });
});

// The shipped tiles and the files they are checked against are all in the repository.
const root = fileURLToPath(new URL('../../', import.meta.url));
const DATA = root + 'web/public/data/';
const TILES = DATA + 'tiles/120m/';

interface TileIndex extends TileSetSpec {
  source: string; sourceSha256: string; encoding: string; capLatDeg: number; tiles: [number, number][]; totalBytes: number;
}
interface CatalogueSite {
  id: string; latDeg: number; lonDeg: number;
  terrain: { groundHeightM: number; azStepDeg: number; profiles: Record<string, number[]> } | null;
}

function samplesOf(bytes: Buffer): Int16Array {
  const raw = new Int16Array(bytes.length / 2);
  for (let i = 0; i < raw.length; i++) raw[i] = bytes.readInt16LE(2 * i);
  return raw;
}

describe('shipped 120 m tiles', () => {
  const index = JSON.parse(readFileSync(TILES + 'index.json', 'utf8')) as TileIndex;
  const meta = JSON.parse(readFileSync(DATA + 'terrain.json', 'utf8')) as { coarse: { file: string; n: number; scaleM: number; heightScale: number } };
  const coarse = makePolarDem(samplesOf(readFileSync(DATA + meta.coarse.file)), meta.coarse.n, meta.coarse.scaleM, meta.coarse.heightScale);
  const fileOf = (tx: number, ty: number): string => `${TILES}t_${ty}_${tx}.i16.gz`;
  const decoded = new Map<string, Int16Array>();
  const heightsOf = (tx: number, ty: number): Int16Array => {
    const key = `${tx},${ty}`;
    let heights = decoded.get(key);
    if (!heights) {
      heights = decodeTile(new Uint8Array(gunzipSync(readFileSync(fileOf(tx, ty)))), index.tile, index.encoding);
      decoded.set(key, heights);
    }
    return heights;
  };
  const storeAround = (latDeg: number, lonDeg: number): TileStore => {
    const store = createTileStore(index);
    for (const { tx, ty } of tilesAround(index, latDeg, lonDeg)) addTile(store, tx, ty, heightsOf(tx, ty));
    return store;
  };

  it('describes the NASA 120 m grid that the 480 m model was reduced from', () => {
    expect(index.source).toContain('LDEM_75S_120M');
    expect(index.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(index.tile).toBe(256);
    expect(index.n).toBe(coarse.n * 4);
    expect(index.scaleM).toBe(coarse.scaleM / 4);
    expect(index.heightScale).toBe(coarse.heightScale);
    expect(ENCODINGS).toContain(index.encoding);
    expect(index.capLatDeg).toBeLessThanOrEqual(-80);
    expect(index.capLatDeg).toBeGreaterThanOrEqual(-83);
  });

  it('lists exactly the tile files present, sorted, with their total size under 24 MB', () => {
    const listed = index.tiles.map(([tx, ty]) => `t_${ty}_${tx}.i16.gz`);
    const present = readdirSync(TILES).filter((name) => name.endsWith('.i16.gz'));
    expect([...present].sort()).toEqual([...listed].sort());
    const order = index.tiles.map(([tx, ty]) => ty * 65536 + tx);
    expect(order).toEqual([...new Set(order)].sort((a, b) => a - b));
    const total = index.tiles.reduce((sum, [tx, ty]) => sum + statSync(fileOf(tx, ty)).size, 0);
    expect(total).toBe(index.totalBytes);
    expect(total).toBeLessThanOrEqual(24_000_000);
  });

  it('decodes every tile; the declared maximum is the highest sample', () => {
    let max = -Infinity;
    for (const [tx, ty] of index.tiles) {
      const heights = heightsOf(tx, ty);
      expect(heights.length).toBe(index.tile * index.tile);
      for (let i = 0; i < heights.length; i++) if (heights[i]! > max) max = heights[i]!;
    }
    expect(max * index.heightScale).toBe(index.maxHeightM);
    // The whole grid's highest point (PDS label: DERIVED_MAXIMUM = 14050 raw units) cannot be exceeded.
    expect(index.maxHeightM).toBeLessThanOrEqual(14050 * index.heightScale);
  });

  it('holds the samples the shipped 480 m model is the 4 x 4 block mean of (same place, same orientation)', () => {
    // tools/terrain/build.ts made the 480 m model as round(mean of 4 x 4 samples) of the same source grid.
    let different = 0, cells = 0;
    const tile = index.tile, per = tile / 4;
    for (const [tx, ty] of index.tiles) {
      const heights = heightsOf(tx, ty);
      for (let r = 0; r < per; r++)
        for (let c = 0; c < per; c++) {
          const row = ty * per + r, col = tx * per + c;
          if (row >= coarse.n || col >= coarse.n) continue;
          let sum = 0;
          for (let dr = 0; dr < 4; dr++) for (let dc = 0; dc < 4; dc++) sum += heights[(r * 4 + dr) * tile + c * 4 + dc]!;
          cells++;
          if (Math.round(sum / 16) !== coarse.raw[row * coarse.n + col]) different++;
        }
    }
    expect(cells).toBe(index.tiles.length * per * per);
    expect(different).toBe(0);
  });

  it('gives every point at or south of the cap its complete 3 x 3 block', () => {
    const listed = new Set(index.tiles.map(([tx, ty]) => `${tx},${ty}`));
    const random = generator(41);
    const capRadiusM = 2 * R_M * Math.tan(((90 + index.capLatDeg) * DEG) / 2);
    let missing = 0;
    for (let i = 0; i < 20000; i++) {
      // Half of the points on the cap circle itself, where the margin is smallest.
      const radiusM = i % 2 === 0 ? capRadiusM : capRadiusM * Math.sqrt(random());
      const latDeg = Math.min(index.capLatDeg, -90 + (2 * Math.atan(radiusM / (2 * R_M))) / DEG), lonDeg = random() * 360 - 180;
      const block = tilesAround(index, latDeg, lonDeg);
      if (block.length !== 9 || block.some((k) => !listed.has(`${k.tx},${k.ty}`))) missing++;
    }
    expect(missing).toBe(0);
  });

  // Catalogue skylines were computed by tools/terrain/build.ts from the complete 120 m grid:
  // computeTerrainHorizon(dem, lat, lon, 2, { azStepDeg: 0.25, maxDistanceKm: 400 }), default first
  // step (60 m), stored rounded to 0.01 degree. Bounds below come from tools/validation/tiles.ts
  // (docs/validation-tiles.json): over all 25 catalogue sites the composite differs from the
  // catalogue by at most 0.004 degree on average per site and 0.053 degree in the worst azimuth
  // bin; the 480 m model alone by up to 0.98 degree on average per site and 3.66 degrees.
  const catalogue = JSON.parse(readFileSync(DATA + 'sites.json', 'utf8')) as { sites: CatalogueSite[] };
  const request = { azStepDeg: 0.25, maxDistanceKm: 400 };
  it.each(['sunlit-4', 'sunlit-2', 'feature-16338', 'im-2-athena', 'im-1-odysseus'])(
    'reproduces the catalogue skyline of %s far better than the 480 m model alone',
    (id) => {
      const site = catalogue.sites.find((s) => s.id === id)!;
      expect(site.latDeg).toBeLessThanOrEqual(index.capLatDeg);
      const terrain = site.terrain!;
      expect(terrain.azStepDeg).toBe(request.azStepDeg);
      const reference = terrain.profiles['2']!;
      const field = compositeField(tileField(storeAround(site.latDeg, site.lonDeg)), polarDemField(coarse));
      const composite = computeTerrainHorizon(field, site.latDeg, site.lonDeg, 2, request);
      const alone = computeTerrainHorizon(coarse, site.latDeg, site.lonDeg, 2, request);
      const difference = (profile: Float32Array): { mean: number; max: number } => {
        expect(profile.length).toBe(reference.length);
        let sum = 0, max = 0;
        for (let i = 0; i < profile.length; i++) {
          const d = Math.abs(profile[i]! - reference[i]!);
          sum += d; max = Math.max(max, d);
        }
        return { mean: sum / profile.length, max };
      };
      const fine = difference(composite.profile.elDeg), rough = difference(alone.profile.elDeg);
      expect(composite.truncated).toBe(false);
      expect(Math.round(composite.groundHeightM)).toBe(terrain.groundHeightM);
      // Rounding the catalogue to 0.01 degree alone gives a mean difference of 0.0025 degree.
      expect(fine.mean).toBeLessThan(0.006);
      expect(fine.max).toBeLessThan(0.08);
      expect(rough.mean).toBeGreaterThan(0.1);
      expect(rough.mean).toBeGreaterThan(10 * fine.mean);
      expect(rough.max).toBeGreaterThan(10 * fine.max);
    });

  // Needs the source file of the 120 m model, which is not committed (see data/terrain/README.md).
  const SOURCE = root + 'data/raw/ldem_75s_120m.img';
  it.skipIf(!existsSync(SOURCE))('matches the source grid sample by sample and through tileField', () => {
    const full = makePolarDem(samplesOf(readFileSync(SOURCE)), index.n, index.scaleM, index.heightScale);
    const random = generator(17);
    for (let i = 0; i < 12; i++) {
      const [tx, ty] = index.tiles[Math.floor(random() * index.tiles.length)]!;
      const heights = heightsOf(tx, ty);
      let different = 0;
      for (let r = 0; r < index.tile; r++)
        for (let c = 0; c < index.tile; c++)
          if (heights[r * index.tile + c] !== full.raw[(ty * index.tile + r) * index.n + tx * index.tile + c]) different++;
      expect(different).toBe(0);
    }
    const field = tileField(storeAround(-89.2, 33));
    const centre = demPixel(full, -89.2, 33);
    let known = 0, unknown = 0;
    for (let i = 0; i < 4000; i++) {
      // Up to 520 samples from the site: mostly inside the 3 x 3 block, sometimes just outside it.
      const { latDeg, lonDeg } = latLonOf(index, centre.col + (random() - 0.5) * 1040, centre.row + (random() - 0.5) * 1040);
      const actual = field.heightAt(latDeg, lonDeg);
      if (Number.isNaN(actual)) { unknown++; continue; }
      known++;
      expect(actual).toBe(demHeightAt(full, latDeg, lonDeg));
    }
    expect(known).toBeGreaterThan(2000);
    expect(unknown).toBeGreaterThan(0);
  });
});
