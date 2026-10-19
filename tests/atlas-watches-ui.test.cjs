const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');
const root = path.join(__dirname, '..');
function evaluate(file, imports = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: name => name in imports ? imports[name] : require(name), Date, Intl, AbortController, Error, console, Map, ...globals });
  return exports;
}
const shared = evaluate('src/features/admin/atlas/atlas-watch-types.ts');
const styles = new Proxy({}, { get: (_, key) => String(key) });
const watch = (patch = {}) => ({ id: 'watch-1', clientId: 'client-1', clientName: 'Clienta de prueba', threshold: 30, enabled: true, balance: { state: 'known', free: 10, normal: 20, total: 30, observedAt: '2026-10-19T14:00:00Z' }, alert: { id: 'alert-1', triggeredAt: '2026-10-19T14:00:00Z', acknowledgedAt: null, totalAtTrigger: 30 }, ...patch });
const payload = (rows = [watch()]) => ({ ok: true, watches: rows, unreadCount: 1 });
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function fixture(enabled = true) {
  let latest, tree, callback, seq = 0, held = [], hold = false, fail = false;
  let session = { access_token: 'test-token', user: { id: 'admin-one' } };
  const events = new Map(), timers = new Map(), calls = [];
  const document = { hidden: false, addEventListener: (key, fn) => events.set(`document:${key}`, fn), removeEventListener: key => events.delete(`document:${key}`) };
  const window = {
    setTimeout: (fn, delay) => { const id = ++seq; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => { const id = ++seq; timers.set(id, { fn, delay }); return id; }, clearInterval: id => timers.delete(id),
    addEventListener: (key, fn) => events.set(key, fn), removeEventListener: key => events.delete(key),
  };
  const auth = { getSession: async () => ({ data: { session } }), onAuthStateChange: fn => { callback = fn; return { data: { subscription: { unsubscribe() {} } } }; } };
  const response = data => ({ ok: true, json: async () => data });
  const fetch = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, options, body });
    if (hold) return new Promise(resolve => held.push(data => resolve(response(data))));
    if (fail) throw new Error('Sin conexión de prueba');
    return response(body?.action === 'acknowledge' ? payload([watch({ alert: { ...watch().alert, acknowledgedAt: '2026-10-19T15:00:00Z' } })]) : payload());
  };
  const { useAtlasWatches } = evaluate('src/features/admin/atlas/useAtlasWatches.ts', { '@/lib/supabase-browser': { supabaseBrowser: () => ({ auth }) }, './atlas-watch-types': shared }, { document, window, fetch });
  function Harness() { latest = useAtlasWatches(enabled); return null; }
  return {
    events, timers, calls, held, document, get state() { return latest; }, set hold(v) { hold = v; }, set fail(v) { fail = v; },
    async mount() { await renderer.act(async () => { tree = renderer.create(React.createElement(Harness)); await tick(); }); },
    async run(fn) { let result; await renderer.act(async () => { result = await fn(); await tick(); }); return result; },
    async logout() { await renderer.act(async () => { session = null; callback('SIGNED_OUT', null); await tick(); }); },
    async switchUser() { await renderer.act(async () => { session = { access_token: 'second-token', user: { id: 'admin-two' } }; callback('SIGNED_IN', session); await tick(); }); },
    async close() { await renderer.act(async () => tree.unmount()); },
  };
}

test('balance parser preserves a real zero but rejects incomplete or inconsistent totals as unavailable', () => {
  const parsed = shared.parseAtlasWatches([watch({ balance: { state: 'known', free: 0, normal: 0, total: 0 } })]);
  assert.equal(parsed[0].balance.total, 0); assert.equal(shared.atlasWatchMinutes(parsed[0]), '0 min');
  for (const balance of [null, { state: 'known', total: 0 }, { state: 'known', free: 10, normal: 20, total: 10 }, { state: 'known', free: 0, normal: null, total: 0 }]) {
    const row = shared.parseAtlasWatches([watch({ balance })])[0];
    assert.equal(row.balance.state, 'unavailable'); assert.equal(shared.atlasWatchMinutes(row), 'Saldo sin comprobar');
  }
});

test('only unacknowledged enabled episodes appear in the launcher and acknowledgement keeps the watch', () => {
  const rows = [watch(), watch({ id: 'paused', enabled: false }), watch({ id: 'seen', alert: { ...watch().alert, acknowledgedAt: '2026-10-19T15:00:00Z' } }), watch({ id: 'safe', alert: null })];
  assert.deepEqual([...shared.atlasUnreadWatches(rows).map(row => row.id)], ['watch-1']);
  assert.equal(rows.length, 4);
});

