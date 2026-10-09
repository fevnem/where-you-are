// Satellite bodies: one small spacecraft per constellation slot, drawn as real
// geometry (a bus, two solar-array wings, an antenna) rather than a marker sphere.
//
// This is a self-wiring polish module: `apply(globalCtx)` builds the meshes, the
// vertex-buffer pool and the per-frame updater once, and returns a handle that the
// shell stores on `globalCtx.state`. Bodies live in the 'opaque' layer and are drawn
// with a per-instance rotation, so each one can hold a plausible attitude:
//
//   * +Y (local) -> the radial, so the antenna on -Y looks at the Earth;
//   * +Z (local) -> the sun component perpendicular to that radial, so the two
//     solar-array wings (in the local XY plane, normal +Z) face the sun;
//   * +X (local) -> along the wings.
//
// Units: the maths is in kilometres and 1 world unit = 1000 km. One body is drawn
// per constellation satellite (24 by default), at the Kepler ECEF positions the
// rest of the page uses, advanced over time exactly as createConstellation does.
//
// No per-frame allocation: the model matrices live in one Float32Array pool written
// in place, and every vertex buffer is uploaded exactly once.

import { constellation, satelliteEcef } from '../model/kepler.js';

const KM2U = 1 / 1000;                 // kilometres -> world units

/* The sun, in the same world frame the globe is lit from. */
const SUN = (() => {
  const s = [0.75, 0.25, 0.6];
  const l = Math.hypot(s[0], s[1], s[2]) || 1;
  return [s[0] / l, s[1] / l, s[2] / l];
})();

/* Body palette. */
const C_BODY = [0.66, 0.70, 0.77];
const C_WING = [0.13, 0.19, 0.34];
const C_DISH = [0.83, 0.85, 0.9];

/* ------------------------------------------------------------------ *
 * A tiny mesh builder: flat Float32Array position / normal / colour
 * streams and a Uint16Array index list, built once at load time.
 * ------------------------------------------------------------------ */

function makeBuilder() {
  const pos = [];
  const norm = [];
  const col = [];
  const idx = [];
  return {
    pos, norm, col, idx,
    vert(p, n, c) {
      const i = pos.length / 3;
      pos.push(p[0], p[1], p[2]);
      norm.push(n[0], n[1], n[2]);
      col.push(c[0], c[1], c[2]);
      return i;
    },
    quad(a, b, c, d, n, color) {
      const i0 = this.vert(a, n, color);
      const i1 = this.vert(b, n, color);
      const i2 = this.vert(c, n, color);
      const i3 = this.vert(d, n, color);
      idx.push(i0, i1, i2, i0, i2, i3);
    },
    tri(a, b, c, n, color) {
      const i0 = this.vert(a, n, color);
      const i1 = this.vert(b, n, color);
      const i2 = this.vert(c, n, color);
      idx.push(i0, i1, i2);
    },
    finish() {
      return {
        pos: new Float32Array(pos),
        norm: new Float32Array(norm),
        col: new Float32Array(col),
        idx: new Uint16Array(idx),
        count: idx.length
      };
    }
  };
}

/** Axis-aligned box centred at (cx,cy,cz). Winding is outward; culling is off. */
function addBox(b, w, h, d, cx, cy, cz, color) {
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const y0 = cy - h / 2, y1 = cy + h / 2;
  const z0 = cz - d / 2, z1 = cz + d / 2;
  const P = (x, y, z) => [x, y, z];
  b.quad(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), [0, 0, 1], color);
  b.quad(P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), [0, 0, -1], color);
  b.quad(P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), [1, 0, 0], color);
  b.quad(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), [-1, 0, 0], color);
  b.quad(P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0), [0, 1, 0], color);
  b.quad(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1), [0, -1, 0], color);
}

/**
 * Cylinder / cone along the local Y axis, from y0 (radius r0) to y1 (radius r1).
 * Used for the antenna mast and the dish; caps are optional.
 */
