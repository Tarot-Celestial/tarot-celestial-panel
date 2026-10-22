const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');
const start = Date.parse('2026-10-22T19:00:00Z');
const row = (id = 'lead-a', overrides = {}) => ({ id, cliente_id: `client-${id}`, nombre: id, latest_meta_lead_at: new Date(start - 1000).toISOString(), ...overrides });

function sharedBrowser() {
  const values = new Map(), locks = new Set(), tabs = new Set();
  return { values, locks, tabs, navigator: { locks: { async request(key, _options, callback) {
    if (locks.has(key)) return callback(null);
    locks.add(key); try { return await callback({ name: key }); } finally { locks.delete(key); }
  } } } };
}

function fixture(options = {}) {
  const shared = options.shared || sharedBrowser();
  let clock = start, seq = 0, result, tree, session = { access_token: 'fixture-token', user: { id: 'user-a' } };
  let authCallback, realtime, brand = options.brand || 'celestial', status = 200, blocker, removes = 0;
  const timers = new Map(), events = new Map(), documentEvents = new Map(), calls = [], notices = [];
  const records = options.rows || [row()];
  const props = { enabled: options.enabled ?? true, workerId: 'worker-a', blocked: false, onReminder: () => notices.push(clock) };
  class Clock extends Date { constructor(value) { super(arguments.length ? value : clock); } static now() { return clock; } }
  const document = { hidden: false, addEventListener: (name, cb) => documentEvents.set(name, cb), removeEventListener: name => documentEvents.delete(name) };
  const window = {
    addEventListener: (name, cb) => events.set(name, cb), removeEventListener: name => events.delete(name),
    setInterval(cb, ms) { timers.set(++seq, { cb, ms, next: clock + ms, interval: true }); return seq; },
    clearInterval(id) { timers.delete(id); },
    setTimeout(cb, ms) { timers.set(++seq, { cb, ms, next: clock + ms, interval: false }); return seq; },
    clearTimeout(id) { timers.delete(id); },
    localStorage: {
      getItem: key => shared.values.get(key) || null,
      setItem(key, value) {
        shared.values.set(key, value);
        for (const tab of shared.tabs) if (tab !== events) tab.get('storage')?.({ key, newValue: value });
      },
    },
  };
  shared.tabs.add(events);
  const sb = {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange(cb) { authCallback = cb; return { data: { subscription: { unsubscribe() { removes++; } } } }; },
    },
    channel() { const c = { on(_type, _options, cb) { realtime = cb; return c; }, subscribe() { return c; } }; return c; },
    removeChannel() { removes++; },
  };
  const fetch = async (url, init) => {
    calls.push({ url, signal: init.signal });
    const payload = { ok: status === 200, worker_id: props.workerId, user_id: session?.user.id, brand, server_time: new Date(clock).toISOString(), items: records.map(item => ({ ...item })) };
    if (blocker) await blocker;
    return { ok: status === 200, status, json: async () => payload };
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = path.resolve(__dirname, '..', file), exports = {};
    cache.set(file, exports);
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(output, { exports, Date: Clock, AbortController, window, document, navigator: options.noLocks ? {} : shared.navigator, fetch, console,
      require(name) {
        if (name === '@/lib/supabase-browser') return { supabaseBrowser: () => sb };
        if (name === '@/components/global/BrandSwitcher') return { getActiveBrand: () => brand };
        if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts');
        return require(name);
      },
    });
    return exports;
  }
  const logic = load('src/lib/captacion-attention.ts');
  const hook = load('src/features/central/assistant/useCaptacionAttention.ts').useCaptacionAttention;
  function Probe() { result = hook(props); return null; }
  const act = async callback => renderer.act(async () => { callback?.(); await new Promise(resolve => setImmediate(resolve)); });
  return {
    records, calls, notices, logic, timers, events, documentEvents,
    get current() { return result; }, get removed() { return removes; },
    async mount() { await act(() => { tree = renderer.create(React.createElement(Probe)); }); },
    async unmount() { await act(() => tree.unmount()); shared.tabs.delete(events); },
    async update(next) { await act(() => { Object.assign(props, next); tree.update(React.createElement(Probe)); }); },
    async advance(ms) {
      const until = clock + ms;
      while (true) {
        const due = [...timers.values()].map(timer => timer.next).filter(time => time <= until).sort((a, b) => a - b)[0];
        if (due === undefined) break;
        clock = due;
        await act(() => {
          for (const [id, timer] of [...timers]) if (timer.next <= clock && timers.has(id)) {
            if (timer.interval) timer.next += timer.ms; else timers.delete(id);
            timer.cb();
          }
        });
      }
      clock = until;
    },
    async changed() { await act(() => events.get('tc-captacion-changed')?.()); },
    async realtime() { await act(() => realtime?.()); },
    async refresh() { await act(() => events.get('focus')?.()); },
    async dismiss() { await act(() => result.dismiss()); },
    async hidden(value) { await act(() => { document.hidden = value; documentEvents.get('visibilitychange')?.(); }); },
    async offline() { await act(() => events.get('offline')?.()); },
    async online() { await act(() => events.get('online')?.()); },
    async setBrand(value) { await act(() => { brand = value; events.get('tc-brand-changed')?.(); }); },
    async signOut() { await act(() => { session = null; authCallback('SIGNED_OUT', null); }); },
    async settle() { await act(); },
    status(value) { status = value; }, block(value) { blocker = value; },
  };
}

