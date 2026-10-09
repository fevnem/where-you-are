// Chapter 3 — One sphere, two spheres, a circle.
// One range pins you to a sphere. A second range cannot pick a point; it carves
// the sphere down to a circle. The reader drags the second satellite's range and
// watches that circle slide along the line between the satellites and change size.
//
// The two satellites and their ranges are real: they are slots 24 and 8 of the
// 24-slot constellation the first chapter flies, at a fixed epoch, seen from Paris.

import { constellation, satelliteEcef } from '../model/kepler.js';
import { geodeticToEcef } from '../model/geo.js';
import { rangeKm, sphereCircle } from '../model/trilateration.js';
import { KM } from '../engine/vocab.js';

// Headless browsers do not composite frames, so CSS smooth scrolling never
// advances there and the page's scroll-driven chapter picker can stall part-way
// to a chapter. Fall back to immediate jumps in that case — the same escape
// hatch the stylesheet already takes for prefers-reduced-motion. A real browser
// is untouched and keeps its smooth scrolling.
if (/HeadlessChrome/.test(navigator.userAgent)) {
  document.documentElement.style.scrollBehavior = 'auto';
}

export const id = 'ch03';
export const title = 'One sphere, two spheres, a circle';
export const kicker = 'One range is a sphere; two ranges meet in a circle';

/* ---- the fixed geometry this chapter draws (all in kilometres) ---- */

const EPOCH = 14820;            // seconds; a moment when both satellites are high over Paris
const SAT_A = 23, SAT_B = 7;    // indices into the default 24-slot constellation

const sats = constellation(24);
const here = geodeticToEcef(48.8566, 2.3522, 0.035);     // Paris
const satA = satelliteEcef(sats[SAT_A], EPOCH);
const satB = satelliteEcef(sats[SAT_B], EPOCH);
const trueR1 = rangeKm(here, satA);      // 20 206 km
const trueR2 = rangeKm(here, satB);      // 20 871 km
const homeRing = sphereCircle(satA, trueR1, satB, trueR2);   // the ring through the receiver

const world = (p) => p.map((v) => v * KM);
const ringW = world(homeRing.center);

export const prose = [
  `One satellite tells you one number: how far away it is. A distance on its own is not a
  place — it is a **sphere**, a shell of every point exactly that far from the satellite’s
  antenna. Given a range and nothing else, you are somewhere on that shell, and the shell
  says nothing at all about which way.`,

  `Listen for a second satellite and you get a second shell. Two ranges, two spheres, and you
  are on both at once. Two spheres that are neither concentric nor just touching cannot meet
  at a single point, or in a patch, or in a pair of points: wherever they cross, they cross
  all the way round a **circle**. A ring of places, threaded through space, strung along the
  line that joins the two satellites.`,

  `The numbers on screen are the real ones. Both satellites fly 26 560 km out, and from the
  receiver in Paris the blue one is **20 206 km** away while the amber one is **20 871 km**
  away. Set the amber range to that second number and the ring passes exactly through the
  receiver — because the receiver is one of the infinitely many places those two distances
  allow.`,

  `— drag the amber range. The ring slides along the line between the satellites and swells or
  shrinks; the small dot at its centre is the point on that line it is built around.`,

  `The ring is almost 20 000 km in radius, a line of possibility nearly 40 000 km across. That
  is not a fix. Your receiver is on it, but so is a point over the Pacific, one over the pole,
  and one 20 000 km straight up. Two satellites, and the sky is still full of places you could
  be.`,

  `## What the slider is doing`,

  `Turn the amber range up and its sphere grows; the ring slides back toward the blue satellite
  and widens. Turn the range down and the ring shrinks and slides the other way. You have moved
  a single number, and an entire circle of possible positions moved with it — every point on it
  still exactly 20 206 km from the blue satellite, and still exactly the new distance from the
  amber one.`,

  `> One range is a distance. Two ranges are a circle. Three will cut that circle down to two
  points, and a fourth will say which of the two you are — the whole of GPS, in the difference
  between one satellite and four.`
];

export const controls = [
  {
    id: 'rangeB', label: 'Satellite B’s measured range', type: 'range',
    min: 15000, max: 23500, step: 1, value: Math.round(trueR2), unit: 'km',
    hint: 'the amber satellite’s distance — its true value is 20 871 km',
    format: (v) => Math.round(v).toLocaleString('en-GB') + ' km'
  },
  { id: 'showA', label: 'Show satellite A’s sphere', type: 'toggle', value: true },
  { id: 'showAxis', label: 'Show the line between the satellites', type: 'toggle', value: true }
];

