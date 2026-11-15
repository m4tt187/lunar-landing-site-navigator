# Terrain data

The terrain skyline used by the application comes from NASA's Lunar Orbiter Laser
Altimeter (LOLA) on the Lunar Reconnaissance Orbiter.

| | |
|---|---|
| Product | `LDEM_75S_120M` — south-polar elevation model, 120 m per pixel, 75 S to the pole |
| Data set | LRO-L-LOLA-4-GDR-V1.0, product version 2.0, NASA Goddard Space Flight Center (LOLA team) |
| Archive | NASA Planetary Data System, Geosciences Node |
| File | https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_75s_120m.img (116,250,752 bytes) |
| Label | https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_75s_120m.lbl |
| Projection | https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/catalog/dsmap_polar.cat |
| SHA-256 | `ae3afc3c75c33d43666ca06c83ca08f0b12ef03b7d36d2d791d972730794391b` |
| Format | 7624 x 7624 signed 16-bit little-endian integers; height in metres = value x 0.5, relative to a 1737.4 km sphere; polar stereographic, Mean Earth / Polar Axis frame |

The source file is not committed (it is large). To rebuild the derived assets:

```sh
mkdir -p data/raw
curl -L -o data/raw/ldem_75s_120m.img \
  https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_75s_120m.img
npx tsx tools/terrain/build.ts
```

The build checks the checksum and writes, in `web/public/data/`:

- `ldem_75s_480m.i16` — the same model reduced to 480 m by 4 x 4 block mean, used in the
  browser for the map layers and, beyond the 120 m tiles, for skylines at custom coordinates;
- `south-pole-relief.jpg` (PNG where the macOS `sips` tool is not available) — shaded relief,
  1.5 times wider than tall: the square of everything south of 80 S in the middle, and the
  model's terrain out towards 75 S on either side. Rendered by `tools/terrain/build.ts`
  from the elevation model (not a photograph, not AI-generated); `--map-only` renders it
  alone;
- `sites.json` — the curated sites (`data/sites/catalog.json`) with their terrain skylines
  computed at the full 120 m resolution for antenna/panel heights of 2, 10 and 50 m;
- `terrain.json` — metadata for the files above.

## 120 m tiles for sites picked on the map

`npx tsx tools/terrain/tiles.ts` cuts the same source file into tiles of 256 x 256
samples (30.7 km a side) and writes, in `web/public/data/tiles/120m/`, the 431 tiles
needed for every point south of 80 S to have the complete 3 x 3 block around it, plus
`index.json` (grid description, list of tiles, highest point). Each tile holds the
original samples, unchanged: prediction residuals (sample minus left + up - upper-left)
as little-endian 16-bit integers, gzip-compressed; 23.1 MB in all. The output is the same
on every run. `npx tsx tools/terrain/tiles.ts --verify` reads the source again and
checks every sample of every tile (28,246,016 samples) and the index.

`npx tsx tools/validation/tiles.ts` measures what the tiles are worth; the result is in
`docs/validation-tiles.json` and summarised in `docs/engine/tiles.md`.

## NASA illumination maps

Two map products of the LOLA team (method: Mazarico et al. 2011) are used as an independent
reference and as map layers. They give, for every 60 m cell south of 85 S, the share of
time in which any part of the solar disc (or of the Earth's disc) is above the terrain.

| File | Bytes | SHA-256 |
|---|---|---|
| `avgvisib_85s_060m_201608.img` | 51,166,728 | `82dadf321dee28f1947c1fed81858d4cf50fe8eb2aa405aae114e8ab21c1efe1` |
| `avgvisib_85s_060m_201608_earth.img` | 51,166,728 | `0958313069d6039b2474c875ff662f28dbcba2bd853d9ea458aa807b7948c11f` |

Both are downloaded from
https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/extras/illumination/img/
into `data/raw/` (not committed). From them the build writes the two colour layers
(`nasa-average-*.png`), the 240 m one-byte grids (`nasa-average-*-240m.u8`), the long-term
values stored with each site, and the eight best-lit points added to the site list.
`npx tsx tools/validation/illumination.ts` compares this project's own computation with the
two maps at 400 points; the result is in `docs/validation-illumination.json`
(correlation 0.98, mean absolute difference 0.01 for both Sun and Earth).

