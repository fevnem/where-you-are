// js/ui/hero.js
//
// The masthead, upgraded into an instrument panel. Three pieces, all optional
// polish (main.js skips this module entirely if it throws, so nothing critical
// may live here):
//
//   * a one-time title reveal — a CSS class added after a frame, with the
//     animation switched off under prefers-reduced-motion;
//   * a scroll cue that links to the first chapter and fades once you move;
//   * a live status strip whose numbers are computed from the shipped maths,
//     not decoration: the constellation at its simulated epoch, how many of the
//     24 satellites a receiver in Paris can actually see above the horizon, and
//     the GDOP that geometry yields. Refreshed on a slow timer, never a frame.

import { el, $ } from './dom.js';
import { geodeticToEcef } from '../model/geo.js';
import { constellation, satelliteEcef } from '../model/kepler.js';
import { visibleSats, dop } from '../model/trilateration.js';

/* ---------- the simulation the strip reads from ---------- */

const RECEIVER = { lat: 48.8566, lon: 2.3522, hKm: 0.035 };  // Paris, at ground level
const MIN_EL = 10;              // degrees above the horizon that count as seen
const TIME_SCALE = 60;          // simulated seconds per real second (one minute a second)
const EPOCH_MS = Date.UTC(2026, 9, 9, 12, 0, 0);  // the constellation epoch, a real UTC instant
const TICK_MS = 400;            // readout refresh: 2.5 Hz, comfortably below frame rate

const REDUCED = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

// The same 24-slot baseline the chapters fly, and the observer we measure from.
const SATS = constellation(24);
const OBS_KM = geodeticToEcef(RECEIVER.lat, RECEIVER.lon, RECEIVER.hKm);

const pad = (n) => (n < 10 ? '0' : '') + n;

/** A UTC instant, rendered the way an instrument would print it. */
function utcString(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate())
    + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds())
    + ' UTC';
}

/* ---------- the module ---------- */

