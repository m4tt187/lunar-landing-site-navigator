// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
import {
  FLAT_HORIZON, addTile, compositeField, computeTerrainHorizon, createTileStore, decodeTile, makePolarDem, polarDemField, tileField,
  tilesAround,
} from '@engine/index';
import type { HorizonProfile, PolarDem, TileStore } from '@engine/index';

/** Skylines of the terrain closer than each distance: they show whether an obstacle is a nearby ridge or a far massif. */
export interface RidgeData { azStepDeg: number; bandsKm: number[]; near: number[]; mid: number[] }
export interface Ridges { azStepDeg: number; bandsKm: number[]; near: Float32Array; mid: Float32Array }

export interface CatalogSite {
  id: string; name: string; group: 'apollo' | 'robotic' | 'feature' | 'sunlit' | 'planned'; agency: string;
  latDeg: number; lonDeg: number; kind: string; date: string; note: string;
  source: { title: string; url: string };
  /** Long-term averages from the NASA LOLA-team maps (surface level), where the maps cover the site. */
  nasaLongTerm?: { sunlight: number; earth: number } | null;
  terrain: null | {
    groundHeightM: number; azStepDeg: number; modelEdgeReached: boolean;
    profiles: Record<string, number[]>; ridges?: RidgeData;
  };
}
export interface LayerMeta { id: string; file: string; halfWidthM: number }
export interface TerrainMeta {
  source: string;
  coarse: { file: string; n: number; scaleM: number; heightScale: number };
  map: { file: string; sizePx: number; halfWidthM: number; minLatDeg: number };
  layers?: { source: string; items: LayerMeta[] };
}
export interface AppData { sites: CatalogSite[]; mastHeightsM: number[]; terrain: TerrainMeta }

/**
 * Where a skyline comes from: the complete 120 m model (catalogue sites), the 120 m
 * model near the site with the 480 m model beyond (picked sites), the 480 m model
 * alone (when the tiles cannot be loaded), or no terrain at all.
 */
export type TerrainKind = 'lola-120m' | 'lola-120m-near' | 'lola-480m' | 'none';
export interface SiteTerrain {
  profile: HorizonProfile; groundHeightM: number; kind: TerrainKind; modelEdgeReached: boolean; ridges: Ridges | null;
}

const base = `${import.meta.env.BASE_URL}data/`;

export async function loadData(): Promise<AppData> {
  const get = async <T>(file: string): Promise<T> => {
    const response = await fetch(base + file);
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    return (await response.json()) as T;
  };
  const [sites, terrain] = await Promise.all([
    get<{ sites: CatalogSite[]; mastHeightsM: number[] }>('sites.json'),
    get<TerrainMeta>('terrain.json'),
  ]);
  return { sites: sites.sites, mastHeightsM: sites.mastHeightsM, terrain };
}

export const dataUrl = (file: string): string => base + file;

let demPromise: Promise<PolarDem> | null = null;
/** The 480 m elevation model, fetched once, when a custom site or a computed map layer needs it. */
export function loadDem(meta: TerrainMeta): Promise<PolarDem> {
  demPromise ??= fetch(base + meta.coarse.file)
    .then((r) => {
      if (!r.ok) throw new Error(`Elevation model not available (${r.status})`);
      return r.arrayBuffer();
    })
    .then((buffer) => makePolarDem(new Int16Array(buffer), meta.coarse.n, meta.coarse.scaleM, meta.coarse.heightScale));
  return demPromise;
}

const NO_TERRAIN: SiteTerrain = { profile: FLAT_HORIZON, groundHeightM: 0, kind: 'none', modelEdgeReached: false, ridges: null };

const catalogCache = new Map<string, SiteTerrain>();
export function catalogTerrain(site: CatalogSite, mastM: number): SiteTerrain {
  const key = `${site.id}|${mastM}`;
  let t = catalogCache.get(key);
  if (!t) {
    const values = site.terrain?.profiles[String(mastM)];
    if (site.terrain && values) {
      const r = site.terrain.ridges;
      t = {
        profile: { azStepDeg: site.terrain.azStepDeg, elDeg: Float32Array.from(values) },
        groundHeightM: site.terrain.groundHeightM, kind: 'lola-120m', modelEdgeReached: site.terrain.modelEdgeReached,
        ridges: r ? { azStepDeg: r.azStepDeg, bandsKm: r.bandsKm, near: Float32Array.from(r.near), mid: Float32Array.from(r.mid) } : null,
      };
    } else t = NO_TERRAIN;
    catalogCache.set(key, t);
  }
  return t;
}

/** The 120 m model, shipped as tiles and loaded only around the sites that need it. */
export interface FineTerrain { store: TileStore; listed: Set<number>; capLatDeg: number }
interface TileIndex {
  n: number; scaleM: number; heightScale: number; tile: number; encoding: string; capLatDeg: number; maxHeightM: number;
  tiles: [number, number][];
}
const TILE_DIR = 'tiles/120m/';
const tileKey = (tx: number, ty: number): number => ty * 65536 + tx;

