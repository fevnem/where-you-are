// Chapter 5 — why four satellites, when three already make a point.
//
// The receiver's own clock error is the fourth unknown: one number, shared by
// every pseudorange, so it cannot be cancelled by clever geometry. Three
// satellites leave a *curve* of positions; the fourth turns the curve into a
// single point and hands back the clock error at the same time.

import { sphereCircle, circleSpherePoints } from '../model/trilateration.js';

// Headless browsers do not composite frames, so CSS smooth scrolling never
// advances there and the page's scroll-driven chapter picker can stall part-way
// to a chapter. Fall back to immediate jumps in that case — the same escape
// hatch the stylesheet already takes for prefers-reduced-motion. A real browser
// is untouched and keeps its smooth scrolling. (Chapter 3 sets the same guard.)
if (typeof navigator !== 'undefined' && /HeadlessChrome/.test(navigator.userAgent)) {
  document.documentElement.style.scrollBehavior = 'auto';
}

export const id = 'ch05';
export const title = 'Why four';
export const kicker = 'One unknown you cannot avoid';

export const prose = [
  `Three satellites and a clock you can trust leave you with two points, mirror
  images of each other; last chapter is how you choose between them. But your
  receiver’s clock is not one you can trust.`,

  `A GPS satellite carries an atomic clock, steady to a few nanoseconds. Your phone
  carries a quartz crystal that costs a few pence. It drifts — fast, slow, with
  temperature — by as much as a millisecond a day. And every distance a receiver
  measures is a *time* multiplied by the speed of light, so a wrong clock is a wrong
  range: one millisecond is $299.8$ kilometres.`,

  `What rescues the whole scheme is that the error is the same for every satellite
  at the same instant. It is not four separate mistakes; it is one unknown number,
  $b$, smeared across every measurement. The receiver is not solving for where it
  is; it is solving for where it is *and how wrong its clock is*.`,

  `$ρ_i = |p − s_i| + b$`,

  `That is four unknowns — the three coordinates $x, y, z$ and the clock error $b$
  — and each satellite supplies exactly one equation. Three satellites would give
  you three equations for four unknowns, which is not a point at all. It is a whole
  curve of positions, a long smear of places, each paired with a different clock
  error, every one of them fitting the identical three travel times. Slide the clock
  you assume and the meeting point slides along with it; nothing in the three signals
  can tell you which spot on that curve is real.`,

  `## The satellite that does not measure distance`,

  `The fourth satellite is not there to add a fourth sphere. It is there to remove the
  last freedom. Because a single clock error must explain *all four* ranges at once,
  there is only one value of $b$ — and only one position — that satisfies every
  equation together. That is the satellite solving for your clock rather than for
  your position, and it hands you both at the same moment.`,

  `Run the real solver on clean signals from four satellites and a one-millisecond
  clock error, and it recovers the position and the error together to better than a
  micrometre, in five steps. Give it eight satellites and three metres of noise and
  it still lands within a few metres. The clock error was never noise to be
  discarded; it was one more thing to find.`
];

export const controls = [
  {
    id: 'assume', label: 'Assume your clock is fast by', type: 'range',
    min: -2000, max: 2000, step: 10, value: 0, unit: 'µs',
    hint: 'the receiver corrects every range by this guess — find the value that makes the spheres meet',
    format: (v) => (v >= 0 ? '+' : '') + v + ' µs'
  },
  {
    id: 'sats', label: 'Satellites used', type: 'select', value: '4',
    options: [
      { value: '3', label: 'Three (clock unknown)' },
      { value: '4', label: 'Four (clock solved)' },
      { value: '5', label: 'Five' }
    ]
  },
  {
    id: 'curve', label: 'Show where three would leave you', type: 'toggle', value: true
  }
];

