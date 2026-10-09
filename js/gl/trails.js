// Orbit trails: each GPS satellite's full orbit, drawn as one tapered, alpha-faded
// loop — brightest exactly where the satellite is now, fading away behind it.
//
// The vertex data is built once. Every ring is baked in the inertial frame
// (satelliteEcef with gmst:false), so it is a true closed circle; the whole ring is
// carried into Earth-fixed coordinates by a single model matrix, and a single
// `uPhase` uniform slides the bright head of the loop onto the satellite's current
// argument of latitude. Per frame the only writes are that one phase scalar (and the
// matrix the stage hands every actor) — nothing is rebuilt and nothing is allocated.
//
// Colour lives on a per-vertex attribute (vec3), so no two lines share a flat tint:
// the hue is stepped per orbital plane and the tone per slot. `apply(globalCtx)`
// mounts all 24 rings as a self-wiring layer on the page.

import { constellation, orbitRing, gmst } from '../model/kepler.js';
import { GPS_N_SATS } from '../engine/vocab.js';

const KM2U = 1 / 1000;          // km -> world units (1 unit = 1000 km)
const TAU = Math.PI * 2;

const VS_TRAIL = `#version 300 es
in vec3 position;
in vec3 vcolor;
in float phase;
uniform mat4 proj, view, model;
uniform float uPhase;
out vec3 vColor;
out float vAlpha;
void main() {
  // d = how far this vertex sits *behind* the satellite, 0 at the head.
  float d = fract(uPhase - phase + 1.0);
  float rel = clamp(d / 0.55, 0.0, 1.0);   // only the trailing half is bright
  float head = pow(1.0 - rel, 2.0);
  vAlpha = 0.06 + 0.79 * head;             // a faint floor keeps the full loop alive
  vColor = vcolor * (0.62 + 0.70 * head);  // and the head glows hotter
  gl_Position = proj * view * model * vec4(position, 1.0);
}
`;

const FS_TRAIL = `#version 300 es
precision highp float;
in vec3 vColor;
in float vAlpha;
out vec4 outColor;
void main() { outColor = vec4(vColor, vAlpha); }
`;

