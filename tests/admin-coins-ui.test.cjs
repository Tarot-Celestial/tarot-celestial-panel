const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

const clients = [
  { id: 'ana', nombre: 'Ana', apellido: 'Prueba', telefono: '123', email: 'ana@example.test' },
  { id: 'beto', nombre: 'Beto', apellido: 'Prueba', telefono: '456', email: 'beto@example.test' },
];
const detail = (id = 'ana', coins = 100) => ({
  ok: true, cliente: clients.find(c => c.id === id),
  wallet: { coins, minutes_total: 19, minutes_free: 7, minutes_normal: 12, effective_rank: 'oro' },
  spins: [1, 2, 3, 4, 5].map(level => ({ level, count: level, available: level })),
  history: [], coins_history: [],
});
const audit = { operation_id: 'op-1', amount: 50, before_balance: 100, after_balance: 150, reason: 'Premio acordado', created_at: '2026-10-26T10:00:00Z', movement_id: 'movement-1' };
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const text = node => typeof node === 'string' ? node : (node?.children || []).map(text).join('');
const flush = async fn => act(async () => { fn?.(); await new Promise(resolve => setImmediate(resolve)); });
const submit = { preventDefault() {} };

async function setup(t, overrides = {}) {
  const state = { posts: [], reads: [], uuidCount: 0, current: detail(), read: null, post: null, ...overrides };
  const exports = {};
  const filename = path.join(__dirname, '../src/components/admin/ClientBalancesPanel.tsx');
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports,
    require: value => value === '@/lib/supabase-browser' ? { supabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'fixture' } } }) } }) } : value.endsWith('.module.css') ? { default: {} } : require(value),
    window: { setInterval: () => 1, clearInterval() {}, addEventListener() {}, removeEventListener() {} },
    document: { hidden: false },
    crypto: { randomUUID: () => `op-${++state.uuidCount}` },
    fetch: async (url, init) => {
      if (init.method === 'POST') {
        state.posts.push(JSON.parse(init.body));
        return state.post ? state.post(state.posts.at(-1)) : response({ ok: true, adjustment: audit });
      }
      if (url.includes('?q=')) return response({ ok: true, clients });
      const id = new URL(url, 'https://fixture.test').searchParams.get('id');
      state.reads.push(id);
      return state.read ? state.read(id) : response(state.current);
    },
  });
  let view;
  await act(async () => { view = create(React.createElement(exports.default)); });
  t.after(() => act(() => view.unmount()));
  const coinsForm = () => view.root.findAllByType('form').find(f => f.props['aria-labelledby'] === 'admin-add-coins-title');
  const spinsForm = () => view.root.findByProps({ 'aria-label': 'Ajustar giros' });
  const choose = async id => flush(() => view.root.findAllByType('button').find(b => text(b) === `${clients.find(c => c.id === id).nombre} Prueba${clients.find(c => c.id === id).telefono}`).props.onClick());
  const fill = async (amount = '50', reason = 'Premio acordado') => flush(() => {
    coinsForm().findByType('input').props.onChange({ target: { value: amount } });
    coinsForm().findByType('textarea').props.onChange({ target: { value: reason } });
  });
  await flush(() => view.root.findByType('input').props.onChange({ target: { value: 'Prueba' } }));
  await flush(() => view.root.findByType('form').props.onSubmit(submit));
  return { state, view, coinsForm, spinsForm, choose, fill };
}

test('Coins form is separate, validates positive integers/reason, and displays authoritative balances/history', async t => {
  const fixture = await setup(t);
  const { state, view, coinsForm, spinsForm, choose, fill } = fixture;
  await choose('ana');
  assert.ok(text(coinsForm()).includes('Ana Prueba'));
  assert.ok(text(spinsForm()).includes('Ajustar giros'));
  for (const amount of ['', '-1', '0', '1.5', '1000001']) {
    await fill(amount);
    assert.equal(coinsForm().findByType('button').props.disabled, true);
    await flush(() => coinsForm().props.onSubmit(submit));
  }
  await fill('50', '   ');
  await flush(() => coinsForm().props.onSubmit(submit));
  assert.equal(state.posts.length, 0);
  await fill();
  assert.ok(text(coinsForm()).includes('Saldo actual 100 Coins'));
  assert.ok(text(coinsForm()).includes('Saldo tras añadir 150 Coins'));
  state.post = () => {
    state.current = { ...detail('ana', 180), coins_history: [{ ...audit, before_balance: 130, after_balance: 180 }] };
    return response({ ok: true, adjustment: { ...audit, before_balance: 130, after_balance: 180 } });
  };
  await flush(() => coinsForm().props.onSubmit(submit));
  assert.equal(state.posts.length, 1);
  assert.deepEqual(state.posts[0], { action: 'coins', operation_id: 'op-1', cliente_id: 'ana', amount: 50, reason: 'Premio acordado' });
  assert.ok(text(view.toJSON()).includes('Saldo: 130 → 180 Coins'));
  assert.ok(text(view.toJSON()).includes('+50 Coins · 130 → 180'));
  assert.ok(text(view.toJSON()).includes('Historial de ajustes de giros'));
  assert.equal(coinsForm().findByType('input').props.value, '');
  assert.equal(spinsForm().findByType('fieldset').props.disabled, false);
});

