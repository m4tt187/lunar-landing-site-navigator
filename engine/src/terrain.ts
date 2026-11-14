// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude and OpenAI Codex under the direction of the team.
//
// Terrain skyline from a NASA LOLA polar elevation model.
//
// Grid geometry follows the LOLA team's DSMAP_POLAR.CAT description: spherical
// polar stereographic projection centred on the south pole, radius 1737.4 km,
// longitude 0 pointing up, 90 E pointing right, scale exact at the pole.
import type { HorizonProfile } from './types';

const R_M = 1737400;
const DEG = Math.PI / 180;
const MAX_AZIMUTH_BINS = 36000;
const MAX_TERRAIN_SAMPLES = 5000000;
const RAY_GROWTH = 0.004;

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

/** A terrain sampler in the same lunar reference sphere as PolarDem. */
export interface HeightField {
  /** Metres above the 1737.4 km sphere; NaN where the field is unknown. */
  heightAt(latDeg: number, lonDeg: number): number;
  /** Guaranteed upper bound of every known terrain height, in metres. */
  maxHeightM: number;
  /** Finest pixel size in metres; defaults the first ray step to half a pixel. */
  resolutionM: number;
}

function validateHeightBound(maxHeightM: number): void {
  if (!Number.isFinite(maxHeightM) || R_M + maxHeightM <= 0)
    throw new RangeError('Terrain maximum must be finite and above the lunar centre.');
}

/** Adapt a polar grid for composition with tile or global terrain samplers. */
export function polarDemField(dem: PolarDem): HeightField {
  validateGrid(dem.raw, dem.n, dem.scaleM, dem.heightScale);
  validateHeightBound(dem.maxHeightM);
  return { heightAt: (latDeg, lonDeg) => demHeightAt(dem, latDeg, lonDeg),
    maxHeightM: dem.maxHeightM, resolutionM: dem.scaleM };
}

function validateGrid(raw: Int16Array, n: number, scaleM: number, heightScale: number): void {
  if (!(raw instanceof Int16Array) || !Number.isSafeInteger(n) || n < 2)
    throw new RangeError('Elevation grid must have at least two rows and columns of Int16 samples.');
  if (raw.length !== n * n) throw new RangeError('Elevation grid size does not match its dimensions.');
  if (!Number.isFinite(scaleM) || scaleM <= 0 || !Number.isFinite(heightScale) || heightScale <= 0)
    throw new RangeError('Elevation grid scales must be positive finite numbers.');
}

export function makePolarDem(raw: Int16Array, n: number, scaleM: number, heightScale: number): PolarDem {
  validateGrid(raw, n, scaleM, heightScale);
  let max = -32768;
  for (let i = 0; i < raw.length; i++) if (raw[i]! > max) max = raw[i]!;
  const maxHeightM = max * heightScale;
  if (!Number.isFinite(maxHeightM)) throw new RangeError('Elevation grid heights must be finite.');
  return { n, scaleM, raw, heightScale, maxHeightM };
}

