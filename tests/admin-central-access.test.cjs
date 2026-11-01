const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function load(file, dependencies) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, Request, Response, URL, Date, File, Buffer, console, require(id) {
    if (id in dependencies) return dependencies[id];
    if (id === 'node:crypto') return require(id);
    throw new Error(`Unexpected import ${id}`);
  } });
  return exports;
}
const next = { NextResponse: { json: (body, init) => Response.json(body, init) } };

function fixture(role = 'admin', active = true, validSession = true) {
  const worker = { id: 'own-worker', user_id: 'verified-user', role, is_active: active, display_name: 'Operator', team: null, salary_base: 0 };
  const calls = [], authTokens = [];
  const db = {
    auth: { async getUser(token) { authTokens.push(token); return validSession ? { data: { user: { id: worker.user_id } } } : { data: { user: null }, error: new Error('Invalid JWT') }; } },
    from(table) {
      const call = { table, filters: [], write: null }; calls.push(call);
      const result = () => ({ data: table === 'workers' ? worker : table === 'outbound_batch_items' ? { id: 'item-1', batch_id: 'batch-1' } : ['central_public_profiles', 'central_review_stats'].includes(table) ? null : [], error: null });
      const query = {
        select() { return this; }, eq(...args) { call.filters.push(args); return this; },
        in(...args) { call.filters.push(args); return this; }, order() { return this; }, limit() { return this; },
        update(value) { call.write = value; return this; }, insert(value) { call.write = value; return this; }, upsert(value) { call.write = value; return this; },
        maybeSingle() { return Promise.resolve(result()); }, single() { return Promise.resolve(result()); },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
      return query;
    },
  };
  const access = load('src/lib/server/central-workspace-access.ts', { 'next/server': next, '@/lib/server/auth-worker': { getAdminClient: () => db } });
  const route = file => load(file, { 'next/server': next, '@/lib/server/central-workspace-access': access,
    '@/lib/server/auth-worker': { getAdminClient: () => db }, '@/lib/month-key': { normalizeMonthKey: key => key } });
  return { calls, authTokens, access, route, worker };
}
const request = (method = 'GET', body, token = 'verified-token') => new Request('https://panel.test/api?month=2026-11', {
  method, headers: token ? { Authorization: `Bearer ${token}`, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) } : {},
  ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
});
const routes = [
  ['my-invoice', 'GET'], ['public-profile', 'GET'], ['public-profile', 'POST'],
  ['outbound/pending', 'GET'], ['outbound/log', 'POST'],
  ['crm/call-close-notifications/latest', 'GET'], ['crm/call-close-notifications/mark-read', 'POST'],
];
function bodyFor(route, method) {
  if (method === 'GET') return undefined;
  if (route === 'public-profile') { const body = new FormData(); body.set('name', 'Operator'); return body; }
  return { id: 'notice-1', item_id: 'item-1', status: 'done', note: 'Fixture only' };
}

for (const role of ['central', 'admin']) test(`${role} can use operational routes under their own verified worker identity`, async () => {
  for (const [leaf, method] of routes) {
    const f = fixture(role);
    const response = await f.route(`src/app/api/central/${leaf}/route.ts`)[method](request(method, bodyFor(leaf, method)));
    assert.equal(response.status, 200, `${leaf}: ${JSON.stringify(await response.clone().json())}`);
    assert.deepEqual(f.authTokens, ['verified-token']);
    assert.deepEqual(f.calls.find(call => call.table === 'workers').filters, [['user_id', 'verified-user']]);
    if (leaf === 'outbound/log') {
      assert.equal(f.calls.find(call => call.table === 'outbound_batch_items' && call.write)?.write.last_called_by_worker_id, f.worker.id);
      assert.equal(f.calls.find(call => call.table === 'outbound_item_logs').write.created_by_worker_id, f.worker.id);
    }
    if (leaf === 'my-invoice') assert.deepEqual(f.calls.find(call => call.table === 'invoices').filters[0], ['worker_id', f.worker.id]);
    if (leaf === 'public-profile' && method === 'POST') assert.equal(f.calls.find(call => call.table === 'central_public_profiles' && call.write).write.worker_id, f.worker.id);
    assert.equal(f.calls.some(call => call.table === 'workers' && call.write), false);
  }
});

for (const [name, role, active, validSession, token, status] of [
  ['missing session', 'admin', true, true, '', 401], ['forged or expired JWT', 'admin', true, false, 'forged-token', 401],
  ['inactive admin', 'admin', false, true, 'verified-token', 403], ['tarotista', 'tarotista', true, true, 'verified-token', 403],
]) test(`${name} cannot read or mutate Central operational data`, async () => {
  for (const [leaf, method] of routes) {
    const f = fixture(role, active, validSession);
    const response = await f.route(`src/app/api/central/${leaf}/route.ts`)[method](request(method, bodyFor(leaf, method), token));
    assert.equal(response.status, status, leaf);
    assert.equal(f.calls.some(call => call.table !== 'workers'), false, leaf);
    if (status === 401) assert.equal(f.calls.length, 0);
  }
});

test('Admin operational shortcuts keep existing paid-chat and campaign destinations separate', () => {
  const nav = load('src/lib/central-workspace-navigation.ts', {});
  for (const [key, tab] of [['central-operativa', 'central'], ['central-primera-tarotista', 'primera-tarotista'], ['central-chat', 'chat'], ['central-sorteo', 'sorteo'], ['central-whatsapp', 'whatsapp']]) {
    assert.equal(nav.adminCentralDestination(key), `/admin/central?tab=${tab}`);
  }
  for (const key of ['chat', 'sorteo', 'whatsapp', 'constructor', '__proto__']) assert.equal(nav.adminCentralDestination(key), null);
  assert.equal(nav.centralWorkspaceDestination('/admin/central', '/panel-central?tab=mis-clientas&cliente=abc'), '/admin/central?tab=mis-clientas&cliente=abc');
  assert.equal(nav.centralWorkspaceDestination('/panel-central', '/panel-central?tab=chat'), '/panel-central?tab=chat');
  for (const target of ['/panel-central-other', '/admin?tab=crm', 'https://external.test/panel-central']) assert.equal(nav.centralWorkspaceDestination('/admin/central', target), target);
});