test('lost response and later 403 keep original payload, block client/form switching and retry once', async t => {
  const { state, view, coinsForm, spinsForm, choose, fill } = await setup(t);
  await choose('ana'); await fill();
  state.post = () => { throw new Error('connection lost after send'); };
  await flush(() => coinsForm().props.onSubmit(submit));
  assert.equal(coinsForm().findByType('fieldset').props.disabled, true);
  assert.equal(spinsForm().findByType('button').props.disabled, true);
  await fill('999', 'Different payload');
  await choose('beto');
  await flush(() => spinsForm().props.onSubmit(submit));
  assert.equal(state.posts.length, 1);
  assert.equal(coinsForm().findByType('input').props.value, '50');
  assert.ok(text(coinsForm()).includes('Ana Prueba'));
  state.post = () => response({ ok: false, code: 'FORBIDDEN', error: 'Vuelve a iniciar sesión' }, 403);
  await flush(() => coinsForm().props.onSubmit(submit));
  assert.equal(coinsForm().findByType('fieldset').props.disabled, true);
  state.post = () => { state.current = detail('ana', 150); return response({ ok: true, adjustment: audit }); };
  await flush(() => coinsForm().props.onSubmit(submit));
  assert.equal(state.posts.length, 3);
  assert.deepEqual(state.posts[0], state.posts[1]);
  assert.deepEqual(state.posts[1], state.posts[2]);
  assert.equal(state.uuidCount, 1);
  assert.equal(coinsForm().findByType('fieldset').props.disabled, false);
  assert.ok(text(view.toJSON()).includes('Coins añadidos a Ana Prueba'));
});

test('rapid double submit sends once and a pre-save GET cannot overwrite the refreshed balance', async t => {
  const { state, view, coinsForm, choose, fill } = await setup(t);
  await choose('ana'); await fill();
  const stale = deferred(); const pendingPost = deferred();
  state.read = () => stale.promise;
  await flush(() => view.root.findAllByType('button').find(b => text(b) === 'Actualizar saldos').props.onClick());
  state.post = () => pendingPost.promise;
  await flush(() => { coinsForm().props.onSubmit(submit); coinsForm().props.onSubmit(submit); });
  assert.equal(state.posts.length, 1);
  state.read = () => response(detail('ana', 150));
  await flush(() => pendingPost.resolve(response({ ok: true, adjustment: audit })));
  await flush(() => stale.resolve(response(detail('ana', 999))));
  assert.ok(text(coinsForm()).includes('Saldo actual 150 Coins'));
  assert.ok(!text(coinsForm()).includes('999 Coins'));
});

test('switching clients ignores the previous client detail response', async t => {
  const { state, coinsForm, choose } = await setup(t);
  const stale = deferred();
  state.read = id => id === 'ana' ? stale.promise : response(detail('beto', 22));
  await choose('ana');
  await choose('beto');
  assert.ok(text(coinsForm()).includes('Beto Prueba'));
  await flush(() => stale.resolve(response(detail('ana', 999))));
  assert.ok(text(coinsForm()).includes('Saldo actual 22 Coins'));
  assert.ok(!text(coinsForm()).includes('999 Coins'));
});

test('confirmed POST stays confirmed when GET refresh fails; no second grant is offered', async t => {
  const { state, view, coinsForm, choose, fill } = await setup(t);
  await choose('ana'); await fill();
  state.post = () => { state.read = () => { throw new Error('refresh failed'); }; return response({ ok: true, adjustment: audit }); };
  await flush(() => coinsForm().props.onSubmit(submit));
  assert.ok(text(view.toJSON()).includes('Coins añadidos a Ana Prueba'));
  assert.ok(text(coinsForm()).includes('Saldo actual 150 Coins'));
  assert.equal(coinsForm().findByType('input').props.value, '');
  assert.equal(coinsForm().findByType('fieldset').props.disabled, false);
  assert.equal(coinsForm().findByType('button').props.disabled, true);
  await flush(() => coinsForm().props.onSubmit(submit));
  assert.equal(state.posts.length, 1);
  assert.ok(!text(coinsForm()).includes('Comprobar y reintentar'));
});

test('operation conflict is retained for reconciliation rather than issuing a new UUID', async t => {
  const { state, coinsForm, choose, fill } = await setup(t);
  await choose('ana'); await fill();
  state.post = () => response({ ok: false, code: 'OPERATION_CONFLICT', error: 'Operación previa con otros datos; revisa el historial.' }, 409);
  await flush(() => coinsForm().props.onSubmit(submit));
  await flush(() => coinsForm().props.onSubmit(submit));
  assert.equal(coinsForm().findByType('fieldset').props.disabled, true);
  assert.deepEqual(state.posts[0], state.posts[1]);
  assert.equal(state.uuidCount, 1);
});
