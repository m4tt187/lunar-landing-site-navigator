# Eclipses: the Earth in front of the Sun

`engine/src/eclipse.ts` · tests in `tests/engine/eclipse.test.ts` · NASA reference data in
`data/eclipses/nasa-lunar-eclipses.json` · `tools/eclipses/list.ts`

What observers on the Earth call a lunar eclipse is, for a lander on the Moon, an eclipse
of the Sun by the Earth: sunlight fades for hours and, when the eclipse is total, stops.
The engine takes this into account in every answer about sunlight.

## What is modelled

Two discs in the lander's sky: the Sun, and the Earth's **opaque disc**. Their directions
and sizes come from the same ephemeris as everything else (validated against NASA/JPL
Horizons); the rest is plane geometry.

| Quantity | Value | Source |
|---|---|---|
| Opaque layer of air added to the solid Earth | 75 km | A. Danjon's value, used in NASA's *Five Millennium Canon of Lunar Eclipses*: "Danjon estimates the thickness of the occulting layer to be 75 km and this results in an enlargement of Earth's radius and the Moon's parallax of about 1/85" — https://eclipse.gsfc.nasa.gov/LEcat5/shadow.html |
| The flattened Earth replaced by a circle | 0.998340 × the equatorial radius (the mean radius at latitude 45°) | same page: "The Astronomical Almanac uses a factor of 0.998340 to scale the Moon's equatorial horizontal parallax to account for this" |

Together the Earth's disc is 1.0101 times the one an equatorial-radius sphere would show;
NASA writes the same factor as "1.01 ≅ 1 + 1/85 − 1/594". Both constants were taken from
that page before any comparison was run; nothing was tuned.

- `sunFractionCoveredByEarth` — the share of the solar disc inside the Earth's disc
  (two-circle lens, exact).
- `sunDiskFractionVisibleWithEarth` — the share of the solar disc that is above a
  straight skyline **and** outside the Earth's disc. Where both cut the disc it is
  integrated numerically; against an independent integration the largest difference in
  2,000 cases is 4 × 10⁻⁷ of the disc.
- `findEclipses(site, from, to)` — every eclipse seen from a site between two dates,
  contacts to the second; `sunCoverAt(site, t)` — one instant.
- `eclipsesInSeries(series)` — the eclipses inside a sampled mission, from the samples
  alone (accuracy below). `summarize()` returns them as `Summary.eclipses`.
- `sunHiddenByEarth(site, t, rule)` — whether the Earth alone keeps the Sun from counting
  as up at a site, under one of the rules.
- `eclipseOverArea`, `hideEclipsedPlaces`, `skylineLimitInEclipse` — the same questions
  for many places at once: what the map layers use (see "On the map" below).

## How it enters the answers

The sunlight margin of every sample (`Margins.sunDeg`) now asks for the required fraction
of the solar disc to be above the skyline *and* uncovered by the Earth; the visible
fraction (`Margins.sunDiskFraction`) excludes what the Earth covers; and
`Margins.eclipseFraction` says how much the Earth covers. Windows of sunlight, the longest
night, the operating window and the landing recommendations follow without further change.

The skyline and the Earth are not judged one at a time. Near the poles the Sun is often
half-hidden by a ridge; the Earth can then cover exactly the part left showing. Each
obstruction alone leaves "some of the Sun" visible; together they leave nothing. The
"any part shows" and "whole disc shows" rules are exact for a straight skyline; for a
fraction in between the sign is exact and the size of the margin, which only places a
crossing between two samples, is an estimate.

### How exact the sampled eclipses are

The mission analysis works on samples ten minutes apart and places every crossing on a
straight line between two samples. For eclipses this was measured against the exact
search: 73 eclipses seen from six places (both poles, three points of the equator, Mare
Crisium), 2025–2030. None was missed and none was mislabelled total or partial.

