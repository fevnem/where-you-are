// Orbital mechanics for the GPS constellation.
//
// Honest scope: GPS satellites fly near-circular orbits (e < 0.02), so this models
// them as circular, with the real semi-major axis (26 560 km), the real inclination
// (55°), six orbital planes at 60° spacing, and the real mean motion from
// n = sqrt(mu / a^3). Earth rotation is applied with the real rate (7.2921159e-5
// rad/s); the epoch offset is arbitrary, which only rotates the whole picture.

import { MU, GPS_A_KM, GPS_I_DEG, GPS_PERIOD_S, WGS_A } from '../engine/vocab.js';

const DEG = Math.PI / 180;
export const OMEGA_E = 7.2921159e-5;      // rad/s, Earth's rotation rate

/** The 24-slot baseline constellation: 6 planes x 4 slots. */
export function constellation(n = 24, opts = {}) {
  const a = opts.a ?? GPS_A_KM;
  const i = (opts.i ?? GPS_I_DEG) * DEG;
  const planes = 6, perPlane = Math.max(1, Math.round(n / planes));
  const sats = [];
  for (let p = 0; p < planes; p++) {
    const raan = (p * 60) * DEG;
    for (let k = 0; k < perPlane; k++) {
      sats.push({
        id: 'G' + (p * perPlane + k + 1),
        plane: p,
        slot: k,
        a,
        e: 0,
        i,
        raan,
        m0: (k * (360 / perPlane) + p * 15) * DEG,
        n: Math.sqrt(MU / (a * a * a))       // rad/s
      });
    }
  }
  return sats;
}

/** Greenwich mean sidereal angle (radians) for a time in seconds. */
export function gmst(tSec, g0 = 0) {
  return g0 + OMEGA_E * tSec;
}

/**
 * ECEF position (kilometres) of one satellite at time t (seconds).
 * Pass {gmst: false} for ECI (unrotated) coordinates.
 */
export function satelliteEcef(sat, tSec, opts = {}) {
  const M = sat.m0 + sat.n * tSec;
  // circular orbit: position in the orbital plane
  const xo = sat.a * Math.cos(M);
  const yo = sat.a * Math.sin(M);
  // inclination about the X axis
  const ci = Math.cos(sat.i), si = Math.sin(sat.i);
  const x1 = xo;
  const y1 = yo * ci;
  const z1 = yo * si;
  // right ascension of the ascending node about the Z axis
  const cO = Math.cos(sat.raan), sO = Math.sin(sat.raan);
  let x = x1 * cO - y1 * sO;
  let y = x1 * sO + y1 * cO;
  let z = z1;
  if (opts.gmst !== false) {
    // ECI -> ECEF: rotate the frame by -GMST
    const g = gmst(tSec, opts.g0 ?? 0);
    const cg = Math.cos(g), sg = Math.sin(g);
    const xr = x * cg + y * sg;
    const yr = -x * sg + y * cg;
    x = xr; y = yr;
  }
  return [x, y, z];
}

/** Positions of the whole constellation at time t (km). */
export function constellationEcef(sats, tSec, opts = {}) {
  return sats.map((s) => satelliteEcef(s, tSec, opts));
}

/** A satellite's ground track sample over one period (for drawing orbit rings). */
export function orbitRing(sat, samples = 128, opts = {}) {
  const pts = [];
  for (let k = 0; k <= samples; k++) {
    pts.push(satelliteEcef(sat, (k / samples) * GPS_PERIOD_S, opts));
  }
  return pts;
}

/** Mean motion in rad/s for an arbitrary semi-major axis (km). */
export function meanMotion(aKm) {
  return Math.sqrt(MU / (aKm * aKm * aKm));
}

/** Orbital period in seconds for an arbitrary semi-major axis (km). */
export function period(aKm) {
  return 2 * Math.PI / meanMotion(aKm);
}

export { GPS_A_KM, GPS_PERIOD_S, WGS_A };
