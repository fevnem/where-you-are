// js/ui/minimap.js — a live sky-view instrument.
//
// What a GPS engineer actually looks at: a polar plot of the sky above the
// receiver used throughout this project — Paris, 48.8566 N, 2.3522 E. The plot
// carries concentric elevation rings at 0/30/60/90, the constellation plotted by
// azimuth and elevation, a satellite id printed beside every dot, gold dots for
// satellites above the 10 degree elevation mask and slate dots for the ones
// below it. The header carries the number of satellites in view and the live
// GDOP, both taken from the shipped maths (kepler.constellation / satelliteEcef,
// geo.geodeticToEcef / elevationAzimuth, tri.visibleSats / dop).
//
// Canvas 2D, crisp at devicePixelRatio. The only per-frame work is the canvas
// redraw; every DOM text node is written at about three times a second, so the
// page never re-lays-out per frame. Exports apply(globalCtx) -> { update, destroy, node }.

import { el } from './dom.js';

const PARIS = { lat: 48.8566, lon: 2.3522, hKm: 0.035 };
const MASK_DEG = 10;          // elevation mask: below this a satellite is not used
const TIME_SCALE = 30;        // sky seconds per real second, so the motion is visible
const DOM_HZ = 3.2;           // how often the header text is rewritten
const STYLE_ID = 'mm-panel-style';
const GOLD = '#ffc969';       // --amber
const SLATE = '#6d8098';      // --ink-faint

const CSS = [
  '#mm-panel{position:fixed;left:.75rem;bottom:.75rem;z-index:5;width:196px;max-width:calc(100vw - 1.5rem);',
  'background:rgba(14,20,31,.86);border:1px solid var(--line,#1d2634);border-radius:12px;',
  'box-shadow:var(--shadow,0 24px 60px rgba(0,0,0,.45));backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);',
  'font-family:var(--mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);color:var(--ink,#e8eef7);',
  'user-select:none;-webkit-user-select:none;overflow:hidden}',
  '#mm-panel *{box-sizing:border-box}',
  '#mm-toggle{display:flex;align-items:center;gap:.45rem;width:100%;min-height:44px;padding:.3rem .55rem;',
  'background:none;border:0;color:inherit;font:inherit;font-size:.72rem;letter-spacing:.02em;text-align:left;cursor:pointer}',
  '#mm-toggle:hover{background:rgba(111,178,255,.07)}',
  '#mm-caret{color:var(--signal,#6fb2ff);font-size:.68rem;line-height:1;width:.75rem;flex:0 0 auto;transition:transform .18s ease}',
  '#mm-panel.is-collapsed #mm-caret{transform:rotate(-90deg)}',
  '#mm-readout{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '#mm-body{padding:0 .5rem .5rem;display:flex;flex-direction:column;gap:.35rem}',
  '#mm-panel.is-collapsed #mm-body{display:none}',
  '#mm-canvas{display:block;width:100%;height:auto;aspect-ratio:1/1;background:rgba(5,7,12,.5);border-radius:8px}',
  '#mm-caption{margin:0;font-size:.6rem;line-height:1.35;color:var(--ink-faint,#6d8098)}'
].join('');

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function injectStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const s = el('style', { id: STYLE_ID });
  s.textContent = CSS;
  (doc.head || doc.documentElement).appendChild(s);
}

