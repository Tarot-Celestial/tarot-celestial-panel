const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');
const { renderToStaticMarkup } = require('react-dom/server');

const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/cliente/CelestialPortal.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function events(extra = {}) {
  const listeners = new Map();
  return {
    ...extra,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    fire(type, event = {}) { for (const fn of [...(listeners.get(type) || [])]) fn(event); },
    count() { return [...listeners.values()].reduce((total, items) => total + items.size, 0); },
  };
}

function load(globals = {}) {
  const exports = {};
  vm.runInNewContext(source, { exports, ...globals, require(name) {
    if (name.endsWith('.module.css')) return { default: new Proxy({}, { get: (_, key) => String(key) }), __esModule: true };
    return require(name);
  } });
  return exports;
}

function mount({ stored, reduced = false, hidden = false, saveData = false, storageBlocked = false } = {}) {
  const storage = new Map(stored ? [['tc-universe-motion', stored]] : []);
  const frames = new Map();
  const writes = new Map();
  const reducedMedia = events({ matches: reduced });
  const fineMedia = events({ matches: true });
  const connection = events({ saveData });
  const document = events({ hidden });
  let nextFrame = 0;
  const window = events({
    innerWidth: 1440, innerHeight: 900, scrollY: 0,
    matchMedia: query => query.includes('reduced-motion') ? reducedMedia : fineMedia,
    requestAnimationFrame: fn => { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id),
    localStorage: {
      getItem: key => { if (storageBlocked) throw Error('blocked'); return storage.get(key) || null; },
      setItem: (key, value) => { if (storageBlocked) throw Error('blocked'); storage.set(key, value); },
    },
  });
  const api = load({ window, document, navigator: { connection, hardwareConcurrency: 8, deviceMemory: 8 } });
  function Child() { return React.createElement('output', { 'data-running': api.usePortalMotion().running }, 'Visible content'); }
  let renderer;
  act(() => { renderer = create(React.createElement(api.default, null, React.createElement(Child), React.createElement(api.PortalMotionControl)), {
    createNodeMock: node => node.props['data-celestial-portal'] !== undefined ? { style: { setProperty: (key, value) => writes.set(key, value) } } : null,
  }); });
  return {
    api, renderer, window, document, connection, reducedMedia, fineMedia, storage, frames, writes,
    host: () => renderer.root.findByProps({ 'data-celestial-portal': '' }),
    running: () => renderer.root.findByType('output').props['data-running'],
    control: () => renderer.root.findByType('button'),
    flush: () => act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(0)); }),
    close: () => act(() => renderer.unmount()),
  };
}

test('server render is deterministic, static, and leaves content outside the decorative aria-hidden layer', () => {
  const api = load();
  function Child() { return React.createElement('output', { 'data-running': api.usePortalMotion().running }, 'Content'); }
  const tree = React.createElement(api.default, null, React.createElement(Child), React.createElement(api.PortalMotionControl));
  const html = renderToStaticMarkup(tree);
  assert.equal(html, renderToStaticMarkup(tree));
  assert.match(html, /data-motion="paused"/);
  assert.match(html, /<output data-running="false">Content<\/output>$/);
  assert.doesNotMatch(html, /<button/);
  assert.match(renderToStaticMarkup(React.createElement(Child)), /data-running="false"/);
});

test('the existing stored preference controls the background and child animations and survives toggles', () => {
  const app = mount({ stored: 'paused' });
  try {
    assert.equal(app.running(), false);
    assert.equal(app.frames.size, 0);
    assert.equal(app.control().props['aria-label'], 'Reanudar universo');
    act(() => app.control().props.onClick());
    assert.equal(app.running(), true);
    assert.equal(app.host().props['data-motion'], 'running');
    assert.equal(app.storage.get('tc-universe-motion'), 'enabled');
    act(() => app.control().props.onClick());
    assert.equal(app.running(), false);
    assert.equal(app.storage.get('tc-universe-motion'), 'paused');
    assert.equal(app.frames.size, 0, 'pausing cancels an outstanding paint');
  } finally { app.close(); }
});

test('pointer and scroll bursts share one paint, with no idle loop or changes while paused', () => {
  const app = mount();
  try {
    app.window.scrollY = 900;
    act(() => { for (let index = 0; index < 80; index++) {
      app.window.fire('pointermove', { clientX: 1440, clientY: 900, pointerType: 'mouse' });
      app.window.fire('scroll');
    } });
    assert.equal(app.frames.size, 1);
    app.flush();
    assert.equal(app.frames.size, 0, 'paint must not queue a recurring RAF');
    assert.equal(app.writes.get('--portal-x'), '6.00px');
    assert.equal(app.writes.get('--portal-y'), '4.00px');
    assert.equal(app.writes.get('--portal-scroll'), '16.00px');
    const snapshot = [...app.writes];
    act(() => app.control().props.onClick());
    app.window.fire('pointermove', { clientX: 0, clientY: 0, pointerType: 'mouse' });
    app.window.scrollY = 0;
    app.window.fire('scroll');
    assert.equal(app.frames.size, 0);
    assert.deepEqual([...app.writes], snapshot);
  } finally { app.close(); }
});

test('document visibility and reduced motion stop both layers and children, with no reduced-motion control', () => {
  const app = mount({ hidden: true });
  try {
    assert.equal(app.running(), false);
    assert.equal(app.frames.size, 0);
    act(() => { app.document.hidden = false; app.document.fire('visibilitychange'); });
    assert.equal(app.running(), true);
    act(() => { app.reducedMedia.matches = true; app.reducedMedia.fire('change'); });
    assert.equal(app.running(), false);
    assert.equal(app.frames.size, 0);
    assert.equal(app.renderer.root.findAllByType('button').length, 0);
    act(() => { app.reducedMedia.matches = false; app.reducedMedia.fire('change'); });
    assert.equal(app.running(), true);
    act(() => { app.document.hidden = true; app.document.fire('visibilitychange'); });
    assert.equal(app.running(), false);
    assert.equal(app.host().props['data-motion'], 'paused');
    assert.equal(app.frames.size, 0);
  } finally { app.close(); }
});

test('cross-tab pause changes synchronize and save-data disables parallax work', () => {
  const app = mount({ saveData: true });
  try {
    assert.equal(app.host().props['data-quality'], 'economy');
    assert.equal(app.frames.size, 0);
    app.window.fire('scroll');
    assert.equal(app.frames.size, 0);
    act(() => { app.storage.set('tc-universe-motion', 'paused'); app.window.fire('storage', { key: 'tc-universe-motion' }); });
    assert.equal(app.running(), false);
    act(() => { app.connection.saveData = false; app.connection.fire('change'); });
    assert.equal(app.host().props['data-quality'], 'full');
    assert.equal(app.frames.size, 0);
    act(() => { app.storage.set('tc-universe-motion', 'enabled'); app.window.fire('storage', { key: 'tc-universe-motion' }); });
    assert.equal(app.running(), true);
    assert.equal(app.frames.size, 1);
  } finally { app.close(); }
});

test('blocked storage remains usable and unmount removes every listener and queued frame', () => {
  const app = mount({ storageBlocked: true });
  assert.equal(app.running(), true);
  act(() => app.control().props.onClick());
  assert.equal(app.running(), false);
  act(() => app.control().props.onClick());
  assert.equal(app.frames.size, 1);
  app.close();
  for (const target of [app.window, app.document, app.connection, app.reducedMedia, app.fineMedia]) assert.equal(target.count(), 0);
  assert.equal(app.frames.size, 0);
});
