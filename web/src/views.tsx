// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
import { useMemo } from 'preact/hooks';
import { horizonElevationAt } from '@engine/index';
import type { HorizonProfile, Interval } from '@engine/index';
import { earthUp, sunUp } from './compute';
import type { Analysis, Calendar, Instant, LandingWindow } from './compute';
import { compass, fmtDate, fmtSpan, pct } from './format';
import { DAY, HOUR } from './state';

export const SUN = '#d97706', EARTH = '#2563eb', BOTH = '#16a34a';
const DEG = Math.PI / 180;

const wrap180 = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180;

/** Skyline of the nearer terrain, or the full skyline when the site has no ridge data. */
function ridge(a: Analysis, which: 'near' | 'mid'): HorizonProfile | null {
  const r = a.terrain.ridges;
  return r ? { azStepDeg: r.azStepDeg, elDeg: r[which] } : null;
}

interface Frame { x: (az: number) => number; y: (el: number) => number; centre: number; lo: number; hi: number }

/** Panorama of the skyline all around the site, with the paths of the Sun and the Earth over the mission. */
export function SkyView({ a, instant }: { a: Analysis; instant: Instant }) {
  const W = 720, H = 220, L = 30, R = 6, T = 8, B = 22;
  const stat = useMemo(() => {
    const profile = a.terrain.profile;
    const { series, margins } = a;
    let lo = 0, hi = 0;
    for (let i = 0; i < profile.elDeg.length; i++) { lo = Math.min(lo, profile.elDeg[i]!); hi = Math.max(hi, profile.elDeg[i]!); }
    let bodyHi = -90, bodyLo = 90, sx = 0, sy = 0;
    for (let i = 0; i < series.n; i++) {
      bodyHi = Math.max(bodyHi, series.sunEl[i]!, series.earthEl[i]!);
      bodyLo = Math.min(bodyLo, series.sunEl[i]!, series.earthEl[i]!);
      sx += Math.cos(series.earthAz[i]! * DEG); sy += Math.sin(series.earthAz[i]! * DEG);
    }
    hi = Math.max(hi, bodyHi, 1) + 1.5;
    lo = Math.max(Math.min(lo, bodyLo, -1) - 1, hi - 100, -12);
    // Centre the panorama on the compass point nearest to the Earth's mean direction.
    const centre = (((Math.round(Math.atan2(sy, sx) / DEG / 90) * 90) % 360) + 360) % 360;
    const frame: Frame = {
      centre, lo, hi,
      x: (az) => L + ((wrap180(az - centre) + 180) / 360) * (W - L - R),
      y: (el) => T + ((hi - el) / (hi - lo)) * (H - T - B),
    };
    const outline = (p: HorizonProfile): string => {
      let d = `M${L},${H - B}`;
      for (let px = 0; px <= W - L - R; px++) {
        const az = centre - 180 + (px / (W - L - R)) * 360;
        d += `L${L + px},${frame.y(horizonElevationAt(p, az)).toFixed(1)}`;
      }
      return `${d}L${W - R},${H - B}Z`;
    };
    const track = (azs: Float64Array, els: Float64Array, visible: (i: number) => boolean, wanted: boolean): string => {
      let d = '', pen = false;
      for (let i = 0; i < series.n; i++) {
        if (visible(i) !== wanted) { pen = false; continue; }
        const jump = i > 0 && Math.abs(wrap180(azs[i]! - centre) - wrap180(azs[i - 1]! - centre)) > 180;
        d += `${pen && !jump ? 'L' : 'M'}${frame.x(azs[i]!).toFixed(1)},${frame.y(els[i]!).toFixed(1)}`;
        pen = true;
      }
      return d;
    };
    const sunVisible = (i: number): boolean => sunUp(margins.sun[i]!, a.thresholds);
    const earthVisible = (i: number): boolean => earthUp(margins.earth[i]!);
    const span = hi - lo;
    const tick = span > 60 ? 20 : span > 25 ? 10 : span > 12 ? 5 : span > 5 ? 2 : 1;
    const ticks: number[] = [];
    for (let v = Math.ceil(lo / tick) * tick; v <= hi; v += tick) ticks.push(v);
    const near = ridge(a, 'near'), mid = ridge(a, 'mid');
    return {
      frame, ticks,
      far: outline(profile), mid: mid ? outline(mid) : null, near: near ? outline(near) : null,
      sunHidden: track(series.sunAz, series.sunEl, sunVisible, false), sunSeen: track(series.sunAz, series.sunEl, sunVisible, true),
      earthHidden: track(series.earthAz, series.earthEl, earthVisible, false), earthSeen: track(series.earthAz, series.earthEl, earthVisible, true),
    };
  }, [a]);
  const { frame } = stat;
  const id = `sky-${a.scenario.id}`;
  const marker = (az: number, el: number, body: 'sun' | 'earth', up: boolean, label: string) => {
    const cx = frame.x(az), cy = frame.y(el), color = body === 'sun' ? SUN : EARTH;
    return (
      <g>
        {up ? <circle cx={cx} cy={cy} r="11" fill={color} fill-opacity="0.12" stroke={color} stroke-opacity="0.45" /> : <circle cx={cx} cy={cy} r="11" fill="none" stroke={color} stroke-opacity="0.5" stroke-dasharray="2 3" />}
        <circle cx={cx} cy={cy} r="6" fill={`url(#${id}-${body})`} fill-opacity={up ? 1 : 0.35} stroke="#fff" stroke-width="1.5" />
        <text x={Math.min(W - R - 30, Math.max(L + 2, cx + 15))} y={Math.max(T + 11, cy - 9)} class="marker-label" fill={color}>{label}</text>
      </g>
    );
  };
  const clip = id;
  return (
    <svg class="sky" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Skyline all around ${a.name}, with the paths of the Sun and the Earth`}>
      <defs>
        <clipPath id={clip}><rect x={L} y={T} width={W - L - R} height={H - T - B} rx="6" /></clipPath>
        <linearGradient id={`${id}-air`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--sky-top)' }} /><stop offset="1" style={{ stopColor: 'var(--sky)' }} />
        </linearGradient>
        <radialGradient id={`${id}-sun`} cx="0.38" cy="0.35" r="0.75"><stop offset="0" stop-color="#ffe08a" /><stop offset="1" stop-color="#e08a0b" /></radialGradient>
        <radialGradient id={`${id}-earth`} cx="0.38" cy="0.35" r="0.75"><stop offset="0" stop-color="#8ec5ff" /><stop offset="1" stop-color="#1d4ed8" /></radialGradient>
        <linearGradient id={`${id}-ground`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--terrain-near)' }} /><stop offset="1" style={{ stopColor: 'var(--terrain-mid)' }} />
        </linearGradient>
      </defs>
      <rect x={L} y={T} width={W - L - R} height={H - T - B} rx="6" fill={`url(#${id}-air)`} class="sky-frame" />
      {stat.ticks.map((v) => (
        <g>
          <line x1={L} x2={W - R} y1={frame.y(v)} y2={frame.y(v)} class={v === 0 ? 'grid zero' : 'grid'} />
          <text x={L - 5} y={frame.y(v) + 3.5} class="axis" text-anchor="end">{v}°</text>
        </g>
      ))}
      {[-180, -90, 0, 90, 180].map((offset, i) => (
        <text x={L + ((offset + 180) / 360) * (W - L - R)} y={H - 7} class="axis" text-anchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}>
          {compass(frame.centre + offset)}
        </text>
      ))}
      <g clip-path={`url(#${clip})`}>
        <path d={stat.sunHidden} class="trace hidden" stroke={SUN} />
        <path d={stat.earthHidden} class="trace hidden" stroke={EARTH} />
        <path d={stat.far} class="terrain far" />
        {stat.mid ? <path d={stat.mid} class="terrain mid" /> : null}
        {stat.near ? <path d={stat.near} class="terrain near" style={{ fill: `url(#${id}-ground)` }} /> : null}
        <path d={stat.sunSeen} class="trace" stroke={SUN} />
        <path d={stat.earthSeen} class="trace" stroke={EARTH} />
        {marker(instant.sample.earth.azDeg, instant.sample.earth.elDeg, 'earth', instant.earthUp, 'Earth')}
        {marker(instant.sample.sun.azDeg, instant.sample.sun.elDeg, 'sun', instant.sunUp, 'Sun')}
      </g>
      <rect x={L} y={T} width={W - L - R} height={H - T - B} rx="6" class="sky-edge" />
    </svg>
  );
}

