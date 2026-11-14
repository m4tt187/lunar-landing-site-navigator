// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with OpenAI Codex under the direction of the team.
import { describe, expect, it } from 'vitest';
import { FLAT_HORIZON, MAX_TIME_MS, horizonElevationAt, nextEvent, summarize, sunDiskFractionVisible, validateProfile } from '../../engine/src/index.ts';
import type { EventKind, Series, Thresholds } from '../../engine/src/index.ts';

const HOUR = 3600000;
const site = {id:'test', name:'Test site', latDeg:0, lonDeg:0, heightM:0};
const thresholds: Thresholds = {sunMinDiskFraction:0.5, earthMinElevationAboveHorizonDeg:0};
function series(timesH: number[], sun: number[], earth = sun.map(() => 1)): Series {
  const n = timesH.length;
  return {site, n, startMs:timesH[0]!*HOUR, endMs:timesH[n-1]!*HOUR, stepS:3600,
    timesMs:Float64Array.from(timesH,x=>x*HOUR),sunAz:new Float64Array(n),earthAz:new Float64Array(n),
    sunEl:Float64Array.from(sun),earthEl:Float64Array.from(earth),
    sunRadius:new Float64Array(n).fill(0.25),earthRadius:new Float64Array(n).fill(1)};
}
describe('public input safety',()=>{
  it('rejects broken series rather than returning apparently valid darkness',()=>{
    const valid=series([0,1],[1,1]);
    for(const bad of [{...valid,n:0},{...valid,sunEl:new Float64Array(1)},
      {...valid,timesMs:new Float64Array([0,0])},{...valid,endMs:0},
      {...valid,sunEl:new Float64Array([1,NaN])},{...valid,sunRadius:new Float64Array([0,0])}])
      expect(()=>summarize(bad,FLAT_HORIZON,thresholds)).toThrow(RangeError);
  });
  it('rejects invalid horizon elevations, shape and query azimuth',()=>{
    for(const value of [NaN,Infinity,91]) {
      const profile={azStepDeg:360,elDeg:new Float32Array([value])};
      expect(()=>validateProfile(profile)).toThrow(RangeError);
      expect(()=>horizonElevationAt(profile,0)).toThrow(RangeError);
    }
    expect(()=>validateProfile({azStepDeg:NaN,elDeg:new Float32Array([0])})).toThrow(RangeError);
    expect(()=>horizonElevationAt(FLAT_HORIZON,NaN)).toThrow(RangeError);
  });
  it('rejects invalid solar-disk inputs',()=>{
    for(const radius of [0,-1,NaN,Infinity]) expect(()=>sunDiskFractionVisible(0,radius,0)).toThrow(RangeError);
    expect(()=>sunDiskFractionVisible(NaN,0.25,0)).toThrow(RangeError);
  });
  it('rejects nonadvancing/unbounded event searches before their loops',()=>{
    const start=Date.UTC(2027,0,1);
    for(const step of [0,-1,NaN,Infinity,Number.MIN_VALUE])
      expect(()=>nextEvent(site,FLAT_HORIZON,thresholds,start,'sunset',1,step)).toThrow(RangeError);
    for(const days of [0,-1,NaN,Infinity,Number.MIN_VALUE])
      expect(()=>nextEvent(site,FLAT_HORIZON,thresholds,start,'sunset',days)).toThrow(RangeError);
    expect(()=>nextEvent(site,FLAT_HORIZON,thresholds,start,'sunset',365,1)).toThrow(RangeError);
    expect(()=>nextEvent(site,FLAT_HORIZON,thresholds,MAX_TIME_MS-HOUR,'sunset',1)).toThrow(RangeError);
    expect(()=>nextEvent(site,FLAT_HORIZON,thresholds,start,'wrong' as EventKind,1)).toThrow(RangeError);
    // A step can initially advance, then stop advancing across a floating-point
    // spacing boundary. The loop must recheck progress rather than hang.
    expect(()=>nextEvent(site,FLAT_HORIZON,thresholds,2**41-0.0005,'earthrise',0.01/86400000,0.00000015)).toThrow(RangeError);
  });
});
