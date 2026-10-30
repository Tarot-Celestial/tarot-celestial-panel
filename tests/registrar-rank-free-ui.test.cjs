// Fully simulated clients and workers. No network, auth or production writes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');
const root = path.join(__dirname, '..');
const client = '00000000-0000-4000-8000-000000000002';
const otherClient = '00000000-0000-4000-8000-000000000003';
const worker = '00000000-0000-4000-8000-000000000009';
const operation = '00000000-0000-4000-8000-000000000099';
const jsonResponse = (data, status = 200) => ({ ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function preview(rank = 'plata', changes = {}) {
  const minutes = { plata: 10, oro: 12, diamante: 15, bronce: 0 }[rank];
  return { effective_rank: rank, minutes, policy_key: 'new_tarotista_once_v1', offers: [{ tarotista_worker_id: worker, tarotista_name: 'Josefa', eligibility_key: worker, eligible: true, reason: null, grant_minutes: minutes, consume_minutes: minutes, ...changes }] };
}
function loadComponent(fetch) {
  const cache = new Map();
  const load = name => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'react-dom') return { createPortal: content => content };
    if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
    if (name === '@/lib/activity-codes') return { CALL_CODE_OPTIONS: [{ value: 'FREE', label: 'FREE' }, { value: 'TC', label: 'TC' }] };
    if (name === '@/lib/tc-toast') return { tcToast() {} };
    const file = name === 'modal' ? 'src/components/crm/RegistrarLlamadaModal.tsx' : name === '@/lib/client-rank-free-usage' ? 'src/lib/client-rank-free-usage.ts' : null;
    if (!file) throw Error(`Unexpected import ${name}`);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, require: load, fetch, document: { body: {} }, crypto: { randomUUID: () => operation }, console: { error() {} } });
    return exports;
  };
  return load('modal').default;
}
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : node?.children?.map(text).join('') || '';
const contents = tree => text(tree.toJSON());
async function click(tree, label) {
  const button = tree.root.findAllByType('button').find(item => text(item) === label || item.findAllByType('strong').some(strong => text(strong) === label));
  assert.ok(button, `Missing button: ${label}`);
  assert.notEqual(button.props.disabled, true, `Disabled button: ${label}`);
  await renderer.act(async () => { await button.props.onClick(); });
}
async function mount({ rank = 'plata', offer = {}, balance = 0, balanceFetch, post } = {}) {
  const requests = [], saved = [], closed = [];
  const Component = loadComponent(async (url, init = {}) => {
    requests.push({ url, ...init });
    if (init.method === 'POST') return post ? post(JSON.parse(init.body)) : jsonResponse({ ok: true, balances: { minutos_free_pendientes: balance, minutos_normales_pendientes: 0 } });
    if (url.includes('mode=balance')) return balanceFetch ? balanceFetch(url) : jsonResponse({ ok: true, balance: { minutos_free_pendientes: balance, minutos_normales_pendientes: 0 }, rank_free: preview(rank, offer) });
    return jsonResponse({ ok: true, capture_xp: null });
  });
  const props = { open: true, cliente: { id: client, nombre: 'Clienta simulada', free_passes: { effective_rank: 'diamante' } }, tarotistas: [{ id: worker, display_name: 'Josefa' }], getToken: async () => 'fixture', onClose: () => closed.push(true), onSuccess: (...args) => saved.push(args) };
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(Component, props)); });
  return { tree, requests, saved, closed, Component, props, posts: () => requests.filter(item => item.method === 'POST').map(item => JSON.parse(item.body)), unmount: () => renderer.act(async () => tree.unmount()) };
}
async function openConsultation(tree) {
  await click(tree, 'Usar saldo o regalo · sin nueva compra');
  await click(tree, 'Siguiente');
}

