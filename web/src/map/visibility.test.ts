// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
// The cases of the Earth and the terrain acting together were found and
// reproduced by OpenAI Codex in an independent review.
//
// What the map shows during an eclipse (web/src/map/visibility.ts) against the
// answer of each place computed on its own: the place's own sky, a skyline
// marched over the same elevation model with geometry written out here, and the
// part of the solar disc that is both above that skyline and outside the Earth.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MOON_RADIUS_KM, SUN_RADIUS_KM, computeTerrainHorizon, createSweep, demHeightAt, earthOffsetFromSun, findEclipses, makePolarDem,
  moonFixedVectors, sampleFromVectors, sampleMargins, sunDiskFractionVisible, sunDiskFractionVisibleWithEarth, sunFractionCoveredByEarth,
  sunHiddenByEarth, sunVisible,
} from '../../../engine/src/index.ts';
import type { HorizonProfile, MoonFixedVectors, PolarDem, Site, Sweep } from '../../../engine/src/index.ts';
import { countVisible, directionsFor, mapReachKm, sunLevelDeg } from './visibility.ts';

const R_M = 1737400, DEG = Math.PI / 180;
const EARTH_RADIUS_KM = 6378.137;
const POLE: Site = { id: 'south-pole', name: 'South pole', latDeg: -90, lonDeg: 0, heightM: 0 };
const file = fileURLToPath(new URL('../../public/data/ldem_75s_480m.i16', import.meta.url));
const buffer = readFileSync(file);
const dem: PolarDem = makePolarDem(new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2), 1906, 480, 0.5);
const MAST_M = 2;

/** Where a body of the given size must be for the south pole to see it at this azimuth, elevation and angular radius. */
function bodyFromPole(azDeg: number, elDeg: number, angularRadiusDeg: number, radiusKm: number): [number, number, number] {
  const distance = radiusKm / Math.sin(angularRadiusDeg * DEG);
  const az = azDeg * DEG, el = elDeg * DEG;
  // At the south pole north is +x, east is +y and up is -z in the Moon-fixed frame.
  return [distance * Math.cos(el) * Math.cos(az), distance * Math.cos(el) * Math.sin(az), -MOON_RADIUS_KM - distance * Math.sin(el)];
}

/** Latitude, longitude and position on the terrain of a cell of the sweep's window. */
function cellSite(sweep: Sweep, k: number): Site {
  const centre = dem.n / 2 - 0.5;
  const row = sweep.origin + Math.floor(k / sweep.size), col = sweep.origin + (k % sweep.size);
  const east = (col - centre) * dem.scaleM, up = (centre - row) * dem.scaleM;
  const latDeg = -90 + (2 * Math.atan(Math.hypot(east, up) / (2 * R_M))) / DEG;
  const lonDeg = Math.atan2(east, up) / DEG;
  return { id: `cell-${k}`, name: `Cell ${k}`, latDeg, lonDeg, heightM: demHeightAt(dem, latDeg, lonDeg) + MAST_M };
}

