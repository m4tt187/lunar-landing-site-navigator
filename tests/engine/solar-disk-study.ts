// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with OpenAI Codex under the direction of the team.
// Reproduce: node --import tsx tests/engine/solar-disk-study.ts [startUTC] [days] [stepS] [siteId]
// Independent numerical study, not a replacement runtime model or NASA data.
import { readFileSync } from 'node:fs';
import { moonFixedVectors, sampleFromVectors, horizonElevationAt, sunDiskFractionVisible } from '../../engine/src/index.ts';
import type { Site } from '../../engine/src/index.ts';

interface CatalogSite extends Site {
  terrain: null | {groundHeightM:number; azStepDeg:number; profiles:Record<string,number[]>};
}
const catalog = JSON.parse(readFileSync(new URL('../../web/public/data/sites.json',import.meta.url),'utf8')) as {sites:CatalogSite[]};
const sites = catalog.sites.filter(s=>s.terrain && s.latDeg<=-80 && (!process.argv[5] || s.id===process.argv[5]));
const start = Date.parse(process.argv[2] ?? '2027-01-01T00:00:00Z');
const days = Number(process.argv[3] ?? 365), stepS = Number(process.argv[4] ?? 3600);
const n = days*86400/stepS, stepMs = stepS*1000;
if (!Number.isFinite(start) || !Number.isInteger(n) || n<1 || n>200000 || !(stepS>0) || !sites.length)
  throw new RangeError('Study requires known sites and a finite span with 1–200000 equally spaced samples.');
const vectors = Array.from({length:n},(_,i)=>moonFixedVectors(start+(i+0.5)*stepMs));
const rules = [0,0.5,1];
const durationsH = [14*24,29.53*24,90*24,365*24].filter(hours=>hours<=days*24);
function quadrature(slices:number) {
  const points=Array.from({length:slices},(_,i)=>{const x=-1+2*(i+0.5)/slices;return {x,y:Math.sqrt(1-x*x)};});
  return {points,area:points.reduce((sum,p)=>sum+2*p.y,0)};
}
function scan(site:CatalogSite,slices:number) {
  const terrain=site.terrain!;
  const profile={azStepDeg:terrain.azStepDeg,elDeg:Float32Array.from(terrain.profiles['2']!)};
  const {points,area}=quadrature(slices);
  const observer={...site,heightM:terrain.groundHeightM+2};
  const baselineCounts=[0,0,0],integratedCounts=[0,0,0];
  const differences=rules.map(()=>new Int32Array(n+1));
  let meanBaseline=0,meanIntegrated=0,maxInstantDifference=0;
  const minH=Math.min(...profile.elDeg),maxH=Math.max(...profile.elDeg);
  for(let i=0;i<n;i++) {
    const sun=sampleFromVectors(observer,start+(i+0.5)*stepMs,vectors[i]!).sun;
    const radius=sun.angularRadiusDeg;
    const baseline=sunDiskFractionVisible(sun.elDeg,radius,horizonElevationAt(profile,sun.azDeg));
    let fraction=0;
    if(sun.elDeg-radius>=maxH) fraction=1;
    else if(sun.elDeg+radius>minH) {
      let total=0;
      const width=radius/Math.cos(sun.elDeg*Math.PI/180);
      for(const p of points) {
        const skyline=(horizonElevationAt(profile,sun.azDeg+p.x*width)-sun.elDeg)/radius;
        total+=Math.max(0,Math.min(2*p.y,p.y-skyline));
      }
      fraction=total/area;
    }
    for(let k=0;k<rules.length;k++) {
      const threshold=rules[k]!;
      const before=Number(threshold===0?baseline>0:baseline>=threshold-1e-12);
      const after=Number(threshold===0?fraction>1e-12:fraction>=threshold-1e-12);
      baselineCounts[k]!+=before; integratedCounts[k]!+=after;
      differences[k]![i+1]=differences[k]![i]!+after-before;
    }
    meanBaseline+=baseline;meanIntegrated+=fraction;
    maxInstantDifference=Math.max(maxInstantDifference,Math.abs(fraction-baseline));
  }
  const rolling=durationsH.map(hours=>({hours,rules:rules.map((threshold,k)=>{
    const prefix=differences[k]!;let maxAbsolutePp=0,startHour=0,signedPp=0;
    const count=hours*3600/stepS,whole=Math.floor(count),fraction=count-whole;
    for(let i=0;i+Math.ceil(count)<=n;i++) {
      const weighted=prefix[i+whole]!-prefix[i]!+(fraction>0?fraction*(prefix[i+whole+1]!-prefix[i+whole]!):0);
      const delta=100*weighted/count;
      if(Math.abs(delta)>maxAbsolutePp) {maxAbsolutePp=Math.abs(delta);startHour=i*stepS/3600;signedPp=delta;}
    }
    return {threshold,maxAbsolutePp,signedPp,windowStartUtc:new Date(start+startHour*3600000).toISOString()};
  })}));
  return {id:site.id,latDeg:site.latDeg,lonDeg:site.lonDeg,slices,samples:n,
    baselinePercent:baselineCounts.map(x=>100*x/n),integratedPercent:integratedCounts.map(x=>100*x/n),
    deltaPercentagePoints:integratedCounts.map((x,k)=>100*(x-baselineCounts[k]!)/n),
    meanFractionDelta:(meanIntegrated-meanBaseline)/n,maxInstantFractionDifference:maxInstantDifference,rolling};
}
const results=sites.map(s=>scan(s,64));
results.sort((a,b)=>Math.max(...b.rolling.flatMap(x=>x.rules.map(r=>r.maxAbsolutePp)))-Math.max(...a.rolling.flatMap(x=>x.rules.map(r=>r.maxAbsolutePp))));
const convergence=results.slice(0,3).map(result=>scan(sites.find(s=>s.id===result.id)!,256));
const analyticChecks=[64,256,1024].map(slices=>{
  const {points,area}=quadrature(slices);let maxAbsoluteError=0;
  for(const slope of [0,0.5,2,10]) for(const intercept of [-2,-0.5,0,0.5,2]) {
    const integrated=points.reduce((sum,p)=>sum+Math.max(0,Math.min(2*p.y,p.y-(slope*p.x+intercept))),0)/area;
    const exact=sunDiskFractionVisible(0,1,intercept/Math.sqrt(1+slope*slope));
    maxAbsoluteError=Math.max(maxAbsoluteError,Math.abs(integrated-exact));
  }
  return {slices,maxAbsoluteError};
});
console.log(JSON.stringify({
  spdxLicenseIdentifier:'Apache-2.0',aiAssistance:'Study code and derived report prepared with OpenAI Codex under team direction.',
  source:'web/public/data/sites.json, NASA LOLA-derived 120 m catalogue skylines; Astronomy Engine positions.',
  startUtc:new Date(start).toISOString(),days,stepS,
  method:'Uniform midpoint time samples; 2 m observer; circular disk integrated in the local angular plane with azimuth width radius/cos(elevation); equal-x slices normalized by their full disk area; not a spherical solid-angle integration.',
  rules,durationsH,analyticChecks,results,convergence,
  limitations:'Selected catalogue sites and year only; coarse time sampling can miss short events. Instantaneous disk errors may be larger than annual/mission time-fraction errors. Terrain profile discretization is unchanged.',
},null,2));
