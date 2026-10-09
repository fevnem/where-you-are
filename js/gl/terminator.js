// The day/night boundary made explicit.
//
//   apply(globalCtx) -> {
//     update(t), setSun(dir), actors, count(),
//     ringSegments, ringRadius, ringVertexCount(), subsolarWorld(),
//     subsolarLatLon(), sun()
//   }
//
// Two things are drawn, both read straight from the one light the world has
// (`globalCtx.state.sun`, a unit vector in world space):
//
//   (a) the terminator — the great circle of every point on the Earth exactly
//       90° from the sun. Its plane normal is the sun direction, so its radius
//       is exactly EARTH_R = 6.371 world units (1 unit = 1000 km). A thin warm
//       core ring plus a few soft halo rings read as a thin glowing edge.
//   (b) the subsolar point — the one place the sun is overhead, at
//       normalize(sun) * EARTH_R. A round point, a small tangent-plane cross
//       and a short spike towards the sun mark it.
//
// Geometry is rebuilt ONLY when the sun direction changes: per frame `update`
// compares the live direction against the last one and returns immediately if
// they match. Nothing is allocated per frame. The ring, the cross and the spike
// are positioned through 4×4 model matrices written in place, so a sun change
// is a handful of scalar writes, not a buffer re-upload.
//
// Owns only this file; it is a self-wiring module (exports `apply`) and is
// skipped harmlessly if the host never imports it.

import { EARTH_R } from '../engine/vocab.js';

const DEG = Math.PI / 180;

/** Ring tessellation. The export `ringSegments` and `ringVertexCount()` report it. */
const RING_SEGMENTS = 256;

/** Positions tuned against EARTH_R = 6.371 so the core sits exactly on the surface. */
const GLOW_OFFSETS = [0.012, 0.030, 0.060];
const GLOW_COLORS = [
  [1.00, 0.62, 0.28, 0.34],
  [1.00, 0.46, 0.20, 0.17],
  [0.95, 0.34, 0.20, 0.08]
];
const CORE_COLOR = [1.00, 0.82, 0.50, 0.95];
const POINT_COLOR = [1.00, 0.96, 0.72, 0.95];
const CROSS_COLOR = [1.00, 0.90, 0.55, 0.90];
const SPIKE_COLOR = [1.00, 0.85, 0.48, 0.60];

const MARKER_SPAN = 0.150;   // world units — half-width of the subsolar cross
const SPIKE_LEN = 0.520;     // world units — outward sun spike length

/** The light of the scene, matching js/main.js boot() so the first frame is sane. */
const DEFAULT_SUN = [0.62, 0.33, 0.71];

/* ------------------------------------------------------------------ *
 * Pure geometry. Exported so the numbers can be checked in node without
 * a GL context, and used by the drawing code below.
 * ------------------------------------------------------------------ */

/** Normalise a 3-vector into `out`; returns `out`. */
function unit(v, out) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  out[0] = v[0] / l; out[1] = v[1] / l; out[2] = v[2] / l;
  return out;
}

/** An orthonormal basis (u, v, n) with n along the unit vector `d`. */
function basisFor(d) {
  const n = unit(d, [0, 0, 0]);
  // pick a reference axis that is not parallel to n
  const ref = Math.abs(n[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  let u = [ref[1] * n[2] - ref[2] * n[1], ref[2] * n[0] - ref[0] * n[2], ref[0] * n[1] - ref[1] * n[0]];
  u = unit(u, u);
  const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  return { u, v, n };
}

/**
 * Vertices of the terminator great circle, in world units. The circle lies on
 * a sphere of `radius` centred on the origin and has plane normal `sun`, so
 * every vertex is at distance `radius` from the centre and at 90° from `sun`.
 */
export function ringPositions(sun, radius = EARTH_R, segments = RING_SEGMENTS) {
  const { u, v } = basisFor(sun);
  const out = new Float32Array(segments * 3);
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    out[i * 3] = (u[0] * c + v[0] * s) * radius;
    out[i * 3 + 1] = (u[1] * c + v[1] * s) * radius;
    out[i * 3 + 2] = (u[2] * c + v[2] * s) * radius;
  }
  return out;
}

/** The subsolar point in world units: where the sun is exactly overhead. */
export function subsolarPoint(sun, radius = EARTH_R) {
  const n = unit(sun, [0, 0, 0]);
  return [n[0] * radius, n[1] * radius, n[2] * radius];
}

/**
 * Geodetic latitude/longitude of the subsolar point, computed independently of
 * the geodesy module (spherical: lat = asin(z/|v|), lon = atan2(y, x)).
 */
export function subsolarLatLon(sun) {
  const [x, y, z] = unit(sun, [0, 0, 0]);
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, z))) / DEG,
    lon: Math.atan2(y, x) / DEG
  };
}

/* ------------------------------------------------------------------ *
 * The module hook.
 * ------------------------------------------------------------------ */

