const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function harness() {
  const h = { role: 'central', active: true, calls: [], error: null };
  const db = {
    auth: { getUser: async token => ({ data: { user: token === 'valid' ? { id: id(1) } : null }, error: null }) },
    from: () => ({ select: () => ({ eq: async () => ({ data: [{ role: h.role, is_active: h.active }], error: null }) }) }),
    rpc: async (name, args) => { h.calls.push({ name, args }); return { data: { managed: 3 }, error: h.error }; },
  };
  const cache = {};
  function load(file) {
    if (cache[file]) return cache[file];
    const exports = {}; cache[file] = exports;
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, URL, console: { error() {} }, require: name => {
      if (name === 'next/server') return { NextResponse: { json: (body, options) => new Response(JSON.stringify(body), options) } };
      if (name === '@/lib/server/auth-worker') return { getAdminClient: () => db };
      if (name === '@/lib/server/recovery-access') return load('src/lib/server/recovery-access.ts');
      throw Error(name);
    } }); return exports;
  }
  h.mission = load('src/app/api/central/recovery-mission/route.ts');
  h.recovery = load('src/app/api/central/client-recovery/route.ts');
  h.req = (query = '', body, token = 'valid') => new Request('https://example.test/api' + query, {
    method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }); return h;
}
test('verified active central only; browser-supplied worker/user cannot change identity', async () => {
  const h = harness();
  assert.equal((await h.mission.GET(h.req('', null, 'forged.jwt.payload'))).status, 401);
  h.role = 'cliente'; assert.equal((await h.mission.GET(h.req())).status, 403);
  h.role = 'central'; h.active = false; assert.equal((await h.mission.GET(h.req())).status, 403);
  assert.equal(h.calls.length, 0);
  h.active = true;
  const response = await h.mission.POST(h.req('', { action: 'prepare', user_id: id(9), worker_id: id(9) }));
  assert.equal(response.status, 200); assert.equal(h.calls[0].args.p_user, id(1));
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});
test('GET does not assign; preparation requires explicit POST and admin overview is restricted', async () => {
  const h = harness();
  await h.mission.GET(h.req()); assert.equal(h.calls[0].args.p_assign, false);
  assert.equal((await h.mission.POST(h.req('', { action: 'unknown' }))).status, 400);
  await h.mission.POST(h.req('', { action: 'prepare' })); assert.equal(h.calls[1].args.p_assign, true);
  assert.equal((await h.mission.GET(h.req('?overview=1'))).status, 403);
  h.role = 'admin'; await h.mission.GET(h.req('?overview=1'));
  assert.equal(h.calls[2].name, 'tc_recovery_mission_overview');
});
test('mission filtering is delegated before pagination and errors never pretend zero progress', async () => {
  const h = harness(); await h.recovery.GET(h.req('?mission=1&page=2'));
  assert.equal(h.calls[0].name, 'tc_recovery_mission_list'); assert.equal(h.calls[0].args.p_page, 2);
  h.error = { code: '42883' }; const response = await h.mission.GET(h.req());
  assert.equal(response.status, 503); assert.equal((await response.json()).mission, undefined);
});
test('audited management requires channel and stable request ID; forwards authenticated user only', async () => {
  const h = harness(), body = { client_id: id(2), action: 'contacted', version: 0 };
  assert.equal((await h.recovery.POST(h.req('', body))).status, 400); assert.equal(h.calls.length, 0);
  const response = await h.recovery.POST(h.req('', { ...body, channel: 'phone', request_id: id(3), user_id: id(9) }));
  assert.equal(response.status, 200); assert.equal(h.calls[0].name, 'tc_recovery_act_v2');
  assert.equal(h.calls[0].args.p_user, id(1)); assert.equal(h.calls[0].args.p_channel, 'phone');
  assert.equal(h.calls[0].args.p_request_id, id(3));
});
