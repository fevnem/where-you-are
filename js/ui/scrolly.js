// js/ui/scrolly.js — reading polish.
//
// Two purely presentational jobs:
//
//   1. Reveal prose blocks, readouts and figures as they enter the viewport —
//      a short fade-and-rise, staggered within each parent block, once only.
//   2. A thin fixed hairline across the top of the viewport that fills with
//      progress through the chapter being read.
//
// Everything is transform + opacity only. The reveal never touches box
// geometry, so document.scrollHeight is identical with every block hidden and
// with every block shown. IntersectionObserver does the detection; scroll and
// resize only schedule a single rAF repaint of the hairline. Under
// prefers-reduced-motion the reveal is switched off entirely (blocks are born
// visible) and the hairline simply tracks the scroll with no transition.
//
// Owns only this file: one scoped <style>, one fixed pointer-events:none
// hairline on <body>, and classes/inline styles on existing chapter nodes.
// destroy() removes every trace, leaving the page exactly as it was found.

const STYLE_ID = 'scrolly-style';
const BAR_ID = 'scrolly-progress';
const PENDING = 'scrolly-reveal';
const SHOWN = 'scrolly-in';

// What counts as a revealable block: prose children first (paragraphs, quotes,
// headings, lists, captions, inline figures), then the instrument panels and
// figures a chapter mounts itself.
const SELECTOR =
  '#chapters .prose > *, #chapters .readout-holder, #chapters .figure-holder, #chapters figure';

const STAGGER_MS = 65;
const STAGGER_MAX = 5; // a block never waits more than ~0.33 s

const CSS = `
#${BAR_ID} {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  z-index: 6;
  pointer-events: none;
  background: linear-gradient(90deg,
    rgba(116, 180, 255, 0.04),
    rgba(116, 180, 255, 0.12));
}
#${BAR_ID} .${BAR_ID}-fill {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  transform-origin: 0 50%;
  transform: scaleX(0);
  background: linear-gradient(90deg, var(--signal-deep, #2f6fb8), var(--signal, #74b4ff));
  box-shadow: 0 0 10px rgba(116, 180, 255, 0.4);
  opacity: 0.92;
}
.${PENDING} {
  opacity: 0;
  transform: translate3d(0, 16px, 0);
  transition:
    opacity 520ms cubic-bezier(0.22, 0.7, 0.2, 1),
    transform 520ms cubic-bezier(0.22, 0.7, 0.2, 1);
  will-change: opacity, transform;
}
.${PENDING}.${SHOWN} {
  opacity: 1;
  transform: none;
  will-change: auto;
}
@media (prefers-reduced-motion: reduce) {
  .${PENDING}, .${PENDING}.${SHOWN} {
    transition-duration: 0.001ms;
    opacity: 1;
    transform: none;
  }
}
`;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function injectStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.appendChild(style);
}

/**
 * apply(globalCtx) -> { update(), destroy() }
 * globalCtx = { stage, camera, globe, stars, chapters, state, helpers, doc, app }
 */
