const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');
const { randomUUID } = require('node:crypto');
const { File, Blob } = require('node:buffer');

// All identities and messages are simulated; the request stub never uses a network.
const styles = new Proxy({}, { get: (_, name) => String(name) });
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : (Array.isArray(node) ? node : node?.children || []).map(text).join('');
const flush = async fn => act(async () => { fn?.(); for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const contact = id => ({ id, display_name: `${id} Simulada`, role: 'tarotista', team: null, state: 'online' });
const message = (id, thread = 'ta', extra = {}) => ({ id, thread_id: thread, sender_worker_id: 'a', sender_display_name: 'A Simulada', text: `Mensaje simulado ${id}`, created_at: `2026-10-29T12:${String(Number(id.replace(/\D/g, '')) || 0).padStart(2, '0')}:00Z`, ...extra });

function harness(options = {}) {
  let view, focused = true, visible = 'visible', scrollTop = 0, refreshes = 0;
  const calls = [], requests = [], uploads = [], revoked = [], listeners = new Map(), timers = new Map(), frames = new Map();
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
  const audioNode = { currentTime: 0, duration: 180, paused: true, plays: 0, async play() { this.plays++; this.paused = false; } };
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
    if (url === '/api/chat/media/upload') return { ok: true, attachment_id: '00000000-0000-4000-8000-000000000017', bucket: 'fixture-private', path: 'fixture/file', token: 'fixture-token', already_uploaded: false };
    if (url.startsWith('/api/chat/media/read')) return { ok: true, url: 'https://fixture.invalid/private-media?signature=simulated', expires_in: 60 };
    if (url === '/api/chat/messages') {
      const media = requests.filter(item => item.url === '/api/chat/media/upload').at(-1)?.body;
      return { message: message('m5', request.body.thread_id, { ...request.body, sender_worker_id: 'me', attachment: request.body.attachment_id ? { id: request.body.attachment_id, kind: media?.kind || 'image', mime_type: media?.mime_type || 'image/png', file_name: media?.file_name || 'fixture.png', size_bytes: media?.size_bytes || 4 } : null }) };
    }
    if (url === '/api/chat/threads') return { thread: { id: `t${request.body.contact_worker_id}` } };
    return { ok: true };
  };
  const icons = new Proxy({}, { get: (_, name) => props => React.createElement('i', { ...props, 'data-icon': String(name) }) });
  const modules = new Map();
  function evaluateExports(relative, extra = {}) {
    if (modules.has(relative)) return modules.get(relative);
    const exports = {};
    modules.set(relative, exports);
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(code, {
      exports, require: name => name in extra ? extra[name] : name.endsWith('.module.css') ? { default: styles } : name === 'lucide-react' ? icons : name === '@/hooks/useAttendance' ? { useAttendance: () => attendance } : name === '@/providers/StaffChatProvider' ? { useStaffChat: () => context } : name === '@/lib/staff-chat-client' ? { chatRequest } :
        name === '@/hooks/usePanelSessionAccess' ? evaluateExports('src/hooks/usePanelSessionAccess.ts') :
        name === '@/lib/staff-chat-media' ? evaluateExports('src/lib/staff-chat-media.ts') :
        name === './StaffChatComposer' ? evaluateExports('src/components/chat/StaffChatComposer.tsx') :
        name === './StaffChatAttachment' ? evaluateExports('src/components/chat/StaffChatAttachment.tsx') :
        name === '@/lib/supabase-browser' ? { supabaseBrowser: () => ({ storage: { from: bucket => ({ uploadToSignedUrl: async (...args) => { uploads.push({ bucket, args }); return options.upload ? options.upload(...args) : { error: null }; } }) } }) } : require(name),
      window: windowMock, document: documentMock, IntersectionObserver: class { constructor(callback) { this.callback = callback; } observe() { this.callback([{ isIntersecting: true }]); } disconnect() {} },
      HTMLElement: class {}, crypto: { randomUUID }, AbortController, Date: options.Date || Date, Error, Map, Set, URL: Object.assign(class extends URL {}, { createObjectURL: () => `blob:fixture-${randomUUID()}`, revokeObjectURL: value => revoked.push(value) }), console, File, Blob, setTimeout, clearTimeout,
      navigator: options.navigator || {}, MediaRecorder: options.MediaRecorder,
    });
    return exports;
  }
  const evaluate = (relative, extra) => evaluateExports(relative, extra).default;
  const Panel = evaluate('src/components/chat/StaffDirectChatPanel.tsx');
  const Dock = evaluate('src/components/global/DockChatWidget.tsx', { '@/components/chat/StaffDirectChatPanel': { default: Panel } });
  const Component = options.dock ? Dock : Panel;
  let props = options.dock ? { open: true, onClose() {} } : { compact: !!options.compact };
  return {
    context, attendance, requests, calls, pages, listNode, audioNode, uploads, revoked,
    get view() { return view; }, get refreshes() { return refreshes; },
    async mount() { await flush(() => { view = create(React.createElement(Component, props), { createNodeMock: element => element.props.role === 'log' ? listNode : element.type === 'audio' ? audioNode : { focus() {} } }); }); },
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

test('reselecting the same contact preserves history, draft and the still-active reconciliation request', async () => {
  const h = harness(); await h.mount();
  await flush(() => h.view.root.findByType('textarea').props.onChange({ target: { value: 'Borrador de A' } }));
  const gets = getRequests(h).length;
  await h.clickContact('a');
  assert.ok(text(h.view.toJSON()).includes('Mensaje simulado m3'));
  assert.equal(h.view.root.findByType('textarea').props.value, 'Borrador de A');
  assert.equal(getRequests(h).length, gets);
  h.context.openRequest = { threadId: 'ta', version: 20 }; await h.rerender();
  assert.ok(text(h.view.toJSON()).includes('Mensaje simulado m3'));
  assert.equal(h.view.root.findByType('textarea').props.value, 'Borrador de A');
  await h.dispose();
});

test('switching contacts restores cached paginated history and each draft before the GET resolves', async () => {
  let aGets = 0; const later = deferred();
  const h = harness({ request: req => req.url.includes('thread_id=ta') && ++aGets > 1 ? later.promise : undefined }); await h.mount();
  await flush(() => h.view.root.findByType('textarea').props.onChange({ target: { value: 'A pendiente' } }));
  await h.clickContact('b');
  await flush(() => h.view.root.findByType('textarea').props.onChange({ target: { value: 'B pendiente' } }));
  await h.clickContact('a');
  assert.ok(text(h.view.toJSON()).includes('Mensaje simulado m3'));
  assert.equal(h.view.root.findByType('textarea').props.value, 'A pendiente');
  await flush(() => later.resolve({ messages: [message('m4')], has_more: false, next_cursor: null }));
  assert.ok(text(h.view.toJSON()).includes('Mensaje simulado m1'));
  await h.clickContact('b'); assert.equal(h.view.root.findByType('textarea').props.value, 'B pendiente');
  await h.dispose();
});

test('a failed send finishing on another contact remains available when returning', async () => {
  const delayed = deferred();
  const h = harness({ request: req => req.method === 'POST' && req.url === '/api/chat/messages' ? delayed.promise : undefined }); await h.mount();
  await flush(() => h.view.root.findByType('textarea').props.onChange({ target: { value: 'Pendiente A' } }));
  await flush(() => h.view.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  await h.clickContact('b'); await flush(() => delayed.reject(new Error('Fallo simulado')));
  assert.ok(!text(h.view.toJSON()).includes('Pendiente A'));
  await h.clickContact('a'); assert.ok(text(h.view.toJSON()).includes('Pendiente A')); assert.ok(button(h, 'Reintentar envío'));
  await h.dispose();
});

test('a transient presence error keeps the composer enabled until the confirmed session expires', async () => {
  const h = harness(); await h.mount(); h.attendance.error = 'HTTP 503'; await h.rerender();
  assert.equal(h.view.root.findByType('textarea').props.disabled, false);
  h.attendance.expiresAt = new Date(Date.now() - 1000).toISOString(); await h.rerender();
  assert.equal(h.view.root.findByType('textarea').props.disabled, true);
  await h.dispose();
});

test('image selection previews locally without uploading; cancel revokes the local URL', async () => {
  const h = harness(); await h.mount();
  await flush(() => h.view.root.findByProps({ 'aria-label': 'Archivo de imagen' }).props.onChange({ target: { files: [new File(['fake'], 'fixture.png', { type: 'image/png' })], value: 'file' } }));
  assert.equal(h.uploads.length, 0); assert.equal(h.requests.filter(req => req.url.includes('/media/')).length, 0);
  assert.ok(h.view.root.findAllByType('img').some(img => img.props.src.startsWith('blob:')));
  await flush(() => button(h, 'Quitar adjunto').props.onClick());
  assert.equal(h.revoked.length, 1); assert.equal(button(h, 'Enviar mensaje').props.disabled, true);
  await h.dispose();
});

test('an image-only send uploads first and retries both stable IDs after an unknown outcome', async () => {
  let sends = 0;
  const h = harness({ request: req => {
    if (req.url === '/api/chat/media/upload' && sends) return { ok: true, attachment_id: '00000000-0000-4000-8000-000000000017', already_uploaded: true };
    if (req.url === '/api/chat/messages' && req.method === 'POST' && ++sends === 1) throw new Error('Respuesta perdida');
  } }); await h.mount();
  await flush(() => h.view.root.findByProps({ 'aria-label': 'Archivo de imagen' }).props.onChange({ target: { files: [new File(['fake'], 'fixture.png', { type: 'image/png' })], value: 'file' } }));
  await flush(() => h.view.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.ok(button(h, 'Reintentar envío')); await flush(() => button(h, 'Reintentar envío').props.onClick());
  const init = h.requests.filter(req => req.url === '/api/chat/media/upload'), posts = h.requests.filter(req => req.url === '/api/chat/messages' && req.method === 'POST');
  assert.equal(init[0].body.client_upload_id, init[1].body.client_upload_id);
  assert.equal(posts[0].body.client_message_id, posts[1].body.client_message_id);
  assert.equal(posts[0].body.attachment_id, posts[1].body.attachment_id);
  assert.equal(posts[0].body.expected_worker_id, 'me'); assert.equal(init[0].body.expected_worker_id, 'me');
  assert.equal(posts[0].body.text, ''); assert.equal(h.uploads.length, 1);
  assert.equal(h.uploads[0].args[3].upsert, false); assert.ok(h.requests.some(req => req.url.includes('/api/chat/media/read')));
  await h.dispose();
});

test('attachment drafts follow their contact and are cleared on an account change', async () => {
  const h = harness(); await h.mount();
  await flush(() => h.view.root.findByProps({ 'aria-label': 'Archivo de audio' }).props.onChange({ target: { files: [new File(['fake'], 'fixture.webm', { type: 'audio/webm;codecs=opus' })], value: 'file' } }));
  await h.clickContact('b'); assert.equal(button(h, 'Quitar adjunto'), undefined);
  await h.clickContact('a'); assert.ok(button(h, 'Quitar adjunto'));
  h.context.me = { id: 'new-account', role: 'central', display_name: 'Otra' }; await h.rerender();
  assert.equal(button(h, 'Quitar adjunto'), undefined); assert.equal(h.revoked.length, 1);
  await h.dispose();
});

test('unsupported or oversized files never upload or create a pending message', async () => {
  const h = harness(); await h.mount();
  await flush(() => h.view.root.findByProps({ 'aria-label': 'Archivo de imagen' }).props.onChange({ target: { files: [new File(['svg'], 'unsafe.svg', { type: 'image/svg+xml' })], value: 'file' } }));
  assert.ok(text(h.view.toJSON()).includes('Selecciona una imagen JPG'));
  await flush(() => h.view.root.findByProps({ 'aria-label': 'Archivo de audio' }).props.onChange({ target: { files: [{ name: 'too-big.mp3', type: 'audio/mpeg', size: 16 * 1024 * 1024 }], value: 'file' } }));
  assert.ok(text(h.view.toJSON()).includes('15 MB'));
  assert.equal(h.uploads.length, 0); assert.equal(button(h, 'Quitar adjunto'), undefined);
  await h.dispose();
});

test('the bounded message viewport and composer cannot shrink each other out of the conversation', () => {
  const css = fs.readFileSync(path.join(__dirname, '../src/components/chat/StaffDirectChatPanel.module.css'), 'utf8');
  assert.match(css, /\.workspace,\.contacts,\.conversation,\.contactList,\.messages\{min-height:0/);
  assert.match(css, /\.chatHeader,\.composer\{flex-shrink:0/);
  assert.match(css, /\.messages\{flex:1 1 0/);
});

function microphoneFixture() {
  const streams = [], recorders = [];
  const newStream = () => { const track = { stopped: 0, stop() { this.stopped++; } }; const stream = { track, getTracks: () => [track] }; streams.push(stream); return stream; };
  class Recorder {
    static isTypeSupported(type) { return type.startsWith('audio/webm'); }
    constructor(stream, options) { this.stream = stream; this.mimeType = options?.mimeType || 'audio/webm'; this.state = 'inactive'; recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
    finish() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['simulated voice'], { type: this.mimeType }) }); this.onstop?.(); }
  }
  return { streams, recorders, newStream, Recorder, navigator: { mediaDevices: { getUserMedia: async () => newStream() } } };
}

test('microphone recording starts only on request, previews before send and produces an audio attachment', async () => {
  const mic = microphoneFixture(); const h = harness({ navigator: mic.navigator, MediaRecorder: mic.Recorder }); await h.mount();
  assert.equal(mic.streams.length, 0);
  await flush(() => button(h, 'Grabar nota de voz').props.onClick());
  assert.equal(mic.streams.length, 1); assert.equal(mic.recorders[0].state, 'recording');
  await flush(() => button(h, 'Detener y revisar nota de voz').props.onClick());
  await flush(() => mic.recorders[0].finish());
  assert.ok(mic.streams[0].track.stopped > 0);
  assert.ok(h.view.root.findAllByType('audio').some(audio => audio.props['aria-label'] === 'Vista previa de la nota de voz'));
  assert.equal(h.uploads.length, 0);
  await flush(() => h.view.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  const init = h.requests.find(req => req.url === '/api/chat/media/upload');
  assert.equal(init.body.kind, 'audio'); assert.equal(init.body.mime_type, 'audio/webm');
  assert.equal(h.requests.find(req => req.url === '/api/chat/messages' && req.method === 'POST').body.text, '');
  await h.dispose();
});

test('a delayed stop from a cancelled recording never stops a newly started microphone', async () => {
  const mic = microphoneFixture(); const h = harness({ navigator: mic.navigator, MediaRecorder: mic.Recorder }); await h.mount();
  await flush(() => button(h, 'Grabar nota de voz').props.onClick());
  await flush(() => button(h, 'Cancelar grabación').props.onClick());
  await flush(() => button(h, 'Grabar nota de voz').props.onClick());
  assert.equal(mic.streams.length, 2);
  await flush(() => mic.recorders[0].finish());
  await flush(() => mic.recorders[0].onerror?.());
  assert.equal(mic.streams[1].track.stopped, 0);
  assert.equal(mic.recorders[1].state, 'recording');
  assert.ok(button(h, 'Detener y revisar nota de voz'));
  assert.equal(button(h, 'Quitar adjunto'), undefined);
  await h.dispose(); assert.ok(mic.streams[1].track.stopped > 0);
});

test('microphone permission resolving after a contact switch closes its own stream without adding a draft', async () => {
  const mic = microphoneFixture(), permission = deferred();
  const h = harness({ navigator: { mediaDevices: { getUserMedia: () => permission.promise } }, MediaRecorder: mic.Recorder }); await h.mount();
  await flush(() => button(h, 'Grabar nota de voz').props.onClick());
  await h.clickContact('b'); const stream = mic.newStream();
  await flush(() => permission.resolve(stream));
  assert.ok(stream.track.stopped > 0); assert.equal(mic.recorders.length, 0);
  assert.equal(button(h, 'Quitar adjunto'), undefined); assert.equal(h.uploads.length, 0);
  await h.dispose();
});

test('a rejected microphone permission leaves file upload available and sends nothing', async () => {
  const mic = microphoneFixture();
  const h = harness({ navigator: { mediaDevices: { getUserMedia: async () => { throw new Error('Denied fixture'); } } }, MediaRecorder: mic.Recorder }); await h.mount();
  await flush(() => button(h, 'Grabar nota de voz').props.onClick());
  assert.ok(text(h.view.toJSON()).includes('Revisa el permiso o usa Subir audio'));
  assert.equal(button(h, 'Subir audio').props.disabled, false); assert.equal(h.uploads.length, 0);
  await h.dispose();
});

test('an account switch during attachment initialization prevents uploading or sending with the new account', async () => {
  const init = deferred();
  const h = harness({ request: req => req.url === '/api/chat/media/upload' ? init.promise : undefined }); await h.mount();
  await flush(() => h.view.root.findByProps({ 'aria-label': 'Archivo de imagen' }).props.onChange({ target: { files: [new File(['fake'], 'fixture.png', { type: 'image/png' })], value: 'file' } }));
  await flush(() => h.view.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  h.context.me = { id: 'other-account', role: 'central', display_name: 'Otro' }; await h.rerender();
  await flush(() => init.resolve({ ok: true, attachment_id: 'fixture-private-id', bucket: 'fixture-private', path: 'fixture/path', token: 'fixture-only' }));
  assert.equal(h.uploads.length, 0);
  assert.equal(h.requests.filter(req => req.url === '/api/chat/messages' && req.method === 'POST').length, 0);
  await h.dispose();
});

test('renewing an expired private audio URL preserves playback position and a pause made during renewal', async () => {
  let now = Date.now(), reads = 0; const renewal = deferred();
  class FixtureDate extends Date { static now() { return now; } }
  const audioMessage = message('m1', 'ta', { text: '🎤 Nota de voz', attachment: { id: 'private-audio', kind: 'audio', mime_type: 'audio/webm', file_name: 'nota.webm', size_bytes: 25 } });
  const h = harness({ Date: FixtureDate, pages: { ta: [audioMessage] }, request: req => req.url.includes('/api/chat/media/read') && ++reads > 1 ? renewal.promise : undefined }); await h.mount();
  h.audioNode.currentTime = 42; h.audioNode.paused = false; now += 56000;
  await flush(() => h.view.root.findByType('audio').props.onPlay());
  h.audioNode.currentTime = 44; h.audioNode.paused = true;
  await flush(() => h.view.root.findByType('audio').props.onPause());
  await flush(() => renewal.resolve({ ok: true, url: 'https://fixture.invalid/renewed-audio', expires_in: 60 }));
  h.audioNode.currentTime = 0;
  await flush(() => h.view.root.findByType('audio').props.onLoadedMetadata());
  assert.equal(h.audioNode.currentTime, 44); assert.equal(h.audioNode.plays, 0);
  assert.equal(h.view.root.findAllByType('p').some(p => text(p) === '🎤 Nota de voz'), false);
  await h.dispose();
});

test('a media error while audio is paused refreshes the private URL without autoplay', async () => {
  const audioMessage = message('m1', 'ta', { text: '', attachment: { id: 'private-audio', kind: 'audio', mime_type: 'audio/webm', file_name: 'nota.webm', size_bytes: 25 } });
  let reads = 0;
  const h = harness({ pages: { ta: [audioMessage] }, request: req => req.url.includes('/api/chat/media/read') ? { ok: true, url: `https://fixture.invalid/audio-${++reads}`, expires_in: 60 } : undefined }); await h.mount();
  h.audioNode.currentTime = 58; h.audioNode.paused = true;
  await flush(() => h.view.root.findByType('audio').props.onPause());
  await flush(() => h.view.root.findByType('audio').props.onError());
  h.audioNode.currentTime = 0;
  await flush(() => h.view.root.findByType('audio').props.onLoadedMetadata());
  assert.equal(h.audioNode.currentTime, 58); assert.equal(h.audioNode.plays, 0); assert.equal(reads, 2);
  await h.dispose();
});

test('admin opens the newest thread for a tarotista and isolates each central draft and attachment', async () => {
  const threads = [
    { id: 'tmaria', contact: contact('a'), central_worker_id: 'maria', central_display_name: 'María', unread_count: 1, last_message_at: '2026-10-30T12:00:00Z' },
    { id: 'tmichael', contact: contact('a'), central_worker_id: 'michael', central_display_name: 'Michael', unread_count: 0, last_message_at: '2026-10-29T12:00:00Z' },
  ];
  const h = harness({ context: { mode: 'admin', me: { id: 'me', role: 'admin', display_name: 'Admin simulado' }, threads }, pages: { tmaria: [message('m1', 'tmaria')], tmichael: [message('m2', 'tmichael')] } }); await h.mount();
  const chooser = () => h.view.root.findByProps({ 'aria-label': 'Conversación con central' });
  assert.equal(chooser().props.value, 'tmaria');
  assert.ok(text(chooser()).includes('Conversación con María'));
  await flush(() => h.view.root.findByType('textarea').props.onChange({ target: { value: 'Solo para María' } }));
  await flush(() => h.view.root.findByProps({ 'aria-label': 'Archivo de imagen' }).props.onChange({ target: { files: [new File(['fake'], 'maria.png', { type: 'image/png' })], value: 'file' } }));
  await flush(() => chooser().props.onChange({ target: { value: 'tmichael' } }));
  assert.equal(h.view.root.findByType('textarea').props.value, ''); assert.equal(button(h, 'Quitar adjunto'), undefined);
  await flush(() => h.view.root.findByType('textarea').props.onChange({ target: { value: 'Solo para Michael' } }));
  await flush(() => chooser().props.onChange({ target: { value: 'tmaria' } }));
  assert.equal(h.view.root.findByType('textarea').props.value, 'Solo para María'); assert.ok(button(h, 'Quitar adjunto'));
  h.context.threads = [...threads].reverse(); await h.rerender(); await h.clickContact('a');
  assert.equal(chooser().props.value, 'tmaria');
  await flush(() => h.view.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  const sent = h.requests.find(req => req.url === '/api/chat/messages' && req.method === 'POST');
  assert.equal(sent.body.thread_id, 'tmaria'); assert.equal(sent.body.text, 'Solo para María');
  await h.dispose();
});

test('Yesterday uses the Madrid calendar across its DST change even for a browser in Ecuador', async () => {
  const oldTZ = process.env.TZ; process.env.TZ = 'America/Guayaquil';
  const now = Date.parse('2026-03-29T22:30:00Z');
  class FixtureDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const h = harness({ Date: FixtureDate, pages: { ta: [message('m1', 'ta', { created_at: '2026-03-29T12:00:00Z' })] } });
  try { await h.mount(); assert.ok(h.view.root.findAll(node => node.props.className === 'day').some(node => text(node) === 'Ayer')); }
  finally { await h.dispose(); if (oldTZ == null) delete process.env.TZ; else process.env.TZ = oldTZ; }
});
