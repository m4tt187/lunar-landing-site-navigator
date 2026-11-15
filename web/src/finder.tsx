// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// "Best site and date": describe a mission and get the site-and-date pairs that
// suit it best among the catalogue sites with a real skyline (planner.ts).
import { signal } from '@preact/signals';
import { MAX_TIME_MS } from '@engine/index';
import type { Recommendation } from '@engine/index';
import type { AppData } from './data';
import { fmtSpan, fmtUtc, pct } from './format';
import { findBest, rankableSites, searchEndMs } from './planner';
import type { MissionRequest } from './planner';
import { selectedAnalysis, selectedIndex, thresholds } from './session';
import { DAY, MAX_SCENARIOS, MIN_LANDING_MS, addScenario, clampTime, scenarios, selectedId, updateScenario } from './state';

const missionDays = signal(14);
const toleranceH = signal(0);
const earthAtLanding = signal(true);
const results = signal<{ list: Recommendation[]; request: MissionRequest; sites: number } | null>(null);
const progress = signal<string | null>(null);
const failure = signal<string | null>(null);
let running: AbortController | null = null;

function requestFor(app: AppData): MissionRequest {
  const scenario = selectedAnalysis.value?.scenario ?? scenarios.value[0]!;
  const mastM = app.mastHeightsM.includes(scenario.mastM) ? scenario.mastM : app.mastHeightsM[0]!;
  const start = new Date(scenario.startMs);
  const fromMs = Math.max(MIN_LANDING_MS, Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const request: MissionRequest = {
    missionDays: missionDays.value, toleranceH: toleranceH.value, earthAtLanding: earthAtLanding.value,
    mastM, fromMs, searchDays: 365, thresholds: thresholds.value,
  };
  // Keep the search inside the dates the ephemeris covers.
  while (request.searchDays > 30 && searchEndMs(request) > MAX_TIME_MS) request.searchDays -= 30;
  return request;
}

function find(app: AppData): void {
  running?.abort();
  const controller = new AbortController();
  running = controller;
  const request = requestFor(app);
  const sites = rankableSites(app, request.mastM).length;
  failure.value = null;
  progress.value = `Searching ${sites} sites…`;
  findBest(app, request, {
    count: 5, signal: controller.signal,
    onProgress: (done, total) => { progress.value = `Searching: ${done} of ${total} sites`; },
  }).then(
    (list) => {
      if (controller.signal.aborted) return;
      results.value = { list, request, sites };
      progress.value = null;
    },
    (error: unknown) => { if (!controller.signal.aborted) { failure.value = String(error); progress.value = null; } },
  );
}

export function FinderPanel({ app }: { app: AppData }) {
  const found = results.value;
  const index = selectedIndex.value;
  const number = (value: string, lo: number, hi: number, fallback: number): number => {
    const v = Number(value);
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  };
  return (
    <section class="panel">
      <header class="panel-head">
        <div>
          <h2>Best Site and Date</h2>
          <p class="sub">Describe the mission, get where and when to land</p>
        </div>
      </header>
      <form class="finder-form" onSubmit={(event) => { event.preventDefault(); find(app); }}>
        <label>Days of Surface Operations
          <input type="number" min="1" max="180" step="1" value={missionDays.value}
            onChange={(e) => { missionDays.value = number((e.currentTarget as HTMLInputElement).value, 1, 180, 14); }} />
        </label>
        <label>Darkness the Lander Survives
          <select value={String(toleranceH.value)} onChange={(e) => { toleranceH.value = Number((e.currentTarget as HTMLSelectElement).value); }}>
            <option value="0">None</option><option value="1">1 Hour</option><option value="6">6 Hours</option>
            <option value="24">1 Day</option><option value="72">3 Days</option><option value="336">14 Days</option>
          </select>
        </label>
        <label class="check"><input type="checkbox" checked={earthAtLanding.value}
          onChange={(e) => { earthAtLanding.value = (e.currentTarget as HTMLInputElement).checked; }} />Earth in View at Touchdown</label>
        <button type="submit" class="primary" disabled={progress.value !== null}>Find the Best Site and Date</button>
        {progress.value ? <p class="finder-status" aria-live="polite">{progress.value}</p> : null}
      </form>
      {failure.value ? <p class="error">The search could not be completed: {failure.value}</p> : null}
      {found ? (found.list.length ? (
        <>
          <div class="table-wrap">
            <table class="compare">
              <thead><tr>
                <th scope="col">Rank</th><th scope="col">Site</th><th scope="col">Landing (UTC)</th><th scope="col">Power Lasts</th>
                <th scope="col">Mission Powered</th><th scope="col">Earth in View</th><th scope="col">Longest Link Gap</th><th scope="col" />
              </tr></thead>
              <tbody>
                {found.list.map((r) => (
                  <tr>
                    <td>{r.rank}</td>
                    <th scope="row">{r.candidateName}</th>
                    <td>{fmtUtc(r.landingMs).replace(' UTC', '')}</td>
                    <td>{r.openEnded ? 'More than ' : ''}{fmtSpan(r.powerHours)}</td>
                    <td class={r.missionCoverage >= 1 ? 'best' : ''}>{pct(r.missionCoverage)}</td>
                    <td>{pct(r.earthFraction)}</td>
                    <td>{r.longestLinkGapH > 0 ? fmtSpan(r.longestLinkGapH) : 'None'}</td>
                    <td class="actions">
                      <button type="button" onClick={() => updateScenario(selectedId.value, { siteId: r.candidateId, custom: null, startMs: clampTime(r.landingMs) })}>Set Scenario {index + 1}</button>
                      <button type="button" disabled={scenarios.value.length >= MAX_SCENARIOS}
                        onClick={() => addScenario({ siteId: r.candidateId, custom: null, mastM: found.request.mastM, startMs: clampTime(r.landingMs) })}>Add to Comparison</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p class="muted small">
            {found.sites} sites with a real skyline, every hour of {found.request.searchDays} days from {fmtUtc(found.request.fromMs).slice(0, 10)}, panels {found.request.mastM} m above the ground,
            for a mission of {found.request.missionDays} days. Ranked by power for the whole mission first, then by contact with the Earth. "Power Lasts" is the unbroken stretch from touchdown
            {found.request.toleranceH > 0 ? `, bridging darkness of up to ${fmtSpan(found.request.toleranceH)}` : ''}; it runs to the end of the {Math.round((searchEndMs(found.request) - found.request.fromMs) / DAY)} days examined at most.
          </p>
        </>
      ) : <p class="finder-status">No site with a real skyline is available for this height above the ground.</p>) : (
        <p class="hint">Searches every landing hour of a year at the {rankableSites(app, selectedAnalysis.value?.scenario.mastM ?? 2).length} sites that have a real skyline, with the rules chosen above for the Sun and the Earth.</p>
      )}
    </section>
  );
}
