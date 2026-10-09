#!/usr/bin/env node
// Page verifier: drives the local Chromium over raw CDP (Node's built-in WebSocket,
// no dependencies) and checks that the explainer really renders — canvas non-blank,
// chapters activate, controls move the numbers, checks work, no console errors and
// no horizontal overflow. Writes docs/screens/*.png as a side effect.
//
//   node tools/verify-page.mjs                 # full run
//   node tools/verify-page.mjs --url … --out …
//
// Exits non-zero if anything fails.

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i === -1 ? dflt : args[i + 1]; };

const URL_BASE = opt('url', 'http://127.0.0.1:8130/index.html');
const OUT = opt('out', 'docs/screens');
const WIDTH = parseInt(opt('width', '1440'), 10);
const HEIGHT = parseInt(opt('height', '900'), 10);
const ONLY = opt('only', null);        // e.g. --only ch05 : gate a single chapter

const CHROME = [
  path.join(homedir(), '.cache/ms-playwright/chromium-1148/chrome-linux/chrome'),
  path.join(homedir(), '.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell'),
  '/usr/bin/chromium', '/usr/bin/google-chrome'
].find((p) => existsSync(p));
if (!CHROME) { console.error('no chromium found'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9401 + (process.pid % 180);

const child = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--use-gl=angle',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--disable-dev-shm-usage', '--hide-scrollbars', '--force-color-profile=srgb',
  '--mute-audio', '--remote-debugging-port=' + PORT,
  '--window-size=' + WIDTH + ',' + HEIGHT, 'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });

let stderr = '';
child.stderr.on('data', (d) => { stderr += d.toString(); });

async function target() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('chromium never exposed a page target\n' + stderr.slice(-600));
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.logs = []; }
  static async open(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
    const cdp = new CDP(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && cdp.pending.has(msg.id)) {
        const { resolve, reject } = cdp.pending.get(msg.id);
        cdp.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        cdp.logs.push({ level: msg.params.type, text: (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ') });
      } else if (msg.method === 'Runtime.exceptionThrown') {
        cdp.logs.push({ level: 'exception', text: msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text });
      }
    };
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    return cdp;
  }
  send(method, params = {}, timeoutMs = 60000) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(method + ' timed out')); } }, timeoutMs);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, 120000);
    if (r.exceptionDetails) throw new Error('eval threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async goto(url, ready) {
    await this.send('Page.navigate', { url });
    for (let i = 0; i < 60; i++) {
      await sleep(200);
      const ok = await this.eval(ready).catch(() => false);
      if (ok) return true;
    }
    return false;
  }
  async viewport(w, h) {
    await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  }
  // The scene got heavy enough (satellite bodies, ground tracks, city lights, a
  // sky-plot canvas) that the software rasteriser can take a long time to hand
  // back a composited frame. A screenshot is evidence, not a gate: retry it, and
  // never let it kill the run.
  async shot(file, attempts = 3) {
    for (let i = 1; i <= attempts; i++) {
      try {
        const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, optimizeForSpeed: true }, 180000);
        await writeFile(file, Buffer.from(r.data, 'base64'));
        return file;
      } catch (err) {
        if (i === attempts) {
          warned.push('screenshot failed for ' + file + ': ' + err.message);
          console.log('  !    screenshot skipped — ' + file + ' (' + err.message + ')');
          return null;
        }
        await sleep(2000);
      }
    }
  }
}

const warned = [];
let pass = 0;
const problems = [];
const check = (label, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + label + (extra ? '  ' + extra : '')); }
  else { console.log('  FAIL ' + label + (extra ? '  ' + extra : '')); problems.push(label); }
};

await mkdir(OUT, { recursive: true });
const cdp = await CDP.open(await target());
await cdp.viewport(WIDTH, HEIGHT);

