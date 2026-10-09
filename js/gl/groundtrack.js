// Ground tracks: the spot on the Earth directly beneath each GPS satellite,
// traced over the last orbital period and drawn as a fading arc on the surface.
//
// The sub-satellite point is the satellite position converted ECEF -> geodetic
// (ecefToGeodetic), then dropped onto a sphere just above the ellipsoid at
// radius EARTH_R * 1.002. Twenty-four satellites, one orbital period (43 082 s),
// gives the familiar lattice of inclined arcs that cross at the equator.
//
// The tracks advance on the same clock the chapters use (60 s of orbit per real
// second), but the vertex buffers are rebuilt only every 0.5 s of *simulated*
// time, and never more than a few times a real second. Between rebuilds the
// per-frame path only compares two numbers, so nothing is allocated per frame.
//
// Self-wiring: `apply(globalCtx)` returns { update(t), setVisible(bool),
// count(), actors }. `update(t)` takes simulated seconds.

import { constellation, satelliteEcef, period } from '../model/kepler.js';
import { ecefToGeodetic, geodeticToEcef } from '../model/geo.js';
import { EARTH_R, GPS_N_SATS } from '../engine/vocab.js';

/* Vertex shader: carries a per-vertex alpha so the tail of the arc can fade. */
const VS_TRACK = `#version 300 es
in vec3 position;
in float alpha;
uniform mat4 proj, view, model;
out float vAlpha;
void main() {
  vAlpha = alpha;
  gl_Position = proj * view * model * vec4(position, 1.0);
}
`;

const FS_TRACK = `#version 300 es
precision highp float;
in float vAlpha;
uniform vec4 color;
out vec4 outColor;
void main() { outColor = vec4(color.rgb, color.a * vAlpha); }
`;

const SAMPLES = 180;                 // line segments per track -> 181 vertices
const VERTS = SAMPLES + 1;
const TRACK_R = EARTH_R * 1.002;     // a little above the surface, world units
const TIME_SCALE = 60;               // simulated seconds per real second
const REFRESH_SIM_S = 0.5;           // rebuild after this much simulated time
const MIN_REFRESH_MS = 250;          // ...but at most ~4 rebuilds a real second
const TRACK_COLOR = [0.42, 0.96, 0.78, 1];
const ALPHA_MIN = 0.05;              // the oldest end of the trail
const ALPHA_MAX = 0.55;              // the newest, right under the satellite

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** One line-strip actor with a per-vertex alpha attribute. */
function createTrackActor(stage, alphas, color) {
  const gl = stage.gl;
  const prog = stage.program('groundtrack', VS_TRACK, FS_TRACK);
  const posBuf = stage.buffer(new Float32Array(VERTS * 3), gl.ARRAY_BUFFER);
  const alphaBuf = stage.buffer(new Float32Array(alphas), gl.ARRAY_BUFFER);
  const vao = stage.vao((g) => {
    g.bindBuffer(g.ARRAY_BUFFER, posBuf);
    let loc = g.getAttribLocation(prog.program, 'position');
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 3, g.FLOAT, false, 0, 0);
    g.bindBuffer(g.ARRAY_BUFFER, alphaBuf);
    loc = g.getAttribLocation(prog.program, 'alpha');
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 1, g.FLOAT, false, 0, 0);
  });
  const actor = {
    count: VERTS,
    color: color.slice(),
    width: 1,
    visible: true,
    model: IDENTITY,
    draw(g) {
      g.gl.useProgram(prog.program);
      g.gl.uniformMatrix4fv(prog.u('proj'), false, g.proj);
      g.gl.uniformMatrix4fv(prog.u('view'), false, g.view);
      g.gl.uniformMatrix4fv(prog.u('model'), false, this.model);
      g.gl.uniform4fv(prog.u('color'), this.color);
      g.gl.lineWidth(this.width);
      g.gl.bindVertexArray(vao);
      g.gl.drawArrays(g.gl.LINE_STRIP, 0, this.count);
      g.gl.bindVertexArray(null);
    },
    /** Upload world-space positions; `out` is owned by the caller and reused. */
    setPositions(out) {
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, out, gl.DYNAMIC_DRAW);
      return this;
    },
    setColor(c) { this.color = c.slice(); return this; }
  };
  return stage.add(actor, 'transparent');
}

