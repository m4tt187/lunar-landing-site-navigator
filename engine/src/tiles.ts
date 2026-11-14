// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// NASA's 120 m south-polar elevation model cut into small square tiles, so a
// site picked on the map loads only the terrain around it instead of the whole
// 116 MB grid. A tile set is the full polar grid of terrain.ts (same projection,
// same pixel positions) split into blocks of `tile` x `tile` samples; this file
// decodes the tiles and samples them exactly as demHeightAt samples the full grid.
import { demPixel } from './terrain';
import type { HeightField, PolarDem } from './terrain';

const R_M = 1737400;
/** Tile keys pack two indices into one number: ty * KEY_SPAN + tx. */
const KEY_SPAN = 65536;
const NO_SAMPLES = new Int16Array(0);

/** Geometry of a tiled polar grid; the fields mirror PolarDem. */
export interface TileSetSpec {
  /** Lines = samples of the full grid. */
  n: number;
  /** Metres per pixel at the pole. */
  scaleM: number;
  /** Height in metres = raw * heightScale. */
  heightScale: number;
  /** Samples along one side of a tile. */
  tile: number;
  /** Upper bound of every height in the tile set, in metres. */
  maxHeightM: number;
}

/** Column (tx) and row (ty) of a tile; tile (tx, ty) starts at grid column tx * tile, row ty * tile. */
export interface TileKey { tx: number; ty: number }

/** The tiles loaded so far; the map key is ty * 65536 + tx. */
export interface TileStore { spec: TileSetSpec; tiles: Map<number, Int16Array> }

export type TileEncoding = 'int16le-left-gzip' | 'int16le-plane-gzip';

function validateSpec(spec: TileSetSpec): void {
  if (!Number.isSafeInteger(spec.n) || spec.n < 2)
    throw new RangeError('Tile set grid must have at least two rows and columns.');
  if (!Number.isSafeInteger(spec.tile) || spec.tile < 1 || spec.tile > 4096 || Math.ceil(spec.n / spec.tile) > KEY_SPAN)
    throw new RangeError('Tile size must be an integer from 1 to 4096 samples giving at most 65536 tiles per side.');
  if (!Number.isFinite(spec.scaleM) || spec.scaleM <= 0 || !Number.isFinite(spec.heightScale) || spec.heightScale <= 0)
    throw new RangeError('Tile set scales must be positive finite numbers.');
  if (!Number.isFinite(spec.maxHeightM) || R_M + spec.maxHeightM <= 0)
    throw new RangeError('Tile set maximum height must be finite and above the lunar centre.');
}

function validateTileSize(tile: number): void {
  if (!Number.isSafeInteger(tile) || tile < 1 || tile > 4096)
    throw new RangeError('Tile size must be an integer from 1 to 4096 samples.');
}

function validateEncoding(encoding: string): asserts encoding is TileEncoding {
  if (encoding !== 'int16le-left-gzip' && encoding !== 'int16le-plane-gzip')
    throw new RangeError(`Unknown tile encoding: ${encoding}.`);
}

function validateField(field: HeightField): void {
  if (typeof field?.heightAt !== 'function' || !Number.isFinite(field.resolutionM) || field.resolutionM <= 0)
    throw new RangeError('Height field must provide a sampler and a positive finite resolution.');
  if (!Number.isFinite(field.maxHeightM) || R_M + field.maxHeightM <= 0)
    throw new RangeError('Height field maximum must be finite and above the lunar centre.');
}

/** Number of tiles along one side of the grid; the last one may be partly padding. */
function tilesPerSide(spec: TileSetSpec): number {
  return Math.ceil(spec.n / spec.tile);
}

/** Only n and scaleM matter to demPixel; sharing it keeps tiles on the very same pixel lattice as the full grid. */
function geometryOf(spec: TileSetSpec): PolarDem {
  return { n: spec.n, scaleM: spec.scaleM, raw: NO_SAMPLES, heightScale: spec.heightScale, maxHeightM: spec.maxHeightM };
}

export function createTileStore(spec: TileSetSpec): TileStore {
  validateSpec(spec);
  return { spec: { ...spec }, tiles: new Map() };
}

