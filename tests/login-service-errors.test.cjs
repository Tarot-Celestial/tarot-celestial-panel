const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, {
    exports, Request, Response, URL, AbortController, setTimeout, clearTimeout, Error, Date,
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      throw new Error(`Unexpected dependency: ${name}`);
    },
    ...globals,
  }, { filename: file });
  return exports;
}

const credentials = { email: 'fixture@example.invalid', password: 'fixture-password-private' };
const session = { access_token: 'fixture-access-private', refresh_token: 'fixture-refresh-private' };
const plain = value => JSON.parse(JSON.stringify(value));

function harness(options = {}) {
  const logs = [], calls = [], clients = [];
  const authData = Object.hasOwn(options, 'authData') ? options.authData : { user: { id: 'auth-worker' }, session };
  const worker = Object.hasOwn(options, 'worker') ? options.worker : { id: 'worker', role: 'central', is_active: true };
  const mockCreateClient = (url, key, config) => {
    clients.push({ key, config });
    return {
      auth: { async signInWithPassword(input) {
        calls.push(['signIn', plain(input)]);
        if (options.authHttpStatus) await config.global.fetch(`${url}/auth/v1/token`);
        if (options.authThrows) throw options.authThrows;
        return { data: authData, error: options.authError || null };
      } },
      from(table) {
        calls.push(['table', table]);
        return { select(columns) { calls.push(['select', columns]); return { eq(column, value) {
          calls.push(['eq', column, value]);
          return { async maybeSingle() {
            if (options.workerHttpStatus) await config.global.fetch(`${url}/rest/v1/workers`);
            return { data: worker, error: options.workerError || null };
          } };
        } }; } };
      },
    };
  };
  const route = load('src/app/api/auth/login/route.ts', {
    'next/server': { NextResponse: Response },
    '@supabase/supabase-js': { createClient: options.realSdk ? require('@supabase/supabase-js').createClient : mockCreateClient },
  }, {
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service' } },
    console: { log: entry => logs.push(JSON.parse(entry)), error: entry => logs.push(JSON.parse(entry)) },
    fetch: async (url, init) => {
      const pathname = new URL(String(url)).pathname;
      calls.push(['fetch', pathname]);
      if (options.fetchResponse) return options.fetchResponse(pathname, init);
      return new Response('{}', { status: pathname.startsWith('/rest/') ? options.workerHttpStatus : options.authHttpStatus });
    },
  });
  return {
    logs, calls, clients,
    async run(body = credentials) {
      const response = await route.POST(new Request('https://panel.example.invalid/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-vercel-id': 'fixture-request' }, body: JSON.stringify(body),
      }));
      return { response, body: await response.json() };
    },
  };
}

test('gateway 402 becomes a service restriction, with safe diagnostics and no worker lookup or session', async () => {
  const upstreamMessage = `Restricted: exceed_egress_quota ${credentials.email} ${credentials.password} ${session.access_token}`;
  const h = harness({ authError: { status: 402, message: upstreamMessage } });
  const { response, body } = await h.run();
  assert.equal(response.status, 402);
  assert.deepEqual(body, { ok: false, error: 'AUTH_SERVICE_RESTRICTED' });
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(h.calls.some(([kind]) => kind === 'table'), false);
  assert.deepEqual(h.logs.at(-1), {
    level: 'error', message: 'login_failed', route: '/api/auth/login', requestId: 'fixture-request',
    stage: 'authentication', error: 'AUTH_SERVICE_RESTRICTED', upstreamStatus: 402, upstreamCode: null,
    durationMs: h.logs.at(-1).durationMs,
  });
  for (const sensitive of [upstreamMessage, credentials.email, credentials.password, session.access_token, session.refresh_token]) {
    assert.equal(JSON.stringify(h.logs).includes(sensitive), false);
  }
});

