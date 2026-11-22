const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), { act, create } = require('react-test-renderer');
const text = node => typeof node === 'string' ? node : (node?.children || []).map(text).join('');
const flush = async fn => act(async () => { fn?.(); await new Promise(resolve => setImmediate(resolve)); });
const response = payload => ({ ok: true, status: 200, json: async () => payload });
const session = { supabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'staff-test-token' } } }) } }) };
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, console, AbortController, Event, ...globals, require(name) {
    if (name in mocks) return mocks[name];
    if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
    if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => props => React.createElement('span', { ...props, 'data-icon': key }) });
    return require(name);
  } });
  return exports;
}
const shared = load('src/lib/client-referrals.ts');
function browser() {
  let nextId = 0;
  const timers = new Map(), listeners = new Map();
  return {
    window: {
      setTimeout(fn, ms) { const id = ++nextId; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
      setInterval() { return ++nextId; }, clearInterval() {},
      addEventListener(event, fn) { listeners.set(event, fn); }, removeEventListener(event) { listeners.delete(event); }, dispatchEvent() {},
    },
    document: { hidden: false },
    async debounce() { await flush(() => { for (const [id, timer] of timers) if (timer.ms === 300) { timers.delete(id); timer.fn(); } }); },
  };
}
function adminFixture() {
  const env = browser(), posts = [];
  let view, id = 0, networkFail = false;
  const rewards = [];
  const Component = load('src/components/admin/ClientReferralRewardsAdminPanel.tsx', { '@/lib/supabase-browser': session, '@/lib/client-referrals': shared }, {
    ...env, crypto: { randomUUID: () => `operation-${++id}` }, fetch: async (_url, init) => {
      if (init.method === 'POST') {
        const body = JSON.parse(init.body); posts.push(body);
        if (networkFail) { networkFail = false; throw new Error('lost response'); }
        const reward = { ...body.reward, id: body.reward.id || 'reward-one', version: (body.expected_version || 0) + 1 };
        const index = rewards.findIndex(item => item.id === reward.id);
        if (index < 0) rewards.push(reward); else rewards[index] = reward;
        return response({ ok: true, reward });
      }
      return response({ ok: true, rewards: [...rewards] });
    },
  }).default;
  return { posts, rewards, get view() { return view; }, failNext() { networkFail = true; },
    async mount() { await flush(() => { view = create(React.createElement(Component)); }); },
    async edit() { await flush(() => {
      view.root.findByProps({ placeholder: 'Ej. Un momento para ti' }).props.onChange({ target: { value: 'Oro por recomendarnos' } });
      view.root.findAllByType('select')[0].props.onChange({ target: { value: 'rank' } });
    }); await flush(() => {
      view.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } });
      view.root.findAllByType('input').find(input => input.props.max === '365').props.onChange({ target: { value: '14' } });
    }); },
    async save() { await flush(() => view.root.findByType('form').props.onSubmit({ preventDefault() {} })); },
    async unmount() { await flush(() => view.unmount()); },
  };
}

test('admin creates an explicit temporary rank reward without inventing configured rewards', async () => {
  const f = adminFixture(); await f.mount();
  assert.equal(f.posts.length, 0);
  assert.match(text(f.view.toJSON()), /Tu primer premio empieza aquí/);
  assert.match(text(f.view.toJSON()), /superar 10 €/);
  await f.edit(); await f.save();
  const saved = f.posts[0];
  assert.equal(saved.expected_version, null);
  assert.equal(saved.reward.reward_type, 'rank');
  assert.equal(saved.reward.rank_key, 'oro');
  assert.equal(saved.reward.rank_days, 14);
  assert.equal(saved.reward.referrals_required, 3);
  assert.equal(saved.reward.enabled, true);
  assert.equal(saved.reward.roulette_level, null);
  assert.equal(saved.reward.amount, 1);
  assert.equal(f.rewards.length, 1);
  await f.unmount();
});

test('uncertain catalog save locks its draft and retries the same operation', async () => {
  const f = adminFixture(); await f.mount(); await f.edit(); f.failNext(); await f.save();
  assert.match(text(f.view.toJSON()), /No se ha confirmado el guardado/);
  assert.equal(f.view.root.findByType('fieldset').props.disabled, true);
  assert.equal(f.view.root.findAllByType('button').find(button => text(button) === 'Nuevo').props.disabled, true);
  await f.save();
  assert.equal(f.posts.length, 2);
  assert.equal(f.posts[0].operation_id, f.posts[1].operation_id);
  assert.deepEqual(f.posts[0], f.posts[1]);
  assert.equal(f.rewards.length, 1);
  await f.unmount();
});