console.log('\n  driving ' + URL_BASE);
const loaded = await cdp.goto(URL_BASE, '!!window.APP && window.APP.chapters && window.APP.chapters.length > 0');
check('page boots and loads at least one chapter', loaded);
if (!loaded) {
  const early = cdp.logs.filter((l) => l.level === 'exception' || l.level === 'error' || l.level === 'warning');
  console.log('\n  page never reached a usable state. Console said:\n' +
    (early.length ? early.map((l) => '    [' + l.level + '] ' + l.text).join('\n') : '    (nothing)') + '\n');
  child.kill('SIGTERM');
  process.exit(1);
}
await sleep(600);

const info = await cdp.eval(`(() => {
  const a = window.APP;
  return {
    chapters: a.chapters.map(c => c.id),
    hasScene: !!a.state.scene,
    active: a.state.active,
    sections: document.querySelectorAll('section.chapter').length,
    rail: document.querySelectorAll('.rail-item').length,
    checks: document.querySelectorAll('.check').length,
    controls: document.querySelectorAll('.control').length,
    gl: (() => { const c = document.getElementById('gl'); const g = c.getContext('webgl2'); return g ? [c.width, c.height] : null; })()
  };
})()`);
check('a WebGL2 context was created at real size', !!info.gl && info.gl[0] > 100 && info.gl[1] > 100,
  info.gl ? info.gl.join('x') : 'no context');
check('every chapter module built a section', info.sections === info.chapters.length,
  `${info.sections} sections / ${info.chapters.length} chapters`);
check('the rail lists every chapter', info.rail === info.chapters.length, `${info.rail}`);
check('chapters declare interactive controls', info.controls > 0, `${info.controls} controls`);
check('chapters declare your-turn checks', info.checks > 0, `${info.checks} checks`);
check('a chapter is active on load', !!info.active, info.active);

// --- each chapter must carry enough to actually teach ---
const substance = await cdp.eval(`window.APP.chapters.map(c => ({
  id: c.id,
  prose: (c.prose || []).length,
  controls: (c.controls || []).length,
  checks: (c.checks || []).length,
  scene: typeof c.createScene === 'function',
  title: !!c.title
}))`);
const thin = substance.filter((s) => s.prose < 4 || s.controls < 1 || s.checks < 1 || !s.scene || !s.title);
check('every chapter carries prose, a control, a check and a scene', thin.length === 0,
  thin.map((s) => `${s.id}(prose ${s.prose}, controls ${s.controls}, checks ${s.checks}, scene ${s.scene})`).join(' ') || 'all ok');

if (ONLY) {
  const target = substance.find((s) => s.id === ONLY);
  check(`${ONLY} is present and loaded`, !!target, target ? 'loaded' : `${ONLY} did not load`);
  if (!target) { child.kill('SIGTERM'); process.exit(1); }
}

// --- the canvas actually draws something (draw + read back in the same task) ---
const pixels = await cdp.eval(`(() => {
  const a = window.APP;
  const c = document.getElementById('gl');
  const gl = c.getContext('webgl2');
  a.stage.draw();
  const n = 96;
  const px = new Uint8Array(n * n * 4);
  gl.readPixels(Math.floor(c.width/2 - n/2), Math.floor(c.height/2 - n/2), n, n, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let min = 255, max = 0, sum = 0;
  for (let i = 0; i < px.length; i += 4) {
    const v = (px[i] + px[i+1] + px[i+2]) / 3;
    min = Math.min(min, v); max = Math.max(max, v); sum += v;
  }
  return { min, max, mean: sum / (px.length / 4) };
})()`);
check('the sky is not a blank frame (pixel spread in the centre)', pixels.max - pixels.min > 12,
  `min ${pixels.min.toFixed(0)} max ${pixels.max.toFixed(0)} mean ${pixels.mean.toFixed(1)}`);

