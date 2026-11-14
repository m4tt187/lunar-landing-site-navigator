// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with OpenAI Codex under the direction of the team.
import { BackdatePosition, Body, KM_PER_AU, MakeTime, RotationAxis } from 'astronomy-engine';
import type { BodySample, Sample, Series, Site } from './types';

export const MOON_RADIUS_KM = 1737.4;
const DEG = Math.PI / 180;
const SUN_RADIUS_KM = 695700;
const EARTH_RADIUS_KM = 6378.137;
export const MIN_TIME_MS = Date.UTC(2000, 0, 1);
export const MAX_TIME_MS = Date.UTC(2051, 0, 1);
const MAX_SAMPLES = 100000;
type Vec = readonly [number, number, number];

export function validateTime(tMs: number): void {
  if (!Number.isFinite(tMs) || tMs < MIN_TIME_MS || tMs > MAX_TIME_MS)
    throw new RangeError('Time must be a finite UTC millisecond timestamp within 2000–2050.');
}
export function validateSite(site: Site): void {
  if (!Number.isFinite(site.latDeg) || Math.abs(site.latDeg) > 90)
    throw new RangeError('Latitude must be between -90 and 90 degrees.');
  if (!Number.isFinite(site.lonDeg) || Math.abs(site.lonDeg) > 180)
    throw new RangeError('Longitude must be between -180 and 180 degrees, east positive.');
  if (!Number.isFinite(site.heightM) || Math.abs(site.heightM) > 20000)
    throw new RangeError('Height must be between -20000 and 20000 metres above the lunar sphere.');
}
const dot = (a: Vec, b: Vec): number => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const mod360 = (a: number): number => ((a % 360) + 360) % 360;

/** IAU pole/prime-meridian basis, expressed in the J2000 equatorial frame. */
function moonBasis(tMs: number): readonly [Vec, Vec, Vec] {
  const axis = RotationAxis(Body.Moon, MakeTime(new Date(tMs)));
  const ra = axis.ra * 15 * DEG, dec = axis.dec * DEG, w = axis.spin * DEG;
  const p: Vec = [-Math.sin(ra), Math.cos(ra), 0];
  const q: Vec = [-Math.cos(ra)*Math.sin(dec), -Math.sin(ra)*Math.sin(dec), Math.cos(dec)];
  const z: Vec = [Math.cos(ra)*Math.cos(dec), Math.sin(ra)*Math.cos(dec), Math.sin(dec)];
  return [
    [p[0]*Math.cos(w)+q[0]*Math.sin(w), p[1]*Math.cos(w)+q[1]*Math.sin(w), p[2]*Math.cos(w)+q[2]*Math.sin(w)],
    [-p[0]*Math.sin(w)+q[0]*Math.cos(w), -p[1]*Math.sin(w)+q[1]*Math.cos(w), -p[2]*Math.sin(w)+q[2]*Math.cos(w)],
    z,
  ];
}

/** Local topocentric projection also used by the NASA ephemeris adapter. */
export function projectBody(site: Site, vectorKm: Vec, radiusKm: number): BodySample {
  const lat = site.latDeg*DEG, lon = site.lonDeg*DEG;
  const up: Vec = [Math.cos(lat)*Math.cos(lon), Math.cos(lat)*Math.sin(lon), Math.sin(lat)];
  const east: Vec = [-Math.sin(lon), Math.cos(lon), 0];
  const north: Vec = [-Math.sin(lat)*Math.cos(lon), -Math.sin(lat)*Math.sin(lon), Math.cos(lat)];
  const r = MOON_RADIUS_KM + site.heightM/1000;
  const relative: Vec = [vectorKm[0]-r*up[0], vectorKm[1]-r*up[1], vectorKm[2]-r*up[2]];
  const rangeKm = Math.hypot(...relative);
  return {
    azDeg: mod360(Math.atan2(dot(relative,east),dot(relative,north))/DEG),
    elDeg: Math.atan2(dot(relative,up),Math.hypot(dot(relative,east),dot(relative,north)))/DEG,
    angularRadiusDeg: Math.asin(Math.min(1,radiusKm/rangeKm))/DEG,
    rangeKm,
  };
}

/** Approximate apparent directions; Horizons residuals are measured separately. */
export function computeSample(site: Site, tMs: number): Sample {
  validateSite(site); validateTime(tMs);
  const basis = moonBasis(tMs);
  const body = (target: Body, radiusKm: number): BodySample => {
    const v = BackdatePosition(new Date(tMs), Body.Moon, target, true);
    const inertial: Vec = [v.x*KM_PER_AU,v.y*KM_PER_AU,v.z*KM_PER_AU];
    return projectBody(site, [dot(inertial,basis[0]),dot(inertial,basis[1]),dot(inertial,basis[2])], radiusKm);
  };
  return {tMs, sun: body(Body.Sun,SUN_RADIUS_KM), earth: body(Body.Earth,EARTH_RADIUS_KM)};
}

export function computeSeries(site: Site, startMs: number, endMs: number, stepS: number): Series {
  validateSite(site); validateTime(startMs); validateTime(endMs);
  if (!(endMs > startMs)) throw new RangeError('End time must be after start time.');
  if (!Number.isFinite(stepS) || stepS <= 0) throw new RangeError('Step must be a positive finite number of seconds.');
  const n = Math.ceil((endMs-startMs)/(stepS*1000))+1;
  if (n > MAX_SAMPLES) throw new RangeError('Requested series exceeds 100000 samples; increase the step.');
  const series: Series = {
    site: {...site}, startMs, endMs, stepS, n, timesMs: new Float64Array(n),
    sunAz:new Float64Array(n),sunEl:new Float64Array(n),sunRadius:new Float64Array(n),
    earthAz:new Float64Array(n),earthEl:new Float64Array(n),earthRadius:new Float64Array(n),
  };
  for (let i=0;i<n;i++) {
    const tMs = Math.min(endMs,startMs+i*stepS*1000);
    const sample = computeSample(site,tMs);
    series.timesMs[i] = tMs;
    series.sunAz[i] = sample.sun.azDeg; series.sunEl[i] = sample.sun.elDeg; series.sunRadius[i] = sample.sun.angularRadiusDeg;
    series.earthAz[i] = sample.earth.azDeg; series.earthEl[i] = sample.earth.elDeg; series.earthRadius[i] = sample.earth.angularRadiusDeg;
  }
  return series;
}
