const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');
const { act } = renderer;
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node ? text(node.children) : '';
function compile(file) { return ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText; }
const presentation = {};
vm.runInNewContext(compile('src/lib/purchase-presentation.ts'), { exports: presentation });
const rankFree = {}, initialFree = {};
vm.runInNewContext(compile('src/lib/client-rank-free-usage.ts'), { exports: rankFree });
vm.runInNewContext(compile('src/lib/client-initial-free.ts'), { exports: initialFree });
const clone = value => JSON.parse(JSON.stringify(value));

test('package grouping follows server assignments, keeps every package and never guesses from price or row order', () => {
  const packs = [
    { id: 'premium', amount: 12, total_minutes: 120, package_level: 3, roulette_level: 1 },
    { id: 'unknown', amount: 99, total_minutes: 150, roulette_level: 4 },
    { id: 'normal', amount: 99, total_minutes: 20, package_level: 1, roulette_level: 3 },
    { id: 'legacy', amount: 35, total_minutes: 60, roulette_level: 2 },
  ];
  const groups = presentation.groupPurchasePacks(packs);
  assert.deepEqual(clone(groups.map(group => [group.title, group.packs.map(pack => pack.id)])), [
    ['Nivel 1', ['normal']], ['Nivel 2', ['legacy']], ['Nivel 3', ['premium']], ['Otros paquetes', ['unknown']],
  ]);
  assert.equal(groups.flatMap(group => group.packs).length, packs.length);
  assert.equal(groups[2].minutesLabel, '120 minutos');
  assert.deepEqual(packs.map(pack => pack.id), ['premium', 'unknown', 'normal', 'legacy']);
});

test('old promotion copy cannot promise Coins or wheels and keeps separate minutes and Oracle clauses', () => {
  assert.equal(presentation.promotionDisplayCopy('50 MINUTOS + 30 DE REGALO + 500 COINS + GIRO DE RULETA NIVEL 2 + DOS TIRADAS DE ORACULO'), '50 MINUTOS + 30 DE REGALO + DOS TIRADAS DE ORACULO');
  assert.equal(presentation.promotionDisplayCopy('Consulta especial · 250 Coins · reserva previa'), 'Consulta especial + reserva previa');
  assert.equal(presentation.promotionDisplayCopy('+1 giro Nivel 1'), '');
  assert.equal(presentation.promotionDisplayCopy('30 minutos y 500 Coins'), '', 'mixed claims are omitted; structured minutes still display');
  assert.equal(presentation.promotionDisplayCopy('Promo Locura'), 'Promo Locura');
  assert.equal(presentation.promotionDisplayCopy(null), '');
});

function loadComponent(file, fetch) {
  const exports = {};
  vm.runInNewContext(compile(file), {
    exports, fetch, console, Date, Intl, document: { body: {}, addEventListener() {}, removeEventListener() {} },
    window: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000099' },
    Event: class {}, CustomEvent: class {}, BroadcastChannel: class { postMessage() {} close() {} },
    require(name) {
      if (name === 'react') return React;
      if (name === 'react-dom') return { createPortal: child => child };
      if (name === 'react/jsx-runtime') return require(name);
      if (name === 'lucide-react') return new Proxy({}, { get: (_, name) => String(name) });
      if (name === '@/lib/purchase-presentation') return presentation;
      if (name === '@/lib/client-rank-free-usage') return rankFree;
      if (name === '@/lib/client-initial-free') return initialFree;
      if (name === '@/lib/countries') return { getCountryByLabelOrCode: () => ({}), buildInternationalPhone: (_, phone) => phone };
      if (name === '@/lib/activity-codes') return { CALL_CODE_OPTIONS: [{ value: 'FREE', label: 'Free' }, { value: 'NORMAL', label: 'Normal' }] };
      if (name === '@/lib/tc-toast') return { tcToast() {} };
      if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
      throw new Error(name);
    },
  });
  return exports.default;
}
const client = { id: '00000000-0000-4000-8000-000000000002', nombre: 'Prueba' };
const reply = data => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });

test('PayPal modal renders level sections and selecting another level retains the exact amount; manual copy excludes rewards', async () => {
  const packs = [1, 2, 3].map(level => ({ id: `p${level}`, nombre: `${level * 20} minutos`, amount: level * 15, total_minutes: level * 20, package_level: level, roulette_level: level, roulette_spins: 1, coins: 0, oracle_credits: 0 }));
  const Component = loadComponent('src/components/crm/PayPalCrmPaymentModal.tsx', async () => reply({ ok: true, packs }));
  let tree;
  await act(async () => { tree = renderer.create(React.createElement(Component, { open: true, cliente: client, getToken: async () => 'fixture', onClose() {} })); });
  assert.deepEqual(tree.root.findAllByType('h3').map(text), ['Nivel 1', 'Nivel 2', 'Nivel 3']);
  const premium = tree.root.findAllByType('button').find(button => text(button).startsWith('60 minutos'));
  await act(async () => premium.props.onClick());
  assert.equal(premium.props['aria-pressed'], true);
  assert.match(text(tree.root.find(node => node.props.className === 'summary')), /45,00/);
  await act(async () => tree.root.findAllByType('button').find(button => text(button).trim() === 'Importe manual').props.onClick());
  assert.match(text(tree.toJSON()), /Sin Coins ni giros de ruleta/);
  await act(async () => tree.unmount());
});

