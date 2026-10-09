// Additive glow-sprite pool. Small bright things — a satellite pulse, the receiver,
// a solved fix — are drawn as soft points of light with a two-term radial falloff:
// a tight core plus a wide faint halo, never a hard disc. So they read as *lit*
// rather than pasted onto the picture.
//
// One gl.POINTS actor in the 'transparent' layer, blended additively
// (SRC_ALPHA, ONE) for the duration of its draw. Depth testing stays on, so any
// glow that falls behind the Earth is hidden by the globe's depth buffer.
//
// Positions arrive in KILOMETRES; 1 world unit = 1000 km, so they are converted.

import { mat4, identity } from '../engine/mat4.js';

const VS = `#version 300 es
in vec3 position;
in float size;
in vec4 color;
uniform mat4 proj, view, model;
uniform float scale;
out vec4 vColor;
out float vSize;
void main() {
  vec4 p = model * vec4(position, 1.0);
  gl_Position = proj * view * p;
  gl_PointSize = size * scale;
  vColor = color;
  vSize = size;
}
`;

const FS = `#version 300 es
precision highp float;
in vec4 vColor;
in float vSize;
out vec4 outColor;
void main() {
  if (vSize <= 0.0) discard;                        // an unused slot draws nothing
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d) * 2.0;                        // 0 at the centre, 1 at the rim
  if (r > 1.0) discard;                             // round, never a square
  float core = pow(max(1.0 - r, 0.0), 3.0);         // soft, tight core
  float halo = pow(max(1.0 - r, 0.0), 0.7) * 0.35;  // wide, faint halo
  float a = clamp(core + halo, 0.0, 1.0);
  outColor = vec4(vColor.rgb * a, vColor.a);        // SRC_ALPHA x rgb is added
}
`;

const KM = 1 / 1000; // kilometres -> world units

/**
 * createGlowPool(stage, { max }) -> { set, hide, clear, count, actor }
 *   set(i, posKm, sizePx, color)  place sprite i (colour [r,g,b] or [r,g,b,a])
 *   hide(i)                       stop drawing sprite i
 *   clear()                       forget every sprite
 *   count()                       how many sprites are currently live
 *   actor                         the underlying stage actor (already added)
 */
export function createGlowPool(stage, opts = {}) {
  const gl = stage.gl;
  const max = Math.max(1, opts.max ?? 64);
  const defSize = opts.size ?? 16;

  // Preallocated once; every mutation edits these in place, so no per-frame
  // allocation ever happens.
  const pos = new Float32Array(max * 3);
  const siz = new Float32Array(max);
  const col = new Float32Array(max * 4);
  const on = new Uint8Array(max);

  const prog = stage.program('glow', VS, FS);
  const posBuf = stage.buffer(pos, gl.ARRAY_BUFFER);
  const sizeBuf = stage.buffer(siz, gl.ARRAY_BUFFER);
  const colBuf = stage.buffer(col, gl.ARRAY_BUFFER);
  const vao = stage.vao((g) => {
    const bind = (buf, name, comps) => {
      g.bindBuffer(g.ARRAY_BUFFER, buf);
      const loc = g.getAttribLocation(prog.program, name);
      g.enableVertexAttribArray(loc);
      g.vertexAttribPointer(loc, comps, g.FLOAT, false, 0, 0);
    };
    bind(posBuf, 'position', 3);
    bind(sizeBuf, 'size', 1);
    bind(colBuf, 'color', 4);
  });

  const model = identity(mat4());
  let live = 0;
  let dirty = true;

  function upload() {
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
    gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, siz);
    gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, col);
    dirty = false;
  }

  const actor = {
    visible: true,
    // every slot is drawn; unused ones carry size 0 and are discarded in the shader
    count: max,
    draw(g) {
      if (live === 0 && !dirty) return;
      if (dirty) upload();
      g.gl.useProgram(prog.program);
      g.gl.uniformMatrix4fv(prog.u('proj'), false, g.proj);
      g.gl.uniformMatrix4fv(prog.u('view'), false, g.view);
      g.gl.uniformMatrix4fv(prog.u('model'), false, model);
      g.gl.uniform1f(prog.u('scale'), g.dpr);
      // The layer set SRC_ALPHA / ONE_MINUS_SRC_ALPHA before this actor; glows add.
      g.gl.blendFunc(g.gl.SRC_ALPHA, g.gl.ONE);
      g.gl.bindVertexArray(vao);
      g.gl.drawArrays(g.gl.POINTS, 0, max);
      g.gl.bindVertexArray(null);
      // put the layer's own blend back so later actors blend as the stage expects
      g.gl.blendFunc(g.gl.SRC_ALPHA, g.gl.ONE_MINUS_SRC_ALPHA);
    }
  };
  stage.add(actor, 'transparent');

  const api = {
    actor,
    set(i, posKm, sizePx, color) {
      if (i < 0 || i >= max || !posKm) return api;
      pos[i * 3] = posKm[0] * KM;
      pos[i * 3 + 1] = posKm[1] * KM;
      pos[i * 3 + 2] = posKm[2] * KM;
      siz[i] = (typeof sizePx === 'number' && sizePx > 0) ? sizePx : defSize;
      if (color) {
        col[i * 4] = color[0];
        col[i * 4 + 1] = color[1];
        col[i * 4 + 2] = color[2];
        col[i * 4 + 3] = color.length > 3 ? color[3] : 1;
      }
      if (!on[i]) { on[i] = 1; live++; }
      dirty = true;
      return api;
    },
    hide(i) {
      if (i >= 0 && i < max && on[i]) {
        on[i] = 0;
        siz[i] = 0;
        live--;
        dirty = true;
      }
      return api;
    },
    clear() {
      on.fill(0);
      siz.fill(0);
      live = 0;
      dirty = true;
      return api;
    },
    count() { return live; }
  };
  return api;
}
