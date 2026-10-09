// A dedicated Earth surface + atmosphere, replacing the generic lit-sphere look.
//
//   createEarth(stage, { globe, stars }) -> {
//     surfaceAdded: true, actors, update(t),
//     setSun(dir), setTerminatorSoftness(k), setAtmosphereScale(k)
//   }
//
// The surface is one opaque draw with its own fragment shader: a smooth
// Lambert terminator (never a hard edge), a warm band where day meets night,
// a specular sheen on the lit side, a deep-blue shadow side and a fresnel limb
// glow. The atmosphere is a slightly larger shell in the 'transparent' layer
// whose alpha rises toward the rim and whose colour depends on the view,
// normal and sun angles, brighter on the sunward side.
//
// Everything is procedural (no textures) and nothing is allocated per frame:
// uniform vectors and model matrices are built once and rewritten in place.
// Radius is exactly EARTH_R = 6.371 world units (1 unit = 1000 km); the real
// coastlines drawn by js/gl/globe.js are left untouched.

import { sphere } from '../engine/mesh.js';
import { EARTH_R } from '../engine/vocab.js';
import { HEAD } from '../engine/shader.js';

/** Unit-sphere normals from the mesh positions (sphere is centred on origin). */
function withNormals(mesh) {
  const n = mesh.pos.length;
  const norm = new Float32Array(n);
  for (let i = 0; i < n; i += 3) {
    const x = mesh.pos[i], y = mesh.pos[i + 1], z = mesh.pos[i + 2];
    const l = Math.hypot(x, y, z) || 1;
    norm[i] = x / l; norm[i + 1] = y / l; norm[i + 2] = z / l;
  }
  return { pos: mesh.pos, idx: mesh.idx, norm };
}

const VS_EARTH = HEAD() + `
in vec3 position;
in vec3 normal;
uniform mat4 proj, view, model;
out vec3 vNormal;
out vec3 vWorld;
void main() {
  vec4 world = model * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(model) * normal);
  gl_Position = proj * view * world;
}
`;

const FS_EARTH = HEAD() + `
in vec3 vNormal;
in vec3 vWorld;
uniform vec4 color;
uniform vec3 sunDir;
uniform vec3 cameraPos;
uniform float softness;
uniform float exposure;
out vec4 outColor;

/* ---- value noise, purely procedural, no textures ---- */
float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i + vec3(0.0, 0.0, 0.0)), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPos - vWorld);
  vec3 sun = normalize(sunDir);

  /* procedural albedo: ocean blue deepening in the basins, faint land, ice caps */
  float h = fbm(n * 2.4 + 11.0);
  float land = smoothstep(0.50, 0.63, h);
  float ice = smoothstep(0.74, 0.93, abs(n.z));
  vec3 ocean = mix(vec3(0.012, 0.05, 0.13), vec3(0.05, 0.16, 0.30),
                   smoothstep(0.30, 0.56, h));
  vec3 ground = mix(vec3(0.09, 0.15, 0.10), vec3(0.30, 0.27, 0.17),
                    smoothstep(0.55, 0.82, h));
  vec3 albedo = mix(ocean, ground, land * 0.8);
  albedo = mix(albedo, vec3(0.86, 0.90, 0.96), ice * 0.9);

  /* smooth Lambert terminator: a soft ramp, never a step */
  float s = max(softness, 0.02);
  float ndl = dot(n, sun);
  float lam = smoothstep(-s, s, ndl);

  /* deep-blue shadow side lifted into the lit side as the terminator softens */
  vec3 shadowBlue = vec3(0.014, 0.032, 0.080);
  vec3 col = albedo * (0.05 + 1.05 * lam);
  col += shadowBlue * (1.0 - lam) * (0.7 + 0.7 * albedo);

  /* warm band exactly at the terminator */
  float band = exp(-(ndl * ndl) / (s * s * 0.9));
  col += band * lam * vec3(0.85, 0.40, 0.14) * (0.5 + 0.5 * (1.0 - land));

  /* specular sheen on the lit side, strongest over water */
  vec3 hv = normalize(sun + v);
  float spec = pow(max(dot(n, hv), 0.0), 56.0) * lam * (1.0 - land * 0.6);
  col += spec * vec3(1.0, 0.96, 0.86) * 1.15;

  /* fresnel limb glow */
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.5);
  col += fres * vec3(0.30, 0.50, 0.92) * (0.25 + 0.85 * lam);

  outColor = vec4(col * exposure, color.a);
}
`;

