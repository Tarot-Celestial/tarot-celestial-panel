const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const renderer = require('react-test-renderer');
const { act } = renderer;
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/admin/useAdminNavigation.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture() {
  let current, answer = false;
  const prompts = [], exports = {};
  vm.runInNewContext(source, { exports, require: id => { if (id === 'react') return React; throw Error(id); }, window: { confirm: question => { prompts.push(question); return answer; } } });
  function Harness() { current = exports.useAdminNavigation(); return React.createElement('span', null, current.tab); }
  let tree;
  act(() => { tree = renderer.create(React.createElement(Harness)); });
  return { get current() { return current; }, prompts, allow: () => { answer = true; }, close: () => act(() => tree.unmount()) };
}

test('only leaving a dirty WhatsApp draft asks for confirmation, cancellation preserves the current tab', () => {
  const f = fixture();
  try {
    act(() => f.current.setTab('crm'));
    act(() => f.current.setTab('whatsapp'));
    act(() => f.current.setWhatsAppDirty(true));
    act(() => f.current.setTab('whatsapp'));
    assert.deepEqual(f.prompts, []);
    act(() => f.current.setTab('facturas'));
    assert.equal(f.current.tab, 'whatsapp');
    assert.equal(f.prompts.length, 1);
    act(() => f.current.setWhatsAppDirty(false));
    act(() => f.current.setTab('facturas'));
    assert.equal(f.current.tab, 'facturas');
    assert.equal(f.prompts.length, 1);
  } finally { f.close(); }
});

test('callbacks captured before edits still protect the draft and approved departure clears the guard', () => {
  const f = fixture();
  try {
    const navigateFromOldListener = f.current.setTab;
    act(() => f.current.setTab('whatsapp'));
    act(() => f.current.setWhatsAppDirty(true));
    assert.equal(f.current.setTab, navigateFromOldListener);
    act(() => navigateFromOldListener('dashboard'));
    assert.equal(f.current.tab, 'whatsapp');
    f.allow();
    act(() => navigateFromOldListener(tab => tab === 'whatsapp' ? 'dashboard' : 'crm'));
    assert.equal(f.current.tab, 'dashboard');
    assert.equal(f.prompts.length, 2);
    act(() => navigateFromOldListener('whatsapp'));
    act(() => navigateFromOldListener('crm'));
    assert.equal(f.current.tab, 'crm');
    assert.equal(f.prompts.length, 2);
  } finally { f.close(); }
});
