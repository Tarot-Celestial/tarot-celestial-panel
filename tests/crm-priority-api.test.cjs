// Fixture-only API and cursor contract checks. SQL aggregation has its own integration suite.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const clone = value => JSON.parse(JSON.stringify(value));
const next = { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } };
function load(file, imports) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => imports[name], Buffer, Response, URL, console: { error() {} } });
  return exports;
}
const helper = load('src/lib/server/crm-client-priority.ts', { 'node:crypto': require('node:crypto') });
const filters = { tagIds: [id(50)], search: '', phoneCandidates: [], country: '', webFilter: 'todos', rank: '' };
function fixture(options = {}) {
  const calls = [], reads = [];
  const ranked = options.ranked || Array.from({ length: 124 }, (_, n) => ({
    // Deliberately reverse UUID order: the highest spending client must not be
    // confined to the final UUID page or reordered by a subsequent IN lookup.
    cliente_id: id(500 - n), gasto_total: String(2000 - n), compras: String(150 - n),
    ultima_actividad_at: '2026-11-12T10:00:00+00:00', gasto_por_moneda: { EUR: 2000 - n },
  }));
  const clients = options.clients || ranked.map((row, n) => ({
    id: row.cliente_id, nombre: `Fixture ${n}`, origen: 'manual',
    minutos_free_pendientes: n, minutos_normales_pendientes: n + 7, deuda_pendiente: 0,
  })).reverse();
  const worker = { id: id(1), user_id: id(2), role: 'central', is_active: true, ...options.worker };
  const db = {
    auth: { async getUser(token) {
      calls.push(['auth', token]);
      return { data: { user: token === 'valid' ? { id: id(2) } : null }, error: null };
    } },
    async rpc(name, params) {
      calls.push(['rpc', name, clone(params)]);
      assert.equal(name, 'tc_crm_client_priority_page');
      if (options.rpcError) return { data: null, error: options.rpcError };
      const start = params.p_after ? ranked.findIndex(row => row.cliente_id === params.p_after.cliente_id) + 1 : 0;
      return { data: ranked.slice(start, start + params.p_limit), error: null };
    },
    from(table) {
      const data = table === 'workers' ? [worker] : table === 'crm_clientes' ? clients
        : table === 'crm_etiquetas' ? [{ id: id(50), nombre: 'Noviembre 2026' }, { id: id(51), nombre: 'Octubre 2026' }]
        : table === 'crm_cliente_etiquetas' ? clients.map(row => ({ cliente_id: row.id, etiqueta_id: id(50) })) : [];
      const predicates = [];
      let projection = '*';
      const query = {
        select(value) { projection = value; return query; },
        order() { return query; }, lte() { return query; }, or() { return query; },
        eq(key, value) { predicates.push(row => row[key] === value); return query; },
        ilike(key, value) { predicates.push(row => String(row[key]).toLowerCase() === value.toLowerCase()); return query; },
        in(key, values) { predicates.push(row => values.includes(row[key])); return query; },
        async maybeSingle() { return { data: data.find(row => predicates.every(p => p(row))) || null, error: null }; },
        then(resolve, reject) {
          reads.push({ table, projection });
          const selected = data.filter(row => predicates.every(p => p(row)));
          const fields = projection.split(',').map(field => field.trim());
          return Promise.resolve({
            data: projection === '*' ? selected : selected.map(row => Object.fromEntries(fields.filter(key => key in row).map(key => [key, row[key]]))),
            error: table === 'crm_clientes' ? options.clientError || null : null,
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const access = load('src/lib/server/central-workspace-access.ts', {
    'next/server': next, '@/lib/server/auth-worker': { getAdminClient: () => db },
  });
  const route = load('src/app/api/crm/clientes/buscar/route.ts', {
    'next/server': next, '@/lib/server/central-workspace-access': access,
    '@/lib/server/crm-client-priority': helper,
    '@/lib/server/client-ranks': { calcClientRank: () => 'plata', loadRolling30ClientTotals: async () => new Map() },
    '@/lib/server/client-rank-effective': { normalizeClientRank: value => value },
  });
  return {
    db, ranked, clients, calls, reads,
    page: (cursor = '', customFilters = filters) => helper.loadPriorityClientPage(db, customFilters, cursor),
    get: (query = 'etiqueta=Noviembre%202026', token = 'valid') => route.GET(new Request('https://fixture.invalid/search?' + query, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })),
  };
}

test('tagged results keep the global purchase order across 120-client pages and retain real balances', async () => {
  const f = fixture();
  const firstResponse = await f.get();
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.equal(first.clientes.length, 120);
  assert.equal(first.clientes[0].id, id(500));
  assert.equal(first.clientes[0].prioridad_gasto_total, 2000);
  assert.equal(first.clientes[0].prioridad_compras, 150);
  assert.deepEqual(first.clientes[0].prioridad_gasto_por_moneda, { EUR: 2000 });
  assert.equal(first.clientes[0].minutos_free_pendientes, 0);
  assert.equal(first.clientes[0].minutos_normales_pendientes, 7);
  assert.equal(first.has_more, true);
  assert.match(first.next_cursor, /^cp1\./);
  assert.equal(first.sort_order, 'purchase_priority');
  assert.match(firstResponse.headers.get('cache-control'), /private.*no-store/);
  const second = await (await f.get('etiqueta=Noviembre%202026&cursor=' + encodeURIComponent(first.next_cursor))).json();
  assert.equal(second.clientes.length, 4);
  assert.equal(second.has_more, false);
  assert.equal(second.next_cursor, null);
  assert.equal(second.sort_as_of, first.sort_as_of);
  assert.equal(second.clientes[3].minutos_free_pendientes, 123);
  assert.deepEqual([...first.clientes, ...second.clientes].map(row => row.id), f.ranked.map(row => row.cliente_id));
  const rpcCalls = f.calls.filter(call => call[0] === 'rpc');
  assert.equal(rpcCalls.length, 2);
  assert.equal(rpcCalls[0][2].p_limit, 121);
  assert.equal(rpcCalls[1][2].p_as_of, rpcCalls[0][2].p_as_of);
  assert.deepEqual(rpcCalls[1][2].p_after, {
    cliente_id: id(381), gasto_total: 1881, compras: 31, ultima_actividad_at: '2026-11-12T10:00:00+00:00',
  });
});

test('priority cursor is bound to the complete filter context', async () => {
  const f = fixture(), first = await f.page();
  for (const change of [
    { tagIds: [id(51)] }, { search: 'Maria' }, { phoneCandidates: ['123'] },
    { country: 'España' }, { webFilter: 'registrados' }, { rank: 'oro' },
  ]) {
    await assert.rejects(f.page(first.next_cursor, { ...filters, ...change }), error => error.status === 400 && error.message === 'PAGINA_INVALIDA');
  }
  assert.equal(f.calls.filter(call => call[0] === 'rpc').length, 1, 'a mismatched cursor must fail before any ranking query');
  const response = await f.get('etiqueta=Octubre%202026&cursor=' + encodeURIComponent(first.next_cursor));
  assert.equal(response.status, 400);
});

test('malformed priority cursors fail safely before querying purchases', async () => {
  const f = fixture(), first = await f.page();
  const valid = JSON.parse(Buffer.from(first.next_cursor.slice(4), 'base64url').toString('utf8'));
  const encode = value => 'cp1.' + Buffer.from(JSON.stringify(value)).toString('base64url');
  const bad = [
    id(1), 'cp1.not-json', 'cp1.' + 'A'.repeat(2100),
    encode({ ...valid, v: 2 }), encode({ ...valid, asOf: 'tomorrow' }),
    encode({ ...valid, asOf: '2999-01-01T00:00:00Z' }),
    encode({ ...valid, after: { ...valid.after, cliente_id: 'invalid' } }),
    encode({ ...valid, after: { ...valid.after, gasto_total: -1 } }),
    encode({ ...valid, after: { ...valid.after, compras: 1.5 } }),
    encode({ ...valid, after: { ...valid.after, ultima_actividad_at: 'invalid' } }),
  ];
  for (const cursor of bad) await assert.rejects(f.page(cursor), error => error.status === 400 && error.message === 'PAGINA_INVALIDA');
  assert.equal(f.calls.filter(call => call[0] === 'rpc').length, 1);
});

test('sorted CRM remains restricted to verified active Central/Admin accounts', async () => {
  for (const [options, token, status] of [
    [{}, null, 401], [{}, 'forged', 401], [{ worker: { is_active: false } }, 'valid', 403],
    [{ worker: { role: 'tarotista' } }, 'valid', 403],
  ]) {
    const f = fixture(options), response = await f.get(undefined, token);
    assert.equal(response.status, status);
    assert.equal(f.calls.some(call => call[0] === 'rpc'), false);
    assert.equal(f.reads.some(read => read.table === 'crm_clientes'), false);
  }
  for (const role of ['central', 'admin']) assert.equal((await fixture({ worker: { role } }).get()).status, 200);
});

test('ranking and client lookup failures are visible without leaking database details', async () => {
  for (const options of [
    { rpcError: { message: 'secret table detail', code: 'XX000' } },
    { clientError: { message: 'secret table detail', code: 'XX000' } },
    { ranked: [{ cliente_id: id(500), gasto_total: 'NaN', compras: 2, ultima_actividad_at: null, gasto_por_moneda: {} }] },
  ]) {
    const response = await fixture(options).get(), body = await response.json();
    assert.equal(response.status, 500); assert.equal(body.ok, false);
    assert.doesNotMatch(body.error, /secret table|XX000|NaN/);
    assert.match(body.error, /CRM|historial/);
  }
});

test('no matching tag is an empty result and never queries financial history', async () => {
  const f = fixture(), response = await f.get('etiqueta=No%20existe'), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.ok, true); assert.deepEqual(body.clientes, []);
  assert.equal(f.calls.some(call => call[0] === 'rpc'), false);
});

test('a client removed between ranking and hydration cannot stall or rewind the next page', async () => {
  const f = fixture();
  f.clients.splice(f.clients.findIndex(row => row.id === id(381)), 1);
  const first = await f.page();
  assert.equal(first.clientes.length, 119); assert.equal(first.scanned_count, 120); assert.equal(first.has_more, true);
  const second = await f.page(first.next_cursor);
  assert.equal(second.clientes.length, 4);
  assert.equal(new Set([...first.clientes, ...second.clientes].map(row => row.id)).size, 123);
  assert.equal(f.calls.filter(call => call[0] === 'rpc')[1][2].p_after.cliente_id, id(381));
});

test('zero-purchase prospects and missing activity retain explicit zero/null data', async () => {
  const f = fixture({ ranked: [{ cliente_id: id(500), gasto_total: '0.00', compras: '0', ultima_actividad_at: null, gasto_por_moneda: {} }] });
  const first = await f.page();
  assert.equal(first.clientes[0].prioridad_gasto_total, 0);
  assert.equal(first.clientes[0].prioridad_compras, 0);
  assert.equal(first.clientes[0].prioridad_ultima_actividad_at, null);
  assert.equal(first.has_more, false); assert.equal(first.next_cursor, null);
});

test('tagged search forwards sanitized search, phone variants, country and web filters to the RPC', async () => {
  const f = fixture();
  assert.equal((await f.get('etiqueta=Noviembre%202026&q=Maria%25%2C%20Lopez&pais=España&web_filter=no_registrados')).status, 200);
  const first = f.calls.find(call => call[0] === 'rpc')[2];
  assert.deepEqual(first.p_tag_ids, [id(50)]);
  assert.equal(first.p_search, 'Maria   Lopez');
  assert.equal(first.p_country, 'España');
  assert.equal(first.p_web_filter, 'no_registrados');
  const phone = fixture();
  assert.equal((await phone.get('etiqueta=Noviembre%202026&telefono=0034600339157')).status, 200);
  assert.deepEqual(phone.calls.find(call => call[0] === 'rpc')[2].p_phone_candidates, ['600339157', '34600339157', '0034600339157']);
});