/**
 * Add (or replace) one decoded tile. The array is kept, not copied. Samples
 * inside the grid must respect the declared maximum height: the skyline search
 * stops early on that bound, so a tile above it could hide a mountain.
 */
export function addTile(store: TileStore, tx: number, ty: number, heights: Int16Array): void {
  const spec = store.spec;
  validateSpec(spec);
  const perSide = tilesPerSide(spec), tile = spec.tile;
  if (!Number.isInteger(tx) || !Number.isInteger(ty) || tx < 0 || ty < 0 || tx >= perSide || ty >= perSide)
    throw new RangeError(`Tile indices must be integers from 0 to ${perSide - 1}.`);
  if (!(heights instanceof Int16Array) || heights.length !== tile * tile)
    throw new RangeError(`A tile must hold ${tile} x ${tile} Int16 samples.`);
  const limit = (spec.maxHeightM + 1e-9 * Math.max(1, Math.abs(spec.maxHeightM))) / spec.heightScale;
  const cols = Math.min(tile, spec.n - tx * tile), rows = Math.min(tile, spec.n - ty * tile);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (heights[r * tile + c]! > limit) throw new RangeError('Tile heights exceed the declared maximum height.');
  store.tiles.set(ty * KEY_SPAN + tx, heights);
}

/** What the predictor expects at a sample, from the samples already known (row-major order). */
function predicted(heights: Int16Array, tile: number, r: number, c: number, plane: boolean): number {
  const i = r * tile + c;
  if (c === 0) return r === 0 ? 0 : heights[i - tile]!;
  if (r === 0 || !plane) return heights[i - 1]!;
  return heights[i - 1]! + heights[i - tile]! - heights[i - tile - 1]!;
}

/**
 * Heights (raw units) of one tile from the gunzipped bytes of its file.
 * The bytes hold prediction residuals as little-endian Int16, read byte by byte
 * so the result does not depend on the platform's byte order. Sums wrap around
 * in 16 bits, which makes the decoding exact for any heights.
 */
export function decodeTile(bytes: Uint8Array, tile: number, encoding: string): Int16Array {
  validateTileSize(tile);
  validateEncoding(encoding);
  if (!(bytes instanceof Uint8Array) || bytes.length !== tile * tile * 2)
    throw new RangeError(`A decompressed tile must be ${tile * tile * 2} bytes (${tile} x ${tile} Int16 samples).`);
  const plane = encoding === 'int16le-plane-gzip';
  const heights = new Int16Array(tile * tile);
  for (let r = 0; r < tile; r++)
    for (let c = 0; c < tile; c++) {
      const i = r * tile + c;
      // Storing into an Int16Array wraps modulo 65536, undoing the encoder's wrap.
      heights[i] = predicted(heights, tile, r, c, plane) + (bytes[2 * i]! | (bytes[2 * i + 1]! << 8));
    }
  return heights;
}

/** Inverse of decodeTile: the bytes to compress for one tile. Used by the tile builder and by the tests. */
export function encodeTile(heights: Int16Array, tile: number, encoding: string): Uint8Array {
  validateTileSize(tile);
  validateEncoding(encoding);
  if (!(heights instanceof Int16Array) || heights.length !== tile * tile)
    throw new RangeError(`A tile must hold ${tile} x ${tile} Int16 samples.`);
  const plane = encoding === 'int16le-plane-gzip';
  const bytes = new Uint8Array(tile * tile * 2);
  for (let r = 0; r < tile; r++)
    for (let c = 0; c < tile; c++) {
      const i = r * tile + c;
      const residual = heights[i]! - predicted(heights, tile, r, c, plane);
      bytes[2 * i] = residual & 255;
      bytes[2 * i + 1] = (residual >> 8) & 255;
    }
  return bytes;
}

/**
 * The (2 * ring + 1)^2 block of tiles around the tile containing a point,
 * clipped to the grid and sorted by row then column. With ring 1 the terrain is
 * known at least one tile width away from the point in every direction.
 * A point outside the grid has no tile: the result is empty.
 */
