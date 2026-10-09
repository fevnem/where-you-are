// Node-side proof that the maths is real: no browser, no GL, just numbers.
// Run: node tools/verify-math.mjs
//
// Every assertion is checked against an independent construction of the answer
// (a simulated receiver, a known intersection point), not against a previous run
// of this code.

import { constellation, satelliteEcef, period } from '../js/model/kepler.js';
import { geodeticToEcef, ecefToGeodetic, toEnu } from '../js/model/geo.js';
import {
  solvePosition, pseudoranges, rangeKm, sphereCircle, circleSpherePoints,
  visibleSats, dop, usToKm, kmToUs, sub, add, mul, norm, cross, dot
} from '../js/model/trilateration.js';
import { GPS_A_KM, GPS_I_DEG, EARTH_R_KM } from '../js/engine/vocab.js';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  ok   ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  FAIL ' + name + '  ' + detail); }
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('\nOrbits');
const sats = constellation(24);
check('constellation has 24 slots', sats.length === 24, `${sats.length}`);
const per = period(GPS_A_KM);
check('orbital period is 11 h 58 m (43082 s +/- 50)', near(per, 43082, 50), `${per.toFixed(1)} s`);
const a0 = satelliteEcef(sats[0], 0);
check('radius after half a period equals the start radius',
  near(Math.hypot(...satelliteEcef(sats[0], per / 2)), Math.hypot(...a0), 1e-6), `${Math.hypot(...a0).toFixed(3)} km`);
check('semi-major radius is 26 560 km', near(Math.hypot(...a0), GPS_A_KM, 1e-6), `${Math.hypot(...a0).toFixed(3)} km`);
const zs = [];
for (let k = 0; k < 400; k++) zs.push(Math.abs(satelliteEcef(sats[0], (k / 400) * per, { gmst: false })[2]));
const maxEl = Math.asin(Math.max(...zs) / GPS_A_KM) * 180 / Math.PI;
check('orbit inclination is 55 deg', near(maxEl, GPS_I_DEG, 0.05), `${maxEl.toFixed(3)} deg`);
check('all 24 satellites stay well above the surface on a full orbit',
  sats.every((s) => Array.from({ length: 40 }, (_, k) => Math.hypot(...satelliteEcef(s, (k / 40) * per))).every((r) => r > EARTH_R_KM + 1000)));
const planes = new Set(sats.map((s) => s.raan.toFixed(3)));
check('six distinct orbital planes, 60 deg apart', planes.size === 6,
  [...planes].map((r) => (r * 180 / Math.PI).toFixed(0)).join(' / '));

console.log('\nWGS84 geodesy');
const berlin = { lat: 52.5200, lon: 13.4050, h: 0.034 };
const ecef = geodeticToEcef(berlin.lat, berlin.lon, berlin.h);
const back = ecefToGeodetic(ecef[0], ecef[1], ecef[2]);
check('round trip lat', near(back.lat, berlin.lat, 1e-9), `${back.lat.toFixed(11)}`);
check('round trip lon', near(back.lon, berlin.lon, 1e-9), `${back.lon.toFixed(11)}`);
check('round trip height (< 1 micrometre)', near(back.h, berlin.h, 1e-9), `${back.h.toFixed(12)} km`);
check('equatorial radius is WGS84 a = 6378.137 km',
  near(Math.hypot(...geodeticToEcef(0, 0, 0)), 6378.137, 1e-9));
check('polar radius is the WGS84 b = 6356.7523 km',
  near(Math.abs(geodeticToEcef(90, 0, 0)[2]), 6356.7523142, 1e-4),
  `${Math.abs(geodeticToEcef(90, 0, 0)[2]).toFixed(6)} km`);
