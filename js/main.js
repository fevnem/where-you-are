// The explainer shell: one WebGL2 stage with a sticky canvas, one scrollable
// article, one active chapter at a time. Chapters are data + a createScene()
// function; everything else lives here.

import { createStage } from './engine/stage.js';
import { createCamera, bindCamera } from './engine/camera.js';
import { createGlobe, createMarker } from './gl/globe.js';
import { createStarfield } from './gl/starfield.js';
import { createConstellation, createStation } from './gl/constellation.js';
import { createRangeSpheres } from './gl/spheres.js';
import * as P from './gl/primitives.js';
import * as geo from './model/geo.js';
import * as kepler from './model/kepler.js';
import * as tri from './model/trilateration.js';
import * as vocab from './engine/vocab.js';
import { loadChapters } from './content/registry.js';
import { renderProse } from './ui/prose.js';
import { createControls, createReadout } from './ui/controls.js';
import { createCheck } from './ui/check.js';
import { el, $, clear } from './ui/dom.js';

const canvas = $('#gl');
const stage = createStage(canvas);
const camera = createCamera({ dist: 78, yaw: 0.9, pitch: 0.42, minDist: 7.2, maxDist: 320 });
const tickKeys = bindCamera(canvas, camera, () => true);

const globe = createGlobe(stage, { seg: 96 });
const stars = createStarfield(stage, { count: 1800 });
stage.camera = camera;
stage.onFrame.push((t, dt) => { tickKeys(dt); camera.update(dt); });

/* ------------------------------------------------------------------ *
 * Optional visual modules. They live in their own files and are loaded
 * if present — a missing or broken one is skipped, never fatal. This is
 * what lets several authors work on the look of the page at once.
 * ------------------------------------------------------------------ */

const POLISH_SPEC = [
  ['createGrain', './fx/grain.js'],
  ['enhanceHero', './ui/hero.js'],
  ['createRailTrack', './ui/railtrack.js'],
  ['createLabels', './ui/labels.js'],
  ['createGlowPool', './gl/glow.js'],
  ['createTrails', './gl/trails.js'],
  ['createCityLights', './gl/city.js'],
  ['createEarth', './gl/earth-material.js'],
  ['apply', './ui/minimap.js'],
  ['apply', './gl/satmodel.js'],
  ['apply', './gl/groundtrack.js'],
  ['apply', './gl/horizon.js'],
  ['apply', './fx/aberration.js'],
  ['apply', './ui/scrolly.js'],
  ['apply', './ui/tooltips.js']
];

/**
 * Load every optional module. A module may either
 *   (a) export `apply(globalCtx)` — the preferred hook, self-wiring, or
 *   (b) export one of the named factories above (older shape).
 * globalCtx = { stage, camera, globe, stars, chapters, state, helpers, doc, app }
 */
async function loadPolish() {
  const out = {};
  const files = [...new Set(POLISH_SPEC.map(([, f]) => f))];
  const target = {};
  for (const file of files) {
    let mod;
    try {
      mod = await import(file);
    } catch (err) {
      console.warn('[polish] ' + file + ' not applied: ' + err.message);
      continue;
    }
    const named = POLISH_SPEC.filter(([, f]) => f === file).map(([n]) => n);
    for (const name of named) {
      if (typeof mod[name] === 'function') {
        target[name] = mod[name];
        out[name] = mod[name];
      }
    }
    if (typeof mod.apply === 'function') out['__apply'] = out['__apply'] || [];
    if (typeof mod.apply === 'function') out['__apply'].push({ file, fn: mod.apply });
  }
  out.__target = target;
  return out;
}

/* ---------------- boot ---------------- */

const state = {
  chapters: [],
  active: null,
  scene: null,
  ctx: null,
  mounted: new Map()
};

stage.resize();
stage.start();

const rail = $('#rail');
const list = $('#chapters');
const metaLine = $('#meta-line');

boot();

