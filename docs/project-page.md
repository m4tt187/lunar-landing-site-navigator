# Project page

The text of the team's Project page for the 2026 NASA Space Apps Challenge, field by
field as the official Project Submission Guide names them. It is kept here, next to the
sources, so that the page and the repository say the same things. Every number below is
taken from the [README](../README.md) and the [methodology](methodology.md), where the
command that reproduces it is given.

## Project Name

Lunar Landing Site Navigator

## High-Level Project Summary

At the Moon's south pole the Sun and the Earth never climb more than a few degrees above
the horizon, so a single ridge decides whether a lander has power and a radio link.
Choosing a landing site means asking, place after place and date after date: if we land
here, on this day, will we have power, and can we talk to Earth?

Lunar Landing Site Navigator answers it in seconds. It places
the Sun and the Earth against the real skyline of each site, computed from NASA's LOLA
elevation model, and compares up to four sites and landing dates side by side: sunlight,
longest night, windows of contact with the Earth, longest link gap, eclipses included. A
live map shows where sunlight and the Earth are in view at any moment; a calendar shows
what every landing day of the coming year would give; and for a mission described in a
few words it ranks the best sites and landing dates.

It runs entirely in the browser, on public NASA data, and its results are checked against
NASA's own: JPL Horizons, the LOLA illumination maps, NASA's eclipse predictions and real
landings.

Try it: https://m4tt187.github.io/lunar-landing-site-navigator/

## Link to Project Demo

https://m4tt187.github.io/lunar-landing-site-navigator/demo.pdf

Seven slides, the most the Project Submission Guide allows. The source is `docs/demo/deck.html`; the images are screenshots of the
application.

## Link to Final Project

https://github.com/m4tt187/lunar-landing-site-navigator

## Detailed Project Description

### What it does

- **Compares up to four scenarios side by side.** A scenario is a site, a landing date
  and the height of the solar panels or antenna above the ground. A table marks the
  better value for sunlight, longest night, Earth visibility, longest link gap, and power
  and link together.
- **Shows the sky the lander would see.** The real skyline all around the site, the paths
  of the Sun and the Earth over the mission, true-scale close-ups of the solar disc and
  of the Earth against the ridge line, and the time left to the next sunset, sunrise,
  Earthset or Earthrise.
- **Moves through time.** One slider, or Play, moves every scenario through its mission.
- **A map that answers "where?".** For everything south of 80° S: where the Sun and the
  Earth are in view at this moment, with shadows that move as time plays, and the share
  of the mission with sunlight, with the Earth in view, and with both. It names the best
  place for power and link within 5 km of the selected site, and can be zoomed and
  dragged.
- **A calendar that answers "when?".** For every landing day of the coming year: how long
  sunlight, the Earth link, or both would last unbroken after touchdown, with the best
  landing days marked.
- **A recommendation that answers "which?".** Describe the mission (so many days of
  operations, a lander that survives so many hours of darkness, the Earth in view at
  touchdown or not) and get the best sites and landing dates of a year, ranked by power
  for the whole mission first and by contact with the Earth second. One click puts an
  answer into the comparison.
- **Sites to start from.** Apollo and robotic landing sites with cited coordinates, named
  south-pole features, the eight best-lit points of NASA's long-term illumination map, or
  any point typed or clicked on the map.
- **Eclipses included.** When the Earth passes in front of the Sun, the sunlight is
  counted as lost, in the numbers and on the map.
- **Rules you can change.** What counts as "Sun up" (any part of the disc, half, or all of
  it) and as "Earth in view" (its centre on the skyline, or 2° or 5° above it).
- **Ready-made comparisons** for a first look, a **link** that reproduces any
  comparison exactly, and a light and a dark theme.

Plain-language sentences accompany the numbers, so the same screen serves a planner who
wants degrees and hours and a student who wants to know why the pole is hard.

### How it works

Everything is computed in the browser; there is no server.

