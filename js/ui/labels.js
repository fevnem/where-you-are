// js/ui/labels.js — HTML labels pinned to 3D world points.
//
// createLabels(stage, camera) hands the chapters a tiny handle for hanging text
// on a point in the scene. Each frame every live label is projected through the
// very same view and projection the WebGL stage uses; a pooled DOM node is moved
// to the result and faded by distance. A label disappears when its point is
// behind the eye, when the sight line from the eye to the point passes through
// the Earth (a ray/sphere test against the real radius of 6.371 world units),
// or when it falls outside the viewport.
//
// The layer is one absolutely positioned element inside #sky. Nodes are pooled,
// so the element count stops growing once the pool has warmed and nothing is
// created or destroyed during a frame; a frame only writes transform, opacity
// and (on change) textContent. The layer never receives pointer events, so it
// cannot steal a drag from the canvas. Text is written with textContent and is
// never treated as markup.
//
// Positions are in kilometres (ECEF), matching the convention ctx.marker and
// ctx.station use; they are converted to world units here.
//
//   const labels = createLabels(stage, camera);
//   labels.add(id, posKm, text, opts)   // opts: offset, color, size, accent,
//                                       //       fadeNear, fadeFar, visible
//   labels.remove(id)        labels.setText(id, text)
//   labels.setVisible(id, on) labels.setPosition(id, posKm)   // setPosition is
//                                       //   an extension for points that move
//   labels.clear()           labels.update()
//   labels.count()           labels.layer      // the container element

import { EARTH_R, KM } from '../engine/vocab.js';
import { project, multiply, mat4 } from '../engine/mat4.js';

const STYLE_ID = 'sky-labels-style';
const LAYER_ID = 'sky-labels';
const HIDDEN_T = 'translate3d(-9999px, -9999px, 0)';

