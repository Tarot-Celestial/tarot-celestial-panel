const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), { act, create } = require('react-test-renderer');
const root = path.join(__dirname, '..');
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const text = node => typeof node === 'string' ? node : (node?.children || []).map(text).join('');
const flush = async action => act(async () => { action?.(); await new Promise(resolve => setImmediate(resolve)); });

function load(file, mocks = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, console, AbortController, Event, ...globals, require(name) {
    if (name in mocks) return mocks[name];
    if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => key }) };
    if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => props => React.createElement('span', { ...props, 'data-icon': key }) });
    return require(name);
  } });
  return exports;
}
const definitions = load('src/lib/client-referrals.ts');
const reward = { id: id(10), title: 'Premio de prueba', referrals_required: 3, reward_type: 'coins', amount: 100, roulette_level: null, rank_key: null, rank_days: null, enabled: true, version: 2, claimable: true };
const initial = () => ({ ok: true, summary: { total: 4, available: 3, pending: 1, claimed: 0 }, rewards: [{ ...reward }], referrals: [{ id: id(20), name: 'Ana', status: 'available', created_at: '2026-11-22T10:00:00Z', claimed_at: null, reward_title: null }], claims: [], qualification: 'purchases_over_10', claim_mode: 'consume' });
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function fixture() {
  let view, listener, serial = 100, nextTimer = 0;
  const storage = new Map(), listeners = new Map(), timers = new Map(), posts = [];
  const f = { state: initial(), user: 'owner-one', post: async () => response({ ok: true, receipt: { id: id(90) } }), get: null };
  const add = (event, callback) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(callback); };
  const remove = (event, callback) => listeners.get(event)?.delete(callback);
  const env = {
    sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    crypto: { randomUUID: () => id(++serial) },
    BroadcastChannel: class { addEventListener() {} postMessage() {} close() {} },
    window: {
      setTimeout(fn, ms) { timers.set(++nextTimer, { fn, ms }); return nextTimer; }, clearTimeout(timer) { timers.delete(timer); },
      setInterval() { return ++nextTimer; }, clearInterval() {},
      addEventListener: add, removeEventListener: remove,
      dispatchEvent(event) { for (const callback of listeners.get(event.type) || []) callback(event); },
    },
    document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    fetch: async (_url, init) => {
      if (init.method === 'POST') { const body = JSON.parse(init.body); posts.push(body); return f.post(body); }
      return f.get ? f.get(init) : response(structuredClone(f.state));
    },
  };
  const component = load('src/components/cliente/ClientReferralRewards.tsx', {
    'next/link': { default: props => React.createElement('a', props, props.children) },
    './CelestialPortal': { usePortalMotion: () => ({ running: false }) },
    '@/lib/client-referrals': definitions,
    '@/lib/supabase-browser': { supabaseClienteBrowser: () => ({ auth: {
      getSession: async () => ({ data: { session: { user: { id: f.user }, access_token: 'token-' + f.user } } }),
      onAuthStateChange(callback) { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    } }) },
  }, env);
  return Object.assign(f, {
    posts, storage, component,
    getView() { return view; },
    async mount() { await flush(() => { view = create(React.createElement(component.default), { createNodeMock: element => element.type === 'dialog' ? { showModal() {}, close() {} } : null }); }); await flush(); },
    button(label) { return view.root.findAllByType('button').find(button => text(button).includes(label)); },
    async click(label) { const button = this.button(label); assert.ok(button, 'Expected button: ' + label); await flush(() => button.props.onClick()); },
    async switchAccount(user) { f.user = user; await flush(() => listener('SIGNED_IN', { user: { id: user }, access_token: 'token-' + user })); },
    async unmount() { await flush(() => view.unmount()); },
    text() { return text(view.toJSON()); },
  });
}

