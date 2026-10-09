// Chapter 2 — Distance from time.
// The conversion under everything else: a delay in time becomes a distance in
// space, and the receiver's cheap clock is the part that spoils it.

import { el } from '../ui/dom.js';
import { constellation as makeConstellation, satelliteEcef } from '../model/kepler.js';
import { geodeticToEcef } from '../model/geo.js';
import { visibleSats } from '../model/trilateration.js';

export const id = 'ch02';
export const title = 'Distance from time';
export const kicker = 'A microsecond is three hundred metres, and your clock is the weak link';

// The sky is frozen here on purpose: this chapter is one conversion measured at
// leisure, not the motion. Choose the three highest satellites over Paris at that
// frozen instant, so the select below lists a real, reproducible piece of sky.
const EPOCH = 0;
const HERE = geodeticToEcef(48.8566, 2.3522, 0.035);
const PICKS = visibleSats(makeConstellation(24).map((s) => satelliteEcef(s, EPOCH)), HERE, 10).slice(0, 3);

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const compass = (az) => COMPASS[Math.round((((az % 360) + 360) % 360) / 45) % 8];

export const prose = [
  `A satellite’s message is a place and a time. That is the whole of it. *I was here*,
  it says, *and I sent this then* — no name, no address, no request. Your receiver
  listens, notes the moment the sentence arrives, and keeps just one number: how long
  the message took to cross the gap.`,

  `The distance is not measured, it is computed — from that duration and a single
  constant. Light covers $299,792.458$ kilometres every second, so shrink the second to
  a microsecond and the constant becomes something you can carry in your head: **one
  microsecond of travel is $299.8$ metres.** A millisecond is $299.8$ kilometres. Every
  range in this explainer is a time multiplied by that number.`,

  `There is a catch, and it is the catch the rest of the story hangs on. The receiver
  supplies one of the two times itself: it has to know *when* the message arrived. The
  satellite’s clock is an atomic standard, steady to a nanosecond. Yours is a quartz chip
  that wanders by whole microseconds between one street and the next. The receiver cannot
  tell a signal that travelled a little further from one that arrived a little late,
  because its own sense of *now* is the ruler.`,

  `So the distance it works out is wrong — but wrong in a particular way. Whatever error
  the clock carries, it stretches every measurement by the same amount: the same fraction
  of a second, and therefore the same distance, $c × ε$, added to every
  range in the sky at once. One unknown, shared by all of them. That is why the number is
  called a *pseudorange*, and why prising it back out will take a fourth satellite.`,

  `> One microsecond of clock error is not a microsecond of error. It is three hundred
  metres of it.`,

  `The panel below does the receiver’s arithmetic for you: the light-time of the true
  range, the range the clock makes it believe, and the gap between the two in metres.
  Move the slider and that gap is real — the amber stub along your sightline grows by
  exactly $c × ε$, and flips to the near side of you when the clock runs
  fast.`,

  `— the blue line is the truth. The amber stub is the distance a cheap clock invents.`
];

export const controls = [
  {
    id: 'clockError', label: 'Receiver clock error', type: 'range',
    min: -2000, max: 2000, step: 1, value: 0, unit: 'µs',
    hint: 'how far the quartz clock has wandered — a real receiver sees a millisecond and more',
    format: (v) => (v > 0 ? '+' : '') + v + ' µs'
  },
  {
    id: 'satellite', label: 'Which satellite', type: 'select', value: String(PICKS[0].i),
    options: PICKS.map((p, k) => ({
      value: String(p.i),
      label: 'Satellite ' + 'ABC'[k] + ' — ' + Math.round(p.el) + '° up, ' + compass(p.az)
    }))
  },
  { id: 'showSphere', label: 'Show the range as a sphere', type: 'toggle', value: false }
];

export const checks = [
  {
    id: 'ch02-a',
    q: 'A signal’s travel time comes out one microsecond longer than it should. How far out of place does that put the satellite?',
    options: [
      'About 3 metres',
      'About 30 metres',
      'About 300 metres',
      'About 3 kilometres'
    ],
    answer: 2,
    why: 'One microsecond at $299.8$ metres per microsecond is $299.8$ metres — a third of a kilometre. That is the whole reason a receiver cannot get away with a cheap clock: a wander of a single microsecond moves every range by that much.'
  },
  {
    id: 'ch02-b',
    q: 'Your receiver’s clock is running five microseconds fast. What does it do to the measured distance to a satellite?',
    options: [
      'Nothing — the satellite carries the correct time',
      'Makes every measured range longer by about 1.5 km',
      'Makes the range longer only to satellites that are ahead of you',
      'Makes the ranges too short by about 5 metres'
    ],
    answer: 1,
    why: 'One shared clock error shifts **every** pseudorange by the same $c × ε$ — here $5 × 0.2998$ km, about 1.5 km. It cannot be blamed on any one satellite and cannot be fixed by picking a better one; it can only be solved for, which is exactly the job of the fourth satellite.'
  }
];

