// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// Runs the whole-map sweep in background workers and collects the results for
// the map layers: "now" (one instant) and the mission layers (many instants,
// added up into a share of the mission).
import { signal } from '@preact/signals';
import { directionFromPole, moonFixedVectors, raiseDirection, sunHiddenByEarth } from '@engine/index';
import type { Site } from '@engine/index';
import { loadDem } from '../data';
import type { TerrainMeta } from '../data';
import type { InitMessage, RunMessage, WorkerReply } from './worker';

export interface MapGrid { size: number; origin: number; inside: Uint8Array; scaleM: number; n: number }
export interface LayerResult {
  key: string;
  /** Time samples added up so far, and the number requested. */
  samples: number;
  total: number;
  sun: Uint16Array;
  earth: Uint16Array;
  both: Uint16Array;
}
export interface LayerRequest {
  mastM: number;
  startMs: number;
  /** Equal to startMs for a single instant. */
  endMs: number;
  /** Minimum visible fraction of the solar disc: 0, 0.5 or 1. */
  sunFraction: number;
  earthMarginDeg: number;
  /** Coarser bins: about three times faster, used while the animation is playing. */
  coarse?: boolean;
}

export const mapGrid = signal<MapGrid | null>(null);
export const mapError = signal<string | null>(null);
export const missionResult = signal<LayerResult | null>(null);
export const nowResult = signal<LayerResult | null>(null);

export const MISSION_SAMPLES = 120;
const BATCH = 2;
const SUN_RADIUS_KM = 695700;
const DEG = Math.PI / 180;

interface Batch { job: number; mastM: number; binM: number; sun: Float64Array; earth: Float64Array; sunHidden: Uint8Array }

/**
 * An eclipse is one event for the whole map: the Earth's direction differs by
 * less than 0.05 degrees across the mapped area, which shifts the contacts by a
 * few minutes at most. It is judged at the pole.
 */
const POLE: Site = { id: 'south-pole', name: 'South pole', latDeg: -90, lonDeg: 0, heightM: 0 };
interface Slot { worker: Worker; busy: boolean }

const slots: Slot[] = [];
let started = false;
let scaleM = 480;
let jobCounter = 0;
let missionJob = 0, nowJob = 0;
let missionQueue: Batch[] = [];
let nowQueue: Batch | null = null;
let nowKey = '';

/** Low-discrepancy sequence in [0, 1): any prefix covers the span evenly, so partial results are unbiased. */
function vanDerCorput(index: number): number {
  let result = 0, f = 0.5, i = index;
  while (i > 0) { if (i & 1) result += f; i >>= 1; f /= 2; }
  return result;
}

function directionsFor(request: LayerRequest, times: number[]): { sun: Float64Array; earth: Float64Array; sunHidden: Uint8Array } {
  const sun = new Float64Array(times.length * 3), earth = new Float64Array(times.length * 3);
  const sunHidden = new Uint8Array(times.length);
  times.forEach((tMs, i) => {
    sunHidden[i] = sunHiddenByEarth(POLE, tMs, request.sunFraction) ? 1 : 0;
    const v = moonFixedVectors(tMs);
    const sunRadiusDeg = Math.asin(SUN_RADIUS_KM / Math.hypot(v.sun[0], v.sun[1], v.sun[2])) / DEG;
    // Raise or lower the tested direction so that the rule ("any part", "half", "whole disc") becomes a point test.
    sun.set(raiseDirection(v.sun, (1 - 2 * request.sunFraction) * sunRadiusDeg), 3 * i);
    earth.set(raiseDirection(directionFromPole(v.earth), -request.earthMarginDeg), 3 * i);
  });
  return { sun, earth, sunHidden };
}

function pump(): void {
  slots.forEach((slot, index) => {
    if (slot.busy) return;
    // The first worker serves "now" requests first, so the animation stays responsive.
    let batch: Batch | undefined;
    if (index === 0 && nowQueue) { batch = nowQueue; nowQueue = null; } else batch = missionQueue.shift();
    if (!batch) return;
    slot.busy = true;
    const message: RunMessage = { type: 'run', ...batch };
    slot.worker.postMessage(message);
  });
}

