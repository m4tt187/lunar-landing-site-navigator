# Lunar Landing Site Navigator

**If we land *here*, on *this day* — will we have power, and can we talk to Earth?**

A web tool that puts the Sun and the Earth against the **real skyline** of the Moon's
south pole, and lets mission planners, educators and anyone curious compare landing
sites and dates side by side in seconds.

**▶ Live application: https://m4tt187.github.io/lunar-landing-site-navigator/**

Built by team **Eallweald, Inc.** for the
[2026 NASA Space Apps Challenge](https://www.spaceappschallenge.org/2026/), challenge
[*Lunar Landing Site Navigator*](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/).

![The rim of Shackleton crater and its floor, ten kilometres apart, compared over one lunar day](docs/img/app-rim-vs-floor.jpg)

## Why

At the lunar south pole the Sun and the Earth never climb far above the horizon — "~2 to
7 deg", in the words of NASA's Artemis landing-system overview — so a single ridge decides
whether a lander has power and a radio link. NASA's own site-selection paper puts it
plainly: "the Earth must be visible in the lunar sky from the landing site", and "no
single location constantly — or even routinely — has ideal lighting and Earth visibility
conditions". Good sites exist only *for specific periods*. Choosing one means asking the
same question again and again for different places and dates.

The data to answer it are public (JPL Horizons for the ephemeris, the LOLA laser altimeter
for the terrain), but assembling the answer is specialist work. After two real south-polar
landings, a JPL report drew exactly this picture by hand — the Earth's elevation against
a terrain mask computed from elevation maps — to explain why their radio links faded.
This tool draws that picture for any site and any date, instantly, in a browser.

(Sources for the quotations: [docs/references.md](docs/references.md).)

## What it does

- **Compare up to four scenarios side by side.** A scenario is a site, a landing date and
  a height above the ground for the solar panels or antenna. A table marks the better
  value for sunlight, longest night, Earth visibility, longest link gap, and power and
  link together.
- **See the sky the lander would see.** For each scenario: the real skyline all around
  (three depths: nearer than 3 km, 30 km, and everything out to 400 km), the paths of
  the Sun and the Earth over the mission, true-scale close-ups of the solar disc and of
  the Earth against the ridge line, and the time left to the next sunset, sunrise,
  Earthset or Earthrise.
- **Move through time.** One slider (or Play) moves every scenario through its mission.
- **A map that answers "where?".** Computed in the browser for everything south of 80° S:
  where the Sun and the Earth are in view *at this moment* — with shadows that move as
  time plays — and the share of the chosen mission with sunlight, with the Earth in
  view, and with both. It then names the best place for power and link within 5 km of
  the selected site.
- **A calendar that answers "when?".** For every possible landing day of the coming year:
  how long sunlight, the Earth link, or both would last unbroken after touchdown, for
  every scenario, with the best landing days marked.
- **Sites to start from.** Apollo and robotic landing sites with cited coordinates,
  named south-pole features, the eight best-lit points of NASA's long-term illumination
  map — or any coordinates, typed or clicked on the map.
- **Rules you can change.** What counts as "Sun up" (any part of the disc, half, or all
  of it) and as "Earth in view" (its centre on the skyline, or 2° or 5° above it, since
  links that graze the terrain fade).
- **Ready-made comparisons** for a first look, and a **link** that reproduces any
  comparison exactly.

Plain-language sentences accompany the numbers, so the same screen serves a planner who
wants degrees and hours and a student who wants to know why the pole is hard.

## How it works

Everything is computed in the browser; there is no server.

1. **Where the Sun and the Earth are.** Their positions relative to the Moon come from
   the open-source Astronomy Engine; the Moon's orientation follows the IAU rotation
   model. For a site this gives azimuth, elevation, apparent size and distance, with
   light-time, aberration and the observer's position on the surface taken into account.
2. **What the terrain hides.** From the site, rays are marched over NASA's LOLA elevation
   model in every direction (every 0.25°), out to 400 km on the curved Moon. The highest
   elevation angle found along each ray is the skyline.
3. **What it means.** The Sun counts as up when the chosen fraction of its disc is above
   the skyline in its direction; the Earth when it clears the skyline by the chosen
   margin. From samples through the mission come the shares of time, the windows, the
   longest night and the longest link gap.
4. **The whole map at once.** For a distant light the terrain is resampled into a frame
   aligned with the light's direction; one running maximum per row then tells every
   place at once whether it sees the light. A whole-map answer takes about a tenth of a
   second, so the map layers are computed live, in background workers.

Full description, conventions and formulas: [docs/methodology.md](docs/methodology.md).
The engine's contract: [docs/engine/contract.md](docs/engine/contract.md).

## How far to trust it

| Check | Result |
|---|---|
| Sun and Earth directions against **NASA/JPL Horizons** (9,810 reference values: nine sites, five time windows, 2026–2035) | largest difference **0.004°** (the Sun's disc is 0.53° wide); the test fails above 0.01° |
| Earth elevation at two **real landings** against a JPL report | IM-1: 15.4° on the landing day and 9.6° a week later (JPL: "15 deg at landing down to 10 deg during the last contact"); Chandrayaan-3: 13.0° above the horizontal at landing (JPL: "approximately 11°" above the local terrain) |
| Share of time with sunlight and with the Earth in view against the **NASA LOLA-team illumination maps**, at 400 places south of 85.4° S over 18.6 years | correlation **0.98** for both; mean absolute difference 0.010 (Sun) and 0.012 (Earth); 96 % and 94 % of places within 0.05 |
| Whole-map sweep against an independent ray march over the same model | same answer for 98.9 % (Sun) and 99.5 % (Earth) of 1,280 place-and-time pairs; above 99.3 % away from shadow edges |
| Automated tests | 88 tests in 8 files, run with `npm test` |

Reproduce: `npm test`, `python3 tools/horizons/fetch_fixtures.py`,
`npx tsx tools/validation/illumination.ts` (details in [docs/methodology.md](docs/methodology.md)).

### Limits, stated plainly

- **Geometry only.** Line of sight to the Sun and the Earth. Not modelled: lunar eclipses
  (the Earth covering the Sun), the lander's own shadow and tilt, slopes, dust, heat,
  radio link budgets, and which ground stations on Earth can see the Moon.
- **Terrain resolution.** Marked sites use the 120 m LOLA model. Coordinates clicked on
  the map, and the map layers, use the same model reduced to 480 m: small ridges near the
  site are smoothed, and results can differ by ten percentage points or more from the
  120 m result. The application says which model each result uses.
- **Where terrain is modelled.** South of 80° S. Sites elsewhere (Apollo, mid-latitude
  landers) are computed with the horizon of a smooth sphere, and say so.
- **Dates.** Landings between February 2000 and August 2049.
- **Sampling.** Windows are found from samples every 30 minutes (missions up to a month),
  one hour (up to 100 days) or three hours (a year), with interpolated crossings. An
  event much shorter than the sampling step can be missed.
- **A planning aid, not a flight product.**

## NASA data and other sources

| Used for | Source |
|---|---|
| Reference Sun and Earth directions | NASA/JPL **Horizons** System |
| Terrain | NASA **LOLA** (Lunar Reconnaissance Orbiter) south-polar elevation model `LDEM_75S_120M`, NASA Planetary Data System |
| Independent check, long-term averages, best-lit points, map layers | NASA LOLA-team **average illumination and Earth-visibility maps** (`AVGVISIB_85S_060M_201608`) |
| Site coordinates | NASA **NSSDCA** lunar artifacts table; **LROC** (Lunar Reconnaissance Orbiter Camera) posts; IAU/USGS **Gazetteer of Planetary Nomenclature** |

Every source, with its exact location, licence or terms and where it is used, is listed
in [docs/references.md](docs/references.md); data provenance and checksums are in
[data/terrain/README.md](data/terrain/README.md). The shaded-relief map is rendered by this
project from the LOLA elevation model; it is not a photograph.

## Run it yourself

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev      # development server
npm test         # automated tests
npm run build    # production build in web/dist
```

The terrain assets shipped in `web/public/data/` are rebuilt from the NASA files with
`npx tsx tools/terrain/build.ts` (see [data/terrain/README.md](data/terrain/README.md)).

| Path | Contents |
|---|---|
| `engine/` | Computational core: Sun and Earth positions, skylines, windows, whole-map sweep |
| `web/` | The application (Preact, TypeScript, Vite) |
| `tests/` | Automated tests, including the comparisons with NASA/JPL data |
| `tools/` | Scripts that fetch the Horizons reference tables, build the terrain assets, run the validation |
| `data/` | Site catalogue with sources, Horizons reference tables, data provenance |
| `docs/` | Methodology, references and attributions, AI usage log |

## Use of AI tools

This project was built with substantial help from AI tools — Anthropic Claude (Claude
Code) and OpenAI Codex — working under the direction of the team: they proposed design
options, wrote and tested the code, researched and checked sources, and drafted the
documentation. Every AI-assisted source file says so in its header, and
[docs/ai-usage-log.md](docs/ai-usage-log.md) records what each tool did and when. No
image, video, audio or dataset here is AI-generated: figures are screenshots of the
application or renderings of NASA data made by code in this repository. No NASA logo or
branding is used.

## Licence

[Apache License 2.0](LICENSE). Third-party components and data keep their own licences
and terms, listed in [docs/references.md](docs/references.md).

This project is not affiliated with or endorsed by NASA.
