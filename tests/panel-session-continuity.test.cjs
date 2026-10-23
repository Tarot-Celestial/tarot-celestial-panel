const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
function run(source, mocks = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(compile(source), {
    exports, Request, Response, Headers, URL, AbortController, AbortSignal, DOMException, Error, Date, setTimeout, clearTimeout,
    require(name) { if (Object.hasOwn(mocks, name)) return mocks[name]; if (name.startsWith('react')) return require(name); throw Error(`Unexpected dependency ${name}`); },
    ...globals,
  });
  return exports;
}
const load = (file, mocks, globals) => run(fs.readFileSync(path.join(root, file), 'utf8'), mocks, globals);
const settle = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
const browser = { setTimeout, clearTimeout };
const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service' };

function meFixture(options = {}) {
  const calls = [];
  const worker = Object.hasOwn(options, 'worker') ? options.worker : { id: 'worker', user_id: 'verified-user', role: 'admin', is_active: true };
  const api = load('src/app/api/me/route.ts', {
    'next/server': { NextResponse: Response },
    '@supabase/supabase-js': { createClient(url, key) { calls.push(['client', key]); return { auth: { async getUser(token) {
      calls.push(['verify', token]);
      if (options.throws) throw options.throws;
      return { data: { user: options.error ? null : { id: 'verified-user', email: 'fixture@example.invalid' } }, error: options.error || null };
    } } }; } },
    '@/lib/server/worker-cache': { async getWorkerByUserIdCached(client, uid) { calls.push(['worker', uid]); if (options.workerError) throw options.workerError; return worker; } },
  }, { process: { env } });
  return { calls, async request(token = 'untrusted-token') {
    const response = await api.GET(new Request('https://panel.invalid/api/me', { headers: token ? { Authorization: `Bearer ${token}` } : {} }));
    return { response, body: await response.json() };
  } };
}

test('/api/me verifies bearer with Auth before resolving linked staff', async () => {
  const denied = meFixture({ error: { code: 'bad_jwt', status: 401, message: 'private-details' } });
  const result = await denied.request('fabricated-admin-jwt');
  assert.equal(result.response.status, 401);
  assert.deepEqual(result.body, { ok: false, error: 'INVALID_SESSION' });
  assert.equal(denied.calls.some(call => call[0] === 'worker'), false);
  const valid = meFixture();
  const accepted = await valid.request();
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.body.role, 'admin');
  assert.deepEqual(valid.calls.filter(call => ['verify', 'worker'].includes(call[0])), [['verify', 'untrusted-token'], ['worker', 'verified-user']]);
  assert.match(accepted.response.headers.get('cache-control'), /no-store/);
});

test('temporary Auth/database failures remain 503 and do not masquerade as an invalid session', async () => {
  for (const options of [{ error: { status: 503, message: 'private-details' } }, { throws: Error('private-details') }, { workerError: Error('private-details') }]) {
    const result = await meFixture(options).request();
    assert.equal(result.response.status, 503);
    assert.deepEqual(result.body, { ok: false, error: 'ACCESS_SERVICE_UNAVAILABLE' });
    assert.match(result.response.headers.get('cache-control'), /no-store/);
  }
});

test('absent auth, disabled staff and forbidden roles still deny access', async () => {
  const noAuth = meFixture();
  assert.equal((await noAuth.request('')).response.status, 401);
  assert.equal(noAuth.calls.length, 0);
  for (const [worker, error] of [[null, 'NO_WORKER'], [{ id: 'worker', role: 'admin', is_active: false }, 'WORKER_DISABLED'], [{ id: 'worker', role: 'cliente' }, 'INVALID_ROLE']]) {
    const result = await meFixture({ worker }).request();
    assert.equal(result.response.status, 403); assert.equal(result.body.error, error);
  }
});

function accessFixture(response = { ok: true, role: 'admin' }, status = 200) {
  const calls = [];
  const access = load('src/lib/panel-access.ts', {}, { window: browser, fetch: async (url, init) => { calls.push([url, init]); return Response.json(response, { status }); } });
  return { ...access, calls };
}
const sessionClient = (session, error = null) => ({ auth: { getSession: async () => ({ data: { session }, error }) } });