function addCylinder(b, y0, y1, r0, r1, seg, color, caps = true) {
  const dy = y1 - y0;
  const slope = (r0 - r1) / (dy || 1);
  for (let i = 0; i < seg; i++) {
    const t0 = (i / seg) * Math.PI * 2;
    const t1 = ((i + 1) / seg) * Math.PI * 2;
    const c0 = Math.cos(t0), s0 = Math.sin(t0);
    const c1 = Math.cos(t1), s1 = Math.sin(t1);
    const b0 = [r0 * c0, y0, r0 * s0], b1 = [r0 * c1, y0, r0 * s1];
    const t0v = [r1 * c0, y1, r1 * s0], t1v = [r1 * c1, y1, r1 * s1];
    const nm = (c) => {
      const nx = c, ny = slope, nz = s0;
      const l = Math.hypot(nx, ny, nz) || 1;
      return [nx / l, ny / l, nz / l];
    };
    b.quad(b0, b1, t1v, t0v, nm(c0), color);
  }
  if (caps) {
    if (r0 > 1e-4) {
      const c = [0, y0, 0];
      for (let i = 0; i < seg; i++) {
        const t0 = (i / seg) * Math.PI * 2, t1 = ((i + 1) / seg) * Math.PI * 2;
        b.tri(c, [r0 * Math.cos(t1), y0, r0 * Math.sin(t1)], [r0 * Math.cos(t0), y0, r0 * Math.sin(t0)], [0, -1, 0], color);
      }
    }
    if (r1 > 1e-4) {
      const c = [0, y1, 0];
      for (let i = 0; i < seg; i++) {
        const t0 = (i / seg) * Math.PI * 2, t1 = ((i + 1) / seg) * Math.PI * 2;
        b.tri(c, [r1 * Math.cos(t0), y1, r1 * Math.sin(t0)], [r1 * Math.cos(t1), y1, r1 * Math.sin(t1)], [0, 1, 0], color);
      }
    }
  }
}

/** The one body mesh, in local units: bus + two wings + struts + antenna. */
function buildBodyMesh() {
  const b = makeBuilder();

  // central bus
  addBox(b, 1.0, 1.05, 1.0, 0, 0, 0, C_BODY);
  // a slightly proud instrument deck on the sun side, for a little silhouette
  addBox(b, 0.7, 0.06, 0.66, 0, 0.56, 0, C_DISH);

  // two solar-array wings: thin in Z (normal +/-Z), long in X, width in Y
  const wingX = 1.55, wingLen = 1.9, wingW = 0.86, wingT = 0.05;
  addBox(b, wingLen, wingW, wingT, -wingX, 0, 0, C_WING);
  addBox(b, wingLen, wingW, wingT, wingX, 0, 0, C_WING);
  // struts out to each wing
  addBox(b, 0.16, 0.07, 0.07, -0.55, 0, 0, C_DISH);
  addBox(b, 0.16, 0.07, 0.07, 0.55, 0, 0, C_DISH);
  // a thin rib across each wing, so the panels read as panels
  addBox(b, wingLen, 0.03, 0.06, -wingX, 0, 0.03, C_DISH);
  addBox(b, wingLen, 0.03, 0.06, wingX, 0, 0.03, C_DISH);

  // antenna on -Y: a mast and a shallow dish, pointing down at the Earth
  addCylinder(b, -0.52, -1.34, 0.05, 0.05, 10, C_DISH);
  addCylinder(b, -1.52, -1.34, 0.44, 0.08, 14, C_DISH);

  return b.finish();
}

/* ------------------------------------------------------------------ *
 * Shader: the engine's lit-sphere look plus a per-vertex colour, so
 * the bus, the dark arrays and the bright dish share one draw call.
 * ------------------------------------------------------------------ */

const VS = `#version 300 es
in vec3 position;
in vec3 normal;
in vec3 aColor;
uniform mat4 proj, view, model;
out vec3 vNormal;
out vec3 vWorld;
out vec3 vColor;
void main() {
  vec4 world = model * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(model) * normal);
  vColor = aColor;
  gl_Position = proj * view * world;
}
`;

const FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
in vec3 vColor;
uniform vec3 sunDir;
uniform float rimScale;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(-vWorld);
  float lam = max(dot(n, normalize(sunDir)), 0.0);
  float fill = max(dot(n, -normalize(sunDir)), 0.0) * 0.12;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * rimScale;
  vec3 c = vColor * (0.17 + 0.95 * lam + fill) + rim * vec3(0.28, 0.45, 0.70);
  outColor = vec4(c, 1.0);
}
`;

/* ------------------------------------------------------------------ *
 * The module.
 * ------------------------------------------------------------------ */

export function apply(globalCtx) {
  const { stage } = globalCtx;
  const kepler = globalCtx.helpers.kepler;
  const state = globalCtx.state;

  if (!stage || !kepler) return null;
  if (state && state.satmodel) return state.satmodel;   // never apply twice

  const opts = (globalCtx.satmodelOptions) || {};
  const sats = kepler.constellation(opts.n ?? 24);
  const N = sats.length;
  const timeScale = opts.timeScale ?? 60;               // seconds of orbit per second
  const scale = opts.scale ?? 0.3;                      // local body units -> world units
  const epoch = opts.epoch ?? 0;

  /* -------- geometry, uploaded once -------- */
  const mesh = buildBodyMesh();
  const gl = stage.gl;
  const prog = stage.program('satbody', VS, FS);
  const vbo = stage.buffer(mesh.pos, gl.ARRAY_BUFFER);
  const nbo = stage.buffer(mesh.norm, gl.ARRAY_BUFFER);
  const cbo = stage.buffer(mesh.col, gl.ARRAY_BUFFER);
  const ibo = stage.buffer(mesh.idx, gl.ELEMENT_ARRAY_BUFFER);
  const triCount = mesh.idx.length;
  const vao = stage.vao((g) => {
    const bind = (buf, name, comps) => {
      g.bindBuffer(g.ARRAY_BUFFER, buf);
      const loc = g.getAttribLocation(prog.program, name);
      g.enableVertexAttribArray(loc);
      g.vertexAttribPointer(loc, comps, g.FLOAT, false, 0, 0);
    };
    bind(vbo, 'position', 3);
    bind(nbo, 'normal', 3);
    bind(cbo, 'aColor', 3);
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, ibo);
  });

  /* -------- the pool: N model matrices and N ECEF positions, preallocated -------- */
  const pool = new Float32Array(N * 16);         // column-major model matrices
  const posKm = new Float32Array(N * 3);         // current ECEF positions, km
  const posWorld = new Float32Array(N * 3);      // same, world units

  const actor = {
    name: 'satmodel',
    visible: true,
    count: N,
    draws: 0,
    draw(g) {
      g.gl.useProgram(prog.program);
      g.gl.uniformMatrix4fv(prog.u('proj'), false, g.proj);
      g.gl.uniformMatrix4fv(prog.u('view'), false, g.view);
      g.gl.uniform3fv(prog.u('sunDir'), SUN);
      g.gl.uniform1f(prog.u('rimScale'), 0.6);
      g.gl.bindVertexArray(vao);
      for (let i = 0; i < N; i++) {
        // WebGL2 srcOffset overload: no subarray allocation, no per-frame garbage.
        g.gl.uniformMatrix4fv(prog.u('model'), false, pool, i * 16, 16);
        g.gl.drawElements(g.gl.TRIANGLES, triCount, g.gl.UNSIGNED_SHORT, 0);
      }
      g.gl.bindVertexArray(null);
      actor.draws++;
    }
  };
  stage.add(actor, 'opaque');

  /* -------- per-body attitude + placement, written in place -------- */
  function update(t) {
    const tt = epoch + (t || 0) * timeScale;
    for (let i = 0; i < N; i++) {
      const p = satelliteEcef(sats[i], tt);         // km, ECEF
      posKm[i * 3] = p[0]; posKm[i * 3 + 1] = p[1]; posKm[i * 3 + 2] = p[2];
      const px = p[0] * KM2U, py = p[1] * KM2U, pz = p[2] * KM2U;
      posWorld[i * 3] = px; posWorld[i * 3 + 1] = py; posWorld[i * 3 + 2] = pz;

      // radial unit vector, Earth -> satellite
      const rl = Math.hypot(px, py, pz) || 1;
      const rx = px / rl, ry = py / rl, rz = pz / rl;

      // panel normal: the sun component perpendicular to the radial, so the wings
      // face the sun as closely as an Earth-pointing antenna allows.
      const sd = SUN[0] * rx + SUN[1] * ry + SUN[2] * rz;
      let zx = SUN[0] - rx * sd, zy = SUN[1] - ry * sd, zz = SUN[2] - rz * sd;
      let zl = Math.hypot(zx, zy, zz);
      if (zl < 1e-5) {
        // sun is (anti)parallel to the radial: any perpendicular will do
        const ax = Math.abs(rz) < 0.9 ? [0, 0, 1] : [1, 0, 0];
        zx = ry * ax[2] - rz * ax[1];
        zy = rz * ax[0] - rx * ax[2];
        zz = rx * ax[1] - ry * ax[0];
        zl = Math.hypot(zx, zy, zz) || 1;
      }
      zx /= zl; zy /= zl; zz /= zl;

      // X = Y x Z, with Y the radial (so the frame is right-handed and orthonormal)
      let xx = ry * zz - rz * zy;
      let xy = rz * zx - rx * zz;
      let xz = rx * zy - ry * zx;
      const xl = Math.hypot(xx, xy, xz) || 1;
      xx /= xl; xy /= xl; xz /= xl;

      const o = i * 16;
      pool[o] = xx * scale; pool[o + 1] = xy * scale; pool[o + 2] = xz * scale; pool[o + 3] = 0;
      pool[o + 4] = rx * scale; pool[o + 5] = ry * scale; pool[o + 6] = rz * scale; pool[o + 7] = 0;
      pool[o + 8] = zx * scale; pool[o + 9] = zy * scale; pool[o + 10] = zz * scale; pool[o + 11] = 0;
      pool[o + 12] = px; pool[o + 13] = py; pool[o + 14] = pz; pool[o + 15] = 1;
    }
  }

  update(0);

  /* advance every frame, whether or not a constellation chapter is active */
  if (Array.isArray(stage.onFrame)) {
    const hook = (t) => update(t);
    hook.__satmodel = true;
    stage.onFrame.push(hook);
  }

  const handle = {
    name: 'satmodel',
    actors: [actor],
    actor,
    meshes: mesh,
    satellites: sats,
    timeScale,
    scale,
    update(t) { update(typeof t === 'number' ? t : 0); return handle; },
    count() { return N; },
    setVisible(on) { actor.visible = !!on; return handle; },
    isVisible() { return actor.visible; },
    setTimeScale(k) { timeScale = k; return handle; },
    setScale(s) { scale = s; return handle; },
    /** Current ECEF position of body i, in kilometres. */
    positionKm(i) { return [posKm[i * 3], posKm[i * 3 + 1], posKm[i * 3 + 2]]; },
    /** Current position of body i in world units (1 unit = 1000 km). */
    positionWorld(i) { return [posWorld[i * 3], posWorld[i * 3 + 1], posWorld[i * 3 + 2]]; },
    /** A copy of body i's model matrix (for tools and tests). */
    matrixAt(i) { return pool.slice(i * 16, i * 16 + 16); },
    /** Frames drawn so far by the actor (one call, N bodies each). */
    draws() { return actor.draws; },
    drawCallsPerFrame() { return actor.visible ? N : 0; },
    dispose() {
      stage.remove(actor);
      if (Array.isArray(stage.onFrame)) {
        stage.onFrame = stage.onFrame.filter((f) => f.__satmodel !== true);
      }
      return handle;
    }
  };

  if (state) state.satmodel = handle;
  return handle;
}

export default apply;
