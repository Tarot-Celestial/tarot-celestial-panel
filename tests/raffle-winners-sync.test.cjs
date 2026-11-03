const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), { act, create } = require('react-test-renderer');
const flush = fn => act(async () => { fn?.(); await new Promise(resolve => setImmediate(resolve)); });
const text = n => typeof n === 'string' ? n : (n?.children || []).map(text).join('');
const winners = Array.from({ length: 31 }, (_, i) => ({ position: i + 1, prize_name: `Premio ${i + 1}`, winning_number: i + 10, selection_method: 'roulette', is_test: false }));

function fixture() {
  const listeners = new Map(), intervals = new Map(), timers = new Map(), subscriptions = [];
  let id = 0, rows = [], fail = false, hang = false, requests = 0, removed = false, view;
  const document = { visibilityState: 'visible', addEventListener: (n, f) => listeners.set(n, f), removeEventListener: n => listeners.delete(n) };
  const window = { addEventListener: (n, f) => listeners.set(n, f), removeEventListener: n => listeners.delete(n), setInterval: (f, ms) => { intervals.set(++id, { f, ms }); return id; }, clearInterval: i => intervals.delete(i) };
  const sb = { auth: { getSession: async () => ({ data: { session: { access_token: 'fixture-token' } } }) }, channel: () => {
    const channel = { on: (_event, filter, cb) => { subscriptions.push({ channel, filter, cb }); return channel; }, subscribe: () => channel };
    return channel;
  }, removeChannel: async channel => { for (let i = subscriptions.length - 1; i >= 0; i--) if (subscriptions[i].channel === channel) subscriptions.splice(i, 1); removed = true; } };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/cliente/RaffleWinners.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, console, Error, AbortController, window, document,
    setTimeout: (f, ms) => { timers.set(++id, { f, ms }); return id; }, clearTimeout: i => timers.delete(i),
    require: name => name === '@/lib/supabase-browser' ? { supabaseClienteBrowser: () => sb } : name.endsWith('.css') ? { default: {} } : require(name),
    fetch: async (_url, init) => { requests++; assert.equal(init.cache, 'no-store'); assert.equal(init.headers.Authorization, 'Bearer fixture-token'); if (hang) await new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); if (fail) throw new Error('offline'); return { ok: true, json: async () => ({ ok: true, winners: rows }) }; },
  });
  const drain = async () => flush(() => { for (const [i, timer] of [...timers]) if (timer.ms === 250) { timers.delete(i); timer.f(); } });
  return {
    mount: async () => flush(() => { view = create(React.createElement(exports.default)); }),
    rows: value => { rows = value; }, fail: value => { fail = value; }, hang: value => { hang = value; },
    timeout: async () => flush(() => { for (const [i, timer] of [...timers]) if (timer.ms === 15000) { timers.delete(i); timer.f(); } }),
    poll: async () => { assert.equal(intervals.size, 1, 'must refresh even without Realtime events'); await flush(() => [...intervals.values()][0].f()); await drain(); },
    event: async name => { await flush(() => listeners.get(name)?.()); await drain(); },
    realtime: async table => { await flush(() => subscriptions.find(s => s.filter.table === table)?.cb()); await drain(); },
    manual: async () => flush(() => view.root.findByType('button').props.onClick()),
    hidden: value => { document.visibilityState = value ? 'hidden' : 'visible'; },
    articles: () => view.root.findAllByType('article').length, content: () => text(view.toJSON()), requests: () => requests,
    unmount: async () => { await flush(() => view.unmount()); assert.equal(intervals.size, 0); assert.equal(timers.size, 0); assert.equal(listeners.size, 0); assert.equal(removed, true); },
  };
}

test('an already open empty panel shows all 31 confirmations even if Realtime is lost', async () => {
  const f = fixture(); await f.mount();
  try { assert.equal(f.articles(), 0); f.rows(winners); await f.poll(); assert.equal(f.articles(), 31); assert.doesNotMatch(f.content(), /aparecerán aquí/); }
  finally { await f.unmount(); }
});

test('hidden tabs avoid polling and refresh after returning or reconnecting', async () => {
  const f = fixture(); await f.mount();
  try { f.hidden(true); const before = f.requests(); f.rows(winners); await f.poll(); assert.equal(f.requests(), before); f.hidden(false); await f.event('visibilitychange'); assert.equal(f.articles(), 31); f.rows(winners.slice(0, 2)); await f.event('online'); assert.equal(f.articles(), 2); }
  finally { await f.unmount(); }
});

test('a refresh failure keeps confirmed results and an online retry clears the error', async () => {
  const f = fixture(); f.rows(winners); await f.mount();
  try { f.fail(true); await f.event('focus'); assert.equal(f.articles(), 31); assert.match(f.content(), /offline/); f.fail(false); await f.event('online'); assert.equal(f.articles(), 31); assert.doesNotMatch(f.content(), /offline/); }
  finally { await f.unmount(); }
});

test('manual refresh and realtime publication/raffle changes reload the public list', async () => {
  const f = fixture(); await f.mount();
  try { f.rows(winners); await f.manual(); assert.equal(f.articles(), 31); f.rows(winners.slice(0, 1)); await f.realtime('raffle_public_winners'); assert.equal(f.articles(), 1); f.rows([]); await f.realtime('raffles'); assert.equal(f.articles(), 0); }
  finally { await f.unmount(); }
});

test('a stalled request times out, coalesces concurrent refreshes and recovers on the next poll', async () => {
  const f = fixture(); f.hang(true); await f.mount();
  try {
    await f.poll(); await f.event('focus'); assert.equal(f.requests(), 1);
    await f.timeout(); assert.match(f.content(), /tardó demasiado/);
    f.hang(false); f.rows(winners); await f.poll();
    assert.equal(f.requests(), 2); assert.equal(f.articles(), 31); assert.doesNotMatch(f.content(), /tardó demasiado/);
  } finally { await f.unmount(); }
});