test('panel gate treats outage as retryable, actual revoked/disabled access as rejection', async () => {
  for (const [status, error, rejected] of [[503, 'ACCESS_SERVICE_UNAVAILABLE', false], [401, 'INVALID_SESSION', true], [403, 'WORKER_DISABLED', true], [403, 'INVALID_ROLE', true]]) {
    const f = accessFixture({ ok: false, error }, status);
    await assert.rejects(f.loadPanelIdentity(sessionClient({ access_token: 'fixture' })), err => f.panelSessionRejected(err) === rejected);
    assert.equal(f.calls[0][0], '/api/me');
    assert.equal(f.calls[0][1].headers.Authorization, 'Bearer fixture');
  }
  const f = accessFixture();
  await assert.rejects(f.loadPanelIdentity(sessionClient(null, { status: 503 })), err => !f.panelSessionRejected(err));
  await assert.rejects(f.loadPanelIdentity(sessionClient(null)), err => f.panelSessionRejected(err));
  assert.equal(f.calls.length, 0);
});

function effectSource(file, marker) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  (function visit(node) { if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes(marker)) effect = node.arguments[0].getText(ast); ts.forEachChild(node, visit); })(ast);
  assert.ok(effect, `Real effect containing ${marker}`);
  return effect;
}
const adminGate = effectSource('src/app/admin/page.tsx', 'loadPanelIdentity(sb)');

test('admin stays locked with a retry message during service failure, then enters after retry', async () => {
  const access = accessFixture({ ok: false, error: 'ACCESS_SERVICE_UNAVAILABLE' }, 503);
  let failure;
  try { await access.loadPanelIdentityFromToken('fixture'); } catch (e) { failure = e; }
  const state = { ok: false, error: null }, redirects = [];
  let unavailable = true;
  const gate = run(`exports.effect = ${adminGate}`, {}, {
    sb: {}, Error, loadPanelIdentity: async () => { if (unavailable) throw failure; return { role: 'admin' }; },
    panelSessionRejected: access.panelSessionRejected, panelPathForRole: access.panelPathForRole,
    redirectToLogin: reason => redirects.push(reason), window: { location: { replace: url => redirects.push(url) } },
    setAccessError: value => { state.error = value; }, setOk: value => { state.ok = value; },
  });
  gate.effect(); await settle();
  assert.equal(state.ok, false); assert.match(state.error, /Tu sesión se conserva/); assert.deepEqual(redirects, []);
  unavailable = false; gate.effect(); await settle();
  assert.equal(state.ok, true); assert.equal(state.error, null); assert.deepEqual(redirects, []);
});

test('admin gate respects verified role and ignores a completed check after unmount', async () => {
  const access = accessFixture(), redirects = [], approved = [];
  let complete;
  const gate = run(`exports.effect = ${adminGate}`, {}, {
    sb: {}, loadPanelIdentity: () => new Promise(resolve => { complete = resolve; }),
    panelSessionRejected: access.panelSessionRejected, panelPathForRole: access.panelPathForRole,
    redirectToLogin: reason => redirects.push(reason), window: { location: { replace: url => redirects.push(url) } },
    setAccessError() {}, setOk: value => approved.push(value),
  });
  gate.effect(); complete({ role: 'central' }); await settle();
  assert.deepEqual(redirects, ['/panel-central']); assert.deepEqual(approved, []);
  const dispose = gate.effect(); dispose(); complete({ role: 'admin' }); await settle();
  assert.deepEqual(approved, []);
});

test('admin background requests do not kick a session out during a failed refresh', async () => {
  const source = fs.readFileSync(path.join(root, 'src/app/admin/page.tsx'), 'utf8');
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  (function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'getTokenOrLogin') handler = node.getText(ast); ts.forEachChild(node, visit); })(ast);
  assert.ok(handler);
  const window = { location: { href: '/admin' } };
  const f = run(`${handler}\nexports.getToken = getTokenOrLogin;`, {}, { sb: sessionClient(null, { status: 503 }), window });
  await assert.rejects(f.getToken(), /No se pudo comprobar la sesión/);
  assert.equal(window.location.href, '/admin');
  const missing = run(`${handler}\nexports.getToken = getTokenOrLogin;`, {}, { sb: sessionClient(null), window });
  assert.equal(await missing.getToken(), '');
  assert.equal(window.location.href, '/login');
});

