const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

function fixture() {
  const calls = [], exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/recovery-mission-read.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const fetch = (url, init) => new Promise((resolve, reject) => {
    calls.push({ url, init, fail: reject, finish: (payload, ok = true) => resolve({ ok, json: async () => payload }) });
  });
  vm.runInNewContext(code, { exports, fetch, AbortController });
  return { read: exports.readRecoveryMission, calls };
}

test('concurrent mission views share one GET and completed reads are never cached', async () => {
  const f = fixture(), a = new AbortController(), b = new AbortController();
  const first = f.read('session-a', a.signal), second = f.read('session-a', b.signal);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].init.method, 'GET');
  f.calls[0].finish({ ok: true, mission: { worker_id: 'worker-a', managed: 3 } });
  assert.equal((await first).payload.mission.managed, 3);
  assert.equal((await second).payload.mission.managed, 3);
  const fresh = f.read('session-a', a.signal); assert.equal(f.calls.length, 2);
  f.calls[1].finish({ ok: true, mission: { managed: 4 } });
  assert.equal((await fresh).payload.mission.managed, 4);
});

test('one unmounted consumer does not abort another active mission view', async () => {
  const f = fixture(), a = new AbortController(), b = new AbortController();
  const first = f.read('session-a', a.signal), second = f.read('session-a', b.signal);
  const cancelled = assert.rejects(first, { name: 'AbortError' }); a.abort(); await cancelled;
  assert.equal(f.calls[0].init.signal.aborted, false);
  f.calls[0].finish({ ok: true, mission: { managed: 7 } });
  assert.equal((await second).payload.mission.managed, 7);
});

test('a shared refresh cancels the obsolete read and coalesces fresh consumers', async () => {
  const f = fixture(), a = new AbortController(), b = new AbortController();
  const first = f.read('session-a', a.signal), second = f.read('session-a', b.signal);
  const cancelled = Promise.all([assert.rejects(first, { name: 'AbortError' }), assert.rejects(second, { name: 'AbortError' })]);
  a.abort(); b.abort(); await cancelled;
  assert.equal(f.calls[0].init.signal.aborted, true);
  const fresh = f.read('session-a', new AbortController().signal), companion = f.read('session-a', new AbortController().signal);
  assert.equal(f.calls.length, 2);
  // Even an upstream response that ignores abort cannot replace the new request.
  f.calls[0].finish({ ok: true, mission: { managed: 1 } });
  await new Promise(resolve => setImmediate(resolve));
  const third = f.read('session-a', new AbortController().signal); assert.equal(f.calls.length, 2);
  f.calls[1].finish({ ok: true, mission: { managed: 9 } });
  for (const result of await Promise.all([fresh, companion, third])) assert.equal(result.payload.mission.managed, 9);
});

test('different users and refreshed tokens never share a response', async () => {
  const f = fixture();
  const a = f.read('user-a-session-1', new AbortController().signal);
  const b = f.read('user-b-session-1', new AbortController().signal);
  const refreshed = f.read('user-a-session-2', new AbortController().signal);
  assert.equal(f.calls.length, 3);
  f.calls.forEach((call, index) => call.finish({ owner: ['a', 'b', 'a-refreshed'][index] }));
  assert.deepEqual((await Promise.all([a, b, refreshed])).map(result => result.payload.owner), ['a', 'b', 'a-refreshed']);
  assert.equal(f.calls[1].init.headers.Authorization, 'Bearer user-b-session-1');
});

test('failures reach all consumers and the next request retries normally', async () => {
  const f = fixture(), signal = new AbortController().signal;
  const a = f.read('session-a', signal), b = f.read('session-a', signal);
  const failures = Promise.all([assert.rejects(a, /unavailable/), assert.rejects(b, /unavailable/)]);
  f.calls[0].fail(new Error('unavailable')); await failures;
  const retry = f.read('session-a', signal); assert.equal(f.calls.length, 2);
  f.calls[1].finish({ ok: false, error: 'Temporarily unavailable' }, false);
  assert.equal((await retry).ok, false);
});

test('an already cancelled consumer starts no request', async () => {
  const f = fixture(), abort = new AbortController(); abort.abort();
  await assert.rejects(f.read('session-a', abort.signal), { name: 'AbortError' });
  assert.equal(f.calls.length, 0);
});
