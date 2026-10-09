// The constellation as a drawable object: orbit trails, satellite markers,
// range lines down to a receiver, and the visibility list the text quotes.

import { createLines, createPoints, createMesh } from './primitives.js';
import { constellation, satelliteEcef, orbitRing } from '../model/kepler.js';
import { visibleSats, rangeKm } from '../model/trilateration.js';
import { withNormals } from './globe.js';
import { sphere } from '../engine/mesh.js';
import { EARTH_R } from '../engine/vocab.js';

const KM2U = 1 / 1000;

/**
 * createConstellation(stage, opts) -> handle
 *   handle.update(tSeconds)                 move the satellites to time t
 *   handle.positionsKm()                    current ECEF positions, km
 *   handle.visibleFrom(obsKm, minElDeg)     what a receiver can see, best first
 *   handle.setReceiver(obsKm | null)        draw range lines to this point
 *   handle.setTrails(bool)                  orbit rings on/off
 *   handle.setTimeScale(k)                  seconds of orbit per second
 *   handle.highlight(indices)               marker colour per satellite
 */
export function createConstellation(stage, opts = {}) {
  const sats = constellation(opts.n ?? 24, opts);
  const n = sats.length;
  const timeScale = opts.timeScale ?? 60;

  /* orbit trails, drawn once (static geometry in ECEF-rotating frame is not
     static, so they are rebuilt cheaply whenever the epoch changes) */
  const trailColor = opts.trailColor ?? [0.30, 0.42, 0.62, 0.30];
  const trails = sats.map((s) => {
    const ring = orbitRing(s, 96);
    const flat = [];
    for (let i = 0; i < ring.length - 1; i++) {
      flat.push(ring[i][0] * KM2U, ring[i][1] * KM2U, ring[i][2] * KM2U);
      flat.push(ring[i + 1][0] * KM2U, ring[i + 1][1] * KM2U, ring[i + 1][2] * KM2U);
    }
    return createLines(stage, flat, trailColor, { layer: 'transparent', visible: opts.trails !== false });
  });

  const buf = new Float32Array(n * 3);
  const markers = createPoints(stage, buf, opts.color ?? [1.0, 0.86, 0.5, 1], {
    size: opts.size ?? 10,
    layer: 'overlay'
  });

  const markerMesh = withNormals(sphere(opts.markerR ?? 0.22, 16, 10));
  const solids = createMesh(stage, markerMesh, opts.color ?? [1.0, 0.86, 0.5, 1], {
    lit: true,
    instances: Array.from({ length: n }, () => [0, 0, 0]),
    scales: new Array(n).fill(1)
  });

  const rangeBuf = new Float32Array(n * 6);
  const ranges = createLines(stage, rangeBuf, opts.rangeColor ?? [0.45, 0.75, 0.95, 0.55], {
    layer: 'transparent',
    visible: false
  });

  let current = sats.map(() => [0, 0, 0]);
  let receiver = null;
  let epoch = opts.epoch ?? 0;

  const handle = {
    sats,
    markers,
    solids,
    trails,
    ranges,
    timeScale,
    setTimeScale(k) { this.timeScale = k; return this; },
    setEpoch(t) { epoch = t; return this; },
    setTrails(on) { trails.forEach((t) => { t.visible = !!on; }); return this; },
    setReceiver(obsKm) {
      receiver = obsKm ? [...obsKm] : null;
      ranges.visible = !!receiver;
      return this;
    },
    getReceiver() { return receiver ? [...receiver] : null; },
    update(t) {
      const tt = epoch + t * this.timeScale;
      for (let i = 0; i < n; i++) {
        const p = satelliteEcef(sats[i], tt);
        current[i] = p;
        buf[i * 3] = p[0] * KM2U;
        buf[i * 3 + 1] = p[1] * KM2U;
        buf[i * 3 + 2] = p[2] * KM2U;
      }
      markers.setPositions(buf);
      solids.setInstances(current.map((p) => [p[0] * KM2U, p[1] * KM2U, p[2] * KM2U]));
      if (receiver) {
        for (let i = 0; i < n; i++) {
          rangeBuf[i * 6] = receiver[0] * KM2U;
          rangeBuf[i * 6 + 1] = receiver[1] * KM2U;
          rangeBuf[i * 6 + 2] = receiver[2] * KM2U;
          rangeBuf[i * 6 + 3] = current[i][0] * KM2U;
          rangeBuf[i * 6 + 4] = current[i][1] * KM2U;
          rangeBuf[i * 6 + 5] = current[i][2] * KM2U;
        }
        ranges.setPositions(rangeBuf);
      }
      return this;
    },
    positionsKm() { return current.map((p) => [...p]); },
    visibleFrom(obsKm, minElDeg = 10) { return visibleSats(current, obsKm, minElDeg); },
    rangesFrom(obsKm) { return current.map((p) => rangeKm(obsKm, p)); },
    /** Distance of satellite i from the receiver, km. */
    rangeKm(i) { return receiver ? rangeKm(receiver, current[i]) : NaN; },
    setColor(c) { markers.setColor(c); solids.setColor(c); return this; },
    setVisible(on) {
      markers.visible = !!on; solids.visible = !!on;
      return this;
    }
  };

  handle.update(0);
  return handle;
}

/** A receiver marker at a geodetic position. */
export function createStation(stage, posKm, color = [0.45, 0.95, 0.75, 1], opts = {}) {
  const mesh = withNormals(sphere(opts.radius ?? 0.12, 20, 12));
  return createMesh(stage, mesh, color, {
    lit: true,
    position: [posKm[0] * KM2U, posKm[1] * KM2U, posKm[2] * KM2U],
    layer: 'opaque'
  });
}

export { EARTH_R };
