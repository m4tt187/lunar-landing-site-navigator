// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// Builds the terrain assets used by the web application from the NASA LOLA
// 120 m south-polar elevation model (see data/terrain/README.md):
//   - a 480 m copy of the model for skylines at custom coordinates,
//   - a shaded-relief map of everything south of 80 S,
//   - skyline profiles for the curated sites, computed at full 120 m resolution,
//   - colour layers made from the NASA LOLA-team average sunlight and Earth-visibility maps.
//
// Usage: npx tsx tools/terrain/build.ts
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function png(width: number, height: number, rgb: Uint8Array, channels: 3 | 4 = 3): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = channels === 4 ? 6 : 2;
  const rows = Buffer.alloc((width * channels + 1) * height);
  for (let y = 0; y < height; y++) rows.set(rgb.subarray(y * width * channels, (y + 1) * width * channels), y * (width * channels + 1) + 1);
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

const LAYER_PX = 1000;
const LAYERS = [
  { id: 'sun', file: 'avgvisib_85s_060m_201608.img', sha256: '82dadf321dee28f1947c1fed81858d4cf50fe8eb2aa405aae114e8ab21c1efe1', out: 'nasa-average-sunlight.png', grid: 'nasa-average-sunlight-240m.u8', rgb: [255, 191, 71] },
  { id: 'earth', file: 'avgvisib_85s_060m_201608_earth.img', sha256: '0958313069d6039b2474c875ff662f28dbcba2bd853d9ea458aa807b7948c11f', out: 'nasa-average-earth-visibility.png', grid: 'nasa-average-earth-visibility-240m.u8', rgb: [88, 166, 255] },
] as const;

const VIS_N = 5058, VIS_SCALE_M = 60, VIS_VALUE_SCALE = 0.00004, VIS_REDUCE = 4;

/** NASA LOLA-team average-visibility map: 5058 x 5058 samples at 60 m, value = sample x 0.00004. */
function loadVisibility(layer: (typeof LAYERS)[number]): Int16Array {
  const buf = readFileSync(root + 'data/raw/' + layer.file);
  if (createHash('sha256').update(buf).digest('hex') !== layer.sha256) throw new Error(`Unexpected checksum for ${layer.file}`);
  return new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
}

/** Colour layer for the map. */
function visibilityImage(layer: (typeof LAYERS)[number], raw: Int16Array): Buffer {
  const rgba = new Uint8Array(LAYER_PX * LAYER_PX * 4);
  const block = VIS_N / LAYER_PX;
  for (let y = 0; y < LAYER_PX; y++)
    for (let x = 0; x < LAYER_PX; x++) {
      const r0 = Math.floor(y * block), r1 = Math.floor((y + 1) * block), c0 = Math.floor(x * block), c1 = Math.floor((x + 1) * block);
      let sum = 0;
      for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) sum += raw[r * VIS_N + c]!;
      const v = Math.min(1, (sum / ((r1 - r0) * (c1 - c0))) * VIS_VALUE_SCALE);
      // Square-root ramp: most of the pole is dim, so this keeps the low end readable.
      const k = Math.sqrt(v);
      const i = (y * LAYER_PX + x) * 4;
      rgba[i] = Math.round(10 + (layer.rgb[0] - 10) * k);
      rgba[i + 1] = Math.round(12 + (layer.rgb[1] - 12) * k);
      rgba[i + 2] = Math.round(22 + (layer.rgb[2] - 22) * k);
      rgba[i + 3] = 215;
    }
  return png(LAYER_PX, LAYER_PX, rgba, 4);
}

/** The map reduced by block mean to one byte per cell (0..250 = 0..100 %), for values at custom coordinates. */
function visibilityGrid(raw: Int16Array): { bytes: Uint8Array; n: number } {
  const n = Math.floor(VIS_N / VIS_REDUCE);
  const bytes = new Uint8Array(n * n);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      let sum = 0;
      for (let dr = 0; dr < VIS_REDUCE; dr++)
        for (let dc = 0; dc < VIS_REDUCE; dc++) sum += raw[(r * VIS_REDUCE + dr) * VIS_N + c * VIS_REDUCE + dc]!;
      bytes[r * n + c] = Math.round(Math.min(1, (sum / (VIS_REDUCE * VIS_REDUCE)) * VIS_VALUE_SCALE) * 250);
    }
  return { bytes, n };
}

