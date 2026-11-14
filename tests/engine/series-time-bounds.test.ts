// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with OpenAI Codex under the direction of the team.
import {describe,expect,it} from 'vitest';
import {computeSeries,MIN_TIME_MS} from '../../engine/src/geometry.ts';

const site={id:'time-grid',name:'Time grid fixture',latDeg:-89,lonDeg:0,heightM:0};

describe('series timestamp precision and finite work',()=>{
  it.each([2,Number.MAX_VALUE])('retains both endpoints when cadence %s exceeds the span',stepS=>{
    const series=computeSeries(site,MIN_TIME_MS,MIN_TIME_MS+1000,stepS);
    expect(series.n).toBe(2);
    expect(Array.from(series.timesMs)).toEqual([MIN_TIME_MS,MIN_TIME_MS+1000]);
    expect(series.stepS).toBe(stepS);
  });
  it('rejects sub-precision steps that produce repeated timestamps',()=>{
    expect(()=>computeSeries(site,MIN_TIME_MS,MIN_TIME_MS+1,1e-7)).toThrow(/advance|precision/);
    expect(()=>computeSeries(site,MIN_TIME_MS,MIN_TIME_MS+1,Number.MIN_VALUE)).toThrow(RangeError);
  });
  it('rejects a cadence that stops advancing after a floating-point precision boundary',()=>{
    const boundary=2**41;
    expect(()=>computeSeries(site,boundary-1,boundary+1,0.00000025)).toThrow(/advance|precision/);
  });
  it('includes an exact fractional end and a shortened final interval',()=>{
    const end=MIN_TIME_MS+1250.25;
    const series=computeSeries(site,MIN_TIME_MS,end,0.5);
    expect(Array.from(series.timesMs)).toEqual([MIN_TIME_MS,MIN_TIME_MS+500,MIN_TIME_MS+1000,end]);
    expect(series.n).toBe(4);
  });
  it('preserves the 100000 sample work limit',()=>{
    expect(()=>computeSeries(site,MIN_TIME_MS,MIN_TIME_MS+100000,0.001)).toThrow(/100000 samples/);
  });
});