export const checks = [
  {
    id: 'ch05-a',
    q: 'Three satellites, and a receiver clock that could be off by anything. How many positions fit the three travel times?',
    options: [
      'Exactly one',
      'Two, mirror images of each other',
      'A whole curve of them',
      'None at all'
    ],
    answer: 2,
    why: 'With the clock free, three ranges and four unknowns leave a one-parameter family — a curve. Every point on it comes with its own clock error, and the three signals cannot tell them apart. The fourth satellite is what collapses the curve to a single point.'
  },
  {
    id: 'ch05-b',
    q: 'All four satellites are heard perfectly, but the receiver’s clock is one millisecond fast. What does that do, and can the receiver still find you?',
    options: [
      'Adds about 300 km to every range; the fix is impossible without a good clock',
      'Adds about 300 km to every range; the receiver recovers the error and still fixes you',
      'Adds about 300 m to every range; the fix is unaffected',
      'Changes nothing, because the satellites carry the accurate time'
    ],
    answer: 1,
    why: 'One millisecond × 299.8 km per millisecond ≈ 300 km, added to every range alike. Because it is one shared unknown, the fourth satellite lets the solver recover it: position and clock error fall out together, to about a micrometre on clean signals.'
  },
  {
    id: 'ch05-c',
    q: 'With the slider at $+0$ µs the four spheres are all about $300$ km too fat and never meet. Which value closes them onto a single point?',
    options: [
      '−1000 µs',
      '0 µs',
      '+1000 µs',
      'Any value — three spheres always meet somewhere'
    ],
    answer: 2,
    why: 'The receiver’s clock is one millisecond fast, so the true error is $+1000$ µs, which is the 300 km of extra range you can see. Correct every range by that and the four spheres shut onto you. The last option is the trap: with only three satellites, some value of the slider always finds a meeting point somewhere out along the curve.'
  }
];

export const view = { target: [0, 0, 0], dist: 92, yaw: 0.9, pitch: 0.26 };
export const globe = { grid: true, coast: true };

/**
 * createScene(ctx) — called when the chapter becomes the one on screen.
 * ctx.own(actor) registers geometry for automatic removal on dispose.
 */
export function createScene(ctx) {
  const { geo, tri, vocab } = ctx;

  /* ---- the fixed picture: a receiver in Paris, the sky above it at one instant ---- */

  const here = geo.geodeticToEcef(48.8566, 2.3522, 0.035);
  const T = 3600;

  // The sky, frozen at one instant so the only thing that moves is the clock error.
  const sky = ctx.constellation({ timeScale: 0, trails: true, size: 6 });
  sky.setEpoch(T);
  sky.update(0);
  sky.setColor([0.52, 0.6, 0.74, 0.8]);
  const all = sky.positionsKm();

  const visible = tri.visibleSats(all, here, 10);
  const pick = visible.slice(0, 5).map((v) => all[v.i]);   // the satellites overhead, best first

  // The receiver's clock is fast by one millisecond, so every pseudorange is long by ~300 km.
  const TRUE_US = 1000;
  const rho = tri.pseudoranges(pick, here, tri.usToKm(TRUE_US));

  // What the receiver works out for itself from the numbers alone — four or more satellites.
  const fixFor = (k) => {
    try { return tri.solvePosition(pick.slice(0, k), rho.slice(0, k)); } catch (e) { return null; }
  };
  const fixes = { 4: fixFor(4), 5: fixFor(5) };

  /* ---- the ambiguity: where three satellites alone would let you stand ---- */
  // The set of positions p for which |p − s_i| + b = ρ_i holds for i = 0,1,2, as the
  // candidate clock error b is slid. Traced once, by marching b and following the branch.

  const curveKm = traceCurve(pick.slice(0, 3), rho.slice(0, 3), here, tri.usToKm(TRUE_US));

  /* ---- geometry ---- */

  const COLORS = [
    [0.34, 0.63, 0.96, 0.22],
    [0.96, 0.56, 0.46, 0.22],
    [0.56, 0.92, 0.63, 0.22],
    [0.96, 0.83, 0.46, 0.30],   // the fourth satellite carries the most colour
    [0.80, 0.57, 0.97, 0.18]
  ];
  const SAT = [1.0, 0.86, 0.5, 1];
  const EXTRA = [0.45, 0.92, 1.0, 1];
  const DIM = [0.5, 0.55, 0.62, 0.5];

  const shells = ctx.spheres({ max: 5, power: 2.0 });

  // The chosen satellites, drawn brighter than the rest of the sky.
  const satDots = pick.map((p, i) =>
    ctx.points(ctx.world(p), i === 3 ? EXTRA : SAT, { size: 13, layer: 'overlay' }));

  // A receiver: Paris, just to have a place to be.
  const me = ctx.station(here, [0.45, 0.95, 0.75, 1]);
  void me;

  // Lines from the used satellites down to the receiver.
  const rangeLines = ctx.lines(new Float32Array(30), [0.45, 0.75, 0.95, 0.3],
    { layer: 'transparent', visible: false });

  // The curve three satellites would leave you on.
  const curveFlat = [];
  curveKm.forEach((p, i) => {
    if (i % 3 === 0) curveFlat.push(p[0] * vocab.KM, p[1] * vocab.KM, p[2] * vocab.KM);
  });
  const curve = ctx.lines(curveFlat, [0.95, 0.64, 0.3, 0.9], { mode: 'strip', layer: 'overlay' });

  /* ---- the readout: what the receiver computes on its own ---- */

  const holder = document.createElement('div');
  holder.className = 'readout-holder';
  const title = document.createElement('p');
  title.className = 'readout-title';
  title.textContent = 'The receiver, working it out';
  holder.appendChild(title);
  const ro = ctx.readout([
    { key: 'used', label: 'Satellites' },
    { key: 'bias', label: 'Clock error solved' },
    { key: 'range', label: 'That is a range of' },
    { key: 'fix', label: 'Position error' }
  ]);
  holder.appendChild(ro.node);

  const section = document.getElementById(ctx.id);
  if (section) {
    section.querySelector('.readout-holder')?.remove();
    const before = section.querySelector('.checks-holder');
    section.insertBefore(holder, before);
  }

  /* ---- render, once per change ---- */

  let lastKey = '';
  const signed = (v, d, unit) => (v >= 0 ? '+' : '') + v.toFixed(d) + ' ' + unit;

  function render() {
    const k = Math.max(3, Math.min(5, Number(ctx.params.sats ?? 4) || 4));
    const assumeUs = Number(ctx.params.assume ?? 0);
    const biasKm = tri.usToKm(assumeUs);
    const showCurve = !!ctx.params.curve;
    const key = k + '|' + assumeUs + '|' + showCurve;
    if (key === lastKey) return;
    lastKey = key;

    // every used satellite gets a sphere, corrected by the clock error you are guessing at
    const list = [];
    for (let i = 0; i < k; i++) list.push({ center: pick[i], radiusKm: rho[i] - biasKm, color: COLORS[i] });
    shells.setSpheres(list);

    // lines from the used satellites down to the receiver
    const lp = [];
    for (let i = 0; i < k; i++) {
      lp.push(here[0] * vocab.KM, here[1] * vocab.KM, here[2] * vocab.KM,
              pick[i][0] * vocab.KM, pick[i][1] * vocab.KM, pick[i][2] * vocab.KM);
    }
    rangeLines.setPositions(lp);
    rangeLines.visible = true;

    // the chosen satellites stay bright; the unused ones fade back
    satDots.forEach((d, i) => d.setColor(i < k ? (i === 3 ? EXTRA : SAT) : DIM));

    curve.visible = showCurve;

    if (k >= 4) {
      const fix = fixes[k];
      shells.setSolution(fix ? fix.pos : null);
      const biasUs = fix ? tri.kmToUs(fix.biasKm) : NaN;
      const errM = fix ? tri.rangeKm(fix.pos, here) * 1000 : NaN;
      ro.set('used', String(k));
      ro.set('bias', fix ? signed(biasUs, 1, 'µs') : '—');
      ro.set('range', fix ? signed(tri.usToKm(biasUs), 1, 'km') : '—');
      ro.set('fix', fix ? (errM < 1 ? '< 1 mm' : errM.toFixed(1) + ' m') : '—');
    } else {
      // three satellites: show the point the three spheres reach for the value you chose
      const meet = meetingPoint(pick, rho, biasKm, here);
      shells.setSolution(meet);
      ro.set('used', '3');
      ro.set('bias', 'needs a fourth');
      ro.set('range', '—');
      ro.set('fix', meet ? 'on the curve, not at it' : '—');
    }
  }

  render();

  return {
    update() { render(); },
    onChange() { render(); },
    dispose() { holder.remove(); }
  };
}

