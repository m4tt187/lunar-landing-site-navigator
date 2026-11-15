// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with OpenAI Codex under the direction of the team.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MOON_RADIUS_KM, SUN_RADIUS_KM, computeTerrainHorizon, horizonElevationAt,
  makePolarDem, moonFixedVectors, sampleFromVectors, sampleMargins,
  sunDiskFractionVisible, sunVisible,
} from '@engine/index';
import { directionsFor, mapReachKm } from './visibility';
import type { MoonFixedVectors } from '@engine/index';
import type { InitMessage, RunMessage, WorkerReply, ReadyMessage, DoneMessage } from './worker';

const DEG = Math.PI / 180;
const site = { id: 'pole', name: 'pole', latDeg: -90, lonDeg: 0, heightM: 0 };
const profile = { azStepDeg: 360, elDeg: new Float32Array([0]) };
const sunDistance = SUN_RADIUS_KM / Math.sin(.25 * DEG);
const earthDistance = 6378.137 / Math.sin(1 * DEG);

function vectorsAt(sunElevation: number, earthElevation: number): MoonFixedVectors {
  return {
    sun: [sunDistance * Math.cos(sunElevation * DEG), 0, -MOON_RADIUS_KM - sunDistance * Math.sin(sunElevation * DEG)],
    earth: [earthDistance * Math.cos(earthElevation * DEG), 0, -MOON_RADIUS_KM - earthDistance * Math.sin(earthElevation * DEG)],
  };
}

let scope: { postMessage: ReturnType<typeof vi.fn>; onmessage: ((event: MessageEvent<InitMessage | RunMessage>) => void) | null };
let replies: WorkerReply[];

function send(message: InitMessage | RunMessage): WorkerReply {
  expect(scope.onmessage).toBeTypeOf('function');
  const previous = replies.length;
  // Match engine.ts: init transfers the DEM, run clones the direction arrays.
  const data = structuredClone(message, { transfer: message.type === 'init' ? [message.raw] : [] });
  if (message.type === 'init') expect(message.raw.byteLength).toBe(0);
  scope.onmessage!({ data } as MessageEvent<InitMessage | RunMessage>);
  expect(replies).toHaveLength(previous + 1);
  const reply = replies.at(-1)!;
  expect(reply.type, JSON.stringify(reply.type === 'fail' ? reply : { type: reply.type })).not.toBe('fail');
  if (reply.type === 'done') {
    const [sent, transfer] = scope.postMessage.mock.calls.at(-1)! as [DoneMessage, ArrayBuffer[]];
    expect(transfer).toEqual([sent.sun.buffer, sent.earth.buffer, sent.both.buffer]);
    expect(transfer.every((buffer) => buffer.byteLength === 0)).toBe(true);
  }
  return reply;
}

function init(message: Omit<InitMessage, 'type'>): ReadyMessage {
  const reply = send({ type: 'init', ...message });
  expect(reply.type).toBe('ready');
  return reply as ReadyMessage;
}

beforeEach(async () => {
  vi.resetModules();
  replies = [];
  scope = {
    // Exercise the actual handler's output transfer list, including buffer
    // detachment, while retaining the cloned reply received by its caller.
    postMessage: vi.fn((message: WorkerReply, transfer: ArrayBuffer[] = []) => {
      replies.push(structuredClone(message, { transfer }));
    }),
    onmessage: null,
  };
  vi.stubGlobal('self', scope);
  await import('./worker');
});
afterEach(() => vi.unstubAllGlobals());

function run(vectors: MoonFixedVectors, rule: number, minLatDeg: number, mastM: number, binM: number): { done: DoneMessage; gate: number } {
  // Use the page's production direction builder and the unchanged worker
  // handler; this test does not implement the worker's visibility calculation.
  const directions = directionsFor({ sunFraction: rule, earthMarginDeg: 0 }, [vectors], mapReachKm(minLatDeg));
  const message: RunMessage = { type: 'run', job: 17, mastM, binM, sunFraction: rule, ...directions };
  const reply = send(message);
  expect(reply.type).toBe('done');
  const done = reply as DoneMessage;
  expect(done.job).toBe(message.job);
  expect(done.samples).toBe(1);
  return { done, gate: directions.eclipse[0]! };
}

function expected(vectors: MoonFixedVectors, rule: number) {
  const thresholds = { sunMinDiskFraction: rule, earthMinElevationAboveHorizonDeg: 0 };
  const sample = sampleFromVectors(site, Date.UTC(2028, 0, 12), vectors);
  const margins = sampleMargins(sample, profile, thresholds);
  return { count: Number(sunVisible(margins.sunDeg, thresholds)), fraction: margins.sunDiskFraction, margin: margins.sunDeg };
}

