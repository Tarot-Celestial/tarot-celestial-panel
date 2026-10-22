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
  let brand = 'celestial', session = { access_token: 'fake-fixture', user: { id: 'fixture-user' } };
  const storage = new Map(options.focusId ? [['tc-captacion-focus-lead', options.focusId]] : []), emitted = [], scrolls = [];
  const sessionStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  class FixtureEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
  function CaptacionWhatsAppComposer() {}
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) { const i = cursor++; if (!hooks[i]) hooks[i] = { value: typeof initial === 'function' ? initial() : initial }; return [hooks[i].value, next => { const value = typeof next === 'function' ? next(hooks[i].value) : next; if (!Object.is(hooks[i].value, value)) { hooks[i].value = value; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; if (!hooks[i]) hooks[i] = { current: initial }; return hooks[i]; },
    useMemo(fn, deps) { const i = cursor++; if (!hooks[i] || !equal(hooks[i].deps, deps)) hooks[i] = { deps, value: fn() }; return hooks[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useDeferredValue(value) { return value; },
    useEffect(fn, deps) { const i = cursor++; if (!hooks[i] || !equal(hooks[i].deps, deps)) { const prior = hooks[i]; hooks[i] = { deps }; effects.push(() => { prior?.cleanup?.(); hooks[i].cleanup = fn(); }); } },
  };
  function target() { const listeners = new Map(); return { visibilityState: 'visible', addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); }, removeEventListener(name, fn) { listeners.get(name)?.delete(fn); }, emit(name, event = {}) { listeners.get(name)?.forEach(fn => fn(event)); }, dispatchEvent(event) { emitted.push(event); listeners.get(event.type)?.forEach(fn => fn(event)); return true; } }; }
  const win = { ...target(), setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); }, setInterval(fn, ms) { const id = ++timerId; intervals.set(id, { fn, ms }); return id; }, clearInterval(id) { intervals.delete(id); } }, doc = target();
  doc.getElementById = id => ({ scrollIntoView: init => scrolls.push({ id, ...init }) });
  const sb = { auth: { getSession: async () => ({ data: { session } }), onAuthStateChange(fn) { authCallback = fn; return { data: { subscription: { unsubscribe() { authCallback = null; } } } }; } }, channel() { const channel = { change: null, status: null, on(_event, _filter, fn) { channel.change = fn; return channel; }, subscribe(fn) { channel.status = fn; if (options.subscribeImmediately !== false) fn('SUBSCRIBED'); return channel; } }; channels.push(channel); return channel; }, removeChannel() {} };
  const exports = {}, jsx = (type, props) => ({ type, props });
  vm.runInNewContext(compiled, { exports, require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => 'Icon:' + String(key) });
    if (name === '@/lib/supabase-browser') return { supabaseBrowser: () => sb };
    if (name === '@/components/global/BrandSwitcher') return { getActiveBrand: () => brand };
    if (name === './CaptacionWhatsAppComposer') return { default: CaptacionWhatsAppComposer };
    if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
    throw new Error(name);
  }, window: win, document: doc, sessionStorage, Event: FixtureEvent, CustomEvent: FixtureEvent, Date, Set, Map, AbortController, console, fetch(url, requestOptions) { return new Promise((resolve, reject) => { requests.push({ url, options: requestOptions, resolve, reject }); if (!options.ignoreAbort) requestOptions.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); }); } });
  function render() { cursor = 0; dirty = false; effects = []; tree = exports.default({}); for (const effect of effects) effect(); }
  async function flush() { for (let i = 0; i < 5; i++) { await new Promise(resolve => setImmediate(resolve)); if (dirty) render(); } }
  render();
  return { requests, channels, win, doc, storage, emitted, scrolls, async flush() { await flush(); }, tree: () => tree, text: () => text(tree),
    async respond(index, value, status = 200) { assert.ok(requests[index], `Request ${index} exists`); requests[index].answered = true; requests[index].resolve({ ok: status >= 200 && status < 300, status, json: async () => value }); await flush(); },
    async click(label) { const button = nodes(tree).find(node => node.type === 'button' && text(node) === label); assert.ok(button, 'Button: ' + label); button.props.onClick(); if (dirty) render(); await flush(); },
    async change(label, value) { const select = nodes(tree).find(node => node.type?.name === 'Select' && node.props.label === label); assert.ok(select); select.props.onChange(value); if (dirty) render(); await flush(); },
    cards: () => nodes(tree).filter(node => node.type?.name === 'LeadCard').map(node => node.props.lead),
    composer: () => nodes(tree).find(node => node.type?.name === 'CaptacionWhatsAppComposer')?.props,
    async selectRecipient(id) { const composer = nodes(tree).find(node => node.type?.name === 'CaptacionWhatsAppComposer'); assert.ok(composer); composer.props.onSelectLead(id); await flush(); },
    async prepare(id) { const card = nodes(tree).find(node => node.type?.name === 'LeadCard' && node.props.lead.id === id); assert.ok(card); card.props.onWhatsApp(card.props.lead); await flush(); },
    async manage(id, action) { const card = nodes(tree).find(node => node.type?.name === 'LeadCard' && node.props.lead.id === id); assert.ok(card); void card.props.onAction(card.props.lead, action); await flush(); },
    async focus(id) { win.emit('tc-captacion-focus-lead', { detail: { leadId: id } }); await flush(); },
    async brand(value) { brand = value; win.emit('tc-brand-changed', { detail: { brand } }); await flush(); },
    count(label = 'En vista') { return nodes(tree).find(node => node.type?.name === 'Hud' && node.props.label === label)?.props.value; },
    async fireTimeout(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } await flush(); },
    async interval(ms) { for (const timer of intervals.values()) if (timer.ms === ms) timer.fn(); await flush(); },
    async signOut() { session = null; authCallback?.('SIGNED_OUT', null); await flush(); },
    close() { for (const hook of hooks) hook?.cleanup?.(); },
  };
}