const CSS = `
#sky > #sky-labels {
  position: absolute;
  inset: 0;
  z-index: 4;
  overflow: hidden;
  pointer-events: none;
  contain: layout style paint;
}
#sky-labels .label {
  position: absolute;
  top: 0;
  left: 0;
  margin: 0;
  padding: 0.06em 0.42em;
  max-width: 16rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono, ui-monospace, monospace);
  font-size: var(--fs-100, 0.78rem);
  line-height: 1.4;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
  color: var(--ink, #eef3fa);
  background: rgba(4, 6, 11, 0.6);
  border: 1px solid rgba(150, 180, 220, 0.2);
  border-radius: 3px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
  opacity: 0;
  transform: translate3d(-9999px, -9999px, 0);
  will-change: transform, opacity;
  pointer-events: none;
}
#sky-labels .label.is-accent {
  color: var(--signal, #74b4ff);
  border-color: rgba(116, 180, 255, 0.38);
}
@media (prefers-reduced-motion: reduce) {
  #sky-labels .label { transition: none; }
}
`;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function ensureLayer() {
  let node = document.getElementById(LAYER_ID);
  if (node) return node;
  node = document.createElement('div');
  node.id = LAYER_ID;
  node.className = 'labels-layer';
  node.setAttribute('aria-hidden', 'true');
  const sky = document.getElementById('sky') || document.body;
  sky.appendChild(node);
  return node;
}

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export function createLabels(stage, camera) {
  injectStyle();
  const layer = ensureLayer();

  const items = [];              // live labels, in insertion order
  const byId = new Map();        // id -> item
  const free = [];               // pooled, detached-from-service nodes
  const vp = mat4();             // scratch view-projection matrix, reused

  // The layer is inset:0 of the fixed #sky, so it is exactly the viewport. The
  // size is cached and refreshed on resize, never measured during a frame.
  const view = { w: window.innerWidth || 1, h: window.innerHeight || 1 };
  const onResize = () => {
    view.w = window.innerWidth || 1;
    view.h = window.innerHeight || 1;
  };
  window.addEventListener('resize', onResize, { passive: true });

  function makeNode() {
    const node = document.createElement('div');
    node.className = 'label';
    node.style.transform = HIDDEN_T;
    layer.appendChild(node);
    return node;
  }

  function takeNode() {
    const pooled = free.pop();
    return pooled || makeNode();
  }

  function releaseNode(node) {
    node.style.opacity = '0';
    node.style.transform = HIDDEN_T;
    node.classList.remove('is-accent');
    node.style.color = '';
    node.style.fontSize = '';
    free.push(node);
  }

  function measure(it) {
    it.w = it.node.offsetWidth || 0;
    it.h = it.node.offsetHeight || 0;
    it.measure = !(it.w || it.h);   // remember to retry once layout exists
  }

  function setPos(it, posKm) {
    if (Array.isArray(posKm) && posKm.length >= 3) {
      it.pos[0] = Number(posKm[0]) || 0;
      it.pos[1] = Number(posKm[1]) || 0;
      it.pos[2] = Number(posKm[2]) || 0;
    } else if (posKm && typeof posKm === 'object') {
      it.pos[0] = Number(posKm.x) || 0;
      it.pos[1] = Number(posKm.y) || 0;
      it.pos[2] = Number(posKm.z) || 0;
    }
  }

  function add(id, posKm, text, opts) {
    if (id === undefined || id === null) return null;
    const o = opts || {};
    let it = byId.get(id);
    if (!it) {
      it = {
        id,
        pos: [0, 0, 0],
        text: '',
        node: takeNode(),
        w: 0, h: 0, dx: 0, dy: 10,
        fadeNear: 120, fadeFar: 340,
        userVisible: true,
        shown: false,
        lastOp: null,
        lastT: '',
        measure: false
      };
      items.push(it);
      byId.set(id, it);
    }
    setPos(it, posKm);

    it.text = text === undefined || text === null ? '' : String(text);
    if (it.node.textContent !== it.text) it.node.textContent = it.text;

    it.userVisible = o.visible !== false;
    if (Array.isArray(o.offset)) {
      it.dx = num(o.offset[0], 0);
      it.dy = num(o.offset[1], 10);
    } else if (o.offset !== undefined) {
      it.dy = num(o.offset, 10);
    }
    it.fadeNear = num(o.fadeNear, 120);
    it.fadeFar = Math.max(it.fadeNear + 1, num(o.fadeFar, 340));

    if (o.color) it.node.style.color = String(o.color);
    it.node.style.fontSize = o.size ? (num(o.size, 12) + 'px') : '';
    if (o.accent !== undefined) it.node.classList.toggle('is-accent', !!o.accent);

    measure(it);
    return it;
  }

  function remove(id) {
    const it = byId.get(id);
    if (!it) return false;
    byId.delete(id);
    const i = items.indexOf(it);
    if (i >= 0) items.splice(i, 1);
    releaseNode(it.node);
    return true;
  }

  function setText(id, text) {
    const it = byId.get(id);
    if (!it) return false;
    const s = text === undefined || text === null ? '' : String(text);
    if (s !== it.text) {
      it.text = s;
      it.node.textContent = s;
      measure(it);
    }
    return true;
  }

  function setVisible(id, on) {
    const it = byId.get(id);
    if (!it) return false;
    it.userVisible = !!on;
    return true;
  }

  function setPosition(id, posKm) {
    const it = byId.get(id);
    if (!it) return false;
    setPos(it, posKm);
    return true;
  }

  function clear() {
    for (const it of items) releaseNode(it.node);
    items.length = 0;
    byId.clear();
  }

  function count() {
    return items.length;
  }

  // True when the segment from the eye to the point pierces the sphere of
  // radius EARTH_R centred at the world origin, or when the point is inside it.
  function occluded(eye, p) {
    const R = EARTH_R;
    if (p[0] * p[0] + p[1] * p[1] + p[2] * p[2] < R * R) return true;
    const dx = p[0] - eye[0], dy = p[1] - eye[1], dz = p[2] - eye[2];
    const a = dx * dx + dy * dy + dz * dz;
    if (a < 1e-9) return false;
    const b = 2 * (eye[0] * dx + eye[1] * dy + eye[2] * dz);
    const c = eye[0] * eye[0] + eye[1] * eye[1] + eye[2] * eye[2] - R * R;
    const disc = b * b - 4 * a * c;
    if (disc <= 0) return false;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    return t > 0 && t < 1;
  }

  function hide(it) {
    if (it.lastOp !== '0') {
      it.node.style.opacity = '0';
      it.lastOp = '0';
    }
    it.shown = false;
  }

  function update() {
    const n = items.length;
    if (!n) return;

    // Fresh projection: the stage draws with the same aspect, so this is
    // identical to what the next draw() will compute, and it makes the labels
    // correct even on the very first frame, before draw() has run once.
    if (typeof camera.projection === 'function') {
      camera.projection(stage.aspect || (view.w / Math.max(1, view.h)));
    }
    multiply(vp, camera.proj, camera.view);

    const eye = camera.eye;
    const tgt = camera.target;
    const fx0 = tgt[0] - eye[0], fy0 = tgt[1] - eye[1], fz0 = tgt[2] - eye[2];
    const fl = Math.sqrt(fx0 * fx0 + fy0 * fy0 + fz0 * fz0) || 1;
    const fx = fx0 / fl, fy = fy0 / fl, fz = fz0 / fl;
    const W = view.w, H = view.h;

    for (let i = 0; i < n; i++) {
      const it = items[i];
      if (it.measure && !(it.w || it.h)) measure(it);

      if (it.userVisible === false) { hide(it); continue; }

      const p = it.pos;
      const dx = p[0] - eye[0], dy = p[1] - eye[1], dz = p[2] - eye[2];

      // camera-basis test: the point must lie in front of the eye
      if (dx * fx + dy * fy + dz * fz <= 0) { hide(it); continue; }

      // Earth occlusion, tested against the geometry rather than the projection
      if (occluded(eye, p)) { hide(it); continue; }

      const clip = project(vp, p);
      const w = clip[3];
      if (!(w > 1e-6)) { hide(it); continue; }
      const inv = 1 / w;
      const sx = (clip[0] * inv * 0.5 + 0.5) * W;
      const sy = (0.5 - clip[1] * inv * 0.5) * H;
      if (sx < 0 || sx > W || sy < 0 || sy > H) { hide(it); continue; }

      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let op = (it.fadeFar - d) / (it.fadeFar - it.fadeNear);
      op = op > 1 ? 1 : op < 0 ? 0 : op;
      if (op <= 0.002) { hide(it); continue; }

      const tx = 'translate3d('
        + (sx - it.w * 0.5 + it.dx).toFixed(2) + 'px,'
        + (sy - it.h - it.dy).toFixed(2) + 'px,0)';
      if (tx !== it.lastT) { it.node.style.transform = tx; it.lastT = tx; }

      const opStr = op.toFixed(3);
      if (opStr !== it.lastOp) { it.node.style.opacity = opStr; it.lastOp = opStr; }
      it.shown = true;
    }
  }

  // Repaint on every frame. Pushed after the shell's camera tick, so the
  // camera matrices are already current when this runs.
  const onFrame = () => update();
  onFrame.__labels = true;
  if (stage && Array.isArray(stage.onFrame)) stage.onFrame.push(onFrame);

  return {
    layer,
    add,
    remove,
    setText,
    setVisible,
    setPosition,
    clear,
    update,
    count,
    destroy() {
      const k = stage && Array.isArray(stage.onFrame) ? stage.onFrame.indexOf(onFrame) : -1;
      if (k >= 0) stage.onFrame.splice(k, 1);
      window.removeEventListener('resize', onResize);
      for (const it of items) it.node.remove();
      items.length = 0;
      byId.clear();
      free.length = 0;
      if (layer && layer.parentNode) layer.remove();
    }
  };
}
