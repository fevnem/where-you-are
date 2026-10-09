// js/gl/horizon.js — the local sky as a real object in the world.
//
// Around the receiver used throughout this page (Paris, 48.8566 N 2.3522 E) a
// dome is drawn on the globe itself: an Earth-fixed horizon ring lying in the
// local tangent plane, a compass of azimuth ticks, elevation arcs at 30 and 60
// degrees, and a ring at the elevation mask. Every satellite above the horizon
// gets an arc that rises from the horizon ring up to its current position, so
// "above the mask" is something the reader can see in the 3D world and not only
// in a sky plot.
//
// Colour says which side of the mask a satellite is on: a quiet amber for the
// ones below it, gold for the ones above.
//
// This is a self-wiring polish module. apply(globalCtx) returns
//   { update(t), setReceiver(lat, lon), setMask(deg), actors, count(), ... }
// and stores itself on globalCtx.state along with a global for the tools.

import { constellation, satelliteEcef } from '../model/kepler.js';
import { geodeticToEcef, elevationAzimuth, enuBasis } from '../model/geo.js';
import * as P from './primitives.js';
import { KM, GPS_N_SATS } from '../engine/vocab.js';

const DEG = Math.PI / 180;

/* The station every chapter and the sky view share. */
const PARIS = { lat: 48.8566, lon: 2.3522, hKm: 0.035 };

const DOME_R_KM = 2000;        // dome radius, ~0.31 Earth radii
const RING_SEG = 192;          // segments in the horizon / mask rings
const ELEV_SEG = 144;          // segments in an elevation arc
const ARC_SEG = 28;            // line segments in one satellite elevation arc

const TICK_MAJOR_KM = 300;     // every 30 degrees
const TICK_MINOR_KM = 150;     // every 10 degrees
const CARDINAL_EXTRA_KM = 180; // extra length for N / E / S / W

const TIME_SCALE = 60;         // simulated seconds of orbit per real second
const EPOCH = 0;

/* Palettes: gold above the mask, amber below, cool grey for the reference grid. */
const COL_RING = [0.60, 0.72, 0.88, 0.42];
const COL_GRID = [0.52, 0.63, 0.78, 0.30];
const COL_ELEV = [0.52, 0.63, 0.78, 0.22];
const COL_MASK = [1.00, 0.78, 0.40, 0.55];
const COL_HUB = [0.45, 0.95, 0.75, 1.00];
const COL_GOLD = [1.00, 0.84, 0.45, 0.85];
const COL_AMBER = [0.80, 0.58, 0.28, 0.42];

/* ------------------------------------------------------------------ *
 * Geometry helpers. Everything is built in ECEF kilometres and only
 * converted to world units (1 unit = 1000 km) on the way into a buffer.
 * ------------------------------------------------------------------ */

/** Push one ECEF-kilometre point into a flat list as world units. */
function pushKm(out, p) {
  out.push(p[0] * KM, p[1] * KM, p[2] * KM);
}

/**
 * A closure that returns the unit direction, in ECEF, of the local sky at
 * (azimuth, elevation): the horizontal bearing blended with the local up.
 */
function makeDirAt(basis) {
  const { east, north, up } = basis;
  return function dirAt(azDeg, elDeg) {
    const az = azDeg * DEG, el = elDeg * DEG;
    const sa = Math.sin(az), ca = Math.cos(az);
    const ce = Math.cos(el), se = Math.sin(el);
    const ux = sa * east[0] + ca * north[0];
    const uy = sa * east[1] + ca * north[1];
    const uz = sa * east[2] + ca * north[2];
    return [
      ce * ux + se * up[0],
      ce * uy + se * up[1],
      ce * uz + se * up[2]
    ];
  };
}

/** A closed ring on the dome at a constant elevation, radius rKm from the site. */
function buildRing(obs, dirAt, elDeg, rKm, seg) {
  const out = [];
  for (let i = 0; i < seg; i++) {
    const d = dirAt((i / seg) * 360, elDeg);
    pushKm(out, [obs[0] + rKm * d[0], obs[1] + rKm * d[1], obs[2] + rKm * d[2]]);
  }
  return out;
}

/**
 * Azimuth ticks, drawn outward from the horizon ring so nothing ever dips under
 * the curved surface, plus a zenith pole up the middle.
 */
