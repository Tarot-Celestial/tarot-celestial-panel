// Execute the real component with isolated hooks, timers, Auth and fetch.
// No browser session, Supabase connection, lead writes or provider requests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/components/captacion/CaptacionPanel.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const row = (id, state = 'nuevo', extra = {}) => ({ id: String(id), estado: state, workflow_state: state, cliente_id: String(id), cliente: { nombre: 'Contact ' + id }, ...extra });
const body = (items, next = null, extra = {}) => ({ ok: true, items, server_time: '2026-10-14T12:00:00Z', pagination: { next_page: next, has_more: next !== null }, ...extra });
const nodes = (value, output = []) => { if (Array.isArray(value)) value.forEach(child => nodes(child, output)); else if (value && typeof value === 'object') { output.push(value); nodes(value.props?.children, output); } return output; };
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : typeof value === 'string' || typeof value === 'number' ? String(value) : '';
function fixture(options = {}) {
  const hooks = [], requests = [], timers = new Map(), intervals = new Map(), channels = [];
  let cursor = 0, dirty = false, tree, timerId = 0, effects = [], authCallback;
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) { const i = cursor++; if (!hooks[i]) hooks[i] = { value: typeof initial === 'function' ? initial() : initial }; return [hooks[i].value, next => { const value = typeof next === 'function' ? next(hooks[i].value) : next; if (!Object.is(hooks[i].value, value)) { hooks[i].value = value; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; if (!hooks[i]) hooks[i] = { current: initial }; return hooks[i]; },
    useMemo(fn, deps) { const i = cursor++; if (!hooks[i] || !equal(hooks[i].deps, deps)) hooks[i] = { deps, value: fn() }; return hooks[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useDeferredValue(value) { return value; },
    useEffect(fn, deps) { const i = cursor++; if (!hooks[i] || !equal(hooks[i].deps, deps)) { const prior = hooks[i]; hooks[i] = { deps }; effects.push(() => { prior?.cleanup?.(); hooks[i].cleanup = fn(); }); } },
  };
  function target() { const listeners = new Map(); return { visibilityState: 'visible', addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); }, removeEventListener(name, fn) { listeners.get(name)?.delete(fn); }, emit(name) { listeners.get(name)?.forEach(fn => fn({})); } }; }
  const win = { ...target(), setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); }, setInterval(fn, ms) { const id = ++timerId; intervals.set(id, { fn, ms }); return id; }, clearInterval(id) { intervals.delete(id); } }, doc = target();
  const sb = { auth: { getSession: async () => ({ data: { session: { access_token: 'fake-fixture', user: { id: 'fixture-user' } } } }), onAuthStateChange(fn) { authCallback = fn; return { data: { subscription: { unsubscribe() { authCallback = null; } } } }; } }, channel() { const channel = { change: null, status: null, on(_event, _filter, fn) { channel.change = fn; return channel; }, subscribe(fn) { channel.status = fn; if (options.subscribeImmediately !== false) fn('SUBSCRIBED'); return channel; } }; channels.push(channel); return channel; }, removeChannel() {} };
  const exports = {}, jsx = (type, props) => ({ type, props });
  vm.runInNewContext(compiled, { exports, require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => 'Icon:' + String(key) });
    if (name === '@/lib/supabase-browser') return { supabaseBrowser: () => sb };
    if (name === '@/components/global/BrandSwitcher') return { getActiveBrand: () => 'celestial' };
    if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
    throw new Error(name);
  }, window: win, document: doc, Date, Set, Map, AbortController, console, fetch(url, requestOptions) { return new Promise((resolve, reject) => { requests.push({ url, options: requestOptions, resolve, reject }); if (!options.ignoreAbort) requestOptions.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); }); } });
  function render() { cursor = 0; dirty = false; effects = []; tree = exports.default({}); for (const effect of effects) effect(); }
  async function flush() { for (let i = 0; i < 5; i++) { await new Promise(resolve => setImmediate(resolve)); if (dirty) render(); } }
  render();
  return { requests, channels, win, doc, async flush() { await flush(); }, tree: () => tree, text: () => text(tree),
    async respond(index, value, status = 200) { requests[index].resolve({ ok: status >= 200 && status < 300, status, json: async () => value }); await flush(); },
    async click(label) { const button = nodes(tree).find(node => node.type === 'button' && text(node) === label); assert.ok(button, 'Button: ' + label); button.props.onClick(); if (dirty) render(); await flush(); },
    async change(label, value) { const select = nodes(tree).find(node => node.type?.name === 'Select' && node.props.label === label); assert.ok(select); select.props.onChange(value); if (dirty) render(); await flush(); },
    cards: () => nodes(tree).filter(node => node.type?.name === 'LeadCard').map(node => node.props.lead),
    count(label = 'En vista') { return nodes(tree).find(node => node.type?.name === 'Hud' && node.props.label === label)?.props.value; },
    async fireTimeout(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } await flush(); },
    async interval(ms) { for (const timer of intervals.values()) if (timer.ms === ms) timer.fn(); await flush(); },
    async signOut() { authCallback?.('SIGNED_OUT'); await flush(); },
    close() { for (const hook of hooks) hook?.cleanup?.(); },
  };
}

