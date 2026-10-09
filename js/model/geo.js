// WGS84 geodesy: the conversions a receiver needs, with the real constants.
// All distances in kilometres, all angles in degrees at the boundary and radians inside.

import { WGS_A, WGS_F } from '../engine/vocab.js';

const DEG = Math.PI / 180;
const E2 = WGS_F * (2 - WGS_F);          // first eccentricity squared, WGS84

/** Geodetic (lat, lon, height above ellipsoid) -> ECEF kilometres. */
export function geodeticToEcef(latDeg, lonDeg, hKm = 0) {
  const lat = latDeg * DEG, lon = lonDeg * DEG;
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  const N = WGS_A / Math.sqrt(1 - E2 * sinLat * sinLat);   // prime vertical radius
  return [
    (N + hKm) * cosLat * Math.cos(lon),
    (N + hKm) * cosLat * Math.sin(lon),
    (N * (1 - E2) + hKm) * sinLat
  ];
}

/** ECEF kilometres -> geodetic. Bowring's closed-form + one Newton refinement. */
export function ecefToGeodetic(x, y, z) {
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  if (p < 1e-9) return { lat: 90 * Math.sign(z), lon: 0, h: Math.abs(z) - WGS_A * (1 - WGS_F) };
  const theta = Math.atan2(z * WGS_A, p * (WGS_A * (1 - WGS_F)));
  const st = Math.sin(theta), ct = Math.cos(theta);
  const ep2 = (WGS_A * WGS_A - (WGS_A * (1 - WGS_F)) ** 2) / ((WGS_A * (1 - WGS_F)) ** 2);
  const lat0 = Math.atan2(z + ep2 * (WGS_A * (1 - WGS_F)) * st ** 3,
                          p - E2 * WGS_A * ct ** 3);
  let lat = lat0;
  for (let i = 0; i < 3; i++) {
    const sl = Math.sin(lat);
    const N = WGS_A / Math.sqrt(1 - E2 * sl * sl);
    const h = p / Math.cos(lat) - N;
    lat = Math.atan2(z, p * (1 - E2 * N / (N + h)));
  }
  const sl = Math.sin(lat);
  const N = WGS_A / Math.sqrt(1 - E2 * sl * sl);
  const h = p / Math.cos(lat) - N;
  return { lat: lat / DEG, lon: lon / DEG, h };
}

/** Local East-North-Up basis at an observer position (ECEF km). */
export function enuBasis(obsKm) {
  const { lat, lon } = ecefToGeodetic(obsKm[0], obsKm[1], obsKm[2]);
  const la = lat * DEG, lo = lon * DEG;
  return {
    east: [-Math.sin(lo), Math.cos(lo), 0],
    north: [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)],
    up: [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]
  };
}

/** Vector from observer to target expressed in the local ENU frame. */
export function toEnu(obsKm, targetKm) {
  const b = enuBasis(obsKm);
  const d = [targetKm[0] - obsKm[0], targetKm[1] - obsKm[1], targetKm[2] - obsKm[2]];
  return [
    d[0] * b.east[0] + d[1] * b.east[1] + d[2] * b.east[2],
    d[0] * b.north[0] + d[1] * b.north[1] + d[2] * b.north[2],
    d[0] * b.up[0] + d[1] * b.up[1] + d[2] * b.up[2]
  ];
}

/** Elevation and azimuth of a target seen from an observer (degrees). */
export function elevationAzimuth(obsKm, targetKm) {
  const [e, n, u] = toEnu(obsKm, targetKm);
  const horiz = Math.hypot(e, n);
  return {
    el: Math.atan2(u, horiz) / DEG,
    az: (Math.atan2(e, n) / DEG + 360) % 360,
    rangeKm: Math.hypot(e, n, u)
  };
}

/** Geodetic position from ECEF, in world units (1 unit = 1000 km). */
export function ecefToWorld(p, scale = 1 / 1000) {
  return [p[0] * scale, p[1] * scale, p[2] * scale];
}

export function worldFromLatLon(latDeg, lonDeg, hKm = 0, scale = 1 / 1000) {
  return ecefToWorld(geodeticToEcef(latDeg, lonDeg, hKm), scale);
}

export { WGS_A, WGS_F };