let finePromise: Promise<{ fine: FineTerrain; encoding: string }> | null = null;
function loadFineIndex(): Promise<{ fine: FineTerrain; encoding: string }> {
  finePromise ??= fetch(base + TILE_DIR + 'index.json')
    .then((r) => {
      if (!r.ok) throw new Error(`Terrain tiles not available (${r.status})`);
      return r.json() as Promise<TileIndex>;
    })
    .then((index) => ({
      fine: {
        store: createTileStore({ n: index.n, scaleM: index.scaleM, heightScale: index.heightScale, tile: index.tile, maxHeightM: index.maxHeightM }),
        listed: new Set(index.tiles.map(([tx, ty]) => tileKey(tx, ty))),
        capLatDeg: index.capLatDeg,
      },
      encoding: index.encoding,
    }));
  return finePromise;
}

/** The bytes of a tile file; a server that has already undone the compression is recognised by the missing gzip signature. */
async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  if (!(bytes[0] === 0x1f && bytes[1] === 0x8b)) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const tileLoads = new Map<number, Promise<void>>();
/**
 * Loads the 120 m tiles around a point (the 3 x 3 block, each tile once).
 * Resolves with the tile store when they are all in it, or with null when the
 * point is outside the area the tiles cover. Rejects when a tile cannot be had.
 */
export async function loadFineTerrainAround(latDeg: number, lonDeg: number): Promise<FineTerrain | null> {
  const { fine, encoding } = await loadFineIndex();
  const spec = fine.store.spec;
  const wanted = tilesAround(spec, latDeg, lonDeg, 1);
  if (latDeg > fine.capLatDeg || wanted.length === 0 || wanted.some((k) => !fine.listed.has(tileKey(k.tx, k.ty)))) return null;
  await Promise.all(wanted.map(({ tx, ty }) => {
    const key = tileKey(tx, ty);
    let load = tileLoads.get(key);
    if (!load) {
      load = fetch(`${base}${TILE_DIR}t_${ty}_${tx}.i16.gz`)
        .then((r) => {
          if (!r.ok) throw new Error(`Terrain tile not available (${r.status})`);
          return r.arrayBuffer();
        })
        .then((buffer) => gunzip(new Uint8Array(buffer)))
        .then((bytes) => addTile(fine.store, tx, ty, decodeTile(bytes, spec.tile, encoding)));
      tileLoads.set(key, load);
      load.catch(() => { tileLoads.delete(key); });
    }
    return load;
  }));
  return fine;
}

/** True when every tile around a point is loaded, so that its skyline can be computed from them. */
export function fineTerrainReady(fine: FineTerrain, latDeg: number, lonDeg: number): boolean {
  const wanted = tilesAround(fine.store.spec, latDeg, lonDeg, 1);
  return wanted.length > 0 && wanted.every((k) => fine.store.tiles.has(tileKey(k.tx, k.ty)));
}

export const RIDGE_BANDS_KM = [3, 30];

const customCache = new Map<string, SiteTerrain>();
/**
 * Skyline of a picked site. With the tiles around it loaded (`fine`), the terrain
 * is the 120 m model for at least 30 km around the site and the 480 m model
 * beyond, in one march over the two; without them, the 480 m model alone.
 */
export function customTerrain(dem: PolarDem, meta: TerrainMeta, latDeg: number, lonDeg: number, mastM: number, fine: FineTerrain | null): SiteTerrain {
  if (latDeg > meta.map.minLatDeg) return NO_TERRAIN;
  const key = `${latDeg}|${lonDeg}|${mastM}|${fine ? 'fine' : 'coarse'}`;
  let t = customCache.get(key);
  if (!t) {
    if (customCache.size > 30) customCache.delete(customCache.keys().next().value!);
    const terrain = fine ? compositeField(tileField(fine.store), polarDemField(dem)) : dem;
    const h = computeTerrainHorizon(terrain, latDeg, lonDeg, mastM, { azStepDeg: 0.25, maxDistanceKm: 400 });
    const band = (km: number): Float32Array => computeTerrainHorizon(terrain, latDeg, lonDeg, mastM, { azStepDeg: 0.5, maxDistanceKm: km }).profile.elDeg;
    t = {
      profile: h.profile, groundHeightM: Math.round(h.groundHeightM), kind: fine ? 'lola-120m-near' : 'lola-480m', modelEdgeReached: h.truncated,
      ridges: { azStepDeg: 0.5, bandsKm: RIDGE_BANDS_KM, near: band(RIDGE_BANDS_KM[0]!), mid: band(RIDGE_BANDS_KM[1]!) },
    };
    customCache.set(key, t);
  }
  return t;
}

/** A catalogue site at (practically) these coordinates, so its finer skyline can be reused. */
export function catalogSiteAt(app: AppData, latDeg: number, lonDeg: number): CatalogSite | null {
  return app.sites.find((s) => Math.abs(s.latDeg - latDeg) < 2e-4 && Math.abs(s.lonDeg - lonDeg) * Math.cos((latDeg * Math.PI) / 180) < 2e-4) ?? null;
}
