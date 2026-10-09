// The Earth as a drawable object: lit globe, coastlines, graticule, atmosphere.
// Data comes from js/data/coastline.js (public-domain Natural Earth 110m, rounded).

import { sphere, parallel, meridian, coastLines } from '../engine/mesh.js';
import { createMesh, createLines, createHalo } from './primitives.js';
import { EARTH_R } from '../engine/vocab.js';
import { COAST } from '../data/coastline.js';

/** Add vertex normals to a unit sphere mesh (needed by the lit shader). */
function withNormals(mesh) {
  const n = mesh.pos.length;
  const norm = new Float32Array(n);
  // Sphere is centred on the origin: the position *is* the normal direction.
  for (let i = 0; i < n; i += 3) {
    const x = mesh.pos[i], y = mesh.pos[i + 1], z = mesh.pos[i + 2];
    const l = Math.hypot(x, y, z) || 1;
    norm[i] = x / l; norm[i + 1] = y / l; norm[i + 2] = z / l;
  }
  return { ...mesh, norm };
}

/**
 * createGlobe(stage, opts) -> actor
 *   actor.setGrid(bool)      show/hide the graticule
 *   actor.setCoast(bool)     show/hide coastlines
 *   actor.setSun([x,y,z])    move the light
 *   actor.setOpacity(a)
 */
export function createGlobe(stage, opts = {}) {
  const seg = opts.seg ?? 96;
  const globeMesh = withNormals(sphere(EARTH_R, seg, seg / 2));
  const surface = createMesh(stage, globeMesh, opts.color ?? [0.10, 0.15, 0.22, 1], {
    lit: true,
    rim: opts.rim ?? 0.75,
    light: opts.light ?? [0.75, 0.25, 0.6]
  });

  const coast = createLines(stage, coastLines(COAST, EARTH_R * 1.0015).pos,
    opts.coastColor ?? [0.55, 0.72, 0.86, 0.9], { layer: 'opaque' });

  const gridPos = [];
  for (let lat = -60; lat <= 60; lat += 30) {
    if (lat === 0) continue;
    const p = parallel(lat, EARTH_R * 1.001).pos;
    for (let i = 0; i < p.length; i += 3) gridPos.push(p[i], p[i + 1], p[i + 2]);
    for (let i = 0; i <= p.length - 6; i += 3) {
      gridPos.push(p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5]);
    }
  }
  for (let lon = 0; lon < 360; lon += 30) {
    const p = meridian(lon, EARTH_R * 1.0005).pos;
    for (let i = 0; i <= p.length - 6; i += 3) {
      gridPos.push(p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5]);
    }
  }
  const grid = createLines(stage, gridPos, opts.gridColor ?? [0.35, 0.45, 0.58, 0.35], { layer: 'opaque' });
  const equator = createLines(stage, parallel(0, EARTH_R * 1.0015).pos,
    opts.equatorColor ?? [0.55, 0.62, 0.72, 0.5], { mode: 'loop', layer: 'opaque' });

  const halo = createHalo(stage, EARTH_R * (opts.haloScale ?? 1.09),
    opts.haloColor ?? [0.24, 0.45, 0.78, 0.75],
    { mesh: withNormals(sphere(1, 48, 24)), power: opts.haloPower ?? 3.0 });

  const group = { surface, coast, grid, equator, halo };
  return {
    group,
    setGrid(on) { grid.visible = !!on; equator.visible = !!on; return this; },
    setCoast(on) { coast.visible = !!on; return this; },
    setSurface(on) { surface.visible = !!on; return this; },
    setSun(dir) {
      surface.draw = surface.draw.bind(surface);
      group.surface.constructor; // no-op: uniforms are read per draw
      surfaceColorLight(dir);
      return this;
    },
    setOpacity(a) {
      surface.color[3] = a;
      return this;
    },
    setVisible(on) {
      Object.values(group).forEach((a) => { a.visible = !!on; });
      return this;
    }
  };

  function surfaceColorLight(dir) {
    // store on the actor so the lit shader picks it up on the next frame
    surface._light = dir;
  }
}

/** A small solid marker (used for a receiver, a city, an intersection point). */
export function createMarker(stage, pos, color = [1, 0.85, 0.4, 1], opts = {}) {
  const r = opts.radius ?? 0.09;
  const mesh = withNormals(sphere(r, 20, 12));
  return createMesh(stage, mesh, color, {
    lit: true,
    layer: opts.layer ?? 'opaque',
    position: pos,
    scale: 1,
    rim: 0.9
  });
}

export { withNormals };
