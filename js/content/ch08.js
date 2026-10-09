// Chapter 8 — Thirty-eight microseconds.
// Two relativistic effects, opposite signs, and a clock that has to be built
// deliberately wrong or the fix slides eleven kilometres a day.

import { KM, C_KM_S } from '../engine/vocab.js';
import { geodeticToEcef, enuBasis } from '../model/geo.js';
import { el } from '../ui/dom.js';

export const id = 'ch08';
export const title = 'Thirty-eight microseconds';
export const kicker = 'Two effects, opposite signs, and one number built into the clock';

/* The numbers this chapter is about. Slow is negative, fast positive: special
   relativity costs the clock 7.2 µs a day, general relativity gives it back
   45.9, and the satellite is tuned to run 38.7 µs a day fast before launch. */
const KM_PER_US = C_KM_S / 1e6;             // 0.29979 km travelled by light in a microsecond
const SR_US_DAY = -7.2;                     // moving clock runs slow
const GR_US_DAY = 45.9;                     // clock higher in the well runs fast
const EXAG = 8;                             // the drift ring is drawn this much larger than life

const RECEIVER = geodeticToEcef(48.8566, 2.3522, 0.035);   // Paris, in km
const RECEIVER_U = RECEIVER.map((v) => v * KM);            // world units
const UP = unit(RECEIVER);                                 // local vertical: the ring's normal
const EAST = enuBasis(RECEIVER).east;                      // a direction in the tangent plane

function unit(a) { const L = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / L, a[1] / L, a[2] / L]; }
function sgn(x, d = 1) { return (x < 0 ? '−' : '+') + Math.abs(x).toFixed(d); }
function netRate(p) { return p.corrected ? 0 : (p.gr ? GR_US_DAY : 0) + (p.sr ? SR_US_DAY : 0); }

export const prose = [
  `A GPS satellite carries atomic clocks steady to a few nanoseconds a day, and every one of
  them is wrong — deliberately. A satellite clock does not tick at the rate of the clock in
  your pocket. Fly a perfect one to 20,200 kilometres and leave it to itself and it will not
  agree with the ground: it runs fast, by about thirty-eight microseconds a day.`,

  `Two effects set that rate, and they pull in opposite directions. The first is speed. The
  satellite falls around the Earth at roughly 3.87 kilometres a second, and a moving clock
  ticks slower than a resting one. Special relativity costs it **7.2 microseconds** a day.`,

  `The second is gravity, or the lack of it. The satellite hangs far above the well, where
  Earth’s pull is weak and time runs quicker. General relativity hands the clock back
  **45.9 microseconds** a day.`,

  `Set the two against each other and gravity wins, but not by much:
  $45.9 - 7.2 = 38.7$ microseconds, gained every day. Now spend it. The chapters before this
  one turned a delay in time into a distance in space at 0.29979 kilometres a microsecond, and
  the same conversion holds here: 38.7 microseconds is **11.6 kilometres** — your fix sliding
  away from the truth at a little over a kilometre every two hours.`,

  `> GPS does not fight the drift; it plans for it. Each clock is tuned before launch to run
  slow by 4.465 parts in 10^10^, a deliberate error, so that once the two relativistic effects
  are added back on orbit it keeps exactly the rate your receiver assumes.`,

  `— The ring is your uncertainty, not the satellite: the patch of ground the fix could have
  wandered into, drawn several times larger than life or it would be a speck. Switch the
  correction off, drag the days, and watch it grow.`,

  `## A constant, not a cure`,

  `The applied correction is one number, chosen for the nominal orbit. The satellite’s real
  path is a little elliptical, so its speed and its height change a fraction on every pass. The
  leftover — tens of nanoseconds rather than tens of microseconds — travels down in the
  navigation message and your receiver takes it out. The big number is settled in the factory.
  The small ones are arithmetic.`
];

export const controls = [
  {
    id: 'corrected', label: 'Launch correction applied', type: 'toggle', value: false,
    hint: 'satellite clocks are tuned to run slow, on purpose, before launch',
    format: (v) => (v ? 'on — the clocks agree' : 'off — the clocks run fast')
  },
  {
    id: 'gr', label: 'General relativity — the height', type: 'toggle', value: true,
    hint: 'a clock higher in the well ticks faster',
    format: (v) => (v ? '+45.9 µs/day' : 'effect ignored')
  },
  {
    id: 'sr', label: 'Special relativity — the speed', type: 'toggle', value: true,
    hint: 'a clock falling past you ticks slower',
    format: (v) => (v ? '−7.2 µs/day' : 'effect ignored')
  },
  {
    id: 'days', label: 'Days left uncorrected', type: 'range',
    min: 0, max: 30, step: 1, value: 7,
    hint: 'how long the fix has been left to slide',
    format: (v, p) => {
      const drift = netRate(p) * v;
      return `${v}${v === 1 ? ' day' : ' days'} · ${sgn(drift)} µs · ${(Math.abs(drift) * KM_PER_US).toFixed(1)} km`;
    }
  }
];