function leadCardFixture() {
  const now = Date.parse('2026-10-22T20:00:00Z');
  class FixedDate extends Date { static now() { return now; } }
  const exports = {}, jsx = (type, props) => ({ type, props });
  vm.runInNewContext(compiled + '\nexports.card = LeadCard;', { exports, Date: FixedDate, Set, Map, require(name) {
    if (name === 'react') return { useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}]; } };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => 'Icon:' + String(key) });
    if (name === '@/lib/supabase-browser') return { supabaseBrowser: () => ({}) };
    if (name === '@/components/global/BrandSwitcher') return { getActiveBrand: () => 'celestial' };
    if (name === './CaptacionWhatsAppComposer') return { default: function CaptacionWhatsAppComposer() {} };
    if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
    throw new Error(name);
  } });
  return (extra = {}, fresh = false) => exports.card({ lead: row('card', 'nuevo', extra), fresh, busy: false, onAction() {}, onOpen() {} });
}

test('NEW follows the original Meta submission time, not an import, update or transient Realtime insert', () => {
  const card = leadCardFixture();
  const recent = { latest_meta_lead_at: '2026-10-22T19:59:00Z' };
  assert.match(text(card(recent)), /NEW/);
  assert.match(text(card({ latest_meta_lead_at: '2026-10-21T20:00:01Z' })), /NEW/);
  for (const latest_meta_lead_at of [null, 'invalid', '2026-10-14T12:00:00Z', '2026-10-21T20:00:00Z', '2026-10-22T20:00:01Z']) {
    assert.doesNotMatch(text(card({ latest_meta_lead_at, created_at: recent.latest_meta_lead_at, updated_at: recent.latest_meta_lead_at }, true)), /NEW/, String(latest_meta_lead_at));
  }
});

test('an existing contact keeps NEW for a fresh submission until it is handled, without changing its workflow', () => {
  const card = leadCardFixture();
  const latest_meta_lead_at = '2026-10-22T19:30:00Z';
  const existing = { latest_meta_lead_at, estado: 'pend_cap', workflow_state: 'pend_cap', created_at: '2026-01-01T00:00:00Z', last_contact_at: '2026-10-20T10:00:00Z' };
  assert.match(text(card(existing)), /NEW/);
  assert.match(text(card(existing)), /Pendiente captación/);
  const formerlyClosed = card({ ...existing, estado: 'no_interesado', workflow_state: 'no_interesado', closed_at: '2026-10-20T10:00:00Z' });
  assert.match(text(formerlyClosed), /NEW/);
  assert.match(text(formerlyClosed), /Cerrado/);
  for (const field of ['last_contact_at', 'contacted_at', 'closed_at']) {
    assert.match(text(card({ ...existing, [field]: '2026-10-22T19:29:59Z' })), /NEW/, field + ' before');
    assert.doesNotMatch(text(card({ ...existing, [field]: latest_meta_lead_at })), /NEW/, field + ' equal');
    assert.doesNotMatch(text(card({ ...existing, [field]: '2026-10-22T19:30:01Z' })), /NEW/, field + ' after');
  }
});

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

