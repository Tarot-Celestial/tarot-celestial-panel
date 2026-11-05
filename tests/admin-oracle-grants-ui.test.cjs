const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

const source = fs.readFileSync(path.join(__dirname, '../src/components/admin/ClientBalancesPanel.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const clients = ['Uno', 'Dos'].map(id => ({ id, nombre: id, apellido: 'Prueba', telefono: '', email: '' }));
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const event = { preventDefault() {} };
const text = node => typeof node === 'string' ? node : (node?.children || []).map(text).join('');
const flush = fn => act(async () => { fn(); await new Promise(resolve => setImmediate(resolve)); });

async function fixture(t) {
  const posts = [];
  const balances = new Map(clients.map(c => [c.id, { credits: 4, history: [] }]));
  const api = { post: () => { throw new Error('No se esperaba una concesión.'); } };
  let ids = 0;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: name => name === '@/lib/supabase-browser'
      ? { supabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'test' } } }) } }) }
      : name.endsWith('.module.css') ? { default: {} } : require(name),
    window: { setInterval() { return 1; }, clearInterval() {}, addEventListener() {}, removeEventListener() {} },
    document: { hidden: false }, crypto: { randomUUID: () => `operation-${++ids}` },
    fetch: async (url, init) => {
      if (init.method === 'POST') {
        posts.push(JSON.parse(init.body));
        return api.post(posts.at(-1));
      }
      const search = new URL(url, 'https://test.invalid').searchParams;
      if (search.has('q')) return response({ ok: true, clients });
      const id = search.get('id');
      return response({ ok: true, cliente: clients.find(c => c.id === id), oracle: balances.get(id),
        wallet: { coins: 8, minutes_total: 2, minutes_normal: 2, minutes_free: 0 },
        spins: [], history: [], coins_history: [] });
    },
  });
  let view;
  await act(async () => { view = create(React.createElement(exports.default)); });
  t.after(() => act(() => view.unmount()));
  const btn = label => view.root.findAllByType('button').find(b => text(b) === label);
  const choose = id => flush(() => btn(`${id} Prueba${id}`).props.onClick());
  const form = () => view.root.findByProps({ 'aria-label': 'Conceder tiradas del Oráculo' });
  const fill = (amount, reason) => flush(() => {
    form().findByType('input').props.onChange({ target: { value: amount } });
    form().findByType('textarea').props.onChange({ target: { value: reason } });
  });
  const review = () => flush(() => form().props.onSubmit(event));
  await flush(() => view.root.findByType('input').props.onChange({ target: { value: 'Prueba' } }));
  await flush(() => view.root.findByType('form').props.onSubmit(event));
  return { view, api, posts, balances, btn, choose, form, fill, review };
}

test('requires an explicit valid review for this client and clears it on selection change', async t => {
  const f = await fixture(t);
  await f.choose('Uno');
  for (const amount of ['0', '1.5', '101']) {
    await f.fill(amount, 'Premio ficticio'); await f.review();
    assert.equal(f.btn('Confirmar y añadir tiradas'), undefined);
  }
  await f.fill('2', 'Premio ficticio'); await f.review();
  assert.ok(f.btn('Confirmar y añadir tiradas'));
  await f.choose('Uno');
  assert.ok(f.btn('Confirmar y añadir tiradas'));
  assert.equal(f.posts.length, 0);
  await f.choose('Dos');
  assert.equal(f.btn('Confirmar y añadir tiradas'), undefined);
  assert.equal(f.form().findByType('input').props.value, '');
  f.balances.set('Dos', null);
  await flush(() => f.btn('Actualizar saldos').props.onClick());
  assert.ok(text(f.view.toJSON()).includes('No se pudo cargar el saldo de tiradas'));
  assert.equal(f.view.root.findAllByProps({ 'aria-label': 'Conceder tiradas del Oráculo' }).length, 0);
});

test('lost response and double confirmation preserve the same operation and display one audited grant', async t => {
  const f = await fixture(t);
  await f.choose('Uno');
  await f.fill('3', 'Premio ficticio'); await f.review();
  f.api.post = () => { throw new Error('response lost'); };
  await flush(() => {
    const confirm = f.btn('Confirmar y añadir tiradas');
    confirm.props.onClick(event); confirm.props.onClick(event);
  });
  assert.equal(f.posts.length, 1);
  assert.equal(f.btn('Dos PruebaDos').props.disabled, true);
  const original = f.posts[0];
  assert.equal(original.action, 'oracle');
  assert.equal(original.amount, 3);
  assert.equal(original.cliente_id, 'Uno');
  const grant = { ...original, before_balance: 4, after_balance: 7, actor_name: 'Admin de prueba',
    created_at: '2026-11-05T10:00:00Z', movement_id: 'movement-fixture', replayed: true };
  f.api.post = () => {
    f.balances.set('Uno', { credits: 7, history: [grant] });
    return response({ ok: true, adjustment: grant });
  };
  await flush(() => f.btn('Comprobar la misma concesión').props.onClick(event));
  assert.deepEqual(f.posts, [original, original]);
  assert.equal(f.form().findByType('input').props.value, '');
  const panel = text(f.view.toJSON());
  assert.ok(panel.includes('7 tiradas'));
  assert.ok(panel.includes('Concedido por Admin de prueba'));
  assert.ok(panel.includes('Concesión confirmada para Uno Prueba'));
  assert.equal(f.btn('Comprobar la misma concesión'), undefined);
});
