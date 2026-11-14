<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- AI-assisted: written with OpenAI Codex under the direction of the team. -->
# Composable terrain fields

`computeTerrainHorizon` accepts the existing `PolarDem` or a `HeightField`:

```ts
interface HeightField {
  heightAt(latDeg: number, lonDeg: number): number;
  maxHeightM: number;
  resolutionM: number;
}
```

Coordinates use lunar latitude and east-positive longitude in degrees. Heights
are metres above the 1737.4 km sphere, matching the site geometry and existing
LOLA data. `heightAt` returns NaN for unknown coverage. Provider failures and
infinite/physically invalid values propagate as errors, without invented heights.

`maxHeightM` must be a conservative upper bound over the complete field. The ray
marcher uses it to prove that more distant terrain cannot raise the skyline.
The engine checks sampled heights against that bound with a small roundoff
tolerance; it cannot verify unseen provider data. An incorrect bound can hide
unvisited mountains. `resolutionM` is the finest pixel size and sets the default
first step to half that distance. Existing work limits still apply.

`polarDemField(dem)` adapts a polar DEM. Callers can compose it with higher
resolution tiles or a global grid:

```ts
const coarse = polarDemField(coarseDem);
const field: HeightField = {
  resolutionM: 120,
  maxHeightM: Math.max(coarse.maxHeightM, fineTileMaximumM),
  heightAt(latDeg, lonDeg) {
    const fine = fineTileHeightAt(latDeg, lonDeg);
    return Number.isNaN(fine) ? coarse.heightAt(latDeg, lonDeg) : fine;
  },
};
const skyline = computeTerrainHorizon(field, latitude, longitude, mastHeightM);
```

The provider owns tile loading, common datum/frame, interpolation and coverage.
It must be synchronous when called by the engine. Unknown observer ground height
is an error; unknown height along a ray sets `truncated`. A composite should use
its coarse fallback before returning NaN.

The direct `PolarDem` call retains its existing grid lookup inside the ray loop;
it does not use a callback adapter. In one local warmed benchmark (720 rays over
the same synthetic grid), median time was 3.78 ms before and 3.99 ms after the
change. These are local measurements, not a browser performance guarantee.

Tests compare direct and adapted profiles to 1e-6 degrees at the pole, near the
longitude seam, and off-pole. Additional cases cover a global smooth sphere in
both hemispheres, a fine/coarse composition, unknown coverage, invalid provider
metadata/values and propagated provider errors. The adapter enables integration;
it does not itself ship high-resolution tiles or validate their accuracy.