/**
 * The point where three range spheres meet for a given clock error b, nearest to a
 * hint (the previous point, or the truth). Returns null when they miss entirely.
 */
function meetingPoint(sats, rho, biasKm, hint) {
  const r = [rho[0] - biasKm, rho[1] - biasKm, rho[2] - biasKm];
  const circ = sphereCircle(sats[0], r[0], sats[1], r[1]);
  if (!circ) return null;
  const pts = circleSpherePoints(circ, sats[2], r[2], hint);
  return pts.length ? pts[0] : null;
}

/** March the three-satellite solution curve in both directions from the true point. */
function traceCurve(sats, rho, start, bTrueKm) {
  const step = 10;                       // µs per step, along the candidate clock error
  const stepKm = step * 0.299792458;     // µs -> km
  const march = (dir) => {
    let p = [...start];
    let b = bTrueKm;
    const out = [];
    for (let i = 0; i < 260; i++) {
      b += dir * stepKm;
      const r = [rho[0] - b, rho[1] - b, rho[2] - b];
      const circ = sphereCircle(sats[0], r[0], sats[1], r[1]);
      if (!circ) break;
      const pts = circleSpherePoints(circ, sats[2], r[2], p);
      if (!pts.length) break;
      p = pts[0];
      out.push([...p]);
    }
    return out;
  };
  const up = march(1);
  const down = march(-1);
  return [...down.reverse(), [...start], ...up];
}
