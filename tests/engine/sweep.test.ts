// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// The whole-map sweep (engine/src/sweep.ts) against an independent per-site
// calculation: a ray marched from each test point along the Sun's azimuth over
// the same elevation model, with spherical geometry written out here separately.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { demHeightAt, makePolarDem, moonFixedVectors, sampleFromVectors } from '../../engine/src/index.ts';
import type { PolarDem, Site } from '../../engine/src/index.ts';
import { createSweep, directionFromPole, raiseDirection } from '../../engine/src/sweep.ts';

const R_M = 1737400, DEG = Math.PI / 180;
const file = fileURLToPath(new URL('../../web/public/data/ldem_75s_480m.i16', import.meta.url));
const buffer = readFileSync(file);
const dem: PolarDem = makePolarDem(new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2), 1906, 480, 0.5);

/** Highest elevation angle (degrees) of the terrain along one azimuth, by brute-force marching. */
function skylineAlong(latDeg: number, lonDeg: number, observerHeightM: number, azDeg: number): number {
  const lat = latDeg * DEG, lon = lonDeg * DEG, az = azDeg * DEG;
  const up = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const along = [0, 1, 2].map((i) => north[i]! * Math.cos(az) + east[i]! * Math.sin(az));
  const r0 = R_M + demHeightAt(dem, latDeg, lonDeg) + observerHeightM;
  let best = -90;
  for (let d = 120; d <= 320000; d += d < 40000 ? 120 : 240) {
    const g = d / R_M;
    const q = [0, 1, 2].map((i) => up[i]! * Math.cos(g) + along[i]! * Math.sin(g));
    const h = demHeightAt(dem, Math.asin(q[2]!) / DEG, Math.atan2(q[1]!, q[0]!) / DEG);
    if (Number.isNaN(h)) break;
    const r1 = R_M + h;
    best = Math.max(best, Math.atan2(r1 * Math.cos(g) - r0, r1 * Math.sin(g)) / DEG);
  }
  return best;
}

describe('whole-map sweep vs independent per-site ray march', () => {
  const observer = 2;
  const sweep = createSweep(dem, { minLatDeg: -84, observerHeightM: observer });
  const out = new Uint8Array(sweep.size * sweep.size);
  const centre = dem.n / 2 - 0.5;
  let seed = 7;
  const random = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const cells: number[] = [];
  while (cells.length < 160) {
    const k = Math.floor(random() * out.length);
    if (sweep.inside[k]) cells.push(k);
  }
  const start = Date.UTC(2027, 2, 1);

  for (const body of ['sun', 'earth'] as const) {
    it(`${body}: agrees with the ray march`, () => {
      let total = 0, agree = 0, clear = 0, clearAgree = 0, seenCount = 0;
      for (let step = 0; step < 8; step++) {
        const tMs = start + step * 3.7 * 86400000;
        const vectors = moonFixedVectors(tMs);
        // Any part of the solar disc (raise by its radius); the Earth's centre.
        const direction = body === 'sun' ? raiseDirection(vectors.sun, 0.2666) : directionFromPole(vectors.earth);
        sweep.run(direction, out);
        for (const k of cells) {
          const row = sweep.origin + Math.floor(k / sweep.size), col = sweep.origin + (k % sweep.size);
          const x = (col - centre) * dem.scaleM, y = (centre - row) * dem.scaleM;
          const latDeg = -90 + (2 * Math.atan(Math.hypot(x, y) / (2 * R_M))) / DEG, lonDeg = Math.atan2(x, y) / DEG;
          const site: Site = { id: 't', name: 't', latDeg, lonDeg, heightM: demHeightAt(dem, latDeg, lonDeg) + observer };
          const s = sampleFromVectors(site, tMs, vectors)[body];
          const margin = s.elDeg + (body === 'sun' ? s.angularRadiusDeg : 0) - skylineAlong(latDeg, lonDeg, observer, s.azDeg);
          const direct = margin > 0 ? 1 : 0;
          total++; seenCount += out[k]!;
          if (direct === out[k]) agree++;
          if (Math.abs(margin) > 0.3) { clear++; if (direct === out[k]) clearAgree++; }
        }
      }
      console.log(`${body}: ${total} point-times, ${seenCount} seen; agreement ${(100 * agree / total).toFixed(1)}% overall, ` +
        `${(100 * clearAgree / clear).toFixed(2)}% where the margin exceeds 0.3 deg (${clear} cases)`);
      expect(seenCount).toBeGreaterThan(total * 0.05);
      expect(seenCount).toBeLessThan(total * 0.95);
      expect(agree / total).toBeGreaterThan(0.95);
      expect(clearAgree / clear).toBeGreaterThan(0.99);
    });
  }

  it('is fast enough for interactive use on the full map', () => {
    const full = createSweep(dem, { minLatDeg: -80, observerHeightM: observer });
    const mask = new Uint8Array(full.size * full.size);
    const direction = raiseDirection(moonFixedVectors(start).sun, 0.2666);
    full.run(direction, mask);
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) full.run(direction, mask);
    const ms = (performance.now() - t0) / 5;
    console.log(`full map (${full.size} x ${full.size} cells): ${ms.toFixed(0)} ms per light direction`);
    expect(ms).toBeLessThan(1500);
  });

  it('raising the light never hides it, and a light far below the horizon reaches nothing', () => {
    const low = new Uint8Array(out.length), high = new Uint8Array(out.length);
    for (const azimuthDeg of [0, 77, 190, 301]) {
      const flat: [number, number, number] = [Math.cos(azimuthDeg * DEG), Math.sin(azimuthDeg * DEG), 0];
      sweep.run(raiseDirection(flat, 0.5), low);
      sweep.run(raiseDirection(flat, 4), high);
      let lowCount = 0, highCount = 0, lost = 0;
      for (let k = 0; k < out.length; k++) { lowCount += low[k]!; highCount += high[k]!; if (low[k] && !high[k]) lost++; }
      expect(highCount).toBeGreaterThan(lowCount);
      // The bins are resampled for each direction, so a few cells on shadow edges may differ.
      expect(lost / lowCount).toBeLessThan(0.01);
    }
    sweep.run(raiseDirection([1, 0, 0], -20), out);
    expect(out.reduce((a, v) => a + v, 0)).toBe(0);
    expect(() => sweep.run([0, 0, -1], out)).toThrow(/polar horizon/);
  });
});

