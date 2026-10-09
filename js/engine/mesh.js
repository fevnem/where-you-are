// Small mesh builders. Everything is indexed triangles (or lines) as flat
// Float32Array/Uint16Array data, ready for buffer upload.

/** UV sphere centred on the origin. */
export function sphere(radius = 1, seg = 64, rings = 32) {
  const pos = [], idx = [];
  for (let j = 0; j <= rings; j++) {
    const v = j / rings, phi = v * Math.PI;
    for (let i2 = 0; i2 <= seg; i2++) {
      const u = i2 / seg, theta = u * Math.PI * 2;
      pos.push(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi)
      );
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i2 = 0; i2 < seg; i2++) {
      const a = j * (seg + 1) + i2, b = a + seg + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { pos: new Float32Array(pos), idx: new Uint16Array(idx), count: idx.length };
}

/** Ring (line loop) in the XY plane, radius 1. */
export function ring(seg = 128) {
  const pos = [];
  for (let i = 0; i < seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    pos.push(Math.cos(t), Math.sin(t), 0);
  }
  return { pos: new Float32Array(pos) };
}

/** Lofted band around a circle of latitude (for graticule lines). */
export function parallel(latDeg, radius = 1, seg = 128) {
  const lat = latDeg * Math.PI / 180;
  const pos = [];
  for (let i = 0; i < seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    pos.push(radius * Math.cos(lat) * Math.cos(t), radius * Math.cos(lat) * Math.sin(t), radius * Math.sin(lat));
  }
  return { pos: new Float32Array(pos) };
}

/** Meridian arc from pole to pole at a given longitude. */
export function meridian(lonDeg, radius = 1, seg = 96) {
  const lon = lonDeg * Math.PI / 180;
  const pos = [];
  for (let i = 0; i <= seg; i++) {
    const lat = -Math.PI / 2 + (i / seg) * Math.PI;
    pos.push(radius * Math.cos(lat) * Math.cos(lon), radius * Math.cos(lat) * Math.sin(lon), radius * Math.sin(lat));
  }
  return { pos: new Float32Array(pos) };
}

/** Local horizon disc (for "what the satellite can see from here" diagrams). */
export function disc(radius = 1, seg = 96) {
  const pos = [0, 0, 0];
  const idx = [];
  for (let i = 0; i < seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    pos.push(radius * Math.cos(t), radius * Math.sin(t), 0);
  }
  for (let i = 0; i < seg; i++) idx.push(0, i + 2, i + 1);
  return { pos: new Float32Array(pos), idx: new Uint16Array(idx), count: idx.length };
}

/** Expand a flat [lon,lat,...] coastline list into line segments on a sphere. */
export function coastLines(coast, radius = 1, step = 1) {
  const pos = [];
  const push = (lon, lat) => {
    const a = lon * Math.PI / 180, b = lat * Math.PI / 180;
    pos.push(radius * Math.cos(b) * Math.cos(a), radius * Math.cos(b) * Math.sin(a), radius * Math.sin(b));
  };
  for (const ringCoords of coast) {
    for (let i = 0; i + 3 < ringCoords.length; i += 2 * step) {
      push(ringCoords[i], ringCoords[i + 1]);
      push(ringCoords[i + 2], ringCoords[i + 3]);
    }
  }
  return { pos: new Float32Array(pos), count: pos.length / 3 };
}