test('catalog edit sends the read version and all saved reward parameters', async () => {
  const f = adminFixture();
  f.rewards.push({ id: 'existing', title: 'Giros Especiales', referrals_required: 5, reward_type: 'roulette', amount: 2, roulette_level: 4, rank_key: null, rank_days: null, enabled: true, version: 8 });
  await f.mount();
  await flush(() => f.view.root.findAllByType('button').find(button => text(button).includes('Giros Especiales')).props.onClick());
  await flush(() => f.view.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: false } }));
  await f.save();
  assert.equal(f.posts[0].expected_version, 8);
  assert.equal(f.posts[0].reward.id, 'existing');
  assert.equal(f.posts[0].reward.roulette_level, 4);
  assert.equal(f.posts[0].reward.amount, 2);
  assert.equal(f.posts[0].reward.enabled, false);
  await f.unmount();
});

test('CRM immediately hides another selected client snapshot while the next request is pending', async () => {
  const env = browser(); let view, resolveSecond;
  const module = load('src/components/crm/ClientReferralsPanel.tsx', { '@/lib/supabase-browser': session, '@/lib/client-referrals': shared, '@/components/cliente/ClientReferralRewards': { ReferralProgress: () => null } }, {
    ...env, fetch: async url => {
      if (url.includes('client-b')) return new Promise(resolve => { resolveSecond = resolve; });
      return response({ ok: true, summary: { total: 9, available: 5, claimed: 3, pending: 1, oracle_credits: 4 }, referrals: [], rewards: [], claims: [], qualification: 'purchases_over_10', claim_mode: 'consume' });
    },
  });
  function Controller({ clientId }) { const state = module.useCRMReferrals(clientId); return React.createElement('output', null, state.data ? String(state.data.summary.total) : 'loading'); }
  await flush(() => { view = create(React.createElement(Controller, { clientId: 'client-a' })); });
  assert.equal(text(view.toJSON()), '9');
  await flush(() => view.update(React.createElement(Controller, { clientId: 'client-b' })));
  assert.equal(text(view.toJSON()), 'loading');
  await flush(() => resolveSecond(response({ ok: true, summary: { total: 1, available: 0, claimed: 0, pending: 1, oracle_credits: 0 }, referrals: [], rewards: [], claims: [], qualification: 'purchases_over_10', claim_mode: 'consume' })));
  assert.equal(text(view.toJSON()), '1');
  await flush(() => view.unmount());
});

test('CRM requires a deliberate link and displays real claimed state', async () => {
  const env = browser(), posts = []; let view, refreshes = 0;
  const Component = load('src/components/crm/ClientReferralsPanel.tsx', { '@/lib/supabase-browser': session, '@/lib/client-referrals': shared, '@/components/cliente/ClientReferralRewards': { ReferralProgress: () => null } }, {
    ...env, crypto: { randomUUID: () => 'link-operation' }, fetch: async (_url, init) => {
      if (init.method === 'POST') { posts.push(JSON.parse(init.body)); return response({ ok: true }); }
      return response({ ok: true, clients: [{ id: 'client-b', nombre: 'Referido de prueba', telefono: '123' }] });
    },
  }).default;
  const state = { loading: false, error: '', refresh: async () => { refreshes++; }, data: { summary: { total: 1, available: 0, claimed: 1, pending: 0 }, rewards: [], claims: [], qualification: 'purchases_over_10', claim_mode: 'consume', referrals: [{ id: 'link-existing', name: 'Anterior de prueba', status: 'claimed', created_at: '2026-11-20', claimed_at: '2026-11-21', reward_title: 'Premio guardado' }] } };
  await flush(() => { view = create(React.createElement(Component, { clientId: 'client-a', clientName: 'Titular de prueba', state })); });
  assert.equal(view.root.findByProps({ 'data-status': 'claimed' }).children.map(text).join(''), 'Reclamado');
  assert.equal(posts.length, 0);
  await flush(() => view.root.findAllByType('button').find(button => text(button).includes('Añadir referido')).props.onClick());
  await flush(() => view.root.findByType('input').props.onChange({ target: { value: 'Referido' } })); await env.debounce();
  await flush(() => view.root.findAllByType('button').find(button => text(button).includes('Referido de prueba')).props.onClick());
  assert.equal(posts.length, 0);
  await flush(() => view.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].cliente_id, 'client-a');
  assert.equal(posts[0].referred_cliente_id, 'client-b');
  assert.equal(posts[0].action, 'add');
  assert.equal(refreshes, 1);
  await flush(() => view.unmount());
});
