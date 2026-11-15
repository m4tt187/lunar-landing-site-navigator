// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// The plain computation behind the map layers, kept apart from the page and
// from the background workers so that it can be tested: which directions to
// test at each instant, and what every cell of the map sees at those instants.
//
// Eclipses on the map, in two steps.
//
// 1. The Earth alone. The same contact falls up to eight minutes apart between
//    the pole and the edge of the mapped area, so every cell is tested against
//    the Earth's disc as seen from that cell. A quick test for the whole area
//    says when no cell, or every cell, can be affected.
// 2. The Earth and the terrain together. While the Earth covers part of the Sun,
//    the terrain is tested against what is left of the disc: the direction tested
//    is no longer its top, centre or bottom but the highest skyline under which
//    enough of the uncovered part still shows. That level is computed once per
//    instant, as seen from the pole. Measured over the eclipses of 2025-2030, it
//    is within 0.08 degrees of the level a cell would compute from its own sky
//    for 99 % of cells and instants (largest difference 0.21 degrees, in the
//    minutes around a contact). It is one more approximation of the map; what it
//    costs is measured by comparing the map with each cell's own answer
//    (visibility.test.ts, docs/engine/eclipses.md).
import {
  MOON_RADIUS_KM, directionFromPole, eclipseOverArea, eclipseState, hideEclipsedPlaces, raiseDirection, sampleFromVectors,
  skylineLimitInEclipse,
} from '@engine/index';
import type { MoonFixedVectors, Site, Sweep } from '@engine/index';

const DEG = Math.PI / 180;
/** The south pole on the reference sphere: Moon-centred, Moon-fixed frame, kilometres. */
const POLE_KM = [0, 0, -MOON_RADIUS_KM] as const;
const POLE: Site = { id: 'south-pole', name: 'South pole', latDeg: -90, lonDeg: 0, heightM: 0 };

/** What counts as "Sun up" and "Earth in view" on the map. */
export interface SkyRule {
  /** Minimum visible fraction of the solar disc: 0 (any part), 0.5 or 1 (the whole disc). */
  sunFraction: number;
  /** How far above the skyline the Earth's centre must be, degrees. */
  earthMarginDeg: number;
}

/** What is tested at a set of instants. */
export interface Directions {
  /** Three numbers per instant: the direction tested against the terrain for the Sun. */
  sun: Float64Array;
  /** Three numbers per instant: the direction tested for the Earth. */
  earth: Float64Array;
  /** One flag per instant: 0 when the Earth alone hides the Sun from no cell, 1 from every cell, 2 from some. */
  eclipse: Uint8Array;
  /** Six numbers per instant: where the Sun and the Earth are (Moon-centred, Moon-fixed frame, kilometres). */
  bodies: Float64Array;
}

/** How far from the pole a cell of the map can be: the chord to its edge, plus room for the relief and the mast. */
export function mapReachKm(minLatDeg: number): number {
  return 2 * MOON_RADIUS_KM * Math.sin(((90 + minLatDeg) / 2) * DEG) + 25;
}

/**
 * How far above the Sun's centre the tested direction is, in degrees: the highest
 * skyline under which the rule is still met. Outside an eclipse that is the top
 * of the disc for "any part", its centre for "half", its bottom for "the whole
 * disc"; while the Earth covers part of the Sun it is lower (step 2 above).
 */
export function sunLevelDeg(vectors: MoonFixedVectors, sunFraction: number): number {
  const sky = sampleFromVectors(POLE, 0, vectors);
  const radius = sky.sun.angularRadiusDeg;
  const state = eclipseState(sky.sun.azDeg, sky.sun.elDeg, radius, sky.earth.azDeg, sky.earth.elDeg, sky.earth.angularRadiusDeg);
  if (!state || state.coveredFraction <= 0) return (1 - 2 * sunFraction) * radius;
  const level = skylineLimitInEclipse(radius, state, sunFraction);
  if (level !== null) return level;
  // At the pole the Earth alone hides the Sun; near a contact some cells still escape it and are
  // found one by one. For those the last light is at the point of the Sun's limb farthest from
  // the Earth ("any part"), or needs the whole of what is left: the bottom of the disc.
  return sunFraction <= 0 && state.separationDeg > 0 ? (-radius * state.upDeg) / state.separationDeg : -radius;
}

/** The directions to test, and the state of the eclipse, for each set of Sun and Earth positions. */
export function directionsFor(rule: SkyRule, vectors: readonly MoonFixedVectors[], reachKm: number): Directions {
  const count = vectors.length;
  const sun = new Float64Array(count * 3), earth = new Float64Array(count * 3);
  const eclipse = new Uint8Array(count), bodies = new Float64Array(count * 6);
  vectors.forEach((v, i) => {
    eclipse[i] = eclipseOverArea(POLE_KM, reachKm, v.sun, v.earth, rule.sunFraction);
    bodies.set(v.sun, 6 * i); bodies.set(v.earth, 6 * i + 3);
    // Raise or lower the tested direction so that the rule becomes a point test.
    sun.set(raiseDirection(v.sun, sunLevelDeg(v, rule.sunFraction)), 3 * i);
    earth.set(raiseDirection(directionFromPole(v.earth), -rule.earthMarginDeg), 3 * i);
  });
  return { sun, earth, eclipse, bodies };
}

/** For every cell of the sweep's window: at how many of the instants it saw the Sun, the Earth, and both at once. */
export interface Counts { samples: number; sun: Uint16Array; earth: Uint16Array; both: Uint16Array }

/** Runs the sweep for every instant and adds up what each cell sees. */
export function countVisible(sweep: Sweep, sunFraction: number, directions: Directions): Counts {
  const cells = sweep.size * sweep.size;
  const samples = directions.sun.length / 3;
  const sun = new Uint16Array(cells), earth = new Uint16Array(cells), both = new Uint16Array(cells);
  const sunMask = new Uint8Array(cells), earthMask = new Uint8Array(cells);
  const { x, y, z } = sweep.positions;
  for (let i = 0; i < samples; i++) {
    const state = directions.eclipse[i];
    if (state === 1) sunMask.fill(0);
    else {
      sweep.run([directions.sun[3 * i]!, directions.sun[3 * i + 1]!, directions.sun[3 * i + 2]!], sunMask);
      if (state === 2) {
        const b = directions.bodies, o = 6 * i;
        hideEclipsedPlaces(x, y, z, sweep.originKm, [b[o]!, b[o + 1]!, b[o + 2]!], [b[o + 3]!, b[o + 4]!, b[o + 5]!], sunFraction, sunMask);
      }
    }
    sweep.run([directions.earth[3 * i]!, directions.earth[3 * i + 1]!, directions.earth[3 * i + 2]!], earthMask);
    for (let k = 0; k < cells; k++) {
      const a = sunMask[k]!, e = earthMask[k]!;
      sun[k] = sun[k]! + a; earth[k] = earth[k]! + e; both[k] = both[k]! + (a & e);
    }
  }
  return { samples, sun, earth, both };
}
