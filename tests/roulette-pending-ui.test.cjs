// Offline component checks: all sessions, network responses, timers and storage are synthetic.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');
const clientId = '00000000-0000-4000-8000-000000000001';
const spinId = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pendingId = '20000000-0000-4000-8000-000000000002';
const key = 'tc-ruleta-pending:' + clientId;
const clone = value => JSON.parse(JSON.stringify(value));
const text = node => typeof node === 'string' ? node : node.children?.map(text).join('') || '';

function evaluate(file, imports = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => name in imports ? imports[name] : require(name), console, URLSearchParams, AbortSignal, Error, Number, ...globals });
  return exports;
}

function summaryFor() {
  const result = { ok: true, cliente_id: clientId, available_spins: 5, diamond_access: true, next_level: 1, catalogue: [], history: [], entitlements: [] };
  for (let level = 1; level <= 5; level++) {
    result[`level_${level}_spins`] = 1;
    result[`next_spin_${level}`] = spinId(level);
    result.catalogue.push({ id: 'reward-' + level, nivel: level, reward_type: 'coins', reward_value: 10, rarity: 'common', sort_order: 0 });
  }
  return result;
}

function fixture(options = {}) {
  const storage = options.storage || new Map(), listeners = new Map(), timers = new Map(), posts = [], announcements = [];
  if (options.saved) storage.set(key, JSON.stringify(options.saved));
  let summary = { ...summaryFor(), ...options.summary }, tree, refresh, timerId = 0;
  let post = options.post;
  const window = {
    location: { search: options.search ?? '?nivel=1' },
    matchMedia: () => ({ matches: true }),
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    dispatchEvent(event) { for (const callback of listeners.get(event.type) || []) callback(event); },
  };
  const globals = {
    window, sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    requestAnimationFrame: callback => { callback(); return 1; },
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
  };
  const pending = evaluate('src/lib/roulette-pending.ts', {}, globals);
  const ruleta = evaluate('src/lib/ruleta.ts');
  const router = { replace() {}, push() {} };
  const Wheel = props => React.createElement('button', {
    'data-test': 'wheel', 'data-level': props.level, disabled: props.busy || props.disabled,
    onClick: props.onSpin,
  }, props.pending ? 'Comprobar mi giro pendiente' : 'Girar');
  const Component = evaluate('src/components/cliente/PurchaseRoulette.tsx', {
    'next/image': { default: props => React.createElement('img', props) },
    'next/link': { default: props => React.createElement('a', props) },
    'next/navigation': { useRouter: () => router },
    './CelestialWheel': { default: Wheel, WHEEL_SPIN_MS: 1 },
    './RouletteRewardArt': { default: () => null },
    './PurchaseRoulette.module.css': { default: new Proxy({}, { get: (_, name) => String(name) }) },
    'lucide-react': new Proxy({}, { get: (_, name) => props => React.createElement('span', { ...props, 'data-icon': name }) }),
    '@/lib/ruleta': ruleta, '@/lib/roulette-pending': pending,
    '@/lib/leo-guide': { LEO_SELECT_ROULETTE: 'tc-leo-select-roulette' },
    '@/lib/leo-celestial-events': { announceLeoCelestial: value => announcements.push(value) },
    '@/lib/supabase-browser': { supabaseClienteBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-token' } } }) } }) },
    '@/hooks/useRouletteSignal': { useRouletteSignal: (_sb, _id, callback) => { refresh = callback; } },
  }, {
    ...globals,
    fetch: async (_url, init = {}) => {
      if (init.method !== 'POST') return { ok: true, status: 200, json: async () => clone(summary) };
      const request = JSON.parse(init.body); posts.push(request);
      const result = post ? await post(request, clone(summary)) : null;
      if (result) return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.payload };
      summary = { ...summary, [`level_${request.level}_spins`]: 0, [`next_spin_${request.level}`]: null };
      return { ok: true, status: 200, json: async () => ({ ...clone(summary), spin_id: request.spin_id, spin_level: request.level,
        reward_id: 'reward-' + request.level, reward_type: 'coins', reward_value: 10, balance_before: 100, balance_after: 110 }) };
    },
  }).default;
  const act = async callback => renderer.act(async () => { callback(); await new Promise(resolve => setImmediate(resolve)); });
  const wheel = () => tree.root.findByProps({ 'data-test': 'wheel' });
  return {
    storage, posts, announcements, pending, window,
    get tree() { return tree; }, wheel,
    async mount() { await act(() => { tree = renderer.create(React.createElement(Component), { createNodeMock: () => ({ scrollIntoView() {} }) }); }); },
    async click(node) { assert.equal(Boolean(node.props.disabled), false); await act(() => node.props.onClick()); },
    async select(level) { await act(() => window.dispatchEvent({ type: 'tc-leo-select-roulette', detail: { level } })); },
    async refresh() { await act(() => { void refresh(); }); },
    async animate() { await act(() => { for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); } }); },
    async settle() { await act(() => {}); },
    async unmount() { await act(() => tree.unmount()); },
    setPost(handler) { post = handler; },
  };
}