/** Value (0..1) of the 60 m cell containing a point, or null outside the map. */
function visibilityAt(raw: Int16Array, latDeg: number, lonDeg: number): number | null {
  const r = 2 * R_M * Math.tan(((90 + latDeg) * Math.PI) / 360), centre = VIS_N / 2 - 0.5;
  const col = Math.round(centre + (r * Math.sin((lonDeg * Math.PI) / 180)) / VIS_SCALE_M);
  const row = Math.round(centre - (r * Math.cos((lonDeg * Math.PI) / 180)) / VIS_SCALE_M);
  if (col < 0 || row < 0 || col >= VIS_N || row >= VIS_N) return null;
  return Math.round(Math.min(1, raw[row * VIS_N + col]! * VIS_VALUE_SCALE) * 1000) / 1000;
}

/**
 * Best-lit places in the NASA average-sunlight map: cells whose 3 x 3 neighbourhood mean is highest,
 * kept at least `minSeparationM` apart. Returned best first.
 */
function sunlitPeaks(raw: Int16Array, count: number, minSeparationM: number): { latDeg: number; lonDeg: number; value: number }[] {
  const n = VIS_N, candidates: { row: number; col: number; mean: number }[] = [];
  const threshold = 0.5 / VIS_VALUE_SCALE;
  for (let row = 1; row < n - 1; row++)
    for (let col = 1; col < n - 1; col++) {
      if (raw[row * n + col]! < threshold) continue;
      let sum = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) sum += raw[(row + dr) * n + col + dc]!;
      if (sum / 9 >= threshold) candidates.push({ row, col, mean: sum / 9 });
    }
  candidates.sort((a, b) => b.mean - a.mean);
  const picked: { row: number; col: number; mean: number }[] = [];
  const minCells = minSeparationM / VIS_SCALE_M;
  for (const c of candidates) {
    if (picked.length >= count) break;
    if (picked.every((p) => Math.hypot(p.row - c.row, p.col - c.col) >= minCells)) picked.push(c);
  }
  const centre = n / 2 - 0.5;
  return picked.map((p) => {
    const x = (p.col - centre) * VIS_SCALE_M, y = (centre - p.row) * VIS_SCALE_M;
    return {
      latDeg: Math.round((-90 + (2 * Math.atan(Math.hypot(x, y) / (2 * R_M)) * 180) / Math.PI) * 10000) / 10000,
      lonDeg: Math.round(((Math.atan2(x, y) * 180) / Math.PI) * 10000) / 10000,
      value: Math.round(p.mean * VIS_VALUE_SCALE * 1000) / 1000,
    };
  });
}

/** Great-circle distance in km on the 1737.4 km sphere. */
function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const d = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * d) / 2) ** 2 + Math.cos(lat1 * d) * Math.cos(lat2 * d) * Math.sin(((lon2 - lon1) * d) / 2) ** 2;
  return (2 * R_M * Math.asin(Math.sqrt(a))) / 1000;
}

const SKYLINE_STEP_DEG = 0.25, RIDGE_STEP_DEG = 0.5, RIDGE_BANDS_KM = [3, 30];

interface CatalogSite { id: string; name: string; group: string; latDeg: number; lonDeg: number; [key: string]: unknown }