test('Silver zero balance: selecting Josefa is read-only; saving records exactly ten FREE minutes with the real worker', async () => {
  const h = await mount();
  await openConsultation(h.tree);
  assert.match(contents(h.tree), /No consume los pases periódicos de 7 minutos ni la consulta inicial/);
  await click(h.tree, 'Usa 10 FREE por rango Plata');
  assert.equal(h.posts().length, 0);
  await click(h.tree, 'Siguiente');
  assert.match(contents(h.tree), /Saldo previsto al guardar: 0 FREE \+ 0 normales/);
  assert.match(contents(h.tree), /10 minutos FREE en el rendimiento de Josefa/);
  assert.doesNotMatch(contents(h.tree), /Tarotista u origen/);
  await click(h.tree, 'Registrar llamada');
  const [payload] = h.posts();
  assert.equal(h.posts().length, 1);
  assert.equal(payload.uso_tipo, 'rank_free');
  assert.equal(payload.tarotista_worker_id, worker);
  assert.equal(payload.rank_free_eligibility_key, worker);
  assert.equal(payload.rank_free_expected_rank, 'plata');
  assert.equal(payload.rank_free_expected_minutes, 10);
  assert.equal(payload.codigo_1, 'FREE'); assert.equal(payload.minutos_1, 10);
  assert.equal(payload.minutos_2, 0); assert.equal(payload.codigo_2, null);
  assert.equal(payload.tarotista_manual_call, null); assert.equal(payload.collaborator_source, null);
  assert.equal(payload.cliente_compra_minutos, false); assert.equal(payload.importe, 0); assert.equal(payload.clasificacion, 'nada');
  assert.equal(payload.usa_7_free, undefined); assert.equal(payload.operation_id, operation);
  assert.equal(h.saved.length, 1); assert.equal(h.closed.length, 1);
  await h.unmount();
});

test('closing a selected gift never grants, consumes or records anything', async () => {
  const h = await mount({ rank: 'oro' });
  await openConsultation(h.tree);
  await click(h.tree, 'Usa 12 FREE por rango Oro');
  await click(h.tree, 'Cerrar');
  assert.equal(h.posts().length, 0); assert.equal(h.saved.length, 0);
  await h.unmount();
});

test('a Diamond gift has its own fifteen minutes and preserves the existing pending balance', async () => {
  const h = await mount({ rank: 'diamante', balance: 22, offer: { previous_credit_minutes: 15 } });
  await openConsultation(h.tree);
  await click(h.tree, 'Usa 15 FREE por rango Diamante');
  await click(h.tree, 'Siguiente');
  assert.match(contents(h.tree), /15 minutos FREE del regalo de bienvenida/);
  assert.match(contents(h.tree), /Saldo previsto al guardar: 22 FREE \+ 0 normales/);
  assert.doesNotMatch(contents(h.tree), /Este regalo ya se acreditó|saldo FREE disponible no alcanza/);
  await h.unmount();
});

test('server-disabled gifts and Bronze never become selectable based on caller rank or existing balance', async () => {
  for (const config of [
    { rank: 'bronce' },
    { offer: { eligible: false, reason: 'ALREADY_USED' } },
    { offer: { eligible: false, reason: 'TAROTISTA_INACTIVE' } },
  ]) {
    const h = await mount({ ...config, balance: 500 });
    await openConsultation(h.tree);
    assert.equal(h.tree.root.findAllByType('button').some(button => text(button).startsWith('Usa ')), false);
    assert.equal(h.posts().length, 0);
    await h.unmount();
  }
});

test('an unknown network outcome retries the same operation and the same exact gift payload', async () => {
  let attempts = 0;
  const h = await mount({ post: () => { if (++attempts === 1) throw Error('Network unavailable'); return jsonResponse({ ok: true, duplicate_prevented: true }); } });
  await openConsultation(h.tree); await click(h.tree, 'Usa 10 FREE por rango Plata'); await click(h.tree, 'Siguiente');
  await click(h.tree, 'Registrar llamada');
  assert.equal(h.closed.length, 0);
  await click(h.tree, 'Registrar llamada');
  assert.equal(h.posts().length, 2);
  assert.deepEqual(h.posts()[0], h.posts()[1]);
  assert.equal(h.posts()[1].operation_id, operation);
  assert.equal(h.saved[0][1].balances, null);
  await h.unmount();
});

