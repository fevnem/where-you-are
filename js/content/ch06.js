// Chapter 6 — The shape of the sky.
// 24 satellites, six planes, an elevation mask, and a GDOP the reader can wreck
// on purpose. Everything the picture shows is computed from the same verified
// maths the rest of the page uses: the real constellation, the real elevations,
// and dop() straight out of js/model/trilateration.js.

import { sphere } from '../engine/mesh.js';
import { withNormals } from '../gl/globe.js';

export const id = 'ch06';
export const title = 'The shape of the sky';
export const kicker = 'The same satellites fix you well in one sky and badly in another';

export const prose = [
  `Twenty-four satellites, six orbital planes 60° apart, each plane tilted 55° from the
  equator and carrying four satellites a quarter-turn apart. From any one place on the
  planet, six to twelve of them are above the horizon at once. How many you can see,
  though, is not what decides how well you are fixed.`,

  `A receiver cannot hear one satellite more loudly than another: every signal arrives the
  same way. So the quality of a fix is a property of the *pattern* of satellites in your
  sky, not of their strength. **Accuracy is decided by geometry.**`,

  `## The elevation mask`,
  `A receiver quietly throws away the satellites low on the horizon. Below about ten degrees
  a satellite sits so close to the ground line that its direction adds almost nothing the
  horizon has not already said, and its signal has crossed the most air to reach you. The
  amber ring is that **elevation mask** — satellites inside it count, everything below it
  is ignored.`,

  `— amber: the mask. blue loops: the six planes. gold: counted. slate: discarded.`,

  `With the mask at 10° and the real constellation, seven satellites qualify, and their
  directions give the fix a GDOP of about $2.1$. Raise the mask to 30° and four survive,
  with GDOP near $10$ — the same satellites, the same signals, a coarser answer.`,

  `## What geometry costs`,
  `**GDOP** — geometric dilution of precision — is the exchange rate between a ranging error
  and a position error. If every range is wrong by three metres, the fix is wrong by roughly
  three times the GDOP, in metres. A GDOP of $2$ turns three metres of ranging into about
  six metres on the ground; a GDOP of $0.66$ barely touches it.`,

  `— the full constellation scores $0.66$, wherever you stand on Earth. Spread evenly around
  you, twenty-four satellites are about as informative as a sky can be.`,

  `## Wreck it on purpose`,
  `The sky-shape slider does something no real constellation would: it drags every satellite
  out of its orbit towards a single point overhead. Watch the count in view climb — ten
  satellites, seventeen, all twenty-four above the mask. For a while that helps, as more good
  directions join in; then the pile-up takes over and the fix gets *worse*, not better.
  Crowded into one direction, every satellite sets out to measure nearly the same thing, and
  a three-metre range error becomes hundreds of metres of position error.`,

  `> The signals never weakened. The shape of the sky did.`,

  `Slide it back to zero and the fleet returns to its six planes, the count falls, and the
  precision comes back. Nothing about the satellites changed — only whether their directions
  were worth spreading apart.`
];

export const controls = [
  {
    id: 'cutoff', label: 'Elevation mask', type: 'range', min: 0, max: 60, step: 1, value: 10,
    unit: '°', hint: 'ignore any satellite lower than this in the sky',
    format: (v) => v + '°'
  },
  {
    id: 'sky', label: 'Sky shape', type: 'range', min: 0, max: 100, step: 1, value: 0,
    unit: '%', hint: '0% is the real constellation; 100% piles every satellite overhead',
    format: (v) => v === 0 ? 'true orbits' : v + '% piled overhead'
  },
  {
    id: 'ghosts', label: 'Show satellites below the mask', type: 'toggle', value: true
  }
];