/** hue -> rgb primaries, CSS hsl() convention. */
function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hsl(h, s, l) {
  h = ((h % 1) + 1) % 1;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

/**
 * createTrails(stage, opts) -> {
 *   attach(sats), update(tSeconds), setVisible(bool), setHue(fn),
 *   actors, count(), phase(i)
 * }
 *   attach(list)   build one loop actor per satellite (list from constellation())
 *   update(t)      advance the shared phase uniform to simulated seconds t
 *   setVisible(on) show or hide every loop
 *   setHue(fn)     fn(plane, slot, k) -> hue 0..1 or [r,g,b]; rebuilds the colours
 *   count()        number of satellites carrying a trail
 */
export function createTrails(stage, opts = {}) {
  if (!stage || !stage.gl) return null;
  const gl = stage.gl;

  const samples = Math.max(16, opts.samples ?? 192);   // vertices per loop
  const timeScale = opts.timeScale ?? 60;              // simulated seconds per real second
  const width = opts.width ?? 1.4;
  const layer = opts.layer ?? 'transparent';
  const baseHue = opts.hueBase ?? 0.56;                // first plane, teal-ish
  const saturation = opts.saturation ?? 0.62;
  const prog = stage.program('trails', VS_TRAIL, FS_TRAIL);

  const actors = [];
  let sats = [];
  let time = 0;
  let visible = opts.visible !== false;
  let hueFn = typeof opts.hue === 'function' ? opts.hue : null;

  // One shared frame matrix (ECI -> ECEF), rewritten in place every frame.
  const modelArr = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  function colourAt(sat, k) {
    if (hueFn) {
      const r = hueFn(sat.plane, sat.slot, k);
      if (Array.isArray(r) || (r && typeof r === 'object' && r.length === 3)) return r;
      return hsl(r, saturation, 0.58);
    }
    const h = baseHue + sat.plane * (1 / 6);           // six planes, six hues
    const l = 0.50 + (sat.slot % 4) * 0.045;           // slots tone within a plane
    return hsl(h, saturation, l);
  }

  function makeActor(sat, index) {
    const ring = orbitRing(sat, samples, { gmst: false });
    const n = samples;                                  // ring[samples] repeats ring[0]
    const pos = new Float32Array(n * 3);
    const ph = new Float32Array(n);
    const col = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const p = ring[k];
      pos[k * 3] = p[0] * KM2U;
      pos[k * 3 + 1] = p[1] * KM2U;
      pos[k * 3 + 2] = p[2] * KM2U;
      ph[k] = k / n;
      const c = colourAt(sat, k);
      col[k * 3] = c[0];
      col[k * 3 + 1] = c[1];
      col[k * 3 + 2] = c[2];
    }

    const posBuf = stage.buffer(pos, gl.ARRAY_BUFFER);
    const phBuf = stage.buffer(ph, gl.ARRAY_BUFFER);
    const colBuf = stage.buffer(col, gl.ARRAY_BUFFER);
    const vao = stage.vao((g) => {
      g.bindBuffer(g.ARRAY_BUFFER, posBuf);
      let loc = g.getAttribLocation(prog.program, 'position');
      g.enableVertexAttribArray(loc);
      g.vertexAttribPointer(loc, 3, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, colBuf);
      loc = g.getAttribLocation(prog.program, 'vcolor');
      g.enableVertexAttribArray(loc);
      g.vertexAttribPointer(loc, 3, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, phBuf);
      loc = g.getAttribLocation(prog.program, 'phase');
      g.enableVertexAttribArray(loc);
      g.vertexAttribPointer(loc, 1, g.FLOAT, false, 0, 0);
    });

    const actor = {
      kind: 'trail',
      index,
      sat,
      count: n,
      phase: 0,             // value last written to the uPhase uniform
      width,
      visible,
      model: modelArr,
      draw(g) {
        g.gl.useProgram(prog.program);
        g.gl.uniformMatrix4fv(prog.u('proj'), false, g.proj);
        g.gl.uniformMatrix4fv(prog.u('view'), false, g.view);
        g.gl.uniformMatrix4fv(prog.u('model'), false, this.model);
        g.gl.uniform1f(prog.u('uPhase'), this.phase);
        g.gl.lineWidth(this.width);
        g.gl.bindVertexArray(vao);
        g.gl.drawArrays(g.gl.LINE_LOOP, 0, this.count);
        g.gl.bindVertexArray(null);
      },
      setColours(arr) {
        gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
        gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
        return this;
      }
    };
    stage.add(actor, layer);
    return actor;
  }

  const handle = {
    actors,
    program: prog,
    timeScale,
    samples,

    /** Build (or rebuild) one loop per satellite. Falls back to the 24-slot sky. */
    attach(list) {
      if (Array.isArray(list) && list.length) sats = list;
      else if (!sats.length) sats = constellation(opts.n ?? GPS_N_SATS);
      for (let i = 0; i < actors.length; i++) stage.remove(actors[i]);
      actors.length = 0;
      for (let i = 0; i < sats.length; i++) actors.push(makeActor(sats[i], i));
      handle.update(time);
      return handle;
    },

    /** tSeconds = simulated seconds. Writes the frame matrix and one phase per loop. */
    update(t) {
      if (Number.isFinite(t)) time = t;
      const g = gmst(time);
      const c = Math.cos(g);
      const s = Math.sin(g);
      modelArr[0] = c;  modelArr[1] = -s;   // column-major rotation about Z by -gmst
      modelArr[4] = s;  modelArr[5] = c;
      for (let i = 0; i < actors.length; i++) {
        const a = actors[i];
        let u = (a.sat.n * time) / TAU;
        u -= Math.floor(u);
        a.phase = u;
      }
      return handle;
    },

    setVisible(on) {
      visible = on !== false;
      for (let i = 0; i < actors.length; i++) actors[i].visible = visible;
      return handle;
    },

    /** fn(plane, slot, k) -> hue in 0..1, or an [r, g, b] triple. */
    setHue(fn) {
      hueFn = typeof fn === 'function' ? fn : null;
      for (let i = 0; i < actors.length; i++) {
        const a = actors[i];
        const n = a.count;
        const col = new Float32Array(n * 3);
        for (let k = 0; k < n; k++) {
          const c = colourAt(a.sat, k);
          col[k * 3] = c[0];
          col[k * 3 + 1] = c[1];
          col[k * 3 + 2] = c[2];
        }
        a.setColours(col);
      }
      return handle;
    },

    count() { return sats.length; },

    /** The phase written to loop i on the last update. */
    phase(i = 0) { return actors[i] ? actors[i].phase : 0; },

    dispose() {
      for (let i = 0; i < actors.length; i++) stage.remove(actors[i]);
      actors.length = 0;
      return handle;
    }
  };

  if (opts.sats) handle.attach(opts.sats);
  return handle;
}

/**
 * Self-wiring hook: mount the whole constellation as a live layer on the page.
 * A hidden actor advances simulated time from the real clock so the bright heads
 * keep pace with the satellites the chapters draw.
 */
export function apply(globalCtx) {
  const stage = globalCtx && globalCtx.stage;
  if (!stage || !stage.gl) return null;
  const state = globalCtx.state;
  if (state && state.trails) return state.trails;

  const trails = createTrails(stage, { samples: 160 });
  trails.attach(constellation(GPS_N_SATS));

  let sim = 0;
  const driver = {
    visible: false,
    draw() {},
    update(realT, dt) {
      sim += (dt || 0) * trails.timeScale;
      trails.update(sim);
    }
  };
  stage.add(driver, 'overlay');
  trails.driver = driver;          // exposed so the layer can be ticked by hand

  if (state) state.trails = trails;
  if (typeof globalThis !== 'undefined') globalThis.__trails = trails;
  return trails;
}