// --- the shipped maths module works in the browser, not just in node ---
const mathInBrowser = await cdp.eval(`(async () => {
  const tri = await import('./js/model/trilateration.js');
  const geo = await import('./js/model/geo.js');
  const kep = await import('./js/model/kepler.js');
  const sats = kep.constellation(24);
  const obs = geo.geodeticToEcef(48.8566, 2.3522, 0.035);
  const all = sats.map(s => kep.satelliteEcef(s, 3600));
  const view = tri.visibleSats(all, obs, 10).slice(0, 6).map(v => all[v.i]);
  const rho = tri.pseudoranges(view, obs, tri.usToKm(1000), 0.003);
  const fix = tri.solvePosition(view, rho);
  return { errM: tri.rangeKm(fix.pos, obs) * 1000, iters: fix.iterations, converged: fix.converged };
})()`);
check('the browser build of the solver recovers a known position', mathInBrowser.converged && mathInBrowser.errM < 40,
  `${mathInBrowser.errM.toFixed(2)} m in ${mathInBrowser.iters} iterations`);

// --- chapters activate on scroll and mount their scene ---
const activated = await cdp.eval(`(async () => {
  const a = window.APP;
  const out = [];
  // The page uses scroll-behavior: smooth, so scrollIntoView() animates. Reading
  // state.active on a fixed timer therefore races the animation (this made the
  // harness flaky ~1 run in 4). Scroll instantly and wait for scrollY to settle.
  const settle = async () => {
    let last = -1;
    for (let i = 0; i < 60; i++) {
      const y = window.scrollY;
      if (y === last) return true;
      last = y;
      await new Promise(r => setTimeout(r, 40));
    }
    return false;
  };
  for (const ch of a.chapters) {
    const el = document.getElementById(ch.id);
    el.scrollIntoView({ block: 'start', behavior: 'instant' });
    await settle();
    a.pickActive();
    await new Promise(r => setTimeout(r, 90));
    out.push({ id: ch.id, active: a.state.active, scene: !!a.state.scene, actors: a.stage.actors().opaque.length + a.stage.actors().transparent.length + a.stage.actors().overlay.length });
  }
  return out;
})()`);
check('every chapter can become the active one', activated.every((r) => r.active === r.id),
  activated.filter((r) => r.active !== r.id).map((r) => r.id).join(',') || 'all ok');
check('every chapter mounts geometry and disposes the previous one',
  activated.every((r) => r.scene && r.actors > 3),
  activated.map((r) => r.id + ':' + r.actors).join(' '));

if (ONLY) {
  const one = activated.find((r) => r.id === ONLY);
  check(`${ONLY} mounts its own geometry`, !!one && one.scene && one.actors > 3, one ? one.actors + ' actors' : 'missing');
  await cdp.viewport(WIDTH, HEIGHT);
  await cdp.eval(`document.getElementById('${ONLY}').scrollIntoView({ block: 'start', behavior: 'instant' }); window.APP.pickActive();`);
  await sleep(900);
  await cdp.shot(path.join(OUT, 'ch-' + ONLY + '.png'));
  console.log('  shot ' + path.join(OUT, 'ch-' + ONLY + '.png'));
}

// --- controls move the numbers ---
const controlRun = await cdp.eval(`(async () => {
  const a = window.APP;
  const settle = async () => { let last = -1; for (let i = 0; i < 60; i++) { const y = window.scrollY; if (y === last) return; last = y; await new Promise(r => setTimeout(r, 40)); } };
  const ch = a.chapters.find(c => (c.controls || []).some(x => x.type === 'range'));
  document.getElementById(ch.id).scrollIntoView({ block: 'start', behavior: 'instant' });
  await settle();
  // make sure the chapter we are about to drive really is the active one
  for (let i = 0; i < 5 && a.state.active !== ch.id; i++) { a.pickActive(); await new Promise(r => setTimeout(r, 80)); }
  const spec = ch.controls.find(x => x.type === 'range');
  const input = document.querySelector('[data-control="' + spec.id + '"] input');
  const before = a.state.ctx.params[spec.id];
  input.value = String(Number(spec.max));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 120));
  return { chapter: ch.id, active: a.state.active, id: spec.id, before, after: a.state.ctx.params[spec.id], readout: document.querySelector('[data-control="' + spec.id + '"] .control-value').textContent };
})()`);
check('the control test drives the chapter it meant to', controlRun.active === controlRun.chapter,
  `active ${controlRun.active}, drove ${controlRun.chapter}`);
