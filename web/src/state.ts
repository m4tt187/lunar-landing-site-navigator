// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
import { signal } from '@preact/signals';
import { MAX_TIME_MS, MIN_TIME_MS } from '@engine/index';
import type { AppData } from './data';

export interface Scenario {
  id: number;
  /** Catalogue site id, or null for custom coordinates. */
  siteId: string | null;
  custom: { name: string; latDeg: number; lonDeg: number } | null;
  mastM: number;
  /** Landing time, UTC milliseconds. */
  startMs: number;
}

export const SCENARIO_COLORS = ['#f2b84b', '#5fb4ff', '#7ee0a1', '#e88cc5'];
export const MAX_SCENARIOS = 4;
export const DURATIONS = [
  { days: 14, label: '14 days' },
  { days: 29.53, label: '1 lunar day (29.5 d)' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
];
export const SUN_RULES = [
  { value: 0, label: 'any part of the Sun shows' },
  { value: 0.5, label: 'at least half the disc shows' },
  { value: 1, label: 'the whole disc shows' },
];
export const EARTH_RULES = [
  { value: 0, label: 'just above the skyline' },
  { value: 2, label: '2° above the skyline' },
  { value: 5, label: '5° above the skyline' },
];

export const HOUR = 3600000;
export const DAY = 86400000;

export const data = signal<AppData | null>(null);
export const loadError = signal<string | null>(null);
export const scenarios = signal<Scenario[]>([]);
export const selectedId = signal(0);
export const durationDays = signal(29.53);
/** Hours since landing shown by the cursor, shared by all scenarios. */
export const cursorH = signal(0);
export const sunRule = signal(0);
export const earthRule = signal(0);
export const playing = signal(false);

let nextId = 1;
export const newId = (): number => nextId++;

export function clampTime(ms: number): number {
  return Math.min(MAX_TIME_MS - 400 * DAY, Math.max(MIN_TIME_MS, ms));
}

export function defaultStart(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

export function updateScenario(id: number, patch: Partial<Scenario>): void {
  scenarios.value = scenarios.value.map((s) => (s.id === id ? { ...s, ...patch } : s));
}
export function addScenario(s: Omit<Scenario, 'id'>): void {
  if (scenarios.value.length >= MAX_SCENARIOS) return;
  const id = newId();
  scenarios.value = [...scenarios.value, { ...s, id }];
  selectedId.value = id;
}
export function removeScenario(id: number): void {
  if (scenarios.value.length <= 1) return;
  scenarios.value = scenarios.value.filter((s) => s.id !== id);
  if (selectedId.value === id) selectedId.value = scenarios.value[0]!.id;
}

/** Shareable state in the URL fragment. */
export function encodeState(): string {
  const parts = scenarios.value.map((s) => {
    const site = s.siteId ?? `@${s.custom!.latDeg.toFixed(4)}_${s.custom!.lonDeg.toFixed(4)}`;
    return [site, s.mastM, new Date(s.startMs).toISOString().slice(0, 16)].join('~');
  });
  return `v=1&s=${parts.join('|')}&d=${durationDays.value}&sun=${sunRule.value}&earth=${earthRule.value}`;
}

export function decodeState(hash: string, app: AppData): boolean {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const s = params.get('s');
  if (params.get('v') !== '1' || !s) return false;
  const list: Scenario[] = [];
  for (const part of s.split('|').slice(0, MAX_SCENARIOS)) {
    const [site, mast, start] = part.split('~');
    const startMs = Date.parse(`${start}:00Z`);
    const mastM = Number(mast);
    if (!site || !Number.isFinite(startMs) || !app.mastHeightsM.includes(mastM)) continue;
    if (site.startsWith('@')) {
      const [lat, lon] = site.slice(1).split('_').map(Number);
      if (lat === undefined || lon === undefined || !(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) continue;
      list.push({ id: newId(), siteId: null, custom: { name: 'Custom site', latDeg: lat, lonDeg: lon }, mastM, startMs: clampTime(startMs) });
    } else if (app.sites.some((x) => x.id === site)) {
      list.push({ id: newId(), siteId: site, custom: null, mastM, startMs: clampTime(startMs) });
    }
  }
  if (!list.length) return false;
  scenarios.value = list;
  selectedId.value = list[0]!.id;
  const d = Number(params.get('d'));
  if (DURATIONS.some((x) => x.days === d)) durationDays.value = d;
  const sun = Number(params.get('sun'));
  if (SUN_RULES.some((x) => x.value === sun)) sunRule.value = sun;
  const earth = Number(params.get('earth'));
  if (EARTH_RULES.some((x) => x.value === earth)) earthRule.value = earth;
  return true;
}
