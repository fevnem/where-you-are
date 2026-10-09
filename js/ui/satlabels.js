// js/ui/satlabels.js — the sky, annotated.
//
// Pins a short PRN beside every GPS satellite and one “you” at the receiver,
// using the HTML-label layer that js/ui/labels.js already provides. This file
// owns no DOM machinery of its own: it resolves the shared createLabels
// instance (state.labels, else the factory the shell loaded, else a direct
// import), then every frame moves the anchors and toggles visibility.
//
// What it reads from the shipped maths:
//   kepler.constellation / satelliteEcef   the 24-slot sky, ECEF km
//   geo.geodeticToEcef                     the receiver (Paris, as elsewhere)
//   geo.elevationAzimuth                   the local elevation of each satellite
//
// Rule the layer follows: a satellite below the receiver’s 10° elevation mask
// carries no readable label — it is hidden. Above the mask it is shown in the
// signal colour. A satellite hidden by the Earth from the camera is dropped by
// labels.js itself (its ray/sphere test), so the picture never labels a bird
// the reader cannot see.
//
// Two hard requirements, met by construction rather than by styling here:
//   * z-order — the label layer lives inside #sky, and #sky is z-index 0 while
//     #story is 1, #rail is 3 and the instrument panel is 5. So labels are
//     behind every panel and behind the reading column and can never cover it.
//   * pointer events — labels.js sets pointer-events:none on the layer and on
//     every node; this file reinforces it. A drag always reaches the canvas.
//
// Positions handed to labels.js are in *world units* (1 unit = 1000 km), the
// frame the camera and the Earth-occlusion radius (EARTH_R = 6.371) live in;
// kilometres are converted with vocab.KM.
//
// Self-wiring: apply(globalCtx) -> { update(t), setVisible(bool), count() }.
// update(t) takes simulated seconds; with no argument it advances on the
// stage’s real-time frames (TIME_SCALE simulated seconds per real second).
//
//   const sats = apply(globalCtx);
//   sats.update(3600)        // move the sky to t = 3600 s
//   sats.setVisible(false)   // drop every label this module owns
//   sats.count()             // labels it is keeping alive (24 + you)

import { createLabels } from './labels.js';
import { constellation, satelliteEcef } from '../model/kepler.js';
import { geodeticToEcef, elevationAzimuth } from '../model/geo.js';
import { GPS_N_SATS, EARTH_R, KM } from '../engine/vocab.js';

const RECEIVER = { lat: 48.8566, lon: 2.3522, hKm: 0.035 };  // the project’s receiver
const MASK_DEG = 10;        // elevation mask: below this a satellite is not used
const TIME_SCALE = 30;      // simulated seconds per real second
const ID_PREFIX = 'sat:';
const YOU_ID = 'receiver:you';
const YOU_TEXT = 'you';
const YOU_LIFT = 1.03;      // lift the receiver anchor clear of the sphere test
const FADE_NEAR = 24;       // world units; generous so labels survive zoom
const FADE_FAR = 900;

const pad2 = (n) => (n < 10 ? '0' + n : String(n));

/** km ECEF -> world units. */
function wu(p) {
  return [p[0] * KM, p[1] * KM, p[2] * KM];
}

