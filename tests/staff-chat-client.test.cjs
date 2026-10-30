const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const session = (token = 'old', id = 'worker-a') => ({ access_token: token, user: { id } });
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
function setup({ sessions = [session()], fetches = [], refreshed = session('new') } = {}) {
  const calls = []; let reads = 0, refreshes = 0;
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/staff-chat-client.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, Headers, AbortSignal, Error,
    require: () => ({ supabaseBrowser: () => ({ auth: {
      getSession: async () => ({ data: { session: sessions[Math.min(reads++, sessions.length - 1)] } }),
      refreshSession: async () => { refreshes++; return { data: { session: refreshed }, error: null }; },
    } }) }),
    fetch: async (url, init) => { calls.push({ url, init }); const value = fetches.shift(); if (value instanceof Error) throw value; return value; },
  });
  return { request: exports.chatRequest, calls, get refreshes() { return refreshes; } };
}
test('expired access token refreshes once and preserves the idempotent send body', async () => {
  const f = setup({ fetches: [response(401, { error: 'NO_AUTH' }), response(200, { ok: true, message: { id: 'accepted' } })] });
  const body = JSON.stringify({ thread_id: 'thread-a', text: 'Prueba simulada', client_message_id: 'same-id' });
  const result = await f.request('/api/chat/messages', { method: 'POST', body });
  assert.equal(result.message.id, 'accepted'); assert.equal(f.refreshes, 1);
  assert.deepEqual(f.calls.map(c => c.init.body), [body, body]);
  assert.deepEqual(f.calls.map(c => c.init.headers.get('Authorization')), ['Bearer old', 'Bearer new']);
});
test('concurrent refresh reuses new token instead of refreshing again', async () => {
  const f = setup({ sessions: [session(), session('already-refreshed')], fetches: [response(401, { error: 'NO_AUTH' }), response(200, { ok: true })] });
  await f.request('/api/chat/threads'); assert.equal(f.refreshes, 0);
  assert.equal(f.calls[1].init.headers.get('Authorization'), 'Bearer already-refreshed');
});
test('never replays a request after logout or account switch', async () => {
  for (const next of [null, session('other-token', 'worker-b')]) {
    const f = setup({ sessions: [session(), next], fetches: [response(401, { error: 'NO_AUTH' })] });
    await assert.rejects(f.request('/api/chat/messages', { method: 'POST' }), e => e.code === 'IDENTITY_CHANGED');
    assert.equal(f.calls.length, 1); assert.equal(f.refreshes, 0);
  }
});
test('connection rejection is preserved and does not refresh auth', async () => {
  const f = setup({ fetches: [response(423, { error: 'PANEL_CONNECTION_REQUIRED' })] });
  await assert.rejects(f.request('/api/chat/messages'), e => e.code === 'PANEL_CONNECTION_REQUIRED' && e.status === 423);
  assert.equal(f.calls.length, 1); assert.equal(f.refreshes, 0);
});
test('lost send responses are never automatically repeated', async () => {
  const f = setup({ fetches: [new Error('Failed to fetch')] });
  await assert.rejects(f.request('/api/chat/messages', { method: 'POST' }), e => e.code === 'NETWORK_ERROR');
  assert.equal(f.calls.length, 1);
});
test('intentional read cancellation remains an abort, not a user-facing connection failure', async () => {
  const controller = new AbortController(); controller.abort();
  const error = new Error('Aborted'); error.name = 'AbortError';
  const f = setup({ fetches: [error] });
  await assert.rejects(f.request('/api/chat/messages?thread_id=a', { signal: controller.signal }), e => e === error);
});
test('a second unauthorized result fails without another refresh or retry', async () => {
  const f = setup({ fetches: [response(401, { error: 'NO_AUTH' }), response(401, { error: 'NO_AUTH' })] });
  await assert.rejects(f.request('/api/chat/threads'), e => e.code === 'NO_AUTH');
  assert.equal(f.calls.length, 2); assert.equal(f.refreshes, 1);
});