/**
 * Mount the ground tracks on the stage. Returns the handle the contract asks for.
 */
export function apply(globalCtx) {
  const stage = globalCtx && globalCtx.stage;
  if (!stage) return null;

  const sats = constellation(GPS_N_SATS);
  const n = sats.length;
  const per = period(sats[0].a);       // 43 082 s for a = 26 560 km

  // alpha ramp, oldest -> newest, gently curved so the tail really fades
  const alphas = new Float32Array(VERTS);
  for (let k = 0; k < VERTS; k++) {
    const u = k / SAMPLES;
    alphas[k] = ALPHA_MIN + (ALPHA_MAX - ALPHA_MIN) * u * u;
  }

  const tracks = [];
  for (let i = 0; i < n; i++) tracks.push(createTrackActor(stage, alphas, TRACK_COLOR));

  // per-track scratch geometry, reused on every rebuild
  const scratch = [];
  for (let i = 0; i < n; i++) scratch.push(new Float32Array(VERTS * 3));

  let built = -Infinity;               // simulated time of the last rebuild

  function fill(i, tEnd) {
    const sat = sats[i];
    const out = scratch[i];
    const t0 = tEnd - per;             // one full period, ending now
    for (let k = 0; k < VERTS; k++) {
      const p = satelliteEcef(sat, t0 + (k / SAMPLES) * per);
      const point = ecefToGeodetic(p[0], p[1], p[2]);
      const s = geodeticToEcef(point.lat, point.lon, 0);   // km, on the ellipsoid
      const len = Math.hypot(s[0], s[1], s[2]) || 1;
      const kk = TRACK_R / len;                            // km -> world units at radius TRACK_R
      out[k * 3] = s[0] * kk;
      out[k * 3 + 1] = s[1] * kk;
      out[k * 3 + 2] = s[2] * kk;
    }
    tracks[i].setPositions(out);
  }

  function rebuild(tEnd) {
    for (let i = 0; i < n; i++) fill(i, tEnd);
    built = tEnd;
  }

  const handle = {
    actors: tracks,
    verticesPerTrack: VERTS,
    periodSeconds: per,
    timeScale: TIME_SCALE,
    count() { return tracks.length; },
    /** Simulated time of the last rebuild. */
    epoch() { return built; },
    /** t = simulated seconds. Rebuilds only once a full cadence has elapsed. */
    update(t) {
      if (Number.isFinite(t) && t - built >= REFRESH_SIM_S) rebuild(t);
      return handle;
    },
    setVisible(on) {
      const v = on !== false;
      for (let i = 0; i < tracks.length; i++) tracks[i].visible = v;
      return handle;
    },
    setColor(c) {
      for (let i = 0; i < tracks.length; i++) tracks[i].setColor(c);
      return handle;
    },
    /** First world-space vertex of track i (for tests and readouts). */
    firstVertex(i) {
      const out = scratch[i];
      return [out[0], out[1], out[2]];
    }
  };

  /* A tiny invisible actor drives the clock: the stage calls its update() once a
     frame, and it forwards simulated time to the handle. The real-time floor is
     applied here so that an explicit update(t) in a test is never throttled. */
  let sim = 0;
  let lastRealMs = -Infinity;
  stage.add({
    visible: false,
    draw() {},
    update(realT, dt) {
      sim += (dt || 0) * TIME_SCALE;
      const nowMs = (realT || 0) * 1000;
      if (sim - built >= REFRESH_SIM_S && nowMs - lastRealMs >= MIN_REFRESH_MS) {
        lastRealMs = nowMs;
        handle.update(sim);
      }
    }
  }, 'overlay');

  rebuild(0);                          // geometry is on screen from the first frame

  if (typeof globalThis !== 'undefined') globalThis.__groundTrack = handle;
  return handle;
}
