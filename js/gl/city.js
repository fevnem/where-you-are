// Coastal city lights.
//
// Positions are derived from the bundled coastline data (COAST, 128 rings of
// lon/lat pairs) — the only source of truth for where land, and therefore
// people, are. The rings are thinned onto a coarse degree grid so the chosen
// points read as a scatter of coastal *cities* rather than noise along every
// vertex of the outline; each grid cell that a ring touches contributes one
// site, and each site grows a small deterministic cluster of one to four
// lights around itself.
//
// Every light sits a few kilometres above the WGS84 surface (1 world unit =
// 1000 km), and the whole set is drawn as one additive gl.POINTS actor. The
// fragment shader darkens each light by the dot product of its surface normal
// with the sun direction, so a light only glows where it is night and the
// day/night terminator sweeps across the globe as the sun moves.
//
// Nothing allocates per frame: buffers are built once, and update() only
// writes the sun direction into a uniform.

import { COAST } from '../data/coastline.js';
import { geodeticToEcef } from '../model/geo.js';
import { KM } from '../engine/vocab.js';
import { mat4, identity } from '../engine/mat4.js';

const VS = `#version 300 es
in vec3 position;
in float size;
in float seed;
uniform mat4 proj, view, model;
uniform float pointScale;
uniform vec3 sunDir;
uniform float edge;
out float vNight;
out float vSeed;
void main() {
  vec4 world = model * vec4(position, 1.0);
  gl_Position = proj * view * world;
  // positions are on a sphere about the origin, so the outward normal is the
  // direction of the position itself.
  vec3 n = normalize(position);
  float d = dot(n, sunDir);
  // 1 on the dark side, 0 on the lit side, with a soft band across the edge.
  vNight = smoothstep(edge, -edge, d);
  vSeed = seed;
  gl_PointSize = size * pointScale;
}
`;

const FS = `#version 300 es
precision highp float;
in float vNight;
in float vSeed;
uniform vec3 color;
uniform float brightness;
uniform float fill;
uniform float time;
out vec4 outColor;
void main() {
  if (vNight <= 0.002 || fill <= 0.0) discard;
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d) * 2.0;
  if (r > 1.0) discard;                              // round, never a square
  float core = pow(max(1.0 - r, 0.0), 3.0);          // tight core
  float halo = pow(max(1.0 - r, 0.0), 1.2) * 0.45;   // faint surrounding glow
  float a = clamp(core + halo, 0.0, 1.0);
  // a slow, deterministic flicker so the lights are alive without pulsing
  float flick = 0.82 + 0.18 * sin(time * 1.6 + vSeed * 6.2831853);
  outColor = vec4(color * brightness * vNight * flick, a * vNight);
}
`;

/** Deterministic PRNG: the same sky every load, so screenshots are stable. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function unit(v, fallback) {
  const x = v && v.length >= 3 ? v[0] : 0;
  const y = v && v.length >= 3 ? v[1] : 0;
  const z = v && v.length >= 3 ? v[2] : 1;
  const l = Math.hypot(x, y, z);
  if (l < 1e-9) return fallback.slice();
  return [x / l, y / l, z / l];
}

/**
 * Reduce the coastline rings to a deterministic set of clustered light points.
 * Returns { pos, size, seed, n } with typed arrays sized to the light count.
 */
function deriveLights(opts) {
  const rnd = mulberry32(opts.seed ?? 20261009);
  const cell = opts.cell ?? 2.4;            // degrees between city sites
  const cluster = Math.max(1, opts.cluster ?? 4);  // lights per city, at most
  const maxLights = Math.max(1, opts.max ?? 1400);
  const spread = opts.spread ?? 0.9;        // cluster radius, degrees
  const altKm = opts.altKm ?? 9;            // just above the surface
  const latCut = opts.latCut ?? 66;         // polar ice has no cities

  const tmp = [];
  const seen = new Set();
  for (let r = 0; r < COAST.length; r++) {
    const ring = COAST[r];
    for (let k = 0; k + 1 < ring.length; k += 2) {
      const lon = ring[k], lat = ring[k + 1];
      if (!isFinite(lon) || !isFinite(lat)) continue;
      if (Math.abs(lat) > latCut) continue;
      const key = Math.floor((lon + 180) / cell) + '|' + Math.floor((lat + 90) / cell);
      if (seen.has(key)) continue;
      seen.add(key);
      // one light minimum; a few more clustered around it
      const extra = Math.floor(rnd() * cluster);
      for (let c = 0; c <= extra && tmp.length < maxLights; c++) {
        const ang = rnd() * Math.PI * 2;
        const rad = Math.pow(rnd(), 1.6) * spread;   // denser at the centre
        const jLon = lon + Math.cos(ang) * rad / Math.max(0.2, Math.cos(lat * Math.PI / 180));
        const jLat = lat + Math.sin(ang) * rad;
        tmp.push([jLon, jLat]);
      }
    }
  }

  const n = tmp.length;
  const pos = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const e = geodeticToEcef(tmp[i][1], tmp[i][0], altKm);
    pos[i * 3] = e[0] * KM;
    pos[i * 3 + 1] = e[1] * KM;
    pos[i * 3 + 2] = e[2] * KM;
    size[i] = 1.25 + rnd() * 1.15;    // a little variety in apparent size
    seed[i] = rnd();
  }
  return { pos, size, seed, n };
}

