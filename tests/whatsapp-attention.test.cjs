const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');
const start = Date.parse('2026-10-22T19:00:00Z');
const row = (id = 'chat-a', overrides = {}) => ({ id, name: 'Daisy', unread: 1, last_incoming_id: 'message-a', last_incoming_at: new Date(start - 1000).toISOString(), ...overrides });
function sharedBrowser() {
  const values = new Map(), locks = new Set(), tabs = new Set();
  return { values, tabs, navigator: { locks: { async request(key, _options, callback) {
    if (locks.has(key)) return callback(null);
    locks.add(key); try { return await callback({ name: key }); } finally { locks.delete(key); }
  } } } };
}
function fixture(options = {}) {
  const shared = options.shared || sharedBrowser(), timers = new Map(), events = new Map(), documentEvents = new Map(), calls = [], notices = [];
  let clock = start + (options.startOffset || 0), serial = 0, tree, result, authCallback, status = 200, block, account = 'phone-a', disposed = 0;
  let session = { access_token: 'fixture-token', user: { id: 'user-a' } };
  const records = options.rows || [row()], props = { enabled: options.enabled ?? true, workerId: 'worker-a', onReminder: () => notices.push(clock) };
  class Clock extends Date { constructor(value) { super(arguments.length ? value : clock); } static now() { return clock; } }
  const document = { hidden: false, addEventListener: (key, cb) => documentEvents.set(key, cb), removeEventListener: key => documentEvents.delete(key) };
  const window = {
    addEventListener: (key, cb) => events.set(key, cb), removeEventListener: key => events.delete(key),
    setInterval(cb, ms) { timers.set(++serial, { cb, ms, next: clock + ms, interval: true }); return serial; }, clearInterval: id => timers.delete(id),
    setTimeout(cb, ms) { timers.set(++serial, { cb, ms, next: clock + ms }); return serial; }, clearTimeout: id => timers.delete(id),
    localStorage: { getItem: key => shared.values.get(key) || null, setItem(key, value) { shared.values.set(key, value); for (const tab of shared.tabs) if (tab !== events) tab.get('storage')?.({ key, newValue: value }); } },
  };
  shared.tabs.add(events);
  const sb = { auth: {
    getSession: async () => ({ data: { session } }),
    onAuthStateChange(cb) { authCallback = cb; return { data: { subscription: { unsubscribe() { disposed++; } } } }; },
  } };
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const payload = { ok: status === 200, worker_id: props.workerId, user_id: session?.user.id, server_time: new Date(clock).toISOString(), session: 'central', account_id: account,
      unread_total: records.reduce((n, item) => n + item.unread, 0), unread_chats: records.length, items: records.map(item => ({ ...item })) };
    if (block) await block;
    return { ok: status === 200, status, json: async () => payload };
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const output = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(output, { exports, Date: Clock, AbortController, window, document, navigator: options.noLocks ? {} : shared.navigator, fetch, console,
      require(name) { if (name === '@/lib/supabase-browser') return { supabaseBrowser: () => sb }; if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts'); return require(name); } });
    return exports;
  }
  const logic = load('src/lib/whatsapp-attention.ts'), hook = load('src/features/central/assistant/useWhatsAppAttention.ts').useWhatsAppAttention;
  function Probe() { result = hook(props); return null; }
  const act = async cb => renderer.act(async () => { cb?.(); await new Promise(resolve => setImmediate(resolve)); });
  return {
    calls, notices, records, timers, events, documentEvents, logic,
    get current() { return result; }, get disposed() { return disposed; },
    async mount() { await act(() => { tree = renderer.create(React.createElement(Probe)); }); },
    async unmount() { await act(() => tree.unmount()); shared.tabs.delete(events); },
    async update(next) { await act(() => { Object.assign(props, next); tree.update(React.createElement(Probe)); }); },
    async refresh() { await act(() => events.get('focus')?.()); }, async changed() { await act(() => events.get('tc-whatsapp-changed')?.()); },
    async dismiss() { await act(() => result.dismiss()); }, async offline() { await act(() => events.get('offline')?.()); },
    async hidden(value) { await act(() => { document.hidden = value; documentEvents.get('visibilitychange')?.(); }); },
    async signOut() { await act(() => { session = null; authCallback('SIGNED_OUT', null); }); }, async settle() { await act(); },
    status(value) { status = value; }, account(value) { account = value; }, block(value) { block = value; },
    async advance(ms) {
      const until = clock + ms;
      while (true) {
        const next = [...timers.values()].map(timer => timer.next).filter(time => time <= until).sort((a, b) => a - b)[0];
        if (next === undefined) break;
        clock = next;
        await act(() => { for (const [id, timer] of [...timers]) if (timer.next <= clock && timers.has(id)) { if (timer.interval) timer.next += timer.ms; else timers.delete(id); timer.cb(); } });
      }
      clock = until;
    },
  };
}

test('existing unread gets one honest summary; polling and dismissing never repeat each minute or mark read', async () => {
  const f = fixture(); await f.mount();
  assert.equal(f.current.count, 1); assert.equal(f.current.notice.initial, true);
  assert.match(f.logic.whatsAppAttentionMessage(f.current.notice), /Tienes 1 mensaje sin leer/);
  await f.dismiss(); await f.advance(180000);
  assert.equal(f.notices.length, 1); assert.equal(f.current.count, 1); assert.equal(f.current.notice, null);
  assert.ok(f.calls.every(call => call.url.endsWith('action=attention') && !call.init.method));
  await f.unmount();
});

test('new inbound IDs announce even if another conversation was read and total count stays unchanged', async () => {
  const f = fixture(); await f.mount(); await f.advance(1000);
  f.records.splice(0, 1, row('chat-b', { name: 'Guadalupe', last_incoming_id: 'new-b', last_incoming_at: new Date(start + 1000).toISOString() }));
  await f.refresh(); assert.equal(f.notices.length, 2); assert.equal(f.current.count, 1); assert.equal(f.current.notice.initial, false);
  assert.match(f.logic.whatsAppAttentionMessage(f.current.notice), /Guadalupe/);
  await f.refresh(); assert.equal(f.notices.length, 2);
  f.records.length = 0; await f.changed(); await f.advance(250);
  assert.equal(f.current.count, 0); assert.equal(f.current.notice, null); assert.equal(f.notices.length, 2);
  await f.unmount();
});

test('late historical messages and outgoing/read revisions do not become new arrivals', async () => {
  const f = fixture({ rows: [] }); await f.mount(); await f.advance(1000);
  f.records.push(row('old', { unread: 8 })); await f.refresh();
  assert.equal(f.current.count, 8); assert.equal(f.notices.length, 0);
  f.records[0].unread = 7; await f.refresh(); assert.equal(f.notices.length, 0);
  f.records[0].last_incoming_id = 'live'; f.records[0].last_incoming_at = new Date(start + 1000).toISOString(); await f.refresh();
  assert.equal(f.notices.length, 1); assert.equal(f.current.notice.initial, false);
  await f.unmount();
});

test('each inbound event wakes attention before a minute; multiple chats group without exposing bodies', async () => {
  const f = fixture({ rows: [] }); await f.mount(); await f.advance(1000);
  f.records.push(row('one', { last_incoming_id: 'one', last_incoming_at: new Date(start + 1000).toISOString(), body: 'PRIVATE TEXT' }), row('two', { name: 'Ana', last_incoming_id: 'two', last_incoming_at: new Date(start + 1000).toISOString() }));
  await f.refresh(); assert.equal(f.notices.length, 1); assert.equal(f.current.notice.items.length, 2);
  assert.doesNotMatch(JSON.stringify(f.current.notice), /PRIVATE TEXT/);
  await f.advance(1000); f.records[0].last_incoming_id = 'one-again'; f.records[0].last_incoming_at = new Date(start + 2000).toISOString(); await f.refresh();
  assert.equal(f.notices.length, 2); await f.unmount();
});

test('a message arriving in the same second as the initial baseline is not lost to timestamp precision', async () => {
  const f = fixture({ rows: [], startOffset: 500 }); await f.mount(); await f.advance(400);
  f.records.push(row('same-second', { last_incoming_id: 'new-with-second-precision', last_incoming_at: new Date(start).toISOString() }));
  await f.refresh(); assert.equal(f.notices.length, 1); assert.equal(f.current.notice.initial, false);
  await f.unmount();
});

test('failed/offline reads preserve the stale count but never announce cached messages', async () => {
  const f = fixture(); await f.mount(); f.status(503); await f.refresh();
  assert.equal(f.current.count, 1); assert.ok(f.current.error); assert.equal(f.current.notice, null);
  await f.advance(60000); assert.equal(f.notices.length, 1);
  f.status(200); await f.refresh(); assert.equal(f.current.error, ''); assert.equal(f.notices.length, 1);
  await f.offline(); assert.equal(f.current.count, 1); assert.match(f.current.error, /Sin conexión/);
  await f.unmount();
});

test('account switch discards earlier notice and starts an independent truthful unread baseline', async () => {
  const f = fixture(); await f.mount(); f.account('phone-b'); f.records.length = 0; await f.refresh();
  assert.equal(f.current.accountId, 'phone-b'); assert.equal(f.current.count, 0); assert.equal(f.current.notice, null);
  f.status(403); await f.refresh(); assert.equal(f.current.accountId, null); assert.equal(f.current.count, 0);
  await f.unmount();
});

test('background tabs pause and two visible tabs announce each event once without hiding unchanged active notice', async () => {
  const shared = sharedBrowser(), a = fixture({ shared }), b = fixture({ shared });
  await a.mount(); await b.mount(); assert.equal(a.notices.length + b.notices.length, 1); assert.ok(a.current.notice);
  await b.refresh(); assert.ok(a.current.notice, 'silent refresh in another tab cannot dismiss the existing notice');
  await a.hidden(true); const before = a.calls.length; await a.advance(60000); assert.equal(a.calls.length, before); assert.equal(a.current.notice, null);
  await b.advance(1000); b.records[0].last_incoming_id = 'second'; b.records[0].last_incoming_at = new Date(start + 1000).toISOString(); await b.refresh();
  assert.equal(a.notices.length + b.notices.length, 2);
  await a.unmount(); await b.unmount();
});

test('fallback storage claims deliver one initial summary and one new event across competing tabs', async () => {
  const shared = sharedBrowser(), a = fixture({ shared, noLocks: true }), b = fixture({ shared, noLocks: true });
  await a.mount(); await b.mount(); await a.advance(80); await b.advance(80);
  assert.equal(a.notices.length + b.notices.length, 1);
  for (const f of [a, b]) { f.records[0].last_incoming_id = 'new'; f.records[0].last_incoming_at = new Date(start + 80).toISOString(); }
  await a.refresh(); await b.refresh(); await a.advance(80); await b.advance(80);
  assert.equal(a.notices.length + b.notices.length, 2);
  await a.unmount(); await b.unmount();
});

test('signout aborts a delayed read, clears counts and cleans every listener/timer', async () => {
  const f = fixture(); let release; f.block(new Promise(resolve => { release = resolve; })); await f.mount();
  await f.signOut(); assert.equal(f.calls[0].init.signal.aborted, true); release(); await f.settle();
  assert.equal(f.current.count, 0); assert.equal(f.current.notice, null); assert.equal(f.notices.length, 0);
  await f.unmount(); assert.equal(f.timers.size, 0); assert.equal(f.events.size, 0); assert.equal(f.documentEvents.size, 0); assert.equal(f.disposed, 1);
});

test('worker lifecycle does not read when disabled and never reuses another worker count', async () => {
  const f = fixture({ enabled: false }); await f.mount(); await f.advance(60000); assert.equal(f.calls.length, 0);
  await f.update({ enabled: true }); assert.equal(f.current.count, 1);
  await f.update({ enabled: false }); assert.equal(f.current.count, 0); assert.equal(f.timers.size, 0);
  f.records.length = 0; await f.update({ enabled: true, workerId: 'worker-b' }); assert.equal(f.current.count, 0); assert.equal(f.current.notice, null);
  await f.unmount();
});
