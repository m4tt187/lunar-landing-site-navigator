// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// Two real south-polar landings, against what NASA's Jet Propulsion Laboratory
// reported about their direct-to-Earth links:
//   M. Sanchez Net, "Dynamics of a Coherent Reflection on Direct-with-Earth Links
//   between a Planetary Body and an Earth Station", IPN Progress Report 42-240,
//   15 February 2025, https://ipnpr.jpl.nasa.gov/progress_report/42-240/42-240A.pdf
// - IM-1 (landed 22 February 2024 at -80.1276, 1.4367, 2579 m): "experienced low
//   elevation angles ranging from 15 deg at landing down to 10 deg during the
//   last contact".
// - Chandrayaan-3 (landed 23 August 2023): "During landing, Earth was approximately
//   11 deg above the lunar local terrain, and it dipped down to 6 deg or 7 deg at
//   its lowest point, later in the mission".
// The engine gives elevations above the local horizontal; the report's Chandrayaan-3
// figures are above the local terrain, so they are a little lower.
import { describe, expect, it } from 'vitest';
import { computeSample } from '../../engine/src/index.ts';
import type { Site } from '../../engine/src/index.ts';

const HOUR = 3600000;
const earthElevation = (site: Site, iso: string): number => computeSample(site, Date.parse(iso)).earth.elDeg;

describe('Earth elevation at two real landings (JPL IPN Progress Report 42-240)', () => {
  it('IM-1: about 15 degrees on the landing day, about 10 degrees a week later', () => {
    const site: Site = { id: 'im-1', name: 'IM-1', latDeg: -80.1276, lonDeg: 1.4367, heightM: 2579 };
    const landing = earthElevation(site, '2024-02-22T23:00:00Z');
    const late = earthElevation(site, '2024-02-28T00:00:00Z');
    console.log(`IM-1: Earth ${landing.toFixed(2)} deg on the landing day, ${late.toFixed(2)} deg on 28 February`);
    expect(landing).toBeGreaterThan(14.5);
    expect(landing).toBeLessThan(16);
    expect(late).toBeGreaterThan(9);
    expect(late).toBeLessThan(10.5);
  });

  it('Chandrayaan-3: a little above 11 degrees at landing, dipping to a little above 6-7 degrees', () => {
    // Coordinates published by the LROC team: https://www.lroc.asu.edu/images/1314
    const site: Site = { id: 'ch-3', name: 'Chandrayaan-3', latDeg: -69.3741, lonDeg: 32.32, heightM: 532 };
    const landing = earthElevation(site, '2023-08-23T12:30:00Z');
    let lowest = Infinity;
    for (let t = Date.parse('2023-08-23T12:30:00Z'); t <= Date.parse('2023-09-04T00:00:00Z'); t += HOUR)
      lowest = Math.min(lowest, computeSample(site, t).earth.elDeg);
    console.log(`Chandrayaan-3: Earth ${landing.toFixed(2)} deg at landing, lowest ${lowest.toFixed(2)} deg before 4 September`);
    expect(landing).toBeGreaterThan(11);
    expect(landing).toBeLessThan(14);
    expect(lowest).toBeGreaterThan(6);
    expect(lowest).toBeLessThan(10);
  });
});
