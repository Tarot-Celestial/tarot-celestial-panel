const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');
const { randomUUID } = require('node:crypto');

// All identities and messages are simulated; the request stub never uses a network.
const styles = new Proxy({}, { get: (_, name) => String(name) });
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : (Array.isArray(node) ? node : node?.children || []).map(text).join('');
const flush = async fn => act(async () => { fn?.(); for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const contact = id => ({ id, display_name: `${id} Simulada`, role: 'tarotista', team: null, state: 'online' });
const message = (id, thread = 'ta', extra = {}) => ({ id, thread_id: thread, sender_worker_id: 'a', sender_display_name: 'A Simulada', text: `Mensaje simulado ${id}`, created_at: `2026-10-29T12:${String(Number(id.replace(/\D/g, '')) || 0).padStart(2, '0')}:00Z`, ...extra });

function harness(options = {}) {
  let view, focused = true, visible = 'visible', scrollTop = 0, refreshes = 0;
  const calls = [], requests = [], listeners = new Map(), timers = new Map(), frames = new Map();
  let timerId = 0;
  const attendance = { online: true, status: 'working', sessionId: 'session-fixture', expiresAt: new Date(Date.now() + 3600000).toISOString(), error: null };
  const context = {
    me: { id: 'me', role: 'central', display_name: 'Central Simulada' }, mode: 'central', contacts: [contact('a'), contact('b')],
    threads: ['a', 'b'].map(id => ({ id: `t${id}`, contact: contact(id), unread_count: 2 })), unreadTotal: 4, loading: false, error: '', live: true,
    sound: true, volume: 100, audioReady: false, notificationPermission: 'default', incoming: null, openRequest: null,
    refresh: async () => { refreshes++; }, setSound: value => { context.sound = value; }, setVolume: value => { context.volume = value; }, testSound: async () => {}, enableNotifications: async () => {}, setVisibleThread: (surface, thread) => calls.push({ surface, thread }),
    ...options.context,
  };
  const pages = { ta: [message('m1'), message('m2'), message('m3')], tb: [message('m4', 'tb')], ...options.pages };
  const rows = () => view?.root.findAll(node => typeof node.props['data-message-id'] === 'string') || [];
  const listNode = {
    clientHeight: 120,
    get scrollHeight() { return Math.max(120, rows().length * 60); },
    get scrollTop() { return scrollTop; },
    set scrollTop(value) { scrollTop = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); },
    getBoundingClientRect: () => ({ top: 0, bottom: 120, left: 0, right: 400 }),
    querySelectorAll: () => rows().map((row, index) => ({ dataset: { messageId: row.props['data-message-id'] }, getBoundingClientRect: () => ({ top: index * 60 - scrollTop, bottom: index * 60 + 55 - scrollTop }) })),
  };
  function add(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); }
  function remove(name, callback) { listeners.get(name)?.delete(callback); }
  const windowMock = {
    innerHeight: 900, innerWidth: 1280,
    addEventListener: add, removeEventListener: remove,
    matchMedia: () => ({ matches: !!options.mobile, addEventListener() {}, removeEventListener() {} }),
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id),
    setInterval: callback => { timers.set(++timerId, callback); return timerId; }, clearInterval: id => timers.delete(id),
    requestAnimationFrame: callback => { const id = ++timerId; const handle = setImmediate(() => { frames.delete(id); callback(); }); frames.set(id, handle); return id; },
    cancelAnimationFrame: id => { clearImmediate(frames.get(id)); frames.delete(id); },
  };
  const documentMock = { get visibilityState() { return visible; }, hasFocus: () => focused, addEventListener: add, removeEventListener: remove, activeElement: null };
  const chatRequest = async (url, init = {}) => {
    const request = { url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, signal: init.signal };
    requests.push(request);
    const customized = options.request?.(request, pages);
    if (customized !== undefined) return customized;
    if (url.startsWith('/api/chat/messages?')) {
      const params = new URL(url, 'https://fixture.invalid').searchParams;
      return { messages: pages[params.get('thread_id')] || [], has_more: false, next_cursor: null };
    }
    if (url === '/api/chat/messages') return { message: message('m5', request.body.thread_id, { ...request.body, sender_worker_id: 'me' }) };
    if (url === '/api/chat/threads') return { thread: { id: `t${request.body.contact_worker_id}` } };
    return { ok: true };
  };
  const icons = new Proxy({}, { get: (_, name) => props => React.createElement('i', { ...props, 'data-icon': String(name) }) });
  function evaluate(relative, extra = {}) {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(code, {
      exports, require: name => name in extra ? extra[name] : name.endsWith('.module.css') ? { default: styles } : name === 'lucide-react' ? icons : name === '@/hooks/useAttendance' ? { useAttendance: () => attendance } : name === '@/providers/StaffChatProvider' ? { useStaffChat: () => context } : name === '@/lib/staff-chat-client' ? { chatRequest } : require(name),
      window: windowMock, document: documentMock, IntersectionObserver: class { constructor(callback) { this.callback = callback; } observe() { this.callback([{ isIntersecting: true }]); } disconnect() {} },
      HTMLElement: class {}, crypto: { randomUUID }, AbortController, Date, Error, Map, Set, URL, console,
    });
    return exports.default;
  }
  const Panel = evaluate('src/components/chat/StaffDirectChatPanel.tsx');
  const Dock = evaluate('src/components/global/DockChatWidget.tsx', { '@/components/chat/StaffDirectChatPanel': { default: Panel } });
  const Component = options.dock ? Dock : Panel;
  let props = options.dock ? { open: true, onClose() {} } : { compact: !!options.compact };
  return {
    context, attendance, requests, calls, pages, listNode,
    get view() { return view; }, get refreshes() { return refreshes; },
    async mount() { await flush(() => { view = create(React.createElement(Component, props), { createNodeMock: element => element.props.role === 'log' ? listNode : { focus() {} } }); }); },
    async rerender(next = {}) { props = { ...props, ...next }; await flush(() => view.update(React.createElement(Component, props))); },
    async clickContact(id) { const button = view.root.findAllByType('button').find(node => text(node).includes(`${id} Simulada`)); assert.ok(button, id); await flush(() => button.props.onClick()); },
    async focus(value) { focused = value; await flush(() => listeners.get(value ? 'focus' : 'blur')?.forEach(callback => callback())); },
    async visibility(value) { visible = value; await flush(() => listeners.get('visibilitychange')?.forEach(callback => callback())); },
    async dispose() { await flush(() => view.unmount()); for (const handle of frames.values()) clearImmediate(handle); },
  };
}
const readRequests = h => h.requests.filter(request => request.url === '/api/chat/read');
const getRequests = h => h.requests.filter(request => request.method === 'GET');
const button = (h, label) => h.view.root.findAllByType('button').find(node => text(node) === label || node.props['aria-label'] === label);