async function boot() {
  const [chapters, polish] = await Promise.all([loadChapters(), loadPolish()]);
  state.chapters = chapters;
  state.polish = polish;
  buildArticle(chapters);
  buildRail(chapters);
  metaLine.textContent = chapters.length + ' chapters · ' + document.title.split(' — ')[0];
  observe();

  // optional visual layers: each is applied only if its module exists
  if (polish.createGrain) {
    try { state.grain = polish.createGrain($('#grain')); } catch (e) { console.warn('[grain]', e); }
  }
  if (polish.enhanceHero) {
    try { polish.enhanceHero({ chapters, state, stage, camera, globe }); } catch (e) { console.warn('[hero]', e); }
  }
  if (polish.createRailTrack) {
    try { state.railtrack = polish.createRailTrack({ rail, chapters, state }); } catch (e) { console.warn('[rail]', e); }
  }
  if (polish.createEarth) {
    try {
      state.earth = polish.createEarth(stage, { globe, stars });
      if (state.earth?.surfaceAdded) globe.setSurface(false);
    } catch (e) { console.warn('[earth]', e); }
  }

  // self-wiring modules: export apply(globalCtx) and they are called here, after
  // chapters and the named factories exist.
  const globalCtx = { stage, camera, globe, stars, chapters, state, helpers: { geo, kepler, tri, vocab, P }, doc: document, app: null };
  for (const { file, fn } of (polish.__apply || [])) {
    try {
      const r = fn(globalCtx);
      if (r) state[file] = r;
    } catch (e) { console.warn('[polish apply ' + file + ']', e); }
  }

  window.APP = {
    stage, camera, globe, stars, chapters, state, polish,
    activate, pickActive, helpers: { geo, kepler, tri, vocab, P }
  };
  globalCtx.app = window.APP;
}

/* ---------------- article ---------------- */

function buildArticle(chapters) {
  chapters.forEach((ch, i) => {
    const section = el('section.chapter', { id: ch.id, dataset: { index: i } });
    section.appendChild(el('header.chapter-head', {}, [
      el('p.chapter-number', { text: 'Chapter ' + (i + 1) }),
      el('h2', { html: textOnly(ch.title) }),
      ch.kicker ? el('p.chapter-kicker', { html: textOnly(ch.kicker) }) : null
    ]));

    section.appendChild(el('div.prose', {}, [renderProse(ch.prose ?? [])]));

    let controlsApi = null;
    if (ch.controls?.length) {
      const holder = el('div.controls-holder');
      section.appendChild(holder);
      controlsApi = createControls(ch.controls, () => {
        if (state.active === ch.id && state.scene?.onChange) {
          state.scene.onChange(state.ctx.params);
        }
      });
      holder.appendChild(el('p.controls-title', { text: 'Try it' }));
      holder.appendChild(controlsApi.node);
      ch.__controls = controlsApi;
    }

    if (ch.checks?.length) {
      const holder = el('div.checks-holder');
      ch.checks.forEach((c) => holder.appendChild(createCheck(c).node));
      section.appendChild(holder);
    }

    list.appendChild(section);
  });
}

function textOnly(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function buildRail(chapters) {
  chapters.forEach((ch, i) => {
    const b = el('button.rail-item', { type: 'button', dataset: { id: ch.id } }, [
      el('span.rail-num', { text: String(i + 1).padStart(2, '0') }),
      el('span.rail-title', { text: ch.title })
    ]);
    b.addEventListener('click', () => document.getElementById(ch.id).scrollIntoView({ behavior: 'smooth', block: 'start' }));
    rail.appendChild(b);
  });
}

function observe() {
  // A scroll-driven picker rather than IntersectionObserver: the active chapter is
  // whichever section contains the reading line (35% down the viewport), or the
  // nearest one if none does. Deterministic, and therefore testable.
  const onScroll = throttle(() => pickActive(), 110);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  window.addEventListener('load', onScroll);
  pickActive(true);
  state.onScroll = onScroll;
}

function throttle(fn, ms) {
  let last = 0, timer = 0;
  return function () {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(); }
    else if (!timer) { timer = setTimeout(() => { timer = 0; last = Date.now(); fn(); }, ms - (now - last)); }
  };
}

export function pickActive(force) {
  if (!state.chapters.length) return null;
  const line = window.innerHeight * 0.35;
  const boxes = state.chapters.map((ch) => ({ ch, r: document.getElementById(ch.id).getBoundingClientRect() }));
  let chosen = boxes.find(({ r }) => r.top <= line && r.bottom >= line);
  if (!chosen) {
    chosen = boxes.reduce((best, cur) => {
      const d = Math.abs(cur.r.top - line);
      return d < best.d ? { ...cur, d } : best;
    }, { ...boxes[0], d: Infinity });
  }
  if (chosen && (force || chosen.ch.id !== state.active)) activate(chosen.ch);
  return chosen?.ch?.id ?? null;
}

/* ---------------- chapter activation ---------------- */