const focusedId = '00112233-4455-6677-8899-aabbccddeeff';
const secondFocusedId = '10112233-4455-6677-8899-aabbccddeeff';
const pendingRequest = (f, match) => f.requests.findIndex(request => !request.answered && !request.options.signal?.aborted && match(request));
const focusRequest = f => pendingRequest(f, request => request.url.includes('lead_id='));
async function resolveMainList(f, items = []) {
  const index = pendingRequest(f, request => request.url.startsWith('/api/captacion/list') && !request.url.includes('lead_id='));
  if (index >= 0) await f.respond(index, body(items));
}
async function loadFocused(f, item) {
  await f.flush();
  const first = pendingRequest(f, request => request.url.includes('page='));
  if (first >= 0) await f.respond(first, body([]));
  await f.focus(item.id); await resolveMainList(f);
  await f.respond(focusRequest(f), body([item]));
}

test('the companion handoff opens a closed contact beyond the first four pages without reopening it', async () => {
  const f = fixture(); try {
    await f.flush();
    for (let page = 0; page < 4; page++) await f.respond(page, body(Array.from({ length: 250 }, (_, i) => row(`page-${page}-${i}`)), page + 1));
    assert.equal(f.count(), 1000);
    await f.focus(focusedId);
    const request = focusRequest(f);
    assert.match(f.requests[request].url, new RegExp(`scope=todos&brand=celestial&lead_id=${focusedId}`));
    assert.equal(f.requests[request].options.headers.Authorization, 'Bearer fake-fixture');
    await resolveMainList(f, [row('some-other-loaded-contact')]);
    const closed = row(focusedId, 'no_interesado', { closed_at: '2026-09-01T10:00:00Z' });
    await f.respond(focusRequest(f), body([closed]));
    assert.deepEqual(f.cards().map(item => item.id), [focusedId]);
    assert.equal(f.cards()[0].estado, 'no_interesado');
    assert.equal(f.composer().selectedLeadId, focusedId);
    assert.equal(f.composer().contacts.find(item => item.id === focusedId).closed_at, closed.closed_at);
    assert.ok(f.scrolls.some(item => item.id === 'captacion-whatsapp'));
    assert.equal(f.requests.filter(request => request.options.method === 'POST').length, 0);
    const activeClosed = nodes(f.tree()).find(node => node.type === 'article' && /cerrado/.test(node.props.className) && /mobileActive/.test(node.props.className));
    assert.ok(activeClosed, 'closed column selected on mobile');
  } finally { f.close(); }
});

test('a saved companion handoff survives mounting and is consumed only after a valid contact id', async () => {
  const f = fixture({ focusId: focusedId }); try {
    await f.flush(); await resolveMainList(f);
    await f.respond(focusRequest(f), body([row(focusedId)]));
    assert.equal(f.storage.has('tc-captacion-focus-lead'), false);
    assert.equal(f.composer().selectedLeadId, focusedId);
    const count = f.requests.length;
    await f.focus('malformed-id'); assert.equal(f.requests.length, count); assert.equal(f.composer().selectedLeadId, focusedId);
  } finally { f.close(); }
});

test('WhatsApp preparation selects the correct recipient and never calls a management endpoint', async () => {
  const f = fixture(); try {
    await f.flush(); await f.respond(0, body([row('first'), row('second', 'pend_cap')]));
    await f.prepare('second');
    assert.equal(f.composer().selectedLeadId, 'second');
    assert.equal(f.composer().contacts.find(item => item.id === 'second').estado, 'pend_cap');
    assert.equal(f.cards().find(item => item.id === 'second').last_contact_at, undefined);
    assert.equal(f.requests.length, 1);
    assert.equal(f.emitted.some(event => event.type === 'tc-captacion-changed'), false);
  } finally { f.close(); }
});