| Contact | Median difference | 95 % within | Largest |
|---|---|---|---|
| First and last contact | 0.5 s | 6 s | 24 s |
| Start and end of totality | 1.8 s | 20 s | 126 s |

The largest belongs to the briefest totality of the set: 12.7 minutes at latitude 0°,
longitude 0° on 15 June 2030, reported 3.7 minutes shorter than it is. Where totality is
that brief the separation of the two discs is far from a straight line in time, and the
sunlight windows of the mission analysis carry the same error. `findEclipses` has none of
it.

## On the map

The map layers come from the whole-map sweep ([methodology](../methodology.md), section
5), which tests one direction of the Sun against the terrain for every cell at once.
During an eclipse two things are added.

The measurements of this section that are not automated tests are reproduced by
`npx tsx tools/validation/map-eclipses.ts`; its output is kept in
[`validation-map-eclipses.json`](../validation-map-eclipses.json).

**The Earth alone, cell by cell.** The same contact does not fall at the same instant
everywhere. Over the 27 eclipses of 2025–2039, at places on the 85° S and 80° S circles,
first contact falls up to 7.9 minutes, last contact up to 6.9 minutes and the ends of
totality up to 8.4 minutes from their instants at the pole. So every cell is tested
against the Earth's disc as seen from that cell (`hideEclipsedPlaces`). A quick test for
the whole area (`eclipseOverArea`) says when no cell, or every cell, can be affected; the
cell-by-cell pass (about 7 ms for the 1.6 million cells of the map's square window, 1.26
million of them south of 80° S, on the development
machine) runs only in between.

| Check | Result |
|---|---|
| Against each place's own sky: 300 places south of 80° S, four eclipses, every 2.5 minutes, the three rules | 393,300 comparisons, no difference |
| Start and end of totality at 60 of those places against the exact search (`findEclipses`, itself exact to half a second) | within 0.6 s |
| In a browser, total eclipse of 26 June 2029, at the minute the pole crosses each rule's limit: sampled cells that had the Sun a quarter of an hour earlier | of 8,014 / 7,630 / 7,326 cells ("any part" / "half" / "whole disc"), the 4,005 / 3,693 / 3,470 that the per-site computation says the Earth hides are all dark on the map; no cell is lit where the Earth hides the Sun |

**The Earth and the terrain together.** While the Earth covers part of the Sun, testing
the top of the disc ("any part shows") or its centre ("half") against the terrain is no
longer right: the part still uncovered may be the lower one, behind the skyline. Each
obstruction alone would leave some Sun; together they leave none. The direction tested
therefore becomes the highest skyline under which enough of the uncovered disc still
shows (`skylineLimitInEclipse`):

- "any part shows": the highest point the Earth leaves uncovered — the top of the disc
  if the Earth does not reach it, otherwise the higher of the two points where the limbs
  cross (exact);
- a fraction in between: the level at which the visible fraction equals the required one;
- "the whole disc shows": the bottom of the disc, as without the Earth; the Earth must
  simply not touch the Sun, which the cell-by-cell test decides.

Against an independent strip integration, for 1,500 positions of the Earth and five
rules, the fraction showing at the level found differs from the required one by less
than 2 × 10⁻⁵. Seen from the south pole, 2025–2030, the level drops by up to 0.52° below
the top of the disc (12 January 2028, when the Earth passes above the Sun).

The level is computed once per instant, as seen from the pole, and used for the whole
map. Measured against the level each place would compute from its own sky (300 places
south of 80° S, the eleven eclipses of 2025–2030, every two minutes): the difference is
below 0.04° for 95 % of place-and-instant pairs and below 0.08° for 99 %; the largest,
0.21°, falls in the minutes around a contact, when the pole has already lost the Sun and
a place at the edge of the map has not. It is one more approximation of the map, on top
of the sweep's own; the comparison below measures what the two cost together.

