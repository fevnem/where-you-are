// Chapter 9 — At your receiver.
// The honest error budget: ionosphere, troposphere, multipath, and the small
// print behind the blue dot. The scene injects those errors into real
// pseudoranges and lets the real solver produce the (wrong) fix, then draws the
// miss — magnified, because at true scale a few metres is invisible.

import { EARTH_R_KM } from '../engine/vocab.js';
import { el } from '../ui/dom.js';

export const id = 'ch09';
export const title = 'At your receiver';
export const kicker = 'The error budget behind the blue dot';

export const prose = [
  `You have spent eight chapters solving a puzzle with clean numbers. The satellites sent
  exact times, the ranges came out as exact distances, and the spheres met exactly where
  they had to. Your phone gets no such courtesy. It gets an *approximate* range to each
  satellite, and the whole craft of the receiver is keeping that approximation small.`,

  `## What is in the budget`,

  `- **Ionosphere.** Between roughly 60 and 1 000 km up, sunlight knocks electrons loose
  from the air, and a radio wave crossing that charged gas is delayed. Late arrival reads
  as extra distance: the range comes out *too long*. Straight overhead the delay is a
  handful of metres, and it grows fivefold or more for a satellite low on the horizon,
  because the signal then crosses much more of the layer.`,

  `- **Troposphere.** The last 12 km of ordinary air delays the signal too — about $2.4$
  metres at zenith, up to $25$ metres at the horizon. This one is easy: the lower
  atmosphere is stable and well surveyed, so a standard model removes almost all of it,
  leaving a centimetre or two.`,

  `- **Multipath.** In a street your antenna hears each satellite more than once. A copy of
  the signal bounces off a wall or the road, arrives a little late, and the receiver —
  which cannot tell the copies apart — measures a range that is several metres long. This
  is the error that depends on where you are standing, and no broadcast model can remove it.`,

  `- **Clock and orbit.** The satellite’s own clock and its predicted position are each
  good to about a metre, and the receiver’s electronics add a fraction of a metre of noise.
  Small, but not zero.`,

  `> The picture magnifies your error about ninety thousand times, because at true scale a
  five-metre mistake is invisible against the globe. Every element is drawn to the same
  exaggerated scale, so the drawing is honest about the *ratios* — not the size.`,

  `## The dot on the map`,

  `When your phone draws a blue dot inside a faint circle, that circle is not a measurement
  of the error. It is an estimate from the inside: how well the ranges agree with one
  another, scaled by how well the satellites are spread across the sky — the DOP you met in
  [Chapter 6](#ch06). The radius it prints is a *horizontal* one-sigma circle, inside which
  the phone believes there is roughly a two-in-three chance you are. It is a statistical
  claim, not a boundary.`,

  `It also says nothing about your altitude, and altitude is usually worse: with a typical
  sky the vertical error runs about one-and-a-half times the horizontal one, because every
  satellite sits *above* you and gives the receiver almost no leverage on the up-down
  direction.`,

  `The uncomfortable part is the gap between the ring and the truth. A circle built from the
  fit assumes the leftover errors are random and impartial. Ionosphere and multipath errors
  are neither: they lean consistently one way, and several satellites lean together. The
  receiver reports a confident five metres while the true position sits half again as far
  away — outside the circle it drew.`,

  `— Drag the ionosphere down and switch its model off: the ring swells and the dot slides
  away from you. Add multipath and watch it refuse to settle. Put both back and the fix
  snaps home. This is the last trick in the chain — not a better signal, but a better
  argument about how much to trust the one you have.`
];

export const controls = [
  {
    id: 'iono', label: 'Ionosphere — zenith delay', type: 'range',
    min: 0, max: 30, step: 0.5, value: 12, unit: 'm',
    hint: 'how much the charged upper atmosphere slows the signal straight overhead',
    format: (v) => v.toFixed(1) + ' m'
  },
  {
    id: 'tropo', label: 'Troposphere — zenith delay', type: 'range',
    min: 0, max: 12, step: 0.1, value: 2.4, unit: 'm',
    hint: 'the neutral air below; small overhead, larger near the horizon',
    format: (v) => v.toFixed(1) + ' m'
  },
  {
    id: 'mp', label: 'Multipath — city reflections', type: 'range',
    min: 0, max: 40, step: 1, value: 0, unit: 'm',
    hint: 'a reflected copy arrives late, so the range reads long',
    format: (v) => v.toFixed(0) + ' m'
  },
  {
    id: 'correct', label: 'Receiver models the ionosphere', type: 'toggle', value: true,
    hint: 'the broadcast model removes most of the ionosphere, but not all of it'
  }
];