test('initial load follows pagination and reaches all 398 contacts', async () => {
  const f = fixture(); try {
    await f.flush(); assert.equal(f.requests.length, 1);
    await f.respond(0, body(Array.from({ length: 250 }, (_, i) => row(i)), 1)); assert.equal(f.requests.length, 2); assert.match(f.requests[1].url, /page=1/);
    await f.respond(1, body(Array.from({ length: 148 }, (_, i) => row(i + 250))));
    assert.equal(f.count(), 398); assert.doesNotMatch(f.text(), /Cargar más contactos/);
  } finally { f.close(); }
});

test('Todos renders every state, including pend_cap records with closed_at', async () => {
  const f = fixture(); try {
    await f.flush(); await f.respond(0, body([])); await f.click('Todos');
    await f.respond(1, body([row('new'), row('free', 'pend_free'), row('cap', 'pend_cap'), row('client', 'cliente'), row('closed', 'cerrado'), ...[1, 2, 3].map(n => row('legacy-closed-' + n, 'pend_cap', { closed_at: '2026-10-12' }))]));
    assert.equal(f.count(), 8); assert.equal(f.cards().length, 8); assert.equal(f.count('Pend CAP'), 1); assert.equal(f.count('Clientes'), 1);
    const closedColumn = nodes(f.tree()).find(node => node.type === 'article' && String(node.props.className).includes('cerrado'));
    assert.equal(nodes(closedColumn).filter(node => node.type?.name === 'LeadCard').length, 4);
  } finally { f.close(); }
});

test('a slow previous scope cannot overwrite a newer response even when transport ignores cancellation', async () => {
  const f = fixture({ ignoreAbort: true }); try {
    await f.flush(); await f.click('Todos'); assert.equal(f.requests[0].options.signal.aborted, true);
    await f.respond(1, body([row('current')])); await f.respond(0, body([row('obsolete')]));
    assert.deepEqual(f.cards().map(item => item.id), ['current']);
  } finally { f.close(); }
});

test('Realtime bursts coalesce and queue one refresh after the active read', async () => {
  const f = fixture(); try {
    await f.flush(); await f.respond(0, body([row('first')]));
    for (let i = 0; i < 5; i++) f.channels.at(-1).change({ eventType: 'UPDATE', new: { id: 'lead' } });
    await f.flush(); assert.equal(f.requests.length, 2);
    await f.respond(1, body([row('middle')])); await f.fireTimeout(100); assert.equal(f.requests.length, 3);
    await f.respond(2, body([row('latest')])); assert.equal(f.cards()[0].id, 'latest');
  } finally { f.close(); }
});

test('subscription established before the first snapshot does not duplicate the initial read', async () => {
  const f = fixture(); try {
    await f.flush(); await f.respond(0, body([row('initial')]));
    f.channels.at(-1).status('SUBSCRIBED'); await f.fireTimeout(100);
    assert.equal(f.requests.length, 1); assert.equal(f.cards()[0].id, 'initial');
  } finally { f.close(); }
});

test('late subscription catches up after an in-flight snapshot without parallel or duplicate reads', async () => {
  const f = fixture({ subscribeImmediately: false }); try {
    await f.flush(); const channel = f.channels.at(-1);
    channel.status('SUBSCRIBED'); channel.status('SUBSCRIBED'); await f.flush();
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].options.signal.aborted, false);
    await f.respond(0, body([row('before-subscription')])); await f.fireTimeout(100);
    assert.equal(f.requests.length, 2);
    await f.respond(1, body([row('before-subscription'), row('missed-in-gap')]));
    await f.fireTimeout(100); assert.equal(f.requests.length, 2); assert.equal(f.count(), 2);
  } finally { f.close(); }
});