function main(): void {
  mkdirSync(OUT, { recursive: true });
  const dem = loadDem();
  console.log(`model loaded: ${dem.n} x ${dem.n}, highest point ${dem.maxHeightM} m`);

  const coarse = reduce(dem, 4);
  writeFileSync(OUT + 'ldem_75s_480m.i16', Buffer.from(coarse.raw.buffer, coarse.raw.byteOffset, coarse.raw.byteLength));

  const map = reliefMap(dem);
  let mapFile = 'south-pole-relief.png';
  writeFileSync(OUT + mapFile, map.image);
  try {
    // Smaller download where the macOS image tool is available; the PNG is kept otherwise.
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', OUT + mapFile, '--out', OUT + 'south-pole-relief.jpg'], { stdio: 'ignore' });
    rmSync(OUT + mapFile);
    mapFile = 'south-pole-relief.jpg';
  } catch { /* keep the PNG */ }

  const visibility = LAYERS.map((layer) => ({ layer, raw: loadVisibility(layer) }));
  const layers = visibility.map(({ layer, raw }) => {
    writeFileSync(OUT + layer.out, visibilityImage(layer, raw));
    const grid = visibilityGrid(raw);
    writeFileSync(OUT + layer.grid, grid.bytes);
    return { id: layer.id, file: layer.out, halfWidthM: (VIS_N * VIS_SCALE_M) / 2, grid: { file: layer.grid, n: grid.n, scaleM: VIS_SCALE_M * VIS_REDUCE, valueScale: 1 / 250 } };
  });
  const longTerm = (latDeg: number, lonDeg: number): { sunlight: number; earth: number } | null => {
    const sunlight = visibilityAt(visibility[0]!.raw, latDeg, lonDeg), earth = visibilityAt(visibility[1]!.raw, latDeg, lonDeg);
    return sunlight === null || earth === null ? null : { sunlight, earth };
  };

  const catalog = JSON.parse(readFileSync(root + 'data/sites/catalog.json', 'utf8')) as { sites: CatalogSite[] };
  // Add the best-lit places found in the NASA average-sunlight map as candidate sites.
  const features = catalog.sites.filter((s) => s.group === 'feature');
  const peaks: CatalogSite[] = sunlitPeaks(visibility[0]!.raw, 8, 6000).map((peak, i) => {
    const nearest = features.map((f) => ({ f, km: distanceKm(peak.latDeg, peak.lonDeg, f.latDeg, f.lonDeg) })).sort((a, b) => a.km - b.km)[0]!;
    const near = nearest.f.name.replace(' crater (centre)', '');
    return {
      id: `sunlit-${i + 1}`, name: `Sunlit peak ${i + 1} (near ${near})`, group: 'sunlit',
      agency: 'Found in the NASA LOLA-team average-sunlight map', latDeg: peak.latDeg, lonDeg: peak.lonDeg,
      kind: 'derived from NASA data', date: '',
      note: `One of the eight best-lit places in NASA's long-term sunlight map, ${Math.round(nearest.km)} km from the centre of ${near}`,
      source: { title: 'NASA LOLA team, average solar illumination map AVGVISIB_85S_060M_201608', url: 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/extras/illumination/' },
    };
  });
  const sites = [...catalog.sites, ...peaks].map((site) => {
    if (site.latDeg > MAP_MIN_LAT) return { ...site, terrain: null, nasaLongTerm: null };
    const round = (values: Float32Array): number[] => Array.from(values, (v) => Math.round(v * 100) / 100);
    const profiles: Record<string, number[]> = {};
    let truncated = false, ground = 0;
    for (const mast of MAST_HEIGHTS_M) {
      const t = computeTerrainHorizon(dem, site.latDeg, site.lonDeg, mast, { azStepDeg: SKYLINE_STEP_DEG, maxDistanceKm: 400 });
      profiles[String(mast)] = round(t.profile.elDeg);
      truncated ||= t.truncated; ground = t.groundHeightM;
    }
    // Skylines of the terrain closer than 3 km and 30 km (2 m height): they tell a nearby ridge from a far massif.
    const band = (km: number): number[] =>
      round(computeTerrainHorizon(dem, site.latDeg, site.lonDeg, MAST_HEIGHTS_M[0]!, { azStepDeg: RIDGE_STEP_DEG, maxDistanceKm: km }).profile.elDeg);
    console.log(`${site.id}: ground ${ground.toFixed(0)} m${truncated ? ' (model edge reached)' : ''}`);
    return {
      ...site,
      terrain: {
        groundHeightM: Math.round(ground), azStepDeg: SKYLINE_STEP_DEG, modelEdgeReached: truncated, profiles,
        ridges: { azStepDeg: RIDGE_STEP_DEG, bandsKm: RIDGE_BANDS_KM, near: band(RIDGE_BANDS_KM[0]!), mid: band(RIDGE_BANDS_KM[1]!) },
      },
      nasaLongTerm: longTerm(site.latDeg, site.lonDeg),
    };
  });
  writeFileSync(OUT + 'sites.json', JSON.stringify({ mastHeightsM: MAST_HEIGHTS_M, sites }));

  writeFileSync(OUT + 'terrain.json', JSON.stringify({
    source: 'NASA LRO LOLA gridded data record LDEM_75S_120M (PDS data set LRO-L-LOLA-4-GDR-V1.0)',
    coarse: { file: 'ldem_75s_480m.i16', n: coarse.n, scaleM: coarse.scaleM, heightScale: coarse.heightScale, sampleType: 'int16 little-endian, block mean of 4 x 4 source pixels' },
    map: { file: mapFile, sizePx: MAP_PX, halfWidthM: map.halfWidthM, minLatDeg: MAP_MIN_LAT },
    layers: { source: 'NASA LOLA team, AVGVISIB_85S_060M_201608 and AVGVISIB_85S_060M_201608_EARTH (average visibility of the solar disc and of the Earth disc, Mazarico et al. 2011 method)', items: layers },
    check: { southPoleHeightM: Math.round(demHeightAt(dem, -90, 0)) },
  }, null, 1));
  console.log('done');
}

main();
