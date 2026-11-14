// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// Cuts the NASA LOLA 120 m south-polar elevation model (see data/terrain/README.md)
// into losslessly compressed tiles of 256 x 256 samples, so the web application
// can load full-resolution terrain around any point picked on the map.
//
// Usage: npx tsx tools/terrain/tiles.ts [--cap -80] [--verify]
//   --cap <deg>  northernmost cap latitude to try (default -80). If the tiles for
//                it are larger than the size limit, the cap moves one degree south
//                at a time, down to -83.
//   --verify     write nothing: decode every shipped tile and compare it, sample
//                by sample, with the source file; check index.json.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { decodeTile, encodeTile } from '../../engine/src/tiles.ts';
import type { TileEncoding } from '../../engine/src/tiles.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE = 'data/raw/ldem_75s_120m.img';
const LABEL = 'data/raw/ldem_75s_120m.lbl';
const SOURCE_NAME = 'NASA LRO LOLA gridded data record LDEM_75S_120M (PDS data set LRO-L-LOLA-4-GDR-V1.0)';
// Same file and checksum as tools/terrain/build.ts.
const SOURCE_SHA256 = 'ae3afc3c75c33d43666ca06c83ca08f0b12ef03b7d36d2d791d972730794391b';
const N = 7624, SCALE_M = 120, HEIGHT_SCALE = 0.5;
const R_M = 1737400;
const TILE = 256;
const OUT_DIR = 'web/public/data/tiles/120m/';
const SIZE_LIMIT_BYTES = 24_000_000;
const SOUTHERNMOST_CAP_DEG = -83;
const ENCODINGS: TileEncoding[] = ['int16le-left-gzip', 'int16le-plane-gzip'];
const TILE_FILE = /^t_(\d+)_(\d+)\.i16\.gz$/;

type Pair = [tx: number, ty: number];

interface TileIndex {
  source: string; sourceSha256: string; n: number; scaleM: number; heightScale: number; tile: number;
  encoding: string; capLatDeg: number; maxHeightM: number; tiles: Pair[]; totalBytes: number;
}

const fileName = (tx: number, ty: number): string => `t_${ty}_${tx}.i16.gz`;

