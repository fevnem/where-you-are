// js/gl/compose.js — the restraint pass.
//
// Two jobs, both subtractive: the composer owns no new geometry, it only turns
// existing actors down so the scene stops reading as a wireframe demo.
//
//   (a) tone the globe’s own graticule, equator, coastline and atmosphere halo
//       down, and keep the lit surface opaque, so the lit Earth stays the
//       subject;
//   (b) once a frame, depth-cue the constellation’s orbit lines and range
//       lines: blend their colour toward the sky and drop their alpha with
//       distance and with how much of the line sits behind the planet, so
//       far-side clutter recedes instead of crossing the disc.
//
// Loaded as an optional polish file by main.js; apply(globalCtx) returns
// { update(t), setMode(name), actors, reports } and wires update(t) onto
// stage.onFrame itself. Nothing is allocated inside update().

import { EARTH_R, GPS_A_KM } from '../engine/vocab.js';

const KM = 0.001;
const ORBIT_U = GPS_A_KM * KM;          // 26.56 world units — where GPS orbits sit
const R2 = EARTH_R * EARTH_R;

// The sky the far lines recede into (the stage clear-colour family).
const FOG = [0.05, 0.08, 0.14];

// A named look is the whole of job (a): alphas and colours per overlay. The
// three presets are the restrained default, the original technical look, and a
// near-bare planet.
const LOOKS = {
  restraint: {
    grid: true, gridAlpha: 0.10, gridRGB: [0.30, 0.38, 0.48], equatorAlpha: 0.14,
    coast: true, coastAlpha: 0.55, coastRGB: [0.52, 0.68, 0.82],
    haloAlpha: 0.55, haloRGB: [0.20, 0.38, 0.66]
  },
  technical: {
    grid: true, gridAlpha: 0.35, gridRGB: [0.35, 0.45, 0.58], equatorAlpha: 0.50,
    coast: true, coastAlpha: 0.90, coastRGB: [0.55, 0.72, 0.86],
    haloAlpha: 0.75, haloRGB: [0.24, 0.45, 0.78]
  },
  bare: {
    grid: false, gridAlpha: 0.0, gridRGB: [0.30, 0.38, 0.48], equatorAlpha: 0.0,
    coast: true, coastAlpha: 0.30, coastRGB: [0.50, 0.66, 0.80],
    haloAlpha: 0.45, haloRGB: [0.20, 0.38, 0.66]
  }
};

let installed = false;   // the stage hooks are process-wide: install once

/** Write an rgb triple into an actor’s colour array in place (no new array). */
function setRGB(actor, rgb) {
  if (!actor || !actor.color) return;
  actor.color[0] = rgb[0]; actor.color[1] = rgb[1]; actor.color[2] = rgb[2];
}

