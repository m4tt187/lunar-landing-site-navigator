// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// Lists the eclipses of the Sun by the Earth seen from a point of the Moon
// (terrain not considered), next to NASA's lunar eclipse of the same date.
// Eclipse Predictions by Fred Espenak and Jean Meeus (NASA's GSFC).
//
// Usage: npx tsx tools/eclipses/list.ts [--lat -90] [--lon 0] [--from 2025-01-01] [--to 2031-01-01]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findEclipses } from '../../engine/src/eclipse.ts';

interface NasaEclipse { date: string; type: string; umbralMagnitude: number; penumbralMagnitude: number; contactsUt: Record<string, string> }

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
function value(name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
}
const latDeg = Number(value('lat', '-90')), lonDeg = Number(value('lon', '0'));
const fromMs = Date.parse(`${value('from', '2025-01-01')}T00:00:00Z`), toMs = Date.parse(`${value('to', '2031-01-01')}T00:00:00Z`);
if (![latDeg, lonDeg, fromMs, toMs].every(Number.isFinite)) throw new RangeError('Latitude, longitude and dates must be valid.');

const catalogue = JSON.parse(readFileSync(`${root}data/eclipses/nasa-lunar-eclipses.json`, 'utf8')) as { acknowledgment: string; eclipses: NasaEclipse[] };
const nasa = catalogue.eclipses;
const events = findEclipses({ id: 'point', name: 'Point', latDeg, lonDeg, heightM: 0 }, fromMs, toMs);
const clock = (ms: number): string => new Date(ms).toISOString().slice(11, 16);
function minutes(ms: number): string {
  const whole = Math.round(ms / 60000);
  return `${Math.floor(whole / 60)} h ${String(whole % 60).padStart(2, '0')} min`;
}

console.log(`Eclipses of the Sun by the Earth at latitude ${latDeg}, longitude ${lonDeg} (UTC; terrain not considered)\n`);
console.log('| Date | NASA lunar eclipse | Some of the Sun covered | Most covered | Whole Sun covered |');
console.log('|---|---|---|---|---|');
for (const e of events) {
  const match = nasa.find((n) => e.maxAtMs >= Date.parse(n.contactsUt.P1!) && e.maxAtMs <= Date.parse(n.contactsUt.P4!));
  const whole = e.totalStartMs === null ? 'no' : `${clock(e.totalStartMs)}–${clock(e.totalEndMs!)} (${minutes(e.totalEndMs! - e.totalStartMs)})`;
  console.log(`| ${new Date(e.maxAtMs).toISOString().slice(0, 10)} | ${match ? `${match.type}, umbral magnitude ${match.umbralMagnitude}` : 'outside the fixture'} | ` +
    `${clock(e.startMs)}–${clock(e.endMs)} (${minutes(e.endMs - e.startMs)}) | ${Math.round(e.maxCoveredFraction * 100)}% | ${whole} |`);
}
const seen = new Set(events.map((e) => nasa.find((n) => e.maxAtMs >= Date.parse(n.contactsUt.P1!) && e.maxAtMs <= Date.parse(n.contactsUt.P4!))?.date));
const unseen = nasa.filter((n) => Date.parse(n.contactsUt.P1!) >= fromMs && Date.parse(n.contactsUt.P4!) <= toMs && !seen.has(n.date));
if (unseen.length) console.log(`\nNot seen from this point: ${unseen.map((n) => `${n.date} (${n.type})`).join(', ')}.`);
console.log(`\nNASA lunar eclipses: ${catalogue.acknowledgment}.`);
