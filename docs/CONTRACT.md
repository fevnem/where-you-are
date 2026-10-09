# Chapter contract — *Where You Are* (an explorable explanation of GPS)

Read this whole file before writing anything. It is the frozen interface: the engine,
the maths and the page are already built and verified, and **eight chapters are written
in parallel against exactly this contract.** Do not change the engine, the UI, the CSS,
the maths modules or the tools. You add **one file**: `js/content/chNN.js`.

## What the thing is

A single static page. No dependencies, no build step, no external assets, no tracking.
One WebGL2 canvas holds a sticky sky (Earth, the 24-slot GPS constellation, range
spheres, guide lines) while the reader scrolls a column of prose. Each chapter becomes
"active" as it is read: it mounts its geometry, owns a few controls, and asks the reader
to commit to an answer at least once.

The maths is **real** — it is verified by `node tools/verify-math.mjs` (40 checks, all
passing): real orbital radius 26 560 km, real inclination 55°, real WGS84 ellipsoid, a
Gauss-Newton position solver that recovers a simulated receiver to a micrometre, real
DOP from the geometry matrix, real sphere/circle/point intersection geometry.

## The one hard rule about apostrophes

Inside a single-quoted JS string, a straight apostrophe ends the string and breaks the
module (this already bit us once). Use the typographic apostrophe `’` instead:

```js
title: 'Why can’t three satellites fix you?',   // right
title: 'Why can't three satellites fix you?',   // syntax error — never
```

Em dashes `—`, arrows `→` and `×` in prose are fine; the page is UTF-8.

## Your file's shape

```js
export const id = 'ch05';                       // must match the registry entry
export const title = 'Why four';                // short, lower-case-ish, no full stop
export const kicker = 'One unknown you cannot avoid';  // one line, may be omitted

export const prose = [
  'First paragraph. **Bold**, *italic*, `code`, $299,792.458$ km/s all work.',
  '> A quoted line — use sparingly, it is a full-size pull.',
  '## A small heading',
  '- a bullet',
  '1. a numbered step',
  '— a caption line, for a note about the picture'
];

export const controls = [ /* see below — at least one */ ];
export const checks = [ /* see below — at least one */ ];
export const view = { target: [0, 0, 0], dist: 78, yaw: 0.9, pitch: 0.42 };  // optional

export function createScene(ctx) {
  // build geometry, return { update(t, dt), onChange(params), dispose() }
}
```

`createScene` is called when the chapter becomes the one on screen, and the previous
chapter's actors are removed automatically. Return an object with:

* `update(t, dt)` — called every frame. Read live values from `ctx.params`.
* `onChange(params)` — optional, called when any control moves.
* `dispose()` — optional; you do **not** need to remove actors (see `ctx.own`).

## What `ctx` gives you

```js
ctx.stage        // the WebGL2 stage: .time, .dt, .actors(), .add(), .remove()
ctx.camera       // orbit camera: .moveTo(target, dist), ._yaw, ._pitch, ._dist
ctx.globe        // Earth: .setGrid(bool), .setCoast(bool), .setVisible(bool)
ctx.params       // live control values, e.g. ctx.params.clockError
ctx.helpers      // { geo, kepler, tri, vocab, P } — raw modules, same as below
ctx.geo, ctx.kepler, ctx.tri, ctx.vocab   // same modules, for convenience

// geometry factories — ALL of them already register themselves for disposal
ctx.constellation({ timeScale, trails, size }) // -> { markers, solids, ranges, trails[],
                                               //      update(t), setReceiver(km|null),
                                               //      positionsKm(), visibleFrom(km, minEl),
                                               //      rangesFrom(km), setTrails(bool),
                                               //      setTimeScale(k), setColor(c) }
ctx.spheres({ max })                           // -> { setSpheres([{center, radiusKm, color?}]),
                                               //      setCircles([{center, radiusKm, normal}]),
                                               //      setCandidates([{pos}]), setSolution(pos|null),
                                               //      clear() }
ctx.station(posKm, color)                      // a receiver marker
ctx.marker(posKm, color)                       // a plain marker
ctx.lines(positionsFlat, color, { mode, layer, visible })  // mode: 'lines'|'strip'|'loop'
ctx.points(positionsFlat, color, { size, layer })
ctx.ring(color, { visible })                   // a ring you place with .set(center, radiusKm, normal)
ctx.mesh(mesh, color, { lit, position, scale, instances, rim })
ctx.halo(radius, color, { power })
ctx.own(...actors)                             // register anything you made by hand
ctx.readout([{ key, label }])                  // a panel of live numbers: readout.set(key, value)
ctx.on(id, fn)                                 // subscribe to one control's changes
ctx.world([x, y, z])                           // km -> world units (also ctx.vocab.u(km))
```

**Units.** All maths is in **kilometres**. The scene is in world units where
**1 unit = 1000 km**, so `EARTH_R = 6.371` and a GPS orbit radius is `26.56`. Never
pass raw kilometres to `ctx.marker`/`ctx.station`/`ctx.lines`/`ctx.points` — convert
with `ctx.vocab.u(km)` or `ctx.world([x, y, z])`. `ctx.constellation`, `ctx.spheres`
and `ctx.ring` already do the conversion for you.

**Layers.** `'opaque'`, `'transparent'`, `'overlay'` (defaults are sensible). Range
spheres belong on `'transparent'`, guides and points on `'overlay'`.

## The maths you may rely on (all verified)