/** One keyword of the PDS label, without its unit. */
function labelValue(label: string, key: string): string {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*(\\S+)`, 'm').exec(label);
  if (!match) throw new Error(`${LABEL}: keyword ${key} not found`);
  return match[1]!;
}

/** The source grid, after checking that the label and the checksum describe the file this tool expects. */
function loadSource(): Int16Array {
  const label = readFileSync(root + LABEL, 'latin1');
  const expected: [string, string | number][] = [
    ['LINES', N], ['LINE_SAMPLES', N], ['SAMPLE_BITS', 16], ['SAMPLE_TYPE', 'LSB_INTEGER'],
    ['SCALING_FACTOR', HEIGHT_SCALE], ['OFFSET', R_M], ['MAP_SCALE', SCALE_M],
  ];
  for (const [key, value] of expected) {
    const found = labelValue(label, key);
    const same = typeof value === 'number' ? Number(found) === value : found === value;
    if (!same) throw new Error(`${LABEL}: ${key} is ${found}, expected ${value}`);
  }
  const buf = readFileSync(root + SOURCE);
  if (buf.length !== N * N * 2) throw new Error(`${SOURCE}: ${buf.length} bytes, expected ${N * N * 2}`);
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== SOURCE_SHA256) throw new Error(`Unexpected checksum for ${SOURCE}: ${sha}`);
  // Read sample by sample so the result does not depend on this machine's byte order.
  const raw = new Int16Array(N * N);
  for (let i = 0; i < raw.length; i++) raw[i] = buf.readInt16LE(2 * i);
  return raw;
}

/** Samples of one tile; cells beyond the grid stay 0 and are never read by the application. */
function cutTile(raw: Int16Array, tx: number, ty: number): Int16Array {
  const out = new Int16Array(TILE * TILE);
  const cols = Math.min(TILE, N - tx * TILE), rows = Math.min(TILE, N - ty * TILE);
  for (let r = 0; r < rows; r++) {
    const start = (ty * TILE + r) * N + tx * TILE;
    out.set(raw.subarray(start, start + cols), r * TILE);
  }
  return out;
}

/**
 * Tiles needed so that every point at or south of the cap latitude has the full
 * 3 x 3 block around its own tile: the tiles touched by the cap circle and its
 * interior, grown by one tile. Sorted by row, then column.
 */
function tilesForCap(capLatDeg: number): Pair[] {
  const centre = N / 2 - 0.5;
  const radiusPx = (2 * R_M * Math.tan(((90 + capLatDeg) * Math.PI) / 360)) / SCALE_M;
  if (!(capLatDeg > -90) || !(radiusPx <= centre)) throw new Error(`Cap latitude ${capLatDeg} is outside the elevation model.`);
  const perSide = Math.ceil(N / TILE);
  const touched = (tx: number, ty: number): boolean => {
    // Distance from the pole to the nearest point of the tile's square.
    const dx = Math.max(tx * TILE - centre, 0, centre - (tx + 1) * TILE);
    const dy = Math.max(ty * TILE - centre, 0, centre - (ty + 1) * TILE);
    return Math.hypot(dx, dy) <= radiusPx;
  };
  const needed = new Set<number>();
  for (let ty = 0; ty < perSide; ty++)
    for (let tx = 0; tx < perSide; tx++) {
      if (!touched(tx, ty)) continue;
      for (let y = Math.max(0, ty - 1); y <= Math.min(perSide - 1, ty + 1); y++)
        for (let x = Math.max(0, tx - 1); x <= Math.min(perSide - 1, tx + 1); x++) needed.add(y * perSide + x);
    }
  return [...needed].sort((a, b) => a - b).map((k): Pair => [k % perSide, Math.floor(k / perSide)]);
}

/** Gzip with a header that is the same on every operating system. */
function gzip(bytes: Uint8Array): Buffer {
  const out = gzipSync(bytes, { level: 9 });
  // Byte 9 names the operating system that wrote the file; 255 means "unknown".
  out[9] = 255;
  return out;
}

function build(firstCapDeg: number): void {
  const raw = loadSource();
  const compressed = new Map<string, Buffer[]>();
  const encodedTile = (tx: number, ty: number): Buffer[] => {
    const key = fileName(tx, ty);
    let both = compressed.get(key);
    if (!both) {
      const heights = cutTile(raw, tx, ty);
      both = ENCODINGS.map((encoding) => gzip(encodeTile(heights, TILE, encoding)));
      compressed.set(key, both);
    }
    return both;
  };

  let chosen: { capLatDeg: number; tiles: Pair[]; encoding: number; totalBytes: number } | null = null;
  for (let cap = firstCapDeg; cap >= Math.min(firstCapDeg, SOUTHERNMOST_CAP_DEG) && !chosen; cap--) {
    const tiles = tilesForCap(cap);
    const totals = ENCODINGS.map((_, e) => tiles.reduce((sum, [tx, ty]) => sum + encodedTile(tx, ty)[e]!.length, 0));
    const best = totals[1]! < totals[0]! ? 1 : 0;
    const fits = totals[best]! <= SIZE_LIMIT_BYTES;
    console.log(`cap ${cap}: ${tiles.length} tiles; ${ENCODINGS.map((name, e) => `${name} ${totals[e]} bytes`).join('; ')}` +
      ` -> ${fits ? 'fits' : 'exceeds'} the ${SIZE_LIMIT_BYTES}-byte limit`);
    if (fits) chosen = { capLatDeg: cap, tiles, encoding: best, totalBytes: totals[best]! };
  }
  if (!chosen) throw new Error('No cap latitude fits the size limit; nothing written.');

  const dir = root + OUT_DIR;
  mkdirSync(dir, { recursive: true });
  const wanted = new Set(chosen.tiles.map(([tx, ty]) => fileName(tx, ty)));
  // Tiles of an earlier, larger cap would otherwise stay behind and be shipped.
  for (const name of readdirSync(dir)) if (TILE_FILE.test(name) && !wanted.has(name)) rmSync(dir + name);
  let max = -32768;
  for (const [tx, ty] of chosen.tiles) {
    writeFileSync(dir + fileName(tx, ty), encodedTile(tx, ty)[chosen.encoding]!);
    const cols = Math.min(TILE, N - tx * TILE), rows = Math.min(TILE, N - ty * TILE);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) max = Math.max(max, raw[(ty * TILE + r) * N + tx * TILE + c]!);
  }
  const index: TileIndex = {
    source: SOURCE_NAME, sourceSha256: SOURCE_SHA256, n: N, scaleM: SCALE_M, heightScale: HEIGHT_SCALE, tile: TILE,
    encoding: ENCODINGS[chosen.encoding]!, capLatDeg: chosen.capLatDeg, maxHeightM: max * HEIGHT_SCALE,
    tiles: chosen.tiles, totalBytes: chosen.totalBytes,
  };
  // One short line per field; the long tile list stays on a single line.
  const lines = Object.entries(index).map(([key, value]) => ` ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  writeFileSync(dir + 'index.json', `{\n${lines.join(',\n')}\n}\n`);
  console.log(`written ${chosen.tiles.length} tiles, ${chosen.totalBytes} bytes, cap ${chosen.capLatDeg}, ` +
    `${index.encoding}, highest point ${index.maxHeightM} m -> ${OUT_DIR}`);
}

