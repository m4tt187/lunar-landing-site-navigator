// SPDX-License-Identifier: Apache-2.0
// AI-assisted: written with Anthropic Claude under the direction of the team.
//
// The Earth passing in front of the Sun as seen from the Moon. Observers on the
// Earth call the same event a lunar eclipse; a lander sees an eclipse of the Sun
// and loses sunlight, for hours when the eclipse is total.
//
// Everything here is plane geometry of two discs in the lander's sky: the Sun
// and the Earth, the Earth's disc being enlarged for its atmosphere. Sources of
// the constants and the comparison with NASA's eclipse predictions are in
// docs/engine/eclipses.md.
import { SUN_RADIUS_KM, moonFixedVectors, sampleFromVectors, validateSite, validateTime } from './geometry';
import type { EclipseEvent, Series, Site } from './types';

const DEG = Math.PI / 180;

/**
 * Height (km) of the layer of air that is taken as opaque, added to the solid
 * Earth to get the edge of the full shadow. A. Danjon's value, the one used in
 * NASA's Five Millennium Canon of Lunar Eclipses: "Danjon estimates the
 * thickness of the occulting layer to be 75 km and this results in an
 * enlargement of Earth's radius and the Moon's parallax of about 1/85."
 * https://eclipse.gsfc.nasa.gov/LEcat5/shadow.html
 */
export const EARTH_ATMOSPHERE_KM = 75;

/**
 * The Earth is flattened, so its outline seen from the Moon is not a circle.
 * NASA's predictions replace it by a circle with the Earth's mean radius at
 * latitude 45 degrees: "The Astronomical Almanac uses a factor of 0.998340 to
 * scale the Moon's equatorial horizontal parallax to account for this".
 * https://eclipse.gsfc.nasa.gov/LEcat5/shadow.html
 */
export const EARTH_MEAN_RADIUS_FACTOR = 0.998340;

/** The equatorial radius behind the Earth's angular radius in a Sample (geometry.ts). */
const EARTH_EQUATORIAL_RADIUS_KM = 6378.137;

/** Radius of the opaque disc divided by the equatorial radius: about 1.0101. */
const EARTH_DISC_SCALE = EARTH_MEAN_RADIUS_FACTOR + EARTH_ATMOSPHERE_KM / EARTH_EQUATORIAL_RADIUS_KM;

/**
 * Upper bound (degrees per hour) on how fast the Sun-Earth separation, and the
 * sum of the two radii, can change for an observer on the Moon. The separation
 * changes at the rate of the Moon's motion around the Earth relative to the
 * Sun, which peaks near 0.61 degrees per hour at the closest perigees; the
 * largest value measured over 2000-2050 is in docs/engine/eclipses.md, and a
 * test checks that this bound stays above what the ephemeris gives.
 */
export const MAX_SEPARATION_RATE_DEG_PER_H = 0.75;

