const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const Renderer = require('react-test-renderer');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const { act } = Renderer;
const settle = () => new Promise(resolve => setImmediate(resolve));

function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const code = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const localRequire = name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.endsWith('.module.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
    if (name === '@/lib/accounting') return load('src/lib/accounting.ts');
    if (name === './AccountingDialog') return { __esModule: true, default: props => React.createElement('section', { title: props.title }, props.children) };
    if (name === './accounting-client') return { madridDate: () => '2026-01-01' };
    return require(name);
  };
  vm.runInNewContext(code, { module, exports: module.exports, require: localRequire, console, Date, Intl, Error, DOMException, AbortController, setTimeout, clearTimeout, atob, crypto: crypto.webcrypto, window: { setTimeout, clearTimeout }, ...globals }, { filename: file });
  return module.exports;
}

function clientFixture(options = {}) {
  const requests = [];
  const session = options.session === null ? null : { access_token: 'valid-bearer', user: { id: 'user-1' } };
  const module = load('src/features/accounting/accounting-client.ts', {
    '@/lib/supabase-browser': { supabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session }, error: null }) } }) },
  }, { fetch: async (url, init) => { requests.push({ url, init }); return { ok: options.ok !== false, status: options.status || 200, json: async () => options.payload || { ok: true, entries: [] } }; } });
  return { ...module, requests };
}

test('financial reads bypass caches and send the current bearer with same-origin session cookies', async () => {
  const fixture = clientFixture();
  await fixture.accountingRequest();
  assert.equal(fixture.requests[0].url, '/api/admin/contabilidad');
  assert.equal(fixture.requests[0].init.cache, 'no-store');
  assert.equal(fixture.requests[0].init.credentials, 'same-origin');
  assert.equal(fixture.requests[0].init.headers.Authorization, 'Bearer valid-bearer');
});

test('client refuses to fetch accounting without a primary user session', async () => {
  const fixture = clientFixture({ session: null });
  await assert.rejects(fixture.accountingRequest(), error => error.status === 401);
  assert.equal(fixture.requests.length, 0);
});

test('wrong secondary password does not revoke the primary administrator gate', async () => {
  const fixture = clientFixture({ ok: false, status: 403, payload: { ok: false, code: 'INVALID_PASSWORD', error: 'Contraseña incorrecta.' } });
  let caught;
  try { await fixture.accountingRequest('/session', { method: 'POST', body: '{}' }); } catch (error) { caught = error; }
  assert.equal(caught.code, 'INVALID_PASSWORD');
  assert.equal(fixture.accountingAccessExpired(caught), false);
  assert.equal(fixture.accountingAccessExpired(new fixture.AccountingRequestError('No permitido', 403, 'FORBIDDEN')), true);
  assert.equal(fixture.accountingAccessExpired(new fixture.AccountingRequestError('Bloqueado', 423, 'ACCOUNTING_LOCKED')), true);
  assert.equal(fixture.accountingAccessExpired(new fixture.AccountingRequestError('No auth', 401, 'NO_AUTH')), true);
  assert.equal(fixture.accountingAccessExpired(new fixture.AccountingRequestError('Origin', 403, 'INVALID_ORIGIN')), false);
});

test('UI session identity changes on a new auth session, not an ordinary token refresh', () => {
  const fixture = clientFixture();
  const token = (session, expiry) => `header.${Buffer.from(JSON.stringify({ session_id: session, exp: expiry })).toString('base64url')}.signature`;
  const first = fixture.accountingSessionIdentity({ user: { id: 'alex' }, access_token: token('session-one', 1) });
  assert.equal(first, fixture.accountingSessionIdentity({ user: { id: 'alex' }, access_token: token('session-one', 2) }));
  assert.notEqual(first, fixture.accountingSessionIdentity({ user: { id: 'other-admin' }, access_token: token('session-one', 1) }));
  assert.notEqual(first, fixture.accountingSessionIdentity({ user: { id: 'alex' }, access_token: token('session-two', 1) }));
  assert.equal(fixture.accountingSessionIdentity(null), null);
});

