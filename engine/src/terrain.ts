// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// Terrain skyline from a NASA LOLA polar elevation model.
//
// Grid geometry follows the LOLA team's DSMAP_POLAR.CAT description: spherical
// polar stereographic projection centred on the south pole, radius 1737.4 km,
// longitude 0 pointing up, 90 E pointing right, scale exact at the pole.
import type { HorizonProfile } from './types';

const R_M = 1737400;
const DEG = Math.PI / 180;

/** A square south-polar elevation grid; heights in metres above the 1737.4 km sphere. */
export interface PolarDem {
  /** Lines = samples. */
  n: number;
  /** Metres per pixel at the pole. */
  scaleM: number;
  /** Row-major heights; value = raw * heightScale. */
  raw: Int16Array;
  heightScale: number;
  /** Highest height in the grid (metres), used to stop the search early. */
  maxHeightM: number;
}

export function makePolarDem(raw: Int16Array, n: number, scaleM: number, heightScale: number): PolarDem {
  if (raw.length !== n * n) throw new RangeError('Elevation grid size does not match its dimensions.');
  let max = -32768;
  for (let i = 0; i < raw.length; i++) if (raw[i]! > max) max = raw[i]!;
  return { n, scaleM, raw, heightScale, maxHeightM: max * heightScale };
}

/** Fractional column/row of a latitude/longitude (degrees, east positive). */
export function demPixel(dem: PolarDem, latDeg: number, lonDeg: number): { col: number; row: number } {
  const r = 2 * R_M * Math.tan(((90 + latDeg) * DEG) / 2);
  const c = dem.n / 2 - 0.5;
  return { col: c + (r * Math.sin(lonDeg * DEG)) / dem.scaleM, row: c - (r * Math.cos(lonDeg * DEG)) / dem.scaleM };
}

/** Southernmost latitude circle fully inside the grid is the pole; this is the northern limit at the edges. */
export function demEdgeLatitudeDeg(dem: PolarDem): number {
  return -90 + 2 * Math.atan(((dem.n / 2 - 1) * dem.scaleM) / (2 * R_M)) / DEG;
}

/** Bilinear height in metres, or NaN outside the grid. */
export function demHeightAt(dem: PolarDem, latDeg: number, lonDeg: number): number {
  const { col, row } = demPixel(dem, latDeg, lonDeg);
  const n = dem.n;
  if (!(col >= 0 && row >= 0 && col <= n - 1 && row <= n - 1)) return NaN;
  const c0 = Math.min(n - 2, Math.floor(col)), r0 = Math.min(n - 2, Math.floor(row));
  const fc = col - c0, fr = row - r0;
  const i = r0 * n + c0;
  const raw = dem.raw;
  return (
    (raw[i]! * (1 - fc) + raw[i + 1]! * fc) * (1 - fr) + (raw[i + n]! * (1 - fc) + raw[i + n + 1]! * fc) * fr
  ) * dem.heightScale;
}

export interface HorizonOptions {
  /** Azimuth step of the output profile in degrees (default 0.5). */
  azStepDeg?: number;
  /** Farthest terrain considered, in km along the surface (default 400). */
  maxDistanceKm?: number;
  /** First step along each ray in metres (default: half a pixel). */
  firstStepM?: number;
}

export interface TerrainHorizon {
  profile: HorizonProfile;
  /** Terrain height at the site, metres above the 1737.4 km sphere. */
  groundHeightM: number;
  /** Distance (km) of the terrain that forms the skyline, per azimuth bin. */
  distanceKm: Float32Array;
  /** True where a ray reached the edge of the elevation model before it could stop. */
  truncated: boolean;
}

/**
 * Skyline elevation angle for every azimuth as seen from `observerHeightM` above
 * the ground at the given site. Angles are relative to the local horizontal
 * plane; on a smooth sphere the result would be slightly negative (the dip).
 */
export function computeTerrainHorizon(
  dem: PolarDem, latDeg: number, lonDeg: number, observerHeightM: number, options: HorizonOptions = {},
): TerrainHorizon {
  const azStep = options.azStepDeg ?? 0.5;
  const bins = Math.round(360 / azStep);
  if (Math.abs(bins * azStep - 360) > 1e-9) throw new RangeError('Azimuth step must divide 360 degrees.');
  const ground = demHeightAt(dem, latDeg, lonDeg);
  if (Number.isNaN(ground)) throw new RangeError('Site is outside the elevation model.');
  const maxDist = (options.maxDistanceKm ?? 400) * 1000;
  const first = options.firstStepM ?? dem.scaleM / 2;
  const r0 = R_M + ground + observerHeightM;
  const rMax = R_M + dem.maxHeightM;
  const lat1 = latDeg * DEG, lon1 = lonDeg * DEG;
  const sinLat1 = Math.sin(lat1), cosLat1 = Math.cos(lat1);
  const el = new Float32Array(bins), dist = new Float32Array(bins);
  let truncated = false;
  for (let b = 0; b < bins; b++) {
    const az = b * azStep * DEG;
    const sinAz = Math.sin(az), cosAz = Math.cos(az);
    let best = -Math.PI / 2, bestD = 0;
    let d = first;
    while (d <= maxDist) {
      const g = d / R_M, sinG = Math.sin(g), cosG = Math.cos(g);
      // No terrain farther out can rise above the current skyline: stop.
      if (Math.atan2(rMax * cosG - r0, rMax * sinG) < best) break;
      const sinLat2 = sinLat1 * cosG + cosLat1 * sinG * cosAz;
      const lat2 = Math.asin(sinLat2);
      const lon2 = lon1 + Math.atan2(sinAz * sinG * cosLat1, cosG - sinLat1 * sinLat2);
      const h = demHeightAt(dem, lat2 / DEG, lon2 / DEG);
      if (Number.isNaN(h)) { truncated = true; break; }
      const r1 = R_M + h;
      const e = Math.atan2(r1 * cosG - r0, r1 * sinG);
      if (e > best) { best = e; bestD = d; }
      // Step grows with distance: constant angular resolution, pixel-limited nearby.
      d += Math.max(first, d * 0.004);
    }
    el[b] = best / DEG; dist[b] = bestD / 1000;
  }
  return { profile: { azStepDeg: azStep, elDeg: el }, groundHeightM: ground, distanceKm: dist, truncated };
}