const HOUR_MS = 3600000;
/** Shortest step of the eclipse scan; see findEclipses for why it is safe. */
const MIN_SCAN_STEP_MS = 60000;
/** Contact times are bracketed to this width, then the middle is returned. */
const CONTACT_BRACKET_MS = 1000;

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be a finite number.`);
}

function requireRadius(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0 || value > 90)
    throw new RangeError(`${name} must be finite, positive, and at most 90 degrees.`);
}

function requireSeparation(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 180)
    throw new RangeError('Separation must be finite and between 0 and 180 degrees.');
}

function requireElevation(value: number, name: string): void {
  if (!Number.isFinite(value) || Math.abs(value) > 90)
    throw new RangeError(`${name} must be finite and between -90 and 90 degrees.`);
}

/**
 * Angular radius of the Earth's opaque disc (mean radius at latitude 45 degrees
 * plus EARTH_ATMOSPHERE_KM) from the geometric angular radius found in a Sample.
 */
export function enlargedEarthRadiusDeg(earthRadiusDeg: number): number {
  requireRadius(earthRadiusDeg, 'Earth angular radius');
  return enlargeUnchecked(earthRadiusDeg);
}

function enlargeUnchecked(earthRadiusDeg: number): number {
  // The sine of the angular radius is radius over distance, so it scales exactly.
  return Math.asin(Math.min(1, Math.sin(earthRadiusDeg * DEG) * EARTH_DISC_SCALE)) / DEG;
}

/**
 * Great-circle angle between two azimuth/elevation directions. The arctangent
 * form keeps full precision for angles of a few thousandths of a degree, where
 * the arccosine of a dot product loses half of its digits.
 */
export function separationDeg(az1Deg: number, el1Deg: number, az2Deg: number, el2Deg: number): number {
  requireFinite(az1Deg, 'Azimuth'); requireFinite(az2Deg, 'Azimuth');
  requireElevation(el1Deg, 'Elevation'); requireElevation(el2Deg, 'Elevation');
  return offsetUnchecked(az1Deg, el1Deg, az2Deg, el2Deg).separationDeg;
}

export interface SkyOffset { acrossDeg: number; upDeg: number; separationDeg: number }

/**
 * Where the Earth's centre is relative to the Sun's centre, in the plane tangent
 * to the sky at the Sun: across is toward increasing azimuth, up is toward
 * increasing elevation. The direction comes from the spherical position angle,
 * so it stays right close to the zenith, where a difference of azimuths times
 * the cosine of the elevation does not.
 */
export function earthOffsetFromSun(sunAzDeg: number, sunElDeg: number, earthAzDeg: number, earthElDeg: number): SkyOffset {
  requireFinite(sunAzDeg, 'Sun azimuth'); requireFinite(earthAzDeg, 'Earth azimuth');
  requireElevation(sunElDeg, 'Sun elevation'); requireElevation(earthElDeg, 'Earth elevation');
  return offsetUnchecked(sunAzDeg, sunElDeg, earthAzDeg, earthElDeg);
}

function offsetUnchecked(az1Deg: number, el1Deg: number, az2Deg: number, el2Deg: number): SkyOffset {
  const el1 = el1Deg * DEG, el2 = el2Deg * DEG, dAz = (az2Deg - az1Deg) * DEG;
  // Components of the second direction along the first one's across, up and
  // line-of-sight axes.
  const across = Math.cos(el2) * Math.sin(dAz);
  const up = Math.cos(el1) * Math.sin(el2) - Math.sin(el1) * Math.cos(el2) * Math.cos(dAz);
  const along = Math.sin(el1) * Math.sin(el2) + Math.cos(el1) * Math.cos(el2) * Math.cos(dAz);
  const sine = Math.hypot(across, up);
  const separation = Math.atan2(sine, along) / DEG;
  if (sine === 0) return { acrossDeg: 0, upDeg: separation, separationDeg: separation };
  return { acrossDeg: (separation * across) / sine, upDeg: (separation * up) / sine, separationDeg: separation };
}

/**
 * Part of a disc of radius a that lies inside a disc of radius b whose centre is
 * d away (two-circle lens), as a fraction of the first disc. The half-chord is
 * built from a product of differences, which stays accurate at both tangencies.
 */
function lensFraction(d: number, a: number, b: number): number {
  if (d >= a + b) return 0;
  if (d <= Math.abs(b - a)) return b >= a ? 1 : (b * b) / (a * a);
  const halfChord = Math.sqrt(Math.max(0, (a + b - d) * (d + a - b) * (d - a + b) * (d + a + b))) / (2 * d);
  const fromA = (d * d + a * a - b * b) / (2 * d); // chord's distance from the first centre, signed
  const fromB = d - fromA;
  const area = a * a * Math.atan2(halfChord, fromA) + b * b * Math.atan2(halfChord, fromB) - d * halfChord;
  return Math.min(1, Math.max(0, area / (Math.PI * a * a)));
}

/**
 * Separation at which the second disc covers exactly `covered` of the first.
 * The caller guarantees 0 < covered < the largest possible cover, so the root is
 * strictly between the two tangencies. Newton's method with the exact slope (the
 * lens area changes by minus the chord length per unit of separation), kept
 * inside a shrinking bracket so that it cannot run away near a tangency.
 */
function separationForCover(covered: number, a: number, b: number): number {
  let lo = Math.abs(b - a), hi = a + b;
  let d = (lo + hi) / 2;
  for (let i = 0; i < 200; i++) {
    const excess = lensFraction(d, a, b) - covered;
    if (excess > 0) lo = d; else hi = d;
    const chord = Math.sqrt(Math.max(0, (a + b - d) * (d + a - b) * (d - a + b) * (d + a + b))) / d;
    let next = chord > 0 ? d + (excess * Math.PI * a * a) / chord : NaN;
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    if (Math.abs(next - d) <= 1e-15 * (a + b) || hi - lo <= 1e-15 * (a + b)) return next;
    d = next;
  }
  return d;
}

/**
 * Fraction (0..1) of the solar disc covered by the Earth's opaque disc.
 * earthRadiusDeg is the geometric angular radius found in a Sample; it is
 * enlarged here for the atmosphere.
 */
export function sunFractionCoveredByEarth(separationDeg: number, sunRadiusDeg: number, earthRadiusDeg: number): number {
  requireSeparation(separationDeg);
  requireRadius(sunRadiusDeg, 'Sun angular radius'); requireRadius(earthRadiusDeg, 'Earth angular radius');
  return lensFraction(separationDeg, sunRadiusDeg, enlargeUnchecked(earthRadiusDeg));
}

/**
 * Signed margin in degrees, with the convention of the terrain margins: positive
 * while at least minVisibleFraction of the solar disc is left uncovered by the
 * Earth, zero at the separation where exactly that fraction is uncovered.
 * It is the separation minus that critical separation, so it is continuous and
 * rises one degree per degree of separation; crossings found by interpolating
 * between samples are therefore as good as for the terrain margins.
 *
 * minVisibleFraction 0 means "any part of the Sun shows" (zero at the inner
 * tangency) and 1 means "the whole Sun shows" (zero at the outer tangency).
 * Both are closed forms. A fraction in between needs a short numerical solve,
 * about a tenth of a microsecond.
 */
export function eclipseMarginDeg(
  separationDeg: number, sunRadiusDeg: number, earthRadiusDeg: number, minVisibleFraction: number,
): number {
  requireSeparation(separationDeg);
  requireRadius(sunRadiusDeg, 'Sun angular radius'); requireRadius(earthRadiusDeg, 'Earth angular radius');
  if (!(minVisibleFraction >= 0 && minVisibleFraction <= 1))
    throw new RangeError('Minimum visible fraction must be between 0 and 1.');
  const a = sunRadiusDeg, b = enlargeUnchecked(earthRadiusDeg);
  if (minVisibleFraction === 0) return separationDeg - (b - a);
  if (minVisibleFraction === 1) return separationDeg - (b + a);
  const covered = 1 - minVisibleFraction;
  if (b < a) {
    // A disc smaller than the Sun covers at most (b/a)^2 of it. Asking for more
    // can never be met: the Sun always counts as visible.
    const mostCovered = (b * b) / (a * a);
    if (covered >= mostCovered) return separationDeg + (a - b);
  }
  return separationDeg - separationForCover(covered, a, b);
}

/**
 * Fraction of the solar disc above a straight horizontal skyline: the formula of
 * sunDiskFractionVisible in analysis.ts, repeated here so that this module does
 * not import the one that imports it. A test checks that the two agree.
 */
function fractionAboveSkyline(sunElDeg: number, sunRadiusDeg: number, horizonElDeg: number): number {
  const d = (horizonElDeg - sunElDeg) / sunRadiusDeg;
  if (d <= -1) return 1;
  if (d >= 1) return 0;
  return (Math.acos(d) - d * Math.sqrt(1 - d * d)) / Math.PI;
}

/**
 * Nodes and weights of the Gauss-Legendre rule with n points on [-1, 1], by
 * Newton's method on the Legendre polynomial (computed once, when the module loads).
 */
function gaussLegendre(n: number): { nodes: Float64Array; weights: Float64Array } {
  const nodes = new Float64Array(n), weights = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let x = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5)), slope = 1;
    for (let step = 0; step < 100; step++) {
      let p0 = 1, p1 = x;
      for (let k = 2; k <= n; k++) { const p2 = ((2 * k - 1) * x * p1 - (k - 1) * p0) / k; p0 = p1; p1 = p2; }
      slope = (n * (x * p1 - p0)) / (x * x - 1);
      const dx = p1 / slope;
      x -= dx;
      if (Math.abs(dx) < 1e-15) break;
    }
    nodes[i] = x;
    weights[i] = 2 / ((1 - x * x) * slope * slope);
  }
  return { nodes, weights };
}

/** Rule used on each stretch of the strip integration; see visibleAreaAbove. */
const STRIP_RULE = gaussLegendre(24);

/**
 * Area of the solar disc (radius a, centred on the origin) above the line
 * y = floor and outside the Earth's disc (radius b, centred on (ex, ey)).
 *
 * Horizontal strips: at each height the visible length is the Sun's chord minus
 * its overlap with the Earth's chord, both exact. The heights where that length
 * has a corner or a square-root start (the top and bottom of either disc and the
 * two points where the circles cross) split the range into stretches. In each
 * stretch the height runs as a cosine of the integration variable, which turns
 * the square-root ends into smooth ones, and a 24-point Gauss-Legendre rule
 * integrates the result; the error, measured against an independent integration
 * in tests/engine/eclipse.test.ts, is below a millionth of the disc.
 */
function visibleAreaAbove(floor: number, a: number, ex: number, ey: number, b: number): number {
  const lo = Math.max(floor, -a), hi = a;
  if (!(hi > lo)) return 0;
  const cuts = [lo, hi];
  const addCut = (y: number): void => { if (y > lo && y < hi) cuts.push(y); };
  addCut(ey - b); addCut(ey + b);
  const d = Math.hypot(ex, ey);
  if (d > Math.abs(b - a) && d < a + b) {
    const fromA = (d * d + a * a - b * b) / (2 * d);
    const halfChord = Math.sqrt(Math.max(0, a * a - fromA * fromA));
    addCut((fromA * ey - halfChord * ex) / d); addCut((fromA * ey + halfChord * ex) / d);
  }
  cuts.sort((p, q) => p - q);
  const visibleLength = (y: number): number => {
    const w = Math.sqrt(Math.max(0, a * a - y * y));
    const dy = y - ey;
    if (Math.abs(dy) >= b) return 2 * w;
    const we = Math.sqrt(b * b - dy * dy);
    return 2 * w - Math.max(0, Math.min(w, ex + we) - Math.max(-w, ex - we));
  };
  const { nodes, weights } = STRIP_RULE;
  let area = 0;
  for (let i = 1; i < cuts.length; i++) {
    const p = cuts[i - 1]!, span = cuts[i]! - p;
    if (!(span > 0)) continue;
    let sum = 0;
    for (let k = 0; k < nodes.length; k++) {
      const u = (Math.PI * (nodes[k]! + 1)) / 2;   // 0..pi
      sum += weights[k]! * visibleLength(p + (span * (1 - Math.cos(u))) / 2) * Math.sin(u);
    }
    // dy = span/2 * sin(u) du, and du = pi/2 per unit of the rule's variable.
    area += (sum * span * Math.PI) / 4;
  }
  return area;
}

/**
 * Fraction (0..1) of the solar disc that is both above a straight horizontal
 * skyline at horizonElDeg and outside the Earth's opaque disc. The Earth's centre
 * is at (earthAcrossDeg, earthUpDeg) from the Sun's centre in the tangent plane
 * (see earthOffsetFromSun); earthRadiusDeg is the radius found in a Sample.
 */
export function sunDiskFractionVisibleWithEarth(
  sunElDeg: number, sunRadiusDeg: number, horizonElDeg: number,
  earthAcrossDeg: number, earthUpDeg: number, earthRadiusDeg: number,
): number {
  requireElevation(sunElDeg, 'Sun elevation'); requireElevation(horizonElDeg, 'Skyline elevation');
  requireRadius(sunRadiusDeg, 'Sun angular radius');
  requireFinite(earthAcrossDeg, 'Earth offset'); requireFinite(earthUpDeg, 'Earth offset');
  requireRadius(earthRadiusDeg, 'Earth angular radius');
  return visibleFractionUnchecked(sunElDeg, sunRadiusDeg, horizonElDeg, earthAcrossDeg, earthUpDeg, enlargeUnchecked(earthRadiusDeg));
}

/** As sunDiskFractionVisibleWithEarth, with the Earth's radius already enlarged and no input checks. */
function visibleFractionUnchecked(
  sunElDeg: number, sunRadiusDeg: number, horizonElDeg: number, earthAcrossDeg: number, earthUpDeg: number, b: number,
): number {
  const aboveSkyline = fractionAboveSkyline(sunElDeg, sunRadiusDeg, horizonElDeg);
  const a = sunRadiusDeg;
  const d = Math.hypot(earthAcrossDeg, earthUpDeg);
  if (d >= a + b || aboveSkyline === 0) return aboveSkyline;
  if (b >= a && d <= b - a) return 0;
  const skyline = horizonElDeg - sunElDeg;
  if (skyline <= -a) return 1 - lensFraction(d, a, b);
  // The Earth may cover only sunlight that the skyline hides anyway. The answer is
  // then exactly the skyline-only fraction; integrating a region that has not
  // changed would return it a few rounding errors off, enough to fail a rule such
  // as "at least half the disc" when exactly half shows.
  if (distanceToVisiblePart(a, skyline, earthAcrossDeg, earthUpDeg) >= b) return aboveSkyline;
  const fraction = visibleAreaAbove(skyline, a, earthAcrossDeg, earthUpDeg, b) / (Math.PI * a * a);
  return Math.min(aboveSkyline, Math.max(0, fraction));
}

/**
 * Distance from the Earth's centre (ex, ey) to the part of the solar disc
 * (radius a, centred on the origin) that is above the line y = skyline, zero
 * when the centre is inside that part. The part is not empty (-a < skyline < a).
 */
function distanceToVisiblePart(a: number, skyline: number, ex: number, ey: number): number {
  const d = Math.hypot(ex, ey);
  if (d <= a) {
    if (ey >= skyline) return 0;
  } else if ((a * ey) / d >= skyline) {
    // From outside the disc the nearest point is on the limb, straight towards the Sun's centre,
    // when that point is above the skyline.
    return d - a;
  }
  // Otherwise the nearest point is on the chord that the skyline cuts across the disc.
  const halfChord = Math.sqrt(Math.max(0, a * a - skyline * skyline));
  const x = Math.max(-halfChord, Math.min(halfChord, ex));
  return Math.hypot(ex - x, ey - skyline);
}

/**
 * How far from touching the two discs may be for the Earth still to be taken
 * into account. The margin of the "whole disc shows" rule is the gap between the
 * discs; it has to be known on both sides of first and last contact for the
 * crossing to be placed between two samples. 1.5 degrees is more than the gap
 * can change in two hours (MAX_SEPARATION_RATE_DEG_PER_H).
 */
const NEAR_ECLIPSE_DEG = 1.5;

/** The Earth's opaque disc relative to the Sun's, during an eclipse and shortly before and after. */
export interface EclipseState {
  /** Earth's centre from the Sun's centre: toward increasing azimuth, toward increasing elevation, and the distance. */
  acrossDeg: number; upDeg: number; separationDeg: number;
  /** Angular radius of the Earth's opaque disc (enlarged for the atmosphere). */
  earthDiscDeg: number;
  /** Fraction of the solar disc covered by it; 0 while the discs do not overlap. */
  coveredFraction: number;
}

/**
 * The Earth relative to the Sun at one sample when the two discs overlap or
 * are within 1.5 degrees of touching; null otherwise, which is by far the usual
 * case and is decided without trigonometry whenever the two elevations alone
 * are further apart than that (two directions are never closer than their
 * elevations differ). No input checks: this runs once per sample of every series.
 */
export function eclipseState(
  sunAzDeg: number, sunElDeg: number, sunRadiusDeg: number, earthAzDeg: number, earthElDeg: number, earthRadiusDeg: number,
): EclipseState | null {
  // 1.02 is a little more than the enlargement of the Earth's disc, so this never rejects a state that the exact test keeps.
  if (Math.abs(earthElDeg - sunElDeg) >= sunRadiusDeg + 1.02 * earthRadiusDeg + NEAR_ECLIPSE_DEG) return null;
  const offset = offsetUnchecked(sunAzDeg, sunElDeg, earthAzDeg, earthElDeg);
  const disc = enlargeUnchecked(earthRadiusDeg);
  if (offset.separationDeg >= sunRadiusDeg + disc + NEAR_ECLIPSE_DEG) return null;
  return { ...offset, earthDiscDeg: disc, coveredFraction: lensFraction(offset.separationDeg, sunRadiusDeg, disc) };
}

/** Fraction of the solar disc above a straight skyline and outside the Earth's disc, for an eclipse in progress. No input checks. */
export function sunFractionVisibleInEclipse(sunElDeg: number, sunRadiusDeg: number, horizonElDeg: number, state: EclipseState): number {
  return visibleFractionUnchecked(sunElDeg, sunRadiusDeg, horizonElDeg, state.acrossDeg, state.upDeg, state.earthDiscDeg);
}

/**
 * The signed sunlight margin (degrees) with the Earth taken into account:
 * positive while at least minVisibleFraction of the solar disc is both above a
 * straight skyline and outside the Earth's opaque disc. It takes the place of
 * the skyline-only margin, which is passed in, and is never larger than it.
 *
 * The skyline and the Earth cannot be judged one at a time: the Earth can cover
 * exactly the part of the Sun that the skyline leaves showing.
 * - "Any part shows" (0): exact. The part of the disc above the skyline is a
 *   circular segment; what matters is its point farthest from the Earth's
 *   centre, which is the point of the Sun's limb opposite the Earth when that
 *   point is above the skyline, and otherwise one of the two ends of the
 *   segment's chord. The margin is how far that point is outside the Earth's
 *   disc, or the skyline margin when that is smaller.
 * - "The whole disc shows" (1): exact. The disc must clear the skyline and the
 *   Earth must not touch it: the smaller of the two margins.
 * - A fraction in between: while the discs overlap, the visible fraction is
 *   computed and its excess over the required fraction is turned into degrees
 *   with the rate at which a straight edge through the middle of the disc
 *   uncovers it (pi * radius / 2 degrees per unit of fraction); the result is
 *   the smaller of that and the skyline margin. The sign is exact; the size is an
 *   estimate, used only to place the crossing between two samples.
 * No input checks.
 */
export function sunMarginWithEarth(
  skylineMarginDeg: number, sunElDeg: number, sunRadiusDeg: number, horizonElDeg: number, state: EclipseState,
  minVisibleFraction: number,
): number {
  const a = sunRadiusDeg, b = state.earthDiscDeg, d = state.separationDeg;
  if (minVisibleFraction >= 1) return Math.min(skylineMarginDeg, d - (a + b));
  if (minVisibleFraction <= 0) {
    const h = horizonElDeg - sunElDeg;   // skyline above the Sun's centre
    if (h >= a) return skylineMarginDeg; // nothing of the disc above the skyline
    let farthest = d + a;
    if (d > 0 && (-a * state.upDeg) / d < h) {
      const w = Math.sqrt(a * a - h * h);
      farthest = Math.max(Math.hypot(w - state.acrossDeg, h - state.upDeg), Math.hypot(-w - state.acrossDeg, h - state.upDeg));
    }
    return Math.min(skylineMarginDeg, farthest - b);
  }
  if (d >= a + b) return skylineMarginDeg;
  const visible = visibleFractionUnchecked(sunElDeg, a, horizonElDeg, state.acrossDeg, state.upDeg, b);
  return Math.min(skylineMarginDeg, ((visible - minVisibleFraction) * Math.PI * a) / 2);
}

/**
 * The highest straight skyline, in degrees above the Sun's centre, under which
 * the Sun still counts as up while the Earth covers part of it: at least
 * minVisibleFraction of the solar disc is above the skyline and outside the
 * Earth's opaque disc exactly when the skyline is lower than this level.
 * Without the Earth it is the top of the disc for "any part shows" (+radius),
 * its centre for "half" (0) and its bottom for "the whole disc" (-radius).
 * Null when no skyline is low enough: the Earth alone hides that much of the Sun.
 *
 * - "Any part shows" (0): exact. The level is the highest point of the disc that
 *   the Earth leaves uncovered: the top of the disc when the Earth does not reach
 *   it, otherwise the higher of the two points where the limbs cross.
 * - "The whole disc shows" (1): exact. The bottom of the disc, and only while the
 *   Earth does not touch the Sun.
 * - A fraction in between: the level at which the visible fraction, which only
 *   falls as the skyline rises, equals the required one (bisection).
 * No input checks.
 */
export function skylineLimitInEclipse(sunRadiusDeg: number, state: EclipseState, minVisibleFraction: number): number | null {
  const a = sunRadiusDeg, b = state.earthDiscDeg, d = state.separationDeg;
  if (minVisibleFraction >= 1) return d >= a + b ? -a : null;
  if (d >= a + b) return minVisibleFraction <= 0 ? a : skylineForFraction(a, minVisibleFraction, 0, 0, 0);
  if (b >= a && d <= b - a) return null;
  if (minVisibleFraction <= 0) {
    // Top of the disc, at (0, a), unless the Earth covers it.
    if (Math.hypot(state.acrossDeg, a - state.upDeg) >= b) return a;
    if (!(d > 0)) return null;
    // The limbs cross on the line at distance m from the Sun's centre towards the Earth's, half a chord k either side.
    const m = (d * d + a * a - b * b) / (2 * d);
    const k = Math.sqrt(Math.max(0, a * a - m * m));
    return (m * state.upDeg + k * Math.abs(state.acrossDeg)) / d;
  }
  if (1 - state.coveredFraction < minVisibleFraction) return null;
  return skylineForFraction(a, minVisibleFraction, state.acrossDeg, state.upDeg, b);
}

/** Skyline level above the Sun's centre at which exactly `fraction` of the disc shows (b = 0: no Earth). */
function skylineForFraction(a: number, fraction: number, across: number, up: number, b: number): number {
  const visible = (h: number): number => (b > 0 ? visibleFractionUnchecked(0, a, h, across, up, b) : fractionAboveSkyline(0, a, h));
  let lit = -a, dark = a;
  for (let i = 0; i < 60 && dark - lit > 1e-12 * a; i++) {
    const mid = (lit + dark) / 2;
    if (visible(mid) >= fraction) lit = mid; else dark = mid;
  }
  return (lit + dark) / 2;
}

interface DiscState { tMs: number; separationDeg: number; sunRadiusDeg: number; earthDiscDeg: number }

function discStateAt(site: Site, tMs: number): DiscState {
  const s = sampleFromVectors(site, tMs, moonFixedVectors(tMs));
  return {
    tMs,
    separationDeg: offsetUnchecked(s.sun.azDeg, s.sun.elDeg, s.earth.azDeg, s.earth.elDeg).separationDeg,
    sunRadiusDeg: s.sun.angularRadiusDeg,
    earthDiscDeg: enlargeUnchecked(s.earth.angularRadiusDeg),
  };
}

/** Negative while the Earth covers some of the Sun; zero at the outer tangency. */
const outerGapDeg = (s: DiscState): number => s.separationDeg - (s.earthDiscDeg + s.sunRadiusDeg);
/** Zero or negative while the Earth covers the whole Sun. */
const innerGapDeg = (s: DiscState): number => s.separationDeg - (s.earthDiscDeg - s.sunRadiusDeg);

/** How much of the Sun the Earth covers at a site and instant, ignoring terrain. */
export function sunCoverAt(site: Site, tMs: number): { coveredFraction: number; separationDeg: number } {
  validateSite(site);
  const s = discStateAt(site, tMs);
  return { coveredFraction: lensFraction(s.separationDeg, s.sunRadiusDeg, s.earthDiscDeg), separationDeg: s.separationDeg };
}

/**
 * True when the Earth alone keeps the Sun from counting as up at a site and
 * instant: with "any part shows" (0) when the whole Sun is covered, otherwise
 * when less than the required fraction of the disc is left. Terrain is not
 * considered.
 */
export function sunHiddenByEarth(site: Site, tMs: number, minVisibleFraction: number): boolean {
  validateSite(site);
  if (!(minVisibleFraction >= 0 && minVisibleFraction <= 1))
    throw new RangeError('Minimum visible fraction must be between 0 and 1.');
  const s = discStateAt(site, tMs);
  const visible = 1 - lensFraction(s.separationDeg, s.sunRadiusDeg, s.earthDiscDeg);
  return minVisibleFraction > 0 ? visible < minVisibleFraction : visible <= 0;
}

/** A point or a body: Moon-centred, Moon-fixed frame, kilometres. */
export type MoonFixedKm = readonly [number, number, number];

/** Radius of the Earth's opaque disc, kilometres. */
const EARTH_DISC_KM = EARTH_EQUATORIAL_RADIUS_KM * EARTH_DISC_SCALE;

/**
 * Separation of the two centres below which the Earth alone keeps the Sun from
 * counting as up (a: the Sun's radius, b: the Earth's opaque disc, in one unit).
 * Negative when the Earth's disc can never hide that much of the Sun.
 */
function hidingSeparation(a: number, b: number, minVisibleFraction: number): number {
  if (minVisibleFraction <= 0) return b - a;
  if (minVisibleFraction >= 1) return a + b;
  const cover = 1 - minVisibleFraction;
  if (b < a && cover >= (b * b) / (a * a)) return -1;
  return separationForCover(cover, a, b);
}

/**
 * By how much the hiding separation d grows for each unit by which the Earth's
 * disc grows. One when the limit is a tangency. In between, the lens area gains
 * the arc of the Earth's limb inside the Sun and loses the common chord, so the
 * ratio is that arc over that chord (the Earth's disc is the larger one).
 */
function hidingSeparationGrowth(a: number, b: number, d: number, minVisibleFraction: number): number {
  if (minVisibleFraction <= 0 || minVisibleFraction >= 1) return 1;
  const chord = Math.sqrt(Math.max(0, (a + b - d) * (d + a - b) * (d - a + b) * (d + a + b))) / d;
  const sinHalf = Math.min(1, chord / (2 * b));
  return sinHalf > 0 ? Math.asin(sinHalf) / sinHalf : 1;
}

/** The two discs as seen from one point; angles in radians, distances in kilometres. */
interface DiscsFromPoint {
  separation: number;
  /** Separation below which the Sun does not count as up, and its growth per unit of growth of the Earth's disc. */
  hideWithin: number;
  growth: number;
  earthDisc: number;
  earthDistanceKm: number;
  sunDistanceKm: number;
}

function requireVector(v: MoonFixedKm, name: string): void {
  if (!(Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2])))
    throw new RangeError(`${name} must be three finite numbers.`);
}

function discsFromPoint(pointKm: MoonFixedKm, sunKm: MoonFixedKm, earthKm: MoonFixedKm, minVisibleFraction: number): DiscsFromPoint {
  requireVector(pointKm, 'Point'); requireVector(sunKm, 'Sun position'); requireVector(earthKm, 'Earth position');
  if (!(minVisibleFraction >= 0 && minVisibleFraction <= 1))
    throw new RangeError('Minimum visible fraction must be between 0 and 1.');
  const sx = sunKm[0] - pointKm[0], sy = sunKm[1] - pointKm[1], sz = sunKm[2] - pointKm[2];
  const ex = earthKm[0] - pointKm[0], ey = earthKm[1] - pointKm[1], ez = earthKm[2] - pointKm[2];
  const sunDistanceKm = Math.hypot(sx, sy, sz), earthDistanceKm = Math.hypot(ex, ey, ez);
  if (!(sunDistanceKm > SUN_RADIUS_KM && earthDistanceKm > EARTH_DISC_KM))
    throw new RangeError('The point must be outside the Sun and the Earth.');
  const cx = sy * ez - sz * ey, cy = sz * ex - sx * ez, cz = sx * ey - sy * ex;
  const sunRadius = Math.asin(SUN_RADIUS_KM / sunDistanceKm), earthDisc = Math.asin(EARTH_DISC_KM / earthDistanceKm);
  const hideWithin = hidingSeparation(sunRadius, earthDisc, minVisibleFraction);
  return {
    separation: Math.atan2(Math.hypot(cx, cy, cz), sx * ex + sy * ey + sz * ez),
    hideWithin,
    growth: hideWithin > 0 ? hidingSeparationGrowth(sunRadius, earthDisc, hideWithin, minVisibleFraction) : 1,
    earthDisc, earthDistanceKm, sunDistanceKm,
  };
}

/**
 * Eclipses over an area. From where the Sun and the Earth stand (Moon-centred,
 * Moon-fixed frame, kilometres), says whether the Earth alone keeps the Sun from
 * counting as up at no place within reachKm of a point (0), at every such place
 * (1), or at some of them (2: test them one by one with hideEclipsedPlaces).
 * Terrain is not considered.
 */
export function eclipseOverArea(
  pointKm: MoonFixedKm, reachKm: number, sunKm: MoonFixedKm, earthKm: MoonFixedKm, minVisibleFraction: number,
): 0 | 1 | 2 {
  const r = discsFromPoint(pointKm, sunKm, earthKm, minVisibleFraction);
  if (!(reachKm >= 0 && reachKm < r.earthDistanceKm / 2)) throw new RangeError('Reach must be zero or more and far smaller than the distance of the Earth.');
  if (r.hideWithin < 0) return 0;
  // Within reach of the point the direction of a body turns by at most asin(reach / distance),
  // and the Earth's disc, and with it the limit, changes by at most disc * reach / (distance - reach).
  // The denominators and the factor two leave room for both.
  const near = r.earthDistanceKm - reachKm;
  const band = Math.asin(reachKm / near) + reachKm / (r.sunDistanceKm - reachKm) + (2 * r.earthDisc * reachKm) / near;
  const gap = r.separation - r.hideWithin;
  return gap > band ? 0 : gap < -band ? 1 : 2;
}

/**
 * Eclipses over an area, place by place. x, y and z give every place in metres
 * from pointKm along the Moon-fixed axes. Wherever mask is 1 and, seen from that
 * place, the Earth alone keeps the Sun from counting as up, writes 0; returns how
 * many places it cleared. The limit separation is computed once, at the point,
 * and moved at each place as the Earth's disc looks larger or smaller from there.
 */
export function hideEclipsedPlaces(
  x: Float32Array, y: Float32Array, z: Float32Array, pointKm: MoonFixedKm,
  sunKm: MoonFixedKm, earthKm: MoonFixedKm, minVisibleFraction: number, mask: Uint8Array,
): number {
  if (x.length !== mask.length || y.length !== mask.length || z.length !== mask.length)
    throw new RangeError('Positions and mask must have the same length.');
  const r = discsFromPoint(pointKm, sunKm, earthKm, minVisibleFraction);
  if (r.hideWithin < 0) return 0;
  const sx0 = (sunKm[0] - pointKm[0]) * 1000, sy0 = (sunKm[1] - pointKm[1]) * 1000, sz0 = (sunKm[2] - pointKm[2]) * 1000;
  const ex0 = (earthKm[0] - pointKm[0]) * 1000, ey0 = (earthKm[1] - pointKm[1]) * 1000, ez0 = (earthKm[2] - pointKm[2]) * 1000;
  const cosLimit = Math.cos(r.hideWithin), sinLimit = Math.sin(r.hideWithin);
  const earthDistanceM = r.earthDistanceKm * 1000;
  let cleared = 0;
  for (let k = 0; k < mask.length; k++) {
    if (!mask[k]) continue;
    const px = x[k]!, py = y[k]!, pz = z[k]!;
    const sx = sx0 - px, sy = sy0 - py, sz = sz0 - pz;
    const ex = ex0 - px, ey = ey0 - py, ez = ez0 - pz;
    const earthM = Math.sqrt(ex * ex + ey * ey + ez * ez);
    const cosSeparation = (sx * ex + sy * ey + sz * ez) / (Math.sqrt(sx * sx + sy * sy + sz * sz) * earthM);
    // cos(limit + more), where "more" follows how much larger the Earth's disc is from here: a few millionths of a radian.
    const more = r.growth * r.earthDisc * (earthDistanceM / earthM - 1);
    if (cosSeparation > cosLimit - more * sinLimit) { mask[k] = 0; cleared++; }
  }
  return cleared;
}

/**
 * Every interval in [fromMs, toMs] during which the Earth covers part of the
 * Sun at a site, ignoring terrain. Contact times are refined to about a second.
 *
 * The scan cannot miss an eclipse whose largest covered fraction exceeds 0.01.
 * Away from an eclipse the gap between the two discs closes no faster than
 * MAX_SEPARATION_RATE_DEG_PER_H, so after a sample with gap g no contact can
 * happen for g divided by that rate, and the scan jumps exactly that far. Only
 * when the jump would be shorter than one minute does it take a one-minute step
 * instead, and such a step can only skip an eclipse that lasts less than a
 * minute. Covering 0.01 of the Sun needs the Earth's limb to reach more than
 * 0.016 degrees into the solar disc (the Sun's radius is never under 0.26
 * degrees), which by the same rate bound takes more than 1.2 minutes each way:
 * that eclipse lasts over 2.5 minutes and gets sampled.
 */
export function findEclipses(site: Site, fromMs: number, toMs: number): EclipseEvent[] {
  validateSite(site); validateTime(fromMs); validateTime(toMs);
  if (!(toMs > fromMs)) throw new RangeError('End time must be after start time.');
  const at = (tMs: number): DiscState => discStateAt(site, tMs);
  const jumpMs = (gapDeg: number): number =>
    Math.max(MIN_SCAN_STEP_MS, (Math.abs(gapDeg) / MAX_SEPARATION_RATE_DEG_PER_H) * HOUR_MS);
  const covering = (s: DiscState): boolean => outerGapDeg(s) < 0;
  const total = (s: DiscState): boolean => innerGapDeg(s) <= 0;

  /** Instant between a sample where `test` fails and one where it holds, in either time order. */
  const crossing = (failMs: number, holdMs: number, test: (s: DiscState) => boolean): number => {
    let fail = failMs, hold = holdMs;
    while (Math.abs(hold - fail) > CONTACT_BRACKET_MS) {
      const mid = (fail + hold) / 2;
      if (test(at(mid))) hold = mid; else fail = mid;
    }
    return Math.round((fail + hold) / 2);
  };

  /** Sample of least separation in [startMs, endMs] by golden-section search; the separation has one minimum there. */
  const closest = (startMs: number, endMs: number): DiscState => {
    const ratio = (Math.sqrt(5) - 1) / 2;
    let lo = startMs, hi = endMs;
    let x1 = at(hi - ratio * (hi - lo)), x2 = at(lo + ratio * (hi - lo));
    while (hi - lo > CONTACT_BRACKET_MS) {
      if (x1.separationDeg <= x2.separationDeg) { hi = x2.tMs; x2 = x1; x1 = at(hi - ratio * (hi - lo)); }
      else { lo = x1.tMs; x1 = x2; x2 = at(lo + ratio * (hi - lo)); }
    }
    return at(Math.round((lo + hi) / 2));
  };

  const describe = (startMs: number, endMs: number): EclipseEvent => {
    const deepest = closest(startMs, endMs);
    const event: EclipseEvent = {
      startMs, endMs, maxAtMs: deepest.tMs,
      maxCoveredFraction: lensFraction(deepest.separationDeg, deepest.sunRadiusDeg, deepest.earthDiscDeg),
      totalStartMs: null, totalEndMs: null,
    };
    if (deepest.earthDiscDeg >= deepest.sunRadiusDeg && total(deepest)) {
      event.totalStartMs = total(at(startMs)) ? startMs : crossing(startMs, deepest.tMs, total);
      event.totalEndMs = total(at(endMs)) ? endMs : crossing(endMs, deepest.tMs, total);
    }
    return event;
  };

  const events: EclipseEvent[] = [];
  let outside: DiscState | null = null;
  let current = at(fromMs);
  for (;;) {
    if (covering(current)) {
      const startMs = outside === null ? current.tMs : crossing(outside.tMs, current.tMs, covering);
      let inside = current;
      let endMs = toMs;
      while (inside.tMs < toMs) {
        const next = at(Math.min(toMs, inside.tMs + jumpMs(outerGapDeg(inside))));
        if (!covering(next)) { endMs = crossing(next.tMs, inside.tMs, covering); current = next; break; }
        inside = next; current = next;
      }
      if (endMs > startMs) events.push(describe(startMs, endMs));
    }
    if (current.tMs >= toMs) break;
    outside = current;
    current = at(Math.min(toMs, current.tMs + jumpMs(outerGapDeg(current))));
  }
  return events;
}

/** Where a quantity sampled at two instants crosses zero, by linear interpolation. */
function zeroBetween(t0: number, g0: number, t1: number, g1: number): number {
  return t0 + ((t1 - t0) * g0) / (g0 - g1);
}

/**
 * The eclipses during a sampled series, from its samples alone (no ephemeris
 * call): the intervals in which the Earth's disc overlaps the Sun's, with the
 * contacts interpolated between samples and the deepest moment found from the
 * three samples around the smallest separation. findEclipses gives the contacts
 * to the second; here they are as good as a straight line between two samples.
 * Measured with samples ten minutes apart (73 eclipses, docs/engine/eclipses.md):
 * first and last contact within 25 seconds, the ends of totality usually within
 * 20 seconds but up to two minutes inside the true ones when totality is brief.
 * An eclipse shorter than the sampling step can be missed, like any other event.
 */
export function eclipsesInSeries(series: Series): EclipseEvent[] {
  const n = series.n, t = series.timesMs;
  // Separation minus the sum of the radii (below zero: some of the Sun is covered) and minus their difference
  // (zero or below: all of it is). Left at infinity for samples nowhere near an eclipse.
  const outer = new Float64Array(n).fill(Infinity), inner = new Float64Array(n).fill(Infinity);
  const separation = new Float64Array(n).fill(Infinity);
  for (let i = 0; i < n; i++) {
    const a = series.sunRadius[i]!, earthRadius = series.earthRadius[i]!;
    const stepH = Math.max(i > 0 ? t[i]! - t[i - 1]! : 0, i < n - 1 ? t[i + 1]! - t[i]! : 0) / HOUR_MS;
    // Samples next to an eclipse are needed too, to interpolate its contacts.
    const reach = a + 1.02 * earthRadius + MAX_SEPARATION_RATE_DEG_PER_H * stepH;
    if (Math.abs(series.earthEl[i]! - series.sunEl[i]!) >= reach) continue;
    const d = offsetUnchecked(series.sunAz[i]!, series.sunEl[i]!, series.earthAz[i]!, series.earthEl[i]!).separationDeg;
    const b = enlargeUnchecked(earthRadius);
    separation[i] = d; outer[i] = d - (a + b); inner[i] = d - (b - a);
  }
  const events: EclipseEvent[] = [];
  for (let i = 0; i < n;) {
    if (!(outer[i]! < 0)) { i++; continue; }
    let j = i;
    while (j + 1 < n && outer[j + 1]! < 0) j++;
    // Samples i..j are inside the eclipse.
    const startMs = i > 0 && Number.isFinite(outer[i - 1]!) ? zeroBetween(t[i - 1]!, outer[i - 1]!, t[i]!, outer[i]!) : t[i]!;
    const endMs = j < n - 1 && Number.isFinite(outer[j + 1]!) ? zeroBetween(t[j]!, outer[j]!, t[j + 1]!, outer[j + 1]!) : t[j]!;
    let k = i;
    for (let m = i; m <= j; m++) if (separation[m]! < separation[k]!) k = m;
    let maxAtMs = t[k]!, closest = separation[k]!;
    if (k > 0 && k < n - 1 && Number.isFinite(separation[k - 1]!) && Number.isFinite(separation[k + 1]!)) {
      // Vertex of the parabola through the three samples around the smallest separation.
      const x0 = t[k - 1]! - t[k]!, x2 = t[k + 1]! - t[k]!;
      const y0 = separation[k - 1]! - closest, y2 = separation[k + 1]! - closest;
      const curvature = (y0 * x2 - y2 * x0) / (x0 * x2 * (x0 - x2));
      const slope = (y0 - curvature * x0 * x0) / x0;
      if (curvature > 0) {
        const x = Math.min(x2, Math.max(x0, -slope / (2 * curvature)));
        maxAtMs = t[k]! + x;
        closest = Math.max(0, closest + slope * x + curvature * x * x);
      }
    }
    const a = series.sunRadius[k]!, b = enlargeUnchecked(series.earthRadius[k]!);
    const event: EclipseEvent = {
      startMs, endMs, maxAtMs, maxCoveredFraction: lensFraction(closest, a, b), totalStartMs: null, totalEndMs: null,
    };
    let first = -1, last = -1;
    for (let m = i; m <= j; m++) if (inner[m]! <= 0) { if (first < 0) first = m; last = m; }
    if (first >= 0) {
      event.totalStartMs = first > 0 && inner[first - 1]! > 0 && Number.isFinite(inner[first - 1]!)
        ? zeroBetween(t[first - 1]!, inner[first - 1]!, t[first]!, inner[first]!) : t[first]!;
      event.totalEndMs = last < n - 1 && inner[last + 1]! > 0 && Number.isFinite(inner[last + 1]!)
        ? zeroBetween(t[last]!, inner[last]!, t[last + 1]!, inner[last + 1]!) : t[last]!;
      event.maxCoveredFraction = 1;
    }
    if (event.endMs > event.startMs) events.push(event);
    i = j + 1;
  }
  return events;
}
