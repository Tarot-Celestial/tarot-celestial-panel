const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const renderer = require('react-test-renderer');
const { act } = renderer;

// Exercise the actual sidebar without mounting the panel's live calls or data hooks.
const file = path.join(__dirname, '../src/app/panel-tarotista/page.tsx');
const source = fs.readFileSync(file, 'utf8');
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['TAROTISTA_NAV', 'TAROTISTA_NAV_GROUPS']);
const statements = ast.statements.filter(statement =>
  (ts.isFunctionDeclaration(statement) && statement.name?.text === 'TarotistaSidebar') ||
  (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => names.has(declaration.name.getText(ast))))
);
assert.equal(statements.length, 3, 'The real sidebar and navigation definitions must be present');
const compiled = ts.transpileModule(statements.map(statement => statement.getText(ast)).join('\n'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const exportsObject = {};
vm.runInNewContext(`${compiled}\nexports.Sidebar = TarotistaSidebar;`, {
  exports: exportsObject,
  require,
  ...require('lucide-react'),
  panelStyles: new Proxy({}, { get: (_, key) => String(key) }),
});

function fixture(badges = {}) {
  let tree;
  const calls = [];
  const render = (activeTab = 'resumen', nextBadges = badges) => act(() => {
    const element = React.createElement(exportsObject.Sidebar, { activeTab, badges: nextBadges, onTabChange: key => calls.push(key) });
    if (tree) tree.update(element); else tree = renderer.create(element);
  });
  render();
  return {
    render,
    calls,
    get tree() { return tree; },
    button: key => tree.root.findAllByType('button').find(button => button.props['data-tarotista-nav'] === key),
    close: () => act(() => tree.unmount()),
  };
}

test('grouping keeps all ten destinations reachable once and only navigates on selection', () => {
  const keys = ['resumen', 'notificaciones', 'clientes', 'chat', 'bonos', 'rangos', 'ranking', 'equipos', 'checklist', 'facturas'];
  const f = fixture();
  try {
    assert.deepEqual(f.calls, []);
    assert.equal(f.tree.root.findByType('nav').props['aria-label'], 'Navegación de tarotistas');
    const buttons = f.tree.root.findAllByType('button');
    assert.deepEqual(buttons.map(button => button.props['data-tarotista-nav']).sort(), [...keys].sort());
    for (const key of keys) {
      assert.equal(f.button(key).props.type, 'button');
      act(() => f.button(key).props.onClick());
    }
    assert.deepEqual(f.calls, keys);
  } finally { f.close(); }
});

test('unread messages, notifications, pending tasks and invoice incidents retain independent counts', () => {
  const f = fixture({ chat: 124, notificaciones: 2, checklist: 3, facturas: 4 });
  try {
    const expected = { chat: '124 mensajes sin leer', notificaciones: '2 notificaciones pendientes', checklist: '3 tareas pendientes', facturas: '4 incidencias pendientes' };
    for (const [key, label] of Object.entries(expected)) {
      const badge = f.button(key).findAllByType('span').find(span => span.props['aria-label'] === label);
      assert.ok(badge, `${key} keeps an accessible exact count`);
      assert.deepEqual(badge.children, [key === 'chat' ? '99+' : key === 'notificaciones' ? '2' : key === 'checklist' ? '3' : '4']);
    }
    f.render('chat', { chat: 0, notificaciones: 0, checklist: 0, facturas: 0 });
    assert.equal(f.tree.root.findAllByType('span').filter(span => span.props.className === 'navBadge').length, 0);
    assert.deepEqual(f.calls, []);
  } finally { f.close(); }
});

test('active destination is announced once when navigating between groups', () => {
  const f = fixture();
  try {
    for (const key of ['resumen', 'clientes', 'rangos', 'chat', 'facturas']) {
      f.render(key);
      const current = f.tree.root.findAllByType('button').filter(button => button.props['aria-current'] === 'page');
      assert.equal(current.length, 1);
      assert.equal(current[0].props['data-tarotista-nav'], key);
    }
  } finally { f.close(); }
});
