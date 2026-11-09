const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const helperSource = compile('src/lib/server/staff-chat.ts'), routeSource = compile('src/app/api/chat/threads/route.ts');
function fixture(options = {}) {
  const worker = (n, role, active = true, linked = true) => ({ id: id(n), user_id: linked ? id(200 + n) : null, auth_user_id: null, role, is_active: active, display_name: `Persona ficticia ${n}`, team: null, state: 'online' });
  const thread = (n, central, tarotista) => ({ id: id(n), central_worker_id: central === null ? null : id(central), tarotist_worker_id: id(tarotista), status: 'open', created_at: '2026-10-01T00:00:00Z', last_message_at: '2026-10-02T00:00:00Z' });
  const tables = {
    workers: [worker(1, 'central'), worker(2, 'tarotista'), worker(3, 'admin'), worker(4, 'central', false, false), worker(5, 'tarotista', false, false), worker(6, 'tarotista', false), worker(7, 'central'), worker(8, 'cliente'), worker(9, 'admin', false), worker(10, 'tarotista', true, false)],
    chat_threads: [thread(101, 1, 2), thread(102, 1, 5), thread(103, 7, 6), thread(104, 4, 2), thread(105, null, 2), thread(106, null, 2), thread(107, 1, 9), thread(108, 1, 8), thread(109, 7, 5), thread(110, null, 5), thread(111, 1, 10)],
    attendance_panel_sessions: [2, 4, 5, 9].map(n => ({ worker_id: id(n), ended_at: null, expires_at: new Date(Date.now() + 600000).toISOString() })),
    attendance_state: [{ worker_id: id(5), status: 'bathroom' }],
  };
  const reads = [], writes = [], gates = [], rpcCalls = [], auth = [];
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.cap = Infinity; }
    select() { return this; }
    eq(k, value) { this.filters.push(row => row[k] === value); return this; }
    is(k, value) { return this.eq(k, value); }
    in(k, values) { this.filters.push(row => values.includes(row[k])); return this; }
    or(filter) { const terms = filter.split(',').map(term => term.split('.eq.')); this.filters.push(row => terms.some(([key, value]) => row[key] === value)); return this; }
    limit(n) { this.cap = n; return this; }
    order() { return this; }
    insert(value) { writes.push({ table: this.table, value }); return this; }
    async result(single = false) { reads.push(this.table); const data = tables[this.table].filter(row => this.filters.every(f => f(row))).slice(0, this.cap); return { data: single ? data[0] || null : data, error: null }; }
    maybeSingle() { return this.result(true); } single() { return this.result(true); }
    then(resolve, reject) { return this.result().then(resolve, reject); }
  }
  const db = {
    auth: { getUser: async token => { auth.push(token); return options.invalidAuth ? { data: { user: null }, error: { message: 'invalid' } } : { data: { user: { id: id(200 + (options.actor || 1)) } }, error: null }; } },
    from: table => new Query(table),
    rpc: async (name, args) => { rpcCalls.push({ name, args }); return { data: [], error: null }; },
  };
  const dependencies = {
    '@/lib/supabase-admin': { supabaseAdmin: () => db },
    '@/lib/server/admin-access': { hasAdminAccess: async (_db, userId) => userId === id(203) || options.delegated && userId === id(201) },
    '@/lib/server/panel-attendance': { requireActivePanelSession: async () => { gates.push('attendance'); return { ok: true }; } },
    'next/server': { NextResponse: { json: (value, init) => new Response(JSON.stringify(value), init) } },
  };
  const load = source => { const exports = {}; vm.runInNewContext(source, { exports, require: name => { assert.ok(name in dependencies, name); return dependencies[name]; }, Date, Error, URL }); return exports; };
  dependencies['@/lib/server/staff-chat'] = load(helperSource);
  return { ...load(routeSource), tables, reads, writes, gates, rpcCalls, auth };
}
function req(body, authorization = 'Bearer signed-fixture') { return new Request('https://fixture.invalid/api/chat/threads', { method: body ? 'POST' : 'GET', headers: { ...(authorization ? { authorization } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
const overview = async fixture => { const response = await fixture.GET(req()); assert.equal(response.status, 200); return response.json(); };

test('Central can select own inactive historical contacts without exposing unrelated inactive staff', async () => {
  const f = fixture(), body = await overview(f), contacts = new Map(body.contacts.map(c => [c.id, c]));
  assert.ok(contacts.has(id(5)), 'own inactive Tarotista remains reachable');
  assert.ok(contacts.has(id(9)), 'own inactive Admin remains reachable');
  assert.equal(contacts.has(id(6)), false, 'inactive participant of another central is not added');
  assert.equal(contacts.has(id(8)), false, 'unrelated non-staff role is not made a chat contact');
  assert.equal(contacts.has(id(1)), false, 'actor is not their own contact');
  for (const n of [5, 9]) { assert.equal(contacts.get(id(n)).state, 'offline'); assert.equal(contacts.get(id(n)).presence_expires_at, null); }
  assert.deepEqual(body.threads.map(t => t.id).sort(), [101, 102, 107, 108, 111].map(id).sort());
  assert.equal(f.writes.length, 0); assert.equal(f.gates.length, 0, 'reading history never starts a working session');
});

test('Tarotista keeps inactive Central history and distinct legacy histories', async () => {
  const f = fixture({ actor: 2 }), body = await overview(f), contacts = new Map(body.contacts.map(c => [c.id, c]));
  assert.ok(contacts.has(id(4))); assert.equal(contacts.get(id(4)).state, 'offline');
  assert.equal(contacts.has(id(9)), false); assert.equal(contacts.has(id(5)), false);
  assert.deepEqual(body.threads.map(t => t.id).sort(), [101, 104, 105, 106].map(id).sort());
  for (const n of [105, 106]) { const key = `legacy:${id(n)}`; assert.ok(contacts.has(key)); assert.equal(body.contacts.filter(c => c.id === key).length, 1); }
  assert.equal(f.writes.length, 0);
});

test('Admin and delegated Central deduplicate active, inactive and legacy participants while retaining every authorized thread', async () => {
  for (const options of [{ actor: 3 }, { actor: 1, delegated: true }]) {
    const f = fixture(options), body = await overview(f), ids = body.contacts.map(c => c.id);
    assert.equal(body.mode, 'admin'); assert.equal(body.threads.length, f.tables.chat_threads.length);
    assert.equal(ids.length, new Set(ids).size, 'legacy threads do not duplicate the active directory');
    for (const n of [2, 5, 6, 9]) assert.equal(ids.filter(value => value === id(n)).length, 1);
    assert.equal(ids.includes(id(8)), false); assert.equal(ids.includes(id(options.actor)), false);
    assert.equal(body.contacts.find(c => c.id === id(5)).state, 'offline');
  }
});

test('workers without Auth linkage retain authorized past conversations; inactive accounts cannot log in', async () => {
  const f = fixture(), body = await overview(f);
  assert.equal(f.tables.workers.find(w => w.id === id(5)).user_id, null);
  assert.ok(body.contacts.some(c => c.id === id(5)));
  assert.ok(body.contacts.some(c => c.id === id(10)), 'active pre-login contact stays visible as before');
  const noLink = fixture({ actor: 10 }), response = await noLink.GET(req());
  assert.equal(response.status, 403); assert.equal((await response.json()).error, 'NO_WORKER');
  assert.equal(noLink.reads.includes('chat_threads'), false);
});

test('missing or invalid authentication cannot read workers or histories', async () => {
  const missing = fixture(); assert.equal((await missing.GET(req(undefined, null))).status, 401); assert.equal(missing.reads.length, 0); assert.equal(missing.auth.length, 0);
  const invalid = fixture({ invalidAuth: true }); assert.equal((await invalid.GET(req())).status, 401); assert.equal(invalid.reads.length, 0);
});

test('discovering inactive history does not relax new-chat active/role checks', async () => {
  const f = fixture(); await overview(f);
  for (const n of [5, 9]) { const response = await f.POST(req({ contact_worker_id: id(n) })); assert.equal(response.status, 404); assert.equal((await response.json()).error, 'CONTACT_NOT_FOUND'); }
  for (const n of [1, 7, 8]) { const response = await f.POST(req({ contact_worker_id: id(n) })); assert.equal(response.status, 400); assert.equal((await response.json()).error, 'INVALID_CONTACT_ROLE'); }
  assert.equal(f.writes.length, 0);
});