describe('map worker combines the terrain and Earth on the same solar disc', () => {
  let ready: ReadyMessage;
  beforeEach(() => {
    ready = init({ raw: new Int16Array(65 * 65).buffer, n: 65, scaleM: 1000, heightScale: .5, minLatDeg: -89.5 });
  });

  function atPole(vectors: MoonFixedVectors, rule: number): { actual: number; gate: number } {
    const { done, gate } = run(vectors, rule, -89.5, 0, 1000);
    const cells = ready.size * ready.size;
    expect([done.sun.length, done.earth.length, done.both.length]).toEqual([cells, cells, cells]);
    const poleCell = (32 - ready.origin) * ready.size + (32 - ready.origin);
    expect(ready.inside[poleCell]).toBe(1);
    return { actual: done.sun[poleCell]!, gate };
  }

  it.each([
    { name: 'any-disc rule: Earth hides all of the cap above the horizon', rule: 0, sunElevation: 0, earthElevation: .85 },
    { name: 'half-disc rule: combined visible cap is below one half', rule: .5, sunElevation: .05, earthElevation: 1.10 },
  ])('$name', ({ rule, sunElevation, earthElevation }) => {
    const vectors = vectorsAt(sunElevation, earthElevation);
    const reference = expected(vectors, rule);
    expect(reference.count).toBe(0);
    expect(reference.margin).toBeLessThan(0);
    if (rule === 0) expect(reference.fraction).toBe(0);
    else expect(reference.fraction).toBeLessThan(rule);
    const result = atPole(vectors, rule);
    expect(result.gate).toBe(0);
    console.info(JSON.stringify({ rule, ...reference, ...result }));
    expect(result.actual, `worker Sun count with rule ${rule}; combined visible fraction ${reference.fraction}; production eclipse gate ${result.gate}`).toBe(reference.count);
  });

  it('keeps a clear Sun above the horizon visible', () => {
    const vectors = vectorsAt(5, 15);
    const reference = expected(vectors, .5);
    expect(reference.count).toBe(1);
    const result = atPole(vectors, .5);
    expect(result.gate).toBe(0);
    expect(result.actual).toBe(reference.count);
  });
});

it('returns darkness for real DEM cell 830611 at 2028-01-12T03:12:37Z with a 2 m mast', () => {
  const file = fileURLToPath(new URL('../../public/data/ldem_75s_480m.i16', import.meta.url));
  const buffer = readFileSync(file);
  const raw = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
  const dem = makePolarDem(raw, 1906, 480, .5);
  const mastM = 2;
  const ready = init({ raw: raw.slice().buffer, n: dem.n, scaleM: dem.scaleM, heightScale: dem.heightScale, minLatDeg: -80 });
  expect(ready.size).toBe(1268);
  const k = 830611;
  expect(ready.inside[k]).toBe(1);
  // Recover the tested place from the worker's ready message, not from a
  // second sweep or a hard-coded latitude and longitude.
  const centre = dem.n / 2 - .5;
  const row = ready.origin + Math.floor(k / ready.size), col = ready.origin + k % ready.size;
  const east = (col - centre) * dem.scaleM, north = (centre - row) * dem.scaleM;
  const latDeg = -90 + 2 * Math.atan(Math.hypot(east, north) / (2 * MOON_RADIUS_KM * 1000)) / DEG;
  const lonDeg = Math.atan2(east, north) / DEG;
  expect(latDeg).toBeCloseTo(-81.1073631901, 6);
  expect(lonDeg).toBeCloseTo(-92.1889064795, 6);

  const horizon = computeTerrainHorizon(dem, latDeg, lonDeg, mastM, { azStepDeg: .25, maxDistanceKm: 250 });
  expect(horizon.truncated).toBe(false);
  const tMs = Date.UTC(2028, 0, 12, 3, 12, 37);
  const vectors = moonFixedVectors(tMs);
  const sky = sampleFromVectors({ id: `cell-${k}`, name: `Cell ${k}`, latDeg, lonDeg, heightM: horizon.groundHeightM + mastM }, tMs, vectors);
  const thresholds = { sunMinDiskFraction: 0, earthMinElevationAboveHorizonDeg: 0 };
  const reference = sampleMargins(sky, horizon.profile, thresholds);
  const terrainOnlyFraction = sunDiskFractionVisible(sky.sun.elDeg, sky.sun.angularRadiusDeg, horizonElevationAt(horizon.profile, sky.sun.azDeg));
  const earthOnlyFraction = 1 - reference.eclipseFraction;
  expect(terrainOnlyFraction).toBeGreaterThan(.15);
  expect(earthOnlyFraction).toBeGreaterThan(.15);
  expect(reference.sunDiskFraction).toBe(0);
  expect(reference.sunDeg).toBeCloseTo(-.14, 2);
  expect(sunVisible(reference.sunDeg, thresholds)).toBe(false);

  const { done, gate } = run(vectors, 0, -80, mastM, dem.scaleM);
  const cells = ready.size * ready.size;
  expect([done.sun.length, done.earth.length, done.both.length]).toEqual([cells, cells, cells]);
  expect(gate).toBe(0);
  expect(done.sun[k]).toBe(Number(sunVisible(reference.sunDeg, thresholds)));
  expect(done.both[k]).toBe(0);
  console.info(JSON.stringify({ cell: k, size: ready.size, latDeg, lonDeg, mastM, truncated: horizon.truncated, terrainOnlyFraction, earthOnlyFraction, ...reference, actual: done.sun[k], gate }));
});
