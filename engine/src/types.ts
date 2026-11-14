// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with OpenAI Codex under the direction of the team.

export interface Site { id: string; name: string; latDeg: number; lonDeg: number; heightM: number }
export interface BodySample { azDeg: number; elDeg: number; angularRadiusDeg: number; rangeKm: number }
export interface Sample { tMs: number; sun: BodySample; earth: BodySample }
export interface Series {
  site: Site; startMs: number; endMs: number; stepS: number; n: number;
  /** Includes the exact end instant; the last interval may be shorter than stepS. */
  timesMs: Float64Array;
  sunAz: Float64Array; sunEl: Float64Array; sunRadius: Float64Array;
  earthAz: Float64Array; earthEl: Float64Array; earthRadius: Float64Array;
}
export interface HorizonProfile { azStepDeg: number; elDeg: Float32Array }
export interface Thresholds { sunMinDiskFraction: number; earthMinElevationAboveHorizonDeg: number }
export interface Interval { startMs: number; endMs: number }
export interface Summary {
  sunlitFraction: number; meanSunDiskFraction: number; maxSunElDeg: number;
  sunWindows: Interval[]; longestSunlitH: number; longestDarkH: number;
  earthVisibleFraction: number; earthWindows: Interval[]; longestCommGapH: number;
  bothFraction: number; bothWindows: Interval[];
}