function onReply(slot: Slot, reply: WorkerReply, meta: TerrainMeta): void {
  slot.busy = false;
  if (reply.type === 'ready') {
    if (!mapGrid.value) mapGrid.value = { size: reply.size, origin: reply.origin, inside: reply.inside, scaleM: meta.coarse.scaleM, n: meta.coarse.n };
  } else if (reply.type === 'fail') {
    mapError.value = reply.message;
  } else if (reply.job === nowJob) {
    nowResult.value = { key: nowKey, samples: reply.samples, total: 1, sun: reply.sun, earth: reply.earth, both: reply.both };
  } else if (reply.job === missionJob && missionResult.value) {
    const target = missionResult.value;
    const { sun, earth, both } = target;
    for (let k = 0; k < sun.length; k++) {
      sun[k] = sun[k]! + reply.sun[k]!; earth[k] = earth[k]! + reply.earth[k]!; both[k] = both[k]! + reply.both[k]!;
    }
    missionResult.value = { ...target, samples: target.samples + reply.samples };
  }
  pump();
}

/** Starts the workers (once). Safe to call repeatedly. */
export function startMapEngine(meta: TerrainMeta): void {
  if (started) return;
  started = true;
  scaleM = meta.coarse.scaleM;
  const cores = navigator.hardwareConcurrency || 4;
  const count = Math.max(1, Math.min(3, cores - 1));
  loadDem(meta).then(
    (dem) => {
      for (let i = 0; i < count; i++) {
        const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        const slot: Slot = { worker, busy: true };
        worker.onmessage = (event: MessageEvent<WorkerReply>): void => onReply(slot, event.data, meta);
        worker.onerror = (event): void => { mapError.value = event.message || 'The map worker stopped.'; };
        const raw = dem.raw.slice().buffer;
        const init: InitMessage = { type: 'init', raw, n: meta.coarse.n, scaleM: meta.coarse.scaleM, heightScale: meta.coarse.heightScale, minLatDeg: meta.map.minLatDeg };
        worker.postMessage(init, [raw]);
        slots.push(slot);
      }
    },
    (error: unknown) => { mapError.value = String(error); },
  );
}

const keyOf = (r: LayerRequest): string => [r.mastM, r.startMs, r.endMs, r.sunFraction, r.earthMarginDeg, r.coarse ? 1 : 0].join('|');

/** Share of a mission span with sunlight, Earth in view, and both. Results arrive progressively in `missionResult`. */
export function requestMission(request: LayerRequest): void {
  const grid = mapGrid.value;
  const key = keyOf(request);
  if (!grid || missionResult.value?.key === key) return;
  const times: number[] = [];
  for (let i = 0; i < MISSION_SAMPLES; i++) times.push(request.startMs + vanDerCorput(i + 1) * (request.endMs - request.startMs));
  const { sun, earth, sunHidden } = directionsFor(request, times);
  missionJob = ++jobCounter;
  missionQueue = [];
  for (let i = 0; i < MISSION_SAMPLES; i += BATCH)
    missionQueue.push({
      job: missionJob, mastM: request.mastM, binM: scaleM,
      sun: sun.slice(3 * i, 3 * (i + BATCH)), earth: earth.slice(3 * i, 3 * (i + BATCH)), sunHidden: sunHidden.slice(i, i + BATCH),
    });
  const cells = grid.size * grid.size;
  missionResult.value = { key, samples: 0, total: MISSION_SAMPLES, sun: new Uint16Array(cells), earth: new Uint16Array(cells), both: new Uint16Array(cells) };
  pump();
}

/** Visibility at one instant. The newest request replaces any that has not started yet; the previous picture stays until it arrives. */
export function requestNow(request: LayerRequest): void {
  const key = keyOf(request);
  if (!mapGrid.value || key === nowKey) return;
  nowKey = key;
  const { sun, earth, sunHidden } = directionsFor(request, [request.startMs]);
  nowJob = ++jobCounter;
  nowQueue = { job: nowJob, mastM: request.mastM, binM: request.coarse ? scaleM * 2 : scaleM, sun, earth, sunHidden };
  pump();
}