1. **Where the Sun and the Earth are.** Their positions relative to the Moon come from
   the open-source Astronomy Engine, with the IAU model of the Moon's rotation. They are
   computed exactly every two hours and interpolated in between, so that every mission is
   sampled every ten minutes.
2. **What the terrain hides.** From the site, rays are marched over NASA's LOLA elevation
   model in every direction, every 0.25°, out to 400 km on the curved Moon. The highest
   elevation angle found along each ray is the skyline. The 120 m model is used for the
   marked sites and around any point clicked on the map.
3. **What the Earth hides.** The Earth's disc, enlarged by 75 km of opaque air as in
   NASA's eclipse predictions, is tested against the Sun's.
4. **What it means.** The Sun counts as up when the chosen fraction of its disc is above
   the skyline and not covered by the Earth; the Earth when it clears the skyline by the
   chosen margin. From the samples come the shares of time, the windows, the longest night
   and the longest link gap.
5. **The whole map at once.** The terrain is resampled along the direction of the light,
   and one running maximum per row tells all 1.26 million places south of 80° S at once
   whether they see it. One moment takes about a tenth of a second, so the map is computed
   live, in background workers.

### How far it can be trusted

| Check | Result |
|---|---|
| Sun and Earth directions against NASA/JPL Horizons, 9,810 reference values | largest difference 0.004° (the Sun's disc is 0.53° wide) |
| Earth elevation at two real landings against a JPL report | IM-1: 15.4° on the landing day (JPL: 15°); Chandrayaan-3: 13.0° above the horizontal (JPL: about 11° above the local terrain) |
| Share of time with sunlight and with the Earth in view against the NASA LOLA-team illumination maps, 400 places over 18.6 years | correlation 0.98 for both |
| Eclipses against NASA's predictions for the 14 lunar eclipses of 2025–2030 | 58 contact times of 13 eclipses within 8.3 s; the two contacts of the eclipse that only grazes the Moon (18 July 2027) within 52 s |
| The eclipse of 14 March 2025 at the Blue Ghost Mission 1 landing site against the mission's own prediction | first and last contact within half a minute |
| Automated tests | 317 |

Every figure can be reproduced with a command given in the repository. The limits are
stated there too: this is geometry (line of sight to the Sun and the Earth), not a power
or radio-link budget; terrain is modelled south of 80° S; it is a planning aid, not a
flight product.

### Benefits

- **Mission planners** can shortlist sites and dates in seconds instead of assembling the
  answer from specialist tools, with numbers traceable to NASA sources and a link that
  lets a colleague see exactly the same comparison.
- **Educators** can show why the south pole is hard: the Sun circling the horizon, a
  ridge hiding it for days, the Earth hanging low over one side of the sky.
- **Anyone curious** can pick a place on the Moon and see what a lander would see.

### What we hope to achieve

A tool that a planner opens in a browser before the detailed analysis begins, and that a
teacher can project in a classroom. Next: the north pole, and energy and radio-link
budgets on top of the geometry.

### Tools and languages

TypeScript; Preact for the interface; Vite for the build; Vitest for the tests; Astronomy
Engine for the positions of the Sun and the Moon; Web Workers for the map; Python for the
script that fetches the reference tables from NASA/JPL Horizons; GitHub Pages for hosting.
Open source under the Apache License 2.0.

## Use of Super Intelligence (SI)

On the form this field is a list of options. Selected: Research or Information
Gathering; Data Analysis and Interpretation; Coding, Debugging, or Troubleshooting;
Writing, Editing, or Translation; Visual Design or Image Creation; Presentation, Video,
or Audio. The statement below is the one made in the repository.

Two AI tools were used throughout: Anthropic Claude (Claude Code) and OpenAI Codex.

How they were used. The idea is the team's: one screen, readable at a glance, on which
landing sites and dates are compared side by side and the answer — power or not, contact
with the Earth or not — is plain. The team chose the challenge, set the goals and
priorities, decided what was built and reviewed the results. To carry the idea out, under
the team's direction, the AI tools worked out the features and the methods, wrote and
tested the code (the computational core, the terrain pipeline, the web application),
researched official sources and checked every cited fact against them, and drafted the
documentation. Each tool reviewed the other's work independently, with reproductions and
regression tests.

How it is marked. Every AI-assisted source file carries a header line naming the tool
that helped write it. The file `docs/ai-usage-log.md` in the repository records what each
tool did and when, and the README has a section "Use of AI tools".

What is not AI-generated. No image, video or audio in the project is AI-generated: the
figures are screenshots of the application or renderings of NASA data made by the
project's own code. No dataset is AI-generated. One data file was transcribed with AI
assistance — the contact times printed on NASA's eclipse figures, which are images — and a
test checks the transcription against NASA's catalogue. No NASA logo or branding is used.

## NASA Data

- **Lunar Orbiter Laser Altimeter (LOLA) elevation model `LDEM_75S_120M`**, Lunar
  Reconnaissance Orbiter, NASA Planetary Data System (data set LRO-L-LOLA-4-GDR-V1.0). The
  heart of the project: the skyline of every site south of 80° S is computed from it, the application
  ships it as 120 m tiles and as a 480 m reduction, and the map is drawn from it.
- **LOLA-team average illumination and Earth-visibility maps**
  (`AVGVISIB_85S_060M_201608` and `AVGVISIB_85S_060M_201608_EARTH`), NASA Planetary Data
  System. Used as an independent check of the whole chain (400 places, correlation 0.98),
  to find the eight best-lit points offered as sites, and shown as two map layers.
- **NASA/JPL Horizons** (ephemeris DE441). 9,810 reference directions of the Sun and the
  Earth at nine lunar sites; the computation is tested against them.
- **NASA eclipse web site, Goddard Space Flight Center** (*Five Millennium Canon of Lunar
  Eclipses*). The conventions for the Earth's shadow, and the contact times of the 14
  lunar eclipses of 2025–2030, against which the eclipse computation is tested. Eclipse
  Predictions by Fred Espenak and Jean Meeus (NASA's GSFC).
- **NASA Space Science Data Coordinated Archive**, Lunar Artifacts and Impact Sites table:
  the coordinates of the Apollo landing sites.
- **Lunar Reconnaissance Orbiter Camera (LROC)** featured images (NASA/GSFC/Arizona State
  University): the measured coordinates of robotic landers.
- **Jet Propulsion Laboratory**, IPN Progress Report 42-240: the Earth elevations reported
  for the IM-1 and Chandrayaan-3 landings, used as a check.
- **NASA documents** quoted for the problem statement: *Lunar Site Selection* (Moon to
  Mars Architecture white paper, NTRS 20230016267) and *Artemis Human Landing System
  Overview* (NTRS 20250009323).

Exact files, addresses and checksums: `docs/references.md` and `data/terrain/README.md` in
the repository.

## Space Agency Partner Data and Other References

No Space Agency Partner data is used.

Software, all open source: Astronomy Engine 2.1.19 by Don Cross (MIT), Preact and
@preact/signals (MIT), Vite (MIT), Vitest (MIT), tsx (MIT), TypeScript (Apache-2.0),
Node.js and its type definitions (MIT), Python 3 for one script. The application and the
demo are set in the Inter typeface (SIL Open Font License 1.1). For checks of the built
application: Playwright (Apache-2.0) driving a headless browser. For reading NASA's
eclipse figures: Poppler (pdftoppm).

Data and documents: Gazetteer of Planetary Nomenclature (IAU / USGS Astrogeology), for
the names and coordinates of south-polar features; E. Mazarico et al., "Illumination
conditions of the lunar polar regions using LOLA topography", Icarus 211 (2011), for the
method behind the NASA illumination maps; Firefly Aerospace, "Blue Ghost Mission 1: Live
Updates", for the mission's predicted times of the eclipse of 14 March 2025; the challenge
statement of the 2026 NASA Space Apps Challenge.

The complete list, with addresses and licences, is `docs/references.md` in the
repository.