test('legacy pending migrates by level, permits another roulette and only clears the completed request', async () => {
  const f = fixture({ saved: { spin_id: pendingId, level: 2 } }); await f.mount();
  try {
    assert.equal(f.wheel().props['data-level'], 1, 'An explicit selected roulette is preserved');
    assert.equal(f.posts.length, 0, 'Loading never consumes a spin');
    assert.equal(JSON.parse(f.storage.get(key)).version, 2);
    const recover = f.tree.root.findAllByType('button').find(node => text(node).includes('Comprobar pendiente · Nivel 2'));
    assert.equal(recover.props.disabled, false);
    await f.click(f.wheel()); await f.animate();
    assert.deepEqual(f.posts, [{ spin_id: spinId(1), level: 1 }]);
    assert.deepEqual(JSON.parse(f.storage.get(key)).spins, { 2: { spin_id: pendingId, level: 2 } });
    await f.select(2); await f.refresh();
    assert.equal(f.wheel().props['data-level'], 2);
    await f.click(f.wheel()); await f.animate();
    assert.deepEqual(f.posts[1], { spin_id: pendingId, level: 2 });
    assert.equal(f.storage.has(key), false);
    assert.equal(f.announcements.length, 2);
  } finally { await f.unmount(); }
});

test('timeout keeps independent requests for both levels through remount; refresh does not force a pending level', async () => {
  const f = fixture({ saved: { spin_id: pendingId, level: 2 }, post: async () => { const error = new Error('timeout'); error.name = 'TimeoutError'; throw error; } });
  await f.mount();
  try {
    await f.click(f.wheel());
    assert.deepEqual(Object.keys(JSON.parse(f.storage.get(key)).spins), ['1', '2']);
    await f.select(3); await f.refresh();
    assert.equal(f.wheel().props['data-level'], 3);
    assert.equal(f.wheel().props.disabled, false);
  } finally { await f.unmount(); }
  const restored = fixture({ storage: f.storage, search: '?nivel=2' }); await restored.mount();
  try {
    await restored.click(restored.wheel()); await restored.animate();
    assert.deepEqual(restored.posts, [{ spin_id: pendingId, level: 2 }]);
    assert.deepEqual(Object.keys(JSON.parse(restored.storage.get(key)).spins), ['1']);
  } finally { await restored.unmount(); }
});

test('malformed successful replies never clear pending or announce a reward', async () => {
  const missingTarget = { ...summaryFor(), spin_id: spinId(1), spin_level: 1, reward_id: 'x', reward_type: 'coins', reward_value: 10, balance_before: 100, balance_after: 110 };
  delete missingTarget.level_1_spins; delete missingTarget.next_spin_1;
  for (const response of [null, { ok: true }, { ok: true, cliente_id: clientId, spin_id: pendingId, spin_level: 2 }, { ...summaryFor(), spin_id: spinId(1), spin_level: 1, reward_id: 'x', reward_type: 'coins', reward_value: 10 }, missingTarget]) {
    const f = fixture({ post: async () => ({ status: 200, payload: response }) }); await f.mount();
    try {
      await f.click(f.wheel()); await f.animate();
      assert.deepEqual(Object.keys(JSON.parse(f.storage.get(key)).spins), ['1']);
      assert.equal(f.announcements.length, 0);
      assert.equal(f.wheel().props.disabled, false);
      assert.match(text(f.wheel()), /Comprobar/);
    } finally { await f.unmount(); }
  }
});

