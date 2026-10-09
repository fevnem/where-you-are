// Shared GLSL. Version and precision header live here so every program in the
// project is spelled the same way; chapters that add shaders should use HEAD().

export const HEAD = () => `#version 300 es
precision highp float;
`;

export const VS_SIMPLE = `#version 300 es
in vec3 position;
uniform mat4 proj, view, model;
uniform float pointSize;
void main() {
  vec4 p = model * vec4(position, 1.0);
  gl_Position = proj * view * p;
  gl_PointSize = pointSize;
}
`;

export const FS_FLAT = `#version 300 es
precision highp float;
uniform vec4 color;
out vec4 outColor;
void main() { outColor = color; }
`;

export const VS_POINTS = `#version 300 es
in vec3 position;
in float size;
uniform mat4 proj, view, model;
uniform float pointSize, scale;
void main() {
  vec4 p = model * vec4(position, 1.0);
  gl_Position = proj * view * p;
  gl_PointSize = pointSize * scale * size;
}
`;

export const FS_POINT = `#version 300 es
precision highp float;
uniform vec4 color;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float a = smoothstep(1.0, 0.55, r);
  outColor = vec4(color.rgb, color.a * a);
}
`;

export const FS_LIT_SPHERE = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
uniform vec4 color;
uniform vec3 lightDir;
uniform float rimScale;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(-vWorld);
  float lam = max(dot(n, normalize(lightDir)), 0.0);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * rimScale;
  vec3 c = color.rgb * (0.16 + 0.9 * lam) + rim * vec3(0.30, 0.48, 0.72);
  outColor = vec4(c, color.a);
}
`;

export const VS_LIT_SPHERE = `#version 300 es
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

export const FS_HALO = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
uniform vec4 color;
uniform float power;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(-vWorld);
  float f = pow(1.0 - max(dot(n, v), 0.0), power);
  outColor = vec4(color.rgb, color.a * f);
}
`;