/** Illuminated fraction of the Earth's disc seen from the Moon, and the screen angle of its bright limb. */
function earthPhase(instant: Instant): { lit: number; angleDeg: number } {
  const s = instant.sample.sun, e = instant.sample.earth;
  const cosSep = Math.sin(s.elDeg * DEG) * Math.sin(e.elDeg * DEG) + Math.cos(s.elDeg * DEG) * Math.cos(e.elDeg * DEG) * Math.cos((s.azDeg - e.azDeg) * DEG);
  // Initial bearing from the Earth to the Sun on the sky, measured from "up" towards increasing azimuth.
  const dAz = (s.azDeg - e.azDeg) * DEG;
  const bearing = Math.atan2(Math.sin(dAz) * Math.cos(s.elDeg * DEG),
    Math.cos(e.elDeg * DEG) * Math.sin(s.elDeg * DEG) - Math.sin(e.elDeg * DEG) * Math.cos(s.elDeg * DEG) * Math.cos(dAz));
  return { lit: (1 - Math.max(-1, Math.min(1, cosSep))) / 2, angleDeg: bearing / DEG - 90 };
}

/** The Sun or the Earth at true scale against the skyline around it. */
export function CloseUp({ a, instant, body }: { a: Analysis; instant: Instant; body: 'sun' | 'earth' }) {
  const S = 132, half = body === 'sun' ? 1.5 : 3.2;
  const b = instant.sample[body];
  const scale = S / (2 * half), across = Math.max(0.05, Math.cos(b.elDeg * DEG));
  const y = (el: number): number => S / 2 - (el - b.elDeg) * scale;
  const outline = (p: HorizonProfile): string => {
    let d = `M0,${S}`;
    for (let px = 0; px <= S; px += 2) {
      const az = b.azDeg + (px - S / 2) / (across * scale);
      d += `L${px},${Math.min(S, Math.max(0, y(horizonElevationAt(p, az)))).toFixed(1)}`;
    }
    return `${d}L${S},${S}Z`;
  };
  const far = outline(a.terrain.profile);
  const mid = ridge(a, 'mid'), near = ridge(a, 'near');
  const r = b.angularRadiusDeg * scale;
  const up = body === 'sun' ? instant.sunUp : instant.earthUp;
  const fraction = instant.margins.sunDiskFraction;
  let caption: string;
  let disc;
  const gid = `cu-${a.scenario.id}-${body}`;
  if (body === 'sun') {
    caption = fraction >= 0.995 ? 'Whole Disc in View' : fraction <= 0.005 ? 'Hidden by Terrain' : `${pct(fraction)} of the Disc in View`;
    disc = (
      <circle cx={S / 2} cy={S / 2} r={r} fill={`url(#${gid}-disc)`} />
    );
  } else {
    const phase = earthPhase(instant);
    const rx = r * Math.abs(1 - 2 * phase.lit);
    caption = `${up ? 'in View' : 'Hidden by Terrain'} · ${pct(phase.lit)} Lit`;
    disc = (
      <g transform={`rotate(${phase.angleDeg.toFixed(1)} ${S / 2} ${S / 2}) translate(${S / 2} ${S / 2})`}>
        <circle r={r} fill="#1e2a44" />
        <path d={`M0,${-r}A${r},${r} 0 0 1 0,${r}A${rx.toFixed(2)},${r} 0 0 ${phase.lit > 0.5 ? 1 : 0} 0,${-r}Z`} fill={`url(#${gid}-disc)`} />
      </g>
    );
  }
  const barDeg = body === 'sun' ? 0.5 : 1;
  return (
    <figure class="closeup">
      <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`${body === 'sun' ? 'Sun' : 'Earth'} against the skyline: ${caption}`}>
        <defs>
          <linearGradient id={`${gid}-air`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--sky-top)' }} /><stop offset="1" style={{ stopColor: 'var(--sky)' }} />
          </linearGradient>
          {body === 'sun'
            ? <radialGradient id={`${gid}-disc`} cx="0.4" cy="0.38" r="0.7"><stop offset="0" stop-color="#fff1b8" /><stop offset="0.55" stop-color="#ffc94a" /><stop offset="1" stop-color="#e88a0c" /></radialGradient>
            : <radialGradient id={`${gid}-disc`} cx="0.4" cy="0.38" r="0.75"><stop offset="0" stop-color="#b9dcff" /><stop offset="0.6" stop-color="#4b8df0" /><stop offset="1" stop-color="#1d4ed8" /></radialGradient>}
        </defs>
        <rect width={S} height={S} fill={`url(#${gid}-air)`} />
        {disc}
        <path d={far} class="terrain far" />
        {mid ? <path d={outline(mid)} class="terrain mid" /> : null}
        {near ? <path d={outline(near)} class="terrain near" /> : null}
        <circle cx={S / 2} cy={S / 2} r={r} fill="none" stroke={body === 'sun' ? SUN : EARTH} stroke-opacity="0.75" stroke-dasharray="3 3" />
        <line x1="8" x2={8 + barDeg * scale * across} y1={S - 8} y2={S - 8} class="scale-bar" />
        <text x="8" y={S - 13} class="axis strong">{barDeg}°</text>
      </svg>
      <figcaption><b style={{ color: body === 'sun' ? SUN : EARTH }}>{body === 'sun' ? 'Sun' : 'Earth'}</b> {caption}</figcaption>
    </figure>
  );
}

