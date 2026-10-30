const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), { act, create } = require('react-test-renderer');

// Only synthetic accounts and controllable reads. No Supabase requests or writes.
const flush = async fn => act(async () => { fn?.(); await new Promise(resolve => setImmediate(resolve)); });
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const data = (minutes = 10, extra = {}) => ({ ok: true, month: '2026-10', worker: { id: 'worker-a', role: 'tarotista', tarotista_level: 1 }, stats: { minutes_free: minutes, minutes_total: minutes, pay_minutes: minutes * 0.04, calls_total: 1, captadas_total: 0 }, ...extra });
const response = (body, status = 200) => ({ ok: status < 400, json: async () => body });

async function setup(t, initial = {}) {
  let view, snapshot, nextTimer = 0;
  const timers = new Map(), authListeners = new Set(), windowEvents = new Map(), documentEvents = new Map(), requests = [];
  const fixture = { session: { access_token: 'test-only-a', user: { id: 'user-a' } }, read: async () => response(data()) };
  const schedule = (fn, ms, interval) => { const id = ++nextTimer; timers.set(id, { fn, ms, interval }); return id; };
  const events = map => ({ addEventListener(name, fn) { if (!map.has(name)) map.set(name, new Set()); map.get(name).add(fn); }, removeEventListener(name, fn) { map.get(name)?.delete(fn); } });
  const browser = { ...events(windowEvents), setTimeout: (fn, ms) => schedule(fn, ms, false), clearTimeout: id => timers.delete(id), setInterval: (fn, ms) => schedule(fn, ms, true), clearInterval: id => timers.delete(id) };
  const document = { visibilityState: initial.visibility || 'visible', ...events(documentEvents) };
  const client = { auth: { getSession: async () => ({ data: { session: fixture.session } }), onAuthStateChange(fn) { authListeners.add(fn); return { data: { subscription: { unsubscribe() { authListeners.delete(fn); } } } }; } } };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/hooks/useTarotistaLiveStats.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require, window: browser, document, AbortController, console, fetch: async (url, init) => { requests.push({ url, init }); return fixture.read(url, init); } });
  let options = { client, enabled: true, polling: true, userId: 'user-a', workerId: 'worker-a', month: '2026-10', ...initial };
  function Probe() { snapshot = exports.useTarotistaLiveStats(options); return null; }
  await act(async () => { view = create(React.createElement(Probe)); });
  let disposed = false;
  const dispose = () => { if (!disposed) { act(() => view.unmount()); disposed = true; } };
  t.after(dispose);
  return { fixture, client, requests, timers, document, get snapshot() { return snapshot; },
    async update(patch) { options = { ...options, ...patch }; await act(async () => view.update(React.createElement(Probe))); },
    async tick(ms) { await flush(() => { for (const [id, timer] of [...timers]) if (timer.ms === ms) { if (!timer.interval) timers.delete(id); timer.fn(); } }); },
    async event(name) { await flush(() => { for (const fn of [...(windowEvents.get(name) || []), ...(documentEvents.get(name) || [])]) fn(); }); },
    async auth(session) { fixture.session = session; await flush(() => { for (const fn of authListeners) fn(session ? 'SIGNED_IN' : 'SIGNED_OUT', session); }); },
    dispose() { dispose(); assert.equal(timers.size, 0); assert.equal(authListeners.size, 0); assert.equal([...windowEvents.values(), ...documentEvents.values()].some(set => set.size), false); },
  };
}

test('visible polling fetches only the own monthly read and updates the actual FREE figures', async t => {
  const f = await setup(t);
  assert.equal(f.requests.length, 1);
  assert.equal(f.snapshot.stats.stats.minutes_free, 10);
  assert.equal(f.requests[0].url, '/api/stats/monthly?month=2026-10');
  assert.equal(f.requests[0].init.cache, 'no-store');
  assert.equal(f.requests[0].init.headers.Authorization, 'Bearer test-only-a');
  assert.equal(f.requests[0].init.method, undefined);
  for (const minutes of [12, 15]) {
    f.fixture.read = async () => response(data(minutes));
    await f.tick(20_000);
    assert.equal(f.snapshot.stats.stats.minutes_free, minutes);
    assert.equal(f.snapshot.stats.stats.pay_minutes, minutes * 0.04);
    assert.equal(f.snapshot.stats.stats.captadas_total, 0);
  }
  f.dispose();
});

test('hidden tabs do not poll; visibility and focus resume reads without bursts', async t => {
  const f = await setup(t, { visibility: 'hidden' });
  await f.tick(20_000); await f.event('focus'); assert.equal(f.requests.length, 0);
  f.document.visibilityState = 'visible';
  const read = deferred(); f.fixture.read = () => read.promise;
  await f.event('visibilitychange'); await f.event('focus'); await f.tick(20_000);
  assert.equal(f.requests.length, 1);
  await flush(() => read.resolve(response(data())));
  f.document.visibilityState = 'hidden'; await f.tick(20_000);
  assert.equal(f.requests.length, 1);
});

