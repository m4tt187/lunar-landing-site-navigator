<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- AI-assisted: written with OpenAI Codex under the direction of the team. -->
# Engine contract v1

The public entry is `engine/src/index.ts` (UI alias `@engine`). Types are in
`engine/src/types.ts`. No DOM, network requests, or Node APIs in the browser core.

- Times: UTC milliseconds since Unix epoch. Angles: degrees. Longitude: east
  positive, -180 to +180. Azimuth: north 0, east 90, clockwise. Elevation: local
  tangent plane. Heights: metres above the 1737.4 km lunar reference sphere.
- `MOON_RADIUS_KM` (1737.4) and `SUN_RADIUS_KM` (695700) are exported from
  `geometry.ts` and the public entry. Both are kilometres, not metres or angular
  radii; a body's angular radius depends on its distance from the observer.
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
- Solar visibility is the fraction of a circular solar disk that is above the
  local skyline (straight-edge approximation) and not covered by the Earth (an
  eclipse; see [eclipses.md](eclipses.md)). It is geometric visibility, not power
  output; it does not include slopes, equipment, or dust.
- `Margins.sunDeg` is positive while at least the required fraction of the disk
  is above the skyline and uncovered by the Earth; `Margins.sunDiskFraction` is
  that visible fraction; `Margins.eclipseFraction` is the fraction covered by the
  Earth (0 outside an eclipse). `sampleMargins`, `seriesMargins`, `summarize` and
  `nextEvent` always take the Earth into account. `marginsOf` does so when its
  optional last argument, the Earth's angular radius, is given; without it the
  result is the skyline alone, as before.
- `Summary.eclipses` lists the eclipses inside the series (first and last
  contact, the deepest moment, totality), from the samples; their darkness is
  already part of the sunlight windows. They are listed whether or not the
  skyline lets the site see the Sun.
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

## Whole-map geometry and eclipses

`createSweep(dem, options)` builds the approximate parallel-light map calculation.
Its receiver window has `size * size` entries in row-major order, starts at DEM
row and column `origin`, and uses `inside` to identify receivers. `run(direction,
out)` writes a visibility mask into a caller-owned `Uint8Array` of that length;
cells outside the receiver disc are zero. Directions are finite nonzero vectors
in the Moon-fixed frame, pointing towards the light; the sweep normalizes them
and accepts directions within 25 degrees of the south pole's horizon.

`Sweep.positions` holds three `Float32Array`s, `x`, `y`, and `z`, with the same
indexing as `inside`. Values are **metres relative to `Sweep.originKm` along the
Moon-fixed axes**, including the ground elevation and the observer's height.
`originKm` is the south pole of the reference sphere, `[0, 0, -1737.4]`, expressed
in Moon-centred kilometres. For example, a receiver's absolute X coordinate in
kilometres is `originKm[0] + positions.x[k] / 1000`. Entries outside `inside` are
zero and are not physical receiver positions. Treat all these arrays as
read-only; modifying them would change the geometry used by the calculation.

The sweep limits observer height to 0–1000 m, requires positive finite bin size
and finite nonnegative reach, and refuses more than forty million sweep bins.
Terrain beyond the DEM is not represented as an obstacle. The sweep's agreement
with independent ray marching was measured on the same 480 m model; it is not an
accuracy guarantee against the finer 120 m site calculation.

The public eclipse helpers used by the map have separate responsibilities:

| Helper | Inputs and result |
|---|---|
| `eclipseOverArea(pointKm, reachKm, sunKm, earthKm, fraction)` | All positions are Moon-centred, Moon-fixed kilometres. The reach encloses the receiver area. Returns 0 if the Earth alone leaves enough Sun throughout the area, 1 if it hides too much throughout, or 2 when individual receivers must be checked. A return value of 2 is a conservative unresolved classification, not proof that both states occur. |
| `hideEclipsedPlaces(x, y, z, pointKm, sunKm, earthKm, fraction, mask)` | Receiver offsets are metres relative to `pointKm`, as in `Sweep.positions`. Clears already-lit mask entries where the Earth alone hides too much Sun; returns the number cleared and never lights an entry. Arrays must have matching lengths. The fast threshold correction is an approximation, with its measured comparisons in [eclipses.md](eclipses.md). |
| `skylineLimitInEclipse(sunRadiusDeg, state, fraction)` | Returns the highest straight skyline relative to the Sun's centre, in degrees, that permits the required common visible portion of the disc; `null` means the Earth alone already prevents that fraction. The state is an `EclipseState` from the same observer and Sun radius. This low-level helper does not validate inputs. |

Neither of the first two helpers tests terrain. In particular, area flag 0 does
not mean that no part of the Sun is eclipsed: the Earth may still cover exactly
the part that the skyline leaves showing. An AND of independent terrain and
Earth visibility flags is insufficient for a partially visible disc.

For a required fraction of zero, the skyline must be strictly below the returned
level to leave positive visible area. Positive fractions use an inclusive
threshold, subject to the numerical precision of the level calculation. The
zero-fraction level uses the highest uncovered point of the disc; intermediate
fractions use bisection of the combined visible area. Angles in `EclipseState`
and the Sun radius are degrees, including the atmosphere-enlarged Earth radius.

The application composes these helpers in `web/src/map/visibility.ts` and sends
the resulting directions to its workers. Its map rules are 0, 0.5, and 1. The
terrain direction uses one skyline level computed at the pole per instant;
Earth-only masking uses each receiver's position. This shared level and the
spatial sweep remain approximations, especially near eclipse contacts. Per-site
summaries use the site's own skyline and sky geometry instead. The measured
limits and reproducible validation are in [eclipses.md](eclipses.md#on-the-map).

## Further modules

Each has its own page: the interpolated vector table that makes ten-minute
sampling affordable ([ephemeris.md](ephemeris.md)), eclipses
([eclipses.md](eclipses.md)), planning and site-and-date recommendation
([planning.md](planning.md)), and the 120 m terrain tiles for picked sites
([tiles.md](tiles.md)).

High-level computation and analysis entry points validate their documented
inputs. Fast low-level helpers such as `sampleFromVectors`, `eclipseState`, and
`skylineLimitInEclipse` expect already validated geometry; they do not provide
that boundary themselves. There are no silent fake ephemerides or implicit
network fallbacks. Use a Web Worker for long series; annual performance is
measured, not guaranteed to be below 100 ms.