test('client reviews the exact reward and consumed referrals before posting; rapid confirmation posts once', async () => {
  const f = fixture(); await f.mount();
  assert.match(f.text(), /más de 10 €/);
  assert.match(f.text(), /necesitarás nuevos referidos disponibles/);
  await f.click('Reclamar premio');
  assert.equal(f.posts.length, 0);
  const dialog = f.getView().root.findByType('dialog');
  assert.match(text(dialog), /100 Coins/); assert.match(text(dialog), /Referidos que se usarán3/);
  let resolve;
  f.post = () => new Promise(done => { resolve = done; });
  const confirm = f.button('Confirmar premio');
  await flush(() => { confirm.props.onClick(); confirm.props.onClick(); });
  assert.equal(f.posts.length, 1);
  assert.equal(f.posts[0].reward_id, reward.id); assert.equal(f.posts[0].expected_version, 2);
  assert.equal('amount' in f.posts[0], false); assert.equal('cliente_id' in f.posts[0], false);
  assert.equal(f.button('Comprobando').props.disabled, true);
  await flush(() => resolve(response({ ok: true, receipt: { id: id(90) } })));
  assert.match(f.text(), /Premio reclamado/);
  assert.equal(f.storage.size, 0);
  await f.unmount();
});

test('uncertain network result keeps one operation across retry and a closed review stays recoverable', async () => {
  const f = fixture(); await f.mount();
  let first = true;
  f.post = async () => { if (first) { first = false; throw new Error('Conexión interrumpida'); } return response({ ok: true }); };
  await f.click('Reclamar premio'); await f.click('Confirmar premio');
  assert.equal(f.posts.length, 1); assert.equal(f.storage.size, 1);
  await f.click('Volver');
  assert.match(f.text(), /reclamación pendiente de comprobar/);
  await f.click('Comprobar mi premio'); await f.click('Comprobar reclamación');
  assert.equal(f.posts.length, 2);
  assert.equal(f.posts[0].operation_id, f.posts[1].operation_id);
  assert.equal(f.storage.size, 0); assert.match(f.text(), /Premio reclamado/);
  await f.unmount();
});

test('a pending claim survives remount even after its referrals have already been consumed', async () => {
  const f = fixture();
  f.storage.set('tc-referral-claim-v1:owner-one', JSON.stringify({ operationId: id(88), reward }));
  f.state.summary.available = 0; f.state.summary.claimed = 3; f.state.rewards[0].claimable = false;
  await f.mount();
  assert.match(text(f.getView().root.findByType('dialog')), /Comprobar reclamación/);
  await f.click('Comprobar reclamación');
  assert.equal(f.posts.length, 1); assert.equal(f.posts[0].operation_id, id(88));
  await f.unmount();
});

test('switching accounts immediately hides previous names, progress and pending intents', async () => {
  const f = fixture(); await f.mount(); assert.match(f.text(), /Ana/);
  let resolve;
  f.get = () => new Promise(done => { resolve = done; });
  await f.switchAccount('owner-two');
  assert.doesNotMatch(f.text(), /Ana/); assert.equal(f.getView().root.findAllByType('dialog').length, 0);
  const clean = initial(); clean.referrals = []; clean.summary = { total: 0, available: 0, claimed: 0, pending: 0 };
  await flush(() => resolve(response(clean)));
  assert.doesNotMatch(f.text(), /Ana/); await f.unmount();
});

test('progress uses the configured thresholds, and an empty catalogue invents no rewards', async () => {
  const f = fixture(); let progress;
  await flush(() => { progress = create(React.createElement(f.component.ReferralProgress, { summary: { total: 6, available: 2, claimed: 3, pending: 1 }, rewards: [{ ...reward, referrals_required: 3 }, { ...reward, id: id(11), referrals_required: 5 }] })); });
  const meter = progress.root.findByProps({ role: 'progressbar' });
  assert.equal(meter.props['aria-valuenow'], 2); assert.equal(meter.props['aria-valuemax'], 5);
  assert.match(text(progress.toJSON()), /X3/); assert.match(text(progress.toJSON()), /X5/);
  await flush(() => progress.update(React.createElement(f.component.ReferralProgress, { summary: { total: 0, available: 0, claimed: 0, pending: 0 }, rewards: [] })));
  assert.match(text(progress.toJSON()), /preparando los premios/); assert.doesNotMatch(text(progress.toJSON()), /X1|X2|X3/);
  await flush(() => progress.unmount());
});

test('Diamante roulette requirement appears both in the reward card and the review', async () => {
  const f = fixture(); f.state.rewards[0] = { ...reward, reward_type: 'roulette', roulette_level: 5, amount: 1 };
  await f.mount(); assert.match(f.text(), /requieren ese rango/);
  await f.click('Reclamar premio');
  assert.match(text(f.getView().root.findByType('dialog')), /Necesitas rango Diamante/);
  await f.unmount();
});