export function apply(globalCtx) {
  if (!globalCtx || !globalCtx.stage || !globalCtx.state) return null;
  const stage = globalCtx.stage;
  const state = globalCtx.state;
  const P = globalCtx.helpers && globalCtx.helpers.P;
  if (!P || typeof P.createRing !== 'function') return null;

  const actors = [];

  /* (a) the terminator: thin warm core + soft halo rings, all at radius ~EARTH_R */
  const core = P.createRing(stage, CORE_COLOR, { segments: RING_SEGMENTS, width: 2, layer: 'transparent' });
  actors.push(core);
  const glow = GLOW_OFFSETS.map((off, i) =>
    P.createRing(stage, GLOW_COLORS[i], { segments: RING_SEGMENTS, width: 1, layer: 'transparent' }));

  /* (b) the subsolar marker: a round point, a tangent cross, and a sun spike */
  const point = P.createPoints(stage, [0, 0, 0], POINT_COLOR, { size: 9, layer: 'transparent' });

  // The cross lives in the tangent plane at the subsolar point. circleMatrix maps
  // local X -> u, local Y -> v, local Z -> n and the origin -> centre, so a local
  // plus in XY is laid flat on the surface, oriented by the sun.
  const CROSS = new Float32Array([-1, 0, 0, 1, 0, 0, 0, -1, 0, 0, 1, 0]);
  const cross = P.createLines(stage, CROSS, CROSS_COLOR, { mode: 'lines', layer: 'transparent' });

  // A local segment (0,0,0) -> (0,0,1) becomes centre -> centre + n * radius:
  // a straight ray from the subsolar point out towards the sun.
  const SPIKE = new Float32Array([0, 0, 0, 0, 0, 1]);
  const spike = P.createLines(stage, SPIKE, SPIKE_COLOR, { mode: 'lines', layer: 'transparent' });

  // Two scratch model matrices, mutated in place on every sun change.
  const crossModel = new Float32Array(16);
  const spikeModel = new Float32Array(16);
  cross.model = crossModel;
  spike.model = spikeModel;

  actors.push(point, cross, spike, ...glow);

  /* ---- current sun, and the rebuild ---- */
  const sunV = new Float32Array(3);
  const subV = new Float32Array(3);
  let haveSun = false;

  function same(a, b) {
    return Math.abs(a[0] - b[0]) < 1e-9 &&
           Math.abs(a[1] - b[1]) < 1e-9 &&
           Math.abs(a[2] - b[2]) < 1e-9;
  }

  function rebuild(dir) {
    unit(dir, sunV);
    // rings: plane normal is the sun, radius is the Earth radius
    core.set([0, 0, 0], EARTH_R, sunV);
    for (let i = 0; i < glow.length; i++) {
      glow[i].set([0, 0, 0], EARTH_R + GLOW_OFFSETS[i], sunV);
    }
    // subsolar point on the surface
    subV[0] = sunV[0] * EARTH_R; subV[1] = sunV[1] * EARTH_R; subV[2] = sunV[2] * EARTH_R;
    point.setPositions([subV[0], subV[1], subV[2]]);
    P.circleMatrix(crossModel, [subV[0], subV[1], subV[2]], MARKER_SPAN, sunV);
    P.circleMatrix(spikeModel, [subV[0], subV[1], subV[2]], SPIKE_LEN, sunV);
    haveSun = true;
  }

  /* ---- public surface ---- */
  const api = {
    /** Mounted drawables. */
    actors,

    /** Number of drawables this module put on the stage. */
    count() { return actors.length; },

    /** Ring tessellation (vertex count of the terminator circle). */
    ringSegments: RING_SEGMENTS,
    ringVertexCount() { return RING_SEGMENTS; },

    /** Ring radius in world units — exactly the Earth radius. */
    ringRadius: EARTH_R,

    /** Move the light. Geometry rebuilds once; nothing else changes. */
    setSun(dir) {
      if (dir) rebuild(dir);
      return api;
    },

    /** Current sun direction (unit vector), or null before the first update. */
    sun() { return haveSun ? [sunV[0], sunV[1], sunV[2]] : null; },

    /** Subsolar point in world units, or null before the first update. */
    subsolarWorld() { return haveSun ? [subV[0], subV[1], subV[2]] : null; },

    /** Subsolar latitude/longitude in degrees, spherically computed. */
    subsolarLatLon() { return haveSun ? subsolarLatLon(sunV) : null; },

    /**
     * Per frame: read the scene light and rebuild only when it has moved.
     * Allocations happen on a sun change, never on a steady frame.
     */
    update(_t) {
      const s = state.sun || DEFAULT_SUN;
      if (haveSun && same(s, sunV)) return api;
      rebuild(s);
      return api;
    }
  };

  // If the host already published the sun (it usually does before this runs),
  // build straight away so the very first drawn frame already has the terminator.
  rebuild(state.sun || DEFAULT_SUN);

  // Self-wire: the host stores our handle but does not promise to call update(t)
  // for apply-style modules, so follow the light ourselves. On a steady frame this
  // is one vector compare and nothing else.
  if (Array.isArray(stage.onFrame)) {
    stage.onFrame.push(() => api.update(stage.time));
  }
  return api;
}

export default apply;
