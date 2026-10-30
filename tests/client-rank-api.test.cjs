const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const id = n => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const clientId = id(1), workerId = id(2), userId = id(3);
const canonical = { total: 56, compras: 4, automatic: 'bronce', effective: 'bronce', override: null };
const override = {
  id: id(9), rank: 'oro', intervention_type: 'temporary',
  starts_at: '2026-10-01T00:00:00Z', ends_at: '2026-11-01T00:00:00Z',
  reason: 'Synthetic override', notes: null,
};
const compiled = new Map();
function load(file, deps) {
  if (!compiled.has(file)) compiled.set(file, ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '..', file), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText);
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled.get(file))(name => {
    if (!(name in deps)) throw Error(`Unexpected dependency ${name}`);
    return deps[name];
  }, mod, mod.exports);
  return mod.exports;
}
const calcClientRank = n => n >= 1000 ? 'diamante' : n >= 500 ? 'oro' : n >= 100 ? 'plata' : n > 0 ? 'bronce' : null;
const rankModule = () => load('src/lib/server/client-rank-effective.ts', {
  '@/lib/server/client-ranks': { calcClientRank },
});

test('canonical reader returns one validated snapshot, including a genuine zero/no-rank state', async () => {
  for (const state of [canonical, { ...canonical, effective: 'oro', override }, { total: 0, compras: 0, automatic: null, effective: null, override: null }]) {
    const calls = [];
    const admin = { async rpc(name, args) { calls.push({ name, args }); return { data: { ...state, config: { ignored: true } }, error: null }; }, from() { throw Error('No independent fallback query allowed'); } };
    assert.deepEqual(await rankModule().loadCanonicalClientRank(admin, clientId), state);
    assert.deepEqual(calls, [{ name: 'tc_client_rank_state', args: { p_cliente_id: clientId } }]);
  }
});

test('RPC failures and incomplete or contradictory snapshots never invent zero, rank or override', async () => {
  const bad = [null, [], {}, { ...canonical, total: null }, { ...canonical, total: '56' },
    { ...canonical, total: -1 }, { ...canonical, total: Infinity }, { ...canonical, compras: 4.5 },
    { ...canonical, automatic: undefined }, { ...canonical, automatic: 'unknown' },
    { ...canonical, effective: 'plata' }, { ...canonical, override: undefined },
    { ...canonical, effective: 'oro', override: { ...override, starts_at: 'invalid' } },
    { ...canonical, effective: 'oro', override: { ...override, notes: undefined } },
    { ...canonical, effective: 'plata', override }];
  for (const data of bad) await assert.rejects(rankModule().loadCanonicalClientRank({ rpc: async () => ({ data, error: null }) }, clientId), /CLIENT_RANK_INVALID_RESPONSE/);
  await assert.rejects(rankModule().loadCanonicalClientRank({ rpc: async () => ({ data: canonical, error: { message: 'private database details' } }) }, clientId), /^Error: CLIENT_RANK_UNAVAILABLE$/);
});

const routes = [
  ['ficha', 'src/app/api/crm/clientes/ficha/route.ts', `?id=${clientId}`],
  ['detail', 'src/app/api/central/my-clients/detail/route.ts', `?id=${clientId}`],
  ['purchases', 'src/app/api/central/my-clients/purchases/route.ts', `?client_id=${clientId}`],
];
function fixture(route, options = {}) {
  const now = new Date().toISOString(), calls = [], reads = [];
  const tables = {
    workers: [{ id: workerId, user_id: userId, role: options.role || 'central', is_active: true, display_name: 'Test central' }],
    crm_clientes: [{ id: clientId, nombre: 'Synthetic client', telefono: null, rango_actual: 'plata', rango_gasto_mes_anterior: 112, rango_compras_mes_anterior: 8, minutos_free_pendientes: 17, minutos_normales_pendientes: 29 }],
    crm_client_capture_assignments: [{ client_id: clientId, responsible_worker_id: options.unassigned ? id(99) : workerId }],
    crm_cliente_pagos: Array.from({ length: 4 }, (_, i) => ({ id: id(20 + i), cliente_id: clientId, source_rendimiento_id: id(30 + i), importe: 14, estado: 'completed', created_at: now })),
    rendimiento_llamadas: Array.from({ length: 4 }, (_, i) => ({ id: id(30 + i), cliente_id: clientId, importe: 14, cliente_compra_minutos: true, fecha_hora: now, created_at: now })),
  };
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    from(table) {
      reads.push(table); let rows = tables[table] || [];
      const q = {
        select() { return q; }, order() { return q; }, limit(n) { rows = rows.slice(0, n); return q; },
        eq(key, value) { rows = rows.filter(row => row[key] === value); return q; },
        in(key, values) { rows = rows.filter(row => values.includes(row[key])); return q; },
        maybeSingle: async () => ({ data: rows[0] || null, error: null }),
        then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
      };
      return q;
    },
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'tc_client_rank_state') return { data: options.state === undefined ? canonical : options.state, error: options.rankError || null };
      if (name === 'crm_free_pass_status') return { data: { remaining: 0 }, error: null };
      throw Error(`Unexpected RPC ${name}`);
    },
  };
  const deps = {
    'next/server': { NextResponse: { json: (body, init = {}) => new Response(JSON.stringify(body), init) } },
    '@supabase/supabase-js': { createClient: () => db },
    '@/lib/server/client-rank-effective': rankModule(),
    '@/lib/server/auth-fast': { getAuthUserFromRequest: req => ({ data: { user: req.headers.has('authorization') ? { id: userId } : null }, error: null }) },
    '@/lib/server/client-fidelity': { calculateClientFidelity: input => ({ score: 1, rank: input.rank }) },
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.supabase.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-test-key';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic-test-anon';
  const mod = load(route[1], deps);
  return { calls, reads, mod, get: (auth = true) => mod.GET(new Request(`https://test.invalid/${route[0]}${route[2]}`, { headers: auth ? { authorization: 'Bearer synthetic' } : {} })) };
}

