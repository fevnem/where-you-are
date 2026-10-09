// js/ui/tooltips.js — hover explanations for the sky.
//
// The page already answers a drag (turn the camera) and a scroll (zoom), but the
// things drawn on the canvas stay anonymous until a chapter names them. This
// module gives the reader a way to point at something and be told what it is:
//
//   * one small card, anchored to whatever sits under the cursor;
//   * a hit test on every pointer move over #gl, against the twenty-four
//     satellites and the receiver: a ray is built from the eye, each candidate is
//     projected and must fall within a small pixel radius, and among the hits the
//     one nearest the camera wins;
//   * a live number — the range to the receiver in kilometres and the elevation
//     for a satellite, the count in view for the receiver;
//   * hidden while the camera is being dragged, so it never fights a turn.
//
// It is a self-wiring polish module: apply(globalCtx) -> { update, destroy, node }.
// The card uses textContent only, is pointer-events:none, and never touches the
// camera or the canvas gesture, so drag-to-turn is untouched.
//
// Satellite positions come from the shared satellite model the shell keeps on
// state.satmodel (gl/satmodel.js), which advances with the same Kepler maths and
// time scale the rest of the page uses; if that module did not load, the
// constellation is rebuilt here from the same maths.

import { el, fmt } from './dom.js';
import { multiply, mat4, project } from '../engine/mat4.js';
import { geodeticToEcef, elevationAzimuth } from '../model/geo.js';
import { constellation, satelliteEcef } from '../model/kepler.js';
import { visibleSats } from '../model/trilateration.js';
import { EARTH_R } from '../engine/vocab.js';

const STYLE_ID = 'sky-tooltip-style';
const CARD_ID = 'sky-tip';
const KM2U = 1 / 1000;
const HIT_PX = 15;          // a marker answers within this many screen pixels
const STANDOFF = 16;        // px between the marker and the card
const MASK_DEG = 10;        // elevation mask the rest of the page uses
const RECEIVER = { lat: 48.8566, lon: 2.3522, hKm: 0.035 };   // Paris, the page receiver

const CSS = `
.sky-tip {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 6;
  margin: 0;
  padding: 0.24em 0.55em 0.28em;
  max-width: 13rem;
  border: 1px solid rgba(150, 180, 220, 0.28);
  border-radius: 5px;
  background: rgba(4, 6, 11, 0.8);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: var(--fs-100, 0.74rem);
  line-height: 1.35;
  letter-spacing: 0.02em;
  color: var(--ink, #e8eef7);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
  white-space: nowrap;
  opacity: 0;
  transform: translate3d(-9999px, -9999px, 0);
  will-change: transform, opacity;
  transition: opacity 0.12s ease;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
}
.sky-tip * { pointer-events: none; }
.sky-tip .sky-tip-name {
  display: block;
  color: var(--signal, #74b4ff);
  font-variant-numeric: tabular-nums;
}
.sky-tip .sky-tip-num {
  display: block;
  color: var(--ink-dim, #9fb0c6);
  font-variant-numeric: tabular-nums;
}
@media (prefers-reduced-motion: reduce) {
  .sky-tip { transition: none; }
}
`;

function injectStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = el('style', { id: STYLE_ID });
  style.textContent = CSS;
  (doc.head || doc.documentElement).appendChild(style);
}

