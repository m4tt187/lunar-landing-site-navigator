// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// Whole-map visibility of a distant light (the Sun, or the Earth) over a polar
// elevation model, by a parallel-light sweep.
//
// The light of a distant body arrives along parallel rays. In a frame with one
// axis along the light direction (u), one across it (a) and one "up" (b), a ray
// is a line of constant (a, b). A place on the ground sees the light exactly when
// no ground further along +u, on the same a, reaches higher in b. So the terrain
// is resampled once into (a, u) bins, and one pass per row with a running maximum
// answers the question for every place at once. The geometry is exact in three
// dimensions (the curvature of the Moon is part of the b coordinate); only the
// bin size limits the resolution.
//
// This is an independent method from the per-site skyline in terrain.ts and is
// tested against it (tests/engine/sweep.test.ts).
import type { PolarDem } from './terrain';

const R_M = 1737400;
const DEG = Math.PI / 180;

export type Direction = readonly [number, number, number];

export interface SweepOptions {
  /** Receivers are the model cells poleward of this latitude (degrees; negative = south). */
  minLatDeg: number;
  /** Height of the panel or antenna above the ground, metres. */
  observerHeightM: number;
  /** Size of the sweep bins in metres (default: the model's pixel size). */
  binM?: number;
  /** How far towards the light terrain is searched beyond the receivers, metres (default 250 km). */
  reachM?: number;
}

export interface Sweep {
  /** Side of the square receiver window, in model cells. */
  readonly size: number;
  /** Column and row of the window's first cell in the elevation model. */
  readonly origin: number;
  /** 1 where the window cell is a receiver (poleward of the latitude limit), 0 elsewhere. */
  readonly inside: Uint8Array;
  /**
   * For a light arriving from `direction` (Moon-fixed frame, pointing from the Moon
   * towards the body), writes 1 into `out` for every receiver that sees it and 0
   * for every receiver that does not. Cells outside the receiver disc are left 0.
   */
  run(direction: Direction, out: Uint8Array): void;
}

function normalize(v: Direction): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (!(l > 0) || !Number.isFinite(l)) throw new RangeError('Direction must be a finite non-zero vector.');
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** "Up" at the south pole in the Moon-fixed frame. */
const POLE_UP: Direction = [0, 0, -1];