/** Sunlight, Earth-visibility and combined windows over the mission span. */
export function Timeline({ a, cursorH, onCursor }: { a: Analysis; cursorH: number; onCursor: (hours: number) => void }) {
  const W = 720, H = 84, L = 40, R = 6, rowH = 16, top = 4;
  const { startMs, endMs } = a.series;
  const x = (ms: number): number => L + ((ms - startMs) / (endMs - startMs)) * (W - L - R);
  const days = (endMs - startMs) / DAY;
  const tickDays = days > 200 ? 60 : days > 60 ? 15 : days > 20 ? 5 : 2;
  const ticks: number[] = [];
  for (let d = 0; d <= days + 1e-6; d += tickDays) ticks.push(d);
  const row = (windows: Interval[], index: number, color: string, label: string) => (
    <g>
      <text x={L - 6} y={top + index * (rowH + 4) + rowH - 4} class="axis" text-anchor="end">{label}</text>
      <rect x={L} y={top + index * (rowH + 4)} width={W - L - R} height={rowH} rx="4" class="bar-bg" />
      {windows.map((w) => {
        const width = Math.max(0.6, x(w.endMs) - x(w.startMs));
        return <rect x={x(w.startMs)} y={top + index * (rowH + 4)} width={width} height={rowH} rx={Math.min(4, width / 2)} fill={color} />;
      })}
    </g>
  );
  const pick = (event: PointerEvent): void => {
    const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    const f = Math.min(1, Math.max(0, (px - L) / (W - L - R)));
    onCursor((f * (endMs - startMs)) / HOUR);
  };
  const cx = x(startMs + cursorH * HOUR);
  return (
    <svg class="timeline" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Windows of sunlight, Earth in view, and both, over ${fmtSpan(days * 24)} from landing`}
      onPointerDown={(e) => { (e.currentTarget as Element).setPointerCapture(e.pointerId); pick(e); }}
      onPointerMove={(e) => { if (e.buttons & 1) pick(e); }}>
      {row(a.summary.sunWindows, 0, SUN, 'Sun')}
      {row(a.summary.earthWindows, 1, EARTH, 'Earth')}
      {row(a.summary.bothWindows, 2, BOTH, 'Both')}
      {ticks.map((d) => (
        <g>
          <line x1={x(startMs + d * DAY)} x2={x(startMs + d * DAY)} y1={top} y2={top + 3 * (rowH + 4) - 4} class="grid" />
          <text x={x(startMs + d * DAY)} y={H - 4} class="axis" text-anchor={d === 0 ? 'start' : x(startMs + d * DAY) > W - R - 24 ? 'end' : 'middle'}>{d === 0 ? 'Landing' : `+${d} d`}</text>
        </g>
      ))}
      <line x1={cx} x2={cx} y1={top} y2={top + 3 * (rowH + 4) - 4} class="cursor" />
      <circle cx={cx} cy={top + 3 * (rowH + 4) - 4} r="4" class="cursor-knob" />
    </svg>
  );
}

export interface CalendarRow { label: string; color: string; values: Float32Array; title: string }

/** One year of possible landing days: the unbroken sunlight / Earth link that would follow each. */
export function LandingCalendar({ calendar, rows, currentMs, best, onPick }: {
  calendar: Calendar; rows: CalendarRow[]; currentMs: number; best: LandingWindow[]; onPick: (ms: number) => void;
}) {
  const W = 1440, L = 150, R = 8, rowH = 18, gap = 3, top = 16;
  const H = top + rows.length * (rowH + gap) + 34;
  const perDay = DAY / calendar.stepMs;
  const daysTotal = Math.floor(calendar.sunRunH.length / perDay);
  const cellW = (W - L - R) / daysTotal;
  const months: { x: number; label: string }[] = [];
  for (let d = 0; d < daysTotal; d++) {
    const date = new Date(calendar.startMs + d * DAY);
    if (date.getUTCDate() === 1) months.push({ x: L + d * cellW, label: date.toLocaleString('en', { month: 'short', timeZone: 'UTC' }) + (date.getUTCMonth() === 0 || months.length === 0 ? ` ${date.getUTCFullYear()}` : '') });
  }
  const xOf = (ms: number): number => L + ((ms - calendar.startMs) / DAY) * cellW;
  const currentX = xOf(currentMs);
  const bottom = top + rows.length * (rowH + gap);
  return (
    <svg class="calendar" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Landing calendar: unbroken sunlight and Earth link after each possible landing day"
      onClick={(event) => {
        const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
        const px = ((event.clientX - box.left) / box.width) * W;
        const day = Math.floor((px - L) / cellW);
        if (day >= 0 && day < daysTotal) onPick(calendar.startMs + day * DAY);
      }}>
      {best.map((w) => (
        <path d={`M${xOf(w.startMs) - 5},${top - 10}h10l-5,7z`} class="best-mark"><title>{`Best landing: ${fmtDate(w.startMs)}`}</title></path>
      ))}
      {rows.map((row, r) => {
        let max = 24;
        for (let d = 0; d < daysTotal; d++) max = Math.max(max, row.values[Math.round(d * perDay)]!);
        const y0 = top + r * (rowH + gap);
        return (
          <g>
            <text x={L - 6} y={y0 + rowH - 5} class="axis" text-anchor="end"><title>{row.title}</title>{row.label}</text>
            <rect x={L} y={y0} width={W - L - R} height={rowH} rx="4" class="bar-bg" />
            {Array.from({ length: daysTotal }, (_, d) => {
              const v = row.values[Math.round(d * perDay)]!;
              return v > 0 ? (
                <rect x={L + d * cellW} y={y0} width={cellW + 0.3} height={rowH} fill={row.color} fill-opacity={0.15 + 0.85 * (v / max)}>
                  <title>{`${row.title} — landing ${fmtDate(calendar.startMs + d * DAY)}: ${v >= calendar.lookaheadH - 1 ? 'more than ' : ''}${fmtSpan(v)} unbroken`}</title>
                </rect>
              ) : null;
            })}
          </g>
        );
      })}
      {months.map((m) => (
        <g>
          <line x1={m.x} x2={m.x} y1={top} y2={bottom} class="grid" />
          <text x={m.x + 2} y={bottom + 12} class="axis">{m.label}</text>
        </g>
      ))}
      {currentX >= L && currentX <= W - R ? (
        <g>
          <line x1={currentX} x2={currentX} y1={top - 2} y2={bottom} class="cursor" />
          <circle cx={currentX} cy={bottom} r="4" class="cursor-knob" />
          <text x={Math.min(W - 50, Math.max(L + 40, currentX))} y={H - 4} class="axis strong" text-anchor="middle">Selected Landing</text>
        </g>
      ) : null}
    </svg>
  );
}
