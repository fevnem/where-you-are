// Chapter 7 — One frequency, everyone shouting.
// All 24 satellites share one carrier; each multiplies it by its own pseudo-random
// code. The receiver slides a local copy of one code against the received mixture
// and multiplies chip by chip; the sum spikes to ~1023 only when the two line up.
// The maths here is real: Gold codes of period 1023 built from two 10-stage LFSRs,
// and a genuine correlation over every one of the 1023 chip offsets.

export const id = 'ch07';
export const title = 'One frequency, everyone shouting';
export const kicker = 'All twenty-four on one carrier — kept apart by their codes, not their frequency';

export const prose = [
  `Twenty-four satellites share one carrier frequency — $1575.42$ MHz, the same for every
  one of them. They do not take turns. They all transmit, all the time, through the same few
  megahertz of spectrum, and your receiver listens to the whole jumble at once.`,

  `The separating trick is not in the carrier but in the message carried on it. Each satellite
  multiplies its signal by a pseudo-random sequence of chips — a **code**: $1023$ of them,
  repeating every millisecond, at $1.023$ million chips a second. A chip is nothing but a
  $+1$ or a $-1$, flipping about as often as it can, so it sounds exactly like noise.`,

  `Each satellite gets its own code. GPS builds them from a family called **Gold codes**,
  chosen so that any two of them look almost uncorrelated: multiply one against the other,
  chip by chip, and the products cancel.`,

  `So the receiver stops listening for a frequency and listens for a *shape* instead. It
  generates a local copy of the code of the one satellite it wants, and slides that copy
  against everything the antenna delivers — through all $1023$ offsets. At each offset it
  does one thing: multiply the mixture by the replica, chip by chip, and add the products.
  That single number is the correlation, and the curve below is that number at $128$ of the
  $1023$ offsets, with the thin band underneath marking where those $128$ sit in the code.`,

  `When the replica is aligned with its satellite, every chip meets its own twin, every product
  is $+1$, and the sum climbs to about $1023$. One chip either way and the products are as
  likely to be $+1$ as $-1$: they cancel, and the sum falls back to the floor. The peak is
  one chip wide — and a chip lasts just under a microsecond, so it carries about $293$ metres
  of range.`,

  `> Twenty-three other satellites are shouting into the same band while you do this. Because
  their codes do not line up with your replica, they lift the floor and leave the peak alone.
  The codes, not the airwaves, are what keep the signals apart.`,

  `A single sharp spike is already standing out of the floor — that is one satellite. Slide the
  **replica offset** until the marker sits on the tip, then push it off again and watch how fast
  the number collapses. Walk the **search window** slider and the spike slides out of view: the
  other seven windows are nothing but floor, which is the whole $1023$-chip code you have to
  search. Switch to another satellite and its peak is somewhere else again.`,

  `> The offset at which the peak appears **is** the delay of that satellite’s signal — its
  travel time, measured in chips. Every distance in the chapters before this one starts as
  this one number, read off the tip of a spike.`
];

export const controls = [
  {
    id: 'window', label: 'Search window', type: 'range', min: 0, max: 7, step: 1, value: 5,
    hint: 'the code is 1023 chips long; the receiver searches it 128 chips at a time',
    format: (v) => 'chips ' + (v * 128) + '–' + Math.min(v * 128 + 127, 1022)
  },
  {
    id: 'phase', label: 'Replica offset', type: 'range', min: 0, max: 127, step: 1, value: 0,
    unit: 'chips',
    hint: 'slide the local copy of the code against what the antenna hears',
    format: (v) => v + ' of 128'
  },
  {
    id: 'prn', label: 'Satellite to lock onto', type: 'select', value: '3',
    options: [
      { value: '3', label: 'Satellite 4' },
      { value: '9', label: 'Satellite 10' },
      { value: '15', label: 'Satellite 16' },
      { value: '21', label: 'Satellite 22' }
    ]
  },
  { id: 'crowd', label: 'The other 23 are transmitting', type: 'toggle', value: true }
];