export function apply(globalCtx) {
  const { stage, camera, globe } = globalCtx;
  const gl = stage.gl;

  const reports = {
    module: 'js/gl/compose.js',
    mode: 'restraint',
    globe: {},
    depthCue: { trailLines: 0, rangeLines: 0, dimmed: 0, actors: [] },
    changed: []
  };

  /* ------------------------------------------------------------------ *
   * (a) the globe overlays: hold the four line actors once, so the
   *     tone-down can be rewritten in place on every mode change.
   * ------------------------------------------------------------------ */
  const g = globe && globe.group ? globe.group : null;
  const grid = g ? g.grid : null;
  const equator = g ? g.equator : null;
  const coast = g ? g.coast : null;
  const halo = g ? g.halo : null;
  const overlayActors = [grid, equator, coast, halo].filter(Boolean);
  const baseA = {
    grid: grid ? grid.color[3] : 0,
    equator: equator ? equator.color[3] : 0,
    coast: coast ? coast.color[3] : 0,
    halo: halo ? halo.color[3] : 0
  };

  function setLook(name) {
    const look = LOOKS[name] ? LOOKS[name] : LOOKS.restraint;
    reports.mode = LOOKS[name] ? name : 'restraint';
    const changed = [];

    if (grid) {
      setRGB(grid, look.gridRGB); grid.color[3] = look.gridAlpha;
      changed.push('graticule alpha ' + baseA.grid.toFixed(2) + ' -> ' + look.gridAlpha.toFixed(2) +
        (look.grid ? '' : ' (hidden)'));
    }
    if (equator) {
      setRGB(equator, look.gridRGB); equator.color[3] = look.equatorAlpha;
      changed.push('equator alpha ' + baseA.equator.toFixed(2) + ' -> ' + look.equatorAlpha.toFixed(2));
    }
    if (coast) {
      setRGB(coast, look.coastRGB); coast.color[3] = look.coastAlpha;
      changed.push('coastline alpha ' + baseA.coast.toFixed(2) + ' -> ' + look.coastAlpha.toFixed(2));
    }
    if (halo) {
      setRGB(halo, look.haloRGB); halo.color[3] = look.haloAlpha;
      changed.push('atmosphere halo alpha ' + baseA.halo.toFixed(2) + ' -> ' + look.haloAlpha.toFixed(2));
    }
    if (globe) {
      try { globe.setGrid(!!look.grid); } catch (e) { /* optional */ }
      try { globe.setCoast(!!look.coast); } catch (e) { /* optional */ }
      try { globe.setOpacity(1); } catch (e) { /* optional */ }
      changed.push('surface opacity -> 1 (lit terminator kept solid)');
    }

    reports.globe = {
      grid: look.grid ? look.gridAlpha : 'hidden',
      equator: look.equatorAlpha,
      coast: look.coast ? look.coastAlpha : 'hidden',
      halo: look.haloAlpha,
      surfaceOpacity: 1
    };
    reports.changed = changed;
    return reports;
  }

  /* ------------------------------------------------------------------ *
   * (b) depth cue. To fade a line we need its vertices, and the actors do
   *     not carry them, so remember the array each line batch was built
   *     from. createLines() creates exactly one ARRAY_BUFFER and then calls
   *     stage.add(), so the buffer created just before an add belongs to
   *     that actor (guarded by count * 3 === data.length). Installed before
   *     the active scene is re-mounted below, so constellations built after
   *     this point are captured.
   * ------------------------------------------------------------------ */
  const posByActor = new WeakMap();
  const recByActor = new WeakMap();
  let lastData = null;

  if (!installed) {
    installed = true;
    const origBuffer = stage.buffer;
    stage.buffer = function (data, target) {
      const buf = origBuffer.call(stage, data, target);
      if (target === gl.ARRAY_BUFFER) lastData = data;
      return buf;
    };
    const origAdd = stage.add;
    stage.add = function (actor, layer) {
      if (lastData && actor && actor.count * 3 === lastData.length) posByActor.set(actor, lastData);
      lastData = null;
      return origAdd.call(stage, actor, layer);
    };
  }

  // One record per line actor we could identify. Kept for the report list.
  const targets = [];

  function onLayer(actor) {
    return stage.actors().transparent.indexOf(actor) >= 0;
  }

  function classify(actor) {
    const data = posByActor.get(actor);
    if (!data || data.length < 6) return null;
    const n = data.length / 3;
    let minR = Infinity, maxR = 0;
    for (let i = 0; i < n; i++) {
      const x = data[i * 3], y = data[i * 3 + 1], z = data[i * 3 + 2];
      const r = Math.sqrt(x * x + y * y + z * z);
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    }
    let kind = null;
    if (minR > ORBIT_U * 0.75 && maxR < ORBIT_U * 1.25) kind = 'orbit';
    else if (minR < EARTH_R * 1.6 && maxR > ORBIT_U * 0.6) kind = 'range';
    if (!kind) return null;

    const c = actor.color || [1, 1, 1, 1];
    const rec = {
      kind,
      n,
      step: kind === 'orbit' ? 3 : 1,   // orbits are long rings: sample every third vertex
      data,
      baseRGB: [c[0], c[1], c[2]],
      baseAlpha: c[3],
      alpha: c[3],
      occluded: 0,
      meanDist: 0
    };
    // `actor` is kept for drawing and pruning but is non-enumerable, so a
    // JSON dump of reports never hits a cycle.
    Object.defineProperty(rec, 'actor', { value: actor, enumerable: false });
    recByActor.set(actor, rec);
    targets.push(rec);
    return rec;
  }

  // Reused scalars only — depthCue() allocates nothing.
  function depthCue(rec, eye) {
    const data = rec.data, n = rec.n, step = rec.step;
    const ex = eye[0], ey = eye[1], ez = eye[2];
    let occ = 0, sum = 0, samples = 0;
    for (let i = 0; i < n; i += step) {
      const dx = data[i * 3] - ex, dy = data[i * 3 + 1] - ey, dz = data[i * 3 + 2] - ez;
      const dd = dx * dx + dy * dy + dz * dz;
      if (dd < 1e-6) continue;
      sum += Math.sqrt(dd); samples++;
      // where the ray eye->vertex comes closest to the planet centre
      const t = -(ex * dx + ey * dy + ez * dz) / dd;
      if (t > 0 && t < 1) {
        const qx = ex + t * dx, qy = ey + t * dy, qz = ez + t * dz;
        if (qx * qx + qy * qy + qz * qz < R2) occ++;   // the planet is in the way
      }
    }
    if (!samples) return;
    rec.occluded = occ / samples;
    rec.meanDist = sum / samples;

    // Distance: near the camera keeps its colour, far sinks into the sky.
    const near = camera.dist * 0.60, far = camera.dist * 1.45;
    let f = (far - rec.meanDist) / (far - near || 1);
    f = f < 0 ? 0 : f > 1 ? 1 : f;
    const distB = 0.40 + 0.60 * f;            // [0.40, 1.00]
    const backB = 1 - 0.60 * rec.occluded;    // occluded lines fade further
    const k = (1 - f) * 0.55;                 // how far it has sunk into the sky

    const col = rec.actor.color;
    col[0] = rec.baseRGB[0] * (1 - k) + FOG[0] * k;
    col[1] = rec.baseRGB[1] * (1 - k) + FOG[1] * k;
    col[2] = rec.baseRGB[2] * (1 - k) + FOG[2] * k;
    col[3] = rec.baseAlpha * distB * backB;
    rec.alpha = col[3];
  }

  function update() {
    const eye = camera && camera.eye;
    if (!eye) return;
    const lines = stage.actors().transparent;
    let trailLines = 0, rangeLines = 0, dimmed = 0;
    for (let i = 0; i < lines.length; i++) {
      const a = lines[i];
      if (a.visible === false) continue;
      if (typeof a.width !== 'number') continue;   // lines only, not points or meshes
      let rec = recByActor.get(a);
      if (!rec) rec = classify(a);
      if (!rec) continue;
      depthCue(rec, eye);
      if (rec.kind === 'orbit') trailLines++; else rangeLines++;
      if (rec.alpha < rec.baseAlpha * 0.995) dimmed++;
    }
    reports.depthCue.trailLines = trailLines;
    reports.depthCue.rangeLines = rangeLines;
    reports.depthCue.dimmed = dimmed;
    reports.depthCue.actors = targets;

    // Keep the report list from growing without bound across chapter changes.
    if (targets.length > 256) {
      let w = 0;
      for (let i = 0; i < targets.length; i++) {
        const r = targets[i];
        if (recByActor.get(r.actor) === r && onLayer(r.actor)) targets[w++] = r;
      }
      targets.length = w;
    }
  }

  setLook('restraint');
  stage.onFrame.push(() => update());

  // The chapter active at load was mounted before the capture hook existed;
  // re-mount it once, on the next tick, so its constellation is captured too.
  // Guarded, and never fatal.
  if (typeof setTimeout === 'function') {
    setTimeout(() => {
      try {
        const A = window.APP;
        if (!A || A.__composeRemounted) return;
        A.__composeRemounted = true;
        const ch = (A.chapters || []).find((c) => c.id === A.state.active) || A.chapters[0];
        if (ch && typeof ch.createScene === 'function') A.activate(ch);
      } catch (e) { /* leave the page as it was */ }
    }, 0);
  }

  return {
    update,
    setMode: (name) => setLook(name),
    actors: overlayActors,
    reports
  };
}

export default apply;
