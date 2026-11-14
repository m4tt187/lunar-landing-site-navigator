// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
import { FLAT_HORIZON, computeTerrainHorizon, makePolarDem } from '@engine/index';
import type { HorizonProfile, PolarDem } from '@engine/index';

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

export type TerrainKind = 'lola-120m' | 'lola-480m' | 'none';
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

export const RIDGE_BANDS_KM = [3, 30];

const customCache = new Map<string, SiteTerrain>();
export function customTerrain(dem: PolarDem, meta: TerrainMeta, latDeg: number, lonDeg: number, mastM: number): SiteTerrain {
  if (latDeg > meta.map.minLatDeg) return NO_TERRAIN;
  const key = `${latDeg}|${lonDeg}|${mastM}`;
  let t = customCache.get(key);
  if (!t) {
    if (customCache.size > 30) customCache.delete(customCache.keys().next().value!);
    const h = computeTerrainHorizon(dem, latDeg, lonDeg, mastM, { azStepDeg: 0.25, maxDistanceKm: 400 });
    const band = (km: number): Float32Array => computeTerrainHorizon(dem, latDeg, lonDeg, mastM, { azStepDeg: 0.5, maxDistanceKm: km }).profile.elDeg;
    t = {
      profile: h.profile, groundHeightM: Math.round(h.groundHeightM), kind: 'lola-480m', modelEdgeReached: h.truncated,
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
