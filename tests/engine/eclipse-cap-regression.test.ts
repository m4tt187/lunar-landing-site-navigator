// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with OpenAI Codex under the direction of the team.
import {describe,expect,it} from 'vitest';
import {FLAT_HORIZON,marginsOf,sunDiskFractionVisible,sunVisible} from '../../engine/src/analysis.ts';
import {enlargedEarthRadiusDeg,sunDiskFractionVisibleWithEarth,sunFractionCoveredByEarth} from '../../engine/src/eclipse.ts';

describe('an eclipse confined to sunlight already hidden by terrain',()=>{
  const sunRadius=.2666;
  const thresholds={sunMinDiskFraction:.5,earthMinElevationAboveHorizonDeg:0};
  it.each([-1.1,-1.15,-1.2])('keeps the inclusive half-disc boundary when the Earth is at elevation %s',earthEl=>{
    const m=marginsOf(0,0,sunRadius,0,earthEl,FLAT_HORIZON,thresholds,undefined,1);
    expect(m.eclipseFraction).toBeGreaterThan(0);
    expect(m.sunDiskFraction).toBe(.5);
    expect(m.sunDeg).toBe(0);
    expect(sunVisible(m.sunDeg,thresholds)).toBe(true);
  });
  it.each([-1.05,1.05])('keeps an unaffected upper cap with the Earth displaced horizontally by %s',across=>{
    const horizon=.13,up=-.65,earthRadius=1;
    // The Earth intersects the solar disc and reaches above the skyline, yet
    // the two conditions overlap only outside the upper solar cap.
    expect(sunFractionCoveredByEarth(Math.hypot(across,up),sunRadius,earthRadius)).toBeGreaterThan(0);
    expect(up+enlargedEarthRadiusDeg(earthRadius)).toBeGreaterThan(horizon);
    expect(sunDiskFractionVisibleWithEarth(0,sunRadius,horizon,across,up,earthRadius))
      .toBe(sunDiskFractionVisible(0,sunRadius,horizon));
  });
  it('preserves tangency but detects a genuine intrusion into the visible cap',()=>{
    const b=enlargedEarthRadiusDeg(1);
    expect(sunDiskFractionVisibleWithEarth(0,sunRadius,0,0,-b,1)).toBe(.5);
    expect(sunDiskFractionVisibleWithEarth(0,sunRadius,0,0,-b+.001,1)).toBeLessThan(.5);
    expect(sunDiskFractionVisibleWithEarth(0,sunRadius,0,0,-b-.001,1)).toBe(.5);
  });
});
