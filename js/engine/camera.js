// Orbit camera. Owns yaw/pitch/distance around a target, with damping and
// pointer/keyboard input. Chapters only set properties; the stage calls update().

import { mat4, perspective, lookAt, V3 } from './mat4.js';

export function createCamera(opts = {}) {
  const cam = {
    target: opts.target ? [...opts.target] : [0, 0, 0],
    dist: opts.dist ?? 40,
    yaw: opts.yaw ?? 0.7,
    pitch: opts.pitch ?? 0.45,
    minDist: opts.minDist ?? 8,
    maxDist: opts.maxDist ?? 240,
    fov: (opts.fov ?? 42) * Math.PI / 180,
    near: opts.near ?? 0.35,
    far: opts.far ?? 4000,
    /* desired values (damped toward) */
    _target: opts.target ? [...opts.target] : [0, 0, 0],
    _dist: opts.dist ?? 40,
    _yaw: opts.yaw ?? 0.7,
    _pitch: opts.pitch ?? 0.45,
    damping: opts.damping ?? 0.16,
    view: mat4(),
    proj: mat4(),
    eye: [0, 0, 40]
  };

  cam.moveTo = function (target, dist, ms) {
    // ms is accepted so callers can name an intent; motion is damped, not timed.
    if (target) cam._target = [...target];
    if (typeof dist === 'number') cam._dist = dist;
    return ms;
  };

  cam.orbit = function (dyaw, dpitch) {
    cam._yaw += dyaw;
    cam._pitch = V3.clamp(cam._pitch + dpitch, -1.5, 1.5);
  };

  cam.zoom = function (factor) {
    cam._dist = V3.clamp(cam._dist * factor, cam.minDist, cam.maxDist);
  };

  cam.update = function (dt) {
    const k = 1 - Math.pow(1 - cam.damping, Math.max(dt, 0.001) * 60);
    for (let i = 0; i < 3; i++) cam.target[i] += (cam._target[i] - cam.target[i]) * k;
    cam.dist += (cam._dist - cam.dist) * k;
    cam.yaw += (cam._yaw - cam.yaw) * k;
    cam.pitch += (cam._pitch - cam.pitch) * k;
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    cam.eye = [
      cam.target[0] + cam.dist * cp * Math.cos(cam.yaw),
      cam.target[1] + cam.dist * cp * Math.sin(cam.yaw),
      cam.target[2] + cam.dist * sp
    ];
    lookAt(cam.view, cam.eye, cam.target, [0, 0, 1]);
    return cam;
  };

  cam.projection = function (aspect) {
    perspective(cam.proj, cam.fov, aspect, cam.near, cam.far);
    return cam.proj;
  };

  return cam;
}

/** Pointer + wheel + WASD/arrow input bound to a canvas. */
export function bindCamera(canvas, cam, hasFocus) {
  let drag = false, lastX = 0, lastY = 0;

  const down = (e) => { drag = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture?.(e.pointerId); };
  const up = (e) => { drag = false; canvas.releasePointerCapture?.(e.pointerId); };
  const move = (e) => {
    if (!drag) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    cam.orbit(-dx * 0.006, dy * 0.006);
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('wheel', (e) => {
    if (!hasFocus()) return;
    e.preventDefault();
    cam.zoom(1 + Math.sign(e.deltaY) * 0.08);
  }, { passive: false });

  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    if (!hasFocus()) return;
    keys.add(e.key.toLowerCase());
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(e.key.toLowerCase())) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  return function tickKeys(dt) {
    if (!keys.size) return;
    const speed = dt * 1.1;
    let yaw = 0, pitch = 0;
    if (keys.has('arrowleft') || keys.has('a')) yaw += speed;
    if (keys.has('arrowright') || keys.has('d')) yaw -= speed;
    if (keys.has('arrowup') || keys.has('w')) pitch += speed;
    if (keys.has('arrowdown') || keys.has('s')) pitch -= speed;
    if (yaw || pitch) cam.orbit(yaw, pitch * 0.6);
  };
}