test('Realtime reconnect immediately recovers missing leads and coalesces repeated connection transitions', async () => {
  const f = fixture(); try {
    await f.flush(); await f.respond(0, body([row('initial')]));
    const channel = f.channels.at(-1);
    channel.status('CHANNEL_ERROR'); await f.flush(); assert.match(f.text(), /ACTUALIZACIÓN PERIÓDICA/);
    channel.status('SUBSCRIBED'); channel.status('SUBSCRIBED'); await f.flush();
    assert.equal(f.requests.length, 2); assert.match(f.text(), /CAMBIOS EN DIRECTO/);
    channel.status('TIMED_OUT'); channel.status('SUBSCRIBED'); channel.status('CLOSED'); channel.status('SUBSCRIBED'); await f.flush();
    assert.equal(f.requests.length, 2); assert.equal(f.requests[1].options.signal.aborted, false);
    await f.respond(1, body([row('initial'), row('reconnected')])); await f.fireTimeout(100);
    assert.equal(f.requests.length, 3);
    await f.respond(2, body([row('initial'), row('reconnected'), row('latest')]));
    await f.fireTimeout(100); assert.equal(f.requests.length, 3); assert.equal(f.count(), 3);
  } finally { f.close(); }
});

test('reconnecting during append also refreshes page zero to recover newly arrived leads', async () => {
  const f = fixture(); try {
    await f.flush();
    for (let page = 0; page < 4; page++) await f.respond(page, body([row('page-' + page)], page + 1));
    const channel = f.channels.at(-1);
    nodes(f.tree()).find(node => node.type === 'button' && text(node) === 'Cargar más contactos').props.onClick();
    channel.status('CHANNEL_ERROR'); channel.status('SUBSCRIBED'); await f.flush();
    assert.equal(f.requests.length, 5); assert.match(f.requests[4].url, /page=4/);
    await f.respond(4, body([row('last-page')])); await f.fireTimeout(100);
    assert.equal(f.requests.length, 6); assert.match(f.requests[5].url, /page=0/);
    await f.respond(5, body([row('newest'), row('last-page')]));
    assert.ok(f.cards().some(item => item.id === 'newest'));
  } finally { f.close(); }
});

test('visible focus and online refresh without waiting a minute; hidden interval does not load', async () => {
  const f = fixture(); try {
    await f.flush(); await f.respond(0, body([]));
    f.doc.visibilityState = 'hidden'; await f.interval(60000); assert.equal(f.requests.length, 1);
    f.doc.visibilityState = 'visible'; f.win.emit('focus'); f.win.emit('online'); f.doc.emit('visibilitychange'); await f.flush(); assert.equal(f.requests.length, 2);
    await f.respond(1, body([row('returned')])); assert.equal(f.count(), 1);
  } finally { f.close(); }
});

test('errors preserve last correct data and recovery clears the error independently of Realtime status', async () => {
  const f = fixture(); try {
    await f.flush(); await f.respond(0, body([row('saved')])); await f.click('Actualizar');
    await f.respond(1, { ok: false, error: 'Fixture unavailable' }, 503);
    assert.equal(f.count(), 1); assert.match(f.text(), /Fixture unavailable.*Se conserva/); assert.match(f.text(), /CAMBIOS EN DIRECTO/);
    await f.click('Actualizar'); await f.respond(2, body([row('recovered')]));
    assert.doesNotMatch(f.text(), /Fixture unavailable/); assert.equal(f.cards()[0].id, 'recovered'); assert.doesNotMatch(f.text(), /Meta sincronizado|EN VIVO/);
  } finally { f.close(); }
});

test('a hanging fetch times out, cancels transport and enables a successful retry', async () => {
  const f = fixture(); try {
    await f.flush(); await f.fireTimeout(20000); assert.equal(f.requests[0].options.signal.aborted, true);
    assert.match(f.text(), /tardando demasiado/);
    const button = nodes(f.tree()).find(node => node.type === 'button' && text(node) === 'Actualizar'); assert.equal(button.props.disabled, false);
    await f.click('Actualizar'); await f.respond(1, body([row('retry')])); assert.equal(f.count(), 1); assert.doesNotMatch(f.text(), /tardando demasiado/);
  } finally { f.close(); }
});

