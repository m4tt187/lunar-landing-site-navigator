// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// A table of exact Sun and Earth vectors, with cubic interpolation between its
// knots.
//
// Why: finding when a ridge hides the Sun needs samples close together. The
// skyline is known every 0.25 degrees of azimuth and at the poles the Sun moves
// about half a degree of azimuth per hour, so a ten-minute step sees everything
// the terrain model can show; a three-hour step can step over a whole ridge or an
// eclipse. The exact ephemeris call is too slow to make every ten minutes of a
// year, but the vectors it returns are smooth in time and do not depend on the
// site. So they are computed exactly at widely spaced knots, once for all sites,
// and interpolated in between. The interpolation error is measured in
// tests/engine/ephemeris.test.ts and is thousands of times smaller than the
// difference between this engine and NASA/JPL Horizons.
import { MAX_TIME_MS, MIN_TIME_MS, MOON_RADIUS_KM, moonFixedVectors, validateSite, validateTime } from './geometry';
import type { MoonFixedVectors } from './geometry';
import type { Sample, Series, Site } from './types';

const DEG = Math.PI / 180;
// The same body radii as geometry.ts; a test checks the two modules agree.
const SUN_RADIUS_KM = 695700;
const EARTH_RADIUS_KM = 6378.137;
const MAX_KNOTS = 200000;
const MAX_SAMPLES = 100000;

/** Knot spacing used when none is given: see docs/engine/ephemeris.md for the measured error. */
export const DEFAULT_KNOT_STEP_S = 7200;

/** Plain data, so a table can be posted to a Web Worker as it is. */
export interface VectorTable {
  /** Time of knot 0, UTC milliseconds. */
  startMs: number;
  /** Knot spacing, milliseconds. */
  stepMs: number;
  /** Number of knots (at least four). */
  n: number;
  /** Sun relative to the Moon's centre, Moon-fixed frame, km: x0, y0, z0, x1, ... */
  sun: Float64Array;
  /** Earth relative to the Moon's centre, same layout. */
  earth: Float64Array;
  /** First and last instants that can be interpolated (both included). */
  validFromMs: number;
  validToMs: number;
}

/**
 * Exact vectors at evenly spaced knots covering [fromMs, toMs], with one knot
 * to spare on each side so that the four knots used for any instant of the span
 * surround it. At the limits of the supported dates the spare knot is taken on
 * the inner side instead.
 */
export function buildVectorTable(fromMs: number, toMs: number, knotStepS: number = DEFAULT_KNOT_STEP_S): VectorTable {
  validateTime(fromMs); validateTime(toMs);
  if (!(toMs >= fromMs)) throw new RangeError('Table end must not be before its start.');
  if (!Number.isFinite(knotStepS) || knotStepS <= 0) throw new RangeError('Knot step must be a positive finite number of seconds.');
  const stepMs = knotStepS * 1000;
  if (!Number.isFinite(stepMs) || !(fromMs + stepMs > fromMs))
    throw new RangeError('Knot step must be finite and advance the timestamp.');
  const n = Math.max(4, Math.ceil((toMs - fromMs) / stepMs) + 3);
  if (n > MAX_KNOTS) throw new RangeError('Requested table exceeds 200000 knots; increase the knot step.');
  let startMs = Math.max(MIN_TIME_MS, fromMs - stepMs);
  if (startMs + (n - 1) * stepMs > MAX_TIME_MS) startMs = MAX_TIME_MS - (n - 1) * stepMs;
  if (startMs < MIN_TIME_MS) throw new RangeError('Knot step is too long for the supported time range.');
  const sun = new Float64Array(3 * n), earth = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) {
    // The last knot is clamped so that rounding can never push it past the supported range.
    const v = moonFixedVectors(Math.min(MAX_TIME_MS, startMs + i * stepMs));
    sun[3 * i] = v.sun[0]; sun[3 * i + 1] = v.sun[1]; sun[3 * i + 2] = v.sun[2];
    earth[3 * i] = v.earth[0]; earth[3 * i + 1] = v.earth[1]; earth[3 * i + 2] = v.earth[2];
  }
  return { startMs, stepMs, n, sun, earth, validFromMs: startMs, validToMs: startMs + (n - 1) * stepMs };
}

