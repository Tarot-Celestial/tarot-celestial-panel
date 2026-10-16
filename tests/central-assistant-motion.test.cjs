const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), { act, create } = require('react-test-renderer');
const directory = path.join(__dirname, '../src/features/central/assistant');
function transpile(name) { return ts.transpileModule(fs.readFileSync(path.join(directory, name), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText; }
const helpers = {};
vm.runInNewContext(transpile('companion-motion.ts'), { exports: helpers });

test('motion bounds allow all screen edges, reject invalid coordinates, and handle resize', () => {
  assert.deepEqual({ ...helpers.clampCompanionPosition(-10, -80, 1280, 800) }, { x: 8, y: 8 });
  assert.deepEqual({ ...helpers.clampCompanionPosition(1800, 1200, 390, 844) }, { x: 246, y: 662 });
  assert.deepEqual({ ...helpers.clampCompanionPosition(NaN, Infinity, 320, 480) }, { x: 176, y: 298 });
  assert.deepEqual({ ...helpers.clampCompanionPosition(100, 100, 120, 120) }, { x: 8, y: 8 });
});

test('saved placement is scoped per worker and rejects corrupt storage', () => {
  assert.equal(helpers.positionStorageKey(null), null);
  assert.notEqual(helpers.positionStorageKey('worker-a'), helpers.positionStorageKey('worker-b'));
  for (const value of ['null', '[]', '{"x":"22","y":44}', '{"x":1e999,"y":4}', 'broken', '']) assert.equal(helpers.parseSavedPosition(value), null);
  assert.deepEqual({ ...helpers.parseSavedPosition('{"x":22,"y":44}') }, { x: 22, y: 44 });
});

function mount({ enabled = true, busy = false, workerId = 'a', saved = {} } = {}) {
  const storage = new Map(Object.entries(saved)), windowEvents = {}, documentEvents = {}, frames = new Map(); let nextFrame = 0, hook;
  const style = { setProperty(name, value) { this[name] = value; } };
  const traveller = { offsetWidth: 136, offsetHeight: 174, style, querySelector() { return null; } };
  const button = { captured: null, setPointerCapture(id) { this.captured = id; }, hasPointerCapture(id) { return this.captured === id; }, releasePointerCapture(id) { if (this.captured === id) this.captured = null; } };
  const window = { innerWidth: 1280, innerHeight: 800, localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) }, addEventListener: (name, callback) => windowEvents[name] = callback, removeEventListener: name => delete windowEvents[name] };
  const document = { hidden: false, querySelectorAll: () => [], addEventListener: (name, callback) => documentEvents[name] = callback, removeEventListener: name => delete documentEvents[name] };
  const exportsHook = {};
  vm.runInNewContext(transpile('useCompanionMotion.ts'), { exports: exportsHook, require: name => name === 'react' ? React : helpers, window, document, requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; }, cancelAnimationFrame: id => frames.delete(id), Date, Math });
  function Harness(props) { hook = exportsHook.useCompanionMotion(props.enabled, props.busy, props.workerId); return React.createElement('div', { ref: hook.ref }); }
  let renderer;
  act(() => { renderer = create(React.createElement(Harness, { enabled, busy, workerId }), { createNodeMock: () => traveller }); });
  const event = (x, y, id = 1) => ({ button: 0, isPrimary: true, pointerId: id, clientX: x, clientY: y, currentTarget: button, preventDefault() {}, stopPropagation() {} });
  return { window, document, storage, button, style, windowEvents, documentEvents, event,
    get pendingFrames() { return frames.size; },
    get hook() { return hook; },
    run(name, value) { act(() => hook.dragProps[name](value)); },
    update(props) { act(() => renderer.update(React.createElement(Harness, { enabled, busy, workerId, ...props }))); },
    frame(time) { act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(time)); }); },
    dispose() { act(() => renderer.unmount()); assert.equal(frames.size, 0); }
  };
}