test('header ignores initial empty notifications but still redirects an actual sign-out', async () => {
  let notify, removed = false;
  const window = { location: { href: '/admin' } };
  const fixture = run(`exports.effect = ${effectSource('src/components/AppHeader.tsx', 'onAuthStateChange')}`, {}, {
    sb: { auth: { onAuthStateChange(fn) { notify = fn; return { data: { subscription: { unsubscribe() { removed = true; } } } }; }, getSession: async () => ({ data: { session: null } }) } }, window,
  });
  const dispose = fixture.effect(); await settle();
  notify('INITIAL_SESSION', null); notify('TOKEN_REFRESHED', null);
  assert.equal(window.location.href, '/admin');
  notify('SIGNED_OUT', null); assert.equal(window.location.href, '/login');
  dispose(); assert.equal(removed, true);
});

function browserFixture({ expiresIn = 30, error = { status: 503 }, hold = false } = {}) {
  const session = { access_token: 'previous-valid-token', refresh_token: 'refresh', expires_at: Date.now() / 1000 + expiresIn };
  const current = { data: { session }, error: null };
  let calls = 0, complete;
  const lib = load('src/lib/supabase-browser.ts', {
    '@supabase/supabase-js': { createClient: () => ({ auth: {
      getSession: async () => current, getUser: async () => ({ data: { user: null }, error: null }),
      refreshSession: async () => { calls++; if (hold) return new Promise(resolve => { complete = resolve; }); return { data: { session: null }, error }; },
    } }) },
  }, { process: { env } });
  return { client: lib.supabaseBrowser(), current, get calls() { return calls; }, complete: value => complete(value) };
}

test('proactive temporary refresh failure preserves an unexpired session, never an expired or revoked one', async () => {
  for (const error of [{ status: 503 }, { status: 429 }, { name: 'AuthRetryableFetchError', status: 0 }]) {
    const f = browserFixture({ error }); assert.equal((await f.client.auth.getSession()).data.session.access_token, 'previous-valid-token');
  }
  for (const options of [{ expiresIn: -1 }, { error: { status: 400, code: 'refresh_token_not_found' } }]) {
    const f = browserFixture(options); assert.equal((await f.client.auth.getSession()).data.session, null);
  }
});

test('parallel callers share a single proactive refresh and receive its new session', async () => {
  const f = browserFixture({ hold: true });
  const a = f.client.auth.getSession(), b = f.client.auth.getSession(); await settle();
  assert.equal(f.calls, 1);
  f.complete({ data: { session: { access_token: 'refreshed' } }, error: null });
  assert.equal((await a).data.session.access_token, 'refreshed'); assert.equal((await b).data.session.access_token, 'refreshed');
});

