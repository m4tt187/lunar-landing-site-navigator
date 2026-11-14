// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// Background worker for the map layers: for each time sample it runs the
// whole-map sweep once for the Sun and once for the Earth, and returns how many
// samples each map cell saw the Sun, the Earth, and both at once.
import { createSweep, makePolarDem } from '@engine/index';
import type { PolarDem, Sweep } from '@engine/index';

export interface InitMessage { type: 'init'; raw: ArrayBuffer; n: number; scaleM: number; heightScale: number; minLatDeg: number }
export interface RunMessage {
  type: 'run';
  job: number;
  mastM: number;
  binM: number;
  /** Three numbers per time sample: the direction to test for the Sun. */
  sun: Float64Array;
  /** Three numbers per time sample: the direction to test for the Earth. */
  earth: Float64Array;
}
export interface ReadyMessage { type: 'ready'; size: number; origin: number; inside: Uint8Array }
export interface DoneMessage { type: 'done'; job: number; samples: number; sun: Uint16Array; earth: Uint16Array; both: Uint16Array }
export interface FailMessage { type: 'fail'; job: number; message: string }
export type WorkerReply = ReadyMessage | DoneMessage | FailMessage;

const scope = self as unknown as { postMessage(message: unknown, transfer?: Transferable[]): void; onmessage: ((event: MessageEvent) => void) | null };

let dem: PolarDem | null = null;
let minLatDeg = -80;
/** The two most recently used sweeps (the full-resolution one and the coarse one used while playing). */
const sweeps = new Map<string, Sweep>();

function sweepFor(mastM: number, binM: number): Sweep {
  const key = `${mastM}|${binM}`;
  let sweep = sweeps.get(key);
  if (sweep) sweeps.delete(key);
  else {
    if (sweeps.size >= 2) sweeps.delete(sweeps.keys().next().value!);
    sweep = createSweep(dem!, { minLatDeg, observerHeightM: mastM, binM });
  }
  sweeps.set(key, sweep);
  return sweep;
}

scope.onmessage = (event: MessageEvent<InitMessage | RunMessage>): void => {
  const message = event.data;
  try {
    if (message.type === 'init') {
      minLatDeg = message.minLatDeg;
      dem = makePolarDem(new Int16Array(message.raw), message.n, message.scaleM, message.heightScale);
      const first = sweepFor(2, message.scaleM);
      const ready: ReadyMessage = { type: 'ready', size: first.size, origin: first.origin, inside: first.inside.slice() };
      scope.postMessage(ready);
      return;
    }
    const s = sweepFor(message.mastM, message.binM);
    const cells = s.size * s.size;
    const samples = message.sun.length / 3;
    const sun = new Uint16Array(cells), earth = new Uint16Array(cells), both = new Uint16Array(cells);
    const sunMask = new Uint8Array(cells), earthMask = new Uint8Array(cells);
    for (let i = 0; i < samples; i++) {
      s.run([message.sun[3 * i]!, message.sun[3 * i + 1]!, message.sun[3 * i + 2]!], sunMask);
      s.run([message.earth[3 * i]!, message.earth[3 * i + 1]!, message.earth[3 * i + 2]!], earthMask);
      for (let k = 0; k < cells; k++) {
        const a = sunMask[k]!, b = earthMask[k]!;
        sun[k] = sun[k]! + a; earth[k] = earth[k]! + b; both[k] = both[k]! + (a & b);
      }
    }
    const done: DoneMessage = { type: 'done', job: message.job, samples, sun, earth, both };
    scope.postMessage(done, [sun.buffer, earth.buffer, both.buffer]);
  } catch (error) {
    const fail: FailMessage = { type: 'fail', job: message.type === 'run' ? message.job : -1, message: String(error) };
    scope.postMessage(fail);
  }
};
