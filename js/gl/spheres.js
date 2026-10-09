// Range spheres: the picture behind chapters 2-5. A satellite knows its own
// clock; your distance from it is a sphere. Two spheres meet in a circle, three
// in two points, four in one.

import { createHalo, createRing, createPoints, circleMatrix } from './primitives.js';
import { withNormals } from './globe.js';
import { sphere } from '../engine/mesh.js';
import { mat4 } from '../engine/mat4.js';

const KM2U = 1 / 1000;

const DEFAULT_COLORS = [
  [0.32, 0.62, 0.95, 0.55],
  [0.95, 0.55, 0.45, 0.55],
  [0.55, 0.92, 0.62, 0.55],
  [0.92, 0.78, 0.38, 0.55],
  [0.78, 0.55, 0.95, 0.55],
  [0.45, 0.85, 0.9, 0.55]
];

/**
 * createRangeSpheres(stage, {max}) -> handle
 *   setSpheres([{center, radiusKm, color?}])   translucent shells
 *   setCircles([{center, radiusKm, normal, color?}])  the ring where two meet
 *   setCandidates([{pos, color?, size?}])      the two points three spheres allow
 *   setSolution(pos | null)                    the single point four agree on
 *   clear()
 */
export function createRangeSpheres(stage, opts = {}) {
  const max = opts.max ?? 6;
  const unit = withNormals(sphere(1, 48, 24));
  const shells = Array.from({ length: max }, (_, i) => createHalo(stage, 1, DEFAULT_COLORS[i % 6], {
    mesh: unit,
    power: opts.power ?? 2.2,
    visible: false
  }));
  const rings = Array.from({ length: opts.maxRings ?? 2 }, (_, i) =>
    createRing(stage, opts.ringColor ?? [0.95, 0.82, 0.45, 0.95], { visible: false, width: 2 }));
  const candidates = createPoints(stage, new Float32Array(0), opts.candidateColor ?? [1, 0.92, 0.5, 1], {
    size: opts.candidateSize ?? 12,
    layer: 'overlay',
    visible: false
  });
  const solution = createPoints(stage, new Float32Array(0), opts.solutionColor ?? [0.4, 1, 0.7, 1], {
    size: opts.solutionSize ?? 14,
    layer: 'overlay',
    visible: false
  });

  return {
    shells,
    rings,
    candidates,
    solution,
    setSpheres(list) {
      shells.forEach((s, i) => {
        const item = list[i];
        if (!item) { s.visible = false; return; }
        s.set([item.center[0] * KM2U, item.center[1] * KM2U, item.center[2] * KM2U],
              item.radiusKm * KM2U,
              item.color ?? DEFAULT_COLORS[i % 6]);
        s.visible = item.visible !== false;
      });
      return this;
    },
    setCircles(list) {
      rings.forEach((r, i) => {
        const item = list[i];
        if (!item) { r.visible = false; return; }
        r.set([item.center[0] * KM2U, item.center[1] * KM2U, item.center[2] * KM2U],
              item.radiusKm * KM2U,
              item.normal);
        if (item.color) r.color = item.color.slice();
      });
      return this;
    },
    setCandidates(list) {
      const flat = [];
      list.forEach((c) => flat.push(c.pos[0] * KM2U, c.pos[1] * KM2U, c.pos[2] * KM2U));
      candidates.setPositions(flat);
      candidates.visible = flat.length > 0;
      return this;
    },
    setSolution(posOrNull) {
      if (!posOrNull) { solution.visible = false; return this; }
      solution.setPositions([posOrNull[0] * KM2U, posOrNull[1] * KM2U, posOrNull[2] * KM2U]);
      solution.visible = true;
      return this;
    },
    clear() {
      shells.forEach((s) => { s.visible = false; });
      rings.forEach((r) => { r.visible = false; });
      candidates.visible = false;
      solution.visible = false;
      return this;
    }
  };
}

export { circleMatrix, mat4 };
