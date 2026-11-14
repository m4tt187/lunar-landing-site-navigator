// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with OpenAI Codex under the direction of the team.
import { describe, expect, it } from 'vitest';
import { FLAT_HORIZON, earthVisible, sunVisible, summarize } from '../../engine/src/index.ts';
import type { Series, Thresholds } from '../../engine/src/index.ts';

const HOUR = 3600000;
const thresholds: Thresholds = {sunMinDiskFraction:0.5, earthMinElevationAboveHorizonDeg:0};
function series(timesH: number[], sun: number[], earth = sun.map(() => 1)): Series {
  const n = timesH.length;
  return {site:{id:'test',name:'Test site',latDeg:0,lonDeg:0,heightM:0}, n,
    startMs:timesH[0]!*HOUR, endMs:timesH[n-1]!*HOUR, stepS:3600,
    timesMs:Float64Array.from(timesH,x=>x*HOUR),sunAz:new Float64Array(n),earthAz:new Float64Array(n),
    sunEl:Float64Array.from(sun),earthEl:Float64Array.from(earth),
    sunRadius:new Float64Array(n).fill(0.25),earthRadius:new Float64Array(n).fill(1)};
}
describe('visibility threshold equality and time integration',()=>{
  it('shares the exact boundary predicates with API consumers',()=>{
    expect(sunVisible(0,{...thresholds,sunMinDiskFraction:0})).toBe(false);
    expect(sunVisible(Number.EPSILON,{...thresholds,sunMinDiskFraction:0})).toBe(true);
    for(const fraction of [0.25,0.5,1]) {
      expect(sunVisible(0,{...thresholds,sunMinDiskFraction:fraction})).toBe(true);
      expect(sunVisible(-Number.EPSILON,{...thresholds,sunMinDiskFraction:fraction})).toBe(false);
    }
    expect(earthVisible(0)).toBe(true); expect(earthVisible(-Number.EPSILON)).toBe(false);
    expect(()=>sunVisible(NaN,thresholds)).toThrow(RangeError);
    expect(()=>earthVisible(Infinity)).toThrow(RangeError);
  });
  it('counts full disk tangency as fully visible, but a hidden disk remains dark',()=>{
    const full=summarize(series([0,1],[0.25,0.25]),FLAT_HORIZON,{...thresholds,sunMinDiskFraction:1});
    expect(full.meanSunDiskFraction).toBe(1); expect(full.sunlitFraction).toBe(1); expect(full.longestDarkH).toBe(0);
    const hidden=summarize(series([0,1],[-0.25,-0.25]),FLAT_HORIZON,{...thresholds,sunMinDiskFraction:0});
    expect(hidden.meanSunDiskFraction).toBe(0); expect(hidden.sunlitFraction).toBe(0);
  });
  it('includes the exact half-disk plateau in the at-least-half rule',()=>{
    const result=summarize(series([0,1],[0,0]),FLAT_HORIZON,thresholds);
    expect(result.sunlitFraction).toBe(1); expect(result.meanSunDiskFraction).toBe(0.5);
  });
  it('includes Earth at exactly the specified margin',()=>{
    const result=summarize(series([0,1],[1,1],[2,2]),FLAT_HORIZON,{...thresholds,earthMinElevationAboveHorizonDeg:2});
    expect(result.earthVisibleFraction).toBe(1); expect(result.longestCommGapH).toBe(0);
  });
  it('includes Earth at the zero-margin boundary',()=>{
    const result=summarize(series([0,1],[1,1],[0,0]),FLAT_HORIZON,thresholds);
    expect(result.earthVisibleFraction).toBe(1); expect(result.bothFraction).toBe(1);
  });
  it('weights a shortened final interval and interpolates crossings',()=>{
    const result=summarize(series([0,1,1.5],[-1,1,-1],[1,-1,1]),FLAT_HORIZON,thresholds);
    expect(result.sunWindows).toEqual([{startMs:0.5*HOUR,endMs:1.25*HOUR}]);
    expect(result.sunlitFraction).toBeCloseTo(0.5,12);
    expect(result.longestSunlitH).toBeCloseTo(0.75,12); expect(result.longestDarkH).toBeCloseTo(0.5,12);
    expect(result.earthVisibleFraction).toBeCloseTo(0.5,12); expect(result.bothWindows).toEqual([]);
    expect(result.meanSunDiskFraction).toBeCloseTo(0.5,12);
  });
  it('clips an ongoing night and communication gap to the selected interval',()=>{
    const result=summarize(series([0,1,1.5],[-5,-5,-5],[-5,-5,-5]),FLAT_HORIZON,thresholds);
    expect(result.longestDarkH).toBe(1.5); expect(result.longestCommGapH).toBe(1.5); expect(result.bothFraction).toBe(0);
  });
});