test('scope changes reset hidden filters, and removed filter options do not hide new rows', async () => {
  const f = fixture(); try {
    await f.flush(); await f.respond(0, body([row('A', 'nuevo', { campaign_name: 'Campaign A' })])); await f.change('Todas las campañas', 'Campaign A');
    await f.click('Todos'); await f.respond(1, body([row('B', 'nuevo', { campaign_name: 'Campaign B' })])); assert.equal(f.count(), 1);
    await f.change('Todas las campañas', 'Campaign B'); await f.click('Actualizar'); await f.respond(2, body([row('C', 'nuevo', { campaign_name: 'Campaign C' })])); assert.equal(f.count(), 1);
  } finally { f.close(); }
});

test('admin configuration is explicit and an internal event does not imply working Meta delivery', async () => {
  const f = fixture(); try {
    await f.flush(); await f.respond(0, body([], null, { meta_diagnostics: { configuration: { access_token: false, app_secret: false, verify_token: false, form_ids: false, internal_ingest: true }, event_read_available: true, last_event: { source: 'internal_ingest', status: 'processed', received_at: '2026-10-12' } } }));
    assert.match(f.text(), /Entrada de Meta: configuración directa incompleta/); assert.match(f.text(), /Integración interna/); assert.doesNotMatch(f.text(), /Meta activo|Meta sincronizado/);
    await f.signOut(); assert.equal(f.count(), 0); assert.doesNotMatch(f.text(), /Ver diagnóstico/); assert.match(f.text(), /sesión ha caducado/);
  } finally { f.close(); }
});

test('large catalogues expose continuation instead of silently truncating after four API pages', async () => {
  const f = fixture(); try {
    await f.flush(); for (let page = 0; page < 4; page++) await f.respond(page, body(Array.from({ length: 250 }, (_, i) => row(page * 250 + i)), page + 1));
    assert.equal(f.count(), 1000); assert.match(f.text(), /Quedan más por cargar/); assert.equal(f.requests.length, 4);
    await f.click('Cargar más contactos'); assert.match(f.requests[4].url, /page=4/); await f.respond(4, body([row('last')]));
    assert.equal(f.count(), 1001); assert.doesNotMatch(f.text(), /Cargar más contactos/);
  } finally { f.close(); }
});

test('unmount cancels reads and prevents a queued refresh from restarting them', async () => {
  const f = fixture(); await f.flush(); f.channels.at(-1).change({ eventType: 'UPDATE', new: {} }); await f.respond(0, body([]));
  f.close(); await f.fireTimeout(100); assert.equal(f.requests.length, 1);
});

function inboxLoader(status = 200) {
  const file = fs.readFileSync(path.join(__dirname, '../src/components/central/OperationalInbox.tsx'), 'utf8');
  const ast = ts.createSourceFile('OperationalInbox.tsx', file, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'load' && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(callback);
  const exported = {}, requests = [], state = { leads: [row('previous')], error: '' };
  const code = ts.transpileModule('exports.load = ' + callback, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, {
    exports: exported, document: { visibilityState: 'visible' }, Date, Promise, encodeURIComponent,
    loadInFlightRef: { current: false }, getToken: async () => 'fixture-token', monthKeyNow: () => '2026-10', todayKey: () => '2026-10-14', mode: 'admin',
    setLoading() {}, setError(value) { state.error = value; }, setLeads(value) { state.leads = value; }, setChatItems() {}, setIncidentItems() {}, setOutboundItems() {}, setRefreshedAt() {},
    safeJson: async response => response.json(), fetch: async (url, options) => {
      requests.push({ url, options }); const leads = url.startsWith('/api/captacion/list');
      return { ok: !leads || status === 200, status: leads ? status : 200, json: async () => leads ? status === 200 ? body([row('new')]) : { ok: false, error: 'fixture denied' } : { ok: true } };
    },
  });
  return { run: exported.load, state, requests };
}

test('OperationalInbox supplies the authenticated token to the Captación list', async () => {
  const f = inboxLoader(); await f.run();
  assert.equal(f.requests.find(request => request.url.startsWith('/api/captacion/list')).options.headers.Authorization, 'Bearer fixture-token');
  assert.equal(f.state.leads[0].id, 'new'); assert.equal(f.state.error, '');
});

test('OperationalInbox surfaces a list error without replacing existing leads with an empty list', async () => {
  const f = inboxLoader(401); await f.run();
  assert.match(f.state.error, /No se pudieron actualizar los contactos/); assert.equal(f.state.leads[0].id, 'previous');
});
