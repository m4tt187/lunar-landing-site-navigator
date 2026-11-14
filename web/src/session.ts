// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// Derived state shared by the panels: the analysis of every scenario, the
// elevation model for custom sites, and the effects that keep things in step.
import { computed, effect, signal } from '@preact/signals';
import type { PolarDem, Thresholds } from '@engine/index';
import { analyze } from './compute';
import type { Analysis } from './compute';
import { catalogSiteAt, loadDem } from './data';
import {
  cursorH, data, durationDays, earthRule, encodeState, scenarios, selectedId, sunRule, updateScenario,
} from './state';

export const dem = signal<PolarDem | null>(null);
export const demError = signal<string | null>(null);

export const thresholds = computed<Thresholds>(() => ({
  sunMinDiskFraction: sunRule.value, earthMinElevationAboveHorizonDeg: earthRule.value,
}));

export const analyses = computed<(Analysis | null)[]>(() => {
  const app = data.value;
  if (!app) return [];
  return scenarios.value.map((s) => analyze(s, app, dem.value, durationDays.value, thresholds.value));
});

export const selectedIndex = computed(() => Math.max(0, scenarios.value.findIndex((s) => s.id === selectedId.value)));
export const selectedAnalysis = computed<Analysis | null>(() => analyses.value[selectedIndex.value] ?? null);

/** Fetch the elevation model (once) for custom sites and computed map layers. */
export function needDem(): void {
  const app = data.value;
  if (!app || dem.value || demError.value) return;
  loadDem(app.terrain).then((d) => { dem.value = d; }, (e: unknown) => { demError.value = String(e); });
}

effect(() => {
  const app = data.value;
  if (!app) return;
  if (scenarios.value.some((s) => s.custom && s.custom.latDeg <= app.terrain.map.minLatDeg && !catalogSiteAt(app, s.custom.latDeg, s.custom.lonDeg)))
    needDem();
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
