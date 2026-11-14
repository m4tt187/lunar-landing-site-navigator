// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeSample } from '../../engine/src/geometry.ts';

interface Fixture {
  site: { id: string; name: string; lonDeg: number; latDeg: number; heightM: number };
  body: 'sun' | 'earth';
  start: string;
  rows: [number, number, number, number, number][];
}

const file = fileURLToPath(new URL('../../data/horizons/fixtures.json', import.meta.url));
const { fixtures } = JSON.parse(readFileSync(file, 'utf8')) as { fixtures: Fixture[] };

const DEG = Math.PI / 180;
const jdToMs = (jd: number): number => (jd - 2440587.5) * 86400000;

/** Great-circle angle in degrees between two azimuth/elevation directions. */
function separationDeg(az1: number, el1: number, az2: number, el2: number): number {
  const c =
    Math.sin(el1 * DEG) * Math.sin(el2 * DEG) +
    Math.cos(el1 * DEG) * Math.cos(el2 * DEG) * Math.cos((az1 - az2) * DEG);
  return Math.acos(Math.min(1, Math.max(-1, c))) / DEG;
}

export function measure(): { body: string; n: number; maxSep: number; meanSep: number; maxEl: number; maxRadius: number }[] {
  return (['sun', 'earth'] as const).map((body) => {
    let n = 0, maxSep = 0, sumSep = 0, maxEl = 0, maxRadius = 0;
    for (const f of fixtures) {
      if (f.body !== body) continue;
      for (const [jd, az, el, diameterArcsec] of f.rows) {
        const s = computeSample({ ...f.site }, jdToMs(jd))[body];
        const sep = separationDeg(az, el, s.azDeg, s.elDeg);
        n++; sumSep += sep;
        maxSep = Math.max(maxSep, sep);
        maxEl = Math.max(maxEl, Math.abs(el - s.elDeg));
        maxRadius = Math.max(maxRadius, Math.abs(diameterArcsec / 7200 - s.angularRadiusDeg));
      }
    }
    return { body, n, maxSep, meanSep: sumSep / n, maxEl, maxRadius };
  });
}

describe('engine vs NASA/JPL Horizons', () => {
  const results = measure();
  for (const r of results) {
    it(`${r.body}: ${r.n} reference samples agree`, () => {
      console.log(
        `${r.body}: n=${r.n} max separation=${r.maxSep.toFixed(4)} deg, mean=${r.meanSep.toFixed(4)} deg, ` +
          `max elevation error=${r.maxEl.toFixed(4)} deg, max radius error=${r.maxRadius.toFixed(5)} deg`,
      );
      expect(r.n).toBeGreaterThan(4000);
      expect(r.maxSep).toBeLessThan(0.01);
      expect(r.maxEl).toBeLessThan(0.01);
      expect(r.maxRadius).toBeLessThan(0.002);
    });
  }
});
