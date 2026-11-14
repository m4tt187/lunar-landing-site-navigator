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

- **Code and documentation:** AI-assisted source files carry a header line saying so;
  AI-assisted commits carry a `Co-Authored-By` trailer naming the tool.
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
| 14 Nov 09:10 | Claude | Started source research (NASA LOLA topography products, landing-site coordinates, mission-planning conventions) with independent verification of every cited fact |
| 14 Nov 09:20 | Claude | Wrote the repository skeleton: licence, README, tooling configuration, placeholder page |