/**
 * createCityLights(stage, opts) ->
 *   { update(t, sunDir), setSun(dir), setDensity(n), count(), visible }
 *
 * opts:
 *   seed      change it for a different (still deterministic) set of cities
 *   max       cap on the number of light points (default 1400)
 *   cell      city spacing in degrees (default 2.4)
 *   cluster   lights per city site, at most (default 4)
 *   sun       the initial sun direction (default matches the Earth shader)
 *   color     light tint (default a warm sodium-vapour glow)
 *   size      base point size in device pixels (default 3.2)
 *   density   0..1 initial fraction of lights shown (default 1)
 */
export function createCityLights(stage, opts = {}) {
  const gl = stage.gl;
  const { pos, size, seed, n } = deriveLights(opts);

  const color = opts.color ?? [1.0, 0.78, 0.46];
  const baseSize = opts.size ?? 3.2;
  const brightness = opts.brightness ?? 1.35;
  const edge = opts.edge ?? 0.12;          // half-width of the terminator band
  const model = identity(mat4());
  const sun = unit(opts.sun ?? [0.6, 0.35, 0.72], [0.6, 0.35, 0.72]);

  let density = clamp01(opts.density ?? 1);
  let fill = density;

  const prog = stage.program('city-lights', VS, FS);
  const posBuf = stage.buffer(pos, gl.ARRAY_BUFFER);
  const sizeBuf = stage.buffer(size, gl.ARRAY_BUFFER);
  const seedBuf = stage.buffer(seed, gl.ARRAY_BUFFER);
  const vao = stage.vao((g) => {
    const bind = (buf, name, comps) => {
      g.bindBuffer(g.ARRAY_BUFFER, buf);
      const loc = g.getAttribLocation(prog.program, name);
      g.enableVertexAttribArray(loc);
      g.vertexAttribPointer(loc, comps, g.FLOAT, false, 0, 0);
    };
    bind(posBuf, 'position', 3);
    bind(sizeBuf, 'size', 1);
    bind(seedBuf, 'seed', 1);
  });

  const actor = {
    count: n,
    visible: true,
    draw(g) {
      if (n === 0 || this.visible === false || fill <= 0) return;
      const active = Math.max(1, Math.min(n, Math.round(n * fill)));
      g.gl.useProgram(prog.program);
      g.gl.uniformMatrix4fv(prog.u('proj'), false, g.proj);
      g.gl.uniformMatrix4fv(prog.u('view'), false, g.view);
      g.gl.uniformMatrix4fv(prog.u('model'), false, model);
      g.gl.uniform1f(prog.u('pointScale'), baseSize * g.dpr);
      g.gl.uniform1f(prog.u('edge'), edge);
      g.gl.uniform3fv(prog.u('sunDir'), sun);
      g.gl.uniform3fv(prog.u('color'), color);
      g.gl.uniform1f(prog.u('brightness'), brightness);
      g.gl.uniform1f(prog.u('fill'), fill);
      g.gl.uniform1f(prog.u('time'), g.time);
      // additive, and only for the duration of this draw (the layer set
      // SRC_ALPHA / ONE_MINUS_SRC_ALPHA before it).
      g.gl.blendFunc(g.gl.SRC_ALPHA, g.gl.ONE);
      g.gl.bindVertexArray(vao);
      g.gl.drawArrays(g.gl.POINTS, 0, active);
      g.gl.bindVertexArray(null);
      g.gl.blendFunc(g.gl.SRC_ALPHA, g.gl.ONE_MINUS_SRC_ALPHA);
    }
  };
  // 'transparent' keeps the depth test on, so lights on the far side of the
  // globe are hidden by the Earth's own depth buffer.
  stage.add(actor, opts.layer ?? 'transparent');

  const api = {
    actor,
    /** Advance: optionally hand in a new sun direction with the new time. */
    update(t, sunDir) {
      if (sunDir) api.setSun(sunDir);
      return api;
    },
    /** Aim the sun. Unlit hemisphere = the side the sun does not face. */
    setSun(dir) {
      const u = unit(dir, sun);
      sun[0] = u[0]; sun[1] = u[1]; sun[2] = u[2];
      return api;
    },
    /**
     * Density: a fraction in 0..1 (or a count above 1) selecting how many of
     * the lights are drawn, so a chapter can thin a city into a village.
     */
    setDensity(v) {
      density = clamp01(v ?? 1);
      fill = density;
      return api;
    },
    /** How many city lights this module derived from the coastline. */
    count() { return n; },
    get visible() { return actor.visible !== false; },
    set visible(v) { actor.visible = !!v; }
  };
  return api;
}

function clamp01(v) {
  const x = Number(v);
  if (!isFinite(x)) return 1;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