test('drag captures the pointer, clamps to the viewport, persists, and suppresses only the drag click', () => {
  const m = mount();
  try {
    m.run('onPointerDown', m.event(1160, 630)); assert.equal(m.button.captured, 1);
    m.run('onPointerMove', m.event(0, 0)); assert.equal(m.hook.dragging, true); assert.match(m.style.transform, /8\.00px,8\.00px/);
    m.run('onPointerUp', m.event(0, 0)); assert.equal(m.hook.dragging, false); assert.equal(m.button.captured, null);
    assert.deepEqual(JSON.parse(m.storage.get(helpers.positionStorageKey('a'))), { x: 8, y: 8 });
    let prevented = false, stopped = false;
    m.run('onClickCapture', { preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
    assert.equal(prevented, true); assert.equal(stopped, true);
    const anchor = { isConnected: true, getBoundingClientRect: () => ({ left: 400, right: 450, top: 300, bottom: 340, width: 50, height: 40 }) };
    act(() => assert.equal(m.hook.point(anchor), false));
    m.update({ busy: true }); m.frame(50); assert.match(m.style.transform, /8\.00px,8\.00px/);
    prevented = false; m.run('onPointerDown', m.event(30, 40)); m.run('onPointerUp', m.event(30, 40));
    m.run('onClickCapture', { preventDefault() { prevented = true; }, stopPropagation() {} }); assert.equal(prevented, false);
  } finally { m.dispose(); }
});

test('small movements stay clicks and secondary pointers cannot steal a drag', () => {
  const m = mount();
  try {
    m.run('onPointerDown', m.event(50, 50)); m.run('onPointerMove', m.event(52, 51)); assert.equal(m.hook.dragging, false);
    m.run('onPointerMove', m.event(400, 200, 2)); assert.equal(m.hook.dragging, false);
    m.run('onPointerUp', m.event(52, 51)); assert.equal(m.storage.size, 0);
  } finally { m.dispose(); }
});

test('cancel restores origin; reduced motion still permits dragging and keyboard placement', () => {
  const m = mount({ enabled: false, saved: { [helpers.positionStorageKey('a')]: '{"x":300,"y":250}' } });
  try {
    m.run('onPointerDown', m.event(350, 300)); m.run('onPointerMove', m.event(500, 500));
    m.run('onPointerCancel', m.event(500, 500)); assert.match(m.style.transform, /300\.00px,250\.00px/);
    m.run('onKeyDown', { key: 'ArrowRight', shiftKey: true, preventDefault() {} });
    assert.deepEqual(JSON.parse(m.storage.get(helpers.positionStorageKey('a'))), { x: 340, y: 250 });
    m.run('onKeyDown', { key: 'ArrowUp', preventDefault() {} });
    assert.deepEqual(JSON.parse(m.storage.get(helpers.positionStorageKey('a'))), { x: 340, y: 238 });
    m.window.innerWidth = 390; m.window.innerHeight = 400; act(() => m.windowEvents.resize());
    assert.match(m.style.transform, /246\.00px,218\.00px/);
  } finally { m.dispose(); }
});

test('switching workers restores the right position and never writes an anonymous shared key', () => {
  const m = mount({ saved: { [helpers.positionStorageKey('a')]: '{"x":30,"y":40}', [helpers.positionStorageKey('b')]: '{"x":200,"y":220}' } });
  try {
    assert.match(m.style.transform, /30\.00px,40\.00px/); m.update({ workerId: 'b' }); assert.match(m.style.transform, /200\.00px,220\.00px/);
    m.update({ workerId: null }); m.run('onKeyDown', { key: 'ArrowLeft', preventDefault() {} }); assert.equal(m.storage.size, 2);
  } finally { m.dispose(); }
});

test('idle motion stops scheduling frames, wakes for movement and settles exactly', () => {
  const m = mount();
  try {
    m.frame(16); assert.equal(m.pendingFrames, 0);
    act(() => m.hook.move(400, 250)); assert.equal(m.pendingFrames, 1);
    for (let time = 32; time < 6000 && m.pendingFrames; time += 16) m.frame(time);
    assert.equal(m.pendingFrames, 0); assert.equal(m.hook.moving, false);
    assert.equal(m.style.transform, 'translate3d(400.00px,250.00px,0)');
    m.frame(7000); assert.equal(m.pendingFrames, 0);
    act(() => m.hook.move(600, 350)); assert.equal(m.pendingFrames, 1);
    m.document.hidden = true; act(() => m.documentEvents.visibilitychange());
    assert.equal(m.pendingFrames, 0);
    m.document.hidden = false; act(() => m.documentEvents.visibilitychange());
    assert.equal(m.pendingFrames, 1);
  } finally { m.dispose(); }
});

test('reduced movement applies the new position in one frame without an idle loop', () => {
  const m = mount({ enabled: false });
  try {
    m.frame(16); act(() => m.hook.move(200, 180)); m.frame(32);
    assert.equal(m.style.transform, 'translate3d(200.00px,180.00px,0)');
    assert.equal(m.pendingFrames, 0);
  } finally { m.dispose(); }
});
