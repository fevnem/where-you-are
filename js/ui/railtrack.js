// js/ui/railtrack.js — a scroll-progress rail.
//
// Adds one tick per chapter to #rail. Each tick shows its number and fills in
// proportion to how much of that chapter has been read: the section's rect is
// measured against a reading line set 35% down the viewport (the same line
// main.js pickActive() uses), so "read" and "active" agree. A thin continuous
// line shows progress through the whole document.
//
// Driven by requestAnimationFrame on scroll/resize, and by state.active — the
// shell writes body[data-chapter] whenever a chapter activates, and a
// MutationObserver turns that into a repaint. No timers.
//
// Owns only this file: it appends scoped nodes to #rail and injects one scoped
// <style>. It never edits css/base.css or the chapter buttons, both of which
// stay operable by Tab/Enter.

import { el } from './dom.js';

const STYLE_ID = 'railtrack-style';
const READ_LINE = 0.35; // fraction of the viewport treated as the reading line

const CSS = `
.railtrack {
  display: flex;
  flex-direction: column;
  gap: 0.16rem;
  flex: 0 0 auto;
  margin: 0 0 0.65rem;
  padding: 0;
}
.railtrack-tick {
  display: grid;
  grid-template-columns: 1.5rem minmax(0, 1fr);
  align-items: center;
  gap: 0.45rem;
  width: 100%;
  background: none;
  border: 0;
  border-radius: 3px;
  padding: 0.06rem 0.2rem;
  font: inherit;
  color: var(--ink-faint);
  text-align: left;
  cursor: pointer;
  transition: color 0.2s, background 0.2s;
}
.railtrack-tick:hover { color: var(--ink-dim); background: rgba(255, 255, 255, 0.03); }
.railtrack-num { font-family: var(--mono); font-size: 0.62rem; letter-spacing: 0.05em; opacity: 0.72; }
.railtrack-bar {
  position: relative;
  height: 3px;
  border-radius: 3px;
  background: var(--line-soft);
  overflow: hidden;
}
.railtrack-fill {
  position: absolute;
  top: 0; bottom: 0; left: 0;
  width: 0%;
  border-radius: 3px;
  background: var(--signal-deep);
  transition: width 0.14s linear, background 0.25s ease;
}
.railtrack-tick.is-active { color: var(--ink); }
.railtrack-tick.is-active .railtrack-num { opacity: 1; }
.railtrack-tick.is-active .railtrack-fill { background: var(--signal); }
.railtrack-line {
  position: relative;
  height: 2px;
  margin: 0 0 0.55rem;
  border-radius: 2px;
  background: var(--line-soft);
  overflow: hidden;
}
.railtrack-line-fill {
  position: absolute;
  top: 0; bottom: 0; left: 0;
  width: 0%;
  background: linear-gradient(90deg, var(--signal-deep), var(--signal));
}
@media (max-width: 900px) {
  .railtrack {
    flex-direction: row;
    align-items: center;
    gap: 0.45rem;
    margin: 0 0.55rem 0 0;
  }
  .railtrack-line { width: 3rem; height: 3px; margin: 0; }
  .railtrack-tick {
    grid-template-columns: 1fr;
    gap: 0.12rem;
    width: auto;
    padding: 0 0.15rem;
  }
  .railtrack-bar { width: 1.7rem; }
}
`;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

export function createRailTrack({ rail, chapters, state }) {
  if (!rail || !Array.isArray(chapters) || chapters.length === 0) {
    return { update() {}, destroy() {} };
  }

  injectStyle();

  const ticks = [];
  const track = el('div.railtrack', { role: 'group', 'aria-label': 'Reading progress' });

  // The continuous document line sits first, then one tick per chapter.
  const lineFill = el('span.railtrack-line-fill');
  track.appendChild(el('div.railtrack-line', { 'aria-hidden': 'true' }, [lineFill]));

  chapters.forEach((ch, i) => {
    const fill = el('span.railtrack-fill');
    const bar = el('span.railtrack-bar', {}, [fill]);
    const btn = el('button.railtrack-tick', {
      type: 'button',
      dataset: { id: ch.id, index: String(i) },
      'aria-label': 'Chapter ' + (i + 1) + ': ' + ch.title
    }, [
      el('span.railtrack-num', { text: String(i + 1).padStart(2, '0') }),
      bar
    ]);
    btn.addEventListener('click', () => {
      const section = document.getElementById(ch.id);
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    ticks.push({ id: ch.id, btn, fill });
    track.appendChild(btn);
  });

  rail.prepend(track);

  function measure() {
    const vh = window.innerHeight || document.documentElement.clientHeight || 1;
    const readLine = vh * READ_LINE;
    for (const t of ticks) {
      const section = document.getElementById(t.id);
      if (!section) continue;
      const r = section.getBoundingClientRect();
      const frac = r.height > 0 ? clamp((readLine - r.top) / r.height, 0, 1) : 0;
      t.frac = frac;
      t.fill.style.width = (frac * 100).toFixed(2) + '%';
    }
    const doc = document.documentElement;
    const max = Math.max(1, doc.scrollHeight - vh);
    const scroll = window.scrollY || doc.scrollTop || 0;
    lineFill.style.width = (clamp(scroll / max, 0, 1) * 100).toFixed(2) + '%';
  }

  function markActive() {
    const active = state ? state.active : null;
    for (const t of ticks) {
      const on = t.id === active;
      t.btn.classList.toggle('is-active', on);
      if (on) t.btn.setAttribute('aria-current', 'step');
      else t.btn.removeAttribute('aria-current');
    }
  }

  function update() {
    measure();
    markActive();
  }

  let frame = 0;
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; update(); });
  }

  // scroll + resize drive the fills; state.active changes drive the marks.
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  const bodyObs = new MutationObserver(schedule);
  bodyObs.observe(document.body, { attributes: true, attributeFilter: ['data-chapter'] });

  // late-mounted chapter content changes section heights; re-measure when it does
  const listObs = new MutationObserver(schedule);
  const list = document.getElementById('chapters');
  if (list) listObs.observe(list, { childList: true, subtree: true });

  update();

  return {
    update,
    destroy() {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      bodyObs.disconnect();
      listObs.disconnect();
      track.remove();
    }
  };
}
