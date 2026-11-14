// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// Builds the terrain assets used by the web application from the NASA LOLA
// 120 m south-polar elevation model (see data/terrain/README.md):
//   - a 480 m copy of the model for skylines at custom coordinates,
//   - a shaded-relief map of everything south of 80 S,
//   - skyline profiles for the curated sites, computed at full 120 m resolution.
//
// Usage: npx tsx tools/terrain/build.ts
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { computeTerrainHorizon, demHeightAt, makePolarDem } from '../../engine/src/index.ts';
import type { PolarDem } from '../../engine/src/index.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE = 'data/raw/ldem_75s_120m.img';
const SOURCE_SHA256 = 'ae3afc3c75c33d43666ca06c83ca08f0b12ef03b7d36d2d791d972730794391b';
const N = 7624, SCALE_M = 120, HEIGHT_SCALE = 0.5;
const OUT = root + 'web/public/data/';
export const MAST_HEIGHTS_M = [2, 10, 50];
const MAP_PX = 1400, MAP_MIN_LAT = -80;
const R_M = 1737400;

function loadDem(): PolarDem {
  const buf = readFileSync(root + SOURCE);
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== SOURCE_SHA256) throw new Error(`Unexpected checksum for ${SOURCE}: ${sha}`);
  return makePolarDem(new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2), N, SCALE_M, HEIGHT_SCALE);
}

/** Block-mean reduction by an integer factor. */
function reduce(dem: PolarDem, factor: number): PolarDem {
  const n = dem.n / factor;
  if (!Number.isInteger(n)) throw new Error('Reduction factor must divide the grid size.');
  const raw = new Int16Array(n * n);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      let sum = 0;
      for (let dr = 0; dr < factor; dr++)
        for (let dc = 0; dc < factor; dc++) sum += dem.raw[(r * factor + dr) * dem.n + c * factor + dc]!;
      raw[r * n + c] = Math.round(sum / (factor * factor));
    }
  return makePolarDem(raw, n, dem.scaleM * factor, dem.heightScale);
}

function png(width: number, height: number, rgb: Uint8Array): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) rows.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Shaded relief with a height tint, in the same polar stereographic layout as the model. */
function reliefMap(dem: PolarDem): { image: Buffer; halfWidthM: number } {
  const halfWidthM = 2 * R_M * Math.tan(((90 + MAP_MIN_LAT) * Math.PI) / 360);
  const px = (2 * halfWidthM) / MAP_PX;
  const h = new Float32Array(MAP_PX * MAP_PX);
  const centre = dem.n / 2 - 0.5;
  const block = Math.max(1, Math.round(px / dem.scaleM));
  for (let y = 0; y < MAP_PX; y++)
    for (let x = 0; x < MAP_PX; x++) {
      const col = Math.round(centre + ((x + 0.5) * px - halfWidthM) / dem.scaleM - block / 2);
      const row = Math.round(centre + ((y + 0.5) * px - halfWidthM) / dem.scaleM - block / 2);
      let sum = 0;
      for (let dr = 0; dr < block; dr++) for (let dc = 0; dc < block; dc++) sum += dem.raw[(row + dr) * dem.n + col + dc]!;
      h[y * MAP_PX + x] = (sum / (block * block)) * dem.heightScale;
    }
  const rgb = new Uint8Array(MAP_PX * MAP_PX * 3);
  const light = [-0.5, -0.5, 0.707];
  for (let y = 0; y < MAP_PX; y++)
    for (let x = 0; x < MAP_PX; x++) {
      const xl = Math.max(0, x - 1), xr = Math.min(MAP_PX - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(MAP_PX - 1, y + 1);
      const dzdx = (h[y * MAP_PX + xr]! - h[y * MAP_PX + xl]!) / ((xr - xl) * px);
      const dzdy = (h[yd * MAP_PX + x]! - h[yu * MAP_PX + x]!) / ((yd - yu) * px);
      const nx = -dzdx * 2.5, ny = -dzdy * 2.5, norm = Math.hypot(nx, ny, 1);
      const shade = Math.max(0, (nx * light[0]! + ny * light[1]! + light[2]!) / norm);
      const t = Math.min(1, Math.max(0, (h[y * MAP_PX + x]! + 4500) / 10500));
      const lum = 0.18 + 0.82 * shade;
      const i = (y * MAP_PX + x) * 3;
      rgb[i] = Math.round(255 * lum * (0.42 + 0.50 * t));
      rgb[i + 1] = Math.round(255 * lum * (0.46 + 0.42 * t));
      rgb[i + 2] = Math.round(255 * lum * (0.56 + 0.26 * t));
    }
  return { image: png(MAP_PX, MAP_PX, rgb), halfWidthM };
}

interface CatalogSite { id: string; latDeg: number; lonDeg: number; [key: string]: unknown }

function main(): void {
  mkdirSync(OUT, { recursive: true });
  const dem = loadDem();
  console.log(`model loaded: ${dem.n} x ${dem.n}, highest point ${dem.maxHeightM} m`);

  const coarse = reduce(dem, 4);
  writeFileSync(OUT + 'ldem_75s_480m.i16', Buffer.from(coarse.raw.buffer, coarse.raw.byteOffset, coarse.raw.byteLength));

  const map = reliefMap(dem);
  writeFileSync(OUT + 'south-pole-relief.png', map.image);

  const catalog = JSON.parse(readFileSync(root + 'data/sites/catalog.json', 'utf8')) as { sites: CatalogSite[] };
  const sites = catalog.sites.map((site) => {
    if (site.latDeg > MAP_MIN_LAT) return { ...site, terrain: null };
    const profiles: Record<string, number[]> = {};
    let truncated = false, ground = 0;
    for (const mast of MAST_HEIGHTS_M) {
      const t = computeTerrainHorizon(dem, site.latDeg, site.lonDeg, mast, { azStepDeg: 0.5, maxDistanceKm: 400 });
      profiles[String(mast)] = Array.from(t.profile.elDeg, (v) => Math.round(v * 100) / 100);
      truncated ||= t.truncated; ground = t.groundHeightM;
    }
    console.log(`${site.id}: ground ${ground.toFixed(0)} m${truncated ? ' (model edge reached)' : ''}`);
    return { ...site, terrain: { groundHeightM: Math.round(ground), azStepDeg: 0.5, modelEdgeReached: truncated, profiles } };
  });
  writeFileSync(OUT + 'sites.json', JSON.stringify({ mastHeightsM: MAST_HEIGHTS_M, sites }));

  writeFileSync(OUT + 'terrain.json', JSON.stringify({
    source: 'NASA LRO LOLA gridded data record LDEM_75S_120M (PDS data set LRO-L-LOLA-4-GDR-V1.0)',
    coarse: { file: 'ldem_75s_480m.i16', n: coarse.n, scaleM: coarse.scaleM, heightScale: coarse.heightScale, sampleType: 'int16 little-endian, block mean of 4 x 4 source pixels' },
    map: { file: 'south-pole-relief.png', sizePx: MAP_PX, halfWidthM: map.halfWidthM, minLatDeg: MAP_MIN_LAT },
    check: { southPoleHeightM: Math.round(demHeightAt(dem, -90, 0)) },
  }, null, 1));
  console.log('done');
}

main();