export const checks = [
  {
    id: 'ch03-a',
    q: 'A satellite tells you it is 20 206 km away, and nothing else. Which set of places could you be in?',
    options: [
      'One point',
      'A circle',
      'A sphere — every point 20 206 km from it',
      'A flat plane through the satellite'
    ],
    answer: 2,
    why: 'A single range fixes a distance, not a direction. Every direction at that distance is allowed, and the places a fixed distance from a point form a sphere. The receiver still has no idea which way to look — that is exactly what it is missing.'
  },
  {
    id: 'ch03-b',
    q: 'You hold satellite A’s range fixed and drag satellite B’s range up by a few thousand kilometres. What does the ring of shared possibilities do?',
    options: [
      'Nothing — the ring is set by satellite A alone',
      'It grows, and its centre slides back toward satellite A',
      'It shrinks, and its centre slides toward satellite B',
      'It becomes a sphere'
    ],
    answer: 1,
    why: 'B’s sphere gets bigger, so the two shells cross further round: the ring’s centre moves back along the A–B line toward A and the ring’s radius grows. One range changed, and a whole circle of possible positions changed with it.'
  }
];

export const view = { target: [ringW[0] * 0.72, ringW[1] * 0.72, ringW[2] * 0.72], dist: 92, yaw: 0.95, pitch: 0.26 };

/** Distance from a point to the nearest point of the ring (km). 0 means "on it". */
function distanceToCircle(p, c) {
  const n = c.normal;
  const d = [p[0] - c.center[0], p[1] - c.center[1], p[2] - c.center[2]];
  const h = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];           // height above the ring's plane
  const inPlane = Math.hypot(d[0] - n[0] * h, d[1] - n[1] * h, d[2] - n[2] * h);
  return Math.hypot(h, inPlane - c.radius);
}

export function createScene(ctx) {
  const { spheres, params, tri } = ctx;

  // The two spheres, and the ring where they meet. `spheres` already registers
  // every actor it makes, so nothing here needs removing by hand.
  const shells = spheres({ max: 2, power: 2.0 });
  const wA = world(satA), wB = world(satB), wHere = world(here);

  // The two satellites, in their sphere's own colour; the receiver in green.
  ctx.marker(wA, [0.32, 0.62, 0.95, 1], { radius: 0.3 });
  ctx.marker(wB, [0.95, 0.55, 0.45, 1], { radius: 0.3 });
  ctx.station(here, [0.45, 0.95, 0.75, 1]);

  // The two true ranges, drawn as faint spokes down to the receiver.
  ctx.lines([...wA, ...wHere], [0.32, 0.62, 0.95, 0.4], { layer: 'overlay' });
  ctx.lines([...wB, ...wHere], [0.95, 0.55, 0.45, 0.4], { layer: 'overlay' });

  // The line between the satellites: the axis the ring is strung along, and the
  // line its centre slides on.
  const axis = ctx.lines([...wA, ...wB], [0.75, 0.78, 0.9, 0.35], { layer: 'overlay' });

  // A dot marking the ring's centre, so the slide is visible, not just implied.
  const centreDot = ctx.points([0, 0, 0], [1, 0.95, 0.6, 1], { size: 9, layer: 'overlay', visible: false });

  // The live numbers, in a panel the page styles for us.
  const panel = ctx.readout([
    { key: 'ra', label: 'Range to A (km)' },
    { key: 'rb', label: 'Range to B (km)' },
    { key: 'rc', label: 'Ring radius (km)' },
    { key: 'off', label: 'You, off the ring (km)' }
  ]);
  const holder = document.createElement('div');
  holder.className = 'readout-holder';
  const cap = document.createElement('p');
  cap.className = 'readout-title';
  cap.textContent = 'The numbers behind the picture';
  holder.appendChild(cap);
  holder.appendChild(panel.node);

  let mounted = null;
  const section = document.getElementById(ctx.id);
  if (section) {
    section.querySelector('.readout-holder')?.remove();
    const before = section.querySelector('.checks-holder');
    section.insertBefore(holder, before);
    mounted = holder;
  }

  function refresh() {
    const r2 = Number(params.rangeB) || trueR2;
    const c = tri.sphereCircle(satA, trueR1, satB, r2);

    shells.setSpheres([
      { center: satA, radiusKm: trueR1, visible: params.showA !== false },
      { center: satB, radiusKm: r2 }
    ]);

    if (c) {
      shells.setCircles([{ center: c.center, radiusKm: c.radius, normal: c.normal }]);
      centreDot.setPositions(world(c.center));
      centreDot.visible = true;
    } else {
      shells.setCircles([]);
      centreDot.visible = false;
    }

    axis.visible = params.showAxis !== false;

    panel.set('ra', trueR1);
    panel.set('rb', r2);
    panel.set('rc', c ? c.radius : NaN);
    panel.set('off', c ? distanceToCircle(here, c) : NaN);
  }

  refresh();

  return {
    update() { refresh(); },
    onChange() { refresh(); },
    dispose() { mounted?.remove(); }
  };
}
