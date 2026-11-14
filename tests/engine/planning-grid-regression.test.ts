// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with OpenAI Codex under the direction of the team.
import {describe,expect,it} from 'vitest';
import {landingCalendar,recommend} from '../../engine/src/planning.ts';
import type {Candidate} from '../../engine/src/planning.ts';

const HOUR=3600000;
const earth=[{startMs:0,endMs:10*HOUR}];
const needs={missionDays:2/24,toleranceH:0};
const sunnyFromTwo=[{startMs:2*HOUR,endMs:10*HOUR}];

describe('the last landing inside a partial search interval',()=>{
  it('includes the valid last hour without extending the half-open search span',()=>{
    const result=landingCalendar(sunnyFromTwo,earth,sunnyFromTwo,0,10*HOUR,needs,{searchDays:2.5/24,gridS:3600});
    expect(result.cells).toBe(3);
    expect(result.best).toHaveLength(1);
    expect(result.best[0]!.landingMs).toBe(2*HOUR);
    expect(result.best[0]!.powerHours).toBe(8);
    expect(result.best[0]!.missionCoverage).toBe(1);
    expect(result.startMs+(result.cells-1)*result.stepMs).toBeLessThan(2.5*HOUR);
  });
  it('does not rank a half-mission candidate above the fully viable last-slot landing',()=>{
    const partial=[{startMs:0,endMs:HOUR}];
    const candidates:Candidate[]=[
      {id:'full',name:'Full mission',sunWindows:sunnyFromTwo,earthWindows:earth,bothWindows:sunnyFromTwo},
      {id:'partial',name:'Partial mission',sunWindows:partial,earthWindows:earth,bothWindows:partial},
    ];
    const ranked=recommend(candidates,0,10*HOUR,needs,{searchDays:2.5/24,gridS:3600});
    expect(ranked.map(row=>row.candidateId)).toEqual(['full','partial']);
    expect(ranked[0]!.missionCoverage).toBe(1);
    expect(ranked[1]!.missionCoverage).toBe(.5);
  });
  it.each([[2,3],[2.5,2],[3,2]])('samples every %s hours within a five-hour search, giving %s valid grid times', (gridHours,expectedCells)=>{
    const result=landingCalendar(earth,earth,earth,0,10*HOUR,needs,{searchDays:5/24,gridS:gridHours*3600});
    expect(result.cells).toBe(expectedCells);
    for(let i=0;i<result.cells;i++)expect(result.startMs+i*result.stepMs).toBeLessThan(5*HOUR);
    expect(result.startMs+result.cells*result.stepMs).toBeGreaterThanOrEqual(5*HOUR);
  });
  it('preserves the original count when the search is an exact grid multiple',()=>{
    expect(landingCalendar(earth,earth,earth,0,10*HOUR,needs,{searchDays:3/24,gridS:3600}).cells).toBe(3);
  });
  it('rejects cadence conversion overflow instead of silently erasing valid landing options',()=>{
    expect(()=>landingCalendar(earth,earth,earth,0,10*HOUR,needs,{searchDays:5/24,gridS:1e306})).toThrow(RangeError);
  });
});
