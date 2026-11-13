// Simulated Auth/database contract checks. No live credentials or production writes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const next = { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } };
function load(file, imports) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => imports[name], Response, URL, console: { error() {} } });
  return exports;
}
function fixture(options = {}) {
  const calls = [], reads = [];
  const worker = { id: id(1), user_id: id(2), role: 'central', is_active: true, ...options.worker };
  const rows = options.rows || [];
  const db = {
    auth: { async getUser(token) {
      calls.push(['auth', token]);
      return { data: { user: token === 'valid' ? { id: id(2) } : null }, error: null };
    } },
    async rpc(name, params) { calls.push(['rpc', name, params]); return { error: options.rpcError || null }; },
    from(table) {
      const data = table === 'workers' ? [worker] : table === 'crm_clientes' ? rows
        : table === 'crm_etiquetas' ? [{ id: id(50), nombre: 'Noviembre 2026' }]
        : table === 'crm_cliente_etiquetas' ? rows.map((r, i) => ({ id: id(1000 + i), cliente_id: r.id, etiqueta_id: id(50) })) : [];
      let start = 0, end = Infinity;
      const predicates = [], orders = [], comparisons = [];
      const query = {
        select() { return query; }, order(key, options = {}) { orders.push([key, options.ascending !== false]); return query; }, lte() { return query; }, or() { return query; },
        ilike(key, value) { predicates.push(r => String(r[key]).toLowerCase() === value.toLowerCase()); return query; },
        eq(key, value) { predicates.push(r => r[key] === value); return query; },
        gt(key, value) { comparisons.push([key, value]); predicates.push(r => r[key] > value); return query; },
        in(key, values) {
          predicates.push(r => key === 'crm_cliente_etiquetas.etiqueta_id' ? values.includes(id(50)) : values.includes(r[key]));
          return query;
        },
        range(a, b) { start = a; end = b; return query; },
        async maybeSingle() { return { data: data.find(r => predicates.every(p => p(r))) || null, error: null }; },
        then(resolve, reject) {
          reads.push({ table, start, end, orders, comparisons });
          const selected = data.filter(r => predicates.every(p => p(r))).sort((a, b) => {
            for (const [key, asc] of orders) {
              const comparison = String(a[key] || '').localeCompare(String(b[key] || ''));
              if (comparison) return asc ? comparison : -comparison;
            }
            return 0;
          });
          return Promise.resolve({ data: selected.slice(start, end + 1), error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const access = load('src/lib/server/central-workspace-access.ts', {
    'next/server': next, '@/lib/server/auth-worker': { getAdminClient: () => db },
  });
  const imports = {
    'next/server': next, '@/lib/server/central-workspace-access': access,
    '@/lib/server/client-ranks': { calcClientRank: () => 'plata', loadRolling30ClientTotals: async () => new Map() },
    '@/lib/server/client-rank-effective': { normalizeClientRank: value => value },
  };
  const update = load('src/app/api/crm/clientes/etiquetas/update/route.ts', imports);
  const search = load('src/app/api/crm/clientes/buscar/route.ts', imports);
  return {
    calls, reads,
    post: (body = { cliente_id: id(10), etiquetas: [id(50)] }, token = 'valid') => update.POST(new Request('https://fixture.invalid/tags', {
      method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body),
    })),
    get: (query = '') => search.GET(new Request('https://fixture.invalid/search?' + query, { headers: { Authorization: 'Bearer valid' } })),
  };
}

test('tag writes require verified active Central/Admin before a privileged RPC', async () => {
  for (const [options, token, status] of [[{}, null, 401], [{}, 'forged', 401], [{ worker: { is_active: false } }, 'valid', 403], [{ worker: { role: 'tarotista' } }, 'valid', 403]]) {
    const f = fixture(options), response = await f.post(undefined, token);
    assert.equal(response.status, status);
    assert.equal(f.calls.some(c => c[0] === 'rpc'), false);
  }
  for (const role of ['central', 'admin']) {
    const f = fixture({ worker: { role } }), response = await f.post({ cliente_id: id(10), etiquetas: [id(50), id(50)] });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls[1])), ['rpc', 'tc_crm_replace_client_tags', { p_cliente_id: id(10), p_etiquetas: [id(50)] }]);
    assert.match(response.headers.get('cache-control'), /private.*no-store/);
  }
});

test('invalid tags never start a transaction and RPC failures are not reported as saved', async () => {
  for (const body of [{ cliente_id: 'invalid', etiquetas: [] }, { cliente_id: id(10) }, { cliente_id: id(10), etiquetas: ['bad'] }, { cliente_id: id(10), etiquetas: [null] }]) {
    const f = fixture(); assert.equal((await f.post(body)).status, 400); assert.equal(f.calls.some(c => c[0] === 'rpc'), false);
  }
  const f = fixture({ rpcError: { code: 'XX000', message: 'private database information' } });
  const response = await f.post(), body = await response.json();
  assert.equal(response.status, 500); assert.equal(body.ok, false); assert.doesNotMatch(body.error, /private database/);
});

test('November search exposes every one of 124 clients across explicit pages', async () => {
  const rows = Array.from({ length: 124 }, (_, n) => ({ id: id(n + 100), nombre: `Cliente ${n}`, origen: 'manual', minutos_free_pendientes: n, minutos_normales_pendientes: 4 }));
  const f = fixture({ rows });
  const first = await (await f.get('etiqueta=Noviembre%202026')).json();
  const second = await (await f.get('etiqueta=Noviembre%202026&cursor=' + first.next_cursor)).json();
  assert.equal(first.clientes.length, 120); assert.equal(first.next_cursor, id(219)); assert.equal(first.has_more, true);
  assert.equal(second.clientes.length, 4); assert.equal(second.next_cursor, null); assert.equal(second.has_more, false);
  assert.equal(new Set([...first.clientes, ...second.clientes].map(r => r.id)).size, 124);
  assert.equal(second.clientes[3].minutos_free_pendientes, 123);
});

test('an empty filtered page does not hide later matches and the joined month filter reaches past 1000 clients', async () => {
  const rows = Array.from({ length: 1005 }, (_, n) => ({ id: id(n + 100), nombre: `Cliente ${n}`, origen: n < 120 ? 'orion' : 'manual' }));
  const f = fixture({ rows });
  const first = await (await f.get('etiqueta=Noviembre%202026')).json();
  assert.equal(first.clientes.length, 0); assert.equal(first.next_cursor, id(219));
  const last = await (await f.get('etiqueta=Noviembre%202026&cursor=' + id(1059))).json();
  assert.equal(last.clientes.length, 45); assert.equal(last.has_more, false);
  assert.ok(f.reads.some(r => r.table === 'crm_clientes' && r.comparisons.some(([key, value]) => key === 'id' && value === id(1059))));
});

test('concurrent activity and a removed earlier client do not skip or duplicate subsequent pages', async () => {
  const rows = Array.from({ length: 124 }, (_, n) => ({ id: id(n + 100), nombre: `Cliente ${n}`, origen: 'manual', updated_at: '2026-11-12T10:00:00Z' }));
  const f = fixture({ rows });
  const first = await (await f.get('etiqueta=Noviembre%202026')).json();
  rows[120].updated_at = '2026-11-13T23:00:00Z';
  rows[0].updated_at = '2026-11-13T22:00:00Z';
  rows.splice(1, 1);
  const second = await (await f.get('etiqueta=Noviembre%202026&cursor=' + first.next_cursor)).json();
  assert.deepEqual(second.clientes.map(row => row.id), [id(220), id(221), id(222), id(223)]);
  assert.equal(new Set([...first.clientes, ...second.clientes].map(row => row.id)).size, 124);
  assert.ok(f.reads.filter(r => r.table === 'crm_clientes').every(r => JSON.stringify(r.orders) === JSON.stringify([['id', true]])));
});

test('malformed page cursors are rejected before client queries', async () => {
  const f = fixture();
  assert.equal((await f.get('cursor=not-a-uuid')).status, 400);
  assert.equal(f.reads.some(r => r.table === 'crm_clientes'), false);
});

test('logging in updates access metrics without creating or replacing activity-month labels', async () => {
  const writes = [];
  const platform = load('src/lib/server/cliente-platform.ts', { crypto: require('node:crypto'), '@/lib/customer-benefits': {} });
  const db = { from(table) {
    assert.equal(table, 'crm_clientes');
    return {
      select() { return { eq() { return { maybeSingle: async () => ({ data: { total_accesos: 4 } }) }; } }; },
      update(patch) { writes.push(patch); return { eq: async () => ({ error: null }) }; },
    };
  } };
  await platform.touchClientActivity(db, id(10), { access: true });
  assert.equal(writes.length, 1); assert.equal(writes[0].total_accesos, 5); assert.ok(writes[0].ultimo_acceso_at);
  assert.equal('etiquetas' in writes[0], false);
});
