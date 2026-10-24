const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '..');
function load(relative, deps = {}) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const module = { exports: {} };
  vm.runInNewContext(output.outputText, { exports: module.exports, module, require: name => {
    if (Object.hasOwn(deps, name)) return deps[name];
    throw new Error('Unexpected import: ' + name);
  }, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://project.example', SUPABASE_SERVICE_ROLE_KEY: 'test-only' } }, console: { error() {} }, Date });
  return module.exports;
}
const failure = load('src/lib/server/auth-failure.ts');
function gates(options = {}) {
  let authCalls = 0;
  const query = {
    select() { return this; }, eq() { return this; },
    single: async () => options.dbResult || { data: { id: 'client-1' }, error: null },
  };
  const db = { auth: { getUser: async () => {
    authCalls++;
    if (options.throwError) throw options.throwError;
    return { data: { user: options.noUser ? null : { id: 'user-1' } }, error: options.error || null };
  } }, from: () => query };
  const campaign = load('src/lib/server/campaign-auth.ts', {
    'server-only': {}, '@/lib/supabase-admin': { supabaseAdmin: () => db },
    '@/lib/server/auth-failure': failure,
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init.status }) } },
  });
  const roulette = load('src/lib/server/ruleta-access.ts', {
    '@supabase/supabase-js': { createClient: () => db }, '@/lib/server/auth-failure': failure,
  });
  return { campaign, roulette, calls: () => authCalls };
}
const req = new Request('https://panel.example/api', { headers: { authorization: 'Bearer test-token' } });
for (const status of [429, 500, 502, 503, 504, 521, 522, 525]) {
  test(`upstream ${status} stays unavailable, not expired, in both gates`, async () => {
    const { campaign, roulette } = gates({ error: { status } });
    await assert.rejects(campaign.campaignIdentity(req, 'client'), e => e.status === 503 && !/sesión|caducado/.test(e.message));
    await assert.rejects(roulette.verifiedRouletteIdentity(req), e => e.status === 503 && !/sesión|caducado/.test(e.message));
  });
}
test('network and SDK retryable failures also fail closed with 503', async () => {
  for (const options of [{ error: { name: 'AuthRetryableFetchError' } }, { throwError: new TypeError('fetch failed') }]) {
    const { campaign, roulette } = gates(options);
    await assert.rejects(campaign.campaignIdentity(req, 'client'), e => e.status === 503);
    await assert.rejects(roulette.verifiedRouletteIdentity(req), e => e.status === 503);
  }
});
test('explicit invalid sessions still produce 401', async () => {
  for (const error of [{ status: 401 }, { status: 403 }, { status: 400, code: 'bad_jwt' }, { code: 'session_not_found' }]) {
    const { campaign, roulette } = gates({ error });
    await assert.rejects(campaign.campaignIdentity(req, 'client'), e => e.status === 401);
    await assert.rejects(roulette.verifiedRouletteIdentity(req), e => e.status === 401);
  }
});
test('missing bearer is rejected without calling Auth', async () => {
  const { campaign, roulette, calls } = gates();
  const missing = new Request('https://panel.example/api');
  await assert.rejects(campaign.campaignIdentity(missing, 'client'), e => e.status === 401);
  await assert.rejects(roulette.verifiedRouletteIdentity(missing), e => e.status === 401);
  assert.equal(calls(), 0);
});
test('verified user and linked client retain original identity', async () => {
  const { campaign, roulette, calls } = gates();
  const client = await campaign.campaignIdentity(req, 'client');
  assert.equal(client.uid, 'user-1'); assert.equal(client.clientId, 'client-1');
  assert.equal((await roulette.verifiedRouletteIdentity(req)).user.id, 'user-1');
  assert.equal(calls(), 2);
});
test('database unavailability is not a false missing customer profile', async () => {
  const databaseError = { code: 'PGRST002', message: 'schema cache unavailable' };
  const { campaign } = gates({ dbResult: { data: null, error: databaseError } });
  await assert.rejects(campaign.campaignIdentity(req, 'client'), e => e === databaseError);
});
test('absent CRM link and empty Auth user remain denied', async () => {
  const { campaign } = gates({ dbResult: { data: null, error: { code: 'PGRST116' } } });
  await assert.rejects(campaign.campaignIdentity(req, 'client'), e => e.status === 403);
  const other = gates({ noUser: true });
  await assert.rejects(other.campaign.campaignIdentity(req, 'client'), e => e.status === 401);
  await assert.rejects(other.roulette.verifiedRouletteIdentity(req), e => e.status === 401);
});
test('campaign response preserves transient 503 without returning upstream internals', () => {
  const { campaign } = gates();
  const response = campaign.campaignResponseError(new campaign.CampaignError('Servicio temporalmente ocupado.', 503));
  assert.equal(response.status, 503); assert.equal(response.body.error, 'Servicio temporalmente ocupado.');
});
test('client notifications route delivers the temporary failure as HTTP 503', async () => {
  const { campaign } = gates({ error: { status: 525 } });
  const route = load('src/app/api/cliente/notificaciones/route.ts', {
    '@/lib/server/campaign-auth': campaign,
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } },
  });
  const response = await route.GET(req);
  assert.equal(response.status, 503); assert.equal(response.body.ok, false);
  assert.doesNotMatch(response.body.error, /525|sesión|caducado/);
});
test('CRM daily route propagates service failure while retaining invalid-session rejection', async () => {
  for (const [upstream, expected] of [[522, 503], [401, 401]]) {
    const { roulette } = gates({ error: { status: upstream } });
    const route = load('src/app/api/crm/diario/listar/route.ts', {
      '@/lib/server/ruleta-access': roulette,
      '@supabase/supabase-js': {},
      '@/lib/server/brand-filter': {},
      '@/lib/server/economic-payments': {},
      '@/lib/server/madrid-reporting-period': {},
      'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200, headers: new Headers() }) } },
    });
    const response = await route.GET(req);
    assert.equal(response.status, expected); assert.equal(response.body.ok, false);
  }
});
