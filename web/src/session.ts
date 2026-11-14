// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// Derived state shared by the panels: the analysis of every scenario, the
// elevation model for custom sites, and the effects that keep things in step.
import { computed, effect, signal } from '@preact/signals';
import type { PolarDem, Thresholds } from '@engine/index';
import { analyze } from './compute';
import type { Analysis } from './compute';
import type { Scenario } from './state';
import { catalogSiteAt, fineTerrainReady, loadDem, loadFineTerrainAround } from './data';
import type { AppData, FineTerrain } from './data';
import {
  cursorH, data, durationDays, earthRule, encodeState, scenarios, selectedId, sunRule, updateScenario,
} from './state';

export const dem = signal<PolarDem | null>(null);
export const demError = signal<string | null>(null);

export const thresholds = computed<Thresholds>(() => ({
  sunMinDiskFraction: sunRule.value, earthMinElevationAboveHorizonDeg: earthRule.value,
}));

// The 120 m terrain around picked sites. `fineArrivals` counts the loads that have
// finished, so that the analyses are redone when tiles arrive; `fineFailed` is set
// when tiles cannot be had (an old browser, no network): the 480 m model is then used.
const fine = signal<FineTerrain | null>(null);
const fineArrivals = signal(0);
export const fineFailed = signal(false);
/** Picked points that turned out to lie outside the area the tiles cover. */
const withoutFine = new Set<string>();

/** A picked site that needs a skyline computed from the elevation data (not a catalogue site, inside the mapped area). */
function pickedPoint(s: Scenario, app: AppData): { latDeg: number; lonDeg: number } | null {
  const c = s.custom;
  return c && c.latDeg <= app.terrain.map.minLatDeg && !catalogSiteAt(app, c.latDeg, c.lonDeg) ? c : null;
}

function fineFor(s: Scenario, app: AppData): FineTerrain | 'pending' | null {
  const point = pickedPoint(s, app);
  if (!point || fineFailed.value || withoutFine.has(`${point.latDeg}|${point.lonDeg}`)) return null;
  const store = fine.value;
  return store && fineTerrainReady(store, point.latDeg, point.lonDeg) ? store : 'pending';
}

export const analyses = computed<(Analysis | null)[]>(() => {
  const app = data.value;
  if (!app) return [];
  void fineArrivals.value;
  return scenarios.value.map((s) => analyze(s, app, dem.value, fineFor(s, app), durationDays.value, thresholds.value));
});

export const selectedIndex = computed(() => Math.max(0, scenarios.value.findIndex((s) => s.id === selectedId.value)));
export const selectedAnalysis = computed<Analysis | null>(() => analyses.value[selectedIndex.value] ?? null);

/** Fetch the elevation model (once) for custom sites and computed map layers. */
export function needDem(): void {
  const app = data.value;
  if (!app || dem.value || demError.value) return;
  loadDem(app.terrain).then((d) => { dem.value = d; }, (e: unknown) => { demError.value = String(e); });
}

/** Fetch the 120 m tiles around a picked point (each tile once). */
function needFine(latDeg: number, lonDeg: number): void {
  if (fineFailed.value) return;
  loadFineTerrainAround(latDeg, lonDeg).then(
    (store) => {
      if (store) fine.value = store; else withoutFine.add(`${latDeg}|${lonDeg}`);
      fineArrivals.value++;
    },
    () => { fineFailed.value = true; },
  );
}

effect(() => {
  const app = data.value;
  if (!app) return;
  for (const s of scenarios.value) {
    const point = pickedPoint(s, app);
    if (!point) continue;
    needDem();
    needFine(point.latDeg, point.lonDeg);
  }
});

// Keep the cursor inside the span and the address bar in step with the state.
effect(() => { if (cursorH.value > durationDays.value * 24) cursorH.value = durationDays.value * 24; });
effect(() => { if (data.value && scenarios.value.length) history.replaceState(null, '', `#${encodeState()}`); });

const round4 = (v: number): number => Math.round(v * 10000) / 10000;

/** Move the selected scenario to custom coordinates (or to the catalogue site that sits there). */
export function moveSelectedTo(latDeg: number, lonDeg: number): void {
  const app = data.value;
  if (!app || !(Math.abs(latDeg) <= 90) || !(Math.abs(lonDeg) <= 180)) return;
  const lat = round4(latDeg), lon = round4(lonDeg);
  const match = catalogSiteAt(app, lat, lon);
  updateScenario(selectedId.value, match
    ? { siteId: match.id, custom: null }
    : { siteId: null, custom: { name: 'Custom site', latDeg: lat, lonDeg: lon } });
}
