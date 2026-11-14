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
  { value: 0, label: 'its centre clears the skyline' },
  { value: 2, label: 'it is 2° above the skyline' },
  { value: 5, label: 'it is 5° above the skyline' },
];

export type MapLayer = 'terrain' | 'now' | 'sun' | 'earth' | 'both' | 'nasa-sun' | 'nasa-earth';
export const MAP_LAYERS: { id: MapLayer; label: string; title: string }[] = [
  { id: 'terrain', label: 'Terrain', title: 'Shaded relief from NASA LOLA elevation data' },
  { id: 'now', label: 'Now', title: 'Where the Sun and the Earth can be seen at the moment shown by the time slider' },
  { id: 'both', label: 'Power + link', title: 'Share of the mission with sunlight and the Earth in view at the same time' },
  { id: 'sun', label: 'Sunlight', title: 'Share of the mission with sunlight' },
  { id: 'earth', label: 'Earth in view', title: 'Share of the mission with the Earth in view' },
  { id: 'nasa-sun', label: 'NASA: sunlight', title: 'Long-term average sunlight, NASA LOLA team map (south of 85° S)' },
  { id: 'nasa-earth', label: 'NASA: Earth', title: 'Long-term average Earth visibility, NASA LOLA team map (south of 85° S)' },
];

export const HOUR = 3600000;
export const DAY = 86400000;

/**
 * Landing dates the app accepts. The landing calendar starts up to a month
 * before the landing and looks more than a year ahead of it, and all of that
 * must stay inside the years the ephemeris covers (2000-2050).
 */
export const MIN_LANDING_MS = MIN_TIME_MS + 32 * DAY;
export const MAX_LANDING_MS = MAX_TIME_MS - 490 * DAY;

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
export const mapLayer = signal<MapLayer>('terrain');

let nextId = 1;
export const newId = (): number => nextId++;

export function clampTime(ms: number): number {
  return Math.min(MAX_LANDING_MS, Math.max(MIN_LANDING_MS, ms));
}

export function defaultStart(): number {
  const now = new Date();
  return clampTime(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
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
export function setScenarios(list: Omit<Scenario, 'id'>[]): void {
  const next = list.slice(0, MAX_SCENARIOS).map((s) => ({ ...s, id: newId(), startMs: clampTime(s.startMs) }));
  if (!next.length) return;
  scenarios.value = next;
  selectedId.value = next[0]!.id;
  cursorH.value = 0;
}

/** Shareable state in the URL fragment. */
export function encodeState(): string {
  const parts = scenarios.value.map((s) => {
    const site = s.siteId ?? `@${s.custom!.latDeg.toFixed(4)}_${s.custom!.lonDeg.toFixed(4)}`;
    return [site, s.mastM, new Date(s.startMs).toISOString().slice(0, 16)].join('~');
  });
  return `v=1&s=${parts.join('|')}&d=${durationDays.value}&sun=${sunRule.value}&earth=${earthRule.value}&map=${mapLayer.value}`;
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
  const layer = params.get('map');
  if (MAP_LAYERS.some((x) => x.id === layer)) mapLayer.value = layer as MapLayer;
  return true;
}