async function callFixture(options = {}) {
  const requests = [], posts = [];
  const collection = { id: '00000000-0000-4000-8000-000000000071', amount: 22, currency: 'EUR', pack_id: 'crm_manual_amount', pack_name: 'Importe personalizado', pricing_mode: 'manual_amount', completed_at: '2026-10-25T12:00:00Z', order_id: 'ORDER-71' };
  const Component = loadComponent('src/components/crm/RegistrarLlamadaModal.tsx', async (url, init) => {
    requests.push(url);
    if (init?.method === 'POST') { posts.push(JSON.parse(init.body)); return options.postError ? { ...reply({ ok: false, error: options.postError }), ok: false, status: 409 } : reply({ ok: true }); }
    if (url.includes('mode=collections')) return options.collectionsError ? { ok: false, json: async () => ({ ok: false }) } : reply({ ok: true, collections: [collection] });
    return reply({ ok: true, balance: { minutos_free_pendientes: 0, minutos_normales_pendientes: 0 }, capture_xp: null });
  });
  let tree;
  await act(async () => { tree = renderer.create(React.createElement(Component, { open: true, cliente: client, tarotistas: [{ id: '00000000-0000-4000-8000-000000000003', display_name: 'Luna' }], getToken: async () => 'fixture', onClose() {} })); });
  const click = async label => act(async () => tree.root.findAllByType('button').find(button => text(button) === label).props.onClick());
  const change = async (node, value) => act(async () => node.props.onChange({ target: { value } }));
  assert.equal(requests.some(url => url.includes('mode=collections')), false, 'do not query collections for unrelated call registrations');
  await click('Registrar una compra nueva'); await click('Siguiente');
  await click('Usa todos los minutos'); await click('Siguiente');
  await change(tree.root.findAllByType('input')[0], '10'); await click('Siguiente');
  await act(async () => tree.root.find(node => node.props.ariaLabel === 'Tarotista que atiende u origen de la llamada').props.onChange('00000000-0000-4000-8000-000000000003'));
  await click('Siguiente');
  await change(tree.root.findByType('select'), 'PAYPAL'); await click('Siguiente');
  return { tree, click, change, requests, posts, collection };
}

test('call wizard requires an explicit PayPal source, preserves manual provenance and submits the exact confirmed order', async () => {
  const f = await callFixture();
  const selector = () => f.tree.root.findByProps({ id: 'registered-paypal-collection' });
  assert.equal(selector().props.value, '', 'never auto-select by amount or first row');
  await f.change(f.tree.root.findByProps({ id: 'registered-call-amount' }), '22');
  await f.click('Siguiente');
  assert.ok(f.tree.root.findByProps({ id: 'registered-paypal-collection' }), 'cannot proceed without choosing the source');
  await f.change(selector(), f.collection.id);
  assert.equal(f.tree.root.findByProps({ id: 'registered-call-amount' }).props.readOnly, true);
  assert.match(text(f.tree.toJSON()), /Importe manual: sin Coins ni giros/);
  await f.click('Siguiente');
  assert.match(text(f.tree.toJSON()), /Cobro manual · Sin Coins ni giros/);
  await f.click('Siguiente');
  assert.match(text(f.tree.toJSON()), /Cobro PayPal:.*ORDER-71/);
  await f.click('Registrar llamada');
  assert.equal(f.posts.length, 1);
  assert.equal(f.posts[0].paypal_collection_order_id, f.collection.id);
  assert.equal(f.posts[0].paypal_collection_source, 'crm_collection');
  assert.equal(f.posts[0].importe, 22);
  assert.equal(f.posts[0].clasificacion, 'nada');
  await act(async () => f.tree.unmount());
});

test('external PayPal is explicitly marked and never borrows a matching panel order', async () => {
  const f = await callFixture();
  await f.change(f.tree.root.findByProps({ id: 'registered-paypal-collection' }), 'external');
  await f.change(f.tree.root.findByProps({ id: 'registered-call-amount' }), '22');
  await f.click('Siguiente'); await f.click('Siguiente'); await f.click('Registrar llamada');
  assert.equal(f.posts[0].paypal_collection_order_id, null);
  assert.equal(f.posts[0].paypal_collection_source, 'external');
  await act(async () => f.tree.unmount());
});

test('collection lookup failure cannot silently register a PayPal purchase without provenance', async () => {
  const f = await callFixture({ collectionsError: true });
  assert.match(text(f.tree.toJSON()), /No se pudieron consultar los cobros/);
  await f.change(f.tree.root.findByProps({ id: 'registered-call-amount' }), '22');
  await f.click('Siguiente');
  assert.match(text(f.tree.toJSON()), /Importe cobrado/);
  assert.equal(f.posts.length, 0);
  await act(async () => f.tree.unmount());
});

test('already registered collection explains that the operator must use the existing balance', async () => {
  const f = await callFixture({ postError: 'PAYPAL_COLLECTION_ALREADY_REGISTERED' });
  await f.change(f.tree.root.findByProps({ id: 'registered-paypal-collection' }), f.collection.id);
  await f.click('Siguiente'); await f.click('Siguiente'); await f.click('Registrar llamada');
  assert.match(text(f.tree.toJSON()), /Este cobro PayPal ya está registrado.*usa su saldo pendiente/);
  await act(async () => f.tree.unmount());
});
