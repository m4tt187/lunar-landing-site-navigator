<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- AI-assisted: written with OpenAI Codex under the direction of the team. -->
# Engine contract v1

The public entry is `engine/src/index.ts` (UI alias `@engine`). Types are in
`engine/src/types.ts`. No DOM, network requests, or Node APIs in the browser core.

- Times: UTC milliseconds since Unix epoch. Angles: degrees. Longitude: east
  positive, -180 to +180. Azimuth: north 0, east 90, clockwise. Elevation: local
  tangent plane. Heights: metres above the 1737.4 km lunar reference sphere.
- `computeSample(site, tMs)` returns topocentric Sun/Earth directions, ranges in
  km, and angular radii. Refraction is absent. The initial analytic model uses
  Astronomy Engine with its IAU 2009 Moon orientation, an approximation to the
  high-precision mean-Earth frame used by Horizons. Measured error is reported
  separately; this is not a mission-navigation model.
- `computeSeries(site, startMs, endMs, stepS)` includes both endpoints. `timesMs`
  and `endMs` are additions to the initial proposal: the last interval can be
  shorter than `stepS`. Consumers MUST use `timesMs[i]` for timestamps.
- `HorizonProfile` samples a periodic 360-degree skyline. `elDeg.length *
  azStepDeg` must equal 360 (within floating-point tolerance). A singleton with
  step 360 is a constant horizon. A zero profile represents a smooth tangent
  horizon, without terrain or height-dependent curvature dip.
- `horizonElevationAt` uses periodic linear interpolation, including 359→0.
- Solar visibility is the fraction of a circular solar disk above the local
  skyline (straight-edge approximation). It is geometric visibility, not power
  output; it does not include eclipses, slopes, equipment, or dust.
- `sunMinDiskFraction` lies in [0,1]. Zero means any nonzero visible disk;
  one means the full disk. Intermediate thresholds are inclusive. Earth
  visibility uses the centre above skyline plus the requested elevation margin;
  it is a geometric line-of-sight proxy, not a guaranteed communications link.
- Summary fractions and interval durations are time-weighted. Crossings use
  interpolation between samples and therefore have sampling uncertainty.
  Longest night and longest communications gap are clipped to the selected
  interval; they may extend beyond it. Narrow events can be missed at coarse
  cadence. `meanSunDiskFraction` is a trapezoidal time integral.
- `nextEvent(site, profile, thresholds, fromMs, kind, maxSearchDays)` searches
  forward for the next threshold crossing and returns UTC milliseconds or null
  when no crossing is found within the bounded search. A null result does not
  mean the event never occurs. Kinds: sunrise, sunset, earthrise, earthset.

Invalid or nonfinite inputs throw descriptive errors; there are no silent fake
ephemerides or implicit network fallbacks. Use a Web Worker for long series;
annual performance is measured, not guaranteed to be below 100 ms.
