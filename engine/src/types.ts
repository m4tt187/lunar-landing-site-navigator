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
/** A stretch during which the Earth covers part of the Sun as seen from a site (the terrain is not considered). */
export interface EclipseEvent {
  /** First and last instants with some of the Sun covered (clipped to the span searched). */
  startMs: number; endMs: number;
  /** Instant at which the two centres are closest, and the fraction of the solar disc covered then. */
  maxAtMs: number; maxCoveredFraction: number;
  /** Span during which the whole Sun is covered, or null when it never is. */
  totalStartMs: number | null; totalEndMs: number | null;
}
export interface Summary {
  sunlitFraction: number; meanSunDiskFraction: number; maxSunElDeg: number;
  sunWindows: Interval[]; longestSunlitH: number; longestDarkH: number;
  earthVisibleFraction: number; earthWindows: Interval[]; longestCommGapH: number;
  bothFraction: number; bothWindows: Interval[];
  /** Eclipses of the Sun by the Earth during the span, from the samples; their darkness is already counted in the sunlight windows. */
  eclipses: EclipseEvent[];
}