export function apply(globalCtx) {
  const g = globalCtx || {};
  const doc = g.doc || document;
  const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
  const stage = g.stage;
  const camera = g.camera;
  const state = g.state || {};
  const dead = { update() { return dead; }, destroy() {}, node: null };
  if (!stage || !camera || !doc) return dead;

  injectStyle(doc);

  const canvas = stage.canvas || doc.getElementById('gl');
  if (!canvas) return dead;

  /* ---------------- the one card ---------------- */

  const nameEl = el('span.sky-tip-name', { text: '' });
  const numEl = el('span.sky-tip-num', { text: '' });
  const card = el('div.sky-tip', {
    id: CARD_ID,
    'aria-hidden': 'true',
    role: 'presentation',
    dataset: { visible: 'false' }
  }, [nameEl, numEl]);
  (doc.getElementById('sky') || doc.body).appendChild(card);

  let cardW = 0;
  let cardH = 0;
  function measure() {
    cardW = card.offsetWidth || 0;
    cardH = card.offsetHeight || 0;
  }

  /* ---------------- the receiver and the fallback sky ---------------- */

  const obsKm = geodeticToEcef(RECEIVER.lat, RECEIVER.lon, RECEIVER.hKm);
  const obsWorld = [obsKm[0] * KM2U, obsKm[1] * KM2U, obsKm[2] * KM2U];
  const fallback = constellation(24);

  function satCount() {
    const sm = state.satmodel;
    if (sm && typeof sm.count === 'function') return sm.count();
    return fallback.length;
  }
  function satShown() {
    const sm = state.satmodel;
    if (sm && typeof sm.isVisible === 'function') return sm.isVisible();
    return true;
  }
  function satId(i) {
    const sm = state.satmodel;
    if (sm && Array.isArray(sm.satellites) && sm.satellites[i]) return sm.satellites[i].id;
    return fallback[i] ? fallback[i].id : String(i + 1);
  }
  /** World units (1 unit = 1000 km). */
  function satWorld(i) {
    const sm = state.satmodel;
    if (sm && typeof sm.positionWorld === 'function') {
      const p = sm.positionWorld(i);
      if (p) return [p[0], p[1], p[2]];
    }
    const s = fallback[i];
    if (!s) return null;
    const p = satelliteEcef(s, (stage.time || 0) * 60);
    return [p[0] * KM2U, p[1] * KM2U, p[2] * KM2U];
  }

  /* ---------------- projection and a ray from the eye ---------------- */

  const vp = mat4();

  function viewSize() {
    const w = canvas.clientWidth || (win ? win.innerWidth : 0) || 1;
    const h = canvas.clientHeight || (win ? win.innerHeight : 0) || 1;
    return [w, h];
  }
  function aspect() {
    if (typeof stage.aspect === 'number' && stage.aspect > 0) return stage.aspect;
    const [w, h] = viewSize();
    return w / Math.max(1, h);
  }
  function syncProjection() {
    if (typeof camera.projection === 'function') camera.projection(aspect());
    multiply(vp, camera.proj, camera.view);
  }
  /** World point -> CSS pixels, or null if behind the eye. */
  function screen(p) {
    const clip = project(vp, p);
    const w = clip[3];
    if (!(w > 1e-6)) return null;
    const [W, H] = viewSize();
    return { x: (clip[0] / w * 0.5 + 0.5) * W, y: (0.5 - clip[1] / w * 0.5) * H };
  }
  /** Unit ray from the eye through a point on the canvas, in CSS pixels. */
  function ray(sx, sy) {
    const [W, H] = viewSize();
    const v = camera.view;
    const rx = v[0], ry = v[1], rz = v[2];        // camera right
    const ux = v[4], uy = v[5], uz = v[6];        // camera up
    const fx = -v[8], fy = -v[9], fz = -v[10];    // camera forward
    const tx = (sx / W) * 2 - 1;
    const ty = 1 - (sy / H) * 2;
    const th = Math.tan((camera.fov || 0.7) / 2);
    const a = aspect();
    let dx = fx + (rx * tx * a + ux * ty) * th;
    let dy = fy + (ry * tx * a + uy * ty) * th;
    let dz = fz + (rz * tx * a + uz * ty) * th;
    const l = Math.hypot(dx, dy, dz) || 1;
    return { o: camera.eye, d: [dx / l, dy / l, dz / l] };
  }
  /** Does the line from the eye to p pierce the Earth? */
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
  function eyeDist(eye, p) {
    return Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]);
  }

  /* ---------------- the hit test ---------------- */

  function pick(sx, sy) {
    syncProjection();
    const eye = camera.eye;
    const aim = ray(sx, sy).d;               // built so the reading matches the draw
    let best = null;

    if (satShown()) {
      const n = satCount();
      for (let i = 0; i < n; i++) {
        const p = satWorld(i);
        if (!p) continue;
        if (occluded(eye, p)) continue;
        // the ray must approach the marker, not sweep past it
        const vx = p[0] - eye[0], vy = p[1] - eye[1], vz = p[2] - eye[2];
        if (vx * aim[0] + vy * aim[1] + vz * aim[2] <= 0) continue;
        const s = screen(p);
        if (!s) continue;
        if (Math.hypot(s.x - sx, s.y - sy) > HIT_PX) continue;
        const dist = eyeDist(eye, p);
        if (!best || dist < best.dist) best = { kind: 'satellite', index: i, dist };
      }
    }

    if (!occluded(eye, obsWorld)) {
      const s = screen(obsWorld);
      if (s && Math.hypot(s.x - sx, s.y - sy) <= HIT_PX) {
        const dist = eyeDist(eye, obsWorld);
        if (!best || dist < best.dist - 1e-3) best = { kind: 'receiver', index: -1, dist };
      }
    }
    return best;
  }

  /* ---------------- the reading ---------------- */

  function describe(hit) {
    if (hit.kind === 'receiver') {
      const n = satCount();
      const positions = [];
      for (let i = 0; i < n; i++) {
        const p = satWorld(i);
        if (p) positions.push([p[0] * 1000, p[1] * 1000, p[2] * 1000]);
      }
      let inView = 0;
      try { inView = visibleSats(positions, obsKm, MASK_DEG).length; } catch (err) { inView = 0; }
      return {
        name: 'Your receiver',
        num: inView + (inView === 1 ? ' satellite in view' : ' satellites in view')
      };
    }
    const p = satWorld(hit.index);
    if (!p) return null;
    const ea = elevationAzimuth(obsKm, [p[0] * 1000, p[1] * 1000, p[2] * 1000]);
    return {
      name: 'Satellite ' + satId(hit.index),
      num: fmt(ea.rangeKm, 0) + ' km · el ' + Math.round(ea.el) + '°'
    };
  }

  /* ---------------- show, place, hide ---------------- */

  let hovered = null;
  let shown = false;

  function hide() {
    hovered = null;
    if (shown) { card.style.opacity = '0'; shown = false; }
    card.dataset.visible = 'false';
  }

  function render() {
    if (!hovered) return;
    const p = hovered.kind === 'receiver' ? obsWorld : satWorld(hovered.index);
    if (!p) { hide(); return; }
    syncProjection();
    const eye = camera.eye;
    if (occluded(eye, p)) { hide(); return; }
    const s = screen(p);
    if (!s) { hide(); return; }
    const [W, H] = viewSize();
    if (s.x < -40 || s.x > W + 40 || s.y < -40 || s.y > H + 40) { hide(); return; }

    const text = describe(hovered);
    if (!text) { hide(); return; }
    if (nameEl.textContent !== text.name) { nameEl.textContent = text.name; cardW = 0; }
    if (numEl.textContent !== text.num) { numEl.textContent = text.num; cardW = 0; }
    if (!cardW) measure();

    card.style.transform = 'translate3d('
      + (s.x - cardW / 2).toFixed(1) + 'px,'
      + (s.y - cardH - STANDOFF).toFixed(1) + 'px,0)';
    if (!shown) { shown = true; card.style.opacity = '1'; }
    card.dataset.visible = 'true';
    card.dataset.kind = hovered.kind;
  }

  /* ---------------- pointer wiring (never swallows the drag) ---------------- */

  let dragging = false;

  function onMove(e) {
    if (dragging) return;
    if (e.target !== canvas) return;
    if (e.pointerType === 'touch') return;        // hover is a pointer concept
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const hit = pick(sx, sy);
    if (hit) { hovered = hit; render(); }
    else hide();
  }
  function onDown() { dragging = true; hide(); }
  function onUp() { dragging = false; }
  function onLeave() { if (!dragging) hide(); }

  canvas.addEventListener('pointermove', onMove, { passive: true });
  canvas.addEventListener('pointerdown', onDown, { passive: true });
  canvas.addEventListener('pointerleave', onLeave, { passive: true });
  if (win) {
    win.addEventListener('pointerup', onUp, { passive: true });
    win.addEventListener('pointercancel', onUp, { passive: true });
  }

  /* ---------------- per-frame: track the thing under the cursor ---------------- */

  function update() {
    if (hovered) render();
    return api;
  }
  const onFrame = () => { if (hovered) render(); };
  onFrame.__tooltips = true;
  if (Array.isArray(stage.onFrame)) stage.onFrame.push(onFrame);

  const api = {
    node: card,
    update,
    destroy() {
      if (Array.isArray(stage.onFrame)) stage.onFrame = stage.onFrame.filter((f) => f.__tooltips !== true);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerleave', onLeave);
      if (win) {
        win.removeEventListener('pointerup', onUp);
        win.removeEventListener('pointercancel', onUp);
      }
      if (card.parentNode) card.parentNode.removeChild(card);
      const st = doc.getElementById(STYLE_ID);
      if (st && st.parentNode) st.parentNode.removeChild(st);
    },
    /* Small inspection surface, used by the page evidence; harmless otherwise. */
    hitTest(x, y) { return pick(x, y); },
    current() {
      if (!hovered) return null;
      return { kind: hovered.kind, index: hovered.index, text: nameEl.textContent + ' — ' + numEl.textContent };
    },
    isShown() { return shown; }
  };
  return api;
}

export default { apply };
