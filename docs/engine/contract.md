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
  A finite step larger than the span yields exactly the two endpoints, including
  if seconds-to-milliseconds conversion would overflow. A step that cannot
  produce strictly increasing timestamps at the requested epoch is rejected.
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
  visibility uses the centre at or above skyline plus the requested elevation margin;
  it is a geometric line-of-sight proxy, not a guaranteed communications link.
- `sunVisible(marginDeg, thresholds)` and `earthVisible(marginDeg)` expose these
  exact predicates for consumers. Summaries and next-event searches use the same
  exports. Margins must be finite; a zero solar margin is visible only for a
  positive required disk fraction, while a zero Earth margin meets the rule.
- Summary fractions and interval durations are time-weighted. Crossings use
  interpolation between samples and therefore have sampling uncertainty.
  Longest night and longest communications gap are clipped to the selected
  interval; they may extend beyond it. Narrow events can be missed at coarse
  cadence. `meanSunDiskFraction` is a trapezoidal time integral.
- `nextEvent(site, profile, thresholds, fromMs, kind, maxSearchDays)` searches
  forward for the next threshold crossing and returns UTC milliseconds or null
  when no crossing is found within the bounded search. A null result does not
  mean the event never occurs. Kinds: sunrise, sunset, earthrise, earthset.
  Both ends must lie within the engine's time coverage. The optional coarse step
  must advance time; at most 100000 coarse intervals are allowed. Detected
  crossings are refined to a roughly one-second bracket. Events narrower than
  the coarse scan can be missed; the bracket is not a physical accuracy claim.

## Input and work limits

Profiles must cover 360 degrees with finite elevations in [-90, 90]. Bulk
analysis checks all samples once; individual horizon lookups validate the
queried segment in constant time. Series arrays must match `n`, have finite
values and positive angular radii, and include both endpoints with strictly
increasing timestamps. Invalid inputs throw rather than produce apparent
darkness, NaN fractions, or nonterminating loops.

Terrain grids require at least 2 by 2 Int16 samples and positive finite scales.
Observer heights above ground are 0–20000 m. Ray distance and first step must be
finite and positive, and the first step cannot exceed the distance. Azimuth bins
must divide 360 degrees, at most 36000 bins, subject to a preflight work limit of
five million estimated terrain samples. Finite distance is at most a lunar
semicircle. A returned `truncated` flag means a ray left the model before the
remaining terrain could be bounded, and must be disclosed by consumers.

`computeTerrainHorizon` also accepts `HeightField`; `polarDemField` adapts an
existing grid. The synchronous provider supplies heights in the same lunar
reference sphere, a conservative global maximum, and its finest resolution.
Unknown coverage is NaN. See [height-field.md](height-field.md) for composition,
validation requirements and the unchanged direct-grid path.
The optional `HorizonOptions.originHeightM` replaces ground plus mast with an
absolute eye height above the reference sphere, allowing different-resolution
fields to share one physical observer. It must be finite and above the lunar
centre; the field must still contain the observer's ground location.
`minDistanceM` skips near samples on the original ray sampling lattice, without
enlarging the increment. Use it rather than a large `firstStepM` to partition
near and far terrain. Empty sampling ranges are rejected.

Invalid or nonfinite inputs throw descriptive errors; there are no silent fake
ephemerides or implicit network fallbacks. Use a Web Worker for long series;
annual performance is measured, not guaranteed to be below 100 ms.
