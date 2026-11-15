// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
const pad = (n: number): string => String(n).padStart(2, '0');

export function fmtUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export const toInputValue = (ms: number): string => new Date(ms).toISOString().slice(0, 16);
export const fromInputValue = (value: string): number => Date.parse(`${value}:00Z`);

/** Human-readable duration from hours: "3 d 4 h", "5 h 20 min", "12 min". */
export function fmtSpan(hours: number): string {
  if (!Number.isFinite(hours)) return '—';
  const minutes = Math.round(hours * 60);
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h ${pad(minutes % 60)} min`;
  const h = Math.round(hours);
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}
export const pct = (fraction: number): string => `${Math.round(fraction * 100)}%`;
export const deg = (value: number, digits = 1): string => `${value.toFixed(digits)}°`;

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (azDeg: number): string => COMPASS[Math.round((((azDeg % 360) + 360) % 360) / 22.5) % 16]!;

const MINOR = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs']);
const PARTICLES = new Set(['de', 'von', 'van']);
/** Title Case for names shown in the interface: "Shackleton crater (centre)" → "Shackleton Crater (Centre)". */
export function titleCase(text: string): string {
  return text.split(' ').map((word, i) => {
    const m = /^([("']*)([a-z])(.*)$/.exec(word);
    if (!m) return word;
    const bare = word.replace(/^[("']+/, '').replace(/[)"',.:]+$/, '');
    if (PARTICLES.has(bare) || (i > 0 && !m[1] && MINOR.has(bare))) return word;
    return m[1]! + m[2]!.toUpperCase() + m[3]!;
  }).join(' ');
}

export function fmtLatLon(latDeg: number, lonDeg: number): string {
  return `${Math.abs(latDeg).toFixed(3)}° ${latDeg < 0 ? 'S' : 'N'}, ${Math.abs(lonDeg).toFixed(3)}° ${lonDeg < 0 ? 'W' : 'E'}`;
}
