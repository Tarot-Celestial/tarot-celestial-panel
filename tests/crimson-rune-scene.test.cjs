const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');

function fixture() {
  const calls = [], exports = {};
  let tree, onState, state = { running: true, paused: false, reduced: false };
  const host = { getBoundingClientRect: () => ({ left: 20, top: 30, width: 480, height: 540 }) };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/cliente/CrimsonRuneScene.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, console, require(name) {
    if (name === '@/lib/rune-motion') return { createRuneMotion(options) {
      onState = options.onState; onState(state);
      return {
        burst(x, y) { calls.push(['burst', x, y]); }, tilt(x, y) { calls.push(['tilt', x, y]); },
        pause(value) { calls.push(['pause', value]); state = { ...state, paused: value, running: !value }; onState(state); },
        dispose() { calls.push(['dispose']); },
      };
    } };
    if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
    if (name === 'next/image') return { default: props => React.createElement('img', props) };
    if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => props => React.createElement('span', { ...props, 'data-icon': key }) });
    return require(name);
  } });
  const act = async callback => renderer.act(async () => { callback(); });
  return {
    calls,
    async mount() { await act(() => { tree = renderer.create(React.createElement(exports.default), { createNodeMock: node => node.type === 'div' ? host : {} }); }); },
    get stone() { return tree.root.findByProps({ 'aria-label': 'Tocar la runa Obsidiana carmesí' }); },
    get pause() { return tree.root.findAllByType('button').find(node => Object.hasOwn(node.props, 'aria-pressed')); },
    get status() { return JSON.stringify(tree.root.findByProps({ role: 'status' }).children.map(child => typeof child === 'string' ? child : child.children)); },
    async touch(event) { await act(() => this.stone.props.onClick(event)); },
    async toggle() { await act(() => this.pause.props.onClick()); },
    async reduce() { await act(() => onState({ running: false, paused: false, reduced: true })); },
    async unmount() { await act(() => tree.unmount()); },
  };
}
const target = { getBoundingClientRect: () => ({ left: 180, top: 80, width: 180, height: 340 }) };

test('native stone button supports pointer contact and keyboard activation from its center', async () => {
  const f = fixture(); await f.mount();
  assert.equal(f.stone.props.type, 'button');
  assert.ok(f.stone.props['aria-describedby']);
  await f.touch({ detail: 1, clientX: 225, clientY: 160, currentTarget: target });
  await f.touch({ detail: 0, clientX: 0, clientY: 0, currentTarget: target });
  assert.deepEqual(f.calls.filter(c => c[0] === 'burst'), [['burst',205,130],['burst',250,220]]);
  assert.match(f.status, /La runa responde/);
  assert.match(f.status, /2/);
  await f.unmount();
  assert.equal(f.calls.filter(c => c[0] === 'dispose').length, 1);
});

test('pause is accessible and motion reduction remains controlled by the device preference', async () => {
  const f = fixture(); await f.mount();
  assert.equal(f.pause.props['aria-pressed'], false);
  await f.toggle();
  assert.equal(f.pause.props['aria-pressed'], true);
  assert.match(f.pause.props['aria-label'], /Reanudar/);
  await f.toggle();
  assert.equal(f.pause.props['aria-pressed'], false);
  await f.reduce();
  assert.equal(f.pause.props.disabled, true);
  assert.match(f.pause.props['aria-label'], /Movimiento reducido/);
  await f.unmount();
});
