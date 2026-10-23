const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');
const summary = (account, count = 3, revision = '1') => ({ account_id: account, configured: true, available: true, count, messages: count, comments: 0, revision, error: null });

function fixture() {
  let clock = 0, serial = 0, tree, result, status = 200, blocking, authCallback, realtime, removed = 0;
  let session = { access_token: 'fixture', user: { id: 'user-a' } };
  const payload = { ok: true, user_id: 'user-a', worker_id: 'worker-a', instagram: summary('ig'), facebook: summary('fb', 2) };
  const options = { enabled: true, workerId: 'worker-a' };
  const timers = new Map(), events = new Map(), documentEvents = new Map(), calls = [], dispatched = [];
  class FakeDate extends Date { static now() { return clock; } }
  const window = {
    setTimeout(cb, ms) { timers.set(++serial, { cb, at: clock + ms }); return serial; }, clearTimeout(id) { timers.delete(id); },
    addEventListener(name, cb) { events.set(name, cb); }, removeEventListener(name) { events.delete(name); },
    dispatchEvent(event) { dispatched.push(event); events.get(event.type)?.(event); },
  };
  const document = { hidden: false, addEventListener(name, cb) { documentEvents.set(name, cb); }, removeEventListener(name) { documentEvents.delete(name); } };
  const channel = { on(_type, filter, callback) { assert.equal(filter.table, 'tc_social_inbox_activity'); realtime = callback; return channel; }, subscribe() { return channel; } };
  const sb = { auth: { getSession: async () => ({ data: { session } }), onAuthStateChange(callback) { authCallback = callback; return { data: { subscription: { unsubscribe() {} } } }; } },
    channel() { return channel; }, removeChannel(value) { assert.equal(value, channel); removed++; } };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, Date: FakeDate, AbortController, window, document, console,
      CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
      fetch: async (url, init) => {
        calls.push({ url, init }); const body = JSON.parse(JSON.stringify(payload)); const currentStatus = status;
        if (blocking) await blocking;
        return { ok: currentStatus === 200, status: currentStatus, json: async () => body };
      },
      require(name) { if (name === '@/lib/supabase-browser') return { supabaseBrowser: () => sb }; if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`); return require(name); },
    });
    return exports;
  }
  const logic = load('src/lib/social-attention.ts');
  const hook = load('src/features/central/useSocialAttention.ts').useSocialAttention;
  function Probe() { result = hook(options.enabled, options.workerId); return null; }
  const act = async callback => renderer.act(async () => { callback?.(); await new Promise(resolve => setImmediate(resolve)); });
  return {
    payload, calls, dispatched, timers, logic,
    get state() { return result; }, get removed() { return removed; },
    async mount() { await act(() => { tree = renderer.create(React.createElement(Probe)); }); },
    async close() { await act(() => tree.unmount()); assert.equal(timers.size, 0); assert.equal(events.size, 0); assert.equal(documentEvents.size, 0); },
    async event(name) { await act(() => events.get(name)?.()); },
    async realtime() { await act(() => realtime()); },
    async hidden(value) { await act(() => { document.hidden = value; documentEvents.get('visibilitychange')?.(); }); },
    async signOut() { await act(() => { session = null; authCallback('SIGNED_OUT', null); }); },
    async settle() { await act(); },
    status(value) { status = value; }, block(value) { blocking = value; },
    async advance(ms) {
      const until = clock + ms;
      while (true) {
        const next = [...timers.values()].map(timer => timer.at).filter(at => at <= until).sort((a, b) => a - b)[0];
        if (next === undefined) break;
        clock = next;
        await act(() => { for (const [id, timer] of [...timers]) if (timers.has(id) && timer.at <= clock) { timers.delete(id); timer.cb(); } });
      }
      clock = until;
    },
  };
}

test('one metadata request supplies separate totals and never lists, reads or sends social conversations', async () => {
  const f = fixture(); await f.mount();
  assert.equal(f.state.instagram.count, 3); assert.equal(f.state.facebook.count, 2);
  await f.advance(60_000); assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(call => call.url === '/api/central/social-attention' && !call.init.method));
  await f.close(); assert.equal(f.removed, 1);
});

test('Realtime bursts coalesce and changed provider revisions invalidate only that inbox', async () => {
  const f = fixture(); await f.mount();
  f.payload.facebook = summary('fb', 5, '2');
  await f.realtime(); await f.realtime(); await f.realtime();
  await f.advance(499); assert.equal(f.calls.length, 1);
  await f.advance(1); assert.equal(f.calls.length, 2); assert.equal(f.state.facebook.count, 5);
  assert.deepEqual(f.dispatched.map(event => ({ type: event.type, provider: event.detail.provider })), [{ type: f.logic.SOCIAL_INBOX_INVALIDATE, provider: 'facebook' }]);
  await f.close();
});

test('read-success refresh gets authoritative totals; failures preserve the prior count and back off', async () => {
  const f = fixture(); await f.mount();
  f.payload.instagram = summary('ig', 1, '2');
  await f.event(f.logic.SOCIAL_ATTENTION_REFRESH); await f.advance(500); assert.equal(f.state.instagram.count, 1);
  f.status(503); await f.advance(60_000); assert.equal(f.state.instagram.count, 1); assert.ok(f.state.instagram.error);
  const before = f.calls.length; await f.advance(60_000); assert.equal(f.calls.length, before);
  await f.advance(60_000); assert.equal(f.calls.length, before + 1);
  await f.close();
});

test('one unavailable provider does not erase its count or the other provider snapshot', async () => {
  const f = fixture(); await f.mount();
  f.payload.instagram = { account_id: 'ig', configured: true, available: false, count: null, messages: null, comments: null, revision: null, error: 'private-provider-error' };
  f.payload.facebook = summary('fb', 7, '2');
  await f.realtime(); await f.advance(500);
  assert.equal(f.state.instagram.count, 3); assert.ok(f.state.instagram.error); assert.doesNotMatch(f.state.instagram.error, /private-provider-error/);
  assert.equal(f.state.facebook.count, 7); assert.equal(f.state.facebook.error, '');
  f.payload.instagram.account_id = 'different-account'; await f.realtime(); await f.advance(500);
  assert.equal(f.state.instagram.count, 0);
  f.payload.instagram = { configured: false, account_id: null }; await f.realtime(); await f.advance(500);
  assert.equal(f.state.instagram.count, 0); assert.equal(f.state.instagram.configured, false);
  await f.close();
});

test('hidden panels stop reads and visible focus resumes one summary request', async () => {
  const f = fixture(); await f.mount(); await f.hidden(true);
  await f.advance(180_000); await f.realtime(); await f.advance(500); assert.equal(f.calls.length, 1);
  await f.hidden(false); await f.event('focus'); await f.advance(500); assert.equal(f.calls.length, 2);
  await f.close();
});

test('requests do not overlap and a signed-out session cannot receive a late snapshot', async () => {
  const f = fixture(); await f.mount(); let release;
  f.block(new Promise(resolve => { release = resolve; })); await f.realtime(); await f.advance(500);
  await f.realtime(); await f.advance(500); assert.equal(f.calls.length, 2);
  await f.signOut(); release(); await f.settle();
  assert.equal(f.state.instagram.count, 0); assert.equal(f.state.facebook.count, 0);
  await f.close();
});

test('wrong identities and inconsistent totals never become valid badge snapshots', async () => {
  const f = fixture(); await f.mount();
  f.payload.instagram.count = 99; await f.realtime(); await f.advance(500);
  assert.equal(f.state.instagram.count, 3); assert.ok(f.state.instagram.error);
  f.payload.instagram = summary('ig', 8, '2'); f.payload.user_id = 'someone-else'; await f.realtime(); await f.advance(500);
  assert.equal(f.state.instagram.count, 0); assert.equal(f.state.facebook.count, 0);
  await f.close();
});
