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

describe('absolute observer height for near and far terrain',()=>{
  it('uses an explicit zero absolute height and completely replaces the mast contribution',()=>{
    const field:HeightField={resolutionM:120,maxHeightM:-2,heightAt:()=>-2};
    const options={originHeightM:0,azStepDeg:90};
    const result=computeTerrainHorizon(field,-90,0,0,options);
    expect(computeTerrainHorizon(field,-90,0,20000,options)).toEqual(result);
    const expected=-Math.acos((radiusM-2)/radiusM)*180/Math.PI;
    for(const angle of result.profile.elDeg)expect(angle).toBeCloseTo(expected,4);
  });
  it('preserves direct/adapter parity and the default ground-plus-mast position',()=>{
    const options={azStepDeg:30,maxDistanceKm:60};
    const original=computeTerrainHorizon(grid,-89,12,2,options);
    const absolute={...options,originHeightM:original.groundHeightM+2};
    expect(computeTerrainHorizon(grid,-89,12,2,absolute)).toEqual(original);
    expect(computeTerrainHorizon(polarDemField(grid),-89,12,2,absolute)).toEqual(original);
  });
  it('combines near and far skylines from the same eye position, including a distant mountain',()=>{
    const eyeHeight=102;
    // A wide distant ridge subtends a constant 0.4 deg. This analytic fixture
    // isolates origin consistency from different distance-sampling grids.
    const heightAt=(lat:number)=>{
      const g=(90+lat)*Math.PI/180,d=g*radiusM;
      return d>=45000 && d<=75000
        ? (radiusM+eyeHeight)/(Math.cos(g)-Math.tan(0.4*Math.PI/180)*Math.sin(g))-radiusM : 100;
    };
    const fine:HeightField={heightAt,resolutionM:120,maxHeightM:3000};
    // Coarse interpolation disagrees at the origin; far terrain is unchanged.
    const coarse:HeightField={...fine,resolutionM:480,heightAt:lat=>lat===-90?850:heightAt(lat)};
    const options={azStepDeg:45,maxDistanceKm:100};
    const whole=computeTerrainHorizon(fine,-90,0,2,options);
    const near=computeTerrainHorizon(fine,-90,0,2,{...options,maxDistanceKm:30});
    const far=computeTerrainHorizon(coarse,-90,0,2,{...options,firstStepM:30000,originHeightM:eyeHeight});
    const wrongOrigin=computeTerrainHorizon(coarse,-90,0,2,{...options,firstStepM:30000});
    expect(far.groundHeightM).toBe(850);
    for(let i=0;i<whole.profile.elDeg.length;i++) {
      expect(Math.max(near.profile.elDeg[i]!,far.profile.elDeg[i]!)).toBeCloseTo(whole.profile.elDeg[i]!,6);
      expect(far.profile.elDeg[i]).toBeCloseTo(0.4,6);
      expect(wrongOrigin.profile.elDeg[i]).toBeLessThan(0);
    }
  });
  it('accepts a negative reference-sphere height without treating it as mast height',()=>{
    const field:HeightField={resolutionM:120,maxHeightM:-1000,heightAt:()=>-1000};
    const result=computeTerrainHorizon(field,-90,0,2,{originHeightM:-998,azStepDeg:90});
    const expected=-Math.acos((radiusM-1000)/(radiusM-998))*180/Math.PI;
    for(const angle of result.profile.elDeg)expect(angle).toBeCloseTo(expected,4);
  });
  it.each([NaN,Infinity,-Infinity,-radiusM,-radiusM-1])('rejects invalid absolute eye height %s',originHeightM=>{
    const field:HeightField={resolutionM:120,maxHeightM:0,heightAt:()=>0};
    expect(()=>computeTerrainHorizon(field,-90,0,2,{originHeightM})).toThrow(RangeError);
  });
  it('still requires known ground and a valid mast argument when absolute eye height is supplied',()=>{
    const field:HeightField={resolutionM:120,maxHeightM:0,heightAt:()=>NaN};
    expect(()=>computeTerrainHorizon(field,-90,0,2,{originHeightM:2})).toThrow(RangeError);
    expect(()=>computeTerrainHorizon(grid,-90,0,NaN,{originHeightM:2})).toThrow(RangeError);
  });
});

describe('distance ranges on one terrain sampling lattice',()=>{
  const ridgeHeight=(lat:number,lon:number)=>{
    const distance=(90+lat)*Math.PI/180*radiusM;
    const centre=lon<0?16000:45000;
    return 2000*Math.max(0,1-Math.abs(distance-centre)/1000);
  };
  const field:HeightField={resolutionM:480,maxHeightM:2000,heightAt:ridgeHeight};
  it('keeps narrow distant ridges that a 30 km increment would miss',()=>{
    const options={azStepDeg:90,maxDistanceKm:100,originHeightM:2};
    const sparse=computeTerrainHorizon(field,-90,0,2,{...options,firstStepM:30000});
    const far=computeTerrainHorizon(field,-90,0,2,{...options,minDistanceM:30000});
    expect(sparse.profile.elDeg[0]).toBeLessThan(0);
    expect(far.profile.elDeg[0]).toBeGreaterThan(1);
    expect(far.distanceKm[0]).toBeGreaterThan(44);
    expect(far.distanceKm[0]).toBeLessThan(46);
  });
  it.each([60,240])('exactly partitions a single march at %s m initial spacing, preserving angles and distances',firstStepM=>{
    const options={azStepDeg:45,maxDistanceKm:120,firstStepM,originHeightM:2};
    const whole=computeTerrainHorizon(field,-90,0,2,options);
    const near=computeTerrainHorizon({...field,resolutionM:120},-90,0,2,{...options,maxDistanceKm:30});
    const sampledDistances:number[]=[];
    const farField={...field,heightAt(lat:number,lon:number){
      const distance=(90+lat)*Math.PI/180*radiusM;
      if(distance>0)sampledDistances.push(distance);
      return ridgeHeight(lat,lon);
    }};
    const far=computeTerrainHorizon(farField,-90,0,2,{...options,minDistanceM:30000});
    for(let i=0;i<whole.profile.elDeg.length;i++) {
      const winner=near.profile.elDeg[i]!>=far.profile.elDeg[i]!?near:far;
      expect(winner.profile.elDeg[i]).toBe(whole.profile.elDeg[i]);
      expect(winner.distanceKm[i]).toBe(whole.distanceKm[i]);
    }
    expect(sampledDistances.length).toBeGreaterThan(0);
    expect(Math.min(...sampledDistances)).toBeGreaterThanOrEqual(30000-1e-6);
  });
  it('retains the full-distance result for an omitted or zero minimum',()=>{
    const options={azStepDeg:90,maxDistanceKm:60};
    expect(computeTerrainHorizon(field,-90,0,2,{...options,minDistanceM:0}))
      .toEqual(computeTerrainHorizon(field,-90,0,2,options));
  });
  it.each([-1,NaN,Infinity,100001])('rejects invalid minimum distance %s',minDistanceM=>{
    expect(()=>computeTerrainHorizon(field,-90,0,2,{minDistanceM,maxDistanceKm:100})).toThrow(RangeError);
  });
  it('rejects an empty sampling range instead of presenting an unsampled empty skyline',()=>{
    expect(()=>computeTerrainHorizon(field,-90,0,2,{firstStepM:240,minDistanceM:999,maxDistanceKm:1})).toThrow(/no terrain samples/);
  });
});