test('real Supabase SDK preserves gateway 402 classification for both JSON and HTML error bodies', async () => {
  for (const contentType of ['application/json', 'text/html']) {
    const h = harness({ realSdk: true, fetchResponse: async pathname => {
      assert.equal(pathname, '/auth/v1/token');
      return new Response(contentType === 'application/json' ? JSON.stringify({ message: 'Restricted fixture' }) : '<html>Restricted fixture</html>', { status: 402, headers: { 'Content-Type': contentType } });
    } });
    const result = await h.run();
    assert.equal(result.response.status, 402);
    assert.equal(result.body.error, 'AUTH_SERVICE_RESTRICTED');
    assert.equal(result.body.session, undefined);
    assert.equal(h.logs.at(-1).upstreamStatus, 402);
  }
});

test('429 remains a rate limit and never claims the password was wrong', async () => {
  const h = harness({ authError: { status: 429, code: 'over_request_rate_limit', message: 'Too many requests' } });
  const result = await h.run();
  assert.equal(result.response.status, 429);
  assert.equal(result.body.error, 'AUTH_RATE_LIMITED');
  assert.equal(h.logs.at(-1).upstreamCode, 'over_request_rate_limit');
  assert.equal(h.calls.some(([kind]) => kind === 'table'), false);
});

test('only the actual invalid_credentials Auth code gives the credential error', async () => {
  const invalid = harness({ realSdk: true, fetchResponse: async () => new Response(JSON.stringify({ error_code: 'invalid_credentials', message: 'Invalid login credentials' }), { status: 400, headers: { 'Content-Type': 'application/json' } }) });
  const rejected = await invalid.run();
  assert.equal(rejected.response.status, 401);
  assert.equal(rejected.body.error, 'INVALID_CREDENTIALS');
  assert.equal(invalid.logs.at(-1).upstreamCode, 'invalid_credentials');
  for (const error of [
    { status: 401, message: 'Invalid API key' },
    { status: 400, message: 'Invalid login credentials' },
    { status: 400, code: 'email_provider_disabled', message: 'Provider disabled' },
    { status: 400, code: '__proto__' },
    { status: 400, code: 'constructor' },
    { status: 503, code: 'invalid_credentials' },
  ]) {
    const result = await harness({ authError: error }).run();
    assert.equal(result.response.status, 503);
    assert.equal(result.body.error, 'AUTH_SERVICE_UNAVAILABLE');
  }
});

test('specific Auth account and verification errors have safe public codes', async () => {
  for (const [code, expected] of [
    ['email_not_confirmed', 'AUTH_EMAIL_NOT_CONFIRMED'],
    ['user_banned', 'AUTH_ACCOUNT_BLOCKED'],
    ['captcha_failed', 'AUTH_CAPTCHA_FAILED'],
  ]) {
    const h = harness({ authError: { status: 400, code, message: credentials.email } });
    const result = await h.run();
    assert.equal(result.response.status, 403);
    assert.deepEqual(result.body, { ok: false, error: expected });
    assert.equal(JSON.stringify(h.logs).includes(credentials.email), false);
  }
});

test('timeouts retain their classification and incomplete successful Auth responses are service failures', async () => {
  const timeout = new Error(`fetch failed ${session.refresh_token}`);
  timeout.name = 'SupabaseTimeoutError';
  const h = harness({ authThrows: timeout });
  const result = await h.run();
  assert.equal(result.response.status, 503);
  assert.equal(result.body.error, 'SUPABASE_TIMEOUT');
  assert.equal(JSON.stringify(h.logs).includes(session.refresh_token), false);
  for (const data of [{}, { user: { id: 'auth-worker' } }, { session }]) {
    const partial = await harness({ authData: data }).run();
    assert.equal(partial.response.status, 503);
    assert.deepEqual(partial.body, { ok: false, error: 'AUTH_SERVICE_UNAVAILABLE' });
  }
});