function verify(): void {
  const raw = loadSource();
  const dir = root + OUT_DIR;
  const index = JSON.parse(readFileSync(dir + 'index.json', 'utf8')) as TileIndex;
  const problems: string[] = [];
  const check = (ok: boolean, message: string): void => { if (!ok) problems.push(message); };
  check(index.source === SOURCE_NAME && index.sourceSha256 === SOURCE_SHA256, 'index.json names a different source file');
  check(index.n === N && index.scaleM === SCALE_M && index.heightScale === HEIGHT_SCALE && index.tile === TILE,
    'index.json grid description differs from the source');
  check(ENCODINGS.includes(index.encoding as TileEncoding), `unknown encoding ${index.encoding}`);
  check(JSON.stringify(index.tiles) === JSON.stringify(tilesForCap(index.capLatDeg)),
    `tile list is not the sorted list needed for cap ${index.capLatDeg}`);
  const listed = new Set(index.tiles.map(([tx, ty]) => fileName(tx, ty)));
  for (const name of readdirSync(dir)) check(!TILE_FILE.test(name) || listed.has(name), `${name} is not listed in index.json`);

  let totalBytes = 0, samples = 0, max = -32768;
  for (const [tx, ty] of index.tiles) {
    const path = dir + fileName(tx, ty);
    if (!existsSync(path)) { problems.push(`${fileName(tx, ty)} is missing`); continue; }
    totalBytes += statSync(path).size;
    const heights = decodeTile(gunzipSync(readFileSync(path)), TILE, index.encoding);
    let different = 0;
    for (let r = 0; r < TILE; r++)
      for (let c = 0; c < TILE; c++) {
        const col = tx * TILE + c, row = ty * TILE + r;
        const inside = col < N && row < N;
        const source = inside ? raw[row * N + col]! : 0;
        if (heights[r * TILE + c] !== source) different++;
        if (inside) { samples++; max = Math.max(max, source); }
      }
    check(different === 0, `${fileName(tx, ty)}: ${different} samples differ from the source`);
  }
  check(totalBytes === index.totalBytes, `totalBytes is ${index.totalBytes}, the files add up to ${totalBytes}`);
  check(max * HEIGHT_SCALE === index.maxHeightM, `maxHeightM is ${index.maxHeightM}, the tiles reach ${max * HEIGHT_SCALE}`);
  if (problems.length > 0) {
    for (const problem of problems) console.error('FAIL ' + problem);
    process.exitCode = 1;
    return;
  }
  console.log(`verified: ${index.tiles.length} tiles, ${samples} samples identical to ${SOURCE}; ` +
    `index.json consistent (cap ${index.capLatDeg}, ${index.encoding}, ${totalBytes} bytes, highest point ${index.maxHeightM} m)`);
}

function main(): void {
  const args = process.argv.slice(2);
  let cap = -80, verifyOnly = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--verify') verifyOnly = true;
    else if (args[i] === '--cap' && Number.isInteger(Number(args[i + 1] ?? NaN))) cap = Number(args[++i]);
    else throw new Error(`Unknown or incomplete argument: ${args[i]}. Usage: npx tsx tools/terrain/tiles.ts [--cap -80] [--verify]`);
  }
  if (verifyOnly) verify(); else build(cap);
}

main();
