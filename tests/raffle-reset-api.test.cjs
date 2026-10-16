const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const clone = value => JSON.parse(JSON.stringify(value));
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/app/api/central/raffle/route.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(options = {}) {
  const calls = [];
  const tables = {
    workers: [{ id: id(101), user_id: id(201), role: 'central', is_active: true, email: 'local@example.test', ...options.worker }],
    raffles: [{ id: id(1), title: 'Anterior', status: 'closed', max_number: 80, updated_at: '2026-10-15T12:00:00Z' }, { id: id(2), title: 'Actual', status: 'active', max_number: 40, updated_at: '2026-10-16T12:00:00Z' }],
    raffle_entries: [{ id: id(301), raffle_id: id(2), raffle_number: 9, client_id: id(401), assigned_at: '2026-10-16T12:00:00Z' }],
    raffle_prizes: [{ id: id(501), raffle_id: id(1), position: 1, name: 'Premio archivado', candidate_number: 7, selected_at: '2026-10-15T12:00:00Z', confirmed_at: '2026-10-15T12:01:00Z' }],
    ...options.tables,
  };
  const admin = {
    auth: { async getUser(token) {
      calls.push({ kind: 'getUser', token });
      return options.authError ? { error: { message: 'Session revoked' }, data: { user: null } }
        : { error: null, data: { user: { id: options.userId || id(201), email: 'local@example.test' } } };
    } },
    async rpc(name, values) {
      calls.push({ kind: 'rpc', name, values: clone(values) });
      return { data: options.rpcData || { raffle: tables.raffles.find(r => r.status === 'active'), already_reset: false }, error: options.rpcError || null };
    },
    from(table) {
      const filters = [], orders = [];
      let single = false, range = null, limit = Infinity, count = false;
      const query = {
        select(_columns, settings = {}) { count = settings.count === 'exact'; return this; },
        eq(column, value) { filters.push([column, value]); return this; },
        order(column, settings) { orders.push([column, settings?.ascending !== false]); return this; },
        range(from, to) { range = [from, to]; return this; },
        limit(value) { limit = value; return this; },
        maybeSingle() { single = true; return this; },
        single() { single = true; return this; },
        insert() { throw new Error('Unexpected table mutation: POST must use the guarded RPC'); },
        then(resolve, reject) {
          calls.push({ kind: 'query', table, filters: clone(filters), range, count });
          let values = (tables[table] || []).filter(row => filters.every(([column, value]) => row[column] === value));
          const total = values.length;
          for (const [column, ascending] of orders.toReversed()) values = values.toSorted((a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1));
          if (range) values = values.slice(range[0], range[1] + 1);
          values = values.slice(0, limit);
          return Promise.resolve({ data: clone(single ? values[0] || null : values), error: null, count: count ? total : null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports, Request, Response, URL, console,
    require(name) {
      if (name === 'next/server') return { NextResponse: { json(body, options = {}) { return new Response(JSON.stringify(body), { ...options, headers: { 'content-type': 'application/json', ...options.headers } }); } } };
      if (name === '@/lib/admin/require-admin') return { getServiceClient() { calls.push({ kind: 'serviceClient' }); return admin; } };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return { api: exports, calls, tables };
}

const request = (body, token = 'verified-test-token') => new Request('https://example.test/api/central/raffle', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
});
const validReset = { action: 'reset', raffle_id: id(1), request_id: id(901), confirmed: true };
const get = suffix => new Request(`https://example.test/api/central/raffle${suffix}`, { headers: { Authorization: 'Bearer verified-test-token' } });

test('missing and revoked tokens are rejected before any database reads or mutations', async () => {
  const missing = fixture();
  assert.equal((await missing.api.POST(request(validReset, ''))).status, 401);
  assert.equal(missing.calls.length, 0);
  const revoked = fixture({ authError: true });
  const response = await revoked.api.POST(request(validReset));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(revoked.calls.map(c => c.kind), ['serviceClient', 'getUser']);
});

test('verified identity must map to an eligible worker; email and submitted actor cannot grant access', async () => {
  for (const options of [{ worker: { is_active: false } }, { worker: { role: 'tarotista' } }, { userId: id(999) }]) {
    const f = fixture(options);
    const response = await f.api.POST(request({ ...validReset, worker_id: id(101), email: 'local@example.test' }));
    assert.equal(response.status, 403);
    assert.equal(f.calls.some(c => c.kind === 'rpc'), false);
    assert.deepEqual(f.calls.find(c => c.kind === 'query').filters, [['user_id', options.userId || id(201)]]);
  }
});

test('explicit raffle id and strict reset confirmation are required before calling the RPC', async () => {
  for (const body of [{ action: 'reset', request_id: id(901), confirmed: true }, { ...validReset, raffle_id: 'invalid' }, { ...validReset, confirmed: 'true' }, { ...validReset, request_id: 'invalid' }, { ...validReset, action: 'delete' }, null, []]) {
    const f = fixture();
    assert.equal((await f.api.POST(request(body))).status, 400);
    assert.equal(f.calls.some(c => c.kind === 'rpc'), false);
    assert.equal(f.calls.some(c => c.kind === 'query' && c.table === 'raffles'), false);
  }
});

test('reset uses the verified worker and the submitted expected raffle, ignoring forged fields', async () => {
  const f = fixture();
  const response = await f.api.POST(request({ ...validReset, worker_id: id(999), max_number: 9999, new_raffle_id: id(999), status: 'active' }));
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls.find(c => c.kind === 'rpc'), { kind: 'rpc', name: 'tc_raffle_manage', values: {
    p_raffle: id(1), p_worker: id(101), p_action: 'reset', p_data: { confirmed: true, request_id: id(901) },
  } });
});

test('retry response returns current entries, including a later active raffle instead of stale reset state', async () => {
  const f = fixture({ rpcData: { raffle: { id: id(777), status: 'closed' }, already_reset: true } });
  const response = await f.api.POST(request(validReset));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.already_reset, true);
  assert.equal(result.restarted_raffle_id, id(777));
  assert.equal(result.raffle.id, id(2));
  assert.deepEqual(result.entries.map(e => e.raffle_number), [9]);
  assert.deepEqual(f.calls.find(c => c.kind === 'query' && c.table === 'raffle_entries').filters, [['raffle_id', id(2)]]);
});

test('stale or provisional RPC failures become conflict responses, not successful local resets', async () => {
  const f = fixture({ rpcError: { code: 'P0001', message: 'El sorteo ya está archivado.' } });
  const response = await f.api.POST(request(validReset));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).ok, false);
  assert.equal(f.calls.some(c => c.kind === 'query' && c.table === 'raffle_entries'), false);
});

test('assign and extend also require their exact raffle id and do not follow a newly active raffle', async () => {
  for (const body of [{ action: 'extend', raffle_id: id(1) }, { action: 'assign', raffle_id: id(1), raffle_number: 8, client_id: id(401) }]) {
    const f = fixture({ rpcData: { max_number: 120 } });
    assert.equal((await f.api.POST(request(body))).status, 200);
    const rpc = f.calls.find(c => c.kind === 'rpc');
    assert.equal(rpc.values.p_raffle, id(1));
    assert.equal(rpc.values.p_worker, id(101));
    assert.equal(f.calls.some(c => c.kind === 'query' && c.table === 'raffles'), false);
  }
});

test('history lists closed raffles only, paginates, and detail remains read-only', async () => {
  const closed = Array.from({ length: 22 }, (_, i) => ({ id: id(1000 + i), title: `Archivo ${i}`, status: 'closed', max_number: 40, updated_at: '2026-10-15T12:00:00Z' }));
  const f = fixture({ tables: { raffles: [...closed, { id: id(2), title: 'Activo', status: 'active' }] } });
  const response = await f.api.GET(get('?history=1'));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.history.length, 20);
  assert.equal(result.hasMore, true);
  assert.ok(result.history.every(r => r.status === 'closed' && r.closed_at === r.updated_at));
  assert.deepEqual(f.calls.find(c => c.kind === 'query' && c.table === 'raffles').filters, [['status', 'closed']]);
  const detail = fixture();
  const historical = await detail.api.GET(get(`?raffle_id=${id(1)}`));
  const historicBody = await historical.json();
  assert.equal(historical.status, 200);
  assert.equal(historicBody.readOnly, true);
  assert.equal(historicBody.prizes[0].name, 'Premio archivado');
  assert.equal((await detail.api.GET(get(`?raffle_id=${id(2)}`))).status, 404);
  assert.equal(detail.calls.some(c => c.kind === 'rpc'), false);
});