/** Unit vector perpendicular to `s` in the plane of `s` and the pole's "up", on the "up" side. */
function upAcross(s: Direction): [number, number, number] {
  const k = POLE_UP[0] * s[0] + POLE_UP[1] * s[1] + POLE_UP[2] * s[2];
  const v: [number, number, number] = [POLE_UP[0] - k * s[0], POLE_UP[1] - k * s[1], POLE_UP[2] - k * s[2]];
  const l = Math.hypot(v[0], v[1], v[2]);
  // Light exactly along the polar axis: any perpendicular will do.
  return l < 1e-9 ? [1, 0, 0] : [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * The direction raised by `deg` degrees towards the zenith of the south pole.
 * Used to test the upper limb of the Sun (raise by its angular radius), its lower
 * limb (negative), or the Earth with an elevation margin (negative).
 */
export function raiseDirection(direction: Direction, deg: number): [number, number, number] {
  const s = normalize(direction);
  const b = upAcross(s);
  const c = Math.cos(deg * DEG), w = Math.sin(deg * DEG);
  return [s[0] * c + b[0] * w, s[1] * c + b[1] * w, s[2] * c + b[2] * w];
}

/**
 * Direction of a body as seen from the surface at the south pole, from its
 * Moon-centred position in km. For the Earth this removes the bulk of the
 * parallax; the remaining variation across a 300 km cap is under 0.05 degrees.
 */
export function directionFromPole(moonCentredKm: Direction): [number, number, number] {
  return normalize([moonCentredKm[0], moonCentredKm[1], moonCentredKm[2] + R_M / 1000]);
}

export function createSweep(dem: PolarDem, options: SweepOptions): Sweep {
  if (!(options.minLatDeg < -60 && options.minLatDeg > -90)) throw new RangeError('Latitude limit must be between -90 and -60 degrees.');
  if (!(options.observerHeightM >= 0 && options.observerHeightM <= 1000)) throw new RangeError('Observer height must be between 0 and 1000 metres.');
  const scale = dem.scaleM, n = dem.n, raw = dem.raw, heightScale = dem.heightScale;
  const bin = options.binM ?? scale;
  const reach = options.reachM ?? 250000;
  if (!(bin > 0) || !(reach >= 0)) throw new RangeError('Bin size and reach must be positive.');
  const mast = options.observerHeightM;
  const centre = n / 2 - 0.5;

  // Receiver window: a square of model cells around the pole containing the latitude circle.
  const rhoMax = 2 * R_M * Math.tan(((90 + options.minLatDeg) * DEG) / 2);
  const half = Math.min(Math.floor(n / 2), Math.ceil(rhoMax / scale));
  const size = 2 * half;
  const origin = Math.ceil(centre) - half;
  const inside = new Uint8Array(size * size);
  // Receiver positions relative to the pole's surface point (keeps 32-bit floats precise).
  const px = new Float32Array(size * size), py = new Float32Array(size * size), pz = new Float32Array(size * size);
  let horizontalMax = 0;
  for (let r = 0; r < size; r++) {
    const y = (centre - (origin + r)) * scale;
    for (let c = 0; c < size; c++) {
      const x = (origin + c - centre) * scale;
      const rho2 = x * x + y * y;
      if (rho2 > rhoMax * rhoMax) continue;
      const k = r * size + c;
      inside[k] = 1;
      const t2 = rho2 / (4 * R_M * R_M);
      const radius = R_M + raw[(origin + r) * n + origin + c]! * heightScale + mast;
      const f = radius / (R_M * (1 + t2));
      const X = f * y, Y = f * x, Z = -radius * (1 - t2) / (1 + t2);
      px[k] = X; py[k] = Y; pz[k] = Z + R_M;
      horizontalMax = Math.max(horizontalMax, Math.hypot(X, Y));
    }
  }

  // Sweep bins: `a` across the light, `u` along it (towards the body).
  const aMax = horizontalMax + 2 * bin;
  const na = 2 * Math.ceil(aMax / bin) + 1;
  const a0 = -((na - 1) / 2) * bin;
  const nu = Math.ceil((2 * aMax + reach) / bin) + 1;
  // The terrain must be a single-valued surface in the sweep frame: lights near the polar horizon only.
  const maxSinElevation = Math.sin(25 * DEG);
  const height = new Float32Array(na * nu);
  const seen = new Uint8Array(na * nu);
  const R2 = R_M * R_M;
  const limit = n - 1;
  // Second look-up only where the terrain height moves the point by more than a quarter of a bin.
  const shiftLimit2 = (0.25 * bin * R_M) ** 2;

  function run(direction: Direction, out: Uint8Array): void {
    if (out.length !== size * size) throw new RangeError('Output array does not match the receiver window.');
    const s = normalize(direction);
    if (Math.abs(s[2]) > maxSinElevation) throw new RangeError('The sweep handles lights within 25 degrees of the polar horizon.');
    const b = upAcross(s);
    // The receivers are centred on the pole, whose u coordinate is -R * s_z; the bins start one
    // receiver radius before it and extend `reach` beyond the receivers towards the light.
    const u0 = -R_M * s[2] + a0;
    // a = b x s completes the right-handed frame.
    const ax = b[1] * s[2] - b[2] * s[1], ay = b[2] * s[0] - b[0] * s[2], az = b[0] * s[1] - b[1] * s[0];
    const sx = s[0], sy = s[1], sz = s[2], bx = b[0], by = b[1], bz = b[2];

    // 1. Terrain "height" (the b coordinate, minus the lunar radius) in every bin.
    for (let i = 0; i < na; i++) {
      const a = a0 + i * bin;
      const rowBase = i * nu;
      const a2 = a * a;
      for (let j = 0; j < nu; j++) {
        const u = u0 + j * bin;
        let w2 = R2 - a2 - u * u;
        if (w2 <= 0) { height[rowBase + j] = -Infinity; continue; }
        let w = Math.sqrt(w2);
        let vx = a * ax + u * sx + w * bx, vy = a * ay + u * sy + w * by, vz = a * az + u * sz + w * bz;
        let d = (2 * R_M) / (R_M - vz);
        let col = centre + (vy * d) / scale, row = centre - (vx * d) / scale;
        if (!(col >= 0 && row >= 0 && col <= limit && row <= limit)) { height[rowBase + j] = -Infinity; continue; }
        let c0 = col | 0, r0 = row | 0;
        if (c0 >= limit) c0 = limit - 1;
        if (r0 >= limit) r0 = limit - 1;
        let fc = col - c0, fr = row - r0, k = r0 * n + c0;
        let h = ((raw[k]! * (1 - fc) + raw[k + 1]! * fc) * (1 - fr) + (raw[k + n]! * (1 - fc) + raw[k + n + 1]! * fc) * fr) * heightScale;
        if (h * h * (a2 + u * u) > shiftLimit2) {
          // The ground at this (a, u) is the ground whose sphere point is closer to the axis by 1 + h/R.
          const q = 1 / (1 + h / R_M), aq = a * q, uq = u * q;
          w2 = R2 - aq * aq - uq * uq;
          if (w2 > 0) {
            const wq = Math.sqrt(w2);
            vx = aq * ax + uq * sx + wq * bx; vy = aq * ay + uq * sy + wq * by; vz = aq * az + uq * sz + wq * bz;
            d = (2 * R_M) / (R_M - vz);
            col = centre + (vy * d) / scale; row = centre - (vx * d) / scale;
            if (col >= 0 && row >= 0 && col <= limit && row <= limit) {
              c0 = col | 0; r0 = row | 0;
              if (c0 >= limit) c0 = limit - 1;
              if (r0 >= limit) r0 = limit - 1;
              fc = col - c0; fr = row - r0; k = r0 * n + c0;
              h = ((raw[k]! * (1 - fc) + raw[k + 1]! * fc) * (1 - fr) + (raw[k + n]! * (1 - fc) + raw[k + n + 1]! * fc) * fr) * heightScale;
              w = wq;
            }
          }
        }
        height[rowBase + j] = ((R_M + h) * w) / R_M - R_M;
      }
    }

    // 2. A bin sees the light when nothing further towards the body, on its row, is higher.
    for (let i = 0; i < na; i++) {
      const rowBase = i * nu;
      let highest = -Infinity;
      for (let j = nu - 1; j >= 0; j--) {
        const v = height[rowBase + j]!;
        seen[rowBase + j] = v + mast >= highest ? 1 : 0;
        if (v > highest) highest = v;
      }
    }

    // 3. Each receiver takes the answer of the bin it falls in.
    const ka = -R_M * az, ku = -R_M * sz;
    for (let k = 0; k < out.length; k++) {
      if (!inside[k]) { out[k] = 0; continue; }
      const x = px[k]!, y = py[k]!, z = pz[k]!;
      const i = Math.round((x * ax + y * ay + z * az + ka - a0) / bin);
      const j = Math.round((x * sx + y * sy + z * sz + ku - u0) / bin);
      out[k] = i >= 0 && i < na && j >= 0 && j < nu ? seen[i * nu + j]! : 0;
    }
  }

  return { size, origin, inside, run };
}
