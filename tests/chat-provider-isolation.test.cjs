const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), React = require('react');
const { act, create } = require('react-test-renderer');
const { randomUUID } = require('node:crypto');

// Simulated actors and in-memory promises only; no request reaches a server.
const flush = async fn => act(async () => { fn?.(); await new Promise(resolve => setImmediate(resolve)); });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
async function fixture(t) {
  let current, view;
  const requests = [], opens = [], renders = [];
  const state = { me: { id: 'actor-a' }, threads: [], loading: false, error: '', unreadTotal: 0, refresh: async () => { control.refreshes++; return control.refresh(); }, requestOpen: id => opens.push(id) };
  const control = { request: async () => ({ messages: [] }), refresh: async () => {}, refreshes: 0 };
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/providers/ChatProvider.tsx'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, crypto: { randomUUID }, console, require(name) {
    if (name === '@/providers/StaffChatProvider') return { useStaffChat: () => state };
    if (name === '@/lib/staff-chat-client') return { chatRequest: async (url, init = {}) => { const request = { url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null }; requests.push(request); return control.request(request); } };
    return require(name);
  } });
  function Probe() { current = exports.useChat(); renders.push({ actor: state.me?.id || '', selected: current.selectedThreadId, messages: current.messages }); return null; }
  const element = () => React.createElement(exports.ChatProvider, null, React.createElement(Probe));
  await flush(() => { view = create(element()); });
  t.after(() => act(() => view.unmount()));
  return { state, control, requests, opens, renders, get chat() { return current; }, async select(id) { await flush(() => current.setSelectedThreadId(id)); }, async actor(id) { state.me = id ? { id } : null; await flush(() => view.update(element())); } };
}
const row = (id, thread_id) => ({ id, thread_id, text: `Simulado ${id}` });

test('account changes hide selected thread and messages on the first new-account render', async t => {
  const f = await fixture(t); await f.select('thread-a');
  f.control.request = async () => ({ messages: [row('old', 'thread-a')] });
  await flush(() => { void f.chat.loadMessages(); });
  assert.equal(f.chat.messages[0].id, 'old');
  await f.actor('actor-b');
  assert.equal(f.chat.selectedThreadId, ''); assert.equal(f.chat.messages.length, 0);
  assert.ok(f.renders.filter(render => render.actor === 'actor-b').every(render => !render.selected && !render.messages.length));
});

test('GET from a previous actor cannot replace the new account messages', async t => {
  const f = await fixture(t), old = deferred(); await f.select('thread-a');
  f.control.request = request => request.url.includes('thread-a') ? old.promise : Promise.resolve({ messages: [row('new', 'thread-b')] });
  let oldLoad; await flush(() => { oldLoad = f.chat.loadMessages(); });
  await f.actor('actor-b'); await f.select('thread-b');
  await flush(() => { void f.chat.loadMessages(); });
  await flush(() => old.resolve({ messages: [row('old', 'thread-a')] })); await oldLoad;
  assert.equal(f.chat.selectedThreadId, 'thread-b'); assert.equal(f.chat.messages[0].id, 'new');
});

test('GET from a previous selected thread is discarded for the same actor', async t => {
  const f = await fixture(t), old = deferred(); await f.select('thread-a');
  f.control.request = request => request.url.includes('thread-a') ? old.promise : Promise.resolve({ messages: [row('new', 'thread-b')] });
  await flush(() => { void f.chat.loadMessages(); });
  await f.select('thread-b'); await flush(() => { void f.chat.loadMessages(); });
  await flush(() => old.resolve({ messages: [row('old', 'thread-a')] }));
  assert.equal(f.chat.messages[0].id, 'new');
});

test('a slower older GET cannot overwrite the latest response for one thread', async t => {
  const f = await fixture(t), older = deferred(); await f.select('thread-a'); let count = 0;
  f.control.request = () => ++count === 1 ? older.promise : Promise.resolve({ messages: [row('latest', 'thread-a')] });
  await flush(() => { void f.chat.loadMessages(); }); await flush(() => { void f.chat.loadMessages(); });
  await flush(() => older.resolve({ messages: [row('stale', 'thread-a')] }));
  assert.equal(f.chat.messages[0].id, 'latest');
});

test('late thread creation from another actor cannot select or open the old thread', async t => {
  const f = await fixture(t), pending = deferred(); f.control.request = () => pending.promise;
  let opening; await flush(() => { opening = f.chat.openThreadWithTarotist('tarotista-fixture'); });
  await f.actor('actor-b');
  await flush(() => pending.resolve({ thread: { id: 'thread-old' } }));
  assert.equal(await opening, ''); assert.equal(f.chat.selectedThreadId, ''); assert.equal(f.opens.length, 0); assert.equal(f.control.refreshes, 0);
});

test('an account switch during overview refresh also cancels the pending open request', async t => {
  const f = await fixture(t), refresh = deferred();
  f.control.request = async () => ({ thread: { id: 'thread-old' } }); f.control.refresh = () => refresh.promise;
  let opening; await flush(() => { opening = f.chat.openThreadWithTarotist('tarotista-fixture'); });
  assert.equal(f.chat.selectedThreadId, 'thread-old');
  await f.actor('actor-b'); await flush(() => refresh.resolve());
  assert.equal(await opening, ''); assert.equal(f.opens.length, 0); assert.equal(f.chat.selectedThreadId, '');
});

test('the latest open action wins when thread creations resolve out of order', async t => {
  const f = await fixture(t), first = deferred(), last = deferred();
  f.control.request = request => request.body.contact_worker_id === 'first' ? first.promise : last.promise;
  let older, newer;
  await flush(() => { older = f.chat.openThreadWithTarotist('first'); newer = f.chat.openThreadWithTarotist('last'); });
  await flush(() => last.resolve({ thread: { id: 'thread-last' } }));
  await flush(() => first.resolve({ thread: { id: 'thread-first' } }));
  assert.equal(await older, ''); assert.equal(await newer, 'thread-last'); assert.equal(f.chat.selectedThreadId, 'thread-last'); assert.deepEqual(f.opens, ['thread-last']);
});

test('late send completion cannot refresh or load messages under the new actor', async t => {
  const f = await fixture(t), sending = deferred(); await f.select('thread-a');
  f.control.request = () => sending.promise;
  let sent; await flush(() => { sent = f.chat.sendMessage('Contenido simulado'); });
  await f.actor('actor-b'); await flush(() => sending.resolve({ ok: true })); await sent;
  assert.equal(f.requests.length, 1); assert.equal(f.control.refreshes, 0); assert.equal(f.chat.messages.length, 0);
});

test('callbacks retained from an old account do not issue new requests after sign-out', async t => {
  const f = await fixture(t); await f.select('thread-a'); const old = f.chat;
  await f.actor(null);
  await flush(() => { void old.loadMessages(); void old.sendMessage('Simulado'); void old.openThreadWithTarotist('old'); old.setSelectedThreadId('thread-old'); });
  assert.equal(f.requests.length, 0); assert.equal(f.chat.selectedThreadId, '');
});
