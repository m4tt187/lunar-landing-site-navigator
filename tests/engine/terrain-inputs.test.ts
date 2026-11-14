// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with OpenAI Codex under the direction of the team.
import { describe, expect, it } from 'vitest';
import { computeTerrainHorizon, demHeightAt, demPixel, makePolarDem } from '../../engine/src/terrain';
import type { HorizonOptions } from '../../engine/src/terrain';
const R_M = 1737400;

describe('terrain input bounds', () => {
  const raw = new Int16Array(16);
  const dem = makePolarDem(raw, 4, 100, 1);

  it.each([0, 1, 1.5, -4, NaN, Infinity])('rejects invalid grid dimension %s', (n) => {
    expect(() => makePolarDem(raw, n, 100, 1)).toThrow(RangeError);
  });
  it('rejects the wrong sample count or sample type', () => {
    expect(() => makePolarDem(new Int16Array(15), 4, 100, 1)).toThrow(RangeError);
    expect(() => makePolarDem(new Float32Array(16) as unknown as Int16Array, 4, 100, 1)).toThrow(RangeError);
  });
  it.each([0, -1, NaN, Infinity])('rejects invalid grid scale %s', (scale) => {
    expect(() => makePolarDem(raw, 4, scale, 1)).toThrow(RangeError);
    expect(() => makePolarDem(raw, 4, 100, scale)).toThrow(RangeError);
  });
  it('rejects overflowing heights and malformed DEM objects at the horizon boundary', () => {
    expect(() => makePolarDem(new Int16Array(4).fill(32767), 2, 100, 1e308)).toThrow(RangeError);
    expect(() => computeTerrainHorizon({ ...dem, n: 0 }, -90, 0, 2)).toThrow(RangeError);
    expect(() => computeTerrainHorizon({ ...dem, maxHeightM: Infinity }, -90, 0, 2)).toThrow(RangeError);
  });
  it.each([-90.000001, -90.01, 90.01, NaN, Infinity])('rejects invalid latitude %s', (lat) => {
    expect(() => computeTerrainHorizon(dem, lat, 0, 2)).toThrow(RangeError);
    expect(() => demPixel(dem, lat, 0)).toThrow(RangeError);
  });
  it.each([-180.01, 180.01, NaN, Infinity])('rejects invalid longitude %s', (lon) => {
    expect(() => computeTerrainHorizon(dem, -90, lon, 2)).toThrow(RangeError);
    expect(() => demHeightAt(dem, -90, lon)).toThrow(RangeError);
  });
  it.each([-1, 20001, NaN, Infinity])('rejects invalid observer height %s', (height) => {
    expect(() => computeTerrainHorizon(dem, -90, 0, height)).toThrow(RangeError);
  });
  it.each<HorizonOptions>([
    { azStepDeg: 0 }, { azStepDeg: -1 }, { azStepDeg: NaN }, { azStepDeg: Infinity },
    { azStepDeg: 7 }, { azStepDeg: 360 / 36001 }, { azStepDeg: Number.MIN_VALUE },
    { firstStepM: 0 }, { firstStepM: -1 }, { firstStepM: NaN }, { firstStepM: Infinity },
    { firstStepM: Number.MIN_VALUE }, { firstStepM: 2000, maxDistanceKm: 1 },
    { maxDistanceKm: 0 }, { maxDistanceKm: -1 }, { maxDistanceKm: NaN }, { maxDistanceKm: Infinity },
    { maxDistanceKm: Math.PI * R_M / 1000 + 1 }, { azStepDeg: 0.01 },
  ])('rejects unusable or excessive sampling before entering the ray loop: %j', (options) => {
    expect(() => computeTerrainHorizon(dem, -90, 0, 2, options)).toThrow(RangeError);
  });
  it('accepts a finite one-bin, one-distance request', () => {
    const result = computeTerrainHorizon(dem, -90, 0, 2, { azStepDeg: 360, firstStepM: 50, maxDistanceKm: 0.05 });
    expect(result.profile.elDeg).toHaveLength(1);
    expect(Number.isFinite(result.profile.elDeg[0])).toBe(true);
    expect(result.profile.elDeg[0]).toBeGreaterThan(-90);
  });
});