test('restriction in worker lookup does not release the already issued Auth session', async () => {
  const h = harness({ workerHttpStatus: 402, workerError: { code: '', message: `Gateway ${session.access_token}` } });
  const result = await h.run();
  assert.equal(result.response.status, 402);
  assert.deepEqual(result.body, { ok: false, error: 'AUTH_SERVICE_RESTRICTED' });
  assert.equal(h.logs.at(-1).stage, 'worker_lookup');
  assert.equal(h.logs.at(-1).upstreamStatus, 402);
  assert.equal(JSON.stringify(h.logs).includes(session.access_token), false);
});

test('successful authentication still requires the linked, active worker and an allowed role', async () => {
  for (const [worker, expected] of [
    [null, 'NO_WORKER'],
    [{ id: 'worker', role: 'central', is_active: false }, 'WORKER_DISABLED'],
    [{ id: 'worker', role: 'cliente', is_active: true }, 'INVALID_ROLE'],
  ]) {
    const h = harness({ worker });
    const result = await h.run();
    assert.equal(result.response.status, 403);
    assert.deepEqual(result.body, { ok: false, error: expected });
    assert.ok(h.calls.some(call => call[0] === 'eq' && call[1] === 'user_id' && call[2] === 'auth-worker'));
  }
  for (const role of ['admin', 'central', 'tarotista']) {
    const h = harness({ worker: { id: 'worker', role, is_active: true } });
    const result = await h.run({ ...credentials, email: ` ${credentials.email} ` });
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body, { ok: true, role, session });
    assert.deepEqual(h.calls[0], ['signIn', credentials]);
    assert.equal(h.logs.at(-1).message, 'login_completed');
    assert.equal(JSON.stringify(h.logs).includes(session.access_token), false);
  }
});

test('missing credentials do not contact Auth', async () => {
  const h = harness();
  const result = await h.run({ email: credentials.email });
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error, 'MISSING_CREDENTIALS');
  assert.equal(h.clients.length, 0);
});

test('login UI explains restriction and waiting without storing a session or redirecting', async () => {
  const React = require('react'), renderer = require('react-test-renderer');
  const { act } = renderer;
  for (const [error, expected] of [
    ['AUTH_SERVICE_RESTRICTED', /restringido temporalmente.*Contacta con Administración/],
    ['AUTH_RATE_LIMITED', /Espera unos minutos/],
    ['AUTH_EMAIL_NOT_CONFIRMED', /confirmar tu correo/],
    ['AUTH_ACCOUNT_BLOCKED', /acceso bloqueado/],
    ['AUTH_CAPTCHA_FAILED', /verificación de seguridad/],
    ['INVALID_CREDENTIALS', /El email o la contraseña no son correctos/],
  ]) {
    const saved = [], redirects = [];
    const Login = load('src/app/login/page.tsx', {
      'next/image': { __esModule: true, default: props => React.createElement('img', props) },
      '@/lib/supabase-browser': { supabaseBrowserStorageKey: () => 'fixture-session' },
      '@/lib/panel-access': { panelPathForRole: role => `/${role}` },
    }, {
      window: { setTimeout, clearTimeout, localStorage: { setItem: (...args) => saved.push(args) }, location: { replace: url => redirects.push(url) } },
      fetch: async () => ({ ok: false, json: async () => ({ ok: false, error }) }),
    }).default;
    let view;
    await act(async () => { view = renderer.create(React.createElement(Login)); });
    await act(async () => {
      view.root.findAllByType('input').find(input => input.props.type === 'email').props.onChange({ target: { value: credentials.email } });
      view.root.findAllByType('input').find(input => input.props.type === 'password').props.onChange({ target: { value: credentials.password } });
    });
    await act(async () => { view.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    const message = view.root.findByProps({ className: 'tc-login-error' }).children.join('');
    assert.match(message, expected);
    if (error !== 'INVALID_CREDENTIALS') assert.doesNotMatch(message, /email o la contraseña no son correctos|impago|factura pendiente/i);
    assert.equal(saved.length, 0);
    assert.equal(redirects.length, 0);
    await act(async () => { view.unmount(); });
  }
});