function validateTable(table: VectorTable): void {
  if (!Number.isInteger(table.n) || table.n < 4 || table.sun.length !== 3 * table.n || table.earth.length !== 3 * table.n)
    throw new RangeError('Vector table must hold at least four knots of three numbers for each body.');
  if (!Number.isFinite(table.startMs) || !Number.isFinite(table.stepMs) || !(table.stepMs > 0))
    throw new RangeError('Vector table must have a finite start and a positive finite knot spacing.');
}

/** True when every instant of [fromMs, toMs] can be interpolated from the table. */
export function tableCovers(table: VectorTable, fromMs: number, toMs: number): boolean {
  return fromMs <= toMs && table.validFromMs <= fromMs && toMs <= table.validToMs;
}

/**
 * Four-point Lagrange interpolation on the knots around tMs; the six results
 * (Sun x, y, z, Earth x, y, z) go into `out`. At a knot the weights are exactly
 * 0, 1, 0, 0, so knot values come back unchanged.
 */
function interpolateInto(table: VectorTable, tMs: number, out: Float64Array): void {
  const x = (tMs - table.startMs) / table.stepMs;
  // Knots i-1 .. i+2; near the ends of the table the same four are used one-sidedly.
  const i = Math.min(table.n - 3, Math.max(1, Math.floor(x)));
  const u = x - i;
  const w0 = (-u * (u - 1) * (u - 2)) / 6;
  const w1 = ((u + 1) * (u - 1) * (u - 2)) / 2;
  const w2 = (-(u + 1) * u * (u - 2)) / 2;
  const w3 = ((u + 1) * u * (u - 1)) / 6;
  const k = 3 * (i - 1);
  const s = table.sun, e = table.earth;
  for (let c = 0; c < 3; c++) {
    out[c] = w0 * s[k + c]! + w1 * s[k + 3 + c]! + w2 * s[k + 6 + c]! + w3 * s[k + 9 + c]!;
    out[3 + c] = w0 * e[k + c]! + w1 * e[k + 3 + c]! + w2 * e[k + 6 + c]! + w3 * e[k + 9 + c]!;
  }
}

function requireInside(table: VectorTable, tMs: number): void {
  if (!Number.isFinite(tMs) || tMs < table.validFromMs || tMs > table.validToMs)
    throw new RangeError('Time is outside the span covered by the vector table.');
}

/** Sun and Earth vectors at any instant inside the table. */
export function vectorsAt(table: VectorTable, tMs: number): MoonFixedVectors {
  validateTable(table); requireInside(table, tMs);
  const v = new Float64Array(6);
  interpolateInto(table, tMs, v);
  return { sun: [v[0]!, v[1]!, v[2]!], earth: [v[3]!, v[4]!, v[5]!] };
}

/** The site's local axes and position, computed once for a whole series. */
interface Frame {
  ox: number; oy: number; oz: number;
  upX: number; upY: number; upZ: number;
  eastX: number; eastY: number;
  northX: number; northY: number; northZ: number;
}

function frameOf(site: Site): Frame {
  const lat = site.latDeg * DEG, lon = site.lonDeg * DEG;
  const upX = Math.cos(lat) * Math.cos(lon), upY = Math.cos(lat) * Math.sin(lon), upZ = Math.sin(lat);
  const r = MOON_RADIUS_KM + site.heightM / 1000;
  return {
    ox: r * upX, oy: r * upY, oz: r * upZ, upX, upY, upZ,
    eastX: -Math.sin(lon), eastY: Math.cos(lon),
    northX: -Math.sin(lat) * Math.cos(lon), northY: -Math.sin(lat) * Math.sin(lon), northZ: Math.cos(lat),
  };
}

const mod360 = (a: number): number => ((a % 360) + 360) % 360;

/**
 * The projection of geometry.ts's projectBody, written out so that a series
 * does not rebuild the site's axes for every sample. Results: azimuth,
 * elevation, angular radius (degrees) and range (km) into out[at..at+3].
 */