export const view = { target: [0, 0, 0], dist: 74, yaw: 0.9, pitch: 0.34 };

/**
 * createScene(ctx) — called when the chapter becomes the one on screen.
 * The geometry the reader moves: a true range line, the amber stub the clock
 * invents, and (on request) the two range spheres it separates.
 */
export function createScene(ctx) {
  const { constellation, spheres, geo, tri, vocab, params, station, lines, points, readout: makeReadout } = ctx;

  const here = geo.geodeticToEcef(48.8566, 2.3522, 0.035);
  station(here, [0.45, 0.95, 0.75, 1]);

  // A still sky: trails and markers, frozen at the epoch the controls were built from.
  const sky = constellation({ timeScale: 0, trails: true, size: 9 });
  sky.setEpoch(EPOCH);
  sky.update(0);
  const fixed = sky.positionsKm();

  // The range the receiver truly has (blue) ...
  const trueLine = lines([], [0.45, 0.75, 0.95, 0.9], { layer: 'overlay' });
  // ... the stub the clock invents, laid off at the receiver's end (amber) ...
  const errLine = lines([], [0.98, 0.72, 0.3, 0.95], { layer: 'overlay' });
  // ... and two movable points: the satellite it is reading, the place it believes.
  const satPoint = points([], [1.0, 0.84, 0.42, 1], { size: 13, layer: 'overlay' });
  const beliefPoint = points([], [0.98, 0.72, 0.3, 1], { size: 10, layer: 'overlay' });

  const shells = spheres({ max: 2 });

  // The readout lives in its own holder in the chapter column.
  const readout = makeReadout([
    { key: 'time', label: 'light-time' },
    { key: 'range', label: 'true range' },
    { key: 'bias', label: 'clock error' },
    { key: 'cost', label: 'range error' },
    { key: 'believed', label: 'believed range' }
  ]);
  mountReadout(id, readout);

  const KM2U = vocab.KM;
  const w = (p) => [p[0] * KM2U, p[1] * KM2U, p[2] * KM2U];
  const flat = (a, b) => [...w(a), ...w(b)];
  const num = (v) => Math.round(v).toLocaleString('en-US');

  return {
    update(t) {
      sky.update(t);

      const i = Number(params.satellite);
      const S = fixed[Number.isInteger(i) && fixed[i] ? i : PICKS[0].i];

      const rangeKm = tri.rangeKm(here, S);
      const eUs = Number(params.clockError) || 0;
      const biasKm = tri.usToKm(eUs);
      const believed = rangeKm + biasKm;

      // Unit vector from the satellite towards the receiver; the receiver lays its
      // believed range off along it, so the stub it is wrong by sits at its own feet.
      const inv = 1 / (rangeKm || 1);
      const u = [(here[0] - S[0]) * inv, (here[1] - S[1]) * inv, (here[2] - S[2]) * inv];
      const P = [S[0] + believed * u[0], S[1] + believed * u[1], S[2] + believed * u[2]];

      trueLine.setPositions(flat(here, S));
      errLine.setPositions(flat(here, P));
      satPoint.setPositions(w(S));
      beliefPoint.setPositions(w(P));
      beliefPoint.visible = Math.abs(eUs) > 0.5;

      if (params.showSphere) {
        shells.setSpheres([
          { center: S, radiusKm: rangeKm, color: [0.45, 0.75, 0.95, 0.3] },
          { center: S, radiusKm: believed, color: [0.98, 0.72, 0.3, 0.45] }
        ]);
      } else {
        shells.clear();
      }

      readout.set('time', num(rangeKm / vocab.C_KM_S * 1e6) + ' µs');
      readout.set('range', num(rangeKm) + ' km');
      readout.set('bias', (eUs > 0 ? '+' : '') + eUs + ' µs');
      readout.set('cost', (biasKm >= 0 ? '+' : '') + num(biasKm * 1000) + ' m');
      readout.set('believed', num(believed) + ' km');
    },
    dispose() { /* ctx.own() handles removal */ }
  };
}

/** Insert the readout panel into the chapter column, just above the controls. */
function mountReadout(chapterId, readout) {
  const section = document.getElementById(chapterId);
  if (!section) return;
  section.querySelectorAll('.readout-holder').forEach((n) => n.remove());
  const holder = el('div.readout-holder', {}, [
    el('p.readout-title', { text: 'What the receiver believes' }),
    readout.node
  ]);
  const controls = section.querySelector('.controls-holder');
  if (controls) section.insertBefore(holder, controls);
  else section.appendChild(holder);
}