test('only an on-screen, focused, connected conversation explicitly acknowledges the last visible message', async () => {
  const h = harness(); await h.mount();
  assert.equal(readRequests(h).at(-1).body.through_message_id, 'm3');
  assert.equal(h.refreshes, 1);
  await h.focus(false); const count = h.requests.length;
  h.context.incoming = message('m6'); h.pages.ta.push(message('m6')); await h.rerender();
  assert.equal(h.requests.length, count, 'background incoming does not load or acknowledge messages');
  await h.focus(true);
  assert.equal(readRequests(h).at(-1).body.through_message_id, 'm6');
  h.attendance.sessionId = null; await h.rerender();
  const readCount = readRequests(h).length;
  h.context.incoming = message('m7'); await h.rerender();
  assert.equal(readRequests(h).length, readCount);
  assert.ok(h.calls.at(-1).thread === null);
  await h.dispose();
});

test('compact mobile contact list does not fetch or acknowledge its hidden selection', async () => {
  const h = harness({ compact: true }); await h.mount();
  assert.equal(getRequests(h).length, 0); assert.equal(readRequests(h).length, 0);
  await h.clickContact('a'); assert.equal(readRequests(h).at(-1).body.thread_id, 'ta');
  await flush(() => button(h, ' Volver').props.onClick());
  const count = h.requests.length;
  h.context.incoming = message('m7'); await h.rerender();
  assert.equal(h.requests.length, count);
  await h.dispose();
});