export const checks = [
  {
    id: 'ch09-a',
    q: 'Your phone shows a blue dot inside a circle a few metres wide. What is that circle claiming?',
    options: [
      'The furthest you can possibly be from the dot',
      'A horizontal one-sigma circle: about a two-in-three chance that the truth is inside it',
      'The error, measured against your true position',
      'The distance from you to the satellites'
    ],
    answer: 1,
    why: 'It is an estimate built from how well the ranges fit one another, quoted as a horizontal one-sigma radius. It is not a bound, and it is drawn only in the horizontal plane — your altitude is not in that number at all.'
  },
  {
    id: 'ch09-b',
    q: 'The ionosphere adds $8$ metres of delay straight overhead. What does it add to a satellite at $12°$ elevation, where the signal crosses far more of the layer?',
    options: [
      'About $8$ m — the delay is the same in every direction',
      'About $16$ m',
      'About $38$ m',
      'Less, because the signal is weaker'
    ],
    answer: 2,
    why: 'The slant delay is roughly the zenith value divided by the sine of the elevation: $8 / \\sin 12° \\approx 38$ metres. The satellites low on the horizon, whose signals graze the atmosphere, carry the largest single error in the budget.'
  },
  {
    id: 'ch09-c',
    q: 'Standing between tall buildings, which error can the receiver not remove, because it depends on where you are standing?',
    options: [
      'The ionosphere',
      'The troposphere',
      'Multipath — a reflected copy of the signal arriving late',
      'The satellite clock'
    ],
    answer: 2,
    why: 'Reflections depend on the walls around you, not on anything the satellite broadcasts, so no model can predict them. A reflected range is consistently too long, which is why the dot can look confident and still be wrong.'
  }
];

export const view = { target: [0, 0, 0], dist: 64, yaw: 0.9, pitch: 0.42 };

/* ------------------------------------------------------------------ *
 * The scene.                                                        *
 * ------------------------------------------------------------------ */

const DEG = Math.PI / 180;
const EXAG = 90000;            // world units per metre of true error (label it!)
const M2U = 1e-6 * EXAG;       // metres -> exaggerated world units
const MAXV = 8;                // satellites drawn and solved with
const LIFT = 0.04;             // lift the local picture off the surface (world units)

// A stable per-satellite pseudo-random factor, so multipath does not flicker.
const hash = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

const addV = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scaleV = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

function mountReadout(ctx, readout) {
  const host = document.getElementById(ctx.id);
  if (!host) return;
  let slot = host.querySelector('.readout-holder.ch09');
  if (!slot) {
    slot = el('div.readout-holder.ch09');
    slot.appendChild(el('p.readout-title', { text: 'The error budget, live' }));
    host.appendChild(slot);
  }
  const old = slot.querySelector('.readout');
  if (old) old.remove();
  slot.appendChild(readout.node);
}