export const checks = [
  {
    id: 'ch07-a',
    q: 'All twenty-four satellites send on the same carrier. What keeps their signals apart at your receiver?',
    options: [
      'Their frequency — each one uses a slightly different carrier',
      'A different pseudo-random code, one per satellite',
      'Their time slots — each satellite transmits in turn',
      'Their amplitude — the nearest satellite is simply loudest'
    ],
    answer: 1,
    why: 'Every satellite shares the carrier; the separation is the code. Two different Gold codes multiply and sum to almost nothing at every offset, so one replica locks onto one satellite and ignores the other twenty-three.'
  },
  {
    id: 'ch07-b',
    q: 'The replica is lined up and the correlation is at its peak. You slide it one chip further. What happens to the sum of the products?',
    options: [
      'It stays near the peak',
      'It falls back towards the floor',
      'It doubles',
      'It swings strongly negative and stays there'
    ],
    answer: 1,
    why: 'The replica now meets the wrong signs and the products cancel: the peak is exactly one chip wide. That needle width is what lets a receiver time the code phase — and so the distance — to a fraction of a chip.'
  },
  {
    id: 'ch07-c',
    q: 'The other twenty-three satellites are still transmitting. Why is there still only one peak?',
    options: [
      'They are too weak to be received',
      'Their codes are nearly uncorrelated with the replica, so they raise the floor rather than build a competing peak',
      'The receiver filters them out by frequency',
      'They are all on the far side of the Earth'
    ],
    answer: 1,
    why: 'A Gold code correlated against any other Gold code gives a small number at every offset. Twenty-three of them lift the noise floor, but none of them constructs a peak — the one spike is still yours.'
  }
];

// dist/pitch chosen so the flat chart faces the default camera; the content is
// pushed right of centre, into the clear band beside the prose column.
export const view = { target: [0, 0, 0], dist: 17, yaw: 0, pitch: 0.28 };

/* ------------------------------------------------------------------ *
 * The signal model.  Real GPS C/A codes: two 10-stage LFSRs (G1, G2)
 * with a per-PRN delay, XORed to give a 1023-chip Gold code.
 * ------------------------------------------------------------------ */

const N = 1023;

function lfsr(taps) {
  let s = 1;
  const out = new Int8Array(N);
  for (let i = 0; i < N; i++) {
    out[i] = ((s >> 9) & 1) ? 1 : -1;
    let fb = 0;
    for (const t of taps) fb ^= (s >> t) & 1;
    s = ((s << 1) | fb) & 1023;
  }
  return out;
}

const G1 = lfsr([2, 9]);        // 1 + x^3 + x^10
const G2 = lfsr([6, 9]);        // a second maximal sequence, a preferred pair of G1

function goldCode(delayChips) {
  const g = new Int8Array(N);
  for (let i = 0; i < N; i++) g[i] = G1[i] * G2[(i + delayChips) % N];
  return g;
}

const mod = (a, b) => ((a % b) + b) % b;

const NSAT = 24;
const CODES = Array.from({ length: NSAT }, (_, k) => goldCode(mod(k * 37, N)));
const PHASE = Array.from({ length: NSAT }, (_, k) => mod(k * 233 + 17, N));   // code phase = range
const AMP = Array.from({ length: NSAT }, (_, k) =>
  0.45 + 0.4 * ((Math.sin(k * 2.399) + 1) / 2));                              // received power

const SELECT = [3, 9, 15, 21];        // the four satellites the reader may choose
for (const k of SELECT) AMP[k] = 1.3; // ...they are the ones high in the sky

/** Everything the antenna hears: the sum of all 24 satellites, each delayed. */
function crowdedMixture() {
  const m = new Float64Array(N);
  for (let k = 0; k < NSAT; k++) {
    const c = CODES[k], ph = PHASE[k], a = AMP[k];
    for (let i = 0; i < N; i++) m[i] += a * c[mod(i - ph, N)];
  }
  return m;
}

