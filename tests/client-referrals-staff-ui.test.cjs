const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), { act, create } = require('react-test-renderer');
const text = node => typeof node === 'string' ? node : (node?.children || []).map(text).join('');
const flush = async fn => act(async () => { fn?.(); await new Promise(resolve => setImmediate(resolve)); });
const response = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
const session = { supabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'staff-test-token' } } }) } }) };
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, console, AbortController, Event, URLSearchParams, ...globals, require(name) {
    if (name in mocks) return mocks[name];
    if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
    if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => props => React.createElement('span', { ...props, 'data-icon': key }) });
    return require(name);
  } });
  return exports;
}
const shared = load('src/lib/client-referrals.ts');
const rewardItem = (reward_type, amount, extras = {}) => ({ reward_type, amount, roulette_level: null, rank_key: null, rank_days: null, ...extras });
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
  const env = browser(), posts = [], historyRequests = [];
  let view, id = 0, networkFail = false, authListener;
  const rewards = [], claims = [];
  const f = { historyGet: null, user: 'staff-one' };
  const authSession = () => f.user ? { user: { id: f.user }, access_token: `staff-token-${f.user}` } : null;
  const staffSession = { supabaseBrowser: () => ({ auth: {
    getSession: async () => ({ data: { session: authSession() } }),
    onAuthStateChange(callback) { authListener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
  } }) };
  const Component = load('src/components/admin/ClientReferralRewardsAdminPanel.tsx', { '@/lib/supabase-browser': staffSession, '@/lib/client-referrals': shared }, {
    ...env, crypto: { randomUUID: () => `operation-${++id}` }, fetch: async (url, init) => {
      if (url.startsWith('/api/admin/referral-rewards/history?')) {
        historyRequests.push(url);
        if (f.historyGet) return f.historyGet(url, init);
        const params = new URLSearchParams(url.split('?')[1]);
        const offset = Number(params.get('offset')), limit = Number(params.get('limit'));
        return response({ ok: true, claims: claims.slice(offset, offset + limit), total: claims.length, offset, limit });
      }
      if (init.method === 'POST') {
        const body = JSON.parse(init.body); posts.push(body);
        if (networkFail) { networkFail = false; throw new Error('lost response'); }
        const reward = { ...body.reward, ...body.reward.reward_items[0], id: body.reward.id || 'reward-one', version: (body.expected_version || 0) + 1 };
        const index = rewards.findIndex(item => item.id === reward.id);
        if (index < 0) rewards.push(reward); else rewards[index] = reward;
        return response({ ok: true, reward });
      }
      return response({ ok: true, rewards: [...rewards] });
    },
  }).default;
  return Object.defineProperty(Object.assign(f, { posts, rewards, claims, historyRequests, getView() { return view; }, failNext() { networkFail = true; },
    async mount() { await flush(() => { view = create(React.createElement(Component)); }); },
    async edit() { await flush(() => {
      view.root.findByProps({ placeholder: 'Ej. Un momento para ti' }).props.onChange({ target: { value: 'Oro por recomendarnos' } });
      view.root.findAllByType('select')[0].props.onChange({ target: { value: 'rank' } });
    }); await flush(() => {
      view.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } });
      view.root.findAllByType('input').find(input => input.props.max === '365').props.onChange({ target: { value: '14' } });
    }); },
    async save() { await flush(() => view.root.findByProps({ 'aria-label': 'Editar premio de referidos' }).props.onSubmit({ preventDefault() {} })); },
    async click(label) { const button = view.root.findAllByType('button').find(button => text(button) === label); assert.ok(button, 'Expected button: ' + label); await flush(() => button.props.onClick()); },
    async field(label, value) { await flush(() => view.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value } })); },
    async filter() { await flush(() => view.root.findByProps({ 'aria-label': 'Filtrar historial de canjes' }).props.onSubmit({ preventDefault() {} })); },
    async switchStaff(user) { f.user = user; await flush(() => authListener(user ? 'SIGNED_IN' : 'SIGNED_OUT', authSession())); },
    async unmount() { await flush(() => view.unmount()); },
  }), 'view', { get: () => view });
}