test('changing month clears the old snapshot and ignores a late old-month response', async t => {
  const f = await setup(t), old = deferred();
  f.fixture.read = () => old.promise; await f.event('focus');
  const request = f.requests.at(-1);
  f.fixture.read = async () => response(data(12, { month: '2026-11' }));
  await f.update({ month: '2026-11' });
  assert.equal(request.init.signal.aborted, true);
  assert.equal(f.snapshot.stats.month, '2026-11');
  await flush(() => old.resolve(response(data(99))));
  assert.equal(f.snapshot.stats.stats.minutes_free, 12);
});

test('Auth switch immediately clears and cancels the former worker, then accepts only the new verified identity', async t => {
  const f = await setup(t), old = deferred();
  f.fixture.read = () => old.promise; await f.event('focus');
  const previousRequest = f.requests.at(-1);
  await f.auth({ access_token: 'test-only-b', user: { id: 'user-b' } });
  assert.equal(f.snapshot.stats, null); assert.equal(previousRequest.init.signal.aborted, true);
  const count = f.requests.length; await f.event('focus'); await f.tick(20_000); assert.equal(f.requests.length, count);
  f.fixture.read = async () => response(data(15, { worker: { id: 'worker-b', role: 'tarotista' } }));
  await f.update({ userId: 'user-b', workerId: 'worker-b' });
  await flush(() => old.resolve(response(data(99))));
  assert.equal(f.snapshot.stats.worker.id, 'worker-b'); assert.equal(f.snapshot.stats.stats.minutes_free, 15);
  await f.auth(null); assert.equal(f.snapshot.stats, null);
});

test('wrong worker, wrong month, or privileged response never replaces the own figures', async t => {
  const f = await setup(t);
  for (const extra of [{ worker: { id: 'another-worker', role: 'tarotista' } }, { month: '2026-09' }, { worker: { id: 'worker-a', role: 'admin' } }]) {
    f.fixture.read = async () => response(data(99, extra)); await f.tick(20_000);
    assert.equal(f.snapshot.stats.stats.minutes_free, 10);
  }
});

test('temporary network failures preserve confirmed figures and do not change authentication', async t => {
  const f = await setup(t);
  f.fixture.read = async () => { throw new Error('fixture offline'); }; await f.tick(20_000);
  assert.equal(f.snapshot.stats.stats.minutes_free, 10);
  f.fixture.read = async () => response({ ok: false }, 503); await f.tick(20_000);
  assert.equal(f.snapshot.stats.stats.minutes_free, 10);
  assert.equal(f.fixture.session.user.id, 'user-a');
});

test('a stalled read times out, permits a new read, and cannot later overwrite it', async t => {
  const f = await setup(t), old = deferred();
  f.fixture.read = () => old.promise; await f.event('focus');
  const request = f.requests.at(-1); await f.tick(12_000); assert.equal(request.init.signal.aborted, true);
  f.fixture.read = async () => response(data(12)); await f.event('focus');
  await flush(() => old.resolve(response(data(99))));
  assert.equal(f.snapshot.stats.stats.minutes_free, 12);
});

test('leaving a live section stops automatic reads while manual refresh remains available', async t => {
  const f = await setup(t); await f.update({ polling: false });
  await f.event('focus'); await f.tick(20_000); assert.equal(f.requests.length, 1);
  await act(async () => { await f.snapshot.refresh(); }); assert.equal(f.requests.length, 2);
  await f.update({ enabled: false }); assert.equal(f.snapshot.stats, null);
  await act(async () => { await f.snapshot.refresh(); }); assert.equal(f.requests.length, 2);
});

test('a refreshed token for the same account keeps its snapshot and the next read uses that token', async t => {
  const f = await setup(t);
  await f.auth({ access_token: 'test-only-refreshed', user: { id: 'user-a' } });
  assert.equal(f.snapshot.stats.stats.minutes_free, 10);
  await f.event('focus');
  assert.equal(f.requests.at(-1).init.headers.Authorization, 'Bearer test-only-refreshed');
});

test('the production aggregator counts each FREE minute at the current rate without a purchase or capture', () => {
  const cache = new Map([['src/lib/server/auth-fast.ts', {}]]);
  const root = path.join(__dirname, '..');
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(source, { exports, require(name) {
      if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
      if (name === '@supabase/supabase-js') return { createClient() { throw new Error('Network disabled'); } };
      throw new Error(`Unexpected dependency: ${name}`);
    } });
    return exports;
  }
  const { aggregateRendimientoByTarotista } = load('src/lib/server/rendimiento-metrics.ts');
  const worker = { id: 'synthetic-tarotista', display_name: 'Fixture', role: 'tarotista' };
  for (const minutes of [7, 10, 12, 15]) {
    const row = { tarotista_worker_id: worker.id, codigo_1: 'FREE', minutos_1: minutes, tiempo: minutes, tipo_registro: 'minutos', usa_7_free: false, importe: 0, cliente_compra_minutos: false, captado: false, recuperado: false };
    const [stats] = aggregateRendimientoByTarotista([row], [worker]);
    assert.equal(stats.minutes_free, minutes); assert.equal(stats.minutes_total, minutes);
    assert.equal(stats.pay_minutes, minutes * 0.04); assert.equal(stats.calls_total, 1);
    assert.equal(stats.captadas_total, 0); assert.equal(stats.revenue_total, 0);
  }
});
