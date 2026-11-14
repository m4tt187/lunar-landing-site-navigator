# Planning: how long, when, and where

`engine/src/planning.ts` · tests in `tests/engine/planning.test.ts` · command-line tool
`tools/planning/recommend.ts`

The rest of the engine answers "what does the sky look like from here, on this day?".
This module turns the windows of sunlight and of Earth visibility into the three
questions a planner actually asks.

| Question | Function |
|---|---|
| If we land here, now, how long can the mission run? | `operatingWindow` |
| What would each possible landing date give at this site? | `landingCalendar` |
| Which site and which date are best for my mission? | `recommend` |
| Where are the best places of a whole-map layer? | `topCells` |

All of them work on **intervals** — the windows that `summarize()` returns — not on
samples, and none calls the ephemeris. So the answers do not depend on how the windows
were sampled, and they are fast: a year of hourly landing dates for 25 sites takes well
under a second, most of it spent computing the windows.

## Definitions

**Tolerance.** The longest darkness the lander survives on its own energy, in hours.
Zero means the first sunset ends the mission.

**Stretch of power.** Sunlight windows separated by a darkness no longer than the
tolerance form one stretch. A landing in the dark counts if sunrise comes within the
tolerance.

**Operating window** (`operatingWindow`). From touchdown to the end of the last sunlight
before the first darkness longer than the tolerance. If the data end first, the window is
*open-ended*: it lasts at least that long.

**Mission needs** (`MissionNeeds`). The days of surface operations wanted, the
tolerance, and whether the Earth must be in view at touchdown for a direct link during
the landing (it must, unless told otherwise).

**A landing option** (`LandingOption`). For one landing time: the hours of power that
follow; the *mission coverage*, min(1, power ÷ mission length); and, over the operated
part of the mission — from landing to landing + min(mission, power) — the share of
time with the Earth in view, the share with sunlight and the Earth together, and the
longest stretch without the Earth.

## How a landing is chosen

Inside one stretch of power, among the landing times examined (one per hour by default):

1. the one that powers the **whole mission** (or the largest part of it);
2. then the one with the Earth in view for the **largest share** of the mission;
3. then the one with the most power left;
4. then the earliest.

The order is the planner's: without power for the whole mission nothing else matters;
among the dates that give it, the best is the one with the most contact with the Earth.
A later landing in the same stretch can therefore win over the first possible one, when
it lines the mission up with a fortnight of Earth visibility and still has the power.

`landingCalendar` returns, besides the per-date arrays for drawing, the best landing of
each stretch, best first. `recommend` does this for several sites and merges the results
with the same order (at most one landing per site unless asked for more).

## Checked against

- **A minute-by-minute simulation** of a lander that is lost when the darkness it is in
  has lasted longer than its tolerance: 300 random cases for `operatingWindow`, 400 for
  the calendar (same answer, including landings in the dark, touching windows and the end
  of the data).
- **The exact ephemeris.** The first row of the first table below was recomputed without
  the interpolated table. At Sunlit peak 8 the Sun stays above the skyline from the
  landing until 12 January 2028 03:45:46 UTC, when the Earth covers it completely for 46
  minutes (the eclipse of that date, total at this site from 03:45:46 to 04:32:04): 149
  days and 22 hours after a landing on 15 August at 06:00, as the tool says. The Earth is
  in view there from 15 August 05:39 to 30 August 17:04, which covers the 14-day mission.

## What it finds (2027)

`npx tsx tools/planning/recommend.ts --count 6` — 14-day mission, a lander that
survives no darkness, panels 2 m above the ground, landings on any day of 2027, the 25
catalogue sites that have a real skyline:

| Rank | Site | Landing (UTC) | Power lasts | Earth in view | Longest link gap |
|---|---|---|---|---|---|
| 1 | Sunlit peak 8 (near de Gerlache) | 2027-08-15 06:00 | 149 d 22 h | 100% | none |
| 2 | Sunlit peak 3 (near Mons Mouton) | 2027-08-15 09:00 | 149 d 19 h | 100% | none |
| 3 | Sunlit peak 1 (near Spudis) | 2027-08-15 23:00 | 149 d 5 h | 100% | none |
| 4 | Sunlit peak 5 (near Slater) | 2027-09-11 18:00 | 122 d 10 h | 100% | none |
| 5 | Sunlit peak 7 (near Mons Malapert) | 2027-09-09 09:00 | 115 d 17 h | 100% | none |
| 6 | Sunlit peak 2 (near Marvin) | 2027-09-11 16:00 | 82 d 20 h | 100% | none |

`--mission-days 90 --tolerance-h 24 --count 4` — a 90-day mission and a lander that
survives a day of darkness:

| Rank | Site | Landing (UTC) | Power lasts | Earth in view | Longest link gap |
|---|---|---|---|---|---|
| 1 | Sunlit peak 7 (near Mons Malapert) | 2027-09-09 09:00 | 115 d 17 h | 75% | 7 d 17 h |
| 2 | Sunlit peak 8 (near de Gerlache) | 2027-09-11 11:00 | 140 d 3 h | 61% | 11 d 15 h |
| 3 | Sunlit peak 3 (near Mons Mouton) | 2027-09-11 13:00 | 158 d 3 h | 61% | 11 d 19 h |
| 4 | Sunlit peak 2 (near Marvin) | 2027-09-11 16:00 | 112 d 0 h | 60% | 11 d 23 h |

Three things are worth noticing.

- **The date is chosen, not just the place.** For the short mission every proposed
  landing puts the whole fortnight inside an Earth-visibility window.
- **An eclipse ends the longest stretches.** The first three rows of the first table all
  end on 12 January 2028: these peaks are still in sunlight then, but the Earth covers the
  Sun for about three quarters of an hour and this lander survives no darkness. With an
  hour of tolerance (`--tolerance-h 1`) the same landings last 167, 161 and 187 days, and
  Sunlit peak 1 comes first.
- **For a long mission the best-lit place is not the best place.** With 90 days wanted,
  the ridge near Mons Malapert comes first: it has less sunlight than the peaks nearer
  the pole, but it sees the Earth for more of each month.

## Limits

- **Line of sight only.** "Earth in view" is geometry, not a link budget; "power" is
  sunlight on the panel, not an energy budget beyond the single tolerance figure.
- **Landing safety is not considered**: slopes, rocks and landing ellipses are outside
  this tool.
- **The horizon of the data.** A power window that reaches the end of the analysed span
  is marked open-ended. The tool analyses 120 days past the last landing date examined.
- **The grid.** Landing times are examined every hour; windows themselves are exact to
  the sampling of the series they come from (ten minutes in the application).
- **Candidates.** Only sites with a real skyline are ranked. A whole-map ranking
  (`topCells` on a map layer) uses the 480 m model and names places, not dates.

## How the application should call it

One vector table for the whole span (search days + look-ahead), one ten-minute series per
site from it, `summarize()` for the windows, then `recommend()`. See
`tools/planning/recommend.ts` for the complete sequence in thirty lines.
