<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- AI-assisted: written with OpenAI Codex under the direction of the team. -->
# Solar disk over the terrain skyline: measurement

The runtime model uses the skyline at the solar centre's azimuth as a horizontal
edge across the disk. This study compares that approximation with numerical
integration over the disk footprint across the existing piecewise-linear skyline.
It measures this modelling choice only; it does not validate the skyline against
actual terrain or include eclipses.

## Method and reproducibility

`node --import tsx tests/engine/solar-disk-study.ts` reproduces the annual scan.
Optional arguments are UTC start, span in days, step in seconds, and site ID.
For example, the refined case is reproduced with:

```sh
node --import tsx tests/engine/solar-disk-study.ts 2027-06-08T06:00:00Z 14 300 sunlit-2
```

The reference approximation integrates circular-disk vertical slices in the
local angular plane. Horizontal azimuth width is divided by cosine of the solar
elevation. This is appropriate to a small disk near the horizon, not an exact
spherical solid-angle calculation. Equal-x midpoint slices are normalized by
their own full-disk area, preserving exactly zero and full visibility. An
independent analytic check uses the exact circle area above a straight sloping
line; maximum fraction errors for 64/256/1024 slices are respectively 0.000334,
0.0000163, and 0.00000211 over the selected slopes and offsets.

The scan uses all 25 terrain-backed catalogue sites south of 80 S, the 120 m
derived skylines at 2 m above ground, hourly midpoint samples throughout 2027,
and solar rules 0, 0.5 and 1. Rolling spans are 14, 29.53, 90 and 365 days, with
fractional final bins time-weighted. The three most affected sites are also
checked with 256 disk slices; selected worst 14-day windows are rerun every
300 seconds. The machine-readable report includes the input catalogue checksum.

## Result and decision

- Largest annual sunlight-time difference: **0.0457 percentage points**.
- Largest difference among scanned rolling mission spans: **0.5953 percentage
  points**, at hourly cadence. The 256-slice checks give the same time fractions
  at the three selected sites.
- At 300-second cadence in three selected 14-day windows, the largest difference
  is **0.2233 percentage points**.
- Instantaneous visible-disk fraction differences can be larger: approximately
  **0.059** in the annual scan. Small time-fraction differences do not imply
  equally small instantaneous-area errors.

No measured case crosses the agreed one-percentage-point mission-time threshold
for replacing the runtime model. The local-edge implementation is therefore
retained for now. These findings cover the sampled sites, profiles, year, windows
and cadences; they do not prove a uniform bound for every lunar coordinate/date,
especially finer future terrain or very short missions. The reproducible study
can be rerun if the terrain/profile data change.