function project(f: Frame, x: number, y: number, z: number, radiusKm: number, out: Float64Array, at: number): void {
  const dx = x - f.ox, dy = y - f.oy, dz = z - f.oz;
  const east = dx * f.eastX + dy * f.eastY;
  const north = dx * f.northX + dy * f.northY + dz * f.northZ;
  const up = dx * f.upX + dy * f.upY + dz * f.upZ;
  const rangeKm = Math.hypot(dx, dy, dz);
  out[at] = mod360(Math.atan2(east, north) / DEG);
  out[at + 1] = Math.atan2(up, Math.hypot(east, north)) / DEG;
  out[at + 2] = Math.asin(Math.min(1, radiusKm / rangeKm)) / DEG;
  out[at + 3] = rangeKm;
}

/** The Sun and the Earth as seen from a site at one instant, from the table. */
export function sampleFromTable(site: Site, table: VectorTable, tMs: number): Sample {
  validateSite(site); validateTable(table); requireInside(table, tMs);
  const v = new Float64Array(6), p = new Float64Array(8);
  interpolateInto(table, tMs, v);
  const frame = frameOf(site);
  project(frame, v[0]!, v[1]!, v[2]!, SUN_RADIUS_KM, p, 0);
  project(frame, v[3]!, v[4]!, v[5]!, EARTH_RADIUS_KM, p, 4);
  return {
    tMs,
    sun: { azDeg: p[0]!, elDeg: p[1]!, angularRadiusDeg: p[2]!, rangeKm: p[3]! },
    earth: { azDeg: p[4]!, elDeg: p[5]!, angularRadiusDeg: p[6]!, rangeKm: p[7]! },
  };
}

/**
 * The same series as geometry.ts's computeSeries (same time stamps, both end
 * instants included, same limits and errors), with the vectors taken from the
 * table instead of the ephemeris: fast enough for a ten-minute step over a year.
 */
export function seriesFromTable(site: Site, table: VectorTable, startMs: number, endMs: number, stepS: number): Series {
  validateSite(site); validateTime(startMs); validateTime(endMs); validateTable(table);
  if (!(endMs > startMs)) throw new RangeError('End time must be after start time.');
  if (!Number.isFinite(stepS) || stepS <= 0) throw new RangeError('Step must be a positive finite number of seconds.');
  // As in computeSeries: a cadence longer than the span still means the two end instants.
  const stepMs = Math.min(stepS * 1000, endMs - startMs);
  if (!(startMs + stepMs > startMs)) throw new RangeError('Step must advance the timestamp at the requested time precision.');
  const n = Math.ceil((endMs - startMs) / stepMs) + 1;
  if (n > MAX_SAMPLES) throw new RangeError('Requested series exceeds 100000 samples; increase the step.');
  if (!tableCovers(table, startMs, endMs)) throw new RangeError('Vector table does not cover the requested span.');
  const series: Series = {
    site: { ...site }, startMs, endMs, stepS, n, timesMs: new Float64Array(n),
    sunAz: new Float64Array(n), sunEl: new Float64Array(n), sunRadius: new Float64Array(n),
    earthAz: new Float64Array(n), earthEl: new Float64Array(n), earthRadius: new Float64Array(n),
  };
  const frame = frameOf(site);
  const v = new Float64Array(6), p = new Float64Array(8);
  for (let i = 0; i < n; i++) {
    const tMs = i === n - 1 ? endMs : Math.min(endMs, startMs + i * stepMs);
    if (i > 0 && !(tMs > series.timesMs[i - 1]!))
      throw new RangeError('Series timestamps do not advance; increase the step to match time precision.');
    interpolateInto(table, tMs, v);
    project(frame, v[0]!, v[1]!, v[2]!, SUN_RADIUS_KM, p, 0);
    project(frame, v[3]!, v[4]!, v[5]!, EARTH_RADIUS_KM, p, 4);
    series.timesMs[i] = tMs;
    series.sunAz[i] = p[0]!; series.sunEl[i] = p[1]!; series.sunRadius[i] = p[2]!;
    series.earthAz[i] = p[4]!; series.earthEl[i] = p[5]!; series.earthRadius[i] = p[6]!;
  }
  return series;
}
