// Chapter 4 — Two points, and the wrong one.
//
// Two spheres give a circle; a third sphere cuts that circle in exactly two
// points, mirror images of each other across the plane of the three satellite
// centres. This chapter draws both, lets the reader watch the pair slide as the
// sky turns, and shows the two honest ways the wrong one is thrown away: a
// fourth range that misses it, or the fact that it is 35 000 km above the
// ground. The geometry is computed live from the constellation — nothing here
// is drawn from hard-coded coordinates.

export const id = 'ch04';
export const title = 'Two points, and the wrong one';
export const kicker = 'Three exact ranges agree on two places, not one';

export const prose = [
  `Two spheres give you a circle: every place that is the right distance from both. A third
  satellite hands over a third distance, and the answer now has to lie on that circle *and*
  on the third sphere. A circle and a sphere cross in two places.`,

  `**Exactly two.** Three exact ranges do not name one position; they name two. The pair sits
  on opposite sides of the flat plane that passes through the three satellite centres, each
  the other’s mirror image — the same distance to all three satellites, and nothing in the
  ranges to say which one you are at.`,

  `One of the two is where you really are. It has to be: the ranges are distances measured
  from that very place, so your position lies on all three spheres by construction. The
  second point arrives free, an unavoidable echo.`,

  `## The point that cannot be you`,

  `Look at the number beside the second point — nearly $35\,000$ km above your head with the
  slider where it starts. That is outside the constellation, let alone the atmosphere. A
  receiver sits within a few kilometres of the ground. That one fact, that you already know
  roughly which side of the Earth you are on, is enough to discard the echo — no extra
  measurement needed.`,

  `## Or let one more range decide`,

  `Ranges are the only thing the receiver truly has. Add a fourth satellite and its sphere
  arrives with its own radius: it passes through the true point and misses the mirror by
  thousands of kilometres. That gap is the decision, and the panel keeps the number in view.
  It works only because the fourth satellite is not in the same plane as the other three — a
  satellite lying in that plane is equidistant from both points and would tell you nothing.`,

  `> Three ranges cannot choose. Two places fit every one of them. The fourth is not measuring
  you again; it is choosing which of the two you are.`,

  `— drag the time slider and watch the pair slide together across the sky, always opposite
  each other, never on the same side.`
];

export const controls = [
  {
    id: 'epoch', label: 'Time', type: 'range', min: 0, max: 7200, step: 60, value: 3600,
    hint: 'turn the sky forward; the three satellites stay in view throughout',
    format: (v) => clockLabel(v)
  },
  {
    id: 'method', label: 'Throw away the second point', type: 'select', value: 'both',
    options: [
      { value: 'both', label: 'Don’t — keep both' },
      { value: 'fourth', label: 'With a fourth satellite' },
      { value: 'earth', label: 'With the Earth’s surface' }
    ],
    hint: 'one range too few, and the choice is left to you'
  },
  {
    id: 'ties', label: 'Show the six equal ranges', type: 'toggle', value: true
  },
  {
    id: 'sky', label: 'Show the rest of the sky', type: 'toggle', value: true
  }
];

export const checks = [
  {
    id: 'ch04-a',
    q: 'Three satellites report exact ranges and your clock is perfect. Two of them gave you a circle; the third cuts that circle. How many positions fit all three ranges?',
    options: [
      'Exactly one',
      'Exactly two',
      'A whole circle',
      'None — three is not enough to say anything'
    ],
    answer: 1,
    why: 'A circle and a sphere meet in two points (or none). Three ranges leave two places, and they are mirror images of each other across the plane through the three satellite centres — not one point.'
  },
  {
    id: 'ch04-b',
    q: 'The panel says the second point sits about $35\,000$ km above the surface, and it fits all three ranges exactly. Why can it not be you?',
    options: [
      'Your clock would have to be wrong for it to fit',
      'A fourth range passes through one point and misses this one by thousands of kilometres',
      'It is outside the satellites, so no signal reaches there',
      'Nothing rules it out; the receiver simply guesses between the two'
    ],
    answer: 1,
    why: 'A second range the mirror cannot satisfy kills it: the fourth sphere fits your point and misses the other by roughly $5\,700$ km at the default sky. The Earth does the same job for free, since no receiver is $35\,000$ km up.'
  },
  {
    id: 'ch04-c',
    q: 'Drag the time slider across its whole range. The second point slides and every number changes — but how often do the three ranges fit exactly two points?',
    options: [
      'Only at the time it starts from',
      'Never — sometimes one point, sometimes none',
      'At every setting: the ranges were measured from you, so your point always fits, and the mirror comes with it',
      'Only while the three satellites are close together in the sky'
    ],
    answer: 2,
    why: 'The three ranges are measured from the place you are listening at, so that place lies on all three spheres whatever the time. Drop the third sphere onto the shared circle and the second crossing is its reflection — two solutions at every epoch, not just this one.'
  }
];