export function createScene(ctx) {
  const { constellation, spheres, station, points, lines, ring, readout, world, geo, tri, params } = ctx;

  // A receiver in Paris, on a frozen sky so the geometry does not drift.
  const here = geo.geodeticToEcef(48.8566, 2.3522, 0.035);   // km
  const hereW = world(here);                                  // world units
  const basis = geo.enuBasis(here);

  const sky = constellation({ timeScale: 0, trails: false, size: 7 });
  sky.setTimeScale(0);
  sky.setEpoch(7200);
  sky.update(0);

  const me = station(here, [0.45, 0.95, 0.75, 1]);

  // The ionosphere, drawn as the shell the delays live in; its glow tracks the slider.
  const shell = spheres({ max: 1 });

  // The phone's claimed circle, in the horizontal plane, and the true miss.
  const accRing = ring([0.96, 0.82, 0.44, 0.95], { visible: false, width: 2 });
  const fixPoint = points([0, 0, 0], [1.0, 0.66, 0.34, 1], { size: 13, visible: false });
  const missLine = lines(new Float32Array(6), [1.0, 0.5, 0.3, 0.9], { layer: 'overlay', visible: false });

  // One range line per visible satellite, coloured by how much it is delayed.
  const rays = [];
  for (let k = 0; k < MAXV; k++) {
    rays.push(lines(new Float32Array(6), [0.5, 0.8, 1, 0.75], { layer: 'transparent', visible: false }));
  }

  const panel = readout([
    { key: 'claim', label: 'Phone says' },
    { key: 'miss', label: 'True horizontal miss' },
    { key: 'uere', label: 'Range error (rms)' },
    { key: 'hdop', label: 'Geometry HDOP' },
    { key: 'iono', label: 'Ionosphere, worst sat' },
    { key: 'mp', label: 'Multipath, worst sat' },
    { key: 'sat', label: 'Satellites used' }
  ]);
  mountReadout(ctx, panel);

  // blue (clean range) -> red (heavily delayed)
  function delayColor(m) {
    const t = Math.min(1, Math.max(0, m / 40));
    return [0.35 + 0.62 * t, 0.7 - 0.42 * t, 1.0 - 0.78 * t, 0.85];
  }

  function compute(t) {
    sky.update(t);
    const pos = sky.positionsKm();

    const ionoZen = (params.iono ?? 8) * (params.correct === false ? 1 : 0.3); // m of residual
    const tropoZen = (params.tropo ?? 2.4) * 0.05;                            // m of residual
    const mpBase = params.mp ?? 0;                                            // m

    // Ionosphere shell glows with the absolute delay, model or no model.
    shell.setSpheres([{
      center: [0, 0, 0],
      radiusKm: EARTH_R_KM + 350,
      color: [0.34, 0.6, 1.0, 0.06 + 0.26 * ((params.iono ?? 8) / 30)],
      visible: true
    }]);

    const view = sky.visibleFrom(here, 8).slice(0, MAXV);

    if (view.length < 4) {                       // cannot solve; keep it quiet
      rays.forEach((r) => { r.visible = false; });
      accRing.set(null, 0, null); accRing.visible = false;
      fixPoint.visible = false; missLine.visible = false;
      panel.setAll({ claim: '—', miss: '—', uere: '—', hdop: '—', iono: '—', mp: '—', sat: view.length });
      return;
    }

    // Build the pseudoranges the receiver would actually see.
    let worstIono = 0, worstMp = 0;
    const satsU = view.map((v) => pos[v.i]);
    const rho = satsU.map((s, k) => {
      const v = view[k];
      const sinEl = Math.max(Math.sin(v.el * DEG), 0.09);
      const iRes = (ionoZen / 1000) / sinEl;                       // km, slant
      const tRes = (tropoZen / 1000) / Math.max(Math.sin(v.el * DEG), 0.05);
      const mp = (mpBase / 1000) * (0.3 + 0.7 * hash(v.i)) * (0.4 + (90 - v.el) / 90);
      worstIono = Math.max(worstIono, iRes * 1000);
      worstMp = Math.max(worstMp, mp * 1000);
      return tri.rangeKm(here, s) + iRes + tRes + mp;
    });

    const fix = tri.solvePosition(satsU, rho);
    const d = tri.dop(satsU, here) || { hdop: 1 };

    // How wrong the receiver actually is, in the local frame.
    const enu = geo.toEnu(here, fix.pos);            // km
    const E = enu[0] * 1000, N = enu[1] * 1000, U = enu[2] * 1000;
    const miss = Math.hypot(E, N);

    // What the receiver *thinks* its error is: the fit residual, scaled by geometry.
    const res = rho.map((r, i) => (tri.rangeKm(fix.pos, satsU[i]) + fix.biasKm - r) * 1000);
    const uere = Math.sqrt(res.reduce((a, v) => a + v * v, 0) / res.length);
    const claim = d.hdop * uere;

    panel.setAll({
      claim: '± ' + claim.toFixed(1) + ' m',
      miss: miss.toFixed(1) + ' m',
      uere: uere.toFixed(1) + ' m',
      hdop: d.hdop.toFixed(2),
      iono: worstIono.toFixed(1) + ' m',
      mp: worstMp.toFixed(1) + ' m',
      sat: view.length
    });

    // Range lines, coloured by their delay.
    for (let k = 0; k < MAXV; k++) {
      const ray = rays[k];
      if (k >= view.length) { ray.visible = false; continue; }
      const v = view[k];
      const sW = world(pos[v.i]);
      ray.setPositions([hereW[0], hereW[1], hereW[2], sW[0], sW[1], sW[2]]);
      ray.setColor(delayColor(worstFor(v)));
      ray.visible = true;
    }
    function worstFor(v) {
      const sinEl = Math.max(Math.sin(v.el * DEG), 0.09);
      return (ionoZen / sinEl) + (tropoZen / Math.max(Math.sin(v.el * DEG), 0.05))
        + mpBase * (0.3 + 0.7 * hash(v.i)) * (0.4 + (90 - v.el) / 90);
    }

    // The local picture: claimed ring, true miss — both magnified equally.
    const base = addV(hereW, scaleV(basis.up, LIFT));
    let dE = E * M2U, dN = N * M2U;
    const mag = Math.hypot(dE, dN);
    const cap = 2.5;
    if (mag > cap) { const s = cap / mag; dE *= s; dN *= s; }
    const missW = addV(addV(base, scaleV(basis.east, dE)), scaleV(basis.north, dN));

    const ringR = Math.min(2.5, Math.max(0.03, claim * M2U));
    accRing.set(base, ringR, basis.up);
    accRing.visible = true;

    fixPoint.setPositions([missW[0], missW[1], missW[2]]);
    fixPoint.visible = true;

    missLine.setPositions([base[0], base[1], base[2], missW[0], missW[1], missW[2]]);
    missLine.visible = miss > 0.3;
  }

  return {
    update(t) { compute(t); },
    onChange() { compute(0); },
    // Actors are removed by ctx.own(). The readout holder is left in place so the
    // page height does not change when this chapter scrolls out of view.
    dispose() {}
  };
}