```js
// js/model/kepler.js
constellation(n = 24)                  // 6 planes × 4 slots, a = 26 560 km, i = 55°
satelliteEcef(sat, tSeconds, opts)     // -> [x, y, z] km, ECEF
orbitRing(sat, samples)                // one period of ECEF positions
period(aKm) / meanMotion(aKm)          // 43 082 s for 26 560 km

// js/model/geo.js  (WGS84)
geodeticToEcef(latDeg, lonDeg, hKm)    // -> [x, y, z] km
ecefToGeodetic(x, y, z)                // -> { lat, lon, h }
elevationAzimuth(obsKm, targetKm)      // -> { el, az, rangeKm } in degrees
toEnu(obsKm, targetKm)                 // -> [e, n, u]

// js/model/trilateration.js
rangeKm(a, b)                          // 3D distance
pseudoranges(sats, truePosKm, clockBiasKm, noiseKm)  // simulate a receiver
solvePosition(sats, rho, opts)         // -> { pos, biasKm, biasUs, residualKm, iterations,
                                       //      converged, history }  needs >= 4 satellites
sphereCircle(c1, r1, c2, r2)           // -> { center, radius, normal } | null
circleSpherePoints(circle, c3, r3, hint)  // -> [near, far] (two points, or [])
visibleSats(sats, obsKm, minElDeg)     // -> [{ i, el, az, rangeKm }] best first
dop(sats, obsKm)                       // -> { gdop, pdop, hdop, vdop, tdop }
usToKm(us) / kmToUs(km)                // 1 µs = 0.2998 km; 1 ms = 299.79 km
```

Verified facts you may quote in prose (all from `tools/verify-math.mjs`):
four satellites + a 1 ms clock error → the solver lands within a micrometre in 5
iterations; with 3 m of range noise and 8 satellites, typical error is ~4.5 m; a bunched
sky sends GDOP from 0.66 to hundreds.

## Controls

```js
export const controls = [
  { id: 'clockError', label: 'Receiver clock error', type: 'range',
    min: -2000, max: 2000, step: 10, value: 0, unit: 'µs',
    hint: 'how wrong the cheap clock in your pocket is',
    format: (v) => (v >= 0 ? '+' : '') + v + ' µs' },
  { id: 'showSpheres', label: 'Show range spheres', type: 'toggle', value: false },
  { id: 'mode', label: 'Which satellite', type: 'select', value: 'A',
    options: [{ value: 'A', label: 'Satellite A' }, { value: 'B', label: 'Satellite B' }] },
  { id: 'solve', label: 'Solve for my position', type: 'button' }
];
```

`ctx.params.<id>` always holds the current value. Every control must change something
visible: if a slider does not move geometry or a readout, delete it.

## Checks (`your turn`)

```js
export const checks = [
  {
    id: 'ch05-a',
    q: 'You have three satellites and no clock error. How many positions fit?',
    options: ['One', 'Two', 'A whole circle', 'None'],
    answer: 1,
    why: 'Three spheres meet in two points, mirror images across the plane of the three centres — which is exactly why the fourth satellite is not a luxury.'
  }
];
```

Requirements: at least one check **per chapter**; the options must be plausible, not
decorative; `why` must explain the *reason*, and may name the number that settles it. Use
the reader's own controls in the question where you can ("with the slider at …").

## Voice

Second person, concrete, quiet. No hype, no "simply/just/obviously/amazing", no
exclamation marks, no bullet-point listicles where a paragraph carries the argument.
Prefer a number the reader can check against the picture over an adjective. Teach by
making them *do* something, then say what they just did. British spelling.

## Your gate — non-negotiable

The server is already running on <http://127.0.0.1:8130> (start it yourself with
`python3 -m http.server 8130 --bind 127.0.0.1` from the repo root if it is not).

```bash
node --check js/content/chNN.js          # syntax
node tools/verify-page.mjs --only chNN    # real browser: renders, activates, mounts, no errors
```

Both must pass, and the verifier must end with `0 failed`. It writes
`docs/screens/ch-chNN.png` — look at the numbers it prints (actors mounted, solver
error) to be sure your chapter really put geometry on screen. If a failure names a
chapter that is not yours, note it and move on: another author is mid-write.

## Chapters, so nobody overlaps

| file | title | the ground it covers |
|---|---|---|
| ch01 | You are the receiver | *(written)* one-way messages, time→distance, why four is the minimum |
| ch02 | Distance from time | the conversion itself: µs → metres; a slider that turns clock error into range error |
| ch03 | One sphere, two spheres, a circle | one satellite = a sphere; two = a circle; drag a radius and watch the circle move |
| ch04 | Two points, and the wrong one | three spheres = two points; the mirror ambiguity; how a fourth (or the Earth's surface) picks one |
| ch05 | Why four | the receiver's clock is the fourth unknown; solve for it; three satellites leave a hyperbola of solutions |
| ch06 | The shape of the sky | 24 satellites, six planes; elevation, visibility, GDOP: drag satellites and watch precision collapse |
| ch07 | One frequency, everyone shouting | CDMA: all satellites transmit on the same frequency; gold codes and correlation as a picture |
| ch08 | Thirty-eight microseconds | relativity: clocks run fast by 38 µs/day → ~11 km/day of error; turn the correction off and watch the fix drift |
| ch09 | At your receiver | the real sky: ionosphere delay, multipath in a city, why your phone says ±5 m — and what it actually means |