test('admin creates an explicit temporary rank reward without inventing configured rewards', async () => {
  const f = adminFixture(); await f.mount();
  assert.equal(f.posts.length, 0);
  assert.match(text(f.view.toJSON()), /Tu primer premio empieza aquí/);
  assert.match(text(f.view.toJSON()), /superar 10 €/);
  await f.edit(); await f.save();
  const saved = f.posts[0];
  assert.equal(saved.expected_version, null);
  assert.equal(saved.reward.reward_items.length, 1);
  assert.equal(saved.reward.reward_items[0].reward_type, 'rank');
  assert.equal(saved.reward.reward_items[0].rank_key, 'oro');
  assert.equal(saved.reward.reward_items[0].rank_days, 14);
  assert.equal(saved.reward.referrals_required, 3);
  assert.equal(saved.reward.enabled, true);
  assert.equal(saved.reward.reward_items[0].roulette_level, null);
  assert.equal(saved.reward.reward_items[0].amount, 1);
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
  assert.equal(f.posts[0].reward.reward_items[0].roulette_level, 4);
  assert.equal(f.posts[0].reward.reward_items[0].amount, 2);
  assert.equal(f.posts[0].reward.enabled, false);
  await f.unmount();
});

test('admin saves all bundle components with one referral cost and preserves the bundle on an uncertain retry', async () => {
  const f = adminFixture(); await f.mount();
  await flush(() => {
    f.view.root.findByProps({ placeholder: 'Ej. Un momento para ti' }).props.onChange({ target: { value: 'Premio combinado de prueba' } });
    f.view.root.findByProps({ max: '1000' }).props.onChange({ target: { value: '1' } });
  });
  await f.field('Tipo de recompensa 1', 'free_minutes');
  await f.field('Cantidad de recompensa 1', '15');
  await f.click('Añadir recompensa');
  await f.field('Tipo de recompensa 2', 'coins');
  await f.field('Cantidad de recompensa 2', '30');
  await f.click('Añadir recompensa');
  await f.field('Tipo de recompensa 3', 'roulette');
  await f.field('Cantidad de recompensa 3', '2');
  await f.field('Ruleta de recompensa 3', '4');
  await f.click('Añadir recompensa');
  await f.field('Tipo de recompensa 4', 'oracle');
  await f.field('Cantidad de recompensa 4', '3');
  assert.match(text(f.view.toJSON()), /15 Minutos FREE \+ 30 Coins \+ 2 Giros de ruleta · Nivel 4 \+ 3 Tiradas de Oráculo/);
  assert.match(text(f.view.toJSON()), /1 referido · Un solo canje/);
  f.failNext(); await f.save();
  assert.equal(f.view.root.findByType('fieldset').props.disabled, true);
  await f.save();
  assert.equal(f.posts.length, 2);
  assert.deepEqual(f.posts[0], f.posts[1]);
  assert.equal(f.posts[0].reward.referrals_required, 1);
  assert.deepEqual(f.posts[0].reward.reward_items, [rewardItem('free_minutes', 15), rewardItem('coins', 30), rewardItem('roulette', 2, { roulette_level: 4 }), rewardItem('oracle', 3)]);
  assert.equal(f.rewards.length, 1);
  await f.unmount();
});

