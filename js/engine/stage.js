// WebGL2 stage: program cache, buffers, layers, and the frame loop.
// Chapters never touch raw GL: they compose actors, which the stage draws in layers.
//
// Layer order and state (fixed, so an actor cannot break another's blending):
//   'opaque'      depth test on, depth write on, no blending   (solid bodies)
//   'transparent' depth test on, depth write OFF, blending on  (range spheres, glows)
//   'overlay'     depth test OFF, blending on                 (stars, labels, guides)
//
// Actor: { update(t, dt), draw(g), visible? }
//   g = { gl, camera, view, proj, time, dt, aspect, dpr }  (one context per frame)

import { mat4, identity } from './mat4.js';

export function createStage(canvas, opts = {}) {
  const gl = canvas.getContext('webgl2', {
    antialias: opts.antialias !== false,
    alpha: false,
    depth: true,
    powerPreference: 'high-performance'
  });
  if (!gl) throw new Error('WebGL2 is not available in this browser');

  const programs = new Map();
  const layers = { opaque: [], transparent: [], overlay: [] };

  const stage = {
    gl,
    canvas,
    time: 0,
    dt: 0,
    aspect: 1,
    dpr: 1,
    quality: opts.quality ?? 1,
    clearColor: opts.clearColor ?? [0.02, 0.027, 0.047, 1],
    onFrame: [],
    _running: false,
    _raf: 0,
    _last: 0
  };

  /* ---------- shaders ---------- */

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('shader compile failed: ' + log);
    }
    return sh;
  }

  /** Compile (and cache) a program. `key` must be unique per source pair. */
  stage.program = function (key, vs, fs) {
    if (programs.has(key)) return programs.get(key);
    const p = gl.createProgram();
    const v = compile(gl.VERTEX_SHADER, vs);
    const f = compile(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p);
      throw new Error('program link failed (' + key + '): ' + log);
    }
    gl.deleteShader(v);
    gl.deleteShader(f);
    const uniforms = new Map();
    const loc = (name) => {
      if (!uniforms.has(name)) uniforms.set(name, gl.getUniformLocation(p, name));
      return uniforms.get(name);
    };
    const wrapped = { gl, program: p, u: loc, key };
    programs.set(key, wrapped);
    return wrapped;
  };

  /** Upload a flat Float32Array (or Uint16Array) to a fresh buffer. */
  stage.buffer = function (data, target) {
    const b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return b;
  };

  stage.vao = function (setup) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    setup(gl);
    gl.bindVertexArray(null);
    return vao;
  };

  /* ---------- actors ---------- */

  stage.add = function (actor, layer = 'opaque') {
    if (!layers[layer]) throw new Error('unknown layer: ' + layer);
    actor._layer = layer;
    layers[layer].push(actor);
    return actor;
  };

  stage.remove = function (actor) {
    for (const k of Object.keys(layers)) {
      const i = layers[k].indexOf(actor);
      if (i >= 0) layers[k].splice(i, 1);
    }
  };

  stage.clearLayer = function (layer) {
    Object.keys(layers).forEach((k) => {
      if (!layer || k === layer) layers[k].length = 0;
    });
  };

  stage.actors = () => layers;

  /* ---------- sizing ---------- */

  stage.resize = function () {
    const dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr ?? 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    stage.dpr = dpr;
    stage.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    return stage;
  };

  /* ---------- frame ---------- */

  stage.camera = null;

  stage.draw = function () {
    const cam = stage.camera;
    if (cam) cam.projection(stage.aspect);
    const [r, g2, b, a] = stage.clearColor;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(r, g2, b, a);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // one frame context, handed to every actor
    const g = {
      gl,
      camera: cam,
      view: cam ? cam.view : identity(mat4()),
      proj: cam ? cam.proj : identity(mat4()),
      time: stage.time,
      dt: stage.dt,
      aspect: stage.aspect,
      dpr: stage.dpr
    };
    stage.frame = g;

    for (const layer of ['opaque', 'transparent', 'overlay']) {
      if (layer === 'opaque') {
        gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
      } else if (layer === 'transparent') {
        gl.enable(gl.DEPTH_TEST); gl.depthMask(false); gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      } else {
        gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }
      for (const a2 of layers[layer]) {
        if (a2.visible === false) continue;
        a2.draw(g);
      }
    }
    gl.depthMask(true);
    return stage;
  };

  function frame(now) {
    if (!stage._running) return;
    const t = now / 1000;
    const dt = stage._last ? Math.min(t - stage._last, 0.1) : 1 / 60;
    stage._last = t;
    stage.time = t;
    stage.dt = dt;
    stage.resize();
    for (const cb of stage.onFrame) cb(t, dt, stage);
    for (const layer of Object.keys(layers)) {
      for (const a of layers[layer]) if (a.update) a.update(t, dt, stage);
    }
    stage.draw();
    stage._raf = requestAnimationFrame(frame);
  }

  stage.start = function () {
    if (stage._running) return stage;
    stage._running = true;
    stage._last = 0;
    stage._raf = requestAnimationFrame(frame);
    return stage;
  };

  stage.stop = function () {
    stage._running = false;
    cancelAnimationFrame(stage._raf);
    return stage;
  };

  stage.destroy = function () {
    stage.stop();
    programs.forEach((p) => gl.deleteProgram(p.program));
    programs.clear();
    Object.keys(layers).forEach((k) => { layers[k].length = 0; });
  };

  return stage;
}
