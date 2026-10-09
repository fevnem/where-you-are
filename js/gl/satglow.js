// Satellite glow: the consumer that finally lights the constellation.
//
// glow.js can draw soft additive sprites, but nothing ever placed one, so the
// satellites and the receiver still read as flat markers pasted onto the sky.
// This module owns that job: one soft glow sprite rides each of the 24
// constellation satellites — at the same ECEF positions the rest of the page
// uses, advanced on the same clock — and one larger, warmer sprite sits on the
// receiver. A gentle pulse, out of phase per satellite, makes the constellation
// breathe rather than flicker in unison.
//
// Self-wiring: `apply(globalCtx)` builds the pool once and returns
//   { update(t), count(), setVisible(bool), actors }
// where `t` is real seconds (the stage clock). Positions advance at 60 s of orbit
// per real second, matching createConstellation and the satellite bodies, so the
// glow lands exactly on the markers and bodies as they move.
//
// Nothing is allocated per frame: the ECEF positions, sizes and colours are
// written through one scratch vector into buffers the glow pool already owns.

import { createGlowPool } from './glow.js';
import { constellation, gmst } from '../model/kepler.js';
import { geodeticToEcef } from '../model/geo.js';
import { GPS_N_SATS, EARTH_R } from '../engine/vocab.js';

const TAU = Math.PI * 2;

const TIME_SCALE = 60;                 // simulated seconds of orbit per real second
const EPOCH = 0;                       // the epoch the rest of the page uses

/* The receiver: Paris, the point every chapter drops a station on. */
const RX_LAT = 48.8566;
const RX_LON = 2.3522;
const RX_H_KM = 0.035;

/* Look of the sprites. Satellites are pale, cool glints; the receiver is a
   larger, warmer beacon, so the eye can find it at once. Both colour buffers
   are allocated once and reused. */
const SAT_COLOR = new Float32Array([0.62, 0.84, 1.0, 0.9]);
const RX_COLOR = new Float32Array([1.0, 0.66, 0.28, 0.95]);
const SAT_BASE = 24;                   // px, before the device scale the pool applies
const SAT_AMP = 10;                    // px of pulse either side of the base
const RX_BASE = 46;
const RX_AMP = 6;
const PULSE_HZ = 0.42;                 // one gentle breath about every 2.4 s
const PHASE_STEP = 2.399963229728653;  // golden angle, so pulses spread out

/**
 * ECEF position (km) of one satellite at time t, written into `out` in place.
 * Mirrors kepler.satelliteEcef, including the ECI -> ECEF rotation, so the
 * sprites land on the geometry without allocating a vector per satellite.
 */
function satPos(sat, tSec, out) {
  const M = sat.m0 + sat.n * tSec;
  const xo = sat.a * Math.cos(M);
  const yo = sat.a * Math.sin(M);
  const ci = Math.cos(sat.i), si = Math.sin(sat.i);
  const x1 = xo;
  const y1 = yo * ci;
  const z1 = yo * si;
  const cO = Math.cos(sat.raan), sO = Math.sin(sat.raan);
  const x2 = x1 * cO - y1 * sO;
  const y2 = x1 * sO + y1 * cO;
  const g = gmst(tSec);
  const cg = Math.cos(g), sg = Math.sin(g);
  out[0] = x2 * cg + y2 * sg;
  out[1] = -x2 * sg + y2 * cg;
  out[2] = z1;
  return out;
}

export function apply(globalCtx) {
  const stage = globalCtx && globalCtx.stage;
  if (!stage) return null;
  if (globalCtx.state && globalCtx.state.satglow) return globalCtx.state.satglow;

  const sats = constellation(GPS_N_SATS);
  const N = sats.length;
  const pool = createGlowPool(stage, { max: N + 1 });

  /* The receiver, lifted a fraction off the surface so the sprite cannot
     z-fight the globe it sits on. */
  const rr = geodeticToEcef(RX_LAT, RX_LON, RX_H_KM);
  const rl = Math.hypot(rr[0], rr[1], rr[2]) || 1;
  const lift = (EARTH_R * 1000 * 1.004) / rl;
  const rxKm = new Float32Array([rr[0] * lift, rr[1] * lift, rr[2] * lift]);

  /* Reused every frame; never grows. */
  const scratch = new Float32Array(3);
  const lastKm = new Float32Array(N * 3);
  const phase = new Float32Array(N);
  for (let i = 0; i < N; i++) phase[i] = (i * PHASE_STEP) % TAU;

  let simTime = EPOCH;
  let visible = true;

  function update(tReal) {
    const t = Number.isFinite(tReal) ? tReal : 0;
    simTime = EPOCH + t * TIME_SCALE;
    for (let i = 0; i < N; i++) {
      satPos(sats[i], simTime, scratch);
      lastKm[i * 3] = scratch[0];
      lastKm[i * 3 + 1] = scratch[1];
      lastKm[i * 3 + 2] = scratch[2];
      const size = SAT_BASE + SAT_AMP * (0.5 + 0.5 * Math.sin(TAU * PULSE_HZ * t + phase[i]));
      pool.set(i, scratch, size, SAT_COLOR);
    }
    const rxSize = RX_BASE + RX_AMP * (0.5 + 0.5 * Math.sin(TAU * PULSE_HZ * t));
    pool.set(N, rxKm, rxSize, RX_COLOR);
    return handle;
  }

  const handle = {
    pool,
    actor: pool.actor,
    actors: [pool.actor],
    satellites: sats,
    receiverKm: rxKm,
    timeScale: TIME_SCALE,
    epoch: EPOCH,
    update,
    /** Live sprites: one per satellite, plus the receiver. */
    count() { return pool.count(); },
    satelliteCount() { return N; },
    /** Slots the pool draws each frame (unused ones are discarded in the shader). */
    actorCount() { return pool.actor.count; },
    /** Simulated seconds for the last update (t * 60). */
    simTime() { return simTime; },
    /** Current ECEF position of satellite i in km, as last written. */
    spriteKm(i) { return [lastKm[i * 3], lastKm[i * 3 + 1], lastKm[i * 3 + 2]]; },
    isVisible() { return visible; },
    setVisible(on) {
      visible = on !== false;
      pool.actor.visible = visible;
      return handle;
    },
    dispose() {
      pool.clear();
      stage.remove(pool.actor);
      if (Array.isArray(stage.onFrame)) {
        stage.onFrame = stage.onFrame.filter((f) => f.__satglow !== true);
      }
      return handle;
    }
  };

  update(0);                           // lit from the very first frame

  /* Advance with every frame, whether or not a constellation chapter is active. */
  if (Array.isArray(stage.onFrame)) {
    const hook = (t) => update(t);
    hook.__satglow = true;
    stage.onFrame.push(hook);
  }

  if (globalCtx.state) globalCtx.state.satglow = handle;
  if (typeof globalThis !== 'undefined') globalThis.__satglow = handle;
  return handle;
}

export default apply;
