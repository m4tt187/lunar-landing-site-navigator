// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
import { horizonElevationAt } from '@engine/index';
import type { Interval } from '@engine/index';
import type { Analysis, Calendar, Instant } from './compute';
import { fmtDate } from './format';
import { DAY, HOUR } from './state';

const SUN = '#ffbf47', EARTH = '#58a6ff', BOTH = '#6fdc8c';

/** Azimuth shown from -180 (south) through 0 (north, centre) to +180 (south). */
const wrap = (az: number): number => ((((az + 180) % 360) + 360) % 360) - 180;

/** Panorama of the skyline with the paths of the Sun and the Earth. */
export function SkyView({ a, instant }: { a: Analysis; instant: Instant }) {
  const W = 720, H = 250, L = 34, R = 8, T = 10, B = 24;
  const profile = a.terrain.profile;
  const { series, margins } = a;
  let lo = 0, hi = 0;
  for (let i = 0; i < profile.elDeg.length; i++) { lo = Math.min(lo, profile.elDeg[i]!); hi = Math.max(hi, profile.elDeg[i]!); }
  let bodyHi = -90, bodyLo = 90;
  for (let i = 0; i < series.n; i++) {
    bodyHi = Math.max(bodyHi, series.sunEl[i]!, series.earthEl[i]!);
    bodyLo = Math.min(bodyLo, series.sunEl[i]!, series.earthEl[i]!);
  }
  hi = Math.max(hi, bodyHi, 1) + 1.5;
  lo = Math.max(Math.min(lo, bodyLo, -1) - 1, hi - 100, -12);
  const x = (az: number): number => L + ((wrap(az) + 180) / 360) * (W - L - R);
  const y = (el: number): number => T + ((hi - el) / (hi - lo)) * (H - T - B);
  const pxPerDegX = (W - L - R) / 360, pxPerDegY = (H - T - B) / (hi - lo);

  let skyline = `M${L},${H - B}`;
  for (let px = 0; px <= W - L - R; px += 1) {
    const az = (px / (W - L - R)) * 360 - 180;
    skyline += `L${(L + px).toFixed(1)},${y(horizonElevationAt(profile, az)).toFixed(1)}`;
  }
  skyline += `L${W - R},${H - B}Z`;

  const path = (azs: Float64Array, els: Float64Array, margin: Float64Array, visible: boolean): string => {
    let d = '', pen = false;
    for (let i = 0; i < series.n; i++) {
      const on = margin[i]! > 0 === visible;
      const jump = i > 0 && Math.abs(wrap(azs[i]!) - wrap(azs[i - 1]!)) > 180;
      if (!on) { pen = false; continue; }
      d += `${pen && !jump ? 'L' : 'M'}${x(azs[i]!).toFixed(1)},${y(els[i]!).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const span = hi - lo;
  const tick = span > 60 ? 20 : span > 25 ? 10 : span > 12 ? 5 : span > 5 ? 2 : 1;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / tick) * tick; v <= hi; v += tick) ticks.push(v);
  const disc = (az: number, el: number, radius: number, color: string, up: boolean) => (
    <g>
      <ellipse cx={x(az)} cy={y(el)} rx={Math.max(4, radius * pxPerDegX)} ry={Math.max(4, radius * pxPerDegY)}
        fill={color} fill-opacity={up ? 1 : 0.25} stroke={color} stroke-width="1.5" />
      <circle cx={x(az)} cy={y(el)} r="11" fill="none" stroke={color} stroke-opacity="0.5" stroke-dasharray="2 3" />
    </g>
  );
  const clip = `sky-${a.scenario.id}`;
  return (
    <svg class="sky" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Skyline panorama at ${a.name} with the paths of the Sun and the Earth`}>
      <defs><clipPath id={clip}><rect x={L} y={T} width={W - L - R} height={H - T - B} /></clipPath></defs>
      <rect x={L} y={T} width={W - L - R} height={H - T - B} class="sky-bg" />
      {ticks.map((v) => (
        <g>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} class={v === 0 ? 'grid zero' : 'grid'} />
          <text x={L - 5} y={y(v) + 3.5} class="axis" text-anchor="end">{v}°</text>
        </g>
      ))}
      {[-180, -90, 0, 90, 180].map((az, i) => (
        <text x={x(az === 180 ? 179.999 : az)} y={H - 7} class="axis" text-anchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}>
          {['S', 'W', 'N', 'E', 'S'][i]}
        </text>
      ))}
      <g clip-path={`url(#${clip})`}>
        <path d={path(series.sunAz, series.sunEl, margins.sun, false)} class="trace" stroke={SUN} stroke-opacity="0.28" />
        <path d={path(series.earthAz, series.earthEl, margins.earth, false)} class="trace" stroke={EARTH} stroke-opacity="0.28" />
        <path d={skyline} class="terrain" />
        <path d={path(series.sunAz, series.sunEl, margins.sun, true)} class="trace" stroke={SUN} />
        <path d={path(series.earthAz, series.earthEl, margins.earth, true)} class="trace" stroke={EARTH} />
        {disc(instant.sample.earth.azDeg, instant.sample.earth.elDeg, instant.sample.earth.angularRadiusDeg, EARTH, instant.margins.earthDeg > 0)}
        {disc(instant.sample.sun.azDeg, instant.sample.sun.elDeg, instant.sample.sun.angularRadiusDeg, SUN, instant.margins.sunDeg > 0)}
      </g>
    </svg>
  );
}