export function apply(globalCtx) {
  const ctx0 = globalCtx || {};
  const doc = ctx0.doc || document;
  const helpers = ctx0.helpers || {};
  const geo = helpers.geo;
  const kepler = helpers.kepler;
  const tri = helpers.tri;
  const win = doc.defaultView || window;
  const haveMath = !!(geo && kepler && tri);

  injectStyle(doc);

  const sats = haveMath ? kepler.constellation(24) : [];
  const obs = haveMath ? geo.geodeticToEcef(PARIS.lat, PARIS.lon, PARIS.hKm) : [0, 0, 0];

  /* ---------------- DOM (built with el(), no innerHTML) ---------------- */

  const caret = el('span.mm-caret', { text: '▾' });
  const readout = el('span.mm-readout', { id: 'mm-readout', text: haveMath ? '…' : 'sky view unavailable' });
  const toggle = el('button.mm-toggle', {
    id: 'mm-toggle', type: 'button', 'aria-expanded': 'true', 'aria-controls': 'mm-body',
    title: 'Show or hide the sky view'
  }, [caret, readout]);

  const canvas = el('canvas.mm-canvas', { id: 'mm-canvas', 'aria-hidden': 'true' });
  const caption = el('p.mm-caption', {
    text: 'Sky above the Paris receiver — 48.8566° N, 2.3522° E. Gold dots clear the 10° elevation mask; slate dots sit below it.'
  });
  const body = el('div.mm-body', { id: 'mm-body' }, [canvas, caption]);
  const panel = el('aside.mm-panel', {
    id: 'mm-panel', 'aria-label': 'Live sky view and dilution of precision'
  }, [toggle, body]);

  doc.body.appendChild(panel);

  /* ---------------- state ---------------- */

  let collapsed = false;
  let raf = 0;
  let last = 0;
  let lastDom = 0;
  let simTime = 3600;          // seconds of sky time; arbitrary epoch
  let cssW = 0;
  let cssH = 0;
  let backingDpr = 1;          // devicePixelRatio the backing store was sized for

  /* ---------------- canvas sizing (only on resize / expand) ---------------- */

  function syncCanvasSize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.round(rect.width || 0);
    const h = Math.round(rect.height || w);
    if (w < 40 || h < 40) return false;
    cssW = w; cssH = h;
    const dpr = win.devicePixelRatio || 1;
    backingDpr = dpr;
    const nw = Math.round(w * dpr), nh = Math.round(h * dpr);
    if (canvas.width !== nw || canvas.height !== nh) { canvas.width = nw; canvas.height = nh; }
    return true;
  }

  /* ---------------- geometry from the shipped maths ---------------- */

  function compute() {
    const positions = sats.map((s) => kepler.satelliteEcef(s, simTime));
    const view = tri.visibleSats(positions, obs, MASK_DEG);   // above the mask, best first
    let gdop = null;
    if (view.length >= 4) {
      const d = tri.dop(view.map((v) => positions[v.i]), obs);
      if (d) gdop = d.gdop;
    }
    const sky = [];
    positions.forEach((p, i) => {
      const ea = geo.elevationAzimuth(obs, p);
      if (ea.el >= 0) sky.push({ i, id: sats[i].id, el: ea.el, az: ea.az });
    });
    return { view, gdop, sky };
  }

  /* ---------------- draw ---------------- */

  function draw(frame) {
    if (!cssW || !cssH) return;
    const c2d = canvas.getContext('2d');
    c2d.setTransform(backingDpr, 0, 0, backingDpr, 0, 0);
    c2d.clearRect(0, 0, cssW, cssH);

    const size = Math.min(cssW, cssH);
    const cx = cssW / 2, cy = cssH / 2;
    const R = size / 2 - 22;
    if (R <= 6) return;

    // the sky dome
    c2d.beginPath();
    c2d.arc(cx, cy, R, 0, Math.PI * 2);
    c2d.fillStyle = 'rgba(5,7,12,.5)';
    c2d.fill();

    // elevation rings 0 / 30 / 60 / 90 (zenith is the centre point)
    c2d.lineWidth = 1;
    for (const elDeg of [0, 30, 60, 90]) {
      const r = R * (90 - elDeg) / 90;
      c2d.beginPath();
      c2d.arc(cx, cy, Math.max(0.6, r), 0, Math.PI * 2);
      c2d.strokeStyle = elDeg === 0 ? 'rgba(159,176,198,.55)' : 'rgba(109,128,152,.26)';
      c2d.stroke();
    }

    // spokes toward N / E / S / W
    c2d.strokeStyle = 'rgba(109,128,152,.22)';
    c2d.beginPath();
    c2d.moveTo(cx, cy - R); c2d.lineTo(cx, cy + R);
    c2d.moveTo(cx - R, cy); c2d.lineTo(cx + R, cy);
    c2d.stroke();

    // ring labels along the north spoke
    c2d.font = '9px ui-monospace, monospace';
    c2d.textAlign = 'left';
    c2d.textBaseline = 'middle';
    c2d.fillStyle = 'rgba(109,128,152,.75)';
    for (const elDeg of [30, 60]) {
      const r = R * (90 - elDeg) / 90;
      c2d.fillText(elDeg + '°', cx + 3, cy - r);
    }

    // compass letters
    c2d.font = '10px ui-monospace, monospace';
    c2d.fillStyle = 'rgba(159,176,198,.85)';
    c2d.textAlign = 'center';
    c2d.fillText('N', cx, cy - R - 11);
    c2d.fillText('S', cx, cy + R + 11);
    c2d.fillText('E', cx + R + 11, cy);
    c2d.fillText('W', cx - R - 11, cy);

    // the elevation mask
    const rm = R * (90 - MASK_DEG) / 90;
    c2d.save();
    c2d.setLineDash([3, 3]);
    c2d.beginPath();
    c2d.arc(cx, cy, rm, 0, Math.PI * 2);
    c2d.strokeStyle = 'rgba(255,201,105,.3)';
    c2d.stroke();
    c2d.restore();

    // zenith tick
    c2d.beginPath();
    c2d.arc(cx, cy, 1.4, 0, Math.PI * 2);
    c2d.fillStyle = 'rgba(159,176,198,.6)';
    c2d.fill();

    // the constellation
    c2d.font = '9px ui-monospace, monospace';
    for (const s of frame.sky) {
      const rr = R * (90 - clamp(s.el, 0, 90)) / 90;
      const a = s.az * Math.PI / 180;
      const x = cx + rr * Math.sin(a);
      const y = cy - rr * Math.cos(a);
      const above = s.el >= MASK_DEG;

      if (above) {
        c2d.beginPath();
        c2d.arc(x, y, 6, 0, Math.PI * 2);
        c2d.lineWidth = 1;
        c2d.strokeStyle = 'rgba(255,201,105,.32)';
        c2d.stroke();
      }
      c2d.beginPath();
      c2d.arc(x, y, above ? 3.2 : 2.3, 0, Math.PI * 2);
      c2d.fillStyle = above ? GOLD : SLATE;
      c2d.fill();

      // id label, flipped toward the inside and clamped to the canvas
      const rightSide = x < cx;
      c2d.textAlign = rightSide ? 'left' : 'right';
      c2d.textBaseline = 'middle';
      c2d.fillStyle = above ? 'rgba(255,201,105,.95)' : 'rgba(109,128,152,.85)';
      c2d.fillText(s.id, clamp(x + (rightSide ? 7 : -7), 3, cssW - 3), y);
    }
  }

  /* ---------------- DOM text, at a few hertz only ---------------- */

  function refreshText(frame) {
    const n = frame.view.length;
    const g = frame.gdop;
    readout.textContent = n + ' in view · GDOP ' + (g == null ? '—' : g.toFixed(1));
    api.stats = {
      plotted: frame.sky.length,
      inView: n,
      gdop: g == null ? null : Number(g.toFixed(2)),
      cssW,
      cssH
    };
    panel.dataset.plotted = String(frame.sky.length);
    panel.dataset.gdop = g == null ? '' : g.toFixed(2);
  }

  /* ---------------- loop ---------------- */

  function tick(now) {
    raf = requestAnimationFrame(tick);
    const dt = last ? Math.min(0.25, (now - last) / 1000) : 0;
    last = now;
    if (collapsed || doc.hidden) return;
    if ((win.devicePixelRatio || 1) !== backingDpr) syncCanvasSize();  // zoom / monitor change
    simTime += dt * TIME_SCALE;
    const frame = compute();
    draw(frame);
    if (now - lastDom > 1000 / DOM_HZ) { lastDom = now; refreshText(frame); }
  }

  function onResize() { syncCanvasSize(); }
  function onVisibility() { last = 0; }

  function setCollapsed(v) {
    collapsed = v;
    panel.classList.toggle('is-collapsed', v);
    toggle.setAttribute('aria-expanded', String(!v));
    caret.textContent = v ? '▸' : '▾';
    if (!v) requestAnimationFrame(() => { syncCanvasSize(); draw(compute()); });
  }
  toggle.addEventListener('click', () => setCollapsed(!collapsed));

  win.addEventListener('resize', onResize);
  doc.addEventListener('visibilitychange', onVisibility);

  /* ---------------- public API ---------------- */

  function update() {
    if (collapsed) return api;
    if (!cssW || !cssH) syncCanvasSize();
    const frame = compute();
    draw(frame);
    refreshText(frame);
    return api;
  }

  function destroy() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    win.removeEventListener('resize', onResize);
    doc.removeEventListener('visibilitychange', onVisibility);
    if (panel.parentNode) panel.parentNode.removeChild(panel);
    const st = doc.getElementById(STYLE_ID);
    if (st && st.parentNode) st.parentNode.removeChild(st);
  }

  const api = {
    node: panel,
    update,
    destroy,
    setCollapsed,
    stats: null
  };

  // initial paint (a frame later, once layout has given the canvas a real size)
  syncCanvasSize();
  if (haveMath) {
    const frame = compute();
    draw(frame);
    refreshText(frame);
    raf = requestAnimationFrame(tick);
  }

  return api;
}

export default { apply };
