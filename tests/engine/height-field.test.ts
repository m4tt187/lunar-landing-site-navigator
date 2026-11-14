// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with OpenAI Codex under the direction of the team.
import {describe,expect,it} from 'vitest';
import {computeTerrainHorizon,makePolarDem,polarDemField} from '../../engine/src/index.ts';
import type {HeightField} from '../../engine/src/index.ts';

const radiusM=1737400;
const n=241;
const grid=makePolarDem(Int16Array.from({length:n*n},(_,i)=>Math.round(200*Math.sin((i%n)/9)+120*Math.cos(Math.floor(i/n)/13))),n,2000,1);

describe('composable terrain fields',()=>{
  it.each([[-90,0],[-89.999999,180],[-89.999999,-180],[-85,37]])('matches the direct polar grid at %s, %s',(lat,lon)=>{
    const direct=computeTerrainHorizon(grid,lat,lon,10,{azStepDeg:10,maxDistanceKm:60});
    const wrapped=computeTerrainHorizon(polarDemField(grid),lat,lon,10,{azStepDeg:10,maxDistanceKm:60});
    expect(wrapped.groundHeightM).toBe(direct.groundHeightM);
    expect(wrapped.truncated).toBe(direct.truncated);
    for(let i=0;i<direct.profile.elDeg.length;i++) {
      expect(wrapped.profile.elDeg[i]).toBeCloseTo(direct.profile.elDeg[i]!,6);
      expect(wrapped.distanceKm[i]).toBeCloseTo(direct.distanceKm[i]!,6);
    }
  });
  it('supports a global sampler across the longitude seam and both hemispheres',()=>{
    const seen:number[]=[];
    const flat:HeightField={resolutionM:100,maxHeightM:0,heightAt(lat,lon){
      expect(lat).toBeGreaterThanOrEqual(-90);expect(lat).toBeLessThanOrEqual(90);
      expect(lon).toBeGreaterThanOrEqual(-180);expect(lon).toBeLessThanOrEqual(180);
      seen.push(lon);return this.maxHeightM;
    }};
    const expected=-Math.acos(radiusM/(radiusM+2))*180/Math.PI;
    for(const lat of [45,-45]) {
      const h=computeTerrainHorizon(flat,lat,179.999,2,{azStepDeg:45,maxDistanceKm:20});
      expect(h.truncated).toBe(false);
      for(const angle of h.profile.elDeg)expect(angle).toBeCloseTo(expected,4);
    }
    expect(seen.some(lon=>lon<0)).toBe(true);expect(seen.some(lon=>lon>0)).toBe(true);
  });
  it('marks unknown ray coverage and rejects an unknown observer location',()=>{
    const holes:HeightField={resolutionM:100,maxHeightM:0,heightAt:lat=>lat< -89.9995?0:NaN};
    expect(computeTerrainHorizon(holes,-90,0,2,{azStepDeg:90}).truncated).toBe(true);
    expect(()=>computeTerrainHorizon(holes,-89,0,2)).toThrow(RangeError);
  });
  it('supports a fine patch with a coarse fallback without treating the seam as unknown',()=>{
    let fineReads=0,coarseReads=0;
    const composite:HeightField={resolutionM:120,maxHeightM:0,heightAt(lat){
      if(lat< -89.98)fineReads++;else coarseReads++;
      return 0;
    }};
    const result=computeTerrainHorizon(composite,-90,0,2,{azStepDeg:90});
    expect(result.truncated).toBe(false);
    expect(fineReads).toBeGreaterThan(0);expect(coarseReads).toBeGreaterThan(0);
  });
  it('preserves unknown-edge behavior through the polar adapter',()=>{
    const small=makePolarDem(new Int16Array(16),4,100,1);
    const direct=computeTerrainHorizon(small,-90,0,2,{azStepDeg:90});
    const wrapped=computeTerrainHorizon(polarDemField(small),-90,0,2,{azStepDeg:90});
    expect(wrapped.truncated).toBe(true);expect(wrapped).toEqual(direct);
  });
});

describe('field input contract',()=>{
  const flat:HeightField={resolutionM:100,maxHeightM:0,heightAt:()=>0};
  it.each([0,-1,NaN,Infinity])('rejects invalid resolution %s',(resolutionM)=>{
    expect(()=>computeTerrainHorizon({...flat,resolutionM},-90,0,2)).toThrow(RangeError);
  });
  it.each([NaN,Infinity,-radiusM])('rejects invalid maximum %s',(maxHeightM)=>{
    expect(()=>computeTerrainHorizon({...flat,maxHeightM},-90,0,2)).toThrow(RangeError);
  });
  it('rejects a missing sampler, invalid coordinates and invalid known heights',()=>{
    expect(()=>computeTerrainHorizon({...flat,heightAt:undefined} as unknown as HeightField,-90,0,2)).toThrow(RangeError);
    expect(()=>computeTerrainHorizon(flat,NaN,0,2)).toThrow(RangeError);
    expect(()=>computeTerrainHorizon(flat,-90,181,2)).toThrow(RangeError);
    for(const height of [Infinity,-radiusM,1])
      expect(()=>computeTerrainHorizon({...flat,heightAt:()=>height},-90,0,2)).toThrow(RangeError);
  });
  it('rejects invalid heights encountered after the known observer location',()=>{
    for(const height of [Infinity,-radiusM,1]) {
      const field={...flat,heightAt:(lat:number)=>lat===-90?0:height};
      expect(()=>computeTerrainHorizon(field,-90,0,2,{azStepDeg:90})).toThrow(RangeError);
    }
  });
  it('propagates provider failures rather than substituting invented terrain',()=>{
    const failure=new Error('Terrain provider unavailable.');
    expect(()=>computeTerrainHorizon({...flat,heightAt:()=>{throw failure;}},-90,0,2)).toThrow(failure);
  });
});
