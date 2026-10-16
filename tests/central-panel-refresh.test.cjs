const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

// Execute the real page effect with controllable network/event timing. This
// verifies bursts and late responses without mounting unrelated phone providers.
const text = fs.readFileSync(path.join(__dirname, '../src/app/panel-central/page.tsx'), 'utf8');
const file = ts.createSourceFile('page.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let refreshEffect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(file) === 'useEffect' && node.arguments[0].getText(file).includes('/api/central/my-clients?page=')) refreshEffect = node.getText(file);
  ts.forEachChild(node, visit);
}
visit(file);
assert.ok(refreshEffect, 'Client stats subscription effect is present');

function mount() {
  const timers = new Map(), realtime = [], windowEvents = {}, documentEvents = {}, requests = [], stats = [];
  let seq = 0, cleanup, removed = false;
  const schedule = (fn, delay) => { timers.set(++seq, { fn, delay }); return seq; };
  const window = { setInterval: schedule, clearInterval: id => timers.delete(id), addEventListener: (key, fn) => windowEvents[key] = fn, removeEventListener: key => delete windowEvents[key] };
  const document = { visibilityState: 'visible', addEventListener: (key, fn) => documentEvents[key] = fn, removeEventListener: key => delete documentEvents[key] };
  const channel = { on(_kind, _filter, fn) { realtime.push(fn); return this; }, subscribe() { return this; } };
  vm.runInNewContext(ts.transpileModule(refreshEffect, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    useEffect: fn => cleanup = fn(), ok: true, tab: 'central', themeWorkerId: 'worker-a',
    handleMyClientsStats: next => stats.push(next), window, document, AbortController,
    setTimeout: schedule, clearTimeout: id => timers.delete(id),
    sb: { auth: { async getSession() { return { data: { session: { access_token: 'test-only' } } }; } }, channel: () => channel, async removeChannel() { removed = true; } },
    fetch: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })),
  });
  return {
    requests, stats, document, windowEvents,
    flush: () => new Promise(resolve => setImmediate(resolve)),
    emitBurst() { realtime.forEach(fn => fn()); },
    runScheduled() { for (const [id, timer] of [...timers]) if (timer.delay === 180) { timers.delete(id); timer.fn(); } },
    complete(index, active) { requests[index].resolve({ ok: true, async json() { return { ok: true, stats: { active, active_this_week: 2, followup: 1 } }; } }); },
    dispose() { cleanup(); assert.equal(removed, true); assert.equal(timers.size, 0); assert.equal(Object.keys(windowEvents).length, 0); assert.equal(Object.keys(documentEvents).length, 0); },
  };
}

test('realtime bursts have one in-flight stats request and one trailing refresh', async () => {
  const m = mount();
  try {
    await m.flush(); assert.equal(m.requests.length, 1);
    m.emitBurst(); m.emitBurst(); m.runScheduled(); await m.flush();
    assert.equal(m.requests.length, 1);
    m.complete(0, 8); await m.flush(); m.runScheduled(); await m.flush();
    assert.equal(m.requests.length, 2);
    m.complete(1, 9); await m.flush();
    assert.equal(m.stats.at(-1).active, 9);
    m.emitBurst(); m.document.visibilityState = 'hidden'; m.runScheduled(); await m.flush();
    assert.equal(m.requests.length, 2);
    m.document.visibilityState = 'visible'; m.windowEvents['tc-my-clients-refresh'](); m.runScheduled(); await m.flush();
    assert.equal(m.requests.length, 3);
  } finally { m.dispose(); }
});

test('leaving the page aborts pending reads and ignores their late responses', async () => {
  const m = mount(); await m.flush(); m.emitBurst(); m.dispose();
  assert.equal(m.requests[0].options.signal.aborted, true);
  m.complete(0, 99); await m.flush();
  assert.equal(m.stats.length, 0); assert.equal(m.requests.length, 1);
});
