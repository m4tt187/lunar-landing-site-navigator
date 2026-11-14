# NASA's 120 m terrain for any point on the map

`engine/src/tiles.ts` · tests in `tests/engine/tiles.test.ts` · `tools/terrain/tiles.ts` ·
`tools/validation/tiles.ts` → `docs/validation-tiles.json`

## The problem

The 25 catalogue sites have skylines computed beforehand from the complete 120 m LOLA
model (116 MB, too large to send to a browser). A point picked on the map had to use the
480 m reduction that ships with the application, and its sunlight could be off by ten
percentage points and more: at the poles, where the Sun grazes the horizon, a ridge a few
hundred metres wide decides the answer, and a 480 m grid smooths it away.

## What is shipped

The 120 m model itself, cut into tiles, so that a picked site loads only the terrain
around it.

| | |
|---|---|
| Source | NASA LOLA `LDEM_75S_120M` (see `data/terrain/README.md`), samples unchanged |
| Tiles | 256 × 256 samples, 30.7 km a side; 431 tiles |
| Coverage | every point south of 80° S has the complete 3 × 3 block of tiles around it, so the 120 m terrain is known at least 30.7 km in every direction |
| Encoding | prediction residuals (sample − (left + up − upper-left)) as little-endian 16-bit integers, gzip; lossless |
| Size | 23.1 MB in all; a picked site downloads nine tiles, about 0.5 MB |
| Check | `npx tsx tools/terrain/tiles.ts --verify`: all 28,246,016 samples identical to the source file |

Two predictors were measured on the real data: the difference from the sample to the left
gives 28.4 MB, the plane predictor 23.1 MB.

## How a picked site uses it

```ts
const store = createTileStore(spec);                      // from tiles/120m/index.json
for (const { tx, ty } of tilesAround(spec, lat, lon))     // the 3 × 3 block
  addTile(store, tx, ty, decodeTile(gunzippedBytes, spec.tile, encoding));
const terrain = compositeField(tileField(store), polarDemField(coarse480m));
const skyline = computeTerrainHorizon(terrain, lat, lon, mastM, { azStepDeg: 0.25, maxDistanceKm: 400 });
```

`tileField` samples the tiles exactly as `demHeightAt` samples the full grid (same pixel
lattice, same bilinear arithmetic: the tests compare them at thousands of points, tile
borders and the pole included) and answers "unknown" outside the loaded tiles.
`compositeField` takes the fine terrain where it is known and the coarse one elsewhere.
The skyline is then one march over the two: 120 m terrain near the site, where a ridge
matters most, and 480 m terrain from there to 400 km.

In the application the tiles are fetched when a point is picked; the result is labelled
"120 m grid for at least 30 km around the site, a 480 m grid beyond". If the tiles cannot
be loaded (no network, a browser without `DecompressionStream`) the 480 m model is used
alone and the result is labelled as an estimate, as before.

## What it is worth

`npx tsx tools/validation/tiles.ts` compares three skylines at 2 m above the ground:
from the complete 120 m grid (the reference), from tiles + 480 m (what a picked site now
gets), and from the 480 m model alone (what it got before). Then it computes the answers
the application gives — the share of 2027 with sunlight and with the Earth in view —
with each.

**100 pseudo-random points over everything south of 80° S** (the fair sample of where
people click):

| | Tiles + 480 m | 480 m alone |
|---|---|---|
| Skyline: mean / 95th percentile / largest difference | 0.001° / 0.010° / 0.085° | 0.35° / 1.74° / 5.91° |
| Sunlight share of the year: mean / largest difference | 0.006 / 0.11 points | 1.4 / 17.5 points |
| Earth-in-view share: mean / largest difference | 0.009 / 0.12 points | 0.7 / 15.3 points |

**The 25 catalogue sites** (peaks and crater centres, where terrain matters most):

| | Tiles + 480 m | 480 m alone |
|---|---|---|
| Skyline: mean / 95th percentile / largest difference | 0.001° / 0.007° / 0.051° | 0.34° / 1.56° / 3.66° |
| Sunlight share of the year: mean / largest difference | 0.009 / 0.06 points | 2.5 / 15.5 points |
| Earth-in-view share: mean / largest difference | 0.008 / 0.11 points | 2.3 / 21.0 points |

(Differences in percentage points of the year; for the catalogue sites the "480 m alone"
column is measured against the stored catalogue skylines, which are rounded to 0.01°.)

A picked site is now within about a tenth of a percentage point of what the complete
model gives, where it used to be off by up to 17. The label "coarse estimate" no longer
applies to it.

Timing (Node, development machine; not a browser guarantee): decoding nine tiles 8 ms;
one composite skyline 150 ms (480 m alone: 63 ms).

## Limits

- North of 80° S there are no tiles (and the application has no terrain there).
- Beyond the loaded block — at least 30.7 km, at most 61 km from the site — the
  terrain is the 480 m model. A far summit that only the 120 m grid resolves can differ
  by a few hundredths of a degree (the 0.085° above).
- The map layers (whole-map sweep) still use the 480 m model.

## Rebuild

```sh
npx tsx tools/terrain/tiles.ts            # writes the tiles and index.json (needs data/raw)
npx tsx tools/terrain/tiles.ts --verify   # every sample against the source
npx tsx tools/validation/tiles.ts         # docs/validation-tiles.json
```
