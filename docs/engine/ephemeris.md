# Sampling every ten minutes: the vector table

`engine/src/ephemeris.ts` · tests in `tests/engine/ephemeris.test.ts`

## The problem

The windows of sunlight and of Earth visibility are found from samples of the Sun's and
the Earth's directions through a mission. The exact ephemeris call
(`moonFixedVectors`) costs about 0.06 ms, so a year used to be sampled every three hours.
That is too coarse for the terrain: the skyline is known every 0.25° of azimuth and at
the poles the Sun moves about 0.5° of azimuth per hour, so a ridge can hide the Sun for
an hour between two samples, and an eclipse lasts a few hours.

## The method

The vectors of the Sun and of the Earth relative to the Moon's centre, in the Moon-fixed
frame, do not depend on the landing site and change smoothly with time. They are computed
exactly at evenly spaced knots — once, for all sites — and interpolated between the
knots with a four-point (cubic) Lagrange formula. The projection onto a site's local
horizon is then cheap.

```ts
const table = buildVectorTable(startMs, endMs);                  // exact knots every 2 h
const series = seriesFromTable(site, table, startMs, endMs, 600); // every 10 minutes
```

- `buildVectorTable(fromMs, toMs, knotStepS = 7200)` covers the span with one knot to
  spare on each side, so the four knots used for any instant of the span surround it. At
  the first and last supported dates (2000–2050) the spare knot is taken on the inner side.
- `vectorsAt(table, tMs)` and `sampleFromTable(site, table, tMs)` give one instant.
- `seriesFromTable(site, table, startMs, endMs, stepS)` has the contract of
  `computeSeries`: the same time stamps, both end instants included, the same limits
  (100,000 samples) and the same errors.
- A table is plain data (numbers and two `Float64Array`s): it can be posted to a Web
  Worker as it is.

## Measured accuracy

Direction of the Sun and of the Earth from the table against the exact ephemeris, at
25,000 pseudo-random sites and instants between 2026 and 2035 (both poles, the equator,
mid-latitudes; heights from −2,000 m to 5,000 m):

| Knots every | Largest error, Sun | Largest error, Earth | Range and angular radius (relative) |
|---|---|---|---|
| 30 min | 1.4 × 10⁻⁷ ° | 3.0 × 10⁻⁸ ° | 1.9 × 10⁻¹⁰ |
| 1 h | 1.4 × 10⁻⁷ ° | 3.0 × 10⁻⁸ ° | 2.0 × 10⁻¹⁰ |
| **2 h (default)** | **1.4 × 10⁻⁷ °** | **7.0 × 10⁻⁸ °** | **2.4 × 10⁻⁹** |
| 6 h | 3.8 × 10⁻⁷ ° | 4.8 × 10⁻⁶ ° | 1.9 × 10⁻⁷ |
| 12 h | 5.4 × 10⁻⁶ ° | 7.6 × 10⁻⁵ ° | 3.0 × 10⁻⁶ |

Below two-hour knots the error stops falling: what is left is the numerical noise of the
exact call itself. For scale, this engine and NASA/JPL Horizons differ by up to 0.004°,
and the Sun's disc is 0.53° wide. The test fails if the default exceeds 5 × 10⁻⁶ °.

## Measured speed

On the development machine (Apple silicon, Node 22):

| | Time |
|---|---|
| One exact ephemeris call | 0.057 ms |
| Table for one year, knots every 2 h (4,383 knots), built once for all sites | 177 ms |
| One site, one year, every 10 minutes (52,561 samples) from the table | 11 ms |
| For comparison: one site, one year, every 3 hours (2,921 samples), exact | 120 ms |

So a year at ten minutes costs less than a year at three hours did, and each further site
costs 11 ms.

## What it buys

`tests/engine/ephemeris.test.ts` builds a skyline with a spike three bins (0.75°) wide in
front of the Sun. The exact ephemeris sampled every minute gives the length of the
darkness behind it; a three-hour sampling steps over it and reports no darkness at all;
the ten-minute series from the table finds it, within ten minutes of the reference.

## Limits

- The step that matters is the series step, not the knot spacing. Ten minutes makes
  missed events far rarer than three hours did; it is not a guarantee. An event shorter
  than the series step can still fall between two samples, and the ends of every window
  are placed by straight-line interpolation between two samples.
- A table holds at most 200,000 knots; a series at most 100,000 samples.