/** Highest elevation angle (degrees) of the terrain along one azimuth from a site, by brute-force marching. */
function skylineAlong(site: Site, azDeg: number): number {
  const lat = site.latDeg * DEG, lon = site.lonDeg * DEG, az = azDeg * DEG;
  const up = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const along = [0, 1, 2].map((i) => north[i]! * Math.cos(az) + east[i]! * Math.sin(az));
  const r0 = R_M + site.heightM;
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

/** What a place answers on its own: the skyline alone, the Earth alone, and the two together. */
function ownAnswer(site: Site, vectors: MoonFixedVectors, rule: number): { skyline: boolean; earth: boolean; together: boolean } {
  const sky = sampleFromVectors(site, 0, vectors);
  const meets = (fraction: number): boolean => (rule > 0 ? fraction >= rule : fraction > 0);
  const skyline = skylineAlong(site, sky.sun.azDeg);
  const offset = earthOffsetFromSun(sky.sun.azDeg, sky.sun.elDeg, sky.earth.azDeg, sky.earth.elDeg);
  return {
    skyline: meets(sunDiskFractionVisible(sky.sun.elDeg, sky.sun.angularRadiusDeg, skyline)),
    earth: meets(1 - sunFractionCoveredByEarth(offset.separationDeg, sky.sun.angularRadiusDeg, sky.earth.angularRadiusDeg)),
    together: meets(sunDiskFractionVisibleWithEarth(
      sky.sun.elDeg, sky.sun.angularRadiusDeg, skyline, offset.acrossDeg, offset.upDeg, sky.earth.angularRadiusDeg,
    )),
  };
}

/** Small deterministic generator. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}

describe('map layers: the Earth and the terrain together, on a smooth sphere', () => {
  // A small smooth Moon around the pole and an observer on the ground: the skyline is the horizontal.
  const n = 400;
  const smooth = makePolarDem(new Int16Array(n * n), n, 480, 0.5);
  const sweep = createSweep(smooth, { minLatDeg: -88, observerHeightM: 0 });
  const flat: HorizonProfile = { azStepDeg: 1, elDeg: new Float32Array(360) };
  // The four cells around the pole: within 340 m of it.
  const half = sweep.size / 2;
  const atPole = [(half - 1) * sweep.size + half - 1, (half - 1) * sweep.size + half, half * sweep.size + half - 1, half * sweep.size + half];

  const cases = [
    { name: 'any part: the Earth leaves 14 % of the Sun, all of it below the skyline', rule: 0, sunEl: 0, earthEl: 0.85, margin: -0.1241 },
    { name: 'half the disc: each alone leaves 63 %, together 25 %', rule: 0.5, sunEl: 0.05, earthEl: 1.10, margin: -0.0973 },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const thresholds = { sunMinDiskFraction: c.rule, earthMinElevationAboveHorizonDeg: 0 };
      const sun = bodyFromPole(40, c.sunEl, 0.25, SUN_RADIUS_KM);
      const eclipsed: MoonFixedVectors = { sun, earth: bodyFromPole(40, c.earthEl, 1, EARTH_RADIUS_KM) };
      const clear: MoonFixedVectors = { sun, earth: bodyFromPole(220, c.earthEl, 1, EARTH_RADIUS_KM) };

      // The place's own answer: dark with the Earth in front of the Sun, lit with the Earth elsewhere.
      const joint = sampleMargins(sampleFromVectors(POLE, 0, eclipsed), flat, thresholds).sunDeg;
      expect(joint).toBeCloseTo(c.margin, 3);
      expect(sunVisible(joint, thresholds)).toBe(false);
      expect(sunVisible(sampleMargins(sampleFromVectors(POLE, 0, clear), flat, thresholds).sunDeg, thresholds)).toBe(true);

      // The map: the Earth alone hides the Sun from no cell (flag 0), and yet the cells at the pole are dark.
      const rule = { sunFraction: c.rule, earthMarginDeg: 0 };
      const directions = directionsFor(rule, [eclipsed, clear], mapReachKm(-88));
      expect(Array.from(directions.eclipse)).toEqual([0, 0]);
      const eclipsedCount = countVisible(sweep, c.rule, { ...directions, sun: directions.sun.slice(0, 3), earth: directions.earth.slice(0, 3), eclipse: directions.eclipse.slice(0, 1), bodies: directions.bodies.slice(0, 6) });
      const clearCount = countVisible(sweep, c.rule, { ...directions, sun: directions.sun.slice(3), earth: directions.earth.slice(3), eclipse: directions.eclipse.slice(1), bodies: directions.bodies.slice(6) });
      for (const k of atPole) {
        expect(sweep.inside[k]).toBe(1);
        expect(eclipsedCount.sun[k]).toBe(0);
        expect(clearCount.sun[k]).toBe(1);
      }
      // The level tested is below the Sun's centre by more than the skyline is, where without the Earth it is the top or the centre of the disc.
      expect(sunLevelDeg(eclipsed, c.rule)).toBeLessThan(-c.sunEl - 0.03);
      expect(sunLevelDeg(clear, c.rule)).toBeCloseTo((1 - 2 * c.rule) * 0.25, 6);
    });
  }
});

describe('map layers during an eclipse, on the shipped terrain', () => {
  const sweep = createSweep(dem, { minLatDeg: -80, observerHeightM: MAST_M });
  const reachKm = mapReachKm(-80);
  const insideCells: number[] = [];
  for (let k = 0; k < sweep.inside.length; k++) if (sweep.inside[k]) insideCells.push(k);
  const mapAt = (tMs: number, rule: number): { vectors: MoonFixedVectors; sun: Uint16Array; flag: number } => {
    const vectors = moonFixedVectors(tMs);
    const directions = directionsFor({ sunFraction: rule, earthMarginDeg: 0 }, [vectors], reachKm);
    return { vectors, sun: countVisible(sweep, rule, directions).sun, flag: directions.eclipse[0]! };
  };

  it('keeps every cell within the reach used for the quick test', () => {
    const { x, y, z } = sweep.positions;
    let farthest = 0;
    for (const k of insideCells) farthest = Math.max(farthest, Math.hypot(x[k]!, y[k]!, z[k]!) / 1000);
    expect(farthest).toBeLessThan(reachKm);
    expect(farthest).toBeGreaterThan(reachKm - 40);
  });

  it('tests the top, the centre or the bottom of the disc while there is no eclipse', () => {
    const quiet = moonFixedVectors(Date.UTC(2028, 0, 20));
    const radius = sampleFromVectors(POLE, 0, quiet).sun.angularRadiusDeg;
    expect(sunLevelDeg(quiet, 0)).toBe(radius);
    expect(sunLevelDeg(quiet, 0.5)).toBe(0);
    expect(sunLevelDeg(quiet, 1)).toBe(-radius);
  });

  it('is dark at a real place where the terrain leaves 20 % of the Sun, the Earth leaves 22 %, and the two together nothing', () => {
    // 12 January 2028, 03:12:37 UTC, 81.107 S 92.189 W: found on the shipped terrain in the independent review.
    const tMs = Date.UTC(2028, 0, 12, 3, 12, 37), k = 830611;
    const site = cellSite(sweep, k);
    expect(site.latDeg).toBeCloseTo(-81.1073631901, 6);
    expect(site.lonDeg).toBeCloseTo(-92.1889064795, 6);
    const map = mapAt(tMs, 0);
    // The engine's own skyline for the place, and its complete answer.
    const horizon = computeTerrainHorizon(dem, site.latDeg, site.lonDeg, MAST_M, { azStepDeg: 0.25, maxDistanceKm: 250 });
    const thresholds = { sunMinDiskFraction: 0, earthMinElevationAboveHorizonDeg: 0 };
    const sky = sampleFromVectors({ ...site, heightM: horizon.groundHeightM + MAST_M }, tMs, map.vectors);
    // -0.14 degrees: the sliver the Earth leaves is that far below the skyline (the third decimal depends on the azimuth step).
    expect(sampleMargins(sky, horizon.profile, thresholds).sunDeg).toBeCloseTo(-0.14, 2);
    const own = ownAnswer(site, map.vectors, 0);
    expect(own).toEqual({ skyline: true, earth: true, together: false });
    // The Earth alone hides the Sun from no cell at that instant, and the map still shows the place dark.
    expect(map.flag).toBe(0);
    expect(sweep.inside[k]).toBe(1);
    expect(map.sun[k]).toBe(0);
  });

  const partial = [
    { name: 'any part shows, 12 January 2028 03:30', tMs: Date.UTC(2028, 0, 12, 3, 30), rule: 0 },
    { name: 'half the disc shows, 12 January 2028 02:50', tMs: Date.UTC(2028, 0, 12, 2, 50), rule: 0.5 },
  ];
  for (const p of partial) {
    it(`agrees with each place's own answer while the Earth covers part of the Sun: ${p.name}`, () => {
      const map = mapAt(p.tMs, p.rule);
      const random = generator(20280112);
      let cells = 0, agree = 0, litWhereDark = 0, together = 0, togetherDark = 0;
      while (cells < 2500) {
        const k = insideCells[Math.floor(random() * insideCells.length)]!;
        const own = ownAnswer(cellSite(sweep, k), map.vectors, p.rule);
        const onMap = map.sun[k] === 1;
        cells++;
        if (onMap === own.together) agree++; else if (onMap) litWhereDark++;
        // Dark only because the two obstructions act together.
        if (own.skyline && own.earth && !own.together) { together++; if (!onMap) togetherDark++; }
      }
      // The sweep answers for a cell from bins 480 m wide: it agrees with a per-place calculation for about 99 cells in 100.
      expect(agree / cells).toBeGreaterThan(0.98);
      expect(litWhereDark / cells).toBeLessThan(0.01);
      // Such cells exist in the sample, and the map shows most of them dark: tested one obstruction at a time, all would be lit.
      expect(together).toBeGreaterThanOrEqual(10);
      expect(togetherDark / together).toBeGreaterThan(0.6);
    });
  }

  it('splits the map where the Earth alone hides the Sun from some cells and not from others', () => {
    const event = findEclipses(POLE, Date.UTC(2029, 5, 25), Date.UTC(2029, 5, 28))[0]!;
    const tMs = event.totalStartMs!;
    const map = mapAt(tMs, 0);
    expect(map.flag).toBe(2);
    const random = generator(20290626);
    let hidden = 0, hiddenAndLit = 0, clear = 0, clearAndLit = 0;
    for (let i = 0; i < 4000; i++) {
      const k = insideCells[Math.floor(random() * insideCells.length)]!;
      const onMap = map.sun[k] === 1;
      if (sunHiddenByEarth(cellSite(sweep, k), tMs, 0)) { hidden++; if (onMap) hiddenAndLit++; } else { clear++; if (onMap) clearAndLit++; }
    }
    // At the instant totality begins at the pole about half the map has already lost the Sun.
    expect(hidden).toBeGreaterThan(1000);
    expect(clear).toBeGreaterThan(1000);
    expect(hiddenAndLit).toBe(0);
    expect(clearAndLit).toBeGreaterThan(100);
    // A quarter of an hour later no cell has the Sun, and the quick test says so without looking at the cells.
    const later = mapAt(tMs + 15 * 60000, 0);
    expect(later.flag).toBe(1);
    expect(later.sun.every((value) => value === 0)).toBe(true);
  });
});
