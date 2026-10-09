// A starfield that behaves: stars are drawn opaque so the Earth occludes the ones
// behind it, with a soft radial falloff of their own so they read as points of light
// rather than square pixels. Deterministic (seeded), so screenshots are stable.

import { mat4, identity } from '../engine/mat4.js';

const VS = `#version 300 es
in vec3 position;
in float size;
in vec3 tint;
uniform mat4 proj, view;
uniform float scale;
out vec3 vTint;
out float vSize;
void main() {
  gl_Position = proj * view * vec4(position, 1.0);
  gl_PointSize = size * scale;
  vTint = tint;
  vSize = size;
}
`;

const FS = `#version 300 es
precision highp float;
in vec3 vTint;
in float vSize;
uniform float brightness;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float core = pow(1.0 - r, 3.0);
  float halo = pow(1.0 - r, 0.9) * 0.35;
  float a = clamp(core + halo, 0.0, 1.0);
  outColor = vec4(vTint * brightness * a, 1.0);
}
`;

/** Small deterministic PRNG so the sky is the same every load. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * createStarfield(stage, opts) -> actor
 *   opts.count   how many stars (default 1800)
 *   opts.radius  sphere radius in world units (default 1400 — inside the far plane)
 *   opts.seed    change it for a different sky
 */
export function createStarfield(stage, opts = {}) {
  const gl = stage.gl;
  const n = opts.count ?? 1800;
  const radius = opts.radius ?? 1400;
  const rnd = mulberry32(opts.seed ?? 20261009);

  const pos = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const tint = new Float32Array(n * 3);

  // A few real bright stars get bigger, most are faint dust.
  for (let i = 0; i < n; i++) {
    // uniform on the sphere
    const u = rnd() * 2 - 1;
    const theta = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = radius * (0.9 + rnd() * 0.1);
    pos[i * 3] = r * s * Math.cos(theta);
    pos[i * 3 + 1] = r * s * Math.sin(theta);
    pos[i * 3 + 2] = r * u;

    const bright = rnd();
    size[i] = bright > 0.995 ? 3.4 : bright > 0.94 ? 2.2 : 1.15 + rnd() * 0.5;

    // colour temperature: mostly white-blue, a few warm
    const warm = rnd();
    if (warm > 0.86) tint.set([1.0, 0.86, 0.68], i * 3);
    else if (warm < 0.14) tint.set([0.72, 0.82, 1.0], i * 3);
    else tint.set([0.94, 0.96, 1.0], i * 3);
  }

  const prog = stage.program('stars', VS, FS);
  const vao = stage.vao((g) => {
    const bind = (buf, name, comps) => {
      g.bindBuffer(g.ARRAY_BUFFER, buf);
      const loc = g.getAttribLocation(prog.program, name);
      g.enableVertexAttribArray(loc);
      g.vertexAttribPointer(loc, comps, g.FLOAT, false, 0, 0);
    };
    bind(stage.buffer(pos, g.ARRAY_BUFFER), 'position', 3);
    bind(stage.buffer(size, g.ARRAY_BUFFER), 'size', 1);
    bind(stage.buffer(tint, g.ARRAY_BUFFER), 'tint', 3);
  });

  const m = mat4();
  identity(m);
  const actor = {
    count: n,
    brightness: opts.brightness ?? 0.85,
    visible: true,
    draw(g) {
      g.gl.useProgram(prog.program);
      g.gl.uniformMatrix4fv(prog.u('proj'), false, g.proj);
      g.gl.uniformMatrix4fv(prog.u('view'), false, g.view);
      g.gl.uniform1f(prog.u('scale'), (opts.scale ?? 1) * g.dpr);
      g.gl.uniform1f(prog.u('brightness'), this.brightness);
      g.gl.bindVertexArray(vao);
      g.gl.drawArrays(g.gl.POINTS, 0, this.count);
      g.gl.bindVertexArray(null);
    }
  };
  // 'opaque' so the Earth's depth buffer occludes the stars behind it, and stars
  // never bleed through the globe.
  return stage.add(actor, 'opaque');
}
