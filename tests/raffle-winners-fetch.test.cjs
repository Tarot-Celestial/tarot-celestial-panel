const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');

test('real Supabase client bypasses a stale upstream raffle cache and returns all winners', async () => {
  const calls = [];
  const published = Array.from({ length: 31 }, (_, i) => ({ position: i + 1, prize_name: `Prize ${i + 1}`, winning_number: i + 10, selection_method: 'roulette', is_test: false }));
  const upstream = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, cache: init.cache });
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'fixture-user' });
    // Models Next's previously cached empty response. Fresh reads see published data.
    if (init.cache !== 'no-store') return Response.json([]);
    assert.equal(new Headers(init.headers).get('apikey'), 'sb_secret_fixture');
    if (url.pathname === '/rest/v1/raffles') return Response.json([{ id: 'fixture-raffle' }]);
    assert.equal(url.pathname, '/rest/v1/raffle_public_winners');
    assert.equal(url.searchParams.get('raffle_id'), 'eq.fixture-raffle');
    return Response.json(published);
  };
  const env = name => name === 'NEXT_PUBLIC_SUPABASE_URL' ? 'https://fixture.supabase.co' : 'sb_secret_fixture';
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/app/api/cliente/raffle/winners/route.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, fetch: upstream, console,
    require(name) {
      if (name === 'next/server') return { NextResponse: { json: (body, init) => Response.json(body, init) } };
      if (name === '@supabase/supabase-js') return { createClient };
      if (name === '@/lib/server/auth-worker') return { getEnv: env, getAdminClient: () => createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: upstream } }) };
      throw new Error(name);
    },
  });
  const response = await exports.GET(new Request('https://fixture.test/api/cliente/raffle/winners', { headers: { Authorization: 'Bearer fixture-user-token' } }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.winners.length, 31, 'an upstream stale empty result must not hide confirmed winners');
  assert.ok(calls.every(c => c.cache === 'no-store'), 'auth and data reads must both bypass caches');
  assert.deepEqual(calls.map(c => c.path), ['/auth/v1/user', '/rest/v1/raffles', '/rest/v1/raffle_public_winners']);
});
