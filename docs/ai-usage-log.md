# AI usage log

NASA Space Apps 2026 asks teams to state clearly where and how AI tools were used. This
file is that statement, kept up to date while the project is being built. Times are
Central European Time (CET, UTC+1).

## Tools

| Tool | Role in this project |
|---|---|
| Anthropic Claude (Claude Code) | Writes and reviews code and documentation for the web application, the computational core, the terrain pipeline, the repository and the delivery; researches official sources |
| OpenAI Codex | Writes and tests parts of the computational core; reviews the rest of it independently, with reproductions and regression tests |

The idea is the team's: one screen, readable at a glance, on which landing sites and
dates are compared side by side. Both tools work under the direction of the team, which
chose the challenge, sets goals and priorities, decides what is built, and reviews the
result. To carry the idea out, the tools worked out the features and the methods and did
the work recorded in the log below.

## How AI-assisted material is marked

- **Code and documentation:** every AI-assisted source file carries a header line naming
  the tool that helped write it, and the log below records what each tool did and when.
- **Data:** no dataset in this repository is AI-generated. Every dataset comes from a
  cited source or is computed by code in this repository from cited sources. Two files
  were put together with AI assistance, and say so in a field of their own
  (`aiAssisted`): the site catalogue `data/sites/catalog.json`, which Claude compiled
  from the sources cited entry by entry; and `data/eclipses/nasa-lunar-eclipses.json`,
  whose contact times are printed on NASA's eclipse figures, which are images: Claude
  read them from the 14 figures and checked every one against the phase durations of
  NASA's catalogue page (a test repeats that check). The reports written by the
  validation tools name the tool that helped write the code in the same way.
- **Images, video, audio:** none are AI-generated. If that ever changes, the item will
  carry a visible watermark and be listed here.
- No NASA logos, insignia or other NASA branding are used anywhere.

## Before the hackathon window

No project work was done before the window opened: no code, no algorithms, no data
downloads, no assets, no repository.

For transparency: in September 2026 the team kept private planning notes with AI
assistance (a checklist of rules to verify, the challenge summary, open research
questions, architecture options). Those notes are not part of this repository and
nothing was copied from them. On the morning of 14 November, before the start, the
official rules, guides and challenge page were re-read.

## Log