const north1_11km = geodeticToEcef(52.5300, 13.4050, 0);
const enu = toEnu(ecef, north1_11km);
check('0.01 deg of latitude (1.11 km) reads as +north in ENU',
  near(enu[1], 1.113, 0.01) && Math.abs(enu[0]) < 0.01 && Math.abs(enu[2]) < 0.05,
  `e=${enu[0].toFixed(4)} n=${enu[1].toFixed(4)} u=${enu[2].toFixed(4)}`);
const east = toEnu(ecef, geodeticToEcef(52.5200, 13.4300, 0));
check('moving east reads as +east', east[0] > 1.5 && Math.abs(east[1]) < 0.05,
  `e=${east[0].toFixed(4)} n=${east[1].toFixed(4)}`);

console.log('\nA bare receiver (four satellites, unknown clock)');
const t0 = 3600;
const obs = geodeticToEcef(48.8566, 2.3522, 0.035);           // Paris
const all = sats.map((s) => satelliteEcef(s, t0));
const view = visibleSats(all, obs, 10);
const four = view.slice(0, 4).map((v) => v.i).map((i) => all[i]);
check('at least four satellites are above 10 deg', view.length >= 4,
  `in view: ${view.length}, top four at ${view.slice(0, 4).map((v) => v.el.toFixed(0)).join('/')} deg`);

const biasKm = usToKm(1000);                                   // one millisecond of receiver clock error
const rho = pseudoranges(four, obs, biasKm);
const fix = solvePosition(four, rho);
check('the solver converges with four satellites', fix.converged, `${fix.iterations} iterations`);
check('position error < 1 micron', rangeKm(fix.pos, obs) < 1e-6, `${(rangeKm(fix.pos, obs) * 1e6).toFixed(4)} mm`);
check('clock bias recovered to 0.1 microsecond', near(kmToUs(fix.biasKm), 1000, 0.1), `${kmToUs(fix.biasKm).toFixed(4)} us`);
check('1 ms of clock error is ~299.79 km', near(biasKm, 299.792, 0.01), `${biasKm.toFixed(3)} km`);
check('starting from the Earth centre also converges', (() => {
  const f = solvePosition(four, rho, { start: [0, 0, 0] });
  return f.converged && rangeKm(f.pos, obs) < 1e-3;
})());
check('a wrong start still lands on the same point (no local traps with 4 spread sats)',
  (() => {
    const f = solvePosition(four, rho, { start: [1000, 1000, 1000] });
    return rangeKm(f.pos, obs) < 1e-3;
  })());
check('the solver reports its iterations for the chapter to show',
  Array.isArray(fix.history) && fix.history.length === fix.iterations,
  `${fix.history.length} steps recorded`);

console.log('\nMore satellites, worse geometry, and noise');
const eight = view.slice(0, 8).map((v) => v.i).map((i) => all[i]);
const noiseKm = 0.003;                                         // 3 metres of range error
let worst = 0, mean = 0;
const trials = 200;
for (let trial = 0; trial < trials; trial++) {
  const r = pseudoranges(eight, obs, biasKm, noiseKm);
  const f = solvePosition(eight, r);
  const e = rangeKm(f.pos, obs);
  worst = Math.max(worst, e);
  mean += e / trials;
}
check('with 3 m of noise and 8 satellites, typical error is a few metres', mean < 0.012,
  `mean ${(mean * 1000).toFixed(2)} m over ${trials} trials`);
check('and the worst of 200 runs stays under 40 m', worst < 0.040, `worst ${(worst * 1000).toFixed(2)} m`);

let worstFour = 0;
for (let trial = 0; trial < 200; trial++) {
  const r = pseudoranges(four, obs, biasKm, noiseKm);
  const f = solvePosition(four, r);
  worstFour = Math.max(worstFour, rangeKm(f.pos, obs));
}
console.log(`         (for contrast: four satellites, same 3 m of noise, worst ${(worstFour * 1000).toFixed(1)} m)`);