async function loginFixture({ sessionError = false, role = 'admin' } = {}) {
  const React = require('react'), renderer = require('react-test-renderer');
  const calls = [], redirects = [];
  let finish;
  const Login = load('src/app/login/page.tsx', {
    'next/image': { __esModule: true, default: props => React.createElement('img', props) },
    '@/lib/supabase-browser': { supabaseBrowser: () => ({ auth: { setSession(tokens) { calls.push(plain(tokens)); return new Promise(resolve => { finish = () => resolve({ data: { session: sessionError ? null : tokens }, error: sessionError ? { status: 503 } : null }); }); } } }) },
    '@/lib/panel-access': { panelPathForRole: role => `/${role}` },
  }, {
    window: { ...browser, sessionStorage: { removeItem() {} }, localStorage: { setItem() { throw Error('Direct session write must not occur'); } }, location: { replace: url => redirects.push(url) } },
    fetch: async () => Response.json({ ok: true, role, session: { access_token: 'access', refresh_token: 'refresh' } }),
  }).default;
  let view;
  await renderer.act(async () => { view = renderer.create(React.createElement(Login)); });
  await renderer.act(async () => { for (const input of view.root.findAllByType('input')) input.props.onChange({ target: { value: input.props.type === 'email' ? 'fixture@example.invalid' : 'fixture-password' } }); });
  await renderer.act(async () => { view.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  return { view, calls, redirects, async finish() { await renderer.act(async () => { finish(); }); }, async dispose() { await renderer.act(async () => { view.unmount(); }); } };
}

test('login waits for SDK persistence before navigating, preventing the session hydration race', async () => {
  const f = await loginFixture();
  assert.deepEqual(f.calls, [{ access_token: 'access', refresh_token: 'refresh' }]); assert.deepEqual(f.redirects, []);
  await f.finish(); assert.deepEqual(f.redirects, ['/admin']); await f.dispose();
});

test('failed session persistence stays on login with an actionable error; invalid roles never install a session', async () => {
  const f = await loginFixture({ sessionError: true }); await f.finish();
  assert.deepEqual(f.redirects, []);
  assert.match(f.view.root.findByProps({ className: 'tc-login-error' }).children.join(''), /No se pudo confirmar la sesión/);
  await f.dispose();
  const invalid = await loginFixture({ role: 'cliente' }); assert.deepEqual(invalid.calls, []); assert.deepEqual(invalid.redirects, []); await invalid.dispose();
});

test('real SDK installs a session through the fixed same-origin user verifier when direct browser Auth is blocked', async () => {
  const { createClient } = require('@supabase/supabase-js');
  const user = { id: 'verified-user', aud: 'authenticated', email: 'fixture@example.invalid', created_at: '2026-10-23T00:00:00Z', app_metadata: {}, user_metadata: {} };
  const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`;
  const serverCalls = [], browserCalls = [];
  const route = load('src/app/api/auth/user/route.ts', { 'next/server': { NextResponse: Response }, '@supabase/supabase-js': { createClient } }, {
    process: { env }, fetch: async (url, init) => {
      serverCalls.push([String(url), init]);
      assert.equal(new URL(url).origin, env.NEXT_PUBLIC_SUPABASE_URL);
      assert.equal(new URL(url).pathname, '/auth/v1/user');
      assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${token}`);
      return Response.json(user);
    },
  });
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const lib = load('src/lib/supabase-browser.ts', { '@supabase/supabase-js': { createClient } }, {
    process: { env }, window: {}, fetch: async (url, init) => {
      browserCalls.push([String(url), init]);
      if (url !== '/api/auth/user') throw new TypeError('Direct browser Supabase access blocked');
      assert.equal(new Headers(init.headers).get('apikey'), null);
      assert.equal(init.cache, 'no-store');
      await barrier;
      return route.GET(new Request(`https://panel.invalid${url}`, init));
    },
  });
  const client = lib.supabaseBrowser();
  let finished = false;
  const pending = client.auth.setSession({ access_token: token, refresh_token: 'fixture-refresh' }).then(result => { finished = true; return result; });
  await settle(); assert.equal(finished, false); assert.equal(browserCalls.length, 1);
  release();
  const result = await pending;
  assert.equal(result.error, null); assert.equal(result.data.user.id, user.id);
  assert.equal((await client.auth.getSession()).data.session.access_token, token);
  assert.equal(serverCalls.length, 1);
  await client.auth.stopAutoRefresh();
});

test('same-origin verifier rejects unauthenticated and invalid tokens without trusting supplied user or target URL', async () => {
  let calls = 0;
  const route = load('src/app/api/auth/user/route.ts', {
    'next/server': { NextResponse: Response },
    '@supabase/supabase-js': { createClient: () => ({ auth: { async getUser(token) { calls++; assert.equal(token, 'forged'); return { data: { user: null }, error: { status: 401, code: 'bad_jwt', message: 'private-auth-details' } }; } } }) },
  }, { process: { env } });
  const missing = await route.GET(new Request('https://panel.invalid/api/auth/user?url=https://foreign.invalid&user=admin'));
  assert.equal(missing.status, 401); assert.equal(calls, 0);
  const invalid = await route.GET(new Request('https://panel.invalid/api/auth/user?user=admin', { headers: { Authorization: 'Bearer forged' } }));
  assert.equal(invalid.status, 401); assert.deepEqual(await invalid.json(), { error_code: 'bad_jwt', message: 'Invalid session' });
  assert.match(invalid.headers.get('cache-control'), /no-store/);
});

test('browser adapter delegates only GET user verification for the configured project and preserves cancellation', async () => {
  let adapter;
  const calls = [];
  const lib = load('src/lib/supabase-browser.ts', {
    '@supabase/supabase-js': { createClient(url, key, config) { adapter = config.global.fetch; return { auth: { getSession: async () => ({ data: { session: null }, error: null }), getUser: async () => ({ data: { user: null }, error: null }) } }; } },
  }, { process: { env }, window: {}, fetch: async (url, init) => { calls.push([url, init]); if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError'); return Response.json({}); } });
  lib.supabaseBrowser();
  for (const [url, method] of [[`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`, 'POST'], ['https://foreign.invalid/auth/v1/user', 'GET'], [`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/workers`, 'GET']]) {
    await adapter(url, { method }); assert.equal(calls.at(-1)[0], url);
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(adapter(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls.at(-1)[0], '/api/auth/user');
});