/** Fractional column/row of a latitude/longitude (degrees, east positive). */
export function demPixel(dem: PolarDem, latDeg: number, lonDeg: number): { col: number; row: number } {
  if (!Number.isFinite(latDeg) || Math.abs(latDeg) > 90 || !Number.isFinite(lonDeg) || Math.abs(lonDeg) > 180)
    throw new RangeError('Latitude must be in [-90, 90] and longitude in [-180, 180] degrees.');
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
  /** Positive azimuth step dividing 360 degrees; at most 36000 bins (default 0.5). */
  azStepDeg?: number;
  /** Positive distance in km along the surface, at most a semicircle (default 400). */
  maxDistanceKm?: number;
  /** Positive first step in metres, no farther than maxDistanceKm (default: half a pixel). */
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
 * Observer height is in [0, 20000] m. Requests exceeding five million ray
 * samples are rejected; increase the azimuth or distance step to reduce work.
 */
export function computeTerrainHorizon(
  source: PolarDem | HeightField, latDeg: number, lonDeg: number, observerHeightM: number, options: HorizonOptions = {},
): TerrainHorizon {
  const dem = 'raw' in source ? source : null;
  const field = dem === null ? source as HeightField : null;
  if (dem) validateGrid(dem.raw, dem.n, dem.scaleM, dem.heightScale);
  if (field && (typeof field.heightAt !== 'function' || !Number.isFinite(field.resolutionM) || field.resolutionM <= 0))
    throw new RangeError('Height field must provide a sampler and a positive finite resolution.');
  validateHeightBound(source.maxHeightM);
  const maxHeightTolerance = 1e-9 * Math.max(1, Math.abs(source.maxHeightM));
  if (!Number.isFinite(latDeg) || Math.abs(latDeg) > 90 || !Number.isFinite(lonDeg) || Math.abs(lonDeg) > 180)
    throw new RangeError('Latitude must be in [-90, 90] and longitude in [-180, 180] degrees.');
  if (!Number.isFinite(observerHeightM) || observerHeightM < 0 || observerHeightM > 20000)
    throw new RangeError('Observer height must be between 0 and 20000 metres above the ground.');
  const azStep = options.azStepDeg ?? 0.5;
  const bins = Math.round(360 / azStep);
  if (!Number.isFinite(azStep) || azStep <= 0 || bins < 1 || bins > MAX_AZIMUTH_BINS || Math.abs(bins * azStep - 360) > 1e-9)
    throw new RangeError('Azimuth step must divide 360 degrees into at most 36000 bins.');
  const maxDist = (options.maxDistanceKm ?? 400) * 1000;
  const first = options.firstStepM ?? (dem ? dem.scaleM : field!.resolutionM) / 2;
  if (!Number.isFinite(maxDist) || maxDist <= 0 || maxDist > Math.PI * R_M)
    throw new RangeError('Maximum distance must be positive, finite and no greater than a lunar semicircle.');
  if (!Number.isFinite(first) || first <= 0 || first > maxDist)
    throw new RangeError('First step must be positive, finite and no greater than the maximum distance.');
  // At most 250 fixed steps, then geometric growth. Bound work before allocating
  // the profile, including tiny steps whose distance ratio would overflow.
  const ratio = maxDist / first;
  const raySamples = Math.min(1 / RAY_GROWTH, Math.floor(ratio)) +
    Math.ceil(Math.max(0, Math.log(ratio * RAY_GROWTH)) / Math.log1p(RAY_GROWTH)) + 1;
  if (bins * raySamples > MAX_TERRAIN_SAMPLES)
    throw new RangeError('Requested horizon exceeds five million terrain samples; increase a sampling step.');
  const ground = dem ? demHeightAt(dem, latDeg, lonDeg) : field!.heightAt(latDeg, lonDeg);
  if (!Number.isFinite(ground)) throw new RangeError('Site is outside the elevation model or has a non-finite height.');
  if (R_M + ground <= 0) throw new RangeError('Terrain height must be above the lunar centre.');
  if (ground > source.maxHeightM + maxHeightTolerance) throw new RangeError('Terrain height exceeds the declared maximum.');
  const r0 = R_M + ground + observerHeightM;
  const rMax = R_M + source.maxHeightM;
  const lat1 = latDeg * DEG, lon1 = lonDeg * DEG;
  const sinLat1 = Math.sin(lat1), cosLat1 = Math.cos(lat1);
  const sinLon1 = Math.sin(lon1), cosLon1 = Math.cos(lon1);
  const upX = cosLat1 * cosLon1, upY = cosLat1 * sinLon1;
  const el = new Float32Array(bins), dist = new Float32Array(bins);
  let truncated = false;
  for (let b = 0; b < bins; b++) {
    const az = b * azStep * DEG;
    const sinAz = Math.sin(az), cosAz = Math.cos(az);
    // The same north/east basis as projectBody, including the pole's longitude-
    // dependent azimuth convention. Cartesian rotation avoids polar cancellation.
    const rayX = -sinLat1 * cosLon1 * cosAz - sinLon1 * sinAz;
    const rayY = -sinLat1 * sinLon1 * cosAz + cosLon1 * sinAz;
    const rayZ = cosLat1 * cosAz;
    let best = -Math.PI / 2, bestD = 0;
    let d = first;
    while (d <= maxDist) {
      const g = d / R_M, sinG = Math.sin(g), cosG = Math.cos(g);
      // No terrain farther out can rise above the current skyline: stop.
      if (Math.atan2(rMax * cosG - r0, rMax * sinG) < best) break;
      const x = upX * cosG + rayX * sinG, y = upY * cosG + rayY * sinG;
      const z = sinLat1 * cosG + rayZ * sinG;
      const lat2 = Math.atan2(z, Math.hypot(x, y));
      const lon2 = Math.atan2(y, x);
      // Preserve the direct grid path; callbacks are used only for HeightField.
      const h = dem ? demHeightAt(dem, lat2 / DEG, lon2 / DEG) : field!.heightAt(lat2 / DEG, lon2 / DEG);
      if (Number.isNaN(h)) { truncated = true; break; }
      if (field && (!Number.isFinite(h) || R_M + h <= 0 || h > source.maxHeightM + maxHeightTolerance))
        throw new RangeError('Height field samples must be finite, above the lunar centre, and at most the declared maximum.');
      const r1 = R_M + h;
      const e = Math.atan2(r1 * cosG - r0, r1 * sinG);
      if (e > best) { best = e; bestD = d; }
      // Step grows with distance: constant angular resolution, pixel-limited nearby.
      d += Math.max(first, d * RAY_GROWTH);
    }
    el[b] = best / DEG; dist[b] = bestD / 1000;
  }
  return { profile: { azStepDeg: azStep, elDeg: el }, groundHeightM: ground, distanceKm: dist, truncated };
}
