// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// Ready-made comparisons: one click sets up the scenarios, the mission span and
// the map layer. Dates are fixed so that a comparison shows the same thing to
// everyone; `null` means "tomorrow".
import type { MapLayer } from './state';

export interface Preset {
  id: string;
  label: string;
  /** One sentence saying what to look for. */
  hint: string;
  durationDays: number;
  layer: MapLayer;
  scenarios: { siteId: string; mastM: number; start: string | null }[];
}

export const PRESETS: Preset[] = [
  {
    id: 'rim-floor', label: 'Rim vs Floor of Shackleton',
    hint: 'Ten kilometres apart: a ridge that is lit most of the time, and a crater floor the Sun never reaches.',
    durationDays: 29.53, layer: 'both',
    scenarios: [{ siteId: 'sunlit-4', mastM: 2, start: null }, { siteId: 'feature-5450', mastM: 2, start: null }],
  },
  {
    id: 'seasons', label: 'Same Ridge, Summer vs Winter',
    hint: 'The same landing site six months apart: the date matters as much as the place.',
    durationDays: 29.53, layer: 'sun',
    scenarios: [{ siteId: 'sunlit-1', mastM: 2, start: '2026-12-10T00:00' }, { siteId: 'sunlit-1', mastM: 2, start: '2027-06-10T00:00' }],
  },
  {
    id: 'mast', label: 'Raise the Panels: 2 m, 10 m, 50 m',
    hint: 'One place, three heights above the ground: near the pole a taller mast can see over the next ridge.',
    durationDays: 365, layer: 'sun',
    scenarios: [{ siteId: 'sunlit-8', mastM: 2, start: null }, { siteId: 'sunlit-8', mastM: 10, start: null }, { siteId: 'sunlit-8', mastM: 50, start: null }],
  },
  {
    id: 'pole-equator', label: "Apollo 11's Site vs the South Pole",
    hint: 'Near the equator the Sun climbs overhead and then sets for two weeks; at the pole it circles the horizon.',
    durationDays: 29.53, layer: 'now',
    scenarios: [{ siteId: 'apollo-11', mastM: 2, start: null }, { siteId: 'sunlit-1', mastM: 2, start: null }],
  },
  {
    id: 'missions', label: 'Two Real Landings: IM-1 and IM-2',
    hint: 'The sky that two commercial landers had from the day they touched down (time of day approximate).',
    durationDays: 14, layer: 'now',
    scenarios: [{ siteId: 'im-1-odysseus', mastM: 2, start: '2024-02-22T23:00' }, { siteId: 'im-2-athena', mastM: 2, start: '2025-03-06T17:00' }],
  },
  {
    id: 'peaks', label: 'Four Best-Lit Peaks over a Year',
    hint: "The four places with the most sunlight in NASA's long-term map, compared over the coming year.",
    durationDays: 365, layer: 'both',
    scenarios: ['sunlit-1', 'sunlit-2', 'sunlit-3', 'sunlit-4'].map((siteId) => ({ siteId, mastM: 2, start: null })),
  },
];