test('original Meta dates exclude historical imports, future dates and malformed items; each contact appears once', () => {
  const f = fixture(), original = new Date(start - 86400000).toISOString();
  const items = f.logic.parseCaptacionAttention([
    row(), row(), row('historical', { latest_meta_lead_at: original, created_at: new Date(start).toISOString() }),
    row('future', { latest_meta_lead_at: new Date(start + 1).toISOString() }), row('bad', { latest_meta_lead_at: 'invalid' }),
  ], start);
  assert.deepEqual(Array.from(items, item => item.id), ['lead-a']);
});

test('first arrival announces immediately, groups arrivals, and repeats exactly after sixty seconds', async () => {
  const f = fixture({ rows: [row('Daisy'), row('Guadalupe')] }); await f.mount();
  assert.equal(f.notices.length, 1); assert.equal(f.current.notice.items.length, 2);
  f.records.push(row('Wilfredo')); await f.realtime(); await f.advance(900);
  assert.equal(f.notices.length, 1);
  await f.advance(59099); assert.equal(f.notices.length, 1);
  await f.advance(1); assert.equal(f.notices.length, 2); assert.equal(f.current.notice.items.length, 3);
  assert.match(f.logic.captacionAttentionMessage(f.current.notice.items), /3 contactos/);
  await f.unmount();
});

test('opening or dismissing does not mark a contact handled; a real management refresh stops reminders', async () => {
  const f = fixture(); await f.mount(); await f.dismiss(); assert.equal(f.current.notice, null);
  await f.advance(60000); assert.equal(f.notices.length, 2);
  f.records.length = 0; await f.changed(); assert.equal(f.current.notice, null);
  await f.advance(120000); assert.equal(f.notices.length, 2); assert.equal(f.current.notice, null);
  await f.unmount();
});

test('a failed or offline read hides the notice and cannot announce cached pending clients', async () => {
  const f = fixture(); await f.mount(); f.status(503); await f.refresh();
  assert.equal(f.current.notice, null); assert.ok(f.current.error);
  await f.advance(120000); assert.equal(f.notices.length, 1);
  f.status(200); await f.online(); await f.advance(900); assert.equal(f.notices.length, 2);
  await f.offline(); assert.equal(f.current.notice, null);
  await f.unmount();
});

test('background tabs stay silent and two visible tabs share a single announcement per minute', async () => {
  const shared = sharedBrowser(), first = fixture({ shared }), second = fixture({ shared });
  await first.mount(); await second.mount();
  assert.equal(first.notices.length + second.notices.length, 1);
  await first.hidden(true); await first.advance(60000); assert.equal(first.notices.length, 1);
  await second.advance(60000); assert.equal(first.notices.length + second.notices.length, 2);
  await first.unmount(); await second.unmount();
});

test('a refresh in another tab does not reset the shared minute and a higher priority reminder postpones delivery', async () => {
  const shared = sharedBrowser(), first = fixture({ shared }); await first.mount(); await first.unmount();
  const second = fixture({ shared }); await second.mount(); assert.equal(second.notices.length, 0);
  await second.update({ blocked: true }); await second.advance(60000); assert.equal(second.notices.length, 0);
  await second.update({ blocked: false }); await second.advance(1000); assert.equal(second.notices.length, 1);
  await second.unmount();
});

test('brand changes have separate queues and identity changes discard delayed responses', async () => {
  const f = fixture(); await f.mount();
  f.records.length = 0; await f.setBrand('orion'); assert.equal(f.current.notice, null);
  assert.ok(f.calls.at(-1).url.endsWith('brand=orion'));
  let release; f.records.push(row()); f.block(new Promise(resolve => { release = resolve; })); await f.refresh();
  await f.signOut(); release(); await f.settle(); assert.equal(f.current.notice, null);
  await f.unmount(); assert.equal(f.timers.size, 0); assert.equal(f.events.size, 0); assert.equal(f.documentEvents.size, 0); assert.equal(f.removed, 4);
});

test('storage-claim fallback avoids duplicate visible notifications in browsers without Web Locks', async () => {
  const shared = sharedBrowser(), first = fixture({ shared, noLocks: true }), second = fixture({ shared, noLocks: true });
  await first.mount(); await second.mount(); await first.advance(80); await second.advance(80);
  assert.equal(first.notices.length + second.notices.length, 1);
  await first.unmount(); await second.unmount();
});

test('an inactive central stays quiet; entering work resumes and a break stops reminders and background reads', async () => {
  const f = fixture({ enabled: false }); await f.mount();
  await f.advance(60000); assert.equal(f.calls.length, 0); assert.equal(f.notices.length, 0);
  await f.update({ enabled: true }); assert.equal(f.notices.length, 1); assert.ok(f.current.notice);
  await f.update({ enabled: false }); assert.equal(f.current.notice, null); assert.equal(f.timers.size, 0);
  const callsAtBreak = f.calls.length;
  await f.advance(120000); assert.equal(f.calls.length, callsAtBreak); assert.equal(f.notices.length, 1);
  await f.update({ enabled: true }); assert.equal(f.notices.length, 2);
  f.records.length = 0; await f.refresh(); assert.equal(f.current.notice, null);
  await f.unmount();
});

test('a delayed attention read cannot announce after the central disconnects or starts a break', async () => {
  const f = fixture(); let release;
  f.block(new Promise(resolve => { release = resolve; })); await f.mount();
  await f.update({ enabled: false }); assert.equal(f.calls[0].signal.aborted, true);
  release(); await f.settle();
  assert.equal(f.notices.length, 0); assert.equal(f.current.notice, null); assert.equal(f.timers.size, 0);
  await f.unmount();
});