**Checked against each place's own answer.** `web/src/map/visibility.test.ts` runs the
map's computation (`web/src/map/visibility.ts`, the code the background workers run) and
compares it with what each place answers on its own — its own sky, a skyline marched
over the same 480 m model along the Sun's azimuth, and the part of the disc above that
skyline and outside the Earth — at 2,500 random cells while the Earth covers part of the
Sun on 12 January 2028:

| Rule, instant (UTC) | Same answer | Cells dark only because the two act together | Of these, dark on the map |
|---|---|---|---|
| any part shows, 03:30 | 99.1 % | 45 | 38 |
| half the disc shows, 02:50 | 99.0 % | 19 | 14 |

Tested one obstruction at a time, all of those cells would be lit. The same file holds a
real case found on the shipped terrain in the independent review (81.107° S, 92.189° W,
12 January 2028 03:12:37 UTC: the terrain leaves 20 % of the Sun, the Earth 22 %, the two
together nothing; the map shows it dark) and two constructed cases on a smooth sphere.
`web/src/map/worker-eclipse-regression.test.ts`, written in the independent review, sends
the same cases through the background worker's own message handler. In a browser, on the
built application, 3,000 random cells per rule against the engine's complete per-site
computation (`computeTerrainHorizon` and `sampleMargins`) agreed at 99.3 % and 99.1 %.

## Checked against NASA's predictions

NASA's Goddard Space Flight Center publishes, for every lunar eclipse, the instants at
which the Moon's limb touches the Earth's penumbra (P1, P4) and umbra (U1, U4) and at which
the whole Moon is inside the umbra (U2, U3). Seen from the Moon, a point is in the penumbra
while the Earth covers part of the Sun and in the umbra while it covers all of it. The test
therefore asks this module, at 360 points of the Moon's limb, when the first point starts
to lose the Sun (P1), when the first one loses it entirely (U1), when the last one does
(U2), and the reverse.

All fourteen lunar eclipses from 2025 to 2030 (six total, four partial, four penumbral):

| | Result |
|---|---|
| 58 contact times of 13 eclipses | largest difference **8.3 s**, root mean square 3.5 s |
| The 2 contacts of 18 July 2027 | 43 s and 52 s. That eclipse dips 0.14 % of the Moon's diameter into the penumbra for 11.8 minutes; at so grazing a contact one second of time is a hundredth of an arcsecond of depth, and the difference is 0.7″ |
| Instant of greatest eclipse, all 14 | within 5 s |
| Difference between Dynamical and Universal Time (ΔT) used by NASA and by this engine | within 1 s |

NASA's values — Eclipse Predictions by Fred Espenak and Jean Meeus (NASA's GSFC) —
are transcribed unmodified in `data/eclipses/nasa-lunar-eclipses.json`, each with the
address of its figure. The contact times are printed on those figures, which are
images; the transcription was checked against the phase durations of the catalogue page
(P4 − P1, U4 − U1 and U3 − U2 agree to the 0.1 minute printed there).

## Checked against a lander that watched one

