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
  browser for skylines at custom coordinates;
- `south-pole-relief.png` — shaded relief of everything south of 80 S, rendered by
  `tools/terrain/build.ts` from the elevation model (not a photograph, not AI-generated);
- `sites.json` — the curated sites (`data/sites/catalog.json`) with their terrain skylines
  computed at the full 120 m resolution for antenna/panel heights of 2, 10 and 50 m;
- `terrain.json` — metadata for the files above.