for (const route of routes) {
  test(`${route[0]} uses 56 EUR / four purchases / Bronze from the canonical snapshot, preserving balances and no-store`, async () => {
    const h = fixture(route), response = await h.get(), body = await response.json();
    assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal(h.mod.fetchCache, 'force-no-store'); assert.equal(h.mod.revalidate, 0);
    const c = body.cliente || body.client, r = body.rank;
    assert.equal(c.minutos_free_pendientes, 17); assert.equal(c.minutos_normales_pendientes, 29);
    assert.equal(r ? r.spent_30d : c.rango_gasto_30d ?? c.rango_gasto_mes_anterior, 56);
    assert.equal(r ? r.purchases_30d : c.rango_compras_30d ?? c.rango_compras_mes_anterior, 4);
    assert.equal(r ? r.automatic : c.rango_automatico, 'bronce');
    assert.equal(r ? r.effective : c.rango_efectivo, 'bronce');
    assert.equal(r ? r.override : c.rango_intervencion, null);
    assert.equal(h.calls.filter(c => c.name === 'tc_client_rank_state').length, 1);
    assert.equal(h.reads.includes('client_rank_overrides'), false);
    if (route[0] === 'purchases') { assert.equal(body.rows.length, 4); assert.equal(body.stats.total_spent, 56); }
  });
  test(`${route[0]} preserves manual override and automatic rank together`, async () => {
    const h = fixture(route, { state: { ...canonical, effective: 'oro', override } });
    const response = await h.get(), body = await response.json(); assert.equal(response.status, 200);
    const r = body.rank || { automatic: body.cliente.rango_automatico, effective: body.cliente.rango_efectivo, override: body.cliente.rango_intervencion };
    assert.equal(r.automatic, 'bronce'); assert.equal(r.effective, 'oro'); assert.deepEqual(r.override, override);
  });
  test(`${route[0]} rejects unavailable rank and unauthenticated reads without returning a stale rank`, async () => {
    for (const options of [{ rankError: { message: 'private RPC details' } }, { state: {} }]) {
      const response = await fixture(route, options).get(), body = await response.json();
      assert.equal(response.status, 500); assert.equal(body.ok, false);
      assert.equal(body.cliente, undefined); assert.equal(body.rank, undefined);
      assert.doesNotMatch(body.error, /private RPC details/);
    }
    const h = fixture(route), response = await h.get(false);
    assert.equal(response.status, 401); assert.equal(h.calls.length, 0);
  });
}

test('detail ownership and ficha staff role checks still run before any canonical rank read', async () => {
  for (const [route, options] of [[routes[1], { unassigned: true }], [routes[0], { role: 'tarotista' }]]) {
    const h = fixture(route, options), response = await h.get();
    assert.equal(response.status, 403); assert.equal(h.calls.length, 0);
  }
});

test('admin rank totals delegate to the shared deduplicated loader and propagate its failure', async () => {
  const expected = new Map([[clientId, { total: 56, compras: 4, pagos: 4, llamadas: 0 }]]), args = [], db = {}, clients = [{ id: clientId }];
  const mod = load('src/lib/server/client-rank-admin-data.ts', {
    '@/lib/server/client-ranks': { calcClientRank, loadRolling30ClientTotals: async (...input) => { args.push(input); if (input[2] === 'fail') throw Error('unavailable'); return expected; } },
    '@/lib/server/client-rank-effective': rankModule(),
  });
  assert.equal(await mod.loadRecentRankTotals(db, clients, 'from', 'to'), expected);
  assert.deepEqual(args, [[db, clients, 'from', 'to']]);
  await assert.rejects(mod.loadRecentRankTotals(db, clients, 'fail', 'to'), /unavailable/);
});

test('single and batch intervention readers break equal created_at ties by descending ID', async () => {
  const orders = [];
  const values = [
    { ...override, id: id(8), client_id: clientId, assigned_rank: 'plata', created_at: '2026-10-01' },
    { ...override, id: id(9), client_id: clientId, assigned_rank: 'oro', created_at: '2026-10-01' },
  ];
  const db = { from() {
    const q = { select() { return q; }, eq() { return q; }, lte() { return q; }, or() { return q; }, in() { return q; }, limit() { return q; },
      order(field, direction) { orders.push([field, direction]); return q; },
      result() { const rows = [...values].sort((a, b) => { for (const [field, dir] of orders) { const compared = String(a[field]).localeCompare(String(b[field])); if (compared) return dir.ascending ? compared : -compared; } return 0; }); return rows; },
      maybeSingle: async () => ({ data: q.result()[0], error: null }),
      then(resolve, reject) { return Promise.resolve({ data: q.result(), error: null }).then(resolve, reject); },
    }; return q;
  } };
  assert.equal((await rankModule().loadEffectiveClientRank(db, clientId, 56)).override.id, id(9));
  assert.deepEqual(orders.map(o => o[0]), ['created_at', 'id']); orders.length = 0;
  const batch = load('src/lib/server/client-rank-admin-data.ts', { '@/lib/server/client-ranks': { calcClientRank }, '@/lib/server/client-rank-effective': rankModule() });
  assert.equal((await batch.loadEffectiveRanksBatch(db, [{ id: clientId }], new Map([[clientId, { total: 56 }]]))).get(clientId).override.id, id(9));
  assert.deepEqual(orders.map(o => o[0]), ['created_at', 'id']);
});