test('late messages from the previous thread cannot overwrite a newer selection', async () => {
  const late = deferred();
  const h = harness({ request: request => request.url.includes('thread_id=ta') ? late.promise : undefined }); await h.mount();
  await h.clickContact('b');
  await flush(() => late.resolve({ messages: [message('m8')], has_more: false, next_cursor: null }));
  assert.ok(text(h.view.toJSON()).includes('Mensaje simulado m4'));
  assert.ok(!text(h.view.toJSON()).includes('Mensaje simulado m8'));
  assert.deepEqual(readRequests(h).map(request => request.body.thread_id), ['tb']);
  await h.dispose();
});

test('late thread creation cannot select the previously clicked contact', async () => {
  const a = deferred(), b = deferred();
  const h = harness({ context: { threads: [] }, request: request => request.url === '/api/chat/threads' ? request.body.contact_worker_id === 'a' ? a.promise : b.promise : undefined }); await h.mount();
  await h.clickContact('a'); await h.clickContact('b');
  await flush(() => b.resolve({ thread: { id: 'tb' } }));
  await flush(() => a.resolve({ thread: { id: 'ta' } }));
  assert.ok(text(h.view.toJSON()).includes('Mensaje simulado m4'));
  assert.ok(!getRequests(h).some(request => request.url.includes('thread_id=ta')));
  await h.dispose();
});

test('refresh merges receipts and new messages while keeping paginated history', async () => {
  let latest = [message('m3'), message('m4')];
  const h = harness({ request: request => request.url.includes('thread_id=ta') ? { messages: request.url.includes('&before=') ? [message('m1'), message('m2')] : latest, has_more: !request.url.includes('&before='), next_cursor: request.url.includes('&before=') ? null : '2026-10-29T12:03:00Z' } : undefined }); await h.mount();
  await flush(() => button(h, 'Cargar mensajes anteriores').props.onClick());
  latest = [message('m4'), message('m5')];
  h.context.incoming = message('m5'); await h.rerender();
  const body = text(h.view.toJSON());
  for (const id of ['m1', 'm2', 'm3', 'm4', 'm5']) assert.ok(body.includes(`Mensaje simulado ${id}`), id);
  assert.equal((body.match(/Mensaje simulado m4/g) || []).length, 1);
  assert.equal(button(h, 'Cargar mensajes anteriores'), undefined);
  await h.dispose();
});

