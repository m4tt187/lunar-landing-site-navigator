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

`HorizonOptions.originHeightM` fixes the observer's absolute eye height above the
reference sphere. When supplied it replaces `groundHeightM + observerHeightM`;
the returned `groundHeightM` still describes this field's actual ground. This
lets near rays over fine terrain and far rays over coarse terrain share one
observer position even when interpolation gives different heights at the site.
The absolute height must be finite and above the lunar centre. It can be zero,
negative, or below the coarse model's local ground. The usual mast argument
still must be in [0, 20000], and unknown observer ground remains an error.

An analytic regression combines near and far skylines with a distant wide
ridge and deliberately inconsistent fine/coarse origin heights. The maximum
matches a single march over the same physical terrain within 1e-6 degrees.
This checks observer geometry, not general equivalence of different ray
sampling grids: `firstStepM` sets both the first sampled distance
and the minimum subsequent increment. Setting it to 30000 samples at 30 km
intervals and can miss narrow mountains; it is not a safe way to skip nearby
terrain while retaining the coarse DEM's spatial resolution.

Use `minDistanceM` to skip the near region while keeping the ray's normal
sampling lattice. For example, the far coarse call can use
`{ minDistanceM: 30000, originHeightM: fineGroundHeightM + mastHeightM }`.
The engine advances its existing distance recurrence without reading terrain
until that minimum is reached; it does not reset the sampling phase at the
boundary. The mandatory ground lookup is still performed. The minimum must be
finite, nonnegative and no greater than the maximum distance. A range that
contains no eligible sample throws instead of returning an empty skyline.

Regressions include a narrow ridge at 45 km missed by a 30 km increment, and
exact near/far agreement of both skyline angles and winning distances over
an asymmetric terrain field. Exact partition equivalence requires the **same
explicit `firstStepM`** in both calls, as well as the same eye height, terrain,
and azimuth grid. Different default resolutions intentionally produce different
sampling lattices and do not carry that exact-equality guarantee. The preflight
work budget remains conservatively based on the full ray distance.

The direct `PolarDem` call retains its existing grid lookup inside the ray loop;
it does not use a callback adapter. In one local warmed benchmark (720 rays over
the same synthetic grid), median time was 3.78 ms before and 3.99 ms after the
change. These are local measurements, not a browser performance guarantee.

Tests compare direct and adapted profiles to 1e-6 degrees at the pole, near the
longitude seam, and off-pole. Additional cases cover a global smooth sphere in
both hemispheres, a fine/coarse composition, unknown coverage, invalid provider
metadata/values and propagated provider errors. The adapter enables integration;
it does not itself ship high-resolution tiles or validate their accuracy.