export function tilesAround(spec: TileSetSpec, latDeg: number, lonDeg: number, ring = 1): TileKey[] {
  validateSpec(spec);
  if (!Number.isInteger(ring) || ring < 0 || ring > KEY_SPAN)
    throw new RangeError('Tile ring must be a non-negative integer.');
  const { col, row } = demPixel(geometryOf(spec), latDeg, lonDeg);
  const last = spec.n - 1;
  if (!(col >= 0 && row >= 0 && col <= last && row <= last)) return [];
  const perSide = tilesPerSide(spec);
  const tx = Math.floor(col / spec.tile), ty = Math.floor(row / spec.tile);
  const keys: TileKey[] = [];
  for (let y = Math.max(0, ty - ring); y <= Math.min(perSide - 1, ty + ring); y++)
    for (let x = Math.max(0, tx - ring); x <= Math.min(perSide - 1, tx + ring); x++) keys.push({ tx: x, ty: y });
  return keys;
}

/**
 * Terrain sampler over the loaded tiles: bilinear, with the same arithmetic as
 * demHeightAt on the full grid, so the two agree exactly wherever the four
 * neighbouring samples are in loaded tiles. Anywhere else the height is NaN
 * (unknown), never a guess. Tiles added to the store later are seen at once.
 */
export function tileField(store: TileStore): HeightField {
  const spec = store.spec;
  validateSpec(spec);
  const { n, tile, heightScale } = spec;
  const tiles = store.tiles;
  const grid = geometryOf(spec);
  /** One grid sample, or NaN when its tile is not loaded. */
  const sampleAt = (c: number, r: number): number => {
    const tx = Math.floor(c / tile), ty = Math.floor(r / tile);
    const heights = tiles.get(ty * KEY_SPAN + tx);
    return heights === undefined ? NaN : heights[(r - ty * tile) * tile + (c - tx * tile)]!;
  };
  return {
    maxHeightM: spec.maxHeightM,
    resolutionM: spec.scaleM,
    heightAt(latDeg: number, lonDeg: number): number {
      const { col, row } = demPixel(grid, latDeg, lonDeg);
      if (!(col >= 0 && row >= 0 && col <= n - 1 && row <= n - 1)) return NaN;
      const c0 = Math.min(n - 2, Math.floor(col)), r0 = Math.min(n - 2, Math.floor(row));
      const fc = col - c0, fr = row - r0;
      const tx = Math.floor(c0 / tile), ty = Math.floor(r0 / tile);
      const cx = c0 - tx * tile, ry = r0 - ty * tile;
      let h00: number, h01: number, h10: number, h11: number;
      if (cx < tile - 1 && ry < tile - 1) {
        // The usual case: all four samples in one tile, one lookup.
        const heights = tiles.get(ty * KEY_SPAN + tx);
        if (heights === undefined) return NaN;
        const i = ry * tile + cx;
        h00 = heights[i]!; h01 = heights[i + 1]!; h10 = heights[i + tile]!; h11 = heights[i + tile + 1]!;
      } else {
        h00 = sampleAt(c0, r0); h01 = sampleAt(c0 + 1, r0); h10 = sampleAt(c0, r0 + 1); h11 = sampleAt(c0 + 1, r0 + 1);
        if (Number.isNaN(h00) || Number.isNaN(h01) || Number.isNaN(h10) || Number.isNaN(h11)) return NaN;
      }
      return ((h00 * (1 - fc) + h01 * fc) * (1 - fr) + (h10 * (1 - fc) + h11 * fc) * fr) * heightScale;
    },
  };
}

/**
 * Fine terrain where it is known, coarse terrain everywhere else: the field to
 * give computeTerrainHorizon for a site whose surroundings are loaded as tiles.
 */
export function compositeField(near: HeightField, far: HeightField): HeightField {
  validateField(near); validateField(far);
  return {
    maxHeightM: Math.max(near.maxHeightM, far.maxHeightM),
    resolutionM: near.resolutionM,
    heightAt(latDeg: number, lonDeg: number): number {
      const h = near.heightAt(latDeg, lonDeg);
      return Number.isNaN(h) ? far.heightAt(latDeg, lonDeg) : h;
    },
  };
}
