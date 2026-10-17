const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

function load(globals = {}) {
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/rune-motion.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(output, { exports, console, ...globals });
  return exports;
}
const helper = load();

test('every new touch receives its full burst at the contact point while simultaneous particles remain capped', () => {
  for (const [mobile, perTouch, cap] of [[false,20,80],[true,10,40]]) {
    let particles = [];
    for (let n = 0; n < 20; n++) {
      particles = helper.addRuneBurst(particles, n * 2, n * 3, mobile, () => .5);
      assert.equal(particles.length, Math.min((n + 1) * perTouch, cap));
      assert.ok(particles.slice(-perTouch).every(p => p.x === n * 2 && p.y === n * 3));
    }
    assert.ok(particles.some(p => p.front) && particles.some(p => !p.front));
  }
});

test('float stays within 10px and 2 degrees with synchronized shadow and a double pulse every 3.5 seconds', () => {
  for (let t = 0; t <= 20; t += .01) {
    const frame = helper.runeFrame(t);
    assert.ok(Math.abs(frame.float) <= 10.00001);
    assert.ok(Math.abs(frame.rotate) <= 2.00001);
    assert.ok(frame.shadowOpacity >= .23 - .00001 && frame.shadowOpacity <= .37 + .00001);
  }
  const upper = helper.runeFrame(3.75), lower = helper.runeFrame(1.25);
  assert.ok(upper.shadowScale > lower.shadowScale);
  assert.ok(upper.shadowOpacity < lower.shadowOpacity);
  assert.ok(helper.runeFrame(.35).pulse > helper.runeFrame(.56).pulse);
  assert.ok(helper.runeFrame(.76).pulse > helper.runeFrame(.56).pulse);
  assert.ok(Math.abs(helper.runeFrame(.35).pulse - helper.runeFrame(3.85).pulse) < 1e-10);
});

function fixture({ width = 480, height = 540, reduced = false } = {}) {
  const callbacks = new Map(), listeners = new Map(), mediaListeners = new Set(), styles = new Map(), states = [];
  let nextId = 1, intersection, resizeObserver;
  const document = { hidden: false, addEventListener(name, callback) { listeners.set('document:' + name, callback); }, removeEventListener(name) { listeners.delete('document:' + name); } };
  const media = { matches: reduced, addEventListener(_name, cb) { mediaListeners.add(cb); }, removeEventListener(_name, cb) { mediaListeners.delete(cb); } };
  class IntersectionObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; intersection = this; }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  }
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; resizeObserver = this; }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  }
  const window = {
    devicePixelRatio: 3, IntersectionObserver, ResizeObserver, matchMedia: () => media,
    requestAnimationFrame(cb) { const id = nextId++; callbacks.set(id, cb); return id; },
    cancelAnimationFrame(id) { callbacks.delete(id); },
    addEventListener(name, cb) { listeners.set('window:' + name, cb); }, removeEventListener(name) { listeners.delete('window:' + name); },
  };
  const host = { dataset: {}, style: { setProperty: (key, value) => styles.set(key, value) }, getBoundingClientRect: () => ({ width, height }) };
  const context = () => {
    const counts = { clear: 0, transforms: [] };
    return { counts, clearRect() { counts.clear++; }, setTransform(...args) { counts.transforms.push(args); },
      beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo() {}, stroke() {} };
  };
  const backContext = context(), frontContext = context();
  const back = { width: 0, height: 0, getContext: () => backContext }, front = { width: 0, height: 0, getContext: () => frontContext };
  const engine = load({ window, document, IntersectionObserver, ResizeObserver }).createRuneMotion({ host, back, front, onState: value => states.push(value) });
  return {
    engine, host, back, front, states, styles, callbacks, backContext, listeners, mediaListeners,
    get observersDisconnected() { return intersection.disconnected && resizeObserver.disconnected; },
    intersect(visible) { intersection.callback([{ target: host, isIntersecting: visible }]); },
    visibility(hidden) { document.hidden = hidden; listeners.get('document:visibilitychange')?.(); },
    reduced(value) { media.matches = value; for (const cb of mediaListeners) cb(); },
    step(time) { const pending = [...callbacks.values()]; callbacks.clear(); for (const cb of pending) cb(time); },
  };
}