Firefly Aerospace's Blue Ghost Mission 1, a NASA CLPS delivery, was operating in Mare
Crisium on 14 March 2025 and photographed the eclipse. The mission's own updates
(https://fireflyspace.com/news/blue-ghost-mission-1-live-updates/) give, the day before,
the prediction for its landing site: an eclipse of nearly five hours, from 12:00 am to
4:52 am local time, with about 2 hours 16 minutes of totality starting at 1:18 am.

| At the lander's coordinates | Firefly | This engine | Difference |
|---|---|---|---|
| Earth starts to cover the Sun | 05:00 UTC | 04:59:28 | −0.5 min |
| Totality starts | 06:18 UTC | 06:15:57 | −2.1 min |
| Totality lasts | about 2 h 16 min | 2 h 20 min | +4 min |
| Earth leaves the Sun | 09:52 UTC | 09:52:26 | +0.4 min |

The photographs fit as well. The updates date three of them: at about 12:30 am, as the
Earth began to cover the Sun (engine: partly covered at 05:30 UTC); at about 2:30 am,
during totality (total at 07:30); and at about 3:30 am, with the Sun about to come out
(total at 08:30, ending 08:35:52).

Two notes. The prediction gives its times as CST and the reports as CDT; daylight time was in force in
Texas on that date, and read as UTC−6 the predicted end would fall after NASA's last
contact for the whole Moon, so all times are taken as UTC−5. And the start of totality is
where the atmosphere matters most: how deep into the Earth's air the last sunlight is
counted as lost shifts that instant by a few minutes; the first and last contacts, which
do not depend on it much, agree to half a minute.

## At the south pole, 2025–2030

`npx tsx tools/eclipses/list.ts` (latitude −90°, terrain not considered, UTC):

| Date | NASA lunar eclipse | Some of the Sun covered | Most covered | Whole Sun covered |
|---|---|---|---|---|
| 2025-03-14 | total | 04:21–09:28 (5 h 07 min) | 100% | 05:30–08:18 (2 h 48 min) |
| 2025-09-07 | total | 16:11–20:19 (4 h 08 min) | 100% | 17:21–19:09 (1 h 49 min) |
| 2026-03-03 | total | 09:25–13:34 (4 h 10 min) | 100% | 10:51–12:07 (1 h 16 min) |
| 2026-08-28 | partial | 01:51–06:41 (4 h 50 min) | 100% | 02:57–05:35 (2 h 38 min) |
| 2027-08-17 | penumbral | 05:39–08:55 (3 h 16 min) | 48% | no |
| 2028-01-12 | partial | 02:18–06:00 (3 h 42 min) | 100% | 03:46–04:32 (0 h 47 min) |
| 2028-07-06 | partial | 16:58–19:48 (2 h 51 min) | 37% | no |
| 2028-12-31 | total | 14:26–19:09 (4 h 44 min) | 100% | 15:27–18:08 (2 h 41 min) |
| 2029-06-26 | total | 01:10–05:41 (4 h 31 min) | 100% | 02:10–04:41 (2 h 31 min) |
| 2029-12-20 | total | 20:25–00:50 (4 h 25 min) | 100% | 22:02–23:13 (1 h 10 min) |
| 2030-06-15 | partial | 16:35–20:38 (4 h 03 min) | 100% | 17:36–19:36 (2 h 00 min) |

Not seen from the south pole: 20 February 2027 and 9 December 2030 (penumbral, on the
Moon's northern side) and 18 July 2027.

The name of an eclipse describes the Moon as a whole, not a place on it. Three eclipses
that are only "partial" for the Moon are total at the south pole, because the part of the
Moon inside the umbra is its southern one; a lander there that cannot bridge three hours
of darkness has to know.

## What is not modelled

- **Light through the atmosphere.** During totality the Moon is reddish, not black: a
  little sunlight is bent into the shadow by the Earth's air. It is thousands of times
  weaker than direct sunlight and is counted as none.
- **The exact shape of the edge.** The opaque disc is a circle with a sharp edge. The
  true dimming near the edge is gradual and varies a little from one eclipse to another
  (NASA's page discusses values from 1/85 to 1/41 for the enlargement of the shadow).
- **Terrain inside this module.** `findEclipses` ignores the skyline; the mission
  analysis combines the two, with the skyline taken as straight across the solar disc.
- **One level for the whole map.** On the map the part of the Sun that the Earth leaves
  is taken as seen from the pole (differences above); the numbers of a site use the
  site's own sky.
- **Sampling.** In a mission analysis an eclipse shorter than the sampling step
  (ten minutes in the application) can be missed, like any other short event.
  `findEclipses` cannot miss an eclipse that covers more than 1 % of the Sun: it steps by
  the time the two discs need to close the gap between them at the fastest rate that
  occurs (0.75° per hour assumed; 0.598° per hour is the largest found from 2000 to 2050).
