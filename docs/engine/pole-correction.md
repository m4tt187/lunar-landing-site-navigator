<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- AI-assisted: written with OpenAI Codex under the direction of the team. -->
# Exact-pole terrain correction

The previous scalar forward-geodesic formula lost precision at latitude -90
degrees. Its longitude denominator cancelled to zero and several distinct ray
azimuths sampled the same terrain direction. This affected valid custom sites at
the exact lunar south pole.

The corrected calculation forms the local north/east tangent direction in lunar
Cartesian coordinates, rotates it through the ray's great-circle distance, and
uses `atan2` to recover latitude and longitude. Its azimuth convention matches
`projectBody`: north is defined by the site's supplied longitude, including at
the pole. Changing longitude at the pole relabels directions without changing
the physical skyline.

Tests cover an asymmetric synthetic landscape at the exact pole, displacement
by one millionth of a degree, longitude relabelling including +/-180 degrees,
off-pole agreement, and the analytic horizon dip of a smooth sphere. Separate
input guards reject latitudes outside [-90, 90]; -90 minus an epsilon is not a
second physical side of the south pole.

Before integration, all 25 existing catalogue skylines were recalculated with
the full 120 m DEM, 2 m observer height and 720 azimuth bins. Their largest
absolute difference from the shipped, rounded profiles was 0.004999714 degrees,
within the existing 0.01-degree output rounding. This is a compatibility check
at those sites, not a terrain-accuracy bound or a validation of the 480 m model.
