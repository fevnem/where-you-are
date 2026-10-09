// Chapter 1 — You are the receiver.
// This file is also the worked example every later chapter is written from:
// the same header fields, the same createScene(ctx) contract, the same voice.

export const id = 'ch01';
export const title = 'You are the receiver';
export const kicker = 'What a satellite sends, and what you can possibly know from it';

export const prose = [
  `A GPS satellite does not know where you are. It has no idea you exist. Twice a day it
  crosses your sky, broadcasting the same sentence to the whole hemisphere: **this is where I
  was, and this is the time I sent it.**`,

  `That is the entire message that matters: *where* and *when*. No name, no address, no
  request. It is a lighthouse with a timestamp.`,

  `Your receiver listens for those sentences. It cannot hear the satellite's clock directly —
  it has no such clock — so it does the one thing it can: it compares the time stamped on the
  message with the time according to its own cheap quartz clock, and multiplies the difference
  by the speed of light.`,

  `Light travels $299,792.458$ kilometres every second. One microsecond of discrepancy is
  therefore $299.8$ metres of distance, and the numbers here are that literal: the ranges you
  will solve with in the next chapters are computed from travel times, not drawn.`,

  `> Everything GPS does — every fix, every turn-by-turn instruction, every "you are here" —
  is downstream of this one conversion: *a delay in time is a distance in space.*`,

  `— drag to turn the sky. The satellites are moving at the real orbital period, about eleven
  hours and fifty-eight minutes, one minute of orbit per second of your time.`
];

export const controls = [
  {
    id: 'rate', label: 'Passage of time', type: 'range', min: 0, max: 6, step: 0.25, value: 1,
    unit: 'x', hint: 'seconds of orbit per second of real time',
    format: (v) => v === 0 ? 'paused' : v + ' min/s'
  },
  {
    id: 'trails', label: 'Show orbit trails', type: 'toggle', value: true
  }
];

export const checks = [
  {
    id: 'ch01-a',
    q: 'A satellite’s message says it was sent at 12:00:00.000000. Your receiver’s clock reads 12:00:00.000067 when it arrives. Roughly how far away is it?',
    options: [
      'About 20 metres',
      'About 20 kilometres',
      'About 200 kilometres',
      'Impossible to say without knowing the direction'
    ],
    answer: 1,
    why: '67 microseconds × 0.2998 km per microsecond is about 20 kilometres. Direction is exactly what this number leaves out — the distance is a *sphere*, which is the whole subject of the next chapter.'
  },
  {
    id: 'ch01-b',
    q: 'Why can’t the receiver simply read the time off the satellite’s signal and skip the maths?',
    options: [
      'The signal is encrypted',
      'Signals arrive too fast to decode',
      'The receiver needs a fourth unknown — its own clock error — which it can only solve for once it is listening to enough satellites',
      'Satellites do not transmit time'
    ],
    answer: 2,
    why: 'Each satellite’s timestamp is known *at the satellite*. What the receiver cannot know is how wrong its own clock is — a single unknown shared by every measurement, which is why four satellites, not three, are the minimum.'
  }
];

export const view = { target: [0, 0, 0], dist: 78, yaw: 0.9, pitch: 0.42 };

/**
 * createScene(ctx) — called when the chapter becomes the one on screen.
 * ctx.own(actor) registers geometry for automatic removal on dispose.
 */
export function createScene(ctx) {
  const { constellation, geo, own, params, station } = ctx;

  // The sky, moving at the real orbital rate.
  const sky = constellation({ timeScale: 60, trails: true, size: 9 });
  own(sky.markers, sky.solids, sky.ranges, ...sky.trails);

  // A receiver: Paris, just to have a place to be.
  const here = geo.geodeticToEcef(48.8566, 2.3522, 0.035);
  const me = station(here, [0.45, 0.95, 0.75, 1]);
  own(me);
  sky.setReceiver(here);

  return {
    update(t, dt, stage) {
      sky.setTimeScale((params.rate ?? 1) * 60);
      sky.setTrails(!!params.trails);
      sky.update(t);
    },
    dispose() { /* ctx.own() handles removal */ }
  };
}
