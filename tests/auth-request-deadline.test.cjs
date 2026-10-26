const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');

const origin = 'https://deadline-fixture.supabase.co';
const storageKey = 'sb-deadline-fixture-auth-token';
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };

function loadBrowser(create, fetch) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/supabase-browser.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Request, Response, Headers, URL, AbortController, Error, Date, setTimeout, clearTimeout,
    window: {}, fetch,
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: origin, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon' } },
    require(name) { assert.equal(name, '@supabase/supabase-js'); return { createClient: create }; },
  });
  return exports;
}

function adapterFixture(fetch) {
  let adapter;
  const browser = loadBrowser((url, key, config) => {
    adapter = config.global.fetch;
    return { auth: { getSession: async () => ({ data: { session: null }, error: null }), getUser: async () => ({ data: { user: null }, error: null }) } };
  }, fetch);
  browser.supabaseBrowser();
  return adapter;
}

function pendingFetch(attempts) {
  return (url, init) => new Promise((resolve, reject) => {
    const attempt = { url, signal: init.signal, resolve };
    attempts.push(attempt);
    const abort = () => reject(new DOMException('The fixture request was aborted', 'AbortError'));
    if (init.signal.aborted) abort();
    else init.signal.addEventListener('abort', abort, { once: true });
  });
}

test('token requests really abort at their deadline, retaining the caller body and headers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const calls = [], adapter = adapterFixture(pendingFetch(calls));
  const controller = new AbortController();
  const input = new Request(`${origin}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { apikey: 'fixture-key' }, body: '{"refresh_token":"fixture"}', signal: controller.signal,
  });
  const completion = adapter(input).then(() => null, error => error);
  await settle();
  assert.equal(calls[0].url, input);
  assert.equal(calls[0].signal.aborted, false);
  t.mock.timers.tick(9_999); await settle();
  assert.equal(calls[0].signal.aborted, false);
  t.mock.timers.tick(1); await settle();
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(controller.signal.aborted, false);
  assert.equal((await completion).name, 'AbortError');
});

test('caller cancellation aborts Auth immediately, including an already cancelled request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  for (const alreadyAborted of [false, true]) {
    const calls = [], adapter = adapterFixture(pendingFetch(calls));
    const controller = new AbortController();
    if (alreadyAborted) controller.abort();
    const completion = adapter(`${origin}/auth/v1/token`, { method: 'POST', signal: controller.signal }).then(() => null, error => error);
    if (!alreadyAborted) controller.abort();
    assert.equal((await completion).name, 'AbortError');
    assert.equal(calls[0].signal.aborted, true);
  }
});

test('an Auth body stalled after headers remains covered by the deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let signal;
  const adapter = adapterFixture(async (url, init) => {
    signal = init.signal;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"access_token":'));
      signal.addEventListener('abort', () => controller.error(new DOMException('Body aborted', 'AbortError')), { once: true });
    } }), { headers: { 'Content-Type': 'application/json' } });
  });
  let finished = false;
  const completion = adapter(`${origin}/auth/v1/token`, { method: 'POST' }).then(() => null, error => error).then(result => { finished = true; return result; });
  await settle(); assert.equal(finished, false);
  t.mock.timers.tick(10_000); await settle();
  assert.equal(signal.aborted, true);
  assert.equal((await completion).name, 'AbortError');
});

test('non-Auth and other-origin fetches retain their exact request without a deadline or proxy', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const calls = [];
  const adapter = adapterFixture(async (url, init) => { calls.push({ url, init }); return Response.json({ ok: true }); });
  for (const url of [`${origin}/rest/v1/workers`, `${origin}/storage/v1/object/test`, 'https://foreign.invalid/auth/v1/token']) {
    const init = { method: 'GET', signal: new AbortController().signal };
    await adapter(url, init);
    assert.equal(calls.at(-1).url, url); assert.equal(calls.at(-1).init, init);
  }
  t.mock.timers.tick(50_000);
  assert.ok(calls.every(call => !call.init.signal.aborted));
});

function token(userId, exp) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, aud: 'authenticated', exp })}.fixture`;
}

test('real SDK finishes a stalled initialization refresh, preserves stored session, and cannot overwrite a later login', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-10-26T12:00:00Z') });
  const now = Math.floor(Date.now() / 1000);
  const oldUser = { id: 'old-user', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
  const oldSession = { access_token: token(oldUser.id, now - 60), refresh_token: 'old-fixture-refresh', expires_at: now - 60, expires_in: 3600, token_type: 'bearer', user: oldUser };
  const values = new Map([[storageKey, JSON.stringify(oldSession)]]), attempts = [], events = [];
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  let sdk, allowVerification = false;
  const newUser = { ...oldUser, id: 'new-user' };
  const adapterFetch = pendingFetch(attempts);
  const browser = loadBrowser((url, key, config) => {
    sdk = createClient(url, key, { ...config, auth: { ...config.auth, storage, detectSessionInUrl: false } });
    return sdk;
  }, (url, init) => {
    if (url === '/api/auth/user') {
      assert.equal(allowVerification, true);
      return Promise.resolve(Response.json({ user: newUser }));
    }
    assert.equal(new URL(String(url)).pathname, '/auth/v1/token');
    return adapterFetch(url, init);
  });
  const client = browser.supabaseBrowser();
  client.auth.onAuthStateChange(event => { events.push(event); });
  let initialized = false;
  const initialization = sdk.auth.initializePromise.then(result => { initialized = true; return result; });
  await settle();
  assert.equal(attempts.length, 1); assert.equal(initialized, false);
  const started = Date.now();
  for (let elapsed = 0; !initialized && elapsed < 40_000; elapsed += 1_000) {
    t.mock.timers.tick(1_000); await settle();
  }
  assert.equal(initialized, true, 'SDK refresh must settle within its retry window plus one request deadline');
  await initialization;
  await sdk.auth.stopAutoRefresh();
  assert.ok(Date.now() - started < 40_000);
  assert.ok(attempts.length <= 4 && attempts.every(attempt => attempt.signal.aborted));
  assert.deepEqual(JSON.parse(values.get(storageKey)), oldSession, 'temporary outages must not erase the stored session');
  assert.equal(events.includes('SIGNED_OUT'), false);
  const expired = await client.auth.getSession();
  assert.equal(expired.data.session, null, 'preservation is not authorization of an expired token');
  assert.equal(expired.error?.name, 'AuthRetryableFetchError');

  allowVerification = true;
  const newToken = token(newUser.id, now + 3600);
  const saved = await client.auth.setSession({ access_token: newToken, refresh_token: 'new-fixture-refresh' });
  assert.equal(saved.error, null);
  assert.equal(JSON.parse(values.get(storageKey)).access_token, newToken);
  // Even a late upstream delivery cannot revive an aborted promise and commit
  // the old identity after the new login has been persisted through the SDK.
  for (const attempt of attempts) attempt.resolve(Response.json({ ...oldSession, expires_at: now + 3600 }));
  await settle();
  assert.equal(JSON.parse(values.get(storageKey)).access_token, newToken);
  assert.equal(events.includes('SIGNED_OUT'), false);
  await sdk.auth.stopAutoRefresh();
});