| When (CET) | Tool | What was done |
|---|---|---|
| 14 Nov 09:00 | Claude | Created the public repository at the team's instruction, after the official start |
| 14 Nov 09:04 | Claude | Re-read the official challenge page, Project Submission Guide, Judging & Awards Guide, Participant FAQs and Terms & Conditions |
| 14 Nov 09:04 | Codex | Independently re-read the same official pages and reported two wording corrections to the team's checklist |
| 14 Nov 09:08 | Claude | Started source research (NASA LOLA topography products, landing-site coordinates, mission-planning conventions) with independent verification of every cited fact |
| 14 Nov 09:11 | Claude | Wrote the repository skeleton: licence, README, tooling configuration, placeholder page |
| 14 Nov 09:10 | Codex | Started the computational core (TypeScript, runs in the browser) and the NASA/JPL Horizons reference client |
| 14 Nov 09:14 | Codex | Wrote the first version of the Sun/Earth geometry (`engine/src/geometry.ts`, `types.ts`) and the engine contract, then stopped (usage limit reached); Claude took over the core |
| 14 Nov 09:20 | Claude | Wrote the Horizons reference client, fetched 90 reference tables, and the test that compares the engine with them (max error 0.004 degrees over 9,810 samples) |
| 14 Nov 09:23 | Claude | Wrote the analysis functions (skyline interpolation, visible solar-disk fraction, sunlight/Earth windows, next rise/set) and their tests |
| 14 Nov 09:28 | Claude | Wrote the terrain-skyline code for the NASA LOLA polar elevation model and checked it on known features (Shackleton floor, Mons Malapert) |
| 14 Nov 09:33 | Claude | Compiled the site catalogue from cited NASA, LROC and USGS sources; wrote the terrain build (480 m model, shaded-relief map, per-site skylines) |
| 14 Nov 09:50 | Claude | Wrote the first version of the web application: south-pole map, scenario cards, skyline panorama, timeline, landing calendar, shareable links |
| 14 Nov 09:45 | Claude | Validated the terrain and ephemeris chain against the NASA LOLA-team average illumination and Earth-visibility maps at 400 points (correlation 0.98) |
| 14 Nov 09:50 | Claude | Added NASA long-term averages per site, the eight best-lit points found in the NASA illumination map, and map-layer assets built from those maps |
| 14 Nov 13:32 | Codex | Independently reviewed the computational core and the terrain code; reproduced three defects (terrain rays collapsing at exactly 90 S, threshold equality, missing input validation) and wrote the fixes with 70 regression tests |
| 14 Nov 13:50 | Claude | Reviewed and integrated those fixes; wrote the whole-map parallel-light sweep and its test against an independent ray march |
| 14 Nov 14:45 | Claude | Rebuilt the interface around it: live map layers (visibility now, share of the mission), best spot within 5 km, true-scale close-ups of the Sun and the Earth, layered skylines, calendar rows for every scenario with the best landing days, ready-made comparisons |
| 14 Nov 15:00 | Claude | Researched NASA and JPL statements on lighting and direct-to-Earth links, checked each quotation against the source text, added the check against JPL's reported Earth elevations for IM-1 and Chandrayaan-3; wrote the README and the methodology |
| 14 Nov 18:35 | Codex | Measured the straight-edge approximation of the solar disc on all 25 polar sites (kept: at most 0.6 percentage points on a mission); exported the shared visibility predicates; made the skyline code accept any height field; added guards on time grids |
| 14 Nov 19:00 | Claude | Wrote the interpolated table of Sun and Earth vectors that makes ten-minute sampling affordable, and the planning module (operating window, landing calendar, ranking of sites and dates), tested against a minute-by-minute simulation and the exact ephemeris |
| 14 Nov 19:05 | Claude | Cut NASA's 120 m elevation model into 431 lossless tiles, verified every sample against the source, and measured what a point chosen on the map gains from them (100 random places against the complete model) |
| 14 Nov 19:30 | Claude | Wrote the eclipse module (the Earth covering the Sun); read NASA's shadow conventions and the contact times of the 14 lunar eclipses of 2025-2030 from the NASA eclipse web site and tested the module against them; compared it with Firefly Aerospace's published times for the eclipse seen by Blue Ghost Mission 1 |
| 15 Nov 00:05 | Claude | Wired eclipses into the sunlight margins and summaries; made the application sample every mission every ten minutes and load the 120 m tiles around a chosen point |
| 15 Nov 00:20 | Codex | Independently reviewed the new modules: audited the whole-map sweep on 200 places and three dates, measured the sampled eclipse contacts on 240 cases, found a rounding defect in the eclipse visible fraction and two defects in the landing grid, and wrote the fixes with regression tests |
| 15 Nov 00:40 | Claude | Reproduced and integrated the review's findings; added input guards to the sweep; updated README, methodology, references and the engine pages |
| 15 Nov 00:50 | Claude | Checked the published repository from a clean copy (install, tests, build, command-line tools) and the built application in a browser; republished the site |
| 15 Nov 00:55 | Claude | Wrote the planning layer of the application (`web/src/planner.ts`: operating window, landing calendar, best site and date) with tests on the shipped site data |
| 15 Nov 06:35 | Codex | Tried two changes to the whole-map sweep in isolation and discarded both (they agreed less well with the independent ray march); reviewed the root documents and the new map code; measured the ends of windows from ten-minute samples against one-minute samples and the exact crossing (`tools/validation/timing.ts`); found, with a constructed case and a real one on the shipped terrain, that the map judged the terrain and the Earth one at a time during an eclipse |
| 15 Nov 06:55 | Claude | Put eclipses into the map layers: every cell against the Earth's disc as seen from that cell, and the terrain against the part of the Sun the Earth leaves uncovered; separated the map's computation from the page and the workers (`web/src/map/visibility.ts`) and tested it against each place's own answer, including the cases of the review; wrote the reproducible measurement of the interpolated vectors (`tools/validation/ephemeris.ts`); corrected the documents where the review found statements broader than their evidence |
| 15 Nov 08:30 | Codex | Reviewed the map's eclipse computation and its documents; updated the engine contract for the new functions; wrote a test that sends the review's cases through the background worker's own message handler; found a rounding edge in the skyline level when the Earth leaves exactly the required fraction of the Sun |
| 15 Nov 08:40 | Claude | Integrated that test and the contract; made the search for the skyline level start from the lowest uncovered point of the disc, which removes the rounding edge, with tests |
