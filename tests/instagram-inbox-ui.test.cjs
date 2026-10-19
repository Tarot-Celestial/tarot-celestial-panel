const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');

function evaluate(file, imports = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: name => name in imports ? imports[name] : require(name), Date, Intl, URL, URLSearchParams, AbortController, console, ...globals });
  return exports;
}
const shared = evaluate('src/lib/instagram-inbox.ts');
const content = node => typeof node === 'string' ? node : node.children?.map(content).join('') || '';
const thread = (id, kind = 'message') => ({ id, kind, name: `Persona ${id}`, username: `persona_${id}`, preview: 'Hola, ¿cómo puedo consultar?', updatedAt: '2026-10-19T17:00:00Z' });

function fixture(options = {}) {
  const requests = [], timers = new Map(), listeners = new Map();
  let tree, sequence = 0, requestSequence = 0, failSend = null, failDetail = null, failInbox = null, detailBlocked = null, pendingSend = null, requestStatus = null;
  let connection = { connected: true, ready: true, username: 'tarotcelestialof' };
  let canReply = options.canReply ?? true, canPrivateReply = options.canPrivateReply ?? true;
  let session = { access_token: 'test-token', user: { id: 'worker-one' } }, authCallback, inboxResponse = options.inboxResponse, inboxBlocked = null;
  const document = { hidden: false, addEventListener(name, fn) { listeners.set(fn, name); }, removeEventListener(name, fn) { listeners.delete(fn); } };
  const Component = evaluate('src/features/central/CentralInstagramPanel.tsx', {
    '@/lib/instagram-inbox': shared,
    '@/lib/supabase-browser': { supabaseBrowser: () => ({ auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange(callback) { authCallback = callback; return { data: { subscription: { unsubscribe() { authCallback = null; } } } }; },
    } }) },
    './CentralInstagramPanel.module.css': { default: new Proxy({}, { get: (_, name) => String(name) }) },
    'lucide-react': new Proxy({}, { get: (_, name) => props => React.createElement('span', { ...props, 'data-icon': name }) }),
  }, {
    document,
    window: { setInterval(fn, delay) { timers.set(++sequence, { fn, delay }); return sequence; }, clearInterval(id) { timers.delete(id); } },
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++requestSequence).padStart(12, '0')}` },
    fetch: async (url, init) => {
      const params = new URL(url, 'https://test.local').searchParams;
      requests.push({ action: params.get('action'), params, ...init });
      if (params.get('action') === 'resolve') { pendingSend = null; return { ok: true, json: async () => ({ ok: true }) }; }
      if (params.get('action') === 'send') return { ok: !failSend, json: async () => failSend ? { ok: false, code: failSend, error: 'Explicación en español del servidor.' } : { ok: true } };
      if (params.get('action') === 'inbox') {
        if (failInbox) return { ok: false, json: async () => ({ ok: false, code: failInbox, error: 'La consulta falló.' }) };
        const kind = params.get('kind');
        const payload = inboxResponse ? inboxResponse(kind, params.get('cursor')) : { threads: [thread(params.get('cursor') ? 'older' : 'one', kind), ...(params.get('cursor') ? [] : [thread('two', kind)])], nextCursor: params.get('cursor') ? null : 'more' };
        if (inboxBlocked) await inboxBlocked;
        return { ok: true, json: async () => ({ ok: true, connection, ...payload }) };
      }
      const id = params.get('threadId');
      if (failDetail) return { ok: false, json: async () => ({ ok: false, code: failDetail, error: 'La consulta falló.' }) };
      if (detailBlocked?.id === id) await detailBlocked.promise;
      return { ok: true, json: async () => ({ ok: true, messages: [{ id: `${id}-message`, text: `Mensaje de ${id}`, fromMe: false, createdAt: '2026-10-19T17:00:00Z' }], canReply: canReply && !pendingSend, canPrivateReply: canPrivateReply && !pendingSend, privateReplySent: false, lastReplyAt: null, pendingSend, requestStatus: params.has('requestId') ? requestStatus : null }) };
    },
  }).default;
  const act = async fn => renderer.act(async () => { fn(); await new Promise(resolve => setImmediate(resolve)); });
  const button = label => tree.root.findAllByType('button').find(node => content(node).includes(label));
  return {
    requests, timers, listeners, document, button,
    get tree() { return tree; }, get sends() { return requests.filter(item => item.action === 'send'); },
    async mount() { await act(() => { tree = renderer.create(React.createElement(Component)); }); },
    async click(label) { const target = button(label); assert.ok(target, label); assert.equal(Boolean(target.props.disabled), false, label); await act(() => target.props.onClick()); },
    async write(text) { await act(() => tree.root.findByType('textarea').props.onChange({ target: { value: text } })); },
    async checkPending() { await act(() => tree.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } })); },
    async search(text) { await act(() => tree.root.findAllByType('input').find(input => input.props.placeholder === 'Buscar en la bandeja…').props.onChange({ target: { value: text } })); },
    async send() { await act(() => { void tree.root.findByType('form').props.onSubmit({ preventDefault() {} }); }); },
    async tick() { await act(() => { for (const timer of [...timers.values()]) timer.fn(); }); },
    async settle() { await act(() => {}); },
    failSend(code) { failSend = code; }, blockDetail(id, promise) { detailBlocked = { id, promise }; },
    failDetail(code) { failDetail = code; }, failInbox(code) { failInbox = code; },
    setPending(value) { pendingSend = value; }, setRequestStatus(value) { requestStatus = value; },
    setConnection(value) { connection = value; }, setCanReply(value) { canReply = value; },
    setInboxResponse(value) { inboxResponse = value; }, blockInbox(value) { inboxBlocked = value; },
    async signOut() { await act(() => { session = null; authCallback('SIGNED_OUT', null); }); },
    async signIn(id) { await act(() => { session = { access_token: `token-${id}`, user: { id } }; authCallback('SIGNED_IN', session); }); },
    async unmount() { await act(() => tree.unmount()); },
  };
}

test('templates prepare an editable draft and only an explicit send posts it to the selected conversation', async () => {
  const f = fixture(); await f.mount();
  try {
    await f.click('Persona one'); await f.click('1 · Panel y Oráculo');
    assert.equal(f.sends.length, 0);
    assert.match(f.tree.root.findByType('textarea').props.value, /cliente\/oraculo\?source=instagram/);
    await f.send();
    const body = JSON.parse(f.sends[0].body);
    assert.equal(body.threadId, 'one'); assert.equal(body.replyMode, 'private'); assert.equal(body.expectedLastReplyAt, null);
    assert.match(body.requestId, /^[a-f0-9-]{36}$/); assert.equal(f.tree.root.findByType('textarea').props.value, '');
  } finally { await f.unmount(); }
});

test('comment responses distinguish public replies from private template invitations', async () => {
  const f = fixture(); await f.mount();
  try {
    await f.click('Comentarios'); await f.click('Persona one');
    assert.ok(f.button('Publicar respuesta')); await f.write('¿Desde qué país nos escribes?'); await f.send();
    assert.equal(JSON.parse(f.sends[0].body).replyMode, 'public');
    await f.click('2 · Primera consulta gratis');
    assert.equal(f.sends.length, 1);
    assert.ok(f.button('Enviar mensaje privado')); await f.send();
    const body = JSON.parse(f.sends[1].body);
    assert.equal(body.replyMode, 'private'); assert.match(body.text, /primera consulta es gratis/);
    for (const line of shared.ACTIVE_CONSULTATION_LINES) assert.ok(body.text.includes(line.display));
    assert.ok(body.text.includes('/cliente/dashboard?source=instagram'));
  } finally { await f.unmount(); }
});

test('closed reply windows disable send and private templates, while public comment replies remain available', async () => {
  const f = fixture({ canReply: false, canPrivateReply: false }); await f.mount();
  try {
    await f.click('Persona one');
    assert.equal(f.button('1 · Panel y Oráculo').props.disabled, true);
    assert.equal(f.tree.root.findByType('textarea').props.disabled, true);
    await f.send(); assert.equal(f.sends.length, 0);
    f.setCanReply(true); await f.click('Comentarios'); await f.click('Persona one');
    assert.equal(f.button('Mensaje privado').props.disabled, true);
    await f.write('Gracias por escribirnos'); await f.send();
    assert.equal(JSON.parse(f.sends[0].body).replyMode, 'public');
  } finally { await f.unmount(); }
});

test('uncertain delivery preserves the draft and prevents another send, including after changing conversations', async () => {
  const f = fixture(); await f.mount();
  try {
    await f.click('Persona one'); await f.write('Una sola respuesta'); f.failSend('SEND_UNCERTAIN'); await f.send();
    assert.equal(f.sends.length, 1); assert.equal(f.tree.root.findByType('textarea').props.value, 'Una sola respuesta');
    assert.equal(f.button('Enviar mensaje privado').props.disabled, true);
    await f.send(); assert.equal(f.sends.length, 1);
    await f.click('Persona two'); await f.click('Persona one');
    assert.equal(f.button('Enviar mensaje privado').props.disabled, true);
  } finally { await f.unmount(); }
});

test('concurrent-reply rejection refreshes history and a reviewed new send uses a new operation ID', async () => {
  const f = fixture(); await f.mount();
  try {
    await f.click('Persona one'); await f.write('Respuesta revisada'); f.failSend('STALE_REPLY'); await f.send();
    assert.ok(content(f.tree.root).includes('Otra central ya respondió'));
    f.failSend(null); await f.send();
    assert.notEqual(JSON.parse(f.sends[0].body).requestId, JSON.parse(f.sends[1].body).requestId);
  } finally { await f.unmount(); }
});

test('late conversation responses do not replace the active customer history', async () => {
  const f = fixture(); await f.mount(); let release;
  try {
    f.blockDetail('one', new Promise(resolve => { release = resolve; }));
    await f.click('Persona one'); await f.click('Persona two'); release(); await f.settle();
    const history = f.tree.root.findByProps({ 'aria-label': 'Mensajes de la conversación' });
    assert.ok(content(history).includes('Mensaje de two')); assert.equal(content(history).includes('Mensaje de one'), false);
  } finally { release?.(); await f.unmount(); }
});

test('reselecting the active conversation refreshes it without losing the draft or reply permissions', async () => {
  const f = fixture(); await f.mount();
  try {
    await f.click('Persona one'); await f.write('Borrador sin enviar'); await f.click('Persona one');
    assert.equal(f.tree.root.findByType('textarea').props.value, 'Borrador sin enviar');
    assert.equal(f.tree.root.findByType('textarea').props.disabled, false);
    assert.ok(content(f.tree.root).includes('Mensaje de one'));
  } finally { await f.unmount(); }
});

test('pagination adds earlier entries and visible-only polling is cleaned up on unmount', async () => {
  const f = fixture(); await f.mount();
  await f.click('Cargar anteriores'); assert.ok(f.button('Persona older')); assert.ok(f.button('Persona one'));
  await f.click('Persona one');
  assert.deepEqual([...f.timers.values()].map(timer => timer.delay).sort(), [30000, 60000]);
  f.document.hidden = true; const before = f.requests.length; await f.tick(); assert.equal(f.requests.length, before);
  f.document.hidden = false; await f.tick(); assert.equal(f.requests.length, before + 2);
  await f.unmount(); assert.equal(f.timers.size, 0); assert.equal(f.listeners.size, 0);
});

test('failed detail refresh disables both public and private replies and connection errors never display a ready badge', async () => {
  const f = fixture(); await f.mount();
  try {
    await f.click('Comentarios'); await f.click('Persona one');
    assert.equal(f.button('1 · Panel y Oráculo').props.disabled, false);
    f.failDetail('META_PERMISSION'); f.failInbox('META_PERMISSION'); await f.tick();
    assert.equal(f.button('1 · Panel y Oráculo').props.disabled, true);
    assert.equal(f.tree.root.findByType('textarea').props.disabled, true);
    assert.ok(content(f.tree.root).includes('Conexión por revisar'));
    assert.equal(content(f.tree.root).includes('Cuenta disponible'), false);
  } finally { await f.unmount(); }
});

test('a confirmed rejection allows a reviewed retry with the same text and a fresh operation ID', async () => {
  const f = fixture(); await f.mount();
  try {
    await f.click('Persona one'); await f.write('Mi respuesta'); f.failSend('META_RATE_LIMIT'); await f.send();
    f.failSend(null); await f.send();
    assert.equal(f.sends.length, 2);
    assert.notEqual(JSON.parse(f.sends[0].body).requestId, JSON.parse(f.sends[1].body).requestId);
    assert.equal(JSON.parse(f.sends[0].body).text, JSON.parse(f.sends[1].body).text);
  } finally { await f.unmount(); }
});

test('a persisted receipt recovers a lost successful response without sending twice', async () => {
  const f = fixture(); await f.mount();
  try {
    await f.click('Persona one'); await f.write('Mi respuesta'); f.failSend('SEND_UNCERTAIN'); f.setRequestStatus('sent'); await f.send();
    assert.equal(f.sends.length, 1); assert.equal(f.tree.root.findByType('textarea').props.value, '');
    assert.ok(content(f.tree.root).includes('Envío comprobado'));
    assert.ok(f.requests.some(request => request.action === 'messages' && request.params.get('requestId') === JSON.parse(f.sends[0].body).requestId));
  } finally { await f.unmount(); }
});

test('uncertain sends require explicit review and outcome confirmation; resolution never sends a message', async () => {
  const f = fixture(); await f.mount();
  try {
    f.setPending({ requestId: '00000000-0000-4000-8000-000000000001', status: 'uncertain', createdAt: new Date(Date.now() - 120_000).toISOString(), text: 'Mensaje que se debe comprobar' });
    await f.click('Persona one');
    assert.equal(f.button('Sí, se envió').props.disabled, true); assert.equal(f.button('No se envió').props.disabled, true);
    await f.checkPending(); await f.click('No se envió');
    assert.equal(f.sends.length, 0);
    const request = f.requests.find(request => request.action === 'resolve');
    assert.deepEqual(JSON.parse(request.body), { threadId: 'one', requestId: '00000000-0000-4000-8000-000000000001', outcome: 'not_sent', confirmed: true });
    assert.equal(f.tree.root.findByType('textarea').props.disabled, false);
  } finally { await f.unmount(); }
});

test('an empty comment page with a cursor reports remaining publications and can load emoji-only comments', async () => {
  const f = fixture({ inboxResponse: (kind, cursor) => ({ threads: cursor ? [{ ...thread('rvcricky', kind), username: 'rvcricky', preview: '❤️❤️' }] : [], nextCursor: cursor ? null : 'older-posts' }) });
  await f.mount();
  try {
    await f.click('Comentarios');
    assert.equal(content(f.tree.root).includes('Sin comentarios disponibles'), false);
    assert.ok(content(f.tree.root).includes('Quedan publicaciones por consultar'));
    await f.click('Cargar anteriores');
    assert.ok(f.button('Persona rvcricky')); assert.ok(content(f.tree.root).includes('❤️❤️'));
  } finally { await f.unmount(); }
});

test('refresh preserves loaded older pages, updates matching entries without duplicates and keeps the pagination cursor', async () => {
  const f = fixture({ inboxResponse: (kind, cursor) => ({ threads: [thread(cursor || 'newest', kind)], nextCursor: cursor === 'page-two' ? 'page-three' : cursor === 'page-three' ? null : 'page-two' }) });
  await f.mount();
  try {
    await f.click('Comentarios'); await f.click('Cargar anteriores');
    f.setInboxResponse((kind, cursor) => ({ threads: [{ ...thread(cursor || 'newest', kind), preview: cursor ? 'Anterior' : 'Comentario actualizado' }], nextCursor: cursor === 'page-three' ? null : 'page-two' }));
    await f.tick(); await f.click('Actualizar');
    assert.ok(f.button('Persona page-two')); assert.ok(content(f.tree.root).includes('Comentario actualizado'));
    assert.equal(f.tree.root.findAllByType('button').filter(button => content(button).includes('Persona newest')).length, 1);
    await f.click('Cargar anteriores');
    assert.equal(f.requests.filter(request => request.action === 'inbox').at(-1).params.get('cursor'), 'page-three');
    assert.ok(f.button('Persona page-three')); assert.ok(f.button('Persona page-two'));
    await f.tick(); assert.equal(Boolean(f.button('Cargar anteriores')), false);
  } finally { await f.unmount(); }
});

test('username searches accept @, surrounding whitespace and case differences', async () => {
  const f = fixture({ inboxResponse: kind => ({ threads: [{ ...thread('rvcricky', kind), username: 'rvcricky', preview: '❤️❤️' }], nextCursor: null }) });
  await f.mount();
  try {
    await f.click('Comentarios'); await f.search('  @RVCRICKY  ');
    assert.ok(f.button('Persona rvcricky'));
    await f.search('❤️'); assert.ok(f.button('Persona rvcricky'));
  } finally { await f.unmount(); }
});

test('changing inbox kinds resets loaded entries and cursor instead of mixing messages with comments', async () => {
  const f = fixture({ inboxResponse: (kind, cursor) => ({ threads: [thread(`${kind}-${cursor || 'first'}`, kind)], nextCursor: cursor ? null : `${kind}-next` }) });
  await f.mount();
  try {
    await f.click('Cargar anteriores'); assert.ok(f.button('Persona message-message-next'));
    await f.click('Comentarios');
    assert.equal(Boolean(f.button('Persona message-')), false); assert.ok(f.button('Persona comment-first'));
    await f.click('Cargar anteriores');
    assert.equal(f.requests.filter(request => request.action === 'inbox').at(-1).params.get('cursor'), 'comment-next');
  } finally { await f.unmount(); }
});

test('logout clears loaded history and ignores late requests, then a new session starts with a fresh inbox', async () => {
  const f = fixture(); await f.mount(); let release;
  try {
    await f.click('Cargar anteriores'); await f.click('Persona one'); await f.write('Borrador anterior');
    f.blockInbox(new Promise(resolve => { release = resolve; })); await f.tick();
    await f.signOut(); release(); await f.settle();
    assert.equal(Boolean(f.button('Persona one')), false); assert.equal(Boolean(f.button('Persona older')), false);
    assert.equal(f.tree.root.findAllByType('textarea').length, 0);
    f.blockInbox(null); f.setInboxResponse(kind => ({ threads: [thread('new-session', kind)], nextCursor: null })); await f.signIn('worker-two');
    assert.ok(f.button('Persona new-session')); assert.equal(Boolean(f.button('Persona older')), false);
    await f.click('Persona new-session'); assert.equal(f.tree.root.findByType('textarea').props.value, '');
  } finally { release?.(); await f.unmount(); }
});