export function apply(globalCtx) {
  const ctx0 = globalCtx || {};
  const stage = ctx0.stage;
  const camera = ctx0.camera;
  if (!stage || !camera) return null;

  const state = ctx0.state || {};

  // Resolve the shared label layer. The shell builds one on the first chapter
  // mount (state.labels); prefer it so this file and the chapters share a single
  // pool and a single per-frame projection. Fall back to the factory the shell
  // loaded, then to this module’s own import.
  const polish = state.polish
    || (ctx0.app && ctx0.app.polish)
    || (typeof window !== 'undefined' && window.APP && window.APP.polish)
    || {};
  let labels = state.labels || null;
  if (!labels) {
    const factory = typeof polish.createLabels === 'function' ? polish.createLabels : createLabels;
    labels = factory(stage, camera);
    state.labels = labels;
  }
  const layer = labels.layer;
  if (layer) layer.style.pointerEvents = 'none';

  const sats = constellation(GPS_N_SATS);
  const n = sats.length;

  // The receiver: caller-supplied ECEF km, else the project’s Paris station.
  const receiverKm = (Array.isArray(ctx0.receiver) && ctx0.receiver.length === 3)
    ? [Number(ctx0.receiver[0]) || 0, Number(ctx0.receiver[1]) || 0, Number(ctx0.receiver[2]) || 0]
    : geodeticToEcef(RECEIVER.lat, RECEIVER.lon, RECEIVER.hKm);

  // Lift the receiver anchor a whisker above the surface so labels.js’s
  // “point inside the sphere” test can never clip a station sitting on it.
  let receiverWorld = wu(receiverKm);
  {
    const r = Math.hypot(receiverWorld[0], receiverWorld[1], receiverWorld[2]) || 1;
    const k = (EARTH_R * YOU_LIFT) / r;
    receiverWorld = [receiverWorld[0] * k, receiverWorld[1] * k, receiverWorld[2] * k];
  }

  // One label per satellite (its PRN), one at the receiver. All are created up
  // front so the pool warms once and the node count is stable and inspectable.
  const ids = [];
  const satIds = [];
  for (let i = 0; i < n; i++) {
    const id = ID_PREFIX + sats[i].id;
    satIds.push(id);
    ids.push(id);
    labels.add(id, wu(satelliteEcef(sats[i], 0)), 'G' + pad2(i + 1), {
      accent: true, offset: [0, 12], fadeNear: FADE_NEAR, fadeFar: FADE_FAR, size: 11
    });
  }
  ids.push(YOU_ID);
  labels.add(YOU_ID, receiverWorld, YOU_TEXT, {
    accent: true, color: '#6ee7a8', offset: [0, 14],
    fadeNear: FADE_NEAR, fadeFar: FADE_FAR, size: 11
  });

  const managed = ids.length;
  const posBuf = sats.map(() => [0, 0, 0]);
  let sim = 0;
  let on = true;
  let timeScale = TIME_SCALE;
  let visibleCount = 0;

  function update(t) {
    if (Number.isFinite(t)) sim = t;
    const tt = sim;

    // One pass: move each anchor and decide whether the mask keeps its label.
    let shown = 0;
    for (let i = 0; i < n; i++) {
      const p = satelliteEcef(sats[i], tt);          // ECEF km
      const w = posBuf[i];
      w[0] = p[0] * KM; w[1] = p[1] * KM; w[2] = p[2] * KM;
      labels.setPosition(satIds[i], w);

      const el = elevationAzimuth(receiverKm, p).el;
      const above = el >= MASK_DEG;                  // in the receiver’s sky?
      labels.setVisible(satIds[i], on && above);
      if (on && above) shown++;
    }

    labels.setPosition(YOU_ID, receiverWorld);
    labels.setVisible(YOU_ID, on);
    if (on) shown++;
    visibleCount = shown;
    return api;
  }

  function setVisible(v) {
    on = v !== false;
    update(sim);
    return api;
  }

  function setReceiver(posKm) {
    if (Array.isArray(posKm) && posKm.length === 3) {
      for (let i = 0; i < 3; i++) receiverKm[i] = Number(posKm[i]) || 0;
      let w = wu(receiverKm);
      const r = Math.hypot(w[0], w[1], w[2]) || 1;
      const k = (EARTH_R * YOU_LIFT) / r;
      w = [w[0] * k, w[1] * k, w[2] * k];
      receiverWorld = w;
      labels.setPosition(YOU_ID, receiverWorld);
      update(sim);
    }
    return api;
  }

  function setTimeScale(k) {
    if (Number.isFinite(k) && k >= 0) timeScale = k;
    return api;
  }

  // Self-drive: advance the sky clock off the stage’s real-time frames. Pushed
  // after the shell’s camera tick and after labels.js’s own frame hook, so the
  // camera matrices are current when labels.project runs.
  const onFrame = (rt, dt) => {
    sim += (Number.isFinite(dt) ? dt : 0) * timeScale;
    update(sim);
  };
  onFrame.__satlabels = true;
  stage.onFrame.push(onFrame);

  const api = {
    labels,
    layer,
    ids: () => ids.slice(),
    count: () => managed,
    visible: () => visibleCount,
    update,
    setVisible,
    setReceiver,
    setTimeScale,
    destroy() {
      const k = stage.onFrame.indexOf(onFrame);
      if (k >= 0) stage.onFrame.splice(k, 1);
      for (const id of ids) labels.remove(id);
      ids.length = 0;
    },
    get time() { return sim; }
  };

  update(0);
  if (typeof globalThis !== 'undefined') globalThis.__satLabels = api;
  return api;
}

export default { apply };
