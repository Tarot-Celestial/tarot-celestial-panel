const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const renderer = require('react-test-renderer');
const { act } = renderer;

function load(name, modules = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/admin', name), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, { exports, require(id) {
    if (id in modules) return modules[id];
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id === 'lucide-react') return new Proxy({}, { get: () => 'svg' });
    if (id.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    throw new Error(`Unexpected module ${id}`);
  } });
  return exports;
}

const navigation = load('admin-navigation.ts');
const Sidebar = load('AdminSidebar.tsx', { './admin-navigation': navigation }).default;
function fixture(activeTab = 'dashboard') {
  const calls = [];
  let tree;
  function render(tab) { act(() => {
    const element = React.createElement(Sidebar, { activeTab: tab, onTabChange: key => calls.push(key) });
    if (tree) tree.update(element); else tree = renderer.create(element);
  }); }
  render(activeTab);
  return {
    get tree() { return tree; }, calls, render,
    button(key) { return tree.root.findAllByType('button').find(button => button.props['data-admin-nav'] === key); },
    toggle(label) { return tree.root.findAllByType('button').find(button => String(button.props['aria-label']).endsWith(`submenú ${label}`)); },
    close() { act(() => tree.unmount()); },
  };
}

test('all existing Admin destinations survive grouping, without duplicate sections or missing root items', () => {
  const previousDestinations = [
    'atlas', 'dashboard', 'panel', 'facturas', 'client-balances', 'welldone', 'rank-benefits', 'finance-center', 'editor',
    'estadisticas', 'equipos-marcador', 'asistencia', 'incidencias', 'trabajadores', 'clientes', 'pagos-web', 'precios-hoy',
    'rangos-clientes', 'clientes-web', 'ruletas-clientes', 'rituales-clientes', 'bonos-tarotistas', 'rangos-tarotistas',
    'sistema-xp', 'sistema-xp-niveles', 'crm', 'sorteo', 'chat', 'captacion', 'campanas-clientes', 'redes-sociales',
    'redes-sociales-instagram', 'redes-sociales-tiktok', 'rendimiento', 'reservas', 'diario',
  ];
  assert.deepEqual([...navigation.ADMIN_TAB_KEYS].sort(), [...previousDestinations, 'whatsapp'].sort());
  const groupedKeys = Array.from(navigation.ADMIN_NAV_GROUPS, group => Array.from(group.items, item => item.key)).flat();
  assert.equal(groupedKeys.length, new Set(groupedKeys).size);
  assert.deepEqual(groupedKeys.sort(), Array.from(navigation.ADMIN_NAV, item => item.key).sort());
});

test('WhatsApp is an accessible Admin action inside Communication and does not navigate on render', () => {
  const f = fixture();
  try {
    assert.deepEqual(f.calls, []);
    const nav = f.tree.root.findByType('nav');
    assert.equal(nav.props['aria-label'], 'Navegación de Administración');
    const sections = nav.findAllByType('section');
    assert.equal(sections.length, 7);
    const communication = sections.find(section => section.findByType('h2').children.includes('Comunicación'));
    assert.ok(communication.findAllByType('button').some(button => button.props['data-admin-nav'] === 'whatsapp'));
    act(() => f.button('whatsapp').props.onClick());
    assert.deepEqual(f.calls, ['whatsapp']);
    f.render('whatsapp');
    assert.equal(f.button('whatsapp').props['aria-current'], 'page');
    assert.equal(f.button('dashboard').props['aria-current'], undefined);
  } finally { f.close(); }
});

test('direct child destinations open the appropriate submenu and remain keyboard-reachable', () => {
  const f = fixture('clientes-web');
  try {
    for (const [childKey, groupLabel] of [['clientes-web', 'Rangos de clientes'], ['sistema-xp-niveles', 'Sistema de XP'], ['rangos-tarotistas', 'Bonos tarotistas'], ['redes-sociales-tiktok', 'Redes sociales']]) {
      f.render(childKey);
      const toggle = f.toggle(groupLabel);
      assert.equal(toggle.props.type, 'button');
      assert.equal(toggle.props['aria-expanded'], true);
      const submenu = f.tree.root.find(node => node.props.id === toggle.props['aria-controls']);
      assert.equal(submenu.props.hidden, false);
      const child = submenu.findAllByType('button').find(button => button.props['data-admin-nav'] === childKey);
      assert.equal(child.props['aria-current'], 'page');
      act(() => child.props.onClick());
      assert.equal(f.calls.at(-1), childKey);
    }
    assert.equal(f.tree.root.findAllByType('button').some(button => button.findAllByType('button').length > 1), false);
  } finally { f.close(); }
});

test('collapsing a submenu changes only disclosure state and parent selection restores it', () => {
  const f = fixture('ruletas-clientes');
  try {
    const toggle = f.toggle('Rangos de clientes');
    act(() => toggle.props.onClick());
    assert.deepEqual(f.calls, []);
    assert.equal(f.toggle('Rangos de clientes').props['aria-expanded'], false);
    const id = f.toggle('Rangos de clientes').props['aria-controls'];
    assert.equal(f.tree.root.find(node => node.props.id === id).props.hidden, true);
    act(() => f.button('rangos-clientes').props.onClick());
    assert.deepEqual(f.calls, ['rangos-clientes']);
    assert.equal(f.toggle('Rangos de clientes').props['aria-expanded'], true);
  } finally { f.close(); }
});