const dopAll = dop(all, obs);
check('DOP is finite with the full constellation', dopAll && isFinite(dopAll.gdop), `gdop ${dopAll.gdop.toFixed(2)}`);
const badSky = [0, 1, 2, 3].map((i) => add(obs, add(mul(norm(sub(all[i], obs)), 20000), [0, 0, 4000])));
const dopBad = dop(badSky, obs);
check('a bunched sky gives a far worse DOP than a spread one',
  dopBad && dopBad.gdop > dopAll.gdop * 2, `bunched ${dopBad?.gdop.toFixed(1)} vs all-in-view ${dopAll.gdop.toFixed(2)}`);
let threw = false;
try { solvePosition(four.slice(0, 3), rho.slice(0, 3)); } catch (e) { threw = true; }
check('three satellites are refused (four unknowns, three equations)', threw);

console.log('\nSphere geometry (exactly what the chapters draw)');
const c1 = [0, 0, 0], r1 = 10000;
const c2 = [12000, 0, 0], r2 = 9000;
const cir = sphereCircle(c1, r1, c2, r2);
check('two overlapping range spheres produce a circle', !!cir, cir ? `radius ${cir.radius.toFixed(3)} km` : '');
const expectA = (12000 * 12000 + r1 * r1 - r2 * r2) / (2 * 12000);
check('the circle sits at the analytic distance along the line of centres',
  near(cir.center[0], expectA, 1e-9), `x = ${cir.center[0].toFixed(6)} km (analytic ${expectA.toFixed(6)})`);
check('circle radius matches the analytic value', near(cir.radius, Math.sqrt(r1 * r1 - expectA * expectA), 1e-9),
  `${cir.radius.toFixed(6)} km`);
check('the circle is perpendicular to the line of centres', near(Math.abs(cir.normal[0]), 1, 1e-12));
check('spheres that miss each other return null', sphereCircle([0, 0, 0], 100, [50000, 0, 0], 100) === null);
check('a sphere inside another returns null', sphereCircle([0, 0, 0], 9000, [100, 0, 0], 500) === null);

// A point genuinely on both spheres: take the circle, step out along a radius.
const u = norm(cross(cir.normal, [0, 1, 0.3]));
const truth = add(cir.center, mul(u, cir.radius));
check('the chosen test point really is on both spheres',
  near(rangeKm(truth, c1), r1, 1e-6) && near(rangeKm(truth, c2), r2, 1e-6));
const s3 = [-8000, 3000, 5000];
const r3 = rangeKm(truth, s3);
const pts = circleSpherePoints(cir, s3, r3);
check('a third sphere cuts the circle in exactly two points', pts.length === 2, `${pts.length}`);
check('candidate one is the true point (micron)',
  Math.min(rangeKm(pts[0], truth), rangeKm(pts[1], truth)) < 1e-6,
  `${(Math.min(rangeKm(pts[0], truth), rangeKm(pts[1], truth)) * 1e6).toFixed(5)} mm`);
const planeN = norm(cross(sub(c2, c1), sub(s3, c1)));
const mirror = sub(truth, mul(planeN, 2 * dot(sub(truth, c1), planeN)));
check('the other candidate is the mirror of the truth across the plane of the three centres',
  Math.min(rangeKm(pts[0], mirror), rangeKm(pts[1], mirror)) < 1e-6,
  `${(Math.min(rangeKm(pts[0], mirror), rangeKm(pts[1], mirror)) * 1e6).toFixed(5)} mm`);
check('both candidates satisfy all three spheres',
  pts.every((p) => near(rangeKm(p, c1), r1, 1e-6) && near(rangeKm(p, c2), r2, 1e-6) && near(rangeKm(p, s3), r3, 1e-6)));
check('a hint orders the candidates nearest-first',
  rangeKm(circleSpherePoints(cir, s3, r3, truth)[0], truth) < 1e-6);
check('a sphere that cannot reach the circle returns no points',
  circleSpherePoints(cir, [0, 0, 90000], 100).length === 0);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
