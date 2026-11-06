const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, mocks) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.test', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture', SUPABASE_SERVICE_ROLE_KEY: 'fixture' } }, console, Request, Response, URL,
    require(name) { if (name in mocks) return mocks[name]; if (name.startsWith('@/lib/')) return load('src/' + name.slice(2) + '.ts', mocks); throw Error('Unexpected import ' + name); } });
  return exports;
}
function fixture() {
  const h = { valid: true, unavailable: false, grant: true, active: true, role: 'central', uid: 'verified-user', workerUid: 'verified-user', reads: [], rpcCalls: [], authCalls: 0, writes: 0 };
  const worker = () => ({ id: 'original-maria-worker', user_id: h.workerUid, email: 'maria@fixture.test', role: h.role, is_active: h.active, display_name: 'Maria', team: 'agua' });
  const db = {
    auth: { async getUser() { h.authCalls++; return { data: { user: h.valid ? { id: h.uid, email: 'maria@fixture.test' } : null }, error: h.unavailable ? { status: 503 } : h.valid ? null : { status: 401 } }; } },
    async rpc(name, args) {
      h.rpcCalls.push({ name, args });
      assert.equal(name, 'tc_has_admin_access');
      return { data: args.p_user_id === h.uid && h.workerUid === h.uid && h.active && (h.role === 'admin' || h.grant), error: null };
    },
    from(table) {
      const filters = [];
      const query = { select() { return this; }, eq(k, v) { filters.push([k, v]); return this; }, order() { return this; },
        maybeSingle() { return this; },
        then(resolve, reject) { h.reads.push({ table, filters }); return Promise.resolve({ data: table === 'workers' ? (filters.every(([k, v]) => worker()[k] === v) ? worker() : null) : [], error: null }).then(resolve, reject); } };
      return query;
    },
  };
  const mocks = { '@supabase/supabase-js': { createClient: () => db } };
  const access = load('src/lib/server/admin-access.ts', mocks);
  mocks['@/lib/server/admin-access'] = access;
  const requireAdmin = load('src/lib/admin/require-admin.ts', mocks).requireAdmin;
  return { h, db, access, requireAdmin, mocks };
}
const request = (token = 'verified-token') => new Request('https://fixture.test/api/admin/checklists/templates', { headers: token ? { authorization: 'Bearer ' + token } : {} });

test('delegated access keeps the original Central identity and team', async () => {
  const { requireAdmin, h } = fixture();
  const result = await requireAdmin(request());
  assert.equal(result.ok, true);
  assert.equal(result.me.role, 'central');
  assert.equal(result.me.id, 'original-maria-worker');
  assert.equal(result.me.team, 'agua');
  assert.equal(result.authUserId, 'verified-user');
  assert.equal(h.rpcCalls.length, 1);
  assert.equal(h.rpcCalls[0].name, 'tc_has_admin_access');
  assert.equal(h.rpcCalls[0].args.p_user_id, 'verified-user');
  assert.equal(h.writes, 0);
});

test('regular administrators retain all admin access without a delegated grant', async () => {
  const { h, requireAdmin } = fixture(); h.role = 'admin'; h.grant = false;
  assert.equal((await requireAdmin(request())).ok, true);
});

test('shared staff identity verifies Auth and adds permission without changing Central identity', async () => {
  const { h, mocks } = fixture();
  const { workerFromRequest } = load('src/lib/server/auth-worker.ts', mocks);
  const worker = await workerFromRequest(request());
  assert.equal(worker.role, 'central'); assert.equal(worker.id, 'original-maria-worker');
  assert.equal(worker.can_admin, true); assert.equal(h.authCalls, 1);
  h.grant = false;
  assert.equal((await workerFromRequest(request())).can_admin, false);
  h.valid = false; const reads = h.reads.length;
  assert.equal(await workerFromRequest(request()), null); assert.equal(h.reads.length, reads);
  h.unavailable = true;
  await assert.rejects(workerFromRequest(request()));
});

test('other Central workers, revoked/inactive workers, and email-only links fail closed', async () => {
  for (const change of [{ grant: false }, { active: false }, { workerUid: 'another-auth-user' }, { valid: false }]) {
    const { h, requireAdmin } = fixture(); Object.assign(h, change);
    assert.equal((await requireAdmin(request())).ok, false, JSON.stringify(change));
    assert.equal(h.writes, 0);
  }
});

test('legacy request guard verifies Auth before looking up administrative capabilities', async () => {
  const { h, access } = fixture(); h.valid = false;
  assert.equal(await access.requestHasAdminAccess(request('forged-jwt-with-admin-sub')), false);
  assert.equal(h.authCalls, 1);
  assert.equal(h.rpcCalls.length, 0);
  assert.equal(await access.requestHasAdminAccess(request('')), false);
});

test('request deduplication never caches a grant into later requests', async () => {
  const { h, access } = fixture(); const req = request();
  const checks = await Promise.all([access.requestHasAdminAccess(req), access.requestHasAdminAccess(req)]);
  assert.equal(checks.every(Boolean), true); assert.equal(h.authCalls, 1);
  h.grant = false;
  assert.equal(await access.requestHasAdminAccess(request()), false); assert.equal(h.authCalls, 2);
});

test('Auth or capability source outage does not grant admin access', async () => {
  const { h, db, access } = fixture(); h.unavailable = true;
  await assert.rejects(access.requestHasAdminAccess(request()));
  h.unavailable = false; db.rpc = async () => ({ data: true, error: new Error('database down') });
  await assert.rejects(access.requestHasAdminAccess(request()));
});

test('an old admin-only endpoint accepts delegated Central and rejects other Central', async () => {
  for (const grant of [true, false]) {
    const { h, mocks } = fixture(); h.grant = grant;
    mocks['next/server'] = { NextResponse: { json: (body, init) => Response.json(body, init) } };
    mocks['@/lib/server/auth-fast'] = { getAuthUserFromRequest: () => ({ data: { user: { id: h.uid } } }) };
    const route = load('src/app/api/admin/checklists/templates/route.ts', mocks);
    assert.equal((await route.GET(request())).status, grant ? 200 : 403);
    assert.equal(h.authCalls, 1);
    if (!grant) assert.equal(h.reads.some(read => read.table !== 'workers'), false);
  }
});
