const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), React = require('react'), Three = require('three');
const { act, create } = require('react-test-renderer');

function mount({ reduced = false } = {}) {
  const frames = new Map(), windowEvents = {}, documentEvents = {};
  let sequence = 0, renders = 0, measured = 0, rendererDisposed = false, observeVisibility, observeResize;
  const node = {
    appendChild() {},
    getBoundingClientRect() { measured++; return { x: 0, y: 0, width: 136, height: 174 }; },
  };
  class Renderer {
    domElement = { style: {}, addEventListener() {}, removeEventListener() {}, remove() {} };
    setPixelRatio() {} setClearColor() {} setSize() {} forceContextLoss() {}
    render() { renders++; }
    dispose() { rendererDisposed = true; }
  }
  const window = { devicePixelRatio: 1, addEventListener: (key, fn) => windowEvents[key] = fn, removeEventListener: key => delete windowEvents[key] };
  const document = { hidden: false, addEventListener: (key, fn) => documentEvents[key] = fn, removeEventListener: key => delete documentEvents[key] };
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/features/central/assistant/Companion3D.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: name => name === 'three' ? { ...Three, WebGLRenderer: Renderer } : require(name),
    window, document,
    ResizeObserver: class { constructor(fn) { observeResize = fn; } observe() {} disconnect() {} },
    IntersectionObserver: class { constructor(fn) { observeVisibility = fn; } observe() {} disconnect() {} },
    requestAnimationFrame: fn => { frames.set(++sequence, fn); return sequence; }, cancelAnimationFrame: id => frames.delete(id),
  });
  const props = { pet: 'draco', state: 'idle', reduced, onUnavailable() { throw new Error('Unexpected renderer failure'); } };
  let renderer;
  act(() => { renderer = create(React.createElement(exports.default, props), { createNodeMock: () => node }); });
  return {
    windowEvents, document,
    get pending() { return frames.size; }, get renders() { return renders; }, get measured() { return measured; },
    frame(now) { act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(now)); }); },
    update(next) { Object.assign(props, next); act(() => renderer.update(React.createElement(exports.default, props))); },
    hidden(value) { document.hidden = value; act(() => documentEvents.visibilitychange()); },
    visible(value) { act(() => observeVisibility([{ isIntersecting: value }])); },
    resize() { act(() => observeResize()); },
    dispose() { act(() => renderer.unmount()); assert.equal(frames.size, 0); assert.equal(rendererDisposed, true); assert.equal(Object.keys(documentEvents).length, 0); assert.equal(Object.keys(windowEvents).length, 0); },
  };
}

test('3D companions cancel hidden/offscreen loops and resume only while visible', () => {
  const m = mount();
  try {
    m.frame(40); assert.equal(m.renders, 1); assert.equal(m.pending, 1);
    m.hidden(true); assert.equal(m.pending, 0);
    const measured = m.measured;
    m.windowEvents.pointermove({ clientX: 200, clientY: 100 }); assert.equal(m.measured, measured);
    m.hidden(false); assert.equal(m.pending, 1); m.frame(80); assert.equal(m.renders, 2);
    m.visible(false); assert.equal(m.pending, 0);
    m.update({ state: 'greeting' }); assert.equal(m.pending, 0);
    m.visible(true); assert.equal(m.pending, 1); m.frame(120); assert.equal(m.renders, 3);
  } finally { m.dispose(); }
});

test('reduced motion draws once, refreshes state/size changes and creates no background loop', () => {
  const m = mount({ reduced: true });
  try {
    m.frame(40); assert.equal(m.renders, 1); assert.equal(m.pending, 0);
    m.update({ state: 'concerned' }); assert.equal(m.pending, 1);
    m.frame(80); assert.equal(m.renders, 2); assert.equal(m.pending, 0);
    m.resize(); m.frame(120); assert.equal(m.renders, 3); assert.equal(m.pending, 0);
    m.update({ reduced: false }); m.frame(160); assert.equal(m.pending, 1);
    m.update({ reduced: true }); m.frame(200); assert.equal(m.pending, 0);
  } finally { m.dispose(); }
});