check('a control writes through to the scene parameters',
  controlRun.after !== controlRun.before, `${controlRun.id}: ${controlRun.before} -> ${controlRun.after}`);
check('and updates its readout', !!controlRun.readout, controlRun.readout);

// --- your-turn check answers ---
const checkRun = await cdp.eval(`(async () => {
  const first = document.querySelector('.check');
  const opt = first.querySelector('.option');
  opt.click();
  await new Promise(r => setTimeout(r, 60));
  const why = first.querySelector('.check-why');
  return { answered: first.classList.contains('is-answered'), visible: !why.hidden, text: why.textContent.slice(0, 48), disabled: opt.disabled };
})()`);
check('a check locks in the choice and explains it', checkRun.answered && checkRun.visible && checkRun.disabled,
  '"' + checkRun.text + '…"');

// --- overflow at three widths ---
for (const [w, h, label] of [[1440, 900, 'desktop'], [900, 820, 'tablet'], [390, 780, 'phone']]) {
  await cdp.viewport(w, h);
  await sleep(420);
  const over = await cdp.eval(`(() => {
    const doc = document.documentElement;
    const wide = [...document.querySelectorAll('#story, .prose, .controls-holder, .checks-holder, section.chapter')]
      .filter(e => e.getBoundingClientRect().right > doc.clientWidth + 2).map(e => e.className || e.tagName);
    return { scrollW: doc.scrollWidth, clientW: doc.clientWidth, wide };
  })()`);
  check(`no horizontal overflow at ${label} (${w}px)`, over.scrollW <= over.clientW + 2,
    `${over.scrollW} <= ${over.clientW}` + (over.wide.length ? ' offenders: ' + over.wide.join(',') : ''));
}

// --- screenshots for the repo ---
await cdp.viewport(1440, 900);
await cdp.eval(`window.scrollTo({ top: 0, behavior: 'instant' }); document.getElementById('masthead').scrollIntoView({ block: 'start', behavior: 'instant' });`);
await sleep(900);
await cdp.shot(path.join(OUT, '01-title.png'));
await cdp.eval(`document.getElementById(window.APP.chapters[0].id).scrollIntoView({ block: 'start', behavior: 'instant' });`);
await sleep(900);
await cdp.shot(path.join(OUT, '02-chapter.png'));
const mid = await cdp.eval(`window.APP.chapters[Math.min(3, window.APP.chapters.length - 1)].id`);
await cdp.eval(`document.getElementById('${mid}').scrollIntoView({ block: 'start', behavior: 'instant' });`);
await sleep(900);
await cdp.shot(path.join(OUT, '03-chapter-' + mid + '.png'));
await cdp.viewport(390, 780);
await cdp.eval(`window.scrollTo({ top: 0, behavior: 'instant' }); document.getElementById('masthead').scrollIntoView({ block: 'start', behavior: 'instant' });`);
await sleep(700);
await cdp.shot(path.join(OUT, '04-phone.png'));
console.log('  shots written to ' + OUT);

// --- console noise ---
const noise = cdp.logs.filter((l) => l.level === 'exception' || l.level === 'error');
check('no uncaught page errors', noise.length === 0, noise.map((n) => n.text).join(' | ').slice(0, 400));
const warns = cdp.logs.filter((l) => l.level === 'warning').map((l) => l.text);
if (warns.length) console.log('         (warnings: ' + warns.slice(0, 3).join(' | ').slice(0, 200) + ')');

console.log(`\n  ${pass} checks passed, ${problems.length} failed`);
console.log('  ' + (problems.length ? 'FAILED: ' + problems.join('; ') : 'all page checks passed') + '\n');

child.kill('SIGTERM');
process.exit(problems.length ? 1 : 0);