export const view = { target: [0, 0, 0], dist: 148, yaw: 0.85, pitch: 0.3 };

/** Seconds since the slider start -> a quiet label. */
function clockLabel(v) {
  const h = Math.floor(v / 3600);
  const m = Math.round((v - h * 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

/**
 * createScene(ctx) — called when the chapter becomes the one on screen.
 * Everything it makes is registered on ctx and removed on dispose.
 */
export function createScene(ctx) {
  const { constellation, spheres, geo, tri, params, station, points, lines, readout, id } = ctx;
  const u = ctx.world;

  // A receiver, the same place ch01 stands.
  const obs = geo.geodeticToEcef(48.8566, 2.3522, 0.035);

  // The sky, frozen at one instant; the slider moves the instant, not the clock.
  const sky = constellation({ timeScale: 0, trails: true, size: 6 });
  sky.setEpoch(3600);
  sky.update(0);

  // The three best satellites at the default instant. They stay above 27° across
  // the whole range of the time slider, and the fourth best is the tie-breaker.
  const vis0 = sky.visibleFrom(obs, 10);
  const pick = [vis0[0].i, vis0[1].i, vis0[2].i];
  const fourthIdx = vis0.length > 3 ? vis0[3].i : null;

  // Range spheres, the circle where the first two meet, and a fourth shell for
  // the extra satellite when it is called for.
  const shells = spheres({ max: 4, maxRings: 1, power: 2.0 });

  // The two candidate points, drawn by hand so they can be coloured apart.
  const keptPt = points([0, 0, 0], [0.42, 1, 0.72, 1], { size: 16, layer: 'overlay' });
  const echoPt = points([0, 0, 0], [1, 0.64, 0.36, 1], { size: 16, layer: 'overlay' });
  // The three chosen satellites, marked brighter than the rest of the sky.
  const chosenGot = points([0, 0, 0, 0, 0, 0, 0, 0, 0], [1, 0.86, 0.5, 1], { size: 13, layer: 'overlay' });
  const fourthGot = points([0, 0, 0], [0.6, 0.8, 1, 1], { size: 13, layer: 'overlay' });

  const emptyLine = () => lines(new Array(6).fill(0), [1, 1, 1, 1], { layer: 'overlay', visible: false });
  const axis = lines(new Array(6).fill(0), [1, 0.78, 0.42, 0.55], { layer: 'overlay' });
  const tieTrue = lines(new Array(18).fill(0), [0.42, 0.72, 0.95, 0.45], { layer: 'overlay' });
  const tieEcho = lines(new Array(18).fill(0), [0.95, 0.55, 0.42, 0.45], { layer: 'overlay' });
  const tieFourth = emptyLine();

  const me = station(obs, [0.45, 0.95, 0.75, 1]);

  // ---- the live numbers, hung under the controls ----
  const panel = readout([
    { key: 'count', label: 'Points that fit' },
    { key: 'echo', label: 'Second point above the surface' },
    { key: 'gap', label: 'Your distance from it' },
    { key: 'fourth', label: 'Fourth satellite mismatch' }
  ]);
  const host = document.getElementById(id)?.querySelector('.controls-holder');
  let titleNode = null;
  if (host) {
    titleNode = document.createElement('p');
    titleNode.className = 'readout-title';
    titleNode.textContent = 'What the three ranges say';
    host.appendChild(titleNode);
    host.appendChild(panel.node);
  }

  const km = (v, unit = ' km') => (isFinite(v) ? Math.round(v).toLocaleString('en-GB') + unit : '—');

  function update() {
    const epoch = Number.isFinite(Number(params.epoch)) ? Number(params.epoch) : 3600;
    sky.setEpoch(epoch);
    sky.update(0);

    const pos = sky.positionsKm();
    const three = pick.map((i) => pos[i]);
    const r = three.map((p) => tri.rangeKm(obs, p));

    // Two spheres -> the circle where they meet. The third sphere cuts it.
    const circle = tri.sphereCircle(three[0], r[0], three[1], r[1]);
    let truth = obs;
    let mirror = null;
    if (circle) {
      const pts = tri.circleSpherePoints(circle, three[2], r[2], obs);
      if (pts.length >= 2) {
        truth = pts[0];
        mirror = pts[1];
      } else if (pts.length === 1) {
        truth = pts[0];
      }
    }

    const method = params.method ?? 'both';
    const decided = method !== 'both' && !!mirror;
    const gap = mirror ? tri.rangeKm(truth, mirror) : NaN;
    const mirrorHeight = mirror ? geo.ecefToGeodetic(mirror[0], mirror[1], mirror[2]).h : NaN;

    // The fourth satellite: highest one in view that is not one of the three.
    const fourth = fourthIdx != null ? pos[fourthIdx] : null;
    const fourthRange = fourth ? tri.rangeKm(obs, fourth) : NaN;
    const mismatch = (fourth && mirror) ? Math.abs(tri.rangeKm(mirror, fourth) - fourthRange) : NaN;

    // --- the shells ---
    const list = [
      { center: three[0], radiusKm: r[0] },
      { center: three[1], radiusKm: r[1] },
      { center: three[2], radiusKm: r[2] }
    ];
    if (method === 'fourth' && fourth) list.push({ center: fourth, radiusKm: fourthRange });
    shells.setSpheres(list);
    shells.setCircles(circle ? [{ center: circle.center, radiusKm: circle.radius, normal: circle.normal }] : []);

    // --- the points ---
    keptPt.setPositions(u(truth)).setColor([0.42, 1, 0.72, 1]);
    if (mirror) {
      echoPt.visible = true;
      echoPt.setPositions(u(mirror));
      echoPt.setColor(decided ? [0.62, 0.42, 0.4, 0.45] : [1, 0.64, 0.36, 1]);
      echoPt.setSize(decided ? 10 : 16);
      axis.visible = true;
      axis.setPositions([...u(truth), ...u(mirror)]);
    } else {
      echoPt.visible = false;
      axis.visible = false;
    }

    // --- the three chosen satellites, and their equal ranges to both points ---
    chosenGot.setPositions(three.flatMap((p) => u(p)));
    if (method === 'fourth' && fourth) {
      fourthGot.visible = true;
      fourthGot.setPositions(u(fourth));
    } else {
      fourthGot.visible = false;
    }

    const showTies = !!params.ties && !!mirror;
    tieTrue.visible = showTies;
    tieEcho.visible = showTies;
    if (showTies) {
      const toTrue = [];
      const toEcho = [];
      for (const p of three) {
        toTrue.push(...u(p), ...u(truth));
        toEcho.push(...u(p), ...u(mirror));
      }
      tieTrue.setPositions(toTrue);
      tieEcho.setPositions(toEcho);
      if (method === 'fourth' && fourth) {
        tieFourth.visible = true;
        tieFourth.setPositions([...u(fourth), ...u(truth), ...u(fourth), ...u(mirror)]);
      } else {
        tieFourth.visible = false;
      }
    } else {
      tieFourth.visible = false;
    }

    // The sky itself can be cleared away when it crowds the argument.
    const showSky = params.sky !== false;
    sky.markers.visible = showSky;
    sky.solids.visible = showSky;
    sky.setTrails(showSky);

    // --- the panel ---
    panel.set('count', decided ? '1' : (mirror ? '2' : '0'));
    panel.set('echo', km(mirrorHeight, mirrorHeight >= 0 ? ' km up' : ' km'));
    panel.set('gap', km(gap));
    panel.set('fourth', km(mismatch));
  }

  update();

  return {
    update(t, dt) { update(); },
    onChange() { update(); },
    dispose() {
      if (titleNode?.parentNode) titleNode.parentNode.removeChild(titleNode);
      panel.node.parentNode?.removeChild(panel.node);
    }
  };
}