test('late previous-client availability cannot replace the current client preview', async () => {
  const old = deferred();
  const h = await mount({ balanceFetch: url => url.includes(client) ? old.promise : Promise.resolve(jsonResponse({ ok: true, balance: { minutos_free_pendientes: 0, minutos_normales_pendientes: 0 }, rank_free: preview('oro') })) });
  await renderer.act(async () => h.tree.update(React.createElement(h.Component, { ...h.props, cliente: { id: otherClient, nombre: 'Otra simulada' } })));
  await openConsultation(h.tree);
  assert.match(contents(h.tree), /Usa 12 FREE por rango Oro/);
  await renderer.act(async () => old.resolve(jsonResponse({ ok: true, balance: { minutos_free_pendientes: 100, minutos_normales_pendientes: 0 }, rank_free: preview('diamante') })));
  assert.match(contents(h.tree), /Usa 12 FREE por rango Oro/);
  assert.doesNotMatch(contents(h.tree), /15 FREE por rango Diamante/);
  assert.equal(h.posts().length, 0);
  await h.unmount();
});

test('Bronze keeps the initial seven-minute consultation and its existing balance check', async () => {
  const h = await mount({ rank: 'bronce' });
  await openConsultation(h.tree);
  await click(h.tree, 'Usar 7 min FREE iniciales');
  await click(h.tree, 'Siguiente');
  assert.match(contents(h.tree), /no dispone de 7 minutos free suficientes/);
  assert.equal(h.posts().length, 0);
  await h.unmount();
});

test('Silver, Gold and Diamond offer their gift from zero balance and never show seven FREE as a rank choice', async () => {
  for (const [rank, label, minutes] of [['plata', 'Plata', 10], ['oro', 'Oro', 12], ['diamante', 'Diamante', 15]]) {
    const h = await mount({ rank, balance: 0, offer: { previous_credit_minutes: 15 } });
    await openConsultation(h.tree);
    const buttons = h.tree.root.findAllByType('button').map(text);
    assert.equal(buttons.some(label => /7.*FREE|7.*free/.test(label)), false);
    assert.ok(buttons.some(text => text.startsWith(`Usa ${minutes} FREE por rango ${label}`) && text.includes('Para conocer a Josefa · una vez por cliente')));
    await click(h.tree, `Usa ${minutes} FREE por rango ${label}`);
    await click(h.tree, 'Siguiente');
    assert.match(contents(h.tree), /Saldo previsto al guardar: 0 FREE \+ 0 normales/);
    await click(h.tree, 'Registrar llamada');
    assert.equal(h.posts()[0].minutos_1, minutes);
    assert.equal(h.posts()[0].uso_tipo, 'rank_free');
    await h.unmount();
  }
});

test('an already used rank gift does not bring back the initial seven-minute option', async () => {
  const h = await mount({ rank: 'diamante', offer: { eligible: false, reason: 'ALREADY_USED' }, balance: 50 });
  await openConsultation(h.tree);
  assert.equal(h.tree.root.findAllByType('button').some(button => /7.*FREE|7.*free/.test(text(button))), false);
  assert.match(contents(h.tree), /ya utilizó el regalo/);
  await h.unmount();
});

