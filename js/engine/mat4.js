// Minimal column-major mat4 + vec3 helpers (WebGL convention: out[m] is column-major,
// i.e. out[12..14] is the translation column).

export const V3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  norm: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  lerp: (a, b, t) => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ],
  clamp: (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
};

export function mat4() {
  return new Float32Array(16);
}

export function identity(out = mat4()) {
  out.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return out;
}

export function multiply(out, a, b) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let i = 0; i < 4; i++) {
    const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
    out[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }
  return out;
}

export function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  out.set([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0
  ]);
  return out;
}

export function lookAt(out, eye, center, up) {
  let z = V3.norm(V3.sub(eye, center));
  if (V3.len(z) < 1e-9) z = [0, 0, 1];
  let x = V3.cross(up, z);
  if (V3.len(x) < 1e-9) x = [1, 0, 0];
  x = V3.norm(x);
  const y = V3.cross(z, x);
  out.set([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -V3.dot(x, eye), -V3.dot(y, eye), -V3.dot(z, eye), 1
  ]);
  return out;
}

export function translation(out, v) {
  identity(out);
  out[12] = v[0]; out[13] = v[1]; out[14] = v[2];
  return out;
}

export function scaling(out, s) {
  const x = typeof s === 'number' ? s : s[0];
  const y = typeof s === 'number' ? s : s[1];
  const z = typeof s === 'number' ? s : s[2];
  out.set([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]);
  return out;
}

/** Model matrix for a mesh centred at origin, then moved and scaled. */
export function model(out, pos, scale) {
  scaling(out, scale);
  out[12] = pos[0]; out[13] = pos[1]; out[14] = pos[2];
  return out;
}

/** Rotation about an arbitrary unit axis. */
export function fromAxisAngle(out, axis, angle) {
  const [x, y, z] = V3.norm(axis);
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  out.set([
    t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
    0, 0, 0, 1
  ]);
  return out;
}

/** Transform a point by a matrix (w = 1); returns [x, y, z]. */
export function transformPoint(m, p) {
  const x = p[0], y = p[1], z = p[2];
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14]
  ];
}

/** Project a world point to clip space; returns [x, y, z, w]. */
export function project(m, p) {
  const x = p[0], y = p[1], z = p[2];
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
    m[3] * x + m[7] * y + m[11] * z + m[15]
  ];
}