export const checks = [
  {
    id: 'ch08-a',
    q: 'The two effects pull opposite ways. Which one wins, and by how much each day?',
    options: [
      'Special relativity, by about 38 microseconds',
      'General relativity, by about 38 microseconds',
      'Neither — they cancel exactly',
      'General relativity, by about 53 microseconds'
    ],
    answer: 1,
    why: 'The gravitational gain (45.9 µs) beats the speed loss (7.2 µs) by 38.7 µs a day, and the clock is built to run slow by exactly that difference — so the two effects, added to the deliberate offset, come out at zero.'
  },
  {
    id: 'ch08-b',
    q: 'You switch the launch correction off and leave it off for a week. Roughly how far has the fix wandered by then?',
    options: [
      'About 80 metres',
      'About 80 kilometres',
      'About 800 kilometres',
      'Nowhere — the receiver works the drift out from the navigation message'
    ],
    answer: 1,
    why: 'Seven days at 11.6 kilometres a day is about 81 kilometres. The correction is not a refinement to be skipped: leave it off and your position is wrong by the distance between two cities, and the gap widens every day.'
  }
];

export const view = { target: RECEIVER_U, dist: 22, yaw: 0.06, pitch: 0.86 };

/* ---- readout panel: mounted once into the chapter's section, kept across activations ---- */

let panel = null;

function mountReadout(ctx) {
  try {
    const section = document.getElementById(ctx.id);
    if (!section) return;
    let holder = section.querySelector('.readout-holder');
    if (!holder) {
      holder = el('div.readout-holder', {}, [el('p.readout-title', { text: 'The clock budget' })]);
      section.appendChild(holder);
    }
    if (!panel || !panel.node.isConnected) {
      panel = ctx.readout([
        { key: 'sr', label: 'Speed (special relativity)' },
        { key: 'gr', label: 'Height (general relativity)' },
        { key: 'net', label: 'Net rate' },
        { key: 'clock', label: 'Clock drift' },
        { key: 'error', label: 'Position error' }
      ]);
      holder.appendChild(panel.node);
    }
  } catch (err) {
    console.warn('[ch08 readout]', err);
  }
}

function syncReadout(p) {
  if (!panel) return;
  const sr = p.sr ? SR_US_DAY : 0;
  const gr = p.gr ? GR_US_DAY : 0;
  const rate = p.corrected ? 0 : sr + gr;
  const drift = rate * (p.days ?? 0);
  panel.setAll({
    sr: p.sr ? '−7.2 µs/day' : '0',
    gr: p.gr ? '+45.9 µs/day' : '0',
    net: p.corrected ? '0 (corrected)' : sgn(rate) + ' µs/day',
    clock: sgn(drift) + ' µs',
    error: (Math.abs(drift) * KM_PER_US).toFixed(1) + ' km'
  });
}

/* keep the slider's own readout honest when a toggle (not the slider) is what changed */
function syncDaysControl(p) {
  try {
    const cell = document.querySelector('[data-control="days"] .control-value');
    const spec = controls.find((c) => c.id === 'days');
    if (cell && spec) cell.textContent = spec.format(p.days ?? 0, p);
  } catch (err) { /* cosmetic only */ }
}

export function createScene(ctx) {
  const { constellation, station, ring, lines, points, params } = ctx;

  // The clocks are up there: the same sky as every other chapter, at the real rate.
  const sky = constellation({ timeScale: 60, trails: false, size: 7 });
  sky.setReceiver(RECEIVER);

  station(RECEIVER, [0.45, 0.95, 0.75, 1]);

  // The drift: a ring of uncertainty on the ground, a spoke out to its rim, and a dot at the rim.
  const circle = ring([0.98, 0.72, 0.34, 0.95], { visible: false, width: 2 });
  const spoke = lines(new Float32Array(0), [0.98, 0.72, 0.34, 0.9], { mode: 'lines', layer: 'overlay', visible: false });
  const dot = points([], [0.98, 0.72, 0.34, 0.95], { size: 9, layer: 'overlay' });

  mountReadout(ctx);
  let sig = null;

  function refresh() {
    const drift = netRate(params) * (params.days ?? 0);   // microseconds accumulated
    const errKm = Math.abs(drift) * KM_PER_US;            // kilometres, at 0.29979 km/µs
    const col = drift >= 0 ? [0.98, 0.72, 0.34, 0.95] : [0.50, 0.78, 0.98, 0.95];
    const r = errKm * KM * EXAG;                          // world units, magnified to be seen

    circle.color = col.slice();
    circle.set(RECEIVER_U, r, UP);                        // a radius of zero hides it

    if (r > 1e-6) {
      const rim = [
        RECEIVER_U[0] + EAST[0] * r,
        RECEIVER_U[1] + EAST[1] * r,
        RECEIVER_U[2] + EAST[2] * r
      ];
      spoke.setColor(col);
      spoke.setPositions([RECEIVER_U[0], RECEIVER_U[1], RECEIVER_U[2], rim[0], rim[1], rim[2]]);
      spoke.visible = true;
      dot.setColor(col);
      dot.setPositions(rim);
      dot.visible = true;
    } else {
      spoke.visible = false;
      dot.visible = false;
    }

    const next = [params.corrected, params.gr, params.sr, params.days].join('|');
    if (next !== sig) {
      sig = next;
      syncReadout(params);
      syncDaysControl(params);
    }
  }

  refresh();

  return {
    update(t) {
      sky.update(t);
      refresh();
    },
    onChange() { refresh(); },
    dispose() { /* ctx.own() removes the geometry; the readout panel stays in the text */ }
  };
}