test('retry after an unknown send outcome reuses the same client_message_id and one message', async () => {
  let attempt = 0;
  const h = harness({ request: request => {
    if (request.url !== '/api/chat/messages' || request.method !== 'POST') return;
    attempt++;
    if (attempt === 1) throw new Error('Respuesta perdida simulada');
    return { message: message('m9', 'ta', { ...request.body, sender_worker_id: 'me' }) };
  } }); await h.mount();
  await flush(() => h.view.root.findByType('textarea').props.onChange({ target: { value: 'Mensaje de prueba idempotente' } }));
  await flush(() => h.view.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.ok(button(h, 'Reintentar envío'));
  await flush(() => button(h, 'Reintentar envío').props.onClick());
  const sends = h.requests.filter(request => request.url === '/api/chat/messages' && request.method === 'POST');
  assert.equal(sends.length, 2); assert.equal(sends[0].body.client_message_id, sends[1].body.client_message_id);
  assert.equal((text(h.view.toJSON()).match(/Mensaje de prueba idempotente/g) || []).length, 1);
  assert.equal(button(h, 'Reintentar envío'), undefined);
  await h.dispose();
});

test('an explicit open request opens the exact thread, and a closed dock loads no messages', async () => {
  const h = harness({ dock: true, context: { openRequest: { threadId: 'tb', version: 1 } } }); await h.mount();
  assert.ok(getRequests(h).every(request => request.url.includes('thread_id=tb')));
  assert.equal(readRequests(h).at(-1).body.thread_id, 'tb');
  await h.rerender({ open: false }); const count = h.requests.length;
  h.context.incoming = message('m9', 'tb'); await h.rerender();
  assert.equal(h.requests.length, count); assert.equal(h.view.toJSON(), null);
  await h.dispose();
});

test('scrolling history acknowledges visible history only, leaving newer messages below unread', async () => {
  const h = harness({ pages: { ta: Array.from({ length: 6 }, (_, index) => message(`m${index + 1}`)) } }); await h.mount();
  h.listNode.scrollTop = 0;
  await flush(() => h.view.root.findByProps({ role: 'log' }).props.onScroll());
  h.pages.ta.push(message('m7')); h.context.incoming = message('m7'); await h.rerender();
  assert.notEqual(readRequests(h).at(-1).body.through_message_id, 'm7');
  assert.ok(button(h, 'Nuevos mensajes (1) '));
  await flush(() => button(h, 'Nuevos mensajes (1) ').props.onClick());
  assert.equal(readRequests(h).at(-1).body.through_message_id, 'm7');
  await h.dispose();
});

test('a newer visible receipt is acknowledged after an earlier acknowledgement finishes', async () => {
  const first = deferred(); let reads = 0;
  const h = harness({ request: request => { if (request.url === '/api/chat/read' && ++reads === 1) return first.promise; } }); await h.mount();
  h.pages.ta.push(message('m4')); h.context.incoming = message('m4'); await h.rerender();
  assert.equal(readRequests(h).length, 1);
  await flush(() => first.resolve({ ok: true }));
  assert.equal(readRequests(h).at(-1).body.through_message_id, 'm4');
  await h.dispose();
});

test('a send recovered by GET stays confirmed if its original POST later rejects', async () => {
  const pending = deferred();
  const h = harness({ request: request => request.url === '/api/chat/messages' && request.method === 'POST' ? pending.promise : undefined }); await h.mount();
  await flush(() => h.view.root.findByType('textarea').props.onChange({ target: { value: 'Confirmado por lectura simulada' } }));
  await flush(() => h.view.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  const sent = h.requests.find(request => request.url === '/api/chat/messages' && request.method === 'POST');
  h.pages.ta.push(message('m9', 'ta', { ...sent.body, sender_worker_id: 'me' }));
  await flush(() => button(h, 'Actualizar chat').props.onClick());
  await flush(() => pending.reject(new Error('Respuesta POST perdida')));
  assert.equal(button(h, 'Reintentar envío'), undefined);
  assert.equal((text(h.view.toJSON()).match(/Confirmado por lectura simulada/g) || []).length, 1);
  await h.dispose();
});

test('a visible header with the messages outside the viewport does not acknowledge them', async () => {
  const h = harness();
  h.listNode.getBoundingClientRect = () => ({ top: 1000, bottom: 1120, left: 0, right: 400 });
  await h.mount();
  assert.equal(readRequests(h).length, 0);
  await h.dispose();
});

test('incoming realtime messages appear before the reconciliation GET resolves', async () => {
  const reconciliation = deferred(); let gets = 0;
  const h = harness({ request: request => request.url.includes('thread_id=ta') && ++gets > 1 ? reconciliation.promise : undefined }); await h.mount();
  h.context.incoming = message('m8'); await h.rerender();
  assert.ok(text(h.view.toJSON()).includes('Mensaje simulado m8'), 'event is rendered without waiting for GET');
  await flush(() => reconciliation.resolve({ messages: [message('m2'), message('m3')], has_more: false, next_cursor: null }));
  assert.ok(text(h.view.toJSON()).includes('Mensaje simulado m8'), 'a stale GET does not erase the newer event');
  await h.dispose();
});
