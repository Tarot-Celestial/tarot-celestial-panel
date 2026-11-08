const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture(options = {}) {
  const actor = { id: id(1), role: 'central', can_admin: options.supervisor === true };
  const rows = options.rows || [], queries = [], writes = [], gates = [];
  class Query {
    constructor(table) { this.table = table; this.filters = []; queries.push(this); }
    select(columns) { this.columns = columns; return this; }
    or(value) { const terms = value.split(',').map(s => s.split('.eq.')); this.filters.push(r => terms.some(([k, v]) => r[k] === v)); return this; }
    eq(key, value) { this.filters.push(r => r[key] === value); return this; }
    in(key, values) { this.filters.push(r => values.includes(r[key])); return this; }
    gt(key, value) { this.filters.push(r => r[key] > value); return this; }
    order() { return this; } limit() { return this; }
    async maybeSingle() { return { data: (this.table === 'workers' ? [{ id: id(2), role: 'tarotista', is_active: true }] : rows).find(r => this.filters.every(f => f(r))) || null, error: null }; }
  }
  const db = { from: table => new Query(table), rpc: async (name, args) => { writes.push({ name, args }); return { data: options.rpcResult || row(), error: options.rpcError ? { message: options.rpcError } : null }; } };
  const dependencies = {
    'node:crypto': require('node:crypto'),
    'next/server': { NextResponse: { json: (value, init) => new Response(JSON.stringify(value), init) } },
    '@/lib/server/staff-chat': {
      getStaffChatActor: async req => { if (!req.headers.get('Authorization') || options.noAuth) throw new Error('NO_AUTH'); return { db, me: actor }; },
      requireStaffChatConnection: async () => { gates.push('connection'); if (options.offline) throw new Error('PANEL_CONNECTION_REQUIRED'); },
      requireStaffChatUuid: value => { if (!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value)) throw new Error('INVALID_UUID'); return value; },
      requireStaffChatThread: async (_db, me, thread) => { if (thread !== id(10) && !me.can_admin) throw new Error('FORBIDDEN'); return { id: thread, central_worker_id: id(1), tarotist_worker_id: id(2) }; },
      loadStaffChatPresence: async () => ({ states: new Map(options.targetOffline ? [] : [[id(2), { presence_expires_at: new Date(Date.now() + 60000).toISOString() }]]) }),
      staffChatError: error => ({ code: error.message, status: error.message === 'NO_AUTH' ? 401 : error.message === 'FORBIDDEN' ? 403 : error.message === 'PANEL_CONNECTION_REQUIRED' ? 423 : error.message.startsWith('INVALID_') ? 400 : 500 }),
    },
  };
  dependencies['./staff-chat'] = dependencies['@/lib/server/staff-chat'];
  const load = file => { const exports = {}; vm.runInNewContext(compile(file), { exports, require: key => { if (!(key in dependencies)) throw new Error(`Unexpected require ${key}`); return dependencies[key]; }, URL, Date, process: { env: options.env || {} }, console }); return exports; };
  const helper = load('src/lib/server/staff-panel-calls.ts');
  dependencies['@/lib/server/staff-panel-calls'] = helper;
  return { ...load('src/app/api/chat/calls/route.ts'), helper, actor, writes, queries, gates };
}
function row(extra = {}) { return { id: id(100), thread_id: id(10), caller_worker_id: id(1), callee_worker_id: id(2), caller_name: 'Central ficticia', callee_name: 'Tarotista ficticia', caller_tab_id: id(31), callee_tab_id: null, status: 'ringing', created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 75000).toISOString(), offer_sdp: sdp, answer_sdp: null, ...extra }; }
function request(query = '', body) { return new Request(`https://fixture.invalid/api/chat/calls${query}`, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
const action = (name = 'start', extra = {}) => ({ action: name, call_id: id(100), tab_id: id(31), expected_actor_id: id(1), thread_id: id(10), target_worker_id: id(2), sdp, ...extra });

test('signaling is restricted to actual call participants, even delegated supervisors', async () => {
  const own = row(), foreign = row({ id: id(101), caller_worker_id: id(3), callee_worker_id: id(4) });
  const h = fixture({ rows: [foreign, own], supervisor: true });
  const response = await h.GET(request()), result = await response.json();
  assert.equal(result.call.id, own.id); assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Vary'), 'Authorization');
  assert.equal((await (await h.GET(request(`?call_id=${foreign.id}`))).json()).call, null);
});

test('expired signaling is never returned and polling does not start attendance', async () => {
  const h = fixture({ rows: [row({ expires_at: new Date(Date.now() - 1).toISOString() })] });
  assert.equal((await (await h.GET(request())).json()).call, null);
  const expired = (await (await h.GET(request(`?call_id=${id(100)}`))).json()).call;
  assert.equal(expired.status, 'missed'); assert.equal(expired.offer_sdp, null); assert.equal(expired.answer_sdp, null);
  assert.equal(h.writes.length, 0);
});

test('calls and ICE config require verified connected account', async () => {
  for (const options of [{ noAuth: true }, { offline: true }]) {
    const h = fixture(options);
    assert.equal((await h.GET(request('?config=1'))).status, options.noAuth ? 401 : 423);
    assert.equal((await h.POST(request('', action()))).status, options.noAuth ? 401 : 423);
    assert.equal(h.writes.length, 0);
  }
});

test('mutations require current actor, valid audio and contact membership/presence', async () => {
  for (const [extra, status] of [[{ expected_actor_id: id(9) }, 409], [{ sdp: `${sdp}m=video 9 RTP/AVP 96\n` }, 400], [{ sdp: 'x'.repeat(48001) }, 400], [{ target_worker_id: id(8) }, 403]]) {
    const h = fixture(); assert.equal((await h.POST(request('', action('start', extra)))).status, status); assert.equal(h.writes.length, 0);
  }
  const h = fixture({ targetOffline: true });
  assert.equal((await h.POST(request('', action()))).status, 409); assert.equal(h.writes.length, 0);
});

test('delegated supervisor keeps own identity and SQL handles ownership with stable call id', async () => {
  const h = fixture({ supervisor: true }); const result = await h.POST(request('', action('start', { thread_id: id(11) })));
  assert.equal(result.status, 200); assert.equal(h.writes[0].name, 'staff_panel_call_action');
  assert.equal(h.writes[0].args.p_actor_id, id(1)); assert.equal(h.writes[0].args.p_call_id, id(100));
  assert.equal(h.writes[0].args.p_target_id, id(2)); assert.equal(h.gates.length, 1);
});

test('ending/rejecting remains possible after attendance expires while heartbeat is rejected', async () => {
  const h = fixture({ offline: true });
  for (const name of ['end', 'reject']) assert.equal((await h.POST(request('', action(name)))).status, 200);
  assert.equal((await h.POST(request('', action('heartbeat')))).status, 423);
  assert.equal(h.writes.length, 2);
});

test('TURN uses short-lived derived credentials; server secret never leaves response', async () => {
  const noRelay = fixture().helper.staffCallIceConfig(id(1)); assert.equal(noRelay.relayConfigured, false); assert.equal(noRelay.iceServers.length, 1);
  const h = fixture({ env: { STAFF_CALL_TURN_URLS: 'turn:relay.example.invalid:3478, https://invalid.example.invalid', STAFF_CALL_TURN_SECRET: 'fake-test-secret-only' } });
  const result = await (await h.GET(request('?config=1'))).json();
  assert.equal(result.relayConfigured, true); assert.equal(result.iceServers.length, 2);
  const relay = result.iceServers[1], expiry = Number(relay.username.split(':')[0]);
  assert.ok(expiry > Date.now() / 1000 + 3500 && expiry <= Date.now() / 1000 + 3601);
  assert.deepEqual(relay.urls, ['turn:relay.example.invalid:3478']);
  assert.equal(JSON.stringify(result).includes('fake-test-secret-only'), false);
  assert.equal(relay.credential, require('node:crypto').createHmac('sha1', 'fake-test-secret-only').update(relay.username).digest('base64'));
});
