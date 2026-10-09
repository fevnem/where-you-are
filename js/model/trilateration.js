// The receiver's arithmetic: pseudoranges in, position out.
//
// A GPS receiver knows four numbers: the travel time of four signals, each
// multiplied by the speed of light to give a *pseudorange* — a distance that is
// wrong by a constant because the receiver's own clock is cheap:
//
//     rho_i = |p - s_i| + b
//
// with b = c * (receiver clock error). Four unknowns (x, y, z, b), so four
// satellites are the minimum. This module solves that system by Gauss-Newton on
// the exact same linearisation a real receiver uses, and it also provides the
// geometric tools the chapters draw with (sphere-sphere circles, circle-sphere
// points) so the pictures and the numbers cannot drift apart.

import { C_KM_S } from '../engine/vocab.js';
import { elevationAzimuth, enuBasis } from './geo.js';

export const rangeKm = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Solve A x = b for a small dense system by Gaussian elimination with partial pivoting. */
export function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-14) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (!f) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => M[i][n] / M[i][i]);
}

/** Invert a small matrix (used for DOP), via Gauss-Jordan. */
export function invert(M) {
  const n = M.length;
  const A = M.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-14) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    const d = A[col][col];
    for (let c = 0; c < 2 * n; c++) A[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col];
      if (!f) continue;
      for (let c = 0; c < 2 * n; c++) A[r][c] -= f * A[col][c];
    }
  }
  return A.map((row) => row.slice(n));
}

/**
 * Solve for position and clock bias.
 *   sats  : [[x,y,z], ...] satellite positions, km
 *   rho   : [km, ...] pseudoranges
 *   opts  : { start: [x,y,z], maxIter, tolKm }
 * returns { pos, biasKm, biasUs, residualKm, iterations, converged, history }
 */
export function solvePosition(sats, rho, opts = {}) {
  const maxIter = opts.maxIter ?? 30;
  const tol = opts.tolKm ?? 1e-7;
  const n = sats.length;
  if (n < 4) throw new Error('need at least 4 satellites, got ' + n);

  // Initial guess: centre of the Earth is the classic choice, but the centroid of
  // the constellation pulled down to the surface converges faster and more safely.
  let p = opts.start ? [...opts.start] : (() => {
    const c = sats.reduce((a, s) => add(a, s), [0, 0, 0]).map((v) => v / n);
    const l = Math.hypot(c[0], c[1], c[2]) || 1;
    return c.map((v) => (v / l) * 6371);
  })();
  let b = 0;
  const history = [];

  for (let iter = 0; iter < maxIter; iter++) {
    // Build J^T J and -J^T f for the current estimate.
    const JtJ = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    const Jtf = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const d = sub(p, sats[i]);
      const r = Math.hypot(d[0], d[1], d[2]) || 1e-9;
      const u = [d[0] / r, d[1] / r, d[2] / r, 1];
      const f = r + b - rho[i];
      for (let a = 0; a < 4; a++) {
        for (let c = 0; c < 4; c++) JtJ[a][c] += u[a] * u[c];
        Jtf[a] += u[a] * f;
      }
    }
    const step = solveLinear(JtJ, Jtf.map((v) => -v));
    if (!step) return { pos: p, biasKm: b, biasUs: b / C_KM_S * 1e6, residualKm: NaN, iterations: iter, converged: false, history, singular: true };
    p = [p[0] + step[0], p[1] + step[1], p[2] + step[2]];
    b += step[3];
    const stepLen = Math.hypot(step[0], step[1], step[2]);
    history.push({ iter, pos: [...p], biasKm: b, stepKm: stepLen });
    if (stepLen < tol && Math.abs(step[3]) < tol) {
      return { pos: p, biasKm: b, biasUs: b / C_KM_S * 1e6, residualKm: residual(sats, rho, p, b), iterations: iter + 1, converged: true, history };
    }
  }
  return { pos: p, biasKm: b, biasUs: b / C_KM_S * 1e6, residualKm: residual(sats, rho, p, b), iterations: maxIter, converged: false, history };
}

function residual(sats, rho, p, b, ) {
  const e = sats.map((s, i) => (rangeKm(p, s) + b - rho[i]));
  return Math.sqrt(e.reduce((a, v) => a + v * v, 0) / e.length);
}