export const checks = [
  {
    id: 'ch06-a',
    q: 'With the sky-shape slider at 100% you can see all twenty-four satellites, every one of them high overhead — and the fix gets far worse. Why?',
    options: [
      'A crowded signal overloads the receiver',
      'Bunched into one direction, the satellites all measure the same thing, so a small range error explodes into a large position error',
      'Satellites overhead are farther away, so their signals arrive later',
      'The receiver’s clock drifts more when more satellites are visible'
    ],
    answer: 1,
    why: 'A modern receiver tracks every satellite at once, so the count is not the problem. GDOP measures how the *directions* to the satellites are spread out. When they crowd one patch of sky, all their measurements constrain nearly the same unknown and the algebra that separates position from error becomes ill-conditioned — the score climbs from 0.66 to past 200.'
  },
  {
    id: 'ch06-b',
    q: 'Why not raise the elevation mask to 45° and keep only the highest, cleanest satellites?',
    options: [
      'Signals from high satellites are weaker',
      'It leaves too few satellites, and the survivors form a narrow cone that pins horizontal position but is nearly blind vertically',
      'High satellites move too fast to track',
      'The mask does not change how many satellites are received'
    ],
    answer: 1,
    why: 'Spread is what buys precision. At a 45° mask only two or three satellites clear the ring, so there is no fix at all; even at 30° the vertical dilution runs near 8, meaning your height is the least trustworthy coordinate you have. The 10° mask is the compromise between geometry and the low sky a receiver would rather not hear.'
  }
];

export const view = { target: [0, 0, 0], dist: 84, yaw: 0.9, pitch: 0.36 };

/**
 * createScene(ctx) — one instant of the real constellation, reshaped by the reader.
 * The fleet is frozen in time so the only thing that moves the numbers is the geometry
 * the reader chooses; the orbit loops are drawn so the six planes stay legible.
 */