test('watch polling uses admin auth, pauses when hidden, and cleans up on unmount', async () => {
  const f = fixture(); await f.mount();
  assert.equal(f.calls[0].options.headers.Authorization, 'Bearer test-token'); assert.equal(f.calls[0].options.cache, 'no-store');
  assert.equal(f.calls[0].url, '/api/admin/atlas/watches');
  const timer = [...f.timers.values()].find(timer => timer.delay === 30000); assert.ok(timer);
  f.document.hidden = true; await f.run(timer.fn); assert.equal(f.calls.length, 1);
  f.document.hidden = false; await f.run(() => f.events.get('focus')()); assert.equal(f.calls.length, 2);
  await f.close(); assert.equal(f.events.size, 0); assert.equal(f.timers.size, 0);
});

test('the watches hook does not query before admin access is ready', async () => {
  const f = fixture(false); await f.mount(); assert.equal(f.calls.length, 0); assert.equal(f.state.loading, false); await f.close();
});

test('logout aborts the in-flight request and ignores the previous account response', async () => {
  const f = fixture(); f.hold = true; await f.mount(); const signal = f.calls[0].options.signal;
  await f.logout(); assert.equal(signal.aborted, true); assert.equal(f.state.watches.length, 0);
  await f.run(() => f.held.shift()(payload())); assert.equal(f.state.watches.length, 0); await f.close();
});

test('account switching invalidates pending acknowledgement and clears client data', async () => {
  const f = fixture(); await f.mount(); f.hold = true;
  let pending; await f.run(() => { pending = f.state.action({ action: 'acknowledge', alertId: 'alert-1' }); });
  await f.switchUser(); assert.equal(f.state.watches.length, 0);
  await f.run(() => f.held.shift()(payload())); assert.equal(await pending, false); assert.equal(f.state.watches.length, 0); await f.close();
});

test('a stale read cannot resurrect an acknowledged notification, and an error does not replace balances with zero', async () => {
  const f = fixture(); await f.mount(); f.hold = true; await f.run(() => f.state.refresh());
  f.hold = false; await f.run(() => f.state.action({ action: 'acknowledge', alertId: 'alert-1' }));
  await f.run(() => f.held.shift()(payload())); assert.equal(shared.atlasUnreadWatches(f.state.watches).length, 0);
  f.fail = true; await f.run(() => f.state.refresh()); assert.equal(f.state.watches[0].balance.total, 30); assert.equal(f.state.stale, true); assert.match(f.state.error, /conexión/); await f.close();
});

test('watch card shows zero, keeps manual promotions separate, and acknowledgement targets only the alert', async () => {
  const { AtlasWatchPanel } = evaluate('src/features/admin/atlas/AtlasWatchPanel.tsx', { './Atlas.module.css': { default: styles }, './atlas-watch-types': shared, './atlas-types': { atlasStamp: () => 'fecha de prueba' } });
  const actions = []; let promos = 0, tree;
  const row = watch({ balance: { state: 'known', free: 0, normal: 0, total: 0 } });
  const controller = { watches: [row], loading: false, busy: '', error: '', stale: false, refresh() {}, action: async body => { actions.push(body); return true; } };
  renderer.act(() => { tree = renderer.create(React.createElement(AtlasWatchPanel, { controller, onPromotions: () => promos++ })); });
  assert.match(JSON.stringify(tree.toJSON()), /Se ha quedado sin minutos/); assert.match(JSON.stringify(tree.toJSON()), /panel de clientes en general/);
  const button = text => tree.root.findAllByType('button').find(node => node.children.includes(text));
  await renderer.act(async () => { button('Ver promociones').props.onClick(); await tick(); });
  assert.equal(promos, 1); assert.equal(actions.length, 0);
  await renderer.act(async () => { button('Marcar aviso visto').props.onClick(); await tick(); });
  assert.equal(actions[0].action, 'acknowledge'); assert.equal(actions[0].alertId, 'alert-1'); assert.equal(actions[0].watchId, undefined);
  await renderer.act(async () => { button('Pausar avisos').props.onClick(); await tick(); });
  assert.equal(actions[1].enabled, false); assert.equal(actions[1].watchId, 'watch-1');
  renderer.act(() => tree.unmount());
});

test('the launcher makes a stale client alert accessible and opening it cannot mutate the watch', () => {
  const { AtlasLauncher } = evaluate('src/features/admin/atlas/AtlasCharacter.tsx', { './Atlas.module.css': { default: styles }, './atlas-watch-types': shared });
  let tree, opened = 0;
  renderer.act(() => { tree = renderer.create(React.createElement(AtlasLauncher, { onOpen: () => opened++, alert: watch(), unreadCount: 1, stale: true })); });
  const launcher = tree.root.findByType('button'); assert.match(launcher.props['aria-label'], /Clienta de prueba: 30 min · pendiente de actualizar/);
  renderer.act(() => launcher.props.onClick()); assert.equal(opened, 1);
  const image = tree.root.findByType('img'); assert.equal(image.props.alt, ''); assert.equal(image.props.src, '/companions/atlas-celestial-v2.webp');
  renderer.act(() => tree.unmount());
});