export function apply(globalCtx) {
  const ctx = globalCtx || {};
  const doc = ctx.doc || (typeof document !== 'undefined' ? document : null);
  if (!doc || !doc.body) return null;
  const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
  if (!win) return null;

  const reduced =
    typeof win.matchMedia === 'function' &&
    win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canObserve = typeof IntersectionObserver === 'function';

  injectStyle(doc);

  /* ---- the hairline: fixed, so it adds nothing to layout height ---------- */
  const bar = doc.createElement('div');
  bar.id = BAR_ID;
  bar.setAttribute('aria-hidden', 'true');
  const fill = doc.createElement('span');
  fill.className = BAR_ID + '-fill';
  bar.appendChild(fill);
  doc.body.appendChild(bar);

  /* ---- reveal bookkeeping ------------------------------------------------ */
  const processed = new WeakSet(); // nodes already classified
  const touched = [];              // nodes we changed, for a clean destroy()
  const live = [];                 // nodes still pending, waiting for the viewport
  let revealed = 0;                // nodes shown (or never hidden to begin with)
  let pending = 0;                 // nodes hidden and waiting

  let io = null;
  if (canObserve && !reduced) {
    io = new IntersectionObserver(onIntersect, {
      root: null,
      rootMargin: '0px 0px -12% 0px',
      threshold: 0
    });
  }

  function onIntersect(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const node = entry.target;
      if (io) io.unobserve(node);
      if (!node.classList.contains(SHOWN)) {
        node.classList.add(SHOWN);
        revealed++;
        pending--;
      }
    }
  }

  function collect() {
    let nodes;
    try {
      nodes = Array.from(doc.querySelectorAll(SELECTOR));
    } catch {
      nodes = [];
    }

    // Drop anything nested inside another reveal target so nothing is hidden
    // twice (a figure inside a figure-holder, say).
    const set = new Set(nodes);
    const outer = nodes.filter((n) => {
      let p = n.parentElement;
      while (p) {
        if (set.has(p)) return false;
        p = p.parentElement;
      }
      return true;
    });

    // Group siblings so a block staggers together.
    const groups = new Map();
    for (const node of outer) {
      if (processed.has(node)) continue;
      processed.add(node);
      const parent = node.parentElement || doc.body;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(node);
    }

    const vh = win.innerHeight || doc.documentElement.clientHeight || 1;
    for (const list of groups.values()) {
      list.forEach((node, i) => {
        touched.push(node);
        const r = node.getBoundingClientRect();
        const inView = r.bottom > 0 && r.top < vh * 0.92;
        // Already on screen (or motion is off, or no observer): show at once,
        // with no animation, so the first paint is never a blank flash.
        if (reduced || !io || inView) {
          node.classList.add(SHOWN);
          revealed++;
          return;
        }
        node.style.transitionDelay = Math.min(i, STAGGER_MAX) * STAGGER_MS + 'ms';
        node.classList.add(PENDING);
        live.push(node);
        pending++;
        io.observe(node);
      });
    }
  }

  function paintHairline() {
    const vh = win.innerHeight || doc.documentElement.clientHeight || 1;
    const active = ctx.state && ctx.state.active ? ctx.state.active : null;
    const section = active ? doc.getElementById(active) : null;
    let frac = 0;
    if (section) {
      // Progress through the chapter that is currently being read, measured
      // against the same 35% reading line main.js uses to pick the chapter.
      const r = section.getBoundingClientRect();
      const readLine = vh * 0.35;
      frac = r.height > 0 ? clamp((readLine - r.top) / r.height, 0, 1) : 0;
    } else {
      const max = Math.max(1, doc.documentElement.scrollHeight - vh);
      const y = win.scrollY || doc.documentElement.scrollTop || 0;
      frac = clamp(y / max, 0, 1);
    }
    fill.style.transform = 'scaleX(' + frac.toFixed(4) + ')';
  }

  /* ---- rAF-throttled scheduling ----------------------------------------- */
  let frame = 0;
  function schedule() {
    if (frame) return;
    frame = win.requestAnimationFrame(() => {
      frame = 0;
      paintHairline();
    });
  }
  let collectFrame = 0;
  function scheduleCollect() {
    if (collectFrame) return;
    collectFrame = win.requestAnimationFrame(() => {
      collectFrame = 0;
      update();
    });
  }

  function update() {
    collect();
    paintHairline();
  }

  win.addEventListener('scroll', schedule, { passive: true });
  win.addEventListener('resize', schedule);

  // Chapters (and their figures) can mount content after this runs.
  const holder = doc.getElementById('chapters');
  let listObs = null;
  if (holder && typeof MutationObserver === 'function') {
    listObs = new MutationObserver(scheduleCollect);
    listObs.observe(holder, { childList: true, subtree: true });
  }

  update();

  function destroy() {
    if (frame) win.cancelAnimationFrame(frame);
    if (collectFrame) win.cancelAnimationFrame(collectFrame);
    win.removeEventListener('scroll', schedule);
    win.removeEventListener('resize', schedule);
    if (listObs) listObs.disconnect();
    if (io) io.disconnect();
    for (const node of touched) {
      node.classList.remove(PENDING, SHOWN);
      node.style.transitionDelay = '';
    }
    bar.remove();
    const style = doc.getElementById(STYLE_ID);
    if (style) style.remove();
  }

  return {
    update,
    destroy,
    // read-only diagnostics for the evidence harness
    stats() {
      return {
        total: revealed + pending,
        revealed,
        pending,
        reduced,
        observing: !!io,
        hairline: fill.style.transform || 'scaleX(0)',
        barPresent: !!doc.getElementById(BAR_ID)
      };
    }
  };
}