/** Sunlight, Earth-visibility and combined windows over the mission span. */
export function Timeline({ a, cursorH, onCursor }: { a: Analysis; cursorH: number; onCursor: (hours: number) => void }) {
  const W = 720, H = 86, L = 58, R = 8, rowH = 16, top = 6;
  const { startMs, endMs } = a.series;
  const x = (ms: number): number => L + ((ms - startMs) / (endMs - startMs)) * (W - L - R);
  const days = (endMs - startMs) / DAY;
  const tickDays = days > 200 ? 30 : days > 60 ? 10 : days > 20 ? 5 : 2;
  const ticks: number[] = [];
  for (let d = 0; d <= days + 1e-6; d += tickDays) ticks.push(d);
  const row = (windows: Interval[], index: number, color: string, label: string) => (
    <g>
      <text x={L - 6} y={top + index * (rowH + 4) + rowH - 4} class="axis" text-anchor="end">{label}</text>
      <rect x={L} y={top + index * (rowH + 4)} width={W - L - R} height={rowH} class="bar-bg" />
      {windows.map((w) => (
        <rect x={x(w.startMs)} y={top + index * (rowH + 4)} width={Math.max(0.6, x(w.endMs) - x(w.startMs))} height={rowH} fill={color} />
      ))}
    </g>
  );
  const pick = (event: PointerEvent): void => {
    const svg = event.currentTarget as SVGSVGElement;
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    const f = Math.min(1, Math.max(0, (px - L) / (W - L - R)));
    onCursor((f * (endMs - startMs)) / HOUR);
  };
  const cx = x(startMs + cursorH * HOUR);
  return (
    <svg class="timeline" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sunlight and Earth-visibility windows"
      onPointerDown={(e) => { (e.currentTarget as Element).setPointerCapture(e.pointerId); pick(e); }}
      onPointerMove={(e) => { if (e.buttons & 1) pick(e); }}>
      {row(a.summary.sunWindows, 0, SUN, 'Sun')}
      {row(a.summary.earthWindows, 1, EARTH, 'Earth')}
      {row(a.summary.bothWindows, 2, BOTH, 'Both')}
      {ticks.map((d) => (
        <g>
          <line x1={x(startMs + d * DAY)} x2={x(startMs + d * DAY)} y1={top} y2={top + 3 * (rowH + 4) - 4} class="grid" />
          <text x={x(startMs + d * DAY)} y={H - 4} class="axis" text-anchor="middle">{d === 0 ? 'landing' : `+${d} d`}</text>
        </g>
      ))}
      <line x1={cx} x2={cx} y1={0} y2={top + 3 * (rowH + 4)} class="cursor" />
    </svg>
  );
}

/** One year of possible landing dates: how the mission span would fare for each. */
export function LandingCalendar({ calendar, currentMs, onPick }: { calendar: Calendar; currentMs: number; onPick: (ms: number) => void }) {
  const W = 720, L = 58, R = 8, rowH = 18, top = 4, H = 96;
  const perDay = DAY / calendar.stepMs;
  const daysTotal = Math.floor(calendar.sun.length / perDay);
  const cellW = (W - L - R) / daysTotal;
  const rows: [Float32Array, string, string][] = [[calendar.sun, SUN, 'Sun'], [calendar.earth, EARTH, 'Earth'], [calendar.both, BOTH, 'Both']];
  const months: { x: number; label: string }[] = [];
  for (let d = 0; d < daysTotal; d++) {
    const date = new Date(calendar.startMs + d * DAY);
    if (date.getUTCDate() === 1) months.push({ x: L + d * cellW, label: date.toLocaleString('en', { month: 'short', timeZone: 'UTC' }) + (date.getUTCMonth() === 0 ? ` ${date.getUTCFullYear()}` : '') });
  }
  const currentX = L + ((currentMs - calendar.startMs) / DAY) * cellW;
  return (
    <svg class="calendar" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Landing calendar"
      onClick={(event) => {
        const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
        const px = ((event.clientX - box.left) / box.width) * W;
        const day = Math.floor((px - L) / cellW);
        if (day >= 0 && day < daysTotal) onPick(calendar.startMs + day * DAY);
      }}>
      {rows.map(([values, color, label], r) => (
        <g>
          <text x={L - 6} y={top + r * (rowH + 3) + rowH - 5} class="axis" text-anchor="end">{label}</text>
          <rect x={L} y={top + r * (rowH + 3)} width={W - L - R} height={rowH} class="bar-bg" />
          {Array.from({ length: daysTotal }, (_, d) => {
            const v = values[Math.round(d * perDay)]!;
            return v > 0.005 ? <rect x={L + d * cellW} y={top + r * (rowH + 3)} width={cellW + 0.3} height={rowH} fill={color} fill-opacity={0.12 + 0.88 * v}><title>{`${fmtDate(calendar.startMs + d * DAY)}: ${Math.round(v * 100)}%`}</title></rect> : null;
          })}
        </g>
      ))}
      {months.map((m) => (
        <g>
          <line x1={m.x} x2={m.x} y1={top} y2={top + 3 * (rowH + 3)} class="grid" />
          <text x={m.x + 2} y={H - 18} class="axis">{m.label}</text>
        </g>
      ))}
      {currentX >= L && currentX <= W - R ? (
        <g><line x1={currentX} x2={currentX} y1={0} y2={top + 3 * (rowH + 3)} class="cursor" /><text x={currentX} y={H - 4} class="axis strong" text-anchor="middle">selected landing</text></g>
      ) : null}
    </svg>
  );
}