/** Just one satellite, if the reader switches the other twenty-three off. */
function lonelyMixture(p) {
  const c = CODES[p], ph = PHASE[p], a = AMP[p];
  const m = new Float64Array(N);
  for (let i = 0; i < N; i++) m[i] = a * c[mod(i - ph, N)];
  return m;
}

/** Correlation of the mixture against a replica of satellite p, over every offset. */
function correlation(mix, p) {
  const c = CODES[p];
  const out = new Float64Array(N);
  for (let tau = 0; tau < N; tau++) {
    let s = 0;
    for (let i = 0; i < N; i++) s += mix[i] * c[mod(i - tau, N)];
    out[tau] = s / N;
  }
  return out;
}

/** The single tall spike, and the median of everything that is not it. */
function analyse(curve) {
  let peak = -Infinity, at = 0;
  for (let t = 0; t < N; t++) if (curve[t] > peak) { peak = curve[t]; at = t; }
  const mags = [];
  for (let t = 0; t < N; t++) {
    const d = Math.min(Math.abs(t - at), N - Math.abs(t - at));
    if (d > 2) mags.push(Math.abs(curve[t]));
  }
  mags.sort((a, b) => a - b);
  const floor = mags[Math.floor(mags.length / 2)] || 1e-6;
  return { peak, at, floor };
}

const MIX_ALL = crowdedMixture();

/* ------------------------------------------------------------------ *
 * The picture: a flat chart in the plane that faces the default camera.
 * x is the code offset (128 of them at a time); y is the correlation.
 * ------------------------------------------------------------------ */