test('CSV user content cannot start spreadsheet formulas', () => {
  const fixture = clientFixture();
  for (const value of ['=WEBSERVICE("x")', '+SUM(A1:A2)', '-1+1', '@SUM(A1)', '  =1+1', '\t=1+1']) {
    assert.ok(fixture.csvCell(value).startsWith('"\''));
  }
  assert.equal(fixture.csvCell('Pago "normal"'), '"Pago ""normal"""');
});

test('adding an option omits its id and submits the actual entered name', async () => {
  const Component = load('src/features/accounting/AccountingOptions.tsx').default;
  const writes = [];
  let renderer;
  await act(async () => { renderer = Renderer.create(React.createElement(Component, { snapshot: { categories: [], methods: [], entries: [] }, onSave: async value => writes.push(value) })); });
  const add = renderer.root.findByProps({ 'aria-label': 'Añadir: Origen de los ingresos' });
  await act(async () => add.props.onClick());
  const name = renderer.root.findByProps({ placeholder: 'Nombre de la nueva opción' });
  await act(async () => name.props.onChange({ target: { value: 'Comisiones recibidas' } }));
  await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); await settle(); });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].name, 'Comisiones recibidas');
  assert.equal(writes[0].kind, 'income');
  assert.equal(Object.hasOwn(writes[0], 'id'), false);
  await act(async () => renderer.unmount());
});

test('entry form keeps an idempotency id after an uncertain save and preserves cents', async () => {
  const Component = load('src/features/accounting/EntryForm.tsx').default;
  const category = '11111111-1111-4111-8111-111111111111', method = '22222222-2222-4222-8222-222222222222';
  const writes = []; let renderer;
  await act(async () => { renderer = Renderer.create(React.createElement(Component, {
    kind: 'income', account: 'celestial', currency: 'EUR', snapshot: { entries: [], categories: [{ id: category, name: 'Minutos', kind: 'income', active: true }], methods: [{ id: method, name: 'PayPal', active: true }] },
    onSave: async value => { writes.push(value); if (writes.length === 1) throw new Error('Respuesta perdida'); }, onClose() {},
  })); });
  await act(async () => {
    renderer.root.findByProps({ placeholder: '0,00' }).props.onChange({ target: { value: '12,34' } });
    renderer.root.findByProps({ placeholder: 'Ej.: venta de minutos recibida por PayPal' }).props.onChange({ target: { value: 'Pago comprobado' } });
    const selects = renderer.root.findAllByType('select');
    selects.find(select => select.findAllByProps({ value: method }).length).props.onChange({ target: { value: method } });
    selects.find(select => select.findAllByProps({ value: category }).length).props.onChange({ target: { value: category } });
  });
  for (let attempt = 0; attempt < 2; attempt++) await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); await settle(); });
  assert.equal(writes.length, 2);
  assert.equal(writes[0].id, writes[1].id);
  assert.equal(writes[0].amount_cents, 1234);
  assert.equal(writes[0].description, 'Pago comprobado');
  await act(async () => renderer.unmount());
});

test('private accounting state has no browser-persistent password or money cache', () => {
  const paths = ['src/app/admin/contabilidad/page.tsx', 'src/features/accounting/accounting-client.ts', 'src/features/accounting/AccountingWorkspace.tsx'];
  for (const file of paths) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /(?:localStorage|sessionStorage)\s*\./);
    assert.doesNotMatch(source, /ACCOUNTING_PASSWORD(?:_HASH)?\s*[:=]/);
  }
});