function buildGrid(obs, dirAt) {
  const out = [];
  for (let az = 0; az < 360; az += 10) {
    const cardinal = az % 90 === 0;
    const major = az % 30 === 0;
    const len = cardinal ? TICK_MAJOR_KM + CARDINAL_EXTRA_KM
              : major ? TICK_MAJOR_KM : TICK_MINOR_KM;
    const d = dirAt(az, 0);
    pushKm(out, [obs[0] + DOME_R_KM * d[0], obs[1] + DOME_R_KM * d[1], obs[2] + DOME_R_KM * d[2]]);
    const r2 = DOME_R_KM + len;
    pushKm(out, [obs[0] + r2 * d[0], obs[1] + r2 * d[1], obs[2] + r2 * d[2]]);
  }
  // the zenith pole
  const upv = dirAt(0, 90);
  pushKm(out, obs);
  pushKm(out, [obs[0] + DOME_R_KM * upv[0], obs[1] + DOME_R_KM * upv[1], obs[2] + DOME_R_KM * upv[2]]);
  return out;
}

/** Elevation arcs at 30 and 60 degrees, on the dome surface, as line pairs. */
function buildElevArcs(obs, dirAt, seg) {
  const out = [];
  for (const elDeg of [30, 60]) {
    let prev = null;
    for (let i = 0; i <= seg; i++) {
      const d = dirAt((i / seg) * 360, elDeg);
      const p = [obs[0] + DOME_R_KM * d[0], obs[1] + DOME_R_KM * d[1], obs[2] + DOME_R_KM * d[2]];
      if (prev) { pushKm(out, prev); pushKm(out, p); }
      prev = p;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The module.
 * ------------------------------------------------------------------ */

let applied = false;

export function apply(globalCtx) {
  const ctx0 = globalCtx || {};
  const stage = ctx0.stage;
  if (!stage) return null;
  const helpers = ctx0.helpers || {};
  const kepler = helpers.kepler;
  const geo = helpers.geo;
  if (!kepler || !geo) return null;
  if (applied) return globalThis.__horizon || null;
  applied = true;

  const sats = kepler.constellation(GPS_N_SATS);
  const n = sats.length;

  /* -------- receiver state, rebuilt whenever the site or the mask changes -------- */
  let lat = PARIS.lat, lon = PARIS.lon;
  let obs = geo.geodeticToEcef(lat, lon, PARIS.hKm);
  let basis = enuBasis(obs);
  let dirAt = makeDirAt(basis);
  let maskDeg = 10;

  /* -------- the fixed geometry, one actor per material -------- */
  const ring = P.createLines(stage, buildRing(obs, dirAt, 0, DOME_R_KM, RING_SEG), COL_RING,
    { mode: 'loop', layer: 'transparent' });
  const grid = P.createLines(stage, buildGrid(obs, dirAt), COL_GRID,
    { mode: 'lines', layer: 'transparent' });
  const elev = P.createLines(stage, buildElevArcs(obs, dirAt, ELEV_SEG), COL_ELEV,
    { mode: 'lines', layer: 'transparent' });
  const maskRing = P.createLines(stage, buildRing(obs, dirAt, maskDeg, DOME_R_KM, RING_SEG), COL_MASK,
    { mode: 'loop', layer: 'transparent' });
  const hub = P.createPoints(stage, [obs[0] * KM, obs[1] * KM, obs[2] * KM], COL_HUB,
    { size: 7, layer: 'transparent' });

  /* -------- the per-satellite arcs, two buffers by mask side -------- */
  const maxFloats = n * ARC_SEG * 2 * 3;
  const bufGold = new Float32Array(maxFloats);
  const bufAmber = new Float32Array(maxFloats);
  const arcsAbove = P.createLines(stage, [], COL_GOLD, { mode: 'lines', layer: 'transparent' });
  const arcsBelow = P.createLines(stage, [], COL_AMBER, { mode: 'lines', layer: 'transparent' });

  const actors = [ring, grid, elev, maskRing, hub, arcsAbove, arcsBelow];

  /* -------- the satellite state, written in place every frame -------- */
  const pos = new Array(n);              // ECEF km
  for (let i = 0; i < n; i++) pos[i] = [0, 0, 0];
  let sim = EPOCH;
  const state = { drawn: 0, above: 0, below: 0, minEl: null, maxEl: null };

  function fillArcs() {
    const east = basis.east, north = basis.north, up = basis.up;
    let kg = 0, ka = 0, above = 0, below = 0;
    for (let i = 0; i < n; i++) {
      const p = pos[i];
      const ea = elevationAzimuth(obs, p);
      if (!(ea.el > 0)) continue;

      const gold = ea.el >= maskDeg;
      const out = gold ? bufGold : bufAmber;
      let k = gold ? kg : ka;

      // the vertical plane through the satellite: its bearing, blended with up
      const az = ea.az * DEG, elT = ea.el * DEG;
      const sa = Math.sin(az), ca = Math.cos(az);
      const ux = sa * east[0] + ca * north[0];
      const uy = sa * east[1] + ca * north[1];
      const uz = sa * east[2] + ca * north[2];

      // start on the horizon ring, end exactly at the satellite
      const r0 = DOME_R_KM;
      let px = obs[0] + r0 * ux, py = obs[1] + r0 * uy, pz = obs[2] + r0 * uz;
      for (let s = 1; s <= ARC_SEG; s++) {
        const u = s / ARC_SEG;
        const el = elT * u;
        const ce = Math.cos(el), se = Math.sin(el);
        const r = r0 + (ea.rangeKm - r0) * u;
        const dx = ce * ux + se * up[0];
        const dy = ce * uy + se * up[1];
        const dz = ce * uz + se * up[2];
        const x = obs[0] + r * dx, y = obs[1] + r * dy, z = obs[2] + r * dz;
        out[k++] = px * KM; out[k++] = py * KM; out[k++] = pz * KM;
        out[k++] = x * KM; out[k++] = y * KM; out[k++] = z * KM;
        px = x; py = y; pz = z;
      }
      if (gold) { kg = k; above++; } else { ka = k; below++; }
      if (state.minEl === null || ea.el < state.minEl) state.minEl = ea.el;
      if (state.maxEl === null || ea.el > state.maxEl) state.maxEl = ea.el;
    }
    arcsAbove.setPositions(bufGold.subarray(0, kg));
    arcsBelow.setPositions(bufAmber.subarray(0, ka));
    state.above = above;
    state.below = below;
    state.drawn = above + below;
  }

  function rebuildStatics() {
    ring.setPositions(buildRing(obs, dirAt, 0, DOME_R_KM, RING_SEG));
    grid.setPositions(buildGrid(obs, dirAt));
    elev.setPositions(buildElevArcs(obs, dirAt, ELEV_SEG));
    maskRing.setPositions(buildRing(obs, dirAt, maskDeg, DOME_R_KM, RING_SEG));
    hub.setPositions([obs[0] * KM, obs[1] * KM, obs[2] * KM]);
  }

  /** Move the satellites to simulated time tSim (seconds). */
  function advance(tSim) {
    sim = tSim;
    for (let i = 0; i < n; i++) {
      const p = satelliteEcef(sats[i], sim);
      pos[i][0] = p[0]; pos[i][1] = p[1]; pos[i][2] = p[2];
    }
    state.minEl = null; state.maxEl = null;
    fillArcs();
  }

  /** t is real seconds from the page clock; simulated time is epoch + t*scale. */
  function update(t) {
    advance(EPOCH + (Number.isFinite(t) ? t : 0) * TIME_SCALE);
    return handle;
  }

  advance(EPOCH);

  /* self-drive: the dome tracks the sky whether or not anything calls update() */
  if (Array.isArray(stage.onFrame)) {
    const hook = (t) => update(t);
    hook.__horizon = true;
    stage.onFrame.push(hook);
  }

  const handle = {
    name: 'horizon',
    actors,
    actorCount: actors.length,
    timeScale: TIME_SCALE,
    update,

    /** Move the dome to a new site. */
    setReceiver(newLat, newLon) {
      if (Number.isFinite(newLat)) lat = newLat;
      if (Number.isFinite(newLon)) lon = newLon;
      obs = geo.geodeticToEcef(lat, lon, PARIS.hKm);
      basis = enuBasis(obs);
      dirAt = makeDirAt(basis);
      rebuildStatics();
      advance(sim);              // re-evaluate the sky from the new site
      return handle;
    },

    /** Set the elevation mask, in degrees. The mask ring moves and the arcs recolour. */
    setMask(deg) {
      const d = Number(deg);
      if (Number.isFinite(d)) maskDeg = Math.max(0, Math.min(90, d));
      maskRing.setPositions(buildRing(obs, dirAt, maskDeg, DOME_R_KM, RING_SEG));
      advance(sim);
      return handle;
    },

    setVisible(on) {
      const v = on !== false;
      for (const a of actors) a.visible = v;
      return handle;
    },

    /** Number of satellites currently drawn — one elevation arc each. */
    count() { return state.drawn; },

    receiver() { return { lat, lon, km: [obs[0], obs[1], obs[2]] }; },
    mask() { return maskDeg; },
    maskDeg() { return maskDeg; },
    epoch() { return sim; },

    /** Everything the tools and the tests want to read. */
    stats() {
      return {
        drawn: state.drawn,
        aboveMask: state.above,
        belowMask: state.below,
        maskDeg,
        minEl: state.minEl,
        maxEl: state.maxEl,
        satellites: n,
        actors: actors.length,
        receiver: [lat, lon]
      };
    },

    dispose() {
      for (const a of actors) stage.remove(a);
      if (Array.isArray(stage.onFrame)) {
        stage.onFrame = stage.onFrame.filter((f) => f.__horizon !== true);
      }
      applied = false;
      return handle;
    }
  };

  if (ctx0.state) ctx0.state.horizon = handle;
  if (typeof globalThis !== 'undefined') globalThis.__horizon = handle;
  return handle;
}

export default apply;