test('confirmed legacy RPC results without unrelated level 4 and 5 fields remain supported', async () => {
  const f = fixture({ post: async (request, summary) => {
    delete summary.level_4_spins; delete summary.next_spin_4;
    delete summary.level_5_spins; delete summary.next_spin_5;
    return { status: 200, payload: { ...summary, level_1_spins: 0, next_spin_1: null, spin_id: request.spin_id, spin_level: request.level,
      reward_id: 'reward-1', reward_type: 'coins', reward_value: 10, balance_before: 100, balance_after: 110 } };
  } }); await f.mount();
  try {
    await f.click(f.wheel()); await f.animate();
    assert.equal(f.storage.has(key), false);
    assert.equal(f.announcements.length, 1);
  } finally { await f.unmount(); }
});

test('temporary and authorization errors retain pending; definitive invalid-spin clears only its level', async () => {
  for (const status of [401, 403, 409, 503]) {
    const f = fixture({ saved: { spin_id: pendingId, level: 2 }, post: async () => ({ status, payload: { ok: false, error: 'Temporal' } }) }); await f.mount();
    try {
      await f.click(f.wheel());
      assert.deepEqual(Object.keys(JSON.parse(f.storage.get(key)).spins), ['1', '2']);
      f.setPost(async () => ({ status: 409, payload: { ok: false, code: 'INVALID_SPIN', error: 'Giro no disponible' } }));
      await f.click(f.wheel());
      assert.deepEqual(JSON.parse(f.storage.get(key)).spins, { 2: { spin_id: pendingId, level: 2 } });
      assert.equal(f.announcements.length, 0);
    } finally { await f.unmount(); }
  }
});

test('pending recovery remains available with no fresh spins, no catalogue and paused Diamond access', async () => {
  const f = fixture({ saved: { spin_id: pendingId, level: 5 }, search: '?nivel=5', summary: { level_5_spins: 0, next_spin_5: null, diamond_access: false, catalogue: [] } });
  await f.mount();
  try {
    const recover = f.tree.root.findAllByType('button').find(node => text(node).includes('Comprobar pendiente · Diamante'));
    await f.click(recover); await f.animate();
    assert.deepEqual(f.posts, [{ spin_id: pendingId, level: 5 }]);
    assert.equal(f.storage.has(key), false);
  } finally { await f.unmount(); }
});

test('double click and level navigation during a request cannot launch a second spin', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const f = fixture({ post: async () => { await blocked; return null; } }); await f.mount();
  try {
    const original = f.wheel();
    await f.click(original);
    await renderer.act(async () => { original.props.onClick(); await new Promise(resolve => setImmediate(resolve)); });
    await f.select(3);
    assert.equal(f.wheel().props['data-level'], 1);
    assert.equal(f.posts.length, 1);
    release(); await f.settle(); await f.animate();
    assert.equal(f.announcements.length, 1);
  } finally { release(); await f.unmount(); }
});

test('invalid stored IDs or mismatched levels are ignored, while other valid pending levels survive', async () => {
  const f = fixture({ saved: { version: 2, spins: { 1: { spin_id: 'bad', level: 1 }, 2: { spin_id: pendingId, level: 2 }, 3: { spin_id: spinId(3), level: 4 } } } }); await f.mount();
  try {
    assert.deepEqual(Object.keys(JSON.parse(f.storage.get(key)).spins), ['2']);
    assert.equal(text(f.wheel()), 'Girar');
    await f.click(f.wheel()); await f.animate();
    assert.deepEqual(f.posts, [{ spin_id: spinId(1), level: 1 }]);
  } finally { await f.unmount(); }
});

test('pending helpers do not clear a different ID and publish a local guide update', () => {
  const f = fixture(), events = [];
  f.window.addEventListener(f.pending.ROULETTE_PENDING_CHANGED, event => events.push(event.detail));
  const saved = { 1: { spin_id: spinId(1), level: 1 }, 2: { spin_id: pendingId, level: 2 } };
  assert.deepEqual(clone(f.pending.clearRoulettePending(saved, { spin_id: spinId(9), level: 1 })), saved);
  f.pending.writeRoulettePending(clientId, saved);
  assert.deepEqual(clone(f.pending.readRoulettePending(clientId)), saved);
  assert.deepEqual(clone(events), [{ clientId }]);
});