export function createScene(ctx) {
  const { lines, points, own, params, globe } = ctx;

  // This chapter is a picture of the correlator, not the sky.
  globe.setVisible(false);

  /* face-on basis: unit vectors (r, u) spanning the plane whose normal is the view */
  const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
  const fwd = [cp * Math.cos(view.yaw), cp * Math.sin(view.yaw), sp];
  let r = [-fwd[1], fwd[0], 0];
  const rl = Math.hypot(r[0], r[1], r[2]) || 1;
  r = [r[0] / rl, r[1] / rl, r[2] / rl];
  const u = [fwd[1] * r[2] - fwd[2] * r[1], fwd[2] * r[0] - fwd[0] * r[2], fwd[0] * r[1] - fwd[1] * r[0]];
  const W = (x, y) => [x * r[0] + y * u[0], x * r[1] + y * u[1], x * r[2] + y * u[2]];

  const X_HALF = 3.9, X_OFF = 3.1;                      // chart width / push into the clear band
  const C_BASE = -1.0, C_SCALE = 4.0;                   // y = C_BASE + value * C_SCALE
  const OV_Y = -3.8;
  const yCorr = (v) => C_BASE + v * C_SCALE;
  const xWin = (j) => -X_HALF + X_OFF + (2 * X_HALF) * (j / 127);            // j = 0..127
  const xCode = (lag) => -X_HALF + X_OFF + (2 * X_HALF) * (Math.min(lag, N - 1) / (N - 1));

  /* ---- static furniture ---- */
  const zeroLine = lines(
    [...W(xCode(0), C_BASE), ...W(xCode(N - 1), C_BASE)],
    [0.32, 0.40, 0.52, 0.55], { mode: 'lines', layer: 'overlay' });

  // the overview ruler: one segment per search window, the active one lit
  const ovSegs = [];
  for (let i = 0; i < 8; i++) {
    ovSegs.push(...W(xCode(i * 128), OV_Y), ...W(xCode(i * 128 + 127), OV_Y));
  }
  const ovBase = lines(ovSegs, [0.36, 0.44, 0.58, 0.85], { mode: 'lines', layer: 'overlay' });

  /* ---- moveable pieces ---- */
  const corrLine = lines([...W(xWin(0), C_BASE), ...W(xWin(0), C_BASE)],
    [0.46, 1.0, 0.70, 1.0], { mode: 'strip', layer: 'overlay' });
  const cursor = lines([...W(xWin(0), C_BASE), ...W(xWin(0), C_BASE)],
    [0.80, 0.88, 1.0, 0.8], { mode: 'lines', layer: 'overlay' });
  const ovHi = lines([...W(xCode(0), OV_Y), ...W(xCode(0), OV_Y)],
    [0.36, 1.0, 0.66, 1.0], { mode: 'lines', layer: 'overlay' });
  const tick = lines([...W(xCode(0), OV_Y), ...W(xCode(0), OV_Y)],
    [1.0, 0.79, 0.41, 1.0], { mode: 'lines', layer: 'overlay' });
  const marker = points([...W(0, C_BASE)], [1.0, 0.93, 0.55, 1.0],
    { size: 22, layer: 'overlay' });
  own(zeroLine, ovBase, corrLine, cursor, ovHi, tick, marker);

  /* ---- the live correlator readout, mounted in the chapter column ---- */
  const readout = ctx.readout([
    { key: 'offset', label: 'Replica offset' },
    { key: 'corr', label: 'Correlation' },
    { key: 'gain', label: 'Peak ÷ floor' }
  ]);
  let holder = null;
  const section = document.getElementById(ctx.id);
  if (section) {
    holder = document.createElement('div');
    holder.className = 'readout-holder';
    const title = document.createElement('p');
    title.className = 'readout-title';
    title.textContent = 'At the correlator';
    holder.appendChild(title);
    holder.appendChild(readout.node);
    section.appendChild(holder);
  }

  /* ---- state ---- */
  let p = SELECT.includes(parseInt(params.prn, 10)) ? parseInt(params.prn, 10) : SELECT[0];
  let crowd = params.crowd !== false;
  let win = 5, phase = 0;
  let curve = null, stats = { peak: 1, at: 0, floor: 1 };

  function compute() {
    const mix = crowd ? MIX_ALL : lonelyMixture(p);
    curve = correlation(mix, p);
    stats = analyse(curve);
  }

  function paint() {
    const gTau = Math.min(win * 128 + phase, N - 1);
    const pos = [];
    for (let j = 0; j < 128; j++) {
      const g = Math.min(win * 128 + j, N - 1);
      pos.push(...W(xWin(j), yCorr(curve[g])));
    }
    corrLine.setPositions(pos);

    const cx = xWin(phase);
    cursor.setPositions([...W(cx, C_BASE - 1.5), ...W(cx, C_BASE + C_SCALE * 1.5)]);
    marker.setPositions([...W(cx, yCorr(curve[gTau]))]);

    ovHi.setPositions([...W(xCode(win * 128), OV_Y), ...W(xCode(win * 128 + 127), OV_Y)]);
    tick.setPositions([...W(xCode(gTau), OV_Y - 0.55), ...W(xCode(gTau), OV_Y + 0.55)]);

    const gainDb = 20 * Math.log10(stats.peak / stats.floor);
    readout.set('offset', (win * 128 + phase) + ' of ' + N);
    readout.set('corr', curve[gTau].toFixed(3));
    readout.set('gain', (isFinite(gainDb) ? gainDb.toFixed(1) : '—') + ' dB');
  }

  function apply() {
    const np = parseInt(params.prn, 10);
    const valid = SELECT.includes(np) ? np : p;
    const nc = params.crowd !== false;
    if (valid !== p || nc !== crowd) { p = valid; crowd = nc; compute(); }
    win = Math.max(0, Math.min(7, params.window | 0));
    phase = Math.max(0, Math.min(127, params.phase | 0));
    paint();
  }

  compute();
  apply();

  return {
    update() { /* the picture holds still; the reader moves the replica */ },
    onChange() { apply(); },
    dispose() {
      globe.setVisible(true);
      if (holder && holder.parentNode) holder.parentNode.removeChild(holder);
    }
  };
}
