// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// The numbers behind the treatment of eclipses on the map (docs/engine/eclipses.md,
// "On the map"):
//
// 1. How far apart the contacts of an eclipse fall across the mapped area: every
//    eclipse seen from the south pole, 2025-2040, against the same eclipse at 24
//    places on the 85 S and 80 S circles.
// 2. How far the level used for the whole map (the highest skyline under which
//    enough of the uncovered Sun shows, computed as seen from the pole by
//    web/src/map/visibility.ts) is from the level each place would compute from
//    its own sky: 300 places south of 80 S, the eclipses of 2025-2030, every two
//    minutes, for "any part shows" and "half the disc shows".
// 3. How far that level drops below the level without the Earth, at the pole.
//
// Usage: npx tsx tools/validation/map-eclipses.ts > docs/validation-map-eclipses.json
import { eclipseState, findEclipses, skylineLimitInEclipse } from '../../engine/src/eclipse.ts';
import { moonFixedVectors, sampleFromVectors } from '../../engine/src/geometry.ts';
import type { MoonFixedVectors } from '../../engine/src/geometry.ts';
import type { EclipseEvent, Site } from '../../engine/src/types.ts';
import { sunLevelDeg } from '../../web/src/map/visibility.ts';

const MIN = 60000, HOUR = 3600000;
const POLE: Site = { id: 'south-pole', name: 'South pole', latDeg: -90, lonDeg: 0, heightM: 0 };
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 16) + 'Z';
const round = (value: number, digits: number): number => Number(value.toFixed(digits));

// 1. Contacts across the mapped area.
const contactYears = [2025, 2040] as const;
const atPole = findEclipses(POLE, Date.UTC(contactYears[0], 0, 1), Date.UTC(contactYears[1], 0, 1));
const circle: Site[] = [];
for (const latDeg of [-85, -80]) for (let lonDeg = -180; lonDeg < 180; lonDeg += 30)
  circle.push({ id: `circle-${latDeg}-${lonDeg}`, name: `${-latDeg} S ${lonDeg}`, latDeg, lonDeg, heightM: 0 });
const contacts = { firstContactMin: 0, lastContactMin: 0, totalityMin: 0, totalHereOnly: 0, totalAtPoleOnly: 0, seenAtPlaceOnly: [] as string[] };
for (const place of circle) {
  const here = findEclipses(place, Date.UTC(contactYears[0], 0, 1), Date.UTC(contactYears[1], 0, 1));
  const same = (a: EclipseEvent, b: EclipseEvent): boolean => Math.abs(a.maxAtMs - b.maxAtMs) < 3 * HOUR;
  for (const event of atPole) {
    const match = here.find((h) => same(h, event));
    if (!match) continue;
    contacts.firstContactMin = Math.max(contacts.firstContactMin, Math.abs(match.startMs - event.startMs) / MIN);
    contacts.lastContactMin = Math.max(contacts.lastContactMin, Math.abs(match.endMs - event.endMs) / MIN);
    if (match.totalStartMs !== null && event.totalStartMs !== null)
      contacts.totalityMin = Math.max(contacts.totalityMin,
        Math.abs(match.totalStartMs - event.totalStartMs) / MIN, Math.abs(match.totalEndMs! - event.totalEndMs!) / MIN);
    else if (match.totalStartMs !== null) contacts.totalHereOnly++;
    else if (event.totalStartMs !== null) contacts.totalAtPoleOnly++;
  }
  for (const h of here) if (!atPole.some((event) => same(h, event))) {
    const date = iso(h.maxAtMs).slice(0, 10);
    if (!contacts.seenAtPlaceOnly.includes(date)) contacts.seenAtPlaceOnly.push(date);
  }
}

// 2 and 3. The level for the whole map against each place's own.
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}
const random = generator(20281231);
const places: Site[] = Array.from({ length: 300 }, (_, i) => ({
  id: `place-${i}`, name: `Place ${i}`, latDeg: -80 - 10 * random(), lonDeg: -180 + 360 * random(), heightM: -4000 + 10000 * random(),
}));

