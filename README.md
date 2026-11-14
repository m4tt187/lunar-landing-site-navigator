# Lunar Landing Site Navigator

Compare lunar landing sites and dates at a glance: where the **Sun** and the **Earth** sit
relative to the local horizon, and what that means for **solar power** and
**direct-to-Earth communication**.

Built by team **Eallweald, Inc.** for the
[2026 NASA Space Apps Challenge](https://www.spaceappschallenge.org/2026/), challenge
[*Lunar Landing Site Navigator*](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/).

> **Status: work in progress.** This repository was created when the hackathon window
> opened (14 November 2026, 09:00 CET) and is being built in the open until the
> submission deadline (15 November 2026, 23:59 CET). Sections below are filled in as the
> corresponding parts are actually finished and tested — nothing is claimed in advance.

## What it will do

- Pick landing sites from a curated list (past missions, planned targets, south-pole
  points of interest) or enter custom lunar coordinates.
- Pick dates and time spans, and compare several site/date combinations side by side.
- Show the Sun and the Earth against the local horizon, the hours of sunlight and
  darkness, the Earth-visibility windows, and the time left before the next sunset or
  Earthset.

## Repository layout

| Path | Contents |
|---|---|
| `engine/` | Computational core: Sun and Earth positions for a lunar site and time span, and the derived metrics |
| `tests/` | Automated tests, including comparison against NASA/JPL Horizons reference data |
| `data/` | Small reference datasets with their provenance |
| `terrain/` | Processing of NASA LOLA topography into terrain-horizon profiles |
| `web/` | The web application |
| `docs/` | Methodology, [references and attributions](docs/references.md), [AI usage log](docs/ai-usage-log.md) |

## Run it locally

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev      # development server
npm test         # automated tests
npm run build    # production build in web/dist
```

## NASA data and resources

Listed, with licences and where each one is used, in
[docs/references.md](docs/references.md). The list is kept up to date as resources are
added.

## Use of AI tools

This project is built with substantial help from AI coding tools (Anthropic Claude via
Claude Code, and OpenAI Codex), working under the direction of the team. AI-assisted
source files say so in their header, AI-assisted commits carry a `Co-Authored-By`
trailer, and [docs/ai-usage-log.md](docs/ai-usage-log.md) records how the tools were
used. No AI-generated images, video or audio are included unless explicitly marked.

## Licence

[Apache License 2.0](LICENSE). Third-party components keep their own licences, listed in
[docs/references.md](docs/references.md).

This project is not affiliated with or endorsed by NASA.