export function enhanceHero({ chapters = [], state = {}, stage, camera, globe } = {}) {
  const masthead = $('#masthead');
  if (!masthead || masthead.dataset.heroReady === 'yes') return;
  masthead.dataset.heroReady = 'yes';

  injectStyles();

  /* ----- title reveal: mark the existing beats, then reveal after a frame ----- */

  const beats = Array.from(masthead.children);
  beats.forEach((node, i) => {
    node.classList.add('hero-reveal');
    node.style.animationDelay = (i * 0.09).toFixed(2) + 's';
  });

  const reveal = () => masthead.classList.add('hero-in');
  if (REDUCED) reveal();                       // no animation: show it immediately
  else requestAnimationFrame(reveal);          // otherwise animate on the next frame

  /* ----- the live status strip ----- */

  const cells = {};
  const makeCell = (key, label) => {
    const value = el('span.hero-val', { dataset: { hero: key }, text: '—' });
    cells[key] = value;
    return el('div.hero-cell', {}, [el('span.hero-key', { text: label }), value]);
  };

  const status = el('div.hero-status', { dataset: { hero: 'status' } }, [
    makeCell('utc', 'UTC'),
    makeCell('sats', 'Above horizon · ' + MIN_EL + '°'),
    makeCell('gdop', 'GDOP'),
    makeCell('chapter', 'Reading')
  ]);
  masthead.appendChild(status);

  /* ----- the scroll cue ----- */

  const first = chapters[0] && chapters[0].id;
  const cue = el('a.hero-cue', {
    href: first ? '#' + first : '#chapters',
    'aria-label': 'Scroll to the first chapter'
  }, [
    el('span', { text: 'Scroll to begin' }),
    el('span.hero-cue-arrow', { text: '↓', 'aria-hidden': 'true' })
  ]);
  masthead.appendChild(cue);

  /* ----- the numbers ----- */

  let offset = 0;                                    // extra simulated seconds, for probing
  const tSim = () => (stage ? stage.time : 0) * TIME_SCALE + offset;

  let lastChapter = null;
  let lastScrolled = false;

  function render() {
    const t = tSim();

    // UTC derived from the simulated constellation epoch
    cells.utc.textContent = utcString(EPOCH_MS + Math.round(t) * 1000);

    // where the constellation is at this instant
    const positions = SATS.map((s) => satelliteEcef(s, t));

    // how many of the 24 are above the horizon from Paris
    const seen = visibleSats(positions, OBS_KM, MIN_EL);
    cells.sats.textContent = seen.length + ' / ' + SATS.length;

    // GDOP from the satellites the receiver can actually use (needs four or more)
    const usable = seen.map((v) => positions[v.i]);
    const d = usable.length >= 4 ? dop(usable, OBS_KM) : null;
    cells.gdop.textContent = d && isFinite(d.gdop) ? d.gdop.toFixed(2) : '—';

    // chapter progress, following state.active
    const idx = chapters.findIndex((c) => c.id === state.active);
    const label = idx >= 0
      ? 'chapter ' + (idx + 1) + ' of ' + chapters.length
      : (chapters.length ? 'chapter — of ' + chapters.length : 'loading');
    if (label !== lastChapter) { cells.chapter.textContent = label; lastChapter = label; }

    // the cue gets out of the way once the reader has moved
    const scrolled = (window.scrollY || window.pageYOffset || 0) > 48;
    if (scrolled !== lastScrolled) {
      cue.classList.toggle('is-hidden', scrolled);
      lastScrolled = scrolled;
    }
  }

  render();
  const timer = setInterval(render, TICK_MS);

  /* ----- a small handle, for inspection and for the page verifier ----- */

  const api = {
    render,
    /** Advance the simulated clock by `seconds` and refresh immediately. */
    step(seconds = 0) { offset += Number(seconds) || 0; render(); return api; },
    /** The values currently printed in the strip, read back from the DOM. */
    readouts() {
      return {
        utc: cells.utc.textContent,
        sats: cells.sats.textContent,
        gdop: cells.gdop.textContent,
        chapter: cells.chapter.textContent,
        tSimSeconds: Math.round(tSim())
      };
    },
    stop() { clearInterval(timer); }
  };
  if (state) state.hero = api;
  return api;
}

/* ---------- styles, scoped to a class prefix we own ---------- */

function injectStyles() {
  if (document.getElementById('hero-styles')) return;
  const style = document.createElement('style');
  style.id = 'hero-styles';
  style.textContent = `
#masthead .hero-reveal { opacity: 1; }
#masthead.hero-in .hero-reveal { animation: heroRise 0.85s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
@keyframes heroRise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}

#masthead .hero-status {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0.9rem 1.7rem;
  margin: 1.6rem 0 0;
  padding-top: 1.1rem;
  border-top: 1px solid var(--line-soft, #16202e);
}
.hero-cell { display: flex; flex-direction: column; gap: 0.18rem; min-width: 5.5rem; }
.hero-key {
  font-family: var(--mono, monospace);
  font-size: var(--fs-100, 0.78rem);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-faint, #6d8098);
}
.hero-val {
  font-family: var(--mono, monospace);
  font-size: var(--fs-300, 1rem);
  color: var(--ink, #e8eef7);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.hero-cue {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  margin: 1.5rem 0 0;
  font-family: var(--mono, monospace);
  font-size: var(--fs-100, 0.78rem);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-faint, #6d8098);
  text-decoration: none;
  transition: opacity 0.3s ease, color 0.2s ease;
}
.hero-cue:hover { color: var(--ink-dim, #9fb0c6); }
.hero-cue.is-hidden { opacity: 0; pointer-events: none; }
.hero-cue-arrow { animation: heroBob 2.4s ease-in-out infinite; }
@keyframes heroBob {
  0%, 100% { transform: translateY(0); opacity: 0.65; }
  50% { transform: translateY(4px); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  #masthead.hero-in .hero-reveal { animation: none; }
  .hero-cue-arrow { animation: none; }
}
`;
  document.head.appendChild(style);
}
