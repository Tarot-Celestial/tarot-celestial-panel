const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

function compile(file, globals = {}, aliases = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, ...globals, require: name => aliases[name] || require(name) });
  return exports;
}
const math = compile('src/lib/leonaris-motion.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const bounds = { width: 800, height: 600, petWidth: 132, petHeight: 142 };

test('clamps all edges and rejects non-finite restored coordinates', () => {
  assert.deepEqual(plain(math.clampLeonaris({ x: -900, y: 9000 }, bounds)), { x: 8, y: 450 });
  assert.deepEqual(plain(math.clampLeonaris({ x: Infinity, y: NaN }, bounds)), { x: 660, y: 450 });
  for (const invalid of [null, {}, { x: NaN, y: 0 }, { x: .5, y: 4 }]) assert.equal(math.restoreLeonaris(invalid, bounds), null);
});

test('normalized coordinates survive resizing from desktop to a narrow phone', () => {
  const saved = math.normalizeLeonaris({ x: 660, y: 450 }, bounds);
  assert.deepEqual(plain(saved), { x: 1, y: 1 });
  assert.deepEqual(plain(math.restoreLeonaris(saved, { width: 320, height: 640, petWidth: 100, petHeight: 110 })), { x: 212, y: 522 });
});

function target(extra = {}) {
  const listeners = new Map();
  return { ...extra,
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    fire(type, event) { for (const listener of listeners.get(type) || []) listener(event); },
    count(type) { return type ? listeners.get(type)?.size || 0 : [...listeners.values()].reduce((n, items) => n + items.size, 0); },
  };
}
function mount(initial = {}) {
  const saved = new Map(), frames = new Map(), css = new Map(), captured = new Set();
  let nextFrame = 1, now = 1000, current, wakes = 0, renderer;
  const window = target({ innerWidth: 800, innerHeight: 600, matchMedia: () => ({ matches: true }) });
  const document = { documentElement: target() };
  const node = { offsetWidth: 132, offsetHeight: 142,
    style: { setProperty: (key, value) => css.set(key, value) },
    getBoundingClientRect: () => ({ left: current?.position?.x ?? 644, top: current?.position?.y ?? 446, width: node.offsetWidth, height: node.offsetHeight }),
  };
  const button = { setPointerCapture: id => captured.add(id), hasPointerCapture: id => captured.has(id), releasePointerCapture: id => captured.delete(id) };
  const hook = compile('src/components/cliente/useLeonarisMotion.ts', {
    window, document, performance: { now: () => now },
    localStorage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) },
    requestAnimationFrame: callback => { const id = nextFrame++; frames.set(id, callback); return id; }, cancelAnimationFrame: id => frames.delete(id),
  }, { '@/lib/leonaris-motion': math }).useLeonarisMotion;
  let options = { uid: 'first', enabled: true, motion: true, visible: true, journey: false, onWake: () => wakes++, ...initial };
  function Probe() { current = hook(options); return React.createElement('div', { ref: current.companionRef }); }
  act(() => { renderer = create(React.createElement(Probe), { createNodeMock: () => node }); });
  return { window, document, saved, frames, css, node, captured,
    get current() { return current; }, get wakes() { return wakes; },
    tick(ms = 0) { now += ms; act(() => { const queued = [...frames.values()]; frames.clear(); queued.forEach(callback => callback()); }); },
    pointer(type, x, y) { act(() => current.characterHandlers[type]({ isPrimary: true, pointerId: 1, pointerType: 'mouse', button: 0, currentTarget: button, clientX: x, clientY: y, preventDefault() {} })); },
    update(next) { options = { ...options, ...next }; act(() => renderer.update(React.createElement(Probe))); },
    key(key) { act(() => current.characterHandlers.onKeyDown({ key, preventDefault() {} })); },
    close() { act(() => renderer.unmount()); },
  };
}

