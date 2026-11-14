# AI usage log

NASA Space Apps 2026 asks teams to state clearly where and how AI tools were used. This
file is that statement, kept up to date while the project is being built. Times are
Central European Time (CET, UTC+1).

## Tools

| Tool | Role in this project |
|---|---|
| Anthropic Claude (Claude Code) | Writes and reviews code and documentation for the web application, the terrain pipeline, the repository and the delivery; researches official sources |
| OpenAI Codex | Writes and tests the computational core and its validation against NASA/JPL Horizons |

Both tools work under the direction of the team, which chose the challenge, sets goals
and priorities, decides what is built, and reviews the result.

## How AI-assisted material is marked

- **Code and documentation:** every AI-assisted source file carries a header line naming
  the tool that helped write it, and the log below records what each tool did and when.
- **Data:** no dataset in this repository is AI-generated. Every dataset comes from a
  cited source or is computed by code in this repository from cited sources.
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