test('successful management informs companions after confirmation; a rejected action does not', async () => {
  for (const ok of [true, false]) {
    const f = fixture(); try {
      await f.flush(); await f.respond(0, body([row('manageable')]));
      await f.manage('manageable', 'no_contesta');
      assert.equal(f.emitted.some(event => event.type === 'tc-captacion-changed'), false);
      assert.equal(f.requests[1].options.method, 'POST');
      await f.respond(1, { ok, error: ok ? undefined : 'Denied' }, ok ? 200 : 403);
      assert.equal(f.emitted.filter(event => event.type === 'tc-captacion-changed').length, ok ? 1 : 0);
      if (!ok) assert.equal(f.cards()[0].estado, 'nuevo');
    } finally { f.close(); }
  }
});

test('late focused reads cannot restore the old contact after another focus, sign-out or a brand change', async () => {
  for (const transition of ['focus', 'logout', 'brand']) {
    const f = fixture({ ignoreAbort: true }); try {
      await f.flush(); await f.respond(0, body([])); await f.focus(focusedId); await resolveMainList(f);
      const old = focusRequest(f);
      if (transition === 'focus') {
        await f.focus(secondFocusedId);
        await f.respond(focusRequest(f), body([row(secondFocusedId)]));
      } else if (transition === 'logout') await f.signOut();
      else await f.brand('orion');
      assert.equal(f.requests[old].options.signal.aborted, true);
      await f.respond(old, body([row(focusedId)]));
      assert.equal(f.cards().some(item => item.id === focusedId), false, transition);
      assert.equal(f.composer()?.contacts.some(item => item.id === focusedId) || false, false, transition);
      if (transition === 'focus') assert.equal(f.composer().selectedLeadId, secondFocusedId);
    } finally { f.close(); }
  }
});

test('permission denial removes an extra focused contact from cards and the WhatsApp composer', async () => {
  for (const status of [401, 403]) {
    const f = fixture(); try {
      await loadFocused(f, row(focusedId)); assert.equal(f.composer().selectedLeadId, focusedId);
      await f.click('Actualizar');
      await f.respond(pendingRequest(f, request => request.url.includes('page=')), { ok: false, error: 'No autorizado' }, status);
      assert.equal(f.cards().some(item => item.id === focusedId), false);
      assert.equal(f.composer()?.contacts.some(item => item.id === focusedId) || false, false);
    } finally { f.close(); }
  }
});

test('a focused contact outside the loaded pages is refreshed or removed after its management', async () => {
  const f = fixture(); try {
    await loadFocused(f, row(focusedId, 'nuevo', { latest_meta_lead_at: new Date().toISOString() }));
    await f.manage(focusedId, 'no_contesta');
    await f.respond(pendingRequest(f, request => request.url === '/api/captacion/action'), { ok: true });
    await resolveMainList(f);
    const recheck = focusRequest(f);
    if (recheck >= 0) await f.respond(recheck, body([row(focusedId, 'pend_free', { last_contact_at: new Date().toISOString() })]));
    const remaining = f.cards().find(item => item.id === focusedId);
    assert.ok(!remaining || remaining.estado === 'pend_free', 'a separate focused snapshot must not retain the old workflow after management');
  } finally { f.close(); }
});

test('revalidating a focused contact never changes a subsequently selected WhatsApp recipient or jumps the scroll', async () => {
  const f = fixture(); try {
    await f.flush(); await f.respond(0, body([])); await f.focus(focusedId);
    await resolveMainList(f, [row('other-recipient')]);
    await f.respond(focusRequest(f), body([row(focusedId)]));
    await f.selectRecipient('other-recipient');
    assert.equal(f.composer().selectedLeadId, 'other-recipient');
    const scrollsBefore = f.scrolls.length;
    await f.interval(60000); await resolveMainList(f, [row('other-recipient')]);
    await f.respond(focusRequest(f), body([row(focusedId, 'pend_free')]));
    assert.equal(f.composer().selectedLeadId, 'other-recipient');
    assert.equal(f.scrolls.length, scrollsBefore);
  } finally { f.close(); }
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
