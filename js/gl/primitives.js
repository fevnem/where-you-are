// Reusable drawable primitives. Every chapter builds its scene out of these,
// so no chapter ever writes raw GL code.

import { VS_SIMPLE, FS_FLAT, FS_POINT, VS_LIT_SPHERE, FS_LIT_SPHERE, FS_HALO, VS_POINTS, FS_POINT as FS_PT } from '../engine/shader.js';
import { mat4, identity, model as modelMat, V3 } from '../engine/mat4.js';

const GL_MODES = { lines: 0, strip: 1, loop: 2 };

/** Flat-coloured line batch (gl.LINES by default). */
export function createLines(stage, positions, color = [1, 1, 1, 1], opts = {}) {
  const gl = stage.gl;
  const prog = stage.program('flat', VS_SIMPLE, FS_FLAT);
  const buf = stage.buffer(new Float32Array(positions), gl.ARRAY_BUFFER);
  const vao = stage.vao((g) => {
    g.bindBuffer(g.ARRAY_BUFFER, buf);
    const loc = g.getAttribLocation(prog.program, 'position');
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 3, g.FLOAT, false, 0, 0);
  });
  const ident = identity(mat4());
  const mode = GL_MODES[opts.mode ?? 'lines'];
  const actor = {
    count: positions.length / 3,
    color: color.slice(),
    model: opts.model ? Float32Array.from(opts.model) : ident,
    visible: opts.visible !== false,
    width: opts.width ?? 1,
    draw(g) {
      g.gl.useProgram(prog.program);
      g.gl.uniformMatrix4fv(prog.u('proj'), false, g.proj);
      g.gl.uniformMatrix4fv(prog.u('view'), false, g.view);
      g.gl.uniformMatrix4fv(prog.u('model'), false, this.model);
      g.gl.uniform4fv(prog.u('color'), this.color);
      g.gl.lineWidth(this.width);
      g.gl.bindVertexArray(vao);
      const m = mode === 0 ? g.gl.LINES : mode === 1 ? g.gl.LINE_STRIP : g.gl.LINE_LOOP;
      g.gl.drawArrays(m, 0, this.count);
      g.gl.bindVertexArray(null);
    },
    setPositions(arr) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
      this.count = arr.length / 3;
      return this;
    },
    setColor(c) { this.color = c.slice(); return this; }
  };
  return stage.add(actor, opts.layer ?? 'opaque');
}

/** Round points (gl.POINTS) with a soft circular mask. */
export function createPoints(stage, positions, color = [1, 1, 1, 1], opts = {}) {
  const gl = stage.gl;
  const prog = stage.program('point', VS_SIMPLE, FS_POINT);
  const buf = stage.buffer(new Float32Array(positions), gl.ARRAY_BUFFER);
  const vao = stage.vao((g) => {
    g.bindBuffer(g.ARRAY_BUFFER, buf);
    const loc = g.getAttribLocation(prog.program, 'position');
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 3, g.FLOAT, false, 0, 0);
  });
  const ident = identity(mat4());
  const actor = {
    count: positions.length / 3,
    color: color.slice(),
    size: opts.size ?? 8,
    model: ident,
    visible: opts.visible !== false,
    draw(g) {
      g.gl.useProgram(prog.program);
      g.gl.uniformMatrix4fv(prog.u('proj'), false, g.proj);
      g.gl.uniformMatrix4fv(prog.u('view'), false, g.view);
      g.gl.uniformMatrix4fv(prog.u('model'), false, this.model);
      g.gl.uniform4fv(prog.u('color'), this.color);
      g.gl.uniform1f(prog.u('pointSize'), this.size * g.dpr);
      g.gl.bindVertexArray(vao);
      g.gl.drawArrays(g.gl.POINTS, 0, this.count);
      g.gl.bindVertexArray(null);
    },
    setPositions(arr) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.DYNAMIC_DRAW);
      this.count = arr.length / 3;
      return this;
    },
    setColor(c) { this.color = c.slice(); return this; },
    setSize(s) { this.size = s; return this; }
  };
  return stage.add(actor, opts.layer ?? 'overlay');
}