test('a short press stays a click; a real drag clamps, saves and suppresses its click', () => {
  const pet = mount();
  pet.pointer('onPointerDown', 670, 475); pet.pointer('onPointerMove', 673, 476); pet.pointer('onPointerUp', 673, 476);
  assert.equal(pet.current.position, null); assert.equal(pet.current.consumeClick(), false);
  pet.pointer('onPointerDown', 670, 475); pet.pointer('onPointerMove', -200, -200); pet.tick(); pet.pointer('onPointerUp', -200, -200);
  assert.deepEqual(plain(pet.current.position), { x: 8, y: 8 }); assert.equal(pet.current.consumeClick(), true);
  assert.equal(pet.captured.size, 0); assert.equal(pet.wakes, 1); assert.deepEqual(JSON.parse(pet.saved.get('tc-leonaris-position-v1:first')), { x: 0, y: 0 });
  pet.tick(700); assert.equal(pet.current.consumeClick(), false); pet.close();
});

test('account switching clears the previous placement; returning restores only that account', () => {
  const pet = mount();pet.key('ArrowLeft');const first = plain(pet.current.position);
  pet.update({ uid: 'second' });assert.equal(pet.current.position, null);
  pet.key('ArrowUp');assert.notDeepEqual(plain(pet.current.position), first);
  pet.update({ uid: 'first' });assert.deepEqual(plain(pet.current.position), first);pet.close();
});

test('tour movement never overwrites the saved resting position', () => {
  const pet = mount();pet.key('ArrowLeft');const position = plain(pet.current.position), saved = pet.saved.get('tc-leonaris-position-v1:first');
  pet.update({ journey: true });pet.pointer('onPointerDown', 650, 460);pet.pointer('onPointerMove', 20, 20);pet.tick();
  assert.equal(pet.current.dragging, false);assert.equal(pet.saved.get('tc-leonaris-position-v1:first'), saved);
  pet.update({ journey: false });assert.deepEqual(plain(pet.current.position), position);pet.close();
});

test('look uses event-driven frames and fully pauses for hidden or reduced-motion state', () => {
  const pet = mount();assert.equal(pet.frames.size, 0);
  act(() => pet.window.fire('pointermove', { pointerType: 'mouse', clientX: 550, clientY: 480, target: { closest: () => null } }));
  assert.equal(pet.frames.size, 1);pet.tick();assert.notEqual(pet.css.get('--leo-look-turn'), '0deg');assert.equal(pet.current.playful, true);
  assert.equal(pet.current.lookDirection, 'left');
  act(() => pet.window.fire('pointermove', { pointerType: 'mouse', clientX: 670, clientY: 480, target: { closest: () => null } }));pet.tick();assert.equal(pet.current.lookDirection, 'left');
  act(() => pet.window.fire('pointermove', { pointerType: 'mouse', clientX: 705, clientY: 480, target: { closest: () => null } }));pet.tick();assert.equal(pet.current.lookDirection, 'front');
  pet.update({ visible: false });assert.equal(pet.window.count('pointermove'), 0);assert.equal(pet.frames.size, 0);assert.equal(pet.css.get('--leo-look-turn'), '0deg');
  pet.update({ visible: true, motion: false });assert.equal(pet.window.count('pointermove'), 0);
  pet.close();assert.equal(pet.window.count(), 0);assert.equal(pet.document.documentElement.count(), 0);
});

test('viewport resize reprojects saved coordinates and Home returns to the default corner', () => {
  const pet = mount();pet.pointer('onPointerDown', 670, 475);pet.pointer('onPointerMove', 1200, 900);pet.pointer('onPointerUp', 1200, 900);
  pet.window.innerWidth = 320;pet.window.innerHeight = 640;pet.node.offsetWidth = 100;pet.node.offsetHeight = 110;
  act(() => pet.window.fire('resize'));
  assert.deepEqual(plain(pet.current.position), { x: 212, y: 522 });pet.key('Home');assert.equal(pet.current.position, null);assert.equal(pet.saved.size, 0);pet.close();
});