test('a concurrent gift redemption updates the preview and prevents a second save', async () => {
  const h = await mount({ post: () => jsonResponse({ ok: false, error: 'ALREADY_USED', rank_free: preview('plata', { eligible: false, reason: 'ALREADY_USED' }), balance: { minutos_free_pendientes: 0, minutos_normales_pendientes: 0 } }, 409) });
  await openConsultation(h.tree); await click(h.tree, 'Usa 10 FREE por rango Plata'); await click(h.tree, 'Siguiente');
  await click(h.tree, 'Registrar llamada');
  assert.match(contents(h.tree), /ya utilizó el regalo/);
  assert.equal(h.tree.root.findAllByType('button').find(button => text(button) === 'Registrar llamada').props.disabled, true);
  await click(h.tree, 'Atrás');
  assert.equal(h.tree.root.findAllByType('button').some(button => text(button).startsWith('Usa ')), false);
  assert.equal(h.posts().length, 1); assert.equal(h.saved.length, 0);
  await h.unmount();
});

test('a changed effective rank requires selecting the updated gift before another save', async () => {
  const h = await mount({ post: () => jsonResponse({ ok: false, error: 'RANK_CHANGED', rank_free: preview('oro'), balance: { minutos_free_pendientes: 0, minutos_normales_pendientes: 0 } }, 409) });
  await openConsultation(h.tree); await click(h.tree, 'Usa 10 FREE por rango Plata'); await click(h.tree, 'Siguiente');
  await click(h.tree, 'Registrar llamada');
  assert.equal(h.tree.root.findAllByType('button').find(button => text(button) === 'Registrar llamada').props.disabled, true);
  await click(h.tree, 'Atrás');
  const next = h.tree.root.findAllByType('button').find(button => text(button) === 'Siguiente');
  await renderer.act(async () => next.props.onClick());
  assert.match(contents(h.tree), /Completa esta pregunta/);
  await click(h.tree, 'Usa 12 FREE por rango Oro');
  await click(h.tree, 'Siguiente');
  assert.match(contents(h.tree), /12 minutos FREE en el rendimiento de Josefa/);
  await h.unmount();
});

test('a late successful save cannot close or overwrite a newly selected client', async () => {
  const response = deferred();
  const h = await mount({ post: () => response.promise });
  await openConsultation(h.tree); await click(h.tree, 'Usa 10 FREE por rango Plata'); await click(h.tree, 'Siguiente');
  let saving;
  await renderer.act(async () => { saving = h.tree.root.findAllByType('button').find(button => text(button) === 'Registrar llamada').props.onClick(); });
  await renderer.act(async () => h.tree.update(React.createElement(h.Component, { ...h.props, cliente: { id: otherClient, nombre: 'Otra simulada' } })));
  await renderer.act(async () => { response.resolve(jsonResponse({ ok: true })); await saving; });
  assert.equal(h.closed.length, 0); assert.equal(h.saved.length, 0);
  assert.match(contents(h.tree), /Otra simulada/);
  assert.equal(h.posts().length, 1);
  await h.unmount();
});

test('closing without a selected client renders nothing instead of dereferencing an old preview', async () => {
  const h = await mount();
  await renderer.act(async () => h.tree.update(React.createElement(h.Component, { ...h.props, open: false, cliente: null })));
  assert.equal(h.tree.toJSON(), null);
  assert.equal(h.posts().length, 0);
  await h.unmount();
});

test('an uncertain 503 reports uncertainty and keeps the same operation available for retry', async () => {
  const h = await mount({ post: () => jsonResponse({ ok: false, error: 'RANK_FREE_REGISTER_FAILED' }, 503) });
  await openConsultation(h.tree); await click(h.tree, 'Usa 10 FREE por rango Plata'); await click(h.tree, 'Siguiente');
  await click(h.tree, 'Registrar llamada');
  assert.match(contents(h.tree), /No se pudo confirmar el resultado/);
  assert.doesNotMatch(contents(h.tree), /RANK_FREE_REGISTER_FAILED/);
  await click(h.tree, 'Registrar llamada');
  assert.deepEqual(h.posts()[0], h.posts()[1]);
  assert.equal(h.saved.length, 0);
  await h.unmount();
});