/** One indexed mesh, drawn once (or once per entry in `instances`). */
export function createMesh(stage, mesh, color = [1, 1, 1, 1], opts = {}) {
  const gl = stage.gl;
  const lit = opts.lit !== false;
  const prog = lit ? stage.program('lit', VS_LIT_SPHERE, FS_LIT_SPHERE)
                   : stage.program('flatmesh', VS_SIMPLE, FS_FLAT);
  const vbo = stage.buffer(mesh.pos, gl.ARRAY_BUFFER);
  const ibo = mesh.idx ? stage.buffer(mesh.idx, gl.ELEMENT_ARRAY_BUFFER) : null;
  const useNormals = lit && !!mesh.norm;
  const normBuf = useNormals ? stage.buffer(mesh.norm, gl.ARRAY_BUFFER) : null;
  const vao = stage.vao((g) => {
    g.bindBuffer(g.ARRAY_BUFFER, vbo);
    let loc = g.getAttribLocation(prog.program, 'position');
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 3, g.FLOAT, false, 0, 0);
    if (useNormals) {
      g.bindBuffer(g.ARRAY_BUFFER, normBuf);
      loc = g.getAttribLocation(prog.program, 'normal');
      g.enableVertexAttribArray(loc);
      g.vertexAttribPointer(loc, 3, g.FLOAT, false, 0, 0);
    }
    if (ibo) g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, ibo);
  });
  const count = mesh.idx ? mesh.idx.length : mesh.pos.length / 3;
  const positions = opts.instances ? opts.instances.map((p) => Float32Array.from(p)) : null;
  const scales = opts.scales ? opts.scales.slice() : null;
  const m4 = mat4();
  const actor = {
    color: color.slice(),
    visible: opts.visible !== false,
    spin: opts.spin ?? 0,
    draw(g) {
      g.gl.useProgram(prog.program);
      g.gl.uniformMatrix4fv(prog.u('proj'), false, g.proj);
      g.gl.uniformMatrix4fv(prog.u('view'), false, g.view);
      if (lit) g.gl.uniform3fv(prog.u('lightDir'), opts.light ?? [0.6, 0.35, 0.72]);
      g.gl.uniform4fv(prog.u('color'), this.color);
      g.gl.uniform1f(prog.u('rimScale'), opts.rim ?? 0.5);
      g.gl.bindVertexArray(vao);
      const drawOne = (m) => {
        g.gl.uniformMatrix4fv(prog.u('model'), false, m);
        if (ibo) g.gl.drawElements(g.gl.TRIANGLES, count, g.gl.UNSIGNED_SHORT, 0);
        else g.gl.drawArrays(g.gl.TRIANGLES, 0, count);
      };
      if (positions) {
        for (let i = 0; i < positions.length; i++) {
          modelMat(m4, positions[i], scales ? scales[i] : 1);
          drawOne(m4);
        }
      } else {
        modelMat(m4, opts.position ?? [0, 0, 0], opts.scale ?? 1);
        drawOne(m4);
      }
      g.gl.bindVertexArray(null);
    },
    setInstances(list, scale) {
      positions.length = 0;
      for (const p of list) positions.push(Float32Array.from(p));
      if (Array.isArray(scale)) { scales.length = 0; scale.forEach((s) => scales.push(s)); }
      else if (typeof scale === 'number') { scales.length = 0; positions.forEach(() => scales.push(scale)); }
      return this;
    },
    setColor(c) { this.color = c.slice(); return this; },
    setUniformScale(s) { scales.fill(s); return this; }
  };
  return stage.add(actor, opts.layer ?? 'opaque');
}

