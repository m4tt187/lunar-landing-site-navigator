// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with OpenAI Codex under the direction of the team.
import { describe, expect, it } from 'vitest';
import { computeTerrainHorizon, makePolarDem } from '../../engine/src/terrain';
import type { PolarDem } from '../../engine/src/terrain';

const R_M = 1737400;
const DEG = Math.PI / 180;

function asymmetricDem(): PolarDem {
  const n = 81, scaleM = 200;
  const raw = Int16Array.from({ length: n * n }, (_, i) => {
    const x = (i % n - (n - 1) / 2) * scaleM;
    const y = ((n - 1) / 2 - Math.floor(i / n)) * scaleM;
    return Math.round(
      1000 * Math.exp(-((x - 2000) ** 2 + (y - 2000) ** 2) / (2 * 600 ** 2)) +
      700 * Math.exp(-((x + 3000) ** 2 + (y - 1000) ** 2) / (2 * 800 ** 2)),
    );
  });
  return makePolarDem(raw, n, scaleM, 1);
}

describe('terrain geometry at the south pole', () => {
  const dem = asymmetricDem();
  const options = { azStepDeg: 45, maxDistanceKm: 5 };
  const pole = computeTerrainHorizon(dem, -90, 0, 2, options);

  it('preserves asymmetric skyline directions and continuity over a three-centimetre displacement', () => {
    const near = computeTerrainHorizon(dem, -89.999999, 0, 2, options);
    expect(Math.max(...pole.profile.elDeg) - Math.min(...pole.profile.elDeg)).toBeGreaterThan(10);
    for (let i = 0; i < pole.profile.elDeg.length; i++) {
      expect(Number.isFinite(pole.profile.elDeg[i])).toBe(true);
      expect(Math.abs(pole.profile.elDeg[i]! - near.profile.elDeg[i]!)).toBeLessThan(0.002);
    }
  });

  it.each([-180, -135, -90, -45, 0, 45, 90, 135, 180])('only relabels azimuths when pole longitude is %s degrees', (lon) => {
    const rotated = computeTerrainHorizon(dem, -90, lon, 2, options);
    expect(rotated.groundHeightM).toBe(pole.groundHeightM);
    for (let i = 0; i < pole.profile.elDeg.length; i++) {
      const j = (i + lon / options.azStepDeg + 8) % 8;
      expect(rotated.profile.elDeg[i]).toBeCloseTo(pole.profile.elDeg[j]!, 5);
    }
  });

  it('retains the established off-pole result', () => {
    const n = 241;
    const raw = Int16Array.from({ length: n * n }, (_, i) =>
      Math.round(200 * Math.sin((i % n) / 9) + 120 * Math.cos(Math.floor(i / n) / 13)),
    );
    const result = computeTerrainHorizon(makePolarDem(raw, n, 2000, 1), -85, 37, 10, { azStepDeg: 45, maxDistanceKm: 60 });
    // Reference from the nonsingular forward-geodesic implementation at this site.
    const expected = [-0.04176754, 0.37317723, 0.44350576, 0.14552322, -0.31292173, -0.64295262, -0.77038985, -0.52657443];
    expected.forEach((angle, i) => expect(result.profile.elDeg[i]).toBeCloseTo(angle, 6));
    expect(result.groundHeightM).toBeCloseTo(-102.58255799, 7);
    expect(result.truncated).toBe(false);
  });

  it('marks rays that leave the elevation grid before the skyline is bounded', () => {
    const small = makePolarDem(new Int16Array(16), 4, 100, 1);
    const result = computeTerrainHorizon(small, -90, 0, 2, { azStepDeg: 90, maxDistanceKm: 1 });
    expect(result.truncated).toBe(true);
    for (const angle of result.profile.elDeg) {
      expect(Number.isFinite(angle)).toBe(true);
      expect(angle).toBeGreaterThan(-90);
    }
  });

  it.each([2, 10, 50])('approximates the analytic smooth-sphere dip at %s metres', (heightM) => {
    const flat = makePolarDem(new Int16Array(401 * 401), 401, 100, 1);
    const result = computeTerrainHorizon(flat, -90, 0, heightM, { azStepDeg: 45, maxDistanceKm: 20 });
    const dip = -Math.acos(R_M / (R_M + heightM)) / DEG;
    for (const angle of result.profile.elDeg) expect(angle).toBeCloseTo(dip, 4);
    expect(result.truncated).toBe(false);
  });
});