test('bundle editor preserves saved items, permits distinct roulette levels and prevents removing its last item', async () => {
  const f = adminFixture();
  f.rewards.push({ id: 'bundle', title: 'Conjunto guardado', referrals_required: 1, reward_type: 'coins', amount: 999, roulette_level: null, rank_key: null, rank_days: null, enabled: true, version: 4,
    reward_items: [rewardItem('free_minutes', 15), rewardItem('roulette', 1, { roulette_level: 1 })] });
  await f.mount();
  await flush(() => f.view.root.findAllByType('button').find(button => text(button).includes('Conjunto guardado')).props.onClick());
  assert.equal(f.view.root.findByProps({ 'aria-label': 'Tipo de recompensa 1' }).props.value, 'free_minutes');
  assert.equal(f.view.root.findByProps({ 'aria-label': 'Cantidad de recompensa 1' }).props.value, '15');
  await f.click('Añadir recompensa');
  const type = f.view.root.findByProps({ 'aria-label': 'Tipo de recompensa 3' });
  assert.equal(type.findAllByType('option').find(option => option.props.value === 'free_minutes').props.disabled, true);
  await f.field('Tipo de recompensa 3', 'roulette');
  const level = f.view.root.findByProps({ 'aria-label': 'Ruleta de recompensa 3' });
  assert.equal(level.props.value, '2');
  assert.equal(level.findAllByType('option').find(option => option.props.value === '1').props.disabled, true);
  await flush(() => f.view.root.findByProps({ 'aria-label': 'Eliminar recompensa 3' }).props.onClick());
  await flush(() => f.view.root.findByProps({ 'aria-label': 'Eliminar recompensa 2' }).props.onClick());
  assert.equal(f.view.root.findByProps({ 'aria-label': 'Eliminar recompensa 1' }).props.disabled, true);
  await f.save();
  assert.equal(f.posts[0].expected_version, 4);
  assert.deepEqual(f.posts[0].reward.reward_items, [rewardItem('free_minutes', 15)]);
  await f.unmount();
});

test('admin history renders the delivered snapshot and filters or pages without changing the editor draft', async () => {
  const f = adminFixture();
  f.rewards.push({ id: 'existing', title: 'Premio editado', referrals_required: 4, reward_type: 'coins', amount: 500, roulette_level: null, rank_key: null, rank_days: null, enabled: true, version: 8 });
  for (let i = 0; i < 26; i++) f.claims.push({ id: `claim-${i}`, created_at: '2026-11-25T12:00:00Z', cliente_id: 'client-a', client_name: 'Cliente de prueba', client_phone: '+34123456789', reward_id: 'existing', reward_title: 'Premio original', reward_description: '15 minutos FREE + 30 Coins', reward_items: [rewardItem('free_minutes', 15), rewardItem('coins', 30)], referrals_used: 1, status: 'delivered' });
  await f.mount();
  const history = f.view.root.findByProps({ 'aria-labelledby': 'referral-claims-history-title' });
  assert.match(text(history), /Premio original/);
  assert.match(text(history), /15 minutos FREE \+ 30 Coins/);
  assert.match(text(history), /Entregado/);
  assert.match(text(history), /\+34123456789/);
  assert.equal(history.findAllByType('details').length, 25);
  assert.equal(history.findAllByProps({ className: 'referralCount' })[0].children[0], '1');
  assert.equal(history.findAllByType('a')[0].props.href, '/admin?tab=crm&open_cliente_id=client-a');
  assert.equal(history.findAllByType('a')[0].props.target, '_blank');
  assert.match(text(history.findAllByType('time')[0]), /13:00/);
  await flush(() => f.view.root.findByProps({ placeholder: 'Ej. Un momento para ti' }).props.onChange({ target: { value: 'Borrador sin guardar' } }));
  await f.click('Siguiente');
  assert.equal(new URLSearchParams(f.historyRequests.at(-1).split('?')[1]).get('offset'), '25');
  assert.equal(f.view.root.findAllByType('details').length, 1);
  const filters = f.view.root.findByProps({ 'aria-label': 'Filtrar historial de canjes' });
  await flush(() => {
    filters.findByProps({ type: 'search' }).props.onChange({ target: { value: 'Cliente +34' } });
    filters.findByType('select').props.onChange({ target: { value: 'existing' } });
    filters.findAllByProps({ type: 'date' })[0].props.onChange({ target: { value: '2026-11-01' } });
    filters.findAllByProps({ type: 'date' })[1].props.onChange({ target: { value: '2026-11-30' } });
  });
  await f.filter();
  const params = new URLSearchParams(f.historyRequests.at(-1).split('?')[1]);
  assert.equal(params.get('q'), 'Cliente +34'); assert.equal(params.get('reward_id'), 'existing');
  assert.equal(params.get('from'), '2026-11-01'); assert.equal(params.get('to'), '2026-11-30');
  assert.equal(params.get('offset'), '0'); assert.equal(params.get('limit'), '25');
  assert.equal(f.view.root.findByProps({ placeholder: 'Ej. Un momento para ti' }).props.value, 'Borrador sin guardar');
  assert.equal(f.posts.length, 0);
  await f.unmount();
});