/** Soft additive halo — used for the atmosphere and range-sphere rims. */
export function createHalo(stage, radius, color = [0.3, 0.5, 0.8, 0.6], opts = {}) {
  const gl = stage.gl;
  const prog = stage.program('halo', VS_LIT_SPHERE, FS_HALO);
  const mesh = opts.mesh;
  const vbo = stage.buffer(mesh.pos, gl.ARRAY_BUFFER);
  const normBuf = stage.buffer(mesh.norm, gl.ARRAY_BUFFER);
  const ibo = stage.buffer(mesh.idx, gl.ELEMENT_ARRAY_BUFFER);
  const vao = stage.vao((g) => {
    g.bindBuffer(g.ARRAY_BUFFER, vbo);
    let loc = g.getAttribLocation(prog.program, 'position');
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 3, g.FLOAT, false, 0, 0);
    g.bindBuffer(g.ARRAY_BUFFER, normBuf);
    loc = g.getAttribLocation(prog.program, 'normal');
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 3, g.FLOAT, false, 0, 0);
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, ibo);
  });
  const m4 = mat4();
  const actor = {
    radius,
    color: color.slice(),
    power: opts.power ?? 2.5,
    visible: opts.visible !== false,
    center: opts.position ? [...opts.position] : [0, 0, 0],
    draw(g) {
      g.gl.useProgram(prog.program);
      g.gl.uniformMatrix4fv(prog.u('proj'), false, g.proj);
      g.gl.uniformMatrix4fv(prog.u('view'), false, g.view);
      modelMat(m4, this.center, this.radius);
      g.gl.uniformMatrix4fv(prog.u('model'), false, m4);
      g.gl.uniform4fv(prog.u('color'), this.color);
      g.gl.uniform1f(prog.u('power'), this.power);
      g.gl.bindVertexArray(vao);
      g.gl.drawElements(g.gl.TRIANGLES, mesh.idx.length, g.gl.UNSIGNED_SHORT, 0);
      g.gl.bindVertexArray(null);
    },
    set(center, rad, col) {
      if (center) this.center = [...center];
      if (typeof rad === 'number') this.radius = rad;
      if (col) this.color = col.slice();
      return this;
    }
  };
  return stage.add(actor, 'transparent');
}

/** Model matrix mapping the unit circle in XY onto a 3D circle. */
export function circleMatrix(out, center, radius, normalVec) {
  const n = V3.norm(normalVec);
  const up = Math.abs(n[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const u = V3.norm(V3.cross(up, n));
  const v = V3.cross(n, u);
  out[0] = u[0] * radius; out[1] = u[1] * radius; out[2] = u[2] * radius; out[3] = 0;
  out[4] = v[0] * radius; out[5] = v[1] * radius; out[6] = v[2] * radius; out[7] = 0;
  out[8] = n[0] * radius; out[9] = n[1] * radius; out[10] = n[2] * radius; out[11] = 0;
  out[12] = center[0]; out[13] = center[1]; out[14] = center[2]; out[15] = 1;
  return out;
}

/** A ring that can be re-placed anywhere in 3D: the circle where two spheres meet. */
export function createRing(stage, color = [0.9, 0.75, 0.4, 0.9], opts = {}) {
  const gl = stage.gl;
  const prog = stage.program('flat', VS_SIMPLE, FS_FLAT);
  const seg = opts.segments ?? 192;
  const positions = new Float32Array(seg * 3);
  for (let i = 0; i < seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    positions[i * 3] = Math.cos(t);
    positions[i * 3 + 1] = Math.sin(t);
    positions[i * 3 + 2] = 0;
  }
  const buf = stage.buffer(positions, gl.ARRAY_BUFFER);
  const vao = stage.vao((g) => {
    g.bindBuffer(g.ARRAY_BUFFER, buf);
    const loc = g.getAttribLocation(prog.program, 'position');
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 3, g.FLOAT, false, 0, 0);
  });
  const m4 = mat4();
  const actor = {
    count: seg,
    color: color.slice(),
    visible: opts.visible !== false,
    model: mat4(),
    draw(g) {
      g.gl.useProgram(prog.program);
      g.gl.uniformMatrix4fv(prog.u('proj'), false, g.proj);
      g.gl.uniformMatrix4fv(prog.u('view'), false, g.view);
      g.gl.uniformMatrix4fv(prog.u('model'), false, this.model);
      g.gl.uniform4fv(prog.u('color'), this.color);
      g.gl.lineWidth(opts.width ?? 1);
      g.gl.bindVertexArray(vao);
      g.gl.drawArrays(g.gl.LINE_LOOP, 0, this.count);
      g.gl.bindVertexArray(null);
    },
    set(center, radius, normalVec) {
      if (!center || !radius) { this.visible = false; return this; }
      circleMatrix(m4, center, radius, normalVec || [0, 0, 1]);
      this.model = Float32Array.from(m4);
      this.visible = true;
      return this;
    }
  };
  return stage.add(actor, opts.layer ?? 'overlay');
}

export { V3 };