const FS_ATMOS = HEAD() + `
in vec3 vNormal;
in vec3 vWorld;
uniform vec3 sunDir;
uniform vec3 cameraPos;
uniform vec3 dayColor;
uniform vec3 nightColor;
uniform float power;
uniform float alpha;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPos - vWorld);
  vec3 sun = normalize(sunDir);

  float rim = pow(1.0 - abs(dot(n, v)), power);   /* rises toward the limb */
  float sunward = dot(n, sun);                    /* -1 shadow .. 1 sunward */
  float day = smoothstep(-0.35, 0.55, sunward);

  vec3 col = mix(nightColor, dayColor, day);
  float a = alpha * rim * (0.16 + 0.95 * day);    /* brighter sunward */
  outColor = vec4(col, a);
}
`;

/** A uniform-scale matrix in place (column-major), written into `out`. */
function scaleMat(out, sx, sy, sz) {
  out[0] = sx; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = sy; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[10] = sz; out[11] = 0;
  out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
  return out;
}

export function createEarth(stage, opts = {}) {
  const gl = stage.gl;

  /* ---------- surface ---------- */
  const surfaceMesh = withNormals(sphere(EARTH_R, opts.seg ?? 128, opts.rings ?? 64));
  const surfProg = stage.program('earthSurface', VS_EARTH, FS_EARTH);
  const surfVbo = stage.buffer(surfaceMesh.pos, gl.ARRAY_BUFFER);
  const surfNbo = stage.buffer(surfaceMesh.norm, gl.ARRAY_BUFFER);
  const surfIbo = stage.buffer(surfaceMesh.idx, gl.ELEMENT_ARRAY_BUFFER);
  const surfVao = stage.vao((g) => {
    g.bindBuffer(g.ARRAY_BUFFER, surfVbo);
    let loc = g.getAttribLocation(surfProg.program, 'position');
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 3, g.FLOAT, false, 0, 0);
    g.bindBuffer(g.ARRAY_BUFFER, surfNbo);
    loc = g.getAttribLocation(surfProg.program, 'normal');
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 3, g.FLOAT, false, 0, 0);
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, surfIbo);
  });
  const surfCount = surfaceMesh.idx.length;

  const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  /* ---------- fixed-size scratch, never reallocated per frame ---------- */
  const sunVec = new Float32Array(3);
  const camVec = new Float32Array(3);
  const surfColor = (opts.color ?? [1, 1, 1, 1]).slice();

  /* initial sun, roughly matching the globe default (0.75, 0.25, 0.6) */
  let softness = opts.softness ?? 0.22;
  /* Photometric gain. The procedural albedo is deliberately physical — deep ocean
     is ~0.012 — so at gain 1 the planet renders far darker than a screen wants.
     The host sets this to bring the lit hemisphere into a readable range. */
  let exposure = opts.exposure ?? 1.0;
  {
    const d = opts.sun ?? [0.75, 0.25, 0.6];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    sunVec[0] = d[0] / l; sunVec[1] = d[1] / l; sunVec[2] = d[2] / l;
  }

  const surface = {
    color: surfColor,
    visible: true,
    draw(g) {
      const c = g.camera && g.camera.eye ? g.camera.eye : null;
      if (c) { camVec[0] = c[0]; camVec[1] = c[1]; camVec[2] = c[2]; }
      gl.useProgram(surfProg.program);
      gl.uniformMatrix4fv(surfProg.u('proj'), false, g.proj);
      gl.uniformMatrix4fv(surfProg.u('view'), false, g.view);
      gl.uniformMatrix4fv(surfProg.u('model'), false, identity);
      gl.uniform4fv(surfProg.u('color'), this.color);
      gl.uniform3fv(surfProg.u('sunDir'), sunVec);
      gl.uniform3fv(surfProg.u('cameraPos'), camVec);
      gl.uniform1f(surfProg.u('softness'), softness);
      gl.uniform1f(surfProg.u('exposure'), exposure);
      gl.bindVertexArray(surfVao);
      gl.drawElements(gl.TRIANGLES, surfCount, gl.UNSIGNED_SHORT, 0);
      gl.bindVertexArray(null);
    }
  };
  stage.add(surface, 'opaque');

  /* ---------- atmosphere shell (transparent layer) ---------- */
  const ATM_BASE = opts.atmosphereScale ?? 1.07;
  const atmMesh = withNormals(sphere(1, 96, 48));
  const atmProg = stage.program('earthAtmosphere', VS_EARTH, FS_ATMOS);
  const atmVbo = stage.buffer(atmMesh.pos, gl.ARRAY_BUFFER);
  const atmNbo = stage.buffer(atmMesh.norm, gl.ARRAY_BUFFER);
  const atmIbo = stage.buffer(atmMesh.idx, gl.ELEMENT_ARRAY_BUFFER);
  const atmVao = stage.vao((g) => {
    g.bindBuffer(g.ARRAY_BUFFER, atmVbo);
    let loc = g.getAttribLocation(atmProg.program, 'position');
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 3, g.FLOAT, false, 0, 0);
    g.bindBuffer(g.ARRAY_BUFFER, atmNbo);
    loc = g.getAttribLocation(atmProg.program, 'normal');
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 3, g.FLOAT, false, 0, 0);
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, atmIbo);
  });
  const atmCount = atmMesh.idx.length;

  const dayColor = (opts.atmosphereDay ?? [0.55, 0.72, 1.0]).slice();
  const nightColor = (opts.atmosphereNight ?? [0.10, 0.16, 0.34]).slice();
  const atmPower = opts.atmospherePower ?? 2.6;
  const atmAlpha = opts.atmosphereAlpha ?? 0.9;

  /* radius = EARTH_R * k, k adjustable through setAtmosphereScale */
  let atmScale = ATM_BASE;
  const atmModel = new Float32Array(16);
  scaleMat(atmModel, EARTH_R * atmScale, EARTH_R * atmScale, EARTH_R * atmScale);

  const atmosphere = {
    visible: true,
    draw(g) {
      const c = g.camera && g.camera.eye ? g.camera.eye : null;
      if (c) { camVec[0] = c[0]; camVec[1] = c[1]; camVec[2] = c[2]; }
      gl.useProgram(atmProg.program);
      gl.uniformMatrix4fv(atmProg.u('proj'), false, g.proj);
      gl.uniformMatrix4fv(atmProg.u('view'), false, g.view);
      gl.uniformMatrix4fv(atmProg.u('model'), false, atmModel);
      gl.uniform3fv(atmProg.u('sunDir'), sunVec);
      gl.uniform3fv(atmProg.u('cameraPos'), camVec);
      gl.uniform3fv(atmProg.u('dayColor'), dayColor);
      gl.uniform3fv(atmProg.u('nightColor'), nightColor);
      gl.uniform1f(atmProg.u('power'), atmPower);
      gl.uniform1f(atmProg.u('alpha'), atmAlpha);
      gl.bindVertexArray(atmVao);
      gl.drawElements(gl.TRIANGLES, atmCount, gl.UNSIGNED_SHORT, 0);
      gl.bindVertexArray(null);
    }
  };
  stage.add(atmosphere, 'transparent');

  return {
    surfaceAdded: true,
    actors: [surface, atmosphere],

    /** No per-frame work beyond what the stage already does. Deterministic. */
    update(_t) { return this; },

    /** Move the light. Kept normalised; the surface and shell both follow. */
    setSun(dir) {
      if (!dir) return this;
      const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      sunVec[0] = dir[0] / l; sunVec[1] = dir[1] / l; sunVec[2] = dir[2] / l;
      return this;
    },

    /** Softness of the Lambert-to-warm terminator, in units of n·sun. */
    setTerminatorSoftness(k) {
      softness = Math.max(0.002, Number(k) || 0);
      return this;
    },

    /** Photometric gain for the lit surface (1 = physically dark, ~3 = screen). */
    setExposure(k) {
      exposure = Math.max(0, Number(k));
      if (!Number.isFinite(exposure)) exposure = 1;
      return this;
    },

    /** Atmosphere radius as a multiple of EARTH_R (>= 1). */
    setAtmosphereScale(k) {
      const s = Math.max(1.0, Number(k) || ATM_BASE);
      atmScale = s;
      scaleMat(atmModel, EARTH_R * s, EARTH_R * s, EARTH_R * s);
      return this;
    }
  };
}

export default createEarth;