/** Simulate a receiver: true position + clock bias -> clean pseudoranges. */
export function pseudoranges(sats, truePosKm, clockBiasKm = 0, noiseKm = 0, rng = Math.random) {
  return sats.map((s) => rangeKm(truePosKm, s) + clockBiasKm + (noiseKm ? (rng() * 2 - 1) * noiseKm : 0));
}

/** Turn a clock error in microseconds into the distance it costs. */
export const usToKm = (us) => (us * 1e-6) * C_KM_S;
export const kmToUs = (km) => (km / C_KM_S) * 1e6;

/* ------------------------------------------------------------------ *
 * Geometry the chapters draw with.                                    *
 * ------------------------------------------------------------------ */

/**
 * Two spheres intersect in a circle (or not at all).
 * returns { center, radius, normal, distance } in km, or null.
 */
export function sphereCircle(c1, r1, c2, r2) {
  const d = rangeKm(c1, c2);
  if (d < 1e-9) return null;
  if (d > r1 + r2 + 1e-9) return null;            // too far apart
  if (d < Math.abs(r1 - r2) - 1e-9) return null;  // one inside the other
  const a = (d * d + r1 * r1 - r2 * r2) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const h = h2 > 0 ? Math.sqrt(h2) : 0;
  const u = mul(sub(c2, c1), 1 / d);
  return { center: add(c1, mul(u, a)), radius: h, normal: u, distance: d };
}

/**
 * A circle on a sphere cuts it in two points. Returns both, ordered by
 * distance to `hint` (pass the truth, or the previous fix).
 */
export function circleSpherePoints(circle, c3, r3, hint) {
  const n = norm(circle.normal);
  const signed = dot(sub(c3, circle.center), n);       // height above the circle's plane
  const inPlane2 = r3 * r3 - signed * signed;
  if (inPlane2 < 0) return [];
  const R2 = Math.sqrt(inPlane2);
  const q = sub(c3, mul(n, signed));                   // projection of c3 into the plane
  const d = rangeKm(circle.center, q);
  if (d < 1e-9) {
    // concentric: any point on the circle
    const u = norm(cross(n, [0, 0, 1]));
    const p1 = add(circle.center, mul(u, circle.radius));
    return [p1];
  }
  if (d > circle.radius + R2 + 1e-9) return [];
  if (d < Math.abs(circle.radius - R2) - 1e-9) return [];
  const a = (d * d + circle.radius * circle.radius - R2 * R2) / (2 * d);
  const h2 = circle.radius * circle.radius - a * a;
  const h = h2 > 0 ? Math.sqrt(h2) : 0;
  const u = mul(sub(q, circle.center), 1 / d);
  const perp = norm(cross(n, u));
  const m = add(circle.center, mul(u, a));
  const p1 = add(m, mul(perp, h));
  const p2 = sub(m, mul(perp, h));
  if (!hint) return [p1, p2];
  return rangeKm(p1, hint) <= rangeKm(p2, hint) ? [p1, p2] : [p2, p1];
}

/** Satellites above the horizon (default 10°) as seen from an observer. */
export function visibleSats(sats, obsKm, minElDeg = 10) {
  return sats
    .map((s, i) => ({ i, ...elevationAzimuth(obsKm, s) }))
    .filter((s) => s.el >= minElDeg)
    .sort((a, b) => b.el - a.el);
}

/** Dilution of precision from the local geometry. Smaller is better. */
export function dop(sats, obsKm) {
  const H = sats.map((s) => {
    const [e, n2, u] = toLocalEnu(obsKm, s);
    const L = Math.hypot(e, n2, u) || 1;
    return [e / L, n2 / L, u / L, 1];
  });
  const HtH = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (const r of H) {
    for (let a = 0; a < 4; a++) for (let c = 0; c < 4; c++) HtH[a][c] += r[a] * r[c];
  }
  const Q = invert(HtH);
  if (!Q) return null;
  return {
    gdop: Math.sqrt(Q[0][0] + Q[1][1] + Q[2][2] + Q[3][3]),
    pdop: Math.sqrt(Q[0][0] + Q[1][1] + Q[2][2]),
    hdop: Math.sqrt(Q[0][0] + Q[1][1]),
    vdop: Math.sqrt(Q[2][2]),
    tdop: Math.sqrt(Q[3][3])
  };
}

function toLocalEnu(obsKm, targetKm) {
  const b = enuBasis(obsKm);
  const d = sub(targetKm, obsKm);
  return [dot(d, b.east), dot(d, b.north), dot(d, b.up)];
}

export const C = C_KM_S;