test('history clears client details on account changes, authorization errors and sign-out', async () => {
  const f = adminFixture();
  f.claims.push({ id: 'private-claim', created_at: '2026-11-25T12:00:00Z', cliente_id: 'private-client', client_name: 'Nombre privado', client_phone: 'Telefono privado', reward_id: 'reward-one', reward_title: 'Premio privado', reward_description: '30 Coins', reward_items: [rewardItem('coins', 30)], referrals_used: 1, status: 'delivered' });
  await f.mount(); assert.match(text(f.view.toJSON()), /Nombre privado/);
  let resolveAccount;
  f.historyGet = () => new Promise(resolve => { resolveAccount = resolve; });
  await f.switchStaff('staff-two');
  assert.doesNotMatch(text(f.view.toJSON()), /Nombre privado|Telefono privado/);
  await flush(() => resolveAccount(response({ ok: true, claims: [], total: 0 })));
  f.historyGet = null; await f.click('Actualizar historial');
  assert.match(text(f.view.toJSON()), /Nombre privado/);
  f.historyGet = async () => response({ ok: false, error: 'No autorizado' }, 403);
  await f.click('Actualizar historial');
  assert.doesNotMatch(text(f.view.toJSON()), /Nombre privado|Telefono privado/);
  assert.match(text(f.view.toJSON()), /No autorizado/);
  f.historyGet = null; await f.click('Actualizar historial');
  assert.match(text(f.view.toJSON()), /Nombre privado/);
  await f.switchStaff(null);
  assert.doesNotMatch(text(f.view.toJSON()), /Nombre privado|Telefono privado/);
  assert.match(text(f.view.toJSON()), /sesión ha caducado/);
  await f.unmount();
});

test('history rejects an inverted date range and ignores late results from a previous filter', async () => {
  const f = adminFixture(); await f.mount();
  let resolvePrevious;
  f.historyGet = async url => {
    const q = new URLSearchParams(url.split('?')[1]).get('q');
    if (q === 'Primero') return new Promise(resolve => { resolvePrevious = resolve; });
    return response({ ok: true, claims: [], total: 0 });
  };
  const filters = f.view.root.findByProps({ 'aria-label': 'Filtrar historial de canjes' });
  await flush(() => {
    filters.findAllByProps({ type: 'date' })[0].props.onChange({ target: { value: '2026-11-30' } });
    filters.findAllByProps({ type: 'date' })[1].props.onChange({ target: { value: '2026-11-01' } });
  });
  const previousRequestCount = f.historyRequests.length;
  await f.filter();
  assert.equal(f.historyRequests.length, previousRequestCount);
  assert.match(text(f.view.toJSON()), /fecha inicial no puede ser posterior/);
  await f.click('Limpiar filtros');
  await flush(() => filters.findByProps({ type: 'search' }).props.onChange({ target: { value: 'Primero' } }));
  await f.filter();
  await flush(() => filters.findByProps({ type: 'search' }).props.onChange({ target: { value: 'Segundo' } }));
  await f.filter();
  await flush(() => resolvePrevious(response({ ok: true, claims: [{ id: 'late', created_at: '2026-11-25T12:00:00Z', cliente_id: 'client-late', client_name: 'Resultado antiguo', client_phone: '123', reward_title: 'Premio antiguo', reward_description: '100 Coins', reward_items: [rewardItem('coins', 100)], referrals_used: 1, status: 'delivered' }], total: 1 })));
  assert.doesNotMatch(text(f.view.toJSON()), /Resultado antiguo/);
  assert.match(text(f.view.toJSON()), /No hay canjes que coincidan/);
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
