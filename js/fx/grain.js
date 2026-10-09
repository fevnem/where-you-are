// js/fx/grain.js
//
// A photographic post layer for the #grain div: animated film grain drawn from
// one small pre-rendered noise tile (re-tiled by translation every frame, never
// per-pixel CPU work), an inward vignette and a very subtle chromatic edge. The
// layer is inert — it never intercepts pointer events. When the reader asks for
// reduced motion it paints a single static frame and stops.
//
//   createGrain(hostEl) -> { start(), stop(), ...evidence handles }
//
// main.js stores the handle but does not call start(), so the factory starts
// itself and still exposes start/stop for symmetry.
//
// World units (1 unit = 1000 km) are irrelevant here; this layer is pure pixels.

const TILE = 128;        // noise tile edge in pixels; TILE*TILE = 16384 samples
const MAX_DPR = 1.5;     // grain does not need retina; caps the full-screen fill cost

export function createGrain(hostEl) {
  if (!hostEl) throw new Error('createGrain needs a host element');

  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

  /* ---------- the visible layer: an inert canvas filling the host ---------- */

  const layer = document.createElement('canvas');
  layer.setAttribute('aria-hidden', 'true');
  layer.style.position = 'absolute';
  layer.style.inset = '0';
  layer.style.width = '100%';
  layer.style.height = '100%';
  layer.style.display = 'block';
  layer.style.pointerEvents = 'none';   // over the sky canvas, must not capture drags
  hostEl.appendChild(layer);

  // the host itself stays decorative and click-through
  hostEl.style.pointerEvents = 'none';
  hostEl.setAttribute('aria-hidden', 'true');

  const ctx = layer.getContext('2d');
  if (!ctx) return { start() {}, stop() {} };   // no 2d context: silently inert

  /* ---------- one noise tile, rendered once ---------- */

  const noise = document.createElement('canvas');
  noise.width = noise.height = TILE;
  const nctx = noise.getContext('2d');
  const tile = nctx.createImageData(TILE, TILE);
  const px = tile.data;
  for (let i = 0; i < px.length; i += 4) {
    const base = 128 + (Math.random() * 2 - 1) * 22;   // centred on neutral grey
    px[i] = base + (Math.random() * 2 - 1) * 9;        // a whisper of chroma per sample
    px[i + 1] = base + (Math.random() * 2 - 1) * 7;
    px[i + 2] = base + (Math.random() * 2 - 1) * 9;
    px[i + 3] = 255;
  }
  nctx.putImageData(tile, 0, 0);
  const pattern = ctx.createPattern(noise, 'repeat');   // tiled on the GPU, built once

  /* ---------- the plate: inward vignette + chromatic edge, rebuilt on resize ---------- */

  const plate = document.createElement('canvas');
  const pctx = plate.getContext('2d');

  function buildPlate(w, h) {
    plate.width = w;
    plate.height = h;
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.globalCompositeOperation = 'source-over';
    pctx.globalAlpha = 1;
    pctx.fillStyle = '#808080';                          // soft-light neutral
    pctx.fillRect(0, 0, w, h);

    // inward vignette: centre untouched, corners pulled toward the void
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.hypot(cx, cy);
    const g = pctx.createRadialGradient(cx, cy, r * 0.46, cx, cy, r * 1.02);
    g.addColorStop(0, 'rgba(128,128,128,0)');
    g.addColorStop(0.6, 'rgba(92,92,96,0.30)');
    g.addColorStop(1, 'rgba(6,8,12,0.9)');
    pctx.fillStyle = g;
    pctx.fillRect(0, 0, w, h);

    // a very subtle chromatic edge: cool at the left, warm at the right, tinged
    // top and bottom — the frame edge of a lens, not a border
    const band = Math.max(3, Math.round(Math.min(w, h) * 0.045));
    let lg = pctx.createLinearGradient(0, 0, band, 0);
    lg.addColorStop(0, 'rgba(96,150,176,0.15)');
    lg.addColorStop(1, 'rgba(96,150,176,0)');
    pctx.fillStyle = lg;
    pctx.fillRect(0, 0, band, h);

    lg = pctx.createLinearGradient(w, 0, w - band, 0);
    lg.addColorStop(0, 'rgba(176,96,104,0.15)');
    lg.addColorStop(1, 'rgba(176,96,104,0)');
    pctx.fillStyle = lg;
    pctx.fillRect(w - band, 0, band, h);

    lg = pctx.createLinearGradient(0, 0, 0, band);
    lg.addColorStop(0, 'rgba(120,140,168,0.12)');
    lg.addColorStop(1, 'rgba(120,140,168,0)');
    pctx.fillStyle = lg;
    pctx.fillRect(0, 0, w, band);

    lg = pctx.createLinearGradient(0, h, 0, h - band);
    lg.addColorStop(0, 'rgba(150,120,120,0.12)');
    lg.addColorStop(1, 'rgba(150,120,120,0)');
    pctx.fillStyle = lg;
    pctx.fillRect(0, h - band, w, band);
  }

  /* ---------- sizing ---------- */

  let pw = 0;
  let ph = 0;   // layer size in device pixels
  function fit() {
    const cw = Math.max(1, Math.round(hostEl.clientWidth * dpr));
    const chh = Math.max(1, Math.round(hostEl.clientHeight * dpr));
    if (cw === pw && chh === ph) return false;
    pw = cw;
    ph = chh;
    layer.width = pw;
    layer.height = ph;
    buildPlate(pw, ph);
    return true;
  }

  /* ---------- drawing: two full-screen composites, no allocation ---------- */

  function paint(time) {
    if (!pw || !ph) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(plate, 0, 0);

    // translate the repeating tile so the grain crawls; a small per-frame jitter
    // keeps it alive rather than sliding as one sheet
    const ox = (time * 43.1) % TILE + Math.random() * 7;
    const oy = (time * 29.7) % TILE + Math.random() * 7;
    ctx.globalCompositeOperation = 'overlay';
    ctx.setTransform(1, 0, 0, 1, -ox, -oy);
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, pw + TILE, ph + TILE);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------- lifecycle ---------- */

  const reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let running = false;
  let raf = 0;
  let origin = 0;

  function tick(ts) {
    if (!running) return;
    if (!origin) origin = ts;
    paint((ts - origin) / 1000);
    raf = requestAnimationFrame(tick);
  }

  function start() {
    if (running) return api;
    running = true;
    fit();
    if (reduce && reduce.matches) {
      paint(0.37);          // one static frame: grain and vignette, no motion
      return api;
    }
    origin = 0;
    raf = requestAnimationFrame(tick);
    return api;
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    return api;
  }

  function onResize() {
    if (fit() && running && reduce && reduce.matches) paint(0.37);
  }
  window.addEventListener('resize', onResize, { passive: true });
  if (reduce && reduce.addEventListener) {
    reduce.addEventListener('change', () => { if (running) { stop(); start(); } });
  }

  // readable evidence, straight off the live node
  hostEl.dataset.grain = 'on';
  hostEl.dataset.noise = TILE + 'x' + TILE;
  hostEl.dataset.noisePixels = String(TILE * TILE);

  const api = {
    start,
    stop,
    host: hostEl,
    layer,
    noise,
    tile: TILE,
    noisePixels: TILE * TILE,
    reducedMotion: () => !!(reduce && reduce.matches)
  };

  start();   // main.js stores the handle but does not call start itself
  return api;
}