describe('whole-map sweep: limits and bad input', () => {
  // A small smooth model: 64 x 64 cells of 1 km around the pole, all at the reference radius.
  const flat: PolarDem = makePolarDem(new Int16Array(64 * 64), 64, 1000, 0.5);

  it('accepts a light at exactly 25 degrees from the polar horizon, on either side, and rejects one just beyond', () => {
    const sweep = createSweep(flat, { minLatDeg: -89.5, observerHeightM: 2 });
    const out = new Uint8Array(sweep.size * sweep.size);
    for (const deg of [25, -25, 24.99999, -24.99999]) expect(() => sweep.run(raiseDirection([1, 0, 0], deg), out)).not.toThrow();
    for (const deg of [25.00001, -25.00001, 40]) expect(() => sweep.run(raiseDirection([1, 0, 0], deg), out)).toThrow(RangeError);
  });

  it('rejects bins and reaches that are not finite, and sweeps too large to allocate', () => {
    const options = { minLatDeg: -89.5, observerHeightM: 2 };
    expect(() => createSweep(flat, { ...options, binM: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => createSweep(flat, { ...options, binM: Number.NaN })).toThrow(RangeError);
    expect(() => createSweep(flat, { ...options, binM: 0 })).toThrow(RangeError);
    expect(() => createSweep(flat, { ...options, reachM: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => createSweep(flat, { ...options, reachM: -1 })).toThrow(RangeError);
    expect(() => createSweep(flat, { ...options, binM: 0.5 })).toThrow(/forty million/);
    expect(() => createSweep(flat, { ...options, binM: 500, reachM: 0 })).not.toThrow();
  });

  it('rejects an elevation grid that is not what it says it is', () => {
    const options = { minLatDeg: -89.5, observerHeightM: 2 };
    expect(() => createSweep({ ...flat, n: 63 }, options)).toThrow(RangeError);
    expect(() => createSweep({ ...flat, scaleM: 0 }, options)).toThrow(RangeError);
    expect(() => createSweep({ ...flat, heightScale: Number.NaN }, options)).toThrow(RangeError);
    expect(() => createSweep(flat, { minLatDeg: -50, observerHeightM: 2 })).toThrow(RangeError);
    expect(() => createSweep(flat, { minLatDeg: -89.5, observerHeightM: Number.NaN })).toThrow(RangeError);
  });

  it('on a smooth sphere lights everything when the light is above the horizon and nothing when it is well below, away from the edge of the model', () => {
    // Receivers within 0.5 degrees of the pole (15 km); the model reaches 32 km.
    const sweep = createSweep(flat, { minLatDeg: -89.5, observerHeightM: 2 });
    const out = new Uint8Array(sweep.size * sweep.size);
    const receivers = sweep.inside.reduce((sum, v) => sum + v, 0);
    expect(receivers).toBeGreaterThan(500);
    const count = (deg: number): number => { sweep.run(raiseDirection([1, 0, 0], deg), out); return out.reduce((sum, v) => sum + v, 0); };
    expect(count(3)).toBe(receivers);
    expect(count(-3)).toBe(0);
  });
});