/** The level a place computes from its own sky; null when the Earth alone hides the Sun there (the cell-by-cell test then decides). */
function ownLevel(site: Site, vectors: MoonFixedVectors, rule: number): { level: number | null; covered: number } {
  const sky = sampleFromVectors(site, 0, vectors);
  const radius = sky.sun.angularRadiusDeg;
  const state = eclipseState(sky.sun.azDeg, sky.sun.elDeg, radius, sky.earth.azDeg, sky.earth.elDeg, sky.earth.angularRadiusDeg);
  if (!state || state.coveredFraction <= 0) return { level: (1 - 2 * rule) * radius, covered: 0 };
  return { level: skylineLimitInEclipse(radius, state, rule), covered: state.coveredFraction };
}

const levelYears = [2025, 2031] as const;
const events = findEclipses(POLE, Date.UTC(levelYears[0], 0, 1), Date.UTC(levelYears[1], 0, 1));
const levels = [0, 0.5].map((rule) => {
  const all: number[] = [], awayFromLimit: number[] = [];
  let largestDrop = 0, largestDropAt = '';
  for (const event of events) {
    for (let tMs = event.startMs - 10 * MIN; tMs <= event.endMs + 10 * MIN; tMs += 2 * MIN) {
      const vectors = moonFixedVectors(tMs);
      const mapLevel = sunLevelDeg(vectors, rule);
      const pole = ownLevel(POLE, vectors, rule);
      if (pole.level !== null) {
        const radius = sampleFromVectors(POLE, 0, vectors).sun.angularRadiusDeg;
        const drop = (1 - 2 * rule) * radius - pole.level;
        if (drop > largestDrop) { largestDrop = drop; largestDropAt = iso(tMs); }
      }
      // "Away from the limit": the Earth covers less than nine tenths of what the rule allows, at the pole and at the place.
      const allowed = rule <= 0 ? 1 : 1 - rule;
      for (const place of places) {
        const own = ownLevel(place, vectors, rule);
        if (own.level === null) continue;
        const difference = Math.abs(own.level - mapLevel);
        all.push(difference);
        if (pole.covered < 0.9 * allowed && own.covered < 0.9 * allowed) awayFromLimit.push(difference);
      }
    }
  }
  const summary = (values: number[]): Record<string, number> => {
    const sorted = values.slice().sort((a, b) => a - b);
    const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
    return { cases: sorted.length, medianDeg: round(at(0.5), 4), p95Deg: round(at(0.95), 4), p99Deg: round(at(0.99), 4), largestDeg: round(sorted[sorted.length - 1]!, 4) };
  };
  return {
    sunMinDiskFraction: rule,
    levelForTheMapAgainstEachPlace: summary(all),
    sameAwayFromTheLimit: summary(awayFromLimit),
    largestDropBelowTheLevelWithoutTheEarthAtThePole: { deg: round(largestDrop, 3), at: largestDropAt },
  };
});

console.log(JSON.stringify({
  license: 'Apache-2.0', aiAssisted: 'Anthropic Claude under the direction of the team',
  contactsAcrossTheMap: {
    scope: { years: `${contactYears[0]}-${contactYears[1] - 1}`, eclipsesAtThePole: atPole.length, places: '24 places on the 85 S and 80 S circles, every 30 degrees of longitude, on the reference sphere' },
    method: 'findEclipses at each place against findEclipses at the south pole; the largest difference of each kind of contact.',
    largestFirstContactDifferenceMin: round(contacts.firstContactMin, 1),
    largestLastContactDifferenceMin: round(contacts.lastContactMin, 1),
    largestTotalityContactDifferenceMin: round(contacts.totalityMin, 1),
    totalAtAPlaceAndNotAtThePole: contacts.totalHereOnly,
    totalAtThePoleAndNotAtAPlace: contacts.totalAtPoleOnly,
    seenAtAPlaceAndNotAtThePole: contacts.seenAtPlaceOnly,
  },
  levelForTheWholeMap: {
    scope: { years: `${levelYears[0]}-${levelYears[1] - 1}`, eclipsesAtThePole: events.length, places: '300 pseudo-random places south of 80 S, from 4 km below to 6 km above the reference sphere', everyMinutes: 2 },
    method: 'The level computed by web/src/map/visibility.ts as seen from the pole against skylineLimitInEclipse for the sky of each place, wherever the Earth alone does not hide the Sun at that place.',
    limitations: 'Numerical comparison inside the model. The skyline is taken as straight across the solar disc, as in the per-site analysis.',
    rules: levels,
  },
}, null, 2));