test('canvas DPR is bounded at 1.5 and drawing is limited to 45fps desktop or 30fps mobile', () => {
  for (const [width, interval] of [[480,23],[320,34]]) {
    const f = fixture({ width });
    assert.equal(f.back.width, width * 1.5);
    assert.equal(f.front.height, 810);
    assert.equal(f.callbacks.size, 0);
    f.intersect(true);
    const before = f.backContext.counts.clear;
    f.step(0); f.step(5); f.step(interval - 1);
    assert.equal(f.backContext.counts.clear, before + 1);
    f.step(interval);
    assert.equal(f.backContext.counts.clear, before + 2);
    assert.equal(f.callbacks.size, 1);
    f.engine.dispose();
  }
});

test('hidden, offscreen and manual pause stop rAF and do not stack loops on resume', () => {
  const f = fixture();
  f.intersect(true); assert.equal(f.callbacks.size, 1);
  f.visibility(true); assert.equal(f.callbacks.size, 0);
  f.visibility(false); assert.equal(f.callbacks.size, 1);
  f.intersect(false); assert.equal(f.callbacks.size, 0);
  f.intersect(true); f.intersect(true); assert.equal(f.callbacks.size, 1);
  f.engine.pause(true); assert.equal(f.callbacks.size, 0);
  f.visibility(true); f.visibility(false); assert.equal(f.callbacks.size, 0);
  f.engine.pause(false); assert.equal(f.callbacks.size, 1);
  f.engine.dispose();
  assert.equal(f.callbacks.size, 0);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.mediaListeners.size, 0);
  assert.equal(f.observersDisconnected, true);
  assert.equal(f.host.dataset.running, 'false');
  assert.equal(f.host.dataset.particleCount, '0');
  f.intersect(true); assert.equal(f.callbacks.size, 0);
});

test('the frame budget preserves 45/30fps on a 60Hz display rather than dropping to 30/20', () => {
  for (const [width, fps] of [[480,45],[320,30]]) {
    const f = fixture({ width }); f.intersect(true);
    const before = f.backContext.counts.clear;
    for (let frame = 0; frame <= 60; frame++) f.step(frame * 1000 / 60);
    assert.equal(f.backContext.counts.clear - before, fps + 1);
    f.engine.dispose();
  }
});

test('reduced motion starts no rAF and touch gives a static response without particles', () => {
  const f = fixture({ reduced: true });
  f.intersect(true);
  assert.equal(f.callbacks.size, 0);
  assert.equal(f.host.dataset.motion, 'reduced');
  assert.equal(f.styles.get('--rune-float'), '0px');
  f.engine.burst(90, 120);
  assert.equal(f.host.dataset.staticResponse, 'true');
  assert.equal(f.host.dataset.particleCount, '0');
  assert.equal(f.styles.get('--rune-hit-x'), '90px');
  f.engine.burst(90, 120);
  assert.equal(f.styles.get('--rune-hit-turn'), '-15deg');
  assert.equal(f.callbacks.size, 0);
  f.reduced(false); assert.equal(f.callbacks.size, 1);
  f.reduced(true); assert.equal(f.callbacks.size, 0);
  f.engine.dispose();
});

test('rapid repeated taps remain bounded, decay naturally, and pause preserves the scene', () => {
  for (const [width, cap] of [[480,80],[320,40]]) {
    const f = fixture({ width }); f.intersect(true);
    for (let n = 0; n < 100; n++) f.engine.burst(120, 180);
    assert.equal(Number(f.host.dataset.particleCount), cap);
    f.step(0); f.step(40);
    const float = f.styles.get('--rune-float');
    f.engine.pause(true); f.step(4000);
    assert.equal(f.styles.get('--rune-float'), float);
    f.engine.pause(false);
    for (let n = 0; n < 50; n++) f.step(5000 + n * 40);
    assert.equal(f.host.dataset.particleCount, '0');
    f.engine.dispose();
  }
});

test('hover target is bounded even for pointer positions outside the button', () => {
  const f = fixture(); f.intersect(true); f.engine.tilt(1000, -1000);
  for (let n = 0; n < 100; n++) f.step(n * 30);
  assert.ok(Math.abs(parseFloat(f.styles.get('--rune-tilt-x'))) <= 2);
  assert.ok(Math.abs(parseFloat(f.styles.get('--rune-tilt-y'))) <= 2);
  f.engine.dispose();
});
