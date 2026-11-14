// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
import { FLAT_HORIZON, computeTerrainHorizon, makePolarDem } from '@engine/index';
import type { HorizonProfile, PolarDem } from '@engine/index';

export interface CatalogSite {
  id: string; name: string; group: 'apollo' | 'robotic' | 'feature'; agency: string;
  latDeg: number; lonDeg: number; kind: string; date: string; note: string;
  source: { title: string; url: string };
  terrain: null | {
    groundHeightM: number; azStepDeg: number; modelEdgeReached: boolean; profiles: Record<string, number[]>;
  };
}
export interface TerrainMeta {
  source: string;
  coarse: { file: string; n: number; scaleM: number; heightScale: number };
  map: { file: string; sizePx: number; halfWidthM: number; minLatDeg: number };
}
export interface AppData { sites: CatalogSite[]; mastHeightsM: number[]; terrain: TerrainMeta }

export type TerrainKind = 'lola-120m' | 'lola-480m' | 'none';
export interface SiteTerrain { profile: HorizonProfile; groundHeightM: number; kind: TerrainKind; modelEdgeReached: boolean }

const base = `${import.meta.env.BASE_URL}data/`;

export async function loadData(): Promise<AppData> {
  const [sites, terrain] = await Promise.all([
    fetch(`${base}sites.json`).then((r) => r.json() as Promise<{ sites: CatalogSite[]; mastHeightsM: number[] }>),
    fetch(`${base}terrain.json`).then((r) => r.json() as Promise<TerrainMeta>),
  ]);
  return { sites: sites.sites, mastHeightsM: sites.mastHeightsM, terrain };
}

export const mapUrl = (meta: TerrainMeta): string => base + meta.map.file;

let demPromise: Promise<PolarDem> | null = null;
/** The 480 m elevation model, fetched once and only when a custom site needs it. */
export function loadDem(meta: TerrainMeta): Promise<PolarDem> {
  demPromise ??= fetch(base + meta.coarse.file)
    .then((r) => {
      if (!r.ok) throw new Error(`Elevation model not available (${r.status})`);
      return r.arrayBuffer();
    })
    .then((buffer) => makePolarDem(new Int16Array(buffer), meta.coarse.n, meta.coarse.scaleM, meta.coarse.heightScale));
  return demPromise;
}

const catalogCache = new Map<string, SiteTerrain>();
export function catalogTerrain(site: CatalogSite, mastM: number): SiteTerrain {
  const key = `${site.id}|${mastM}`;
  let t = catalogCache.get(key);
  if (!t) {
    const values = site.terrain?.profiles[String(mastM)];
    t = site.terrain && values
      ? {
          profile: { azStepDeg: site.terrain.azStepDeg, elDeg: Float32Array.from(values) },
          groundHeightM: site.terrain.groundHeightM, kind: 'lola-120m', modelEdgeReached: site.terrain.modelEdgeReached,
        }
      : { profile: FLAT_HORIZON, groundHeightM: 0, kind: 'none', modelEdgeReached: false };
    catalogCache.set(key, t);
  }
  return t;
}

const customCache = new Map<string, SiteTerrain>();
export function customTerrain(dem: PolarDem, meta: TerrainMeta, latDeg: number, lonDeg: number, mastM: number): SiteTerrain {
  if (latDeg > meta.map.minLatDeg) return { profile: FLAT_HORIZON, groundHeightM: 0, kind: 'none', modelEdgeReached: false };
  const key = `${latDeg}|${lonDeg}|${mastM}`;
  let t = customCache.get(key);
  if (!t) {
    const h = computeTerrainHorizon(dem, latDeg, lonDeg, mastM, { azStepDeg: 0.5, maxDistanceKm: 400 });
    t = { profile: h.profile, groundHeightM: Math.round(h.groundHeightM), kind: 'lola-480m', modelEdgeReached: h.truncated };
    customCache.set(key, t);
  }
  return t;
}
