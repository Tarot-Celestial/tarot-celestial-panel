const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');
const { act } = renderer;
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/central/CentralWhatsAppPanel.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const content = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(content).join('') : node ? content(node.children) : '';
const connected = { ok: true, state: 'connected', rev: '1', me: { id: 'owner', name: 'Tarot Celestial', phone: '17875550188' } };
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function fixture(options = {}) {
  const exports = {}, requests = [], timers = new Map(), deadlines = new Map(), windowEvents = new Map(), documentEvents = new Map();
  let timer = 0;
  const window = {
    setInterval(fn) { timers.set(++timer, fn); return timer; }, clearInterval(id) { timers.delete(id); },
    setTimeout(fn) { deadlines.set(++timer, fn); return timer; }, clearTimeout(id) { deadlines.delete(id); },
    addEventListener(name, fn) { windowEvents.set(name, fn); }, removeEventListener(name) { windowEvents.delete(name); },
    confirm: () => options.confirm === true,
  };
  const document = { visibilityState: 'visible', addEventListener(name, fn) { documentEvents.set(name, fn); }, removeEventListener(name) { documentEvents.delete(name); } };
  const auth = { getSession: options.getSession || (async () => ({ data: { session: { access_token: 'test-only' } } })) };
  vm.runInNewContext(code, {
    exports, window, document, AbortController, Date, encodeURIComponent,
    fetch(url, init) {
      const action = new URL(url, 'https://fixture.invalid').searchParams.get('action'); requests.push({ action, init });
      return options.api ? options.api(action, init) : Promise.resolve(response(action === 'status' ? connected : { ok: true, chats: [] }));
    },
    require(name) {
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime') return require(name);
      if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => String(key) });
      if (name === '@/lib/supabase-browser') return { supabaseBrowser: () => ({ auth }) };
      if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
      throw new Error(name);
    },
  });
  let tree; act(() => { tree = renderer.create(React.createElement(exports.default)); });
  return {
    tree, requests, timers, deadlines, windowEvents, documentEvents,
    text: () => content(tree.toJSON()),
    async settle() { await act(async () => { await new Promise(resolve => setImmediate(resolve)); }); },
    async poll() { await act(async () => { for (const fn of timers.values()) fn(); await new Promise(resolve => setImmediate(resolve)); }); },
    async event(name) { await act(async () => { windowEvents.get(name)?.(); await new Promise(resolve => setImmediate(resolve)); }); },
    async timeout() { await act(async () => { for (const fn of [...deadlines.values()]) fn(); await new Promise(resolve => setImmediate(resolve)); }); },
    async click(label) { const button = tree.root.findAllByType('button').find(node => content(node).trim() === label); assert.ok(button, label); await act(async () => button.props.onClick()); },
    close() { act(() => tree.unmount()); },
  };
}

test('a failed status read removes stale connected status, and focus recovers without logging out', async () => {
  let available = true;
  const f = fixture({ api: async action => action === 'status' ? response(available ? connected : { ok: false, error: 'GATEWAY_UNREACHABLE' }, available ? 200 : 503) : response({ ok: true, chats: [] }) });
  try {
    await f.settle(); assert.match(f.text(), /Conectado como Tarot Celestial.*\+17875550188/);
    available = false; await f.poll();
    assert.match(f.text(), /Sin confirmar/); assert.doesNotMatch(f.text(), /Conectado como/);
    assert.match(f.text(), /Mantén encendido y con internet/);
    available = true; await f.event('focus'); assert.match(f.text(), /Conectado como/);
    assert.equal(f.requests.some(item => item.action === 'logout'), false);
  } finally { f.close(); }
  assert.equal(f.timers.size, 0); assert.equal(f.windowEvents.size, 0); assert.equal(f.documentEvents.size, 0);
  assert.equal(f.requests.some(item => item.action === 'logout'), false);
});

test('an idle session starts QR once, scans into connected and keeps the session on leaving', async () => {
  let status = { ok: true, state: 'idle', reason: null };
  const f = fixture({ api: async action => {
    if (action === 'start') { status = { ok: true, state: 'qr', qr: 'data:image/png;base64,fixture' }; return response(status); }
    return response(action === 'status' ? status : { ok: true, chats: [] });
  } });
  try {
    await f.settle(); assert.equal(f.requests.filter(item => item.action === 'start').length, 1);
    assert.equal(f.tree.root.findByType('img').props.alt, 'Código QR para vincular WhatsApp');
    await f.poll(); assert.equal(f.requests.filter(item => item.action === 'start').length, 1);
    status = connected; await f.poll(); assert.match(f.text(), /Conectado como/);
    await f.click('Cerrar sesión'); assert.equal(f.requests.some(item => item.action === 'logout'), false, 'cancelling explicit confirmation preserves session');
  } finally { f.close(); }
  assert.equal(f.requests.some(item => item.action === 'logout'), false);
});

test('missing authentication never starts or reads WhatsApp through a fallback', async () => {
  const f = fixture({ getSession: async () => ({ data: { session: null } }) }); try {
    await f.settle(); assert.match(f.text(), /Tu sesión ha caducado/);
    assert.equal(f.requests.length, 0);
    await f.click('Mostrar QR'); assert.equal(f.requests.length, 0);
  } finally { f.close(); }
});

test('a failed chat refresh retries the same revision without falsely disconnecting the verified session', async () => {
  let attempts = 0;
  const f = fixture({ api: async action => {
    if (action === 'status') return response(connected);
    attempts += 1; return attempts === 1 ? response({ ok: false, error: 'GATEWAY_TIMEOUT' }, 503) : response({ ok: true, chats: [] });
  } });
  try {
    await f.settle(); assert.match(f.text(), /Conectado como/); assert.equal(attempts, 1);
    await f.poll(); assert.equal(attempts, 2); assert.match(f.text(), /Conectado como/);
  } finally { f.close(); }
});

test('a late connected status cannot overwrite an explicit session restart', async () => {
  let resolvePoll, reads = 0;
  const f = fixture({ confirm: true, api: async action => {
    if (action === 'status') { reads += 1; return reads === 1 ? response(connected) : new Promise(resolve => { resolvePoll = resolve; }); }
    if (action === 'logout') return response({ ok: true, state: 'qr', qr: 'data:image/png;base64,new' });
    return response({ ok: true, chats: [] });
  } });
  try {
    await f.settle(); await f.poll(); await f.click('Cerrar sesión');
    await act(async () => resolvePoll(response(connected)));
    assert.match(f.text(), /Esperando QR/); assert.doesNotMatch(f.text(), /Conectado como/);
    assert.equal(f.requests.filter(item => item.action === 'logout').length, 1);
  } finally { f.close(); }
});

test('a stalled status read times out and permits a later successful refresh', async () => {
  let first = true;
  const f = fixture({ api: async (action, init) => {
    if (action === 'status' && first) { first = false; return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('Aborted')))); }
    return response(action === 'status' ? connected : { ok: true, chats: [] });
  } });
  try {
    await f.settle(); await f.poll(); assert.equal(f.requests.length, 1, 'no overlapping reads while status is pending');
    await f.timeout(); assert.match(f.text(), /Sin confirmar/);
    await f.poll(); assert.match(f.text(), /Conectado como/);
    assert.equal(f.requests.filter(item => item.action === 'status').length, 2);
    assert.equal(f.deadlines.size, 0);
  } finally { f.close(); }
});