export function createScene(ctx) {
  const { geo, kepler, tri, params } = ctx;
  const DEG = Math.PI / 180;
  const KM2U = 1 / 1000;
  const u = (p) => [p[0] * KM2U, p[1] * KM2U, p[2] * KM2U];

  // Paris, as ch01: a place to stand.
  const obs = geo.geodeticToEcef(48.8566, 2.3522, 0.035);
  const basis = geo.enuBasis(obs);
  const obsW = u(obs);

  // The real constellation at one instant (chosen so the default sky reads well).
  const sats = kepler.constellation(24);
  const T0 = 10800;
  const truePos = sats.map((s) => kepler.satelliteEcef(s, T0));

  // Where each satellite goes when the reader piles the sky overhead:
  // straight up from the receiver, nudged apart on a golden-angle spiral so the
  // cluster stays finite instead of collapsing to a point.
  const bunch = truePos.map((p, i) => {
    const a = i * 2.399963;
    const off = 1200 + (i % 5) * 220;
    const px = basis.east[0] * Math.cos(a) + basis.north[0] * Math.sin(a);
    const py = basis.east[1] * Math.cos(a) + basis.north[1] * Math.sin(a);
    const pz = basis.east[2] * Math.cos(a) + basis.north[2] * Math.sin(a);
    const R = 20190;
    return [
      obs[0] + R * basis.up[0] + off * px,
      obs[1] + R * basis.up[1] + off * py,
      obs[2] + R * basis.up[2] + off * pz
    ];
  });

  /* ---------------- geometry ---------------- */

  // Orbit loops: one period of each satellite's ground path, as line segments.
  const seg = [];
  for (const s of sats) {
    const ring = kepler.orbitRing(s, 96);
    for (let i = 0; i < ring.length - 1; i++) {
      seg.push(ring[i][0] * KM2U, ring[i][1] * KM2U, ring[i][2] * KM2U);
      seg.push(ring[i + 1][0] * KM2U, ring[i + 1][1] * KM2U, ring[i + 1][2] * KM2U);
    }
  }
  const trails = ctx.lines(seg, [0.32, 0.44, 0.66, 0.26], { layer: 'transparent' });

  // The fleet, split into the ones the mask admits and the ones it discards.
  const gold = [1.0, 0.86, 0.5, 1];
  const slate = [0.44, 0.52, 0.66, 1];
  const viewPts = ctx.points(new Float32Array(0), gold, { size: 9, layer: 'overlay' });
  const dimPts = ctx.points(new Float32Array(0), slate, { size: 6, layer: 'overlay' });
  const viewSolids = ctx.mesh(withNormals(sphere(0.22, 16, 10)), gold, {
    lit: true,
    instances: Array.from({ length: 24 }, () => [0, 0, 0]),
    scales: new Array(24).fill(1)
  });
  const dimSolids = ctx.mesh(withNormals(sphere(0.15, 14, 8)), slate, {
    lit: true,
    instances: Array.from({ length: 24 }, () => [0, 0, 0]),
    scales: new Array(24).fill(1)
  });

  // Range lines from the receiver to every satellite the mask keeps.
  const ranges = ctx.lines(new Float32Array(0), [0.45, 0.75, 0.95, 0.5], { layer: 'transparent' });

  // Horizon and mask rings, drawn at orbit radius so a satellite at exactly the
  // mask elevation lies on the amber ring.
  const R = 26.56;
  const ringPts = (elevDeg) => {
    const e = elevDeg * DEG, ce = Math.cos(e), se = Math.sin(e);
    const out = [];
    for (let k = 0; k <= 96; k++) {
      const a = (k / 96) * Math.PI * 2;
      const hx = basis.east[0] * Math.cos(a) + basis.north[0] * Math.sin(a);
      const hy = basis.east[1] * Math.cos(a) + basis.north[1] * Math.sin(a);
      const hz = basis.east[2] * Math.cos(a) + basis.north[2] * Math.sin(a);
      out.push(
        obsW[0] + R * (ce * hx + se * basis.up[0]),
        obsW[1] + R * (ce * hy + se * basis.up[1]),
        obsW[2] + R * (ce * hz + se * basis.up[2])
      );
    }
    return out;
  };
  const horizon = ctx.lines(ringPts(0), [0.5, 0.58, 0.7, 0.5], { mode: 'loop', layer: 'overlay' });
  const maskRing = ctx.lines(ringPts(10), [0.95, 0.75, 0.4, 0.9], { mode: 'loop', layer: 'overlay' });
  const zenith = ctx.lines(
    [obsW[0], obsW[1], obsW[2], obsW[0] + R * basis.up[0], obsW[1] + R * basis.up[1], obsW[2] + R * basis.up[2]],
    [0.5, 0.58, 0.7, 0.25], { layer: 'overlay' }
  );

  const me = ctx.station(obs, [0.45, 0.95, 0.75, 1]);

  /* ---------------- live numbers ---------------- */

  const readout = ctx.readout([
    { key: 'view', label: 'Satellites in view' },
    { key: 'planes', label: 'Orbital planes' },
    { key: 'gdop', label: 'GDOP' },
    { key: 'err', label: 'Fix, 3 m ranges' }
  ]);
  const section = document.getElementById(id);
  if (section && !section.querySelector('.readout-holder')) {
    const holder = document.createElement('div');
    holder.className = 'readout-holder';
    const title = document.createElement('p');
    title.className = 'readout-title';
    title.textContent = 'Live geometry';
    holder.append(title, readout.node);
    const proseEl = section.querySelector('.prose');
    if (proseEl && proseEl.parentNode) proseEl.after(holder);
    else section.appendChild(holder);
  }

  /* ---------------- the one update path ---------------- */

  function apply() {
    const f = Math.max(0, Math.min(1, (params.sky ?? 0) / 100));
    const cutoff = params.cutoff ?? 10;
    const ghosts = params.ghosts !== false;

    const pos = f === 0 ? truePos : truePos.map((p, i) => [
      p[0] + (bunch[i][0] - p[0]) * f,
      p[1] + (bunch[i][1] - p[1]) * f,
      p[2] + (bunch[i][2] - p[2]) * f
    ]);

    const goldFlat = [], slateFlat = [], goldInst = [], slateInst = [], rangeFlat = [];
    const used = [];
    for (let i = 0; i < pos.length; i++) {
      const w = u(pos[i]);
      const el = geo.elevationAzimuth(obs, pos[i]).el;
      if (el >= cutoff) {
        used.push(pos[i]);
        goldFlat.push(w[0], w[1], w[2]);
        goldInst.push(w);
        rangeFlat.push(obsW[0], obsW[1], obsW[2], w[0], w[1], w[2]);
      } else {
        slateFlat.push(w[0], w[1], w[2]);
        slateInst.push(w);
      }
    }

    viewPts.setPositions(goldFlat);
    viewSolids.setInstances(goldInst);
    dimPts.setPositions(slateFlat);
    dimSolids.setInstances(slateInst);
    dimPts.visible = ghosts;
    dimSolids.visible = ghosts;
    ranges.setPositions(rangeFlat);
    maskRing.setPositions(ringPts(cutoff));

    const gd = used.length >= 4 ? tri.dop(used, obs) : null;
    readout.setAll({
      view: String(used.length),
      planes: '6',
      gdop: gd ? gd.gdop.toFixed(2) : '—',
      err: gd ? '± ' + (gd.gdop * 3).toFixed(0) + ' m' : '—'
    });
  }

  apply();

  return {
    update() { /* frozen instant: the geometry only moves with the controls */ },
    onChange() { apply(); },
    dispose() { /* ctx.own() handles removal */ }
  };
}
