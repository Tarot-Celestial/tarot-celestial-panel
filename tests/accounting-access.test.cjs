const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const { NextResponse } = require('next/server');

const actor = '00000000-0000-4000-8000-000000000001';
const authSession = '00000000-0000-4000-8000-000000000002';
const token = 'e'.repeat(64);
const salt = 'a'.repeat(32);
const password = 'test-only-random-passphrase';
const encoded = `scrypt$${salt}$${crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 }).toString('hex')}`;
const bearer = id => `header.${Buffer.from(JSON.stringify({ session_id: id })).toString('base64url')}.signature`;

function request({ method = 'GET', origin = 'https://example.test', body, cookie = token, session = authSession, headers = {} } = {}) {
  const h = { Authorization: `Bearer ${bearer(session)}`, ...headers };
  if (method !== 'GET') h['Content-Type'] = 'application/json';
  if (origin !== undefined && origin !== null) h.Origin = origin;
  if (cookie) h.Cookie = `tc_accounting_session=${cookie}`;
  return new Request('https://example.test/api/admin/contabilidad/session', {
    method, headers: h, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}

function load({ allowed = true, env = {}, rpc = async () => ({ data: null, error: null }) } = {}) {
  const processMock = { env: { NODE_ENV: 'production', ACCOUNTING_PASSWORD_HASH: encoded, ...env } };
  const calls = [];
  const admin = { rpc: async (name, args) => { calls.push({ name, args }); return rpc(name, args); } };
  const mocks = {
    'server-only': {}, 'next/server': { NextResponse },
    '@/lib/admin/require-admin': { requireAdmin: async () => allowed ? { ok: true, authUserId: actor, me: { user_id: actor }, admin } : { ok: false, error: 'FORBIDDEN' } },
  };
  function file(name) {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, { exports, require: name => name in mocks ? mocks[name] : require(name), process: processMock,
      Buffer, URL, Date, Request, TextDecoder, Uint8Array, console });
    return exports;
  }
  const access = file('src/lib/server/accounting-access.ts');
  mocks['@/lib/server/accounting-access'] = access;
  const route = file('src/app/api/admin/contabilidad/session/route.ts');
  return { access, route, calls, env: processMock.env };
}

test('password verification is server-only, bounded, timing-safe and fails closed without a valid configured hash', async () => {
  const { access, env } = load();
  assert.equal(access.accountingPasswordConfigured(), true);
  assert.equal(await access.verifyAccountingPassword(password), true);
  assert.equal(await access.verifyAccountingPassword('incorrect'), false);
  assert.equal(await access.verifyAccountingPassword('x'.repeat(257)), false);
  assert.equal(await access.verifyAccountingPassword({}), false);
  env.ACCOUNTING_PASSWORD_HASH = 'malformed';
  assert.equal(access.accountingPasswordConfigured(), false);
  assert.equal(await access.verifyAccountingPassword(password), false);
});

test('untrusted origins and content types are rejected before credential verification or database calls', async () => {
  const { access, route, calls } = load();
  for (const origin of [null, 'null', 'https://evil.test', 'https://child.example.test']) {
    assert.equal((await route.POST(request({ method: 'POST', origin, body: { password } }))).status, 403);
  }
  const plain = request({ method: 'POST', body: { password } });
  plain.headers.set('Content-Type', 'text/plain');
  assert.equal(access.accountingWriteGuard(plain).status, 415);
  const site = request({ method: 'POST', body: { password }, headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(access.accountingWriteGuard(site).status, 403);
  assert.equal(calls.length, 0);
});

test('every data access checks fresh admin authorization before reading the secondary session', async () => {
  const { access, calls } = load({ allowed: false });
  const result = await access.requireAccountingAccess(request());
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 403);
  assert.equal(calls.length, 0);
});

test('module session is bound to verified auth identity, auth session, password version and expiry', async () => {
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  const { access, calls } = load({ rpc: async () => ({ data: { valid: true, expires_at: expiresAt }, error: null }) });
  const gate = await access.requireAccountingAccess(request());
  assert.equal(gate.ok, true);
  assert.equal(calls[0].args.p_actor, actor);
  assert.equal(calls[0].args.p_auth_session_id, authSession);
  assert.equal(calls[0].args.p_token_hash, crypto.createHash('sha256').update(token).digest('hex'));
  assert.equal(calls[0].args.p_password_version, crypto.createHash('sha256').update(encoded).digest('hex'));
  assert.notEqual(calls[0].args.p_token_hash, token);
  const missing = await access.requireAccountingAccess(request({ cookie: null }));
  assert.equal(missing.response.status, 423);
  const invalidSession = await access.requireAccountingAccess(request({ session: 'forged-invalid-session' }));
  assert.equal(invalidSession.response.status, 423);
});

test('expired, revoked or unavailable sessions never unlock data', async () => {
  for (const data of [null, { valid: false }, { valid: true, expires_at: new Date(0).toISOString() }, { valid: true, expires_at: 'bad' }]) {
    const { access } = load({ rpc: async () => ({ data, error: null }) });
    assert.equal((await access.requireAccountingAccess(request())).response.status, 423);
  }
  const { access } = load({ rpc: async () => ({ data: null, error: { message: 'database unavailable' } }) });
  assert.equal((await access.requireAccountingAccess(request())).response.status, 503);
});

test('unlock reserves an atomic login attempt before checking password; rate limit survives app instances', async () => {
  const { route, calls } = load({ rpc: async () => ({ data: { allowed: false, retry_after: 300 }, error: null }) });
  const reply = await route.POST(request({ method: 'POST', body: { password } }));
  assert.equal(reply.status, 429);
  assert.equal(reply.headers.get('Retry-After'), '300');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'tc_accounting_reserve_login_attempt');
  assert.equal(reply.headers.get('set-cookie'), null);
});

test('incorrect password cannot open a session and is never echoed', async () => {
  const { route, calls } = load({ rpc: async () => ({ data: { allowed: true }, error: null }) });
  const reply = await route.POST(request({ method: 'POST', body: { password: 'incorrect-sensitive-value' } }));
  assert.equal(reply.status, 403);
  assert.equal(calls.length, 1);
  assert.ok(!(await reply.text()).includes('incorrect-sensitive-value'));
  assert.equal(reply.headers.get('set-cookie'), null);
});

test('successful unlock persists only token hash and issues secure one-hour HttpOnly same-site cookie', async () => {
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  const { route, calls } = load({ rpc: async name => ({ data: name.endsWith('reserve_login_attempt') ? { allowed: true } : { expires_at: expiresAt }, error: null }) });
  const reply = await route.POST(request({ method: 'POST', body: { password } }));
  assert.equal(reply.status, 200);
  const data = await reply.json();
  assert.equal(data.unlocked, true);
  assert.equal(data.expiresAt, expiresAt);
  const cookie = reply.headers.get('set-cookie');
  for (const expected of ['HttpOnly', 'Secure', 'SameSite=strict', 'Max-Age=3600', 'Path=/api/admin/contabilidad']) assert.ok(cookie.includes(expected));
  const plainToken = cookie.match(/tc_accounting_session=([a-f0-9]+)/)[1];
  assert.equal(plainToken.length, 64);
  assert.equal(calls[1].args.p_token_hash, crypto.createHash('sha256').update(plainToken).digest('hex'));
  assert.ok(!JSON.stringify(calls).includes(password));
  assert.ok(reply.headers.get('Cache-Control').includes('no-store'));
});

test('revoked underlying Auth session cannot unlock and clears stale accounting cookie', async () => {
  const { route, calls } = load({ rpc: async name => name.endsWith('reserve_login_attempt')
    ? { data: { allowed: true }, error: null }
    : { data: null, error: { message: 'AUTH_SESSION_REVOKED' } } });
  const reply = await route.POST(request({ method: 'POST', body: { password } }));
  assert.equal(reply.status, 401);
  assert.equal((await reply.json()).code, 'NO_AUTH');
  assert.equal(calls.length, 2);
  assert.ok(reply.headers.get('set-cookie').includes('Max-Age=0'));
});

test('lock revokes server session before clearing the cookie; status returns no financial information', async () => {
  const { route, calls } = load({ rpc: async () => ({ data: true, error: null }) });
  const reply = await route.DELETE(request({ method: 'DELETE', body: {} }));
  assert.equal(reply.status, 200);
  assert.equal(calls[0].name, 'tc_accounting_close_session');
  assert.equal(calls[0].args.p_actor, actor);
  assert.ok(reply.headers.get('set-cookie').includes('Max-Age=0'));
  const status = await route.GET(request({ cookie: null }));
  assert.deepEqual(await status.json(), { ok: true, configured: true, unlocked: false });
});

test('missing server configuration and oversized unlock bodies fail closed', async () => {
  const missing = load({ env: { ACCOUNTING_PASSWORD_HASH: '' } });
  assert.equal((await missing.route.POST(request({ method: 'POST', body: { password } }))).status, 503);
  assert.deepEqual(await (await missing.route.GET(request())).json(), { ok: true, configured: false, unlocked: false });
  const { route, calls } = load();
  assert.equal((await route.POST(request({ method: 'POST', body: 'x'.repeat(2049) }))).status, 400);
  assert.equal(calls.length, 0);
});
