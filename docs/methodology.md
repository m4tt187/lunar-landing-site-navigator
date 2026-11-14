# Methodology

How the Lunar Landing Site Navigator computes what it shows, how each part was checked,
and where its limits are. Code references are to this repository.

## 1. Conventions

| Quantity | Convention |
|---|---|
| Time | UTC. Landings from 2 February 2000 to 29 August 2049 (the ephemeris is used from 2000 to 2050, and the calendar looks more than a year ahead). |
| Latitude, longitude | Planetocentric latitude, north positive; longitude east positive, −180° to 180°; Mean Earth / Polar Axis frame (the frame of the LOLA products). |
| Lunar radius | 1737.4 km reference sphere. Heights are metres above it. |
| Azimuth | Clockwise from local north (0° north, 90° east). |
| Elevation | Angle above the local horizontal plane. There is no atmosphere, hence no refraction. |
| Observer | The ground height of the terrain model at the site plus the chosen height of the panels or antenna (2, 10 or 50 m). |

## 2. The Sun and the Earth seen from a site

`engine/src/geometry.ts`

1. The positions of the Sun and of the Earth relative to the Moon's centre, as seen at
   the moment of observation (corrected for light-time and aberration), come from
   Astronomy Engine in the J2000 equatorial frame.
2. They are rotated into the Moon-fixed frame with the lunar pole and prime meridian of
   the IAU rotation model, as provided by Astronomy Engine.
3. The observer's own position on the surface is subtracted — it matters for the Earth,
   which is only about 221 lunar radii away — and the result is projected on the local
   east, north and up directions to give azimuth and elevation. The angular radius of
   each body follows from its radius (695,700 km and 6,378.137 km) and its distance.

The Moon-fixed vectors of step 2 do not depend on the site. The application computes
them once per time grid and reuses them for every scenario and for the map.

**Check.** `tools/horizons/fetch_fixtures.py` downloads from NASA/JPL Horizons the
apparent azimuth and elevation of the Sun and of the Earth for observers at nine places on
the Moon (the pole, near-polar and mid-latitude sites, the equator, the far side) in five
windows between 2026 and 2035: 90 tables, 9,810 values, stored unmodified with their
request URLs in `data/horizons/fixtures.json`. `tests/engine/horizons.test.ts` compares
every value. Largest angular difference: 0.0039° for the Sun, 0.0035° for the Earth; mean
0.002°. The test fails above 0.01°. For scale, the Sun's disc is 0.53° wide.

Outside those windows the agreement is expected to be similar but is not tested.

**Check against real missions.** `tests/engine/missions.test.ts` compares the Earth's
elevation at the landing sites of IM-1 and Chandrayaan-3 with the values reported in JPL's
IPN Progress Report 42-240 (see [references](references.md)): IM-1, 15.4° on the landing
day and 9.6° on 28 February 2024, against "15 deg at landing down to 10 deg during the
last contact"; Chandrayaan-3, 13.0° above the horizontal at landing and 9.6° at its
lowest before 4 September 2023, against "approximately 11°" and "6° or 7°" above the
local terrain (the report subtracts the terrain; this check does not).

## 3. The terrain skyline

`engine/src/terrain.ts`, `tools/terrain/build.ts`

**Data.** NASA LOLA gridded elevation model `LDEM_75S_120M`: 7624 × 7624 heights at 120 m
spacing, polar stereographic projection centred on the south pole, covering 75° S to the
pole. The grid is read exactly as the LOLA team's projection description
(`DSMAP_POLAR.CAT`) specifies: for a point at latitude φ and longitude λ, the distance
from the pole on the map is 2R·tan((90° − |φ|)/2), with longitude 0 pointing up and 90° E
pointing right. Heights between grid points are interpolated bilinearly.

**Method.** From the observer, for each azimuth (every 0.25°), a ray is marched over the
curved Moon. At arc distance d along the surface the terrain point is at radius R + h and
at central angle γ = d/R from the observer, whose radius is r₀. Its elevation angle is

    e = atan2((R + h)·cos γ − r₀, (R + h)·sin γ)

and the skyline in that azimuth is the largest e along the ray. Steps start at half a
pixel and grow by 0.4 % of the distance, which keeps the angular resolution constant.
A ray stops when even the highest point of the whole model could no longer rise above
the skyline found so far, when it reaches 400 km, or when it leaves the model. The
destination of each step is computed with a Cartesian tangent basis, so the method is
exact and continuous at the pole itself.

For the marked sites the skylines are computed once, at 120 m, by the build script and
shipped with the application, together with the skylines of the terrain nearer than 3 km
and 30 km (drawn as separate layers so that a nearby ridge can be told from a far
massif). For coordinates chosen on the map the same code runs in the browser on the model
reduced to 480 m (mean of 4 × 4 cells).

**Check.** NASA's LOLA team publishes maps of the average illumination and of the average
Earth visibility of the polar regions (`AVGVISIB_85S_060M_201608` and `…_EARTH`, method of
Mazarico et al. 2011): for each 60 m cell, the fraction of time steps in which any part
of the solar disc, or of the Earth's disc, is above the terrain. `tools/validation/illumination.ts`
computes the same two quantities with this project's code — skyline from the 120 m model
at ground level, Sun and Earth positions every 6 hours over 18.6 years (one full
precession of the lunar orbit), "any part of the disc" as the rule — at 400 pseudo-random
places south of 85.4° S, and compares them with the NASA maps:

| | correlation | mean difference | mean absolute difference | within 0.05 | within 0.10 |
|---|---|---|---|---|---|
| Sunlight | 0.984 | +0.005 | 0.010 | 96.3 % | 98.3 % |
| Earth visibility | 0.983 | +0.007 | 0.012 | 93.8 % | 96.8 % |

All sample values are in `validation-illumination.json`. The remaining differences are
expected: the NASA maps were made from a 60 m model and over a different span of years.

This validates the 120 m chain. The 480 m model used for custom coordinates and for the
map layers is coarser: at some ridge-top places its yearly sunlight differs by ten
percentage points or more from the 120 m result. The application labels such results as
estimates.

## 4. From geometry to answers

`engine/src/analysis.ts`

**Sun.** With the skyline elevation s in the Sun's azimuth, the Sun's elevation e and its
angular radius ρ, let d = (s − e)/ρ. The visible fraction of the disc above a locally
straight skyline is

    f = (acos d − d·√(1 − d²)) / π      for −1 < d < 1,   f = 1 for d ≤ −1,   f = 0 for d ≥ 1.

The Sun counts as up under the chosen rule: "any part of the disc" (f > 0), "at least
half" (f ≥ 0.5) or "the whole disc" (f = 1). The straight-edge approximation ignores the
shape of the skyline across the 0.53° of the disc.

**Earth.** The Earth counts as in view when its centre is at or above the skyline in its
azimuth by the chosen margin (0°, 2° or 5°). The Earth's disc is about 1.9° wide, so with
no margin half of it can be hidden. A margin is offered because radio links that graze
the terrain fade from multipath, as JPL measured on two missions.

**Over a mission.** The scenario is sampled every 30 minutes (up to 31 days), every hour
(up to 100 days) or every 3 hours (a year). Windows of sunlight, of Earth visibility and
of both are the intervals where the corresponding margin is positive; the instant of each
crossing is linearly interpolated between samples. From them: the share of the mission,
the longest night, the longest link gap. The next rise or set after the moment on the
time slider is read from the windows, or searched (hourly steps, then bisection to one
second) up to 60 days beyond the mission.

**Landing calendar.** For each scenario, a year from the start of the month before the
landing is sampled every 2 hours, plus 120 days of look-ahead. For each possible landing
time the calendar shows the length of the unbroken stretch of sunlight, of Earth
visibility and of both that would follow. The "best landing days" are the starts of the
three longest stretches of power and link.

## 5. The whole map at once

`engine/src/sweep.ts`, `web/src/map/`

Light from the Sun or the Earth arrives as parallel rays. Take a frame with one axis u
along the light, one axis a across it, and a third, b, "up". A ray is then a line of
constant (a, b), and a place sees the light exactly when no terrain further along +u, at
the same a, reaches a higher b. So:

1. the terrain is resampled into bins of (a, u) — for each bin, the point of the sphere
   with those coordinates is located in the elevation model, its height is read, and its
   b coordinate is stored (the curvature of the Moon is part of b);
2. along each row of constant a, a running maximum of b is taken from the light's side;
3. a place sees the light when its own b, plus the observer's height, is not below the
   maximum of everything beyond it.

One pass answers the question for all 1.26 million cells south of 80° S in about 0.1 s.
"Any part of the solar disc" is tested by raising the light direction by the Sun's
angular radius (lowering it for "the whole disc"); the Earth's margin by lowering the
Earth's direction. The Earth's direction is taken as seen from the pole; across the
mapped area it varies by less than 0.05°.

The "Now" layer runs the sweep for the moment on the time slider. The mission layers run
it for 120 moments spread evenly over the mission (a low-discrepancy sequence, so that a
partial result is already unbiased) and count, for every cell, the moments with sunlight,
with the Earth in view, and with both. The "best place within 5 km" is the cell with the
largest count of both around the selected site.

**Check.** `tests/engine/sweep.test.ts` compares the sweep with an independent
calculation — a ray marched from the place along the body's azimuth over the same 480 m
model — at 160 random places and 8 dates: the two agree for 98.9 % (Sun) and 99.5 %
(Earth) of the 1,280 cases, and for more than 99.3 % of those where the margin exceeds
0.3°. The differences sit on shadow edges, where the two discretisations differ.

## 6. Reproducing everything

```sh
npm ci
npm test                                         # all automated checks
python3 tools/horizons/fetch_fixtures.py         # re-download the Horizons reference tables
npx tsx tools/terrain/build.ts                   # rebuild terrain assets (needs the NASA files, see data/terrain/README.md)
npx tsx tools/validation/illumination.ts 400     # comparison with the NASA illumination maps
```

## 7. What is not modelled

- Lunar eclipses, during which the Earth covers the Sun for up to a few hours.
- The lander itself: its shadow, tilt, the pointing and field of view of panels and
  antennas.
- Slopes, surface roughness, dust, temperatures.
- Radio link budgets, multipath, and the visibility of the Moon from ground stations on
  Earth. "Earth in view" is geometric line of sight to the Earth's centre.
- Terrain north of 80° S (smooth-sphere horizon there), and terrain detail finer than
  the grid in use.
- Events shorter than the sampling step.