function activate(ch) {
  // tear down the previous chapter's geometry
  if (state.scene?.dispose) {
    try { state.scene.dispose(); } catch (e) { console.warn('[scene dispose]', e); }
  }
  if (state.ctx?.owned) state.ctx.owned.forEach((a) => stage.remove(a));
  state.ctx = null;
  state.scene = null;

  const prev = state.active;
  state.active = ch.id;
  document.body.dataset.chapter = ch.id;
  rail.querySelectorAll('.rail-item').forEach((b) => b.classList.toggle('is-active', b.dataset.id === ch.id));
  document.querySelectorAll('section.chapter').forEach((s) => s.classList.toggle('is-active', s.id === ch.id));

  if (ch.view) {
    camera.moveTo(ch.view.target ?? [0, 0, 0], ch.view.dist ?? camera._dist);
    camera._yaw = ch.view.yaw ?? camera._yaw;
    camera._pitch = ch.view.pitch ?? camera._pitch;
  }
  if (ch.globe) {
    globe.setGrid(ch.globe.grid !== false);
    globe.setCoast(ch.globe.coast !== false);
  }

  const ctx = makeCtx(ch);
  state.ctx = ctx;

  if (typeof ch.createScene === 'function') {
    try {
      state.scene = ch.createScene(ctx) || {};
    } catch (e) {
      console.warn('[scene ' + ch.id + ']', e);
    }
  }

  // per-frame update
  stage.onFrame = stage.onFrame.filter((f) => !f.__chapter);
  if (state.scene?.update) {
    const fn = (t, dt) => state.scene?.update?.(t, dt, stage);
    fn.__chapter = true;
    stage.onFrame.push(fn);
  }
}

function makeCtx(ch) {
  const owned = [];
  const params = ch.__controls ? ch.__controls.params : {};
  const polish = state.polish ?? {};
  const ctx = {
    stage, camera, globe, stars, params, id: ch.id, owned, polish,
    helpers: { geo, kepler, tri, vocab, P },
    /* geometry factories that register themselves for disposal */
    own(...actors) { actors.forEach((a) => a && owned.push(a)); return actors[0]; },
    constellation: (opts) => {
      const c = createConstellation(stage, opts);
      ctx.own(c.markers, c.solids, c.ranges, ...c.trails);
      return c;
    },
    spheres: (opts) => {
      const s = createRangeSpheres(stage, opts);
      ctx.own(...s.shells, ...s.rings, s.candidates, s.solution);
      return s;
    },
    station: (posKm, color) => ctx.own(createStation(stage, posKm, color)),
    marker: (pos, color, opts) => ctx.own(createMarker(stage, pos, color, opts)),
    lines: (pos, color, opts) => ctx.own(P.createLines(stage, pos, color, opts)),
    points: (pos, color, opts) => ctx.own(P.createPoints(stage, pos, color, opts)),
    ring: (color, opts) => ctx.own(P.createRing(stage, color, opts)),
    mesh: (m, color, opts) => ctx.own(P.createMesh(stage, m, color, opts)),
    halo: (r, color, opts) => ctx.own(P.createHalo(stage, r, color, opts)),
    readout: (rows) => createReadout(rows),
    /* reactive helpers */
    on(id, fn) { if (ch.__controls) ch.__controls.onChange((cid, v, p) => { if (cid === id || id === '*') fn(v, p, cid); }); return ctx; },
    world(p) { return p.map((v) => v * vocab.KM); }
  };
  ctx.geo = geo; ctx.kepler = kepler; ctx.tri = tri; ctx.vocab = vocab;
  // optional extras, present only if their modules loaded
  if (polish.createGlowPool) ctx.glow = polish.createGlowPool(stage, { max: 64 });
  if (polish.createTrails) ctx.trails = polish.createTrails(stage, {});
  if (polish.createCityLights) ctx.city = polish.createCityLights(stage, {});
  if (polish.createLabels && !state.labels) state.labels = polish.createLabels(stage, camera);
  if (state.labels) ctx.labels = state.labels;
  return ctx;
}

/* keyboard: left/right arrows step chapters */
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, button, textarea')) return;
  const i = state.chapters.findIndex((c) => c.id === state.active);
  if (e.key === 'PageDown' || (e.key === 'ArrowRight' && e.shiftKey)) step(1);
  if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && e.shiftKey)) step(-1);
  function step(d) {
    const next = state.chapters[Math.min(state.chapters.length - 1, Math.max(0, i + d))];
    if (next) document.getElementById(next.id).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

/* the sky is a canvas: report size changes for the verifier and for iOS */
window.addEventListener('resize', () => stage.resize());

export { state, activate };