function pageFixture({ unlocked = true, deferUnlock = false } = {}) {
  const session = (uid, sid) => ({ user: { id: uid }, access_token: `header.${Buffer.from(JSON.stringify({ session_id: sid })).toString('base64url')}.signature` });
  const first = session('first-admin', 'first-session');
  const redirects = [], requests = [];
  let notify, resolveUnlock, identityChecks = 0, resolveReplacement;
  const client = clientFixture();
  const sb = { auth: { onAuthStateChange(callback) {
    notify = callback; callback('INITIAL_SESSION', first);
    return { data: { subscription: { unsubscribe() {} } } };
  } } };
  const request = async (url = '', init = {}) => {
    requests.push({ url, init });
    if (url === '/session' && init.method === 'POST' && deferUnlock) return new Promise(resolve => { resolveUnlock = resolve; });
    if (url === '/session') return { ok: true, configured: true, unlocked, expiresAt: new Date(Date.now() + 60000).toISOString() };
    return { ok: true, entries: [], categories: [], methods: [], updatedAt: new Date().toISOString() };
  };
  const Component = load('src/app/admin/contabilidad/page.tsx', {
    'next/dynamic': () => props => React.createElement('div', { 'data-private-workspace': true, ...props }),
    '@/components/AppHeader': { __esModule: true, default: () => null },
    '@/lib/panel-access': {
      loadPanelIdentity: async () => { identityChecks++; return identityChecks > 1 ? new Promise(resolve => { resolveReplacement = resolve; }) : { can_admin: true, role: 'admin' }; },
      panelPathForRole: () => '/panel-central', panelSessionRejected: () => false, redirectToLogin: reason => redirects.push(reason),
    },
    '@/lib/supabase-browser': { supabaseBrowser: () => sb },
    '@/features/accounting/accounting-client': { ...client, accountingRequest: request },
  }, {
    window: { setTimeout, clearTimeout, setInterval, clearInterval, addEventListener() {}, removeEventListener() {}, location: { replace: url => redirects.push(url) } },
    document: { visibilityState: 'visible' },
  }).default;
  return { Component, redirects, requests, session, notify: (...args) => notify(...args), resolveUnlock: value => resolveUnlock(value), identityChecks: () => identityChecks, resolveReplacement: value => resolveReplacement?.(value) };
}

test('switching the primary principal clears already displayed financial data immediately', async t => {
  const fixture = pageFixture(); let renderer;
  t.after(async () => { if (renderer) await act(async () => renderer.unmount()); });
  await act(async () => { renderer = Renderer.create(React.createElement(fixture.Component)); await settle(); await settle(); });
  assert.equal(renderer.root.findAllByProps({ 'data-private-workspace': true }).length, 1);
  await act(async () => { fixture.notify('SIGNED_IN', fixture.session('second-admin', 'second-session')); await settle(); });
  assert.equal(renderer.root.findAllByProps({ 'data-private-workspace': true }).length, 0);
  assert.equal(fixture.identityChecks(), 2);
  await act(async () => { fixture.resolveReplacement({ can_admin: false, role: 'central' }); await settle(); });
  assert.ok(fixture.redirects.includes('/panel-central'));
});

test('refreshing a token in the same auth session preserves the authorized workspace', async t => {
  const fixture = pageFixture(); let renderer;
  t.after(async () => { if (renderer) await act(async () => renderer.unmount()); });
  await act(async () => { renderer = Renderer.create(React.createElement(fixture.Component)); await settle(); await settle(); });
  await act(async () => { fixture.notify('TOKEN_REFRESHED', fixture.session('first-admin', 'first-session')); await settle(); });
  assert.equal(renderer.root.findAllByProps({ 'data-private-workspace': true }).length, 1);
  assert.equal(fixture.identityChecks(), 1);
});

test('an unlock response from before sign-out cannot reopen the financial workspace', async t => {
  const fixture = pageFixture({ unlocked: false, deferUnlock: true }); let renderer;
  t.after(async () => { if (renderer) await act(async () => renderer.unmount()); });
  await act(async () => { renderer = Renderer.create(React.createElement(fixture.Component)); await settle(); await settle(); });
  await act(async () => renderer.root.findByProps({ id: 'accounting-password' }).props.onChange({ target: { value: 'test-only-password' } }));
  await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); await settle(); });
  await act(async () => { fixture.notify('SIGNED_OUT', null); await settle(); });
  await act(async () => { fixture.resolveUnlock({ ok: true, configured: true, unlocked: true, expiresAt: new Date(Date.now() + 60000).toISOString() }); await settle(); });
  assert.equal(renderer.root.findAllByProps({ 'data-private-workspace': true }).length, 0);
  assert.ok(fixture.redirects.includes('accounting_signout'));
  assert.equal(fixture.requests.filter(request => request.url === '').length, 0);
});
