const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/lib/server/client-ranks.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleUnderTest = { exports: {} };
vm.runInNewContext(compiled, { module: moduleUnderTest, exports: moduleUnderTest.exports, require });
const { loadRolling30ClientTotals, calcClientRank } = moduleUnderTest.exports;
const since = '2026-09-30T19:00:00.000Z';
const now = '2026-10-30T19:00:00.000Z';
const inside = '2026-10-15T12:00:00.000Z';
const before = '2026-09-01T12:00:00.000Z';
const future = '2026-11-01T12:00:00.000Z';
const id = n => '30000000-0000-4000-8000-' + String(n).padStart(12, '0');
const client = id(1);
const payment = (n, extra = {}) => ({ id: id(10000 + n), cliente_id: client, importe: 1, estado: 'completed', created_at: inside, source_rendimiento_id: null, ...extra });
const call = (n, extra = {}) => ({ id: id(20000 + n), cliente_id: client, importe: 1, fecha_hora: inside, created_at: inside, ...extra });

// A bounded PostgREST-like query double: without explicit ranges it truncates at
// 1,000 rows, so the pagination regression cannot pass by returning every fixture.
function database(payments = [], calls = [], fail = () => false) {
  const tables = { crm_cliente_pagos: payments, rendimiento_llamadas: calls };
  const queries = [];
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.columns = ''; this.orderBy = null; this.bounds = null; }
    select(columns) { this.columns = columns; return this; }
    eq(column, value) { this.filters.push(['eq', column, value]); return this; }
    in(column, values) { this.filters.push(['in', column, [...values]]); return this; }
    is(column, value) { this.filters.push(['is', column, value]); return this; }
    gt(column, value) { this.filters.push(['gt', column, value]); return this; }
    gte(column, value) { this.filters.push(['gte', column, value]); return this; }
    lte(column, value) { this.filters.push(['lte', column, value]); return this; }
    order(column, options) { this.orderBy = { column, ...options }; return this; }
    range(start, end) { this.bounds = [start, end]; return this; }
    then(resolve, reject) {
      queries.push(this);
      if (fail(this)) return Promise.resolve({ data: null, error: new Error('fixture query failed') }).then(resolve, reject);
      let rows = tables[this.table].filter(row => this.filters.every(([op, column, value]) => {
        const actual = row[column] ?? null;
        if (op === 'eq' || op === 'is') return actual === value;
        if (op === 'in') return value.includes(actual);
        if (actual === null) return false;
        const a = /(?:created_at|fecha_hora)/.test(column) ? Date.parse(actual) : Number(actual);
        const b = /(?:created_at|fecha_hora)/.test(column) ? Date.parse(value) : Number(value);
        return op === 'gt' ? a > b : op === 'gte' ? a >= b : a <= b;
      }));
      if (this.orderBy) rows = [...rows].sort((a, b) => String(a[this.orderBy.column]).localeCompare(String(b[this.orderBy.column])));
      const [start, end] = this.bounds || [0, 999];
      return Promise.resolve({ data: rows.slice(start, end + 1), error: null }).then(resolve, reject);
    }
  }
  return { queries, from: table => new Query(table) };
}
async function totals(db, clients = [{ id: client }]) { return loadRolling30ClientTotals(db, clients, since, now); }
const plain = value => JSON.parse(JSON.stringify(value));
function expectTotal(result, clientId, expected) { assert.deepEqual(plain(result.get(clientId)), expected); }

test('four linked purchases totaling 56 count once: 112/8 becomes 56/4 and Bronze', async () => {
  const amounts = [12, 20, 12, 12];
  const calls = amounts.map((importe, n) => call(n, { importe }));
  const payments = amounts.map((importe, n) => payment(n, { importe, source_rendimiento_id: calls[n].id }));
  const result = await totals(database(payments, calls));
  expectTotal(result, client, { total: 56, compras: 4, pagos: 4, llamadas: 0 });
  assert.equal(calcClientRank(result.get(client).total), 'bronce');
});

test('a real 100-euro purchase remains Silver and amounts are rounded only after aggregation', async () => {
  const result = await totals(database([payment(1, { importe: 99.7 }), payment(2, { importe: 0.1 }), payment(3, { importe: 0.2 })]));
  expectTotal(result, client, { total: 100, compras: 3, pagos: 3, llamadas: 0 });
  assert.equal(calcClientRank(result.get(client).total), 'plata');
});

test('any linked payment excludes its call, including refunded, outside-window and other-client links', async () => {
  const calls = [call(1), call(2), call(3), call(4)];
  const payments = [
    payment(1, { source_rendimiento_id: calls[0].id, estado: 'refunded' }),
    payment(2, { source_rendimiento_id: calls[1].id, created_at: before }),
    payment(3, { source_rendimiento_id: calls[2].id, created_at: future }),
    payment(4, { source_rendimiento_id: calls[3].id, cliente_id: id(999), importe: 0 }),
  ];
  const db = database(payments, calls);
  assert.equal((await totals(db)).size, 0);
  const linkQueries = db.queries.filter(q => q.filters.some(([op, column]) => column === 'source_rendimiento_id'));
  assert.ok(linkQueries.length > 0);
  for (const q of linkQueries) assert.deepEqual(q.filters.map(([, column]) => column), ['source_rendimiento_id']);
});

test('unlinked legacy calls with an exact client ID still count; only positive completed payments count', async () => {
  const result = await totals(database([
    payment(1, { importe: 20 }), payment(2, { importe: 50, estado: 'pending' }),
    payment(3, { importe: 40, estado: 'refunded' }), payment(4, { importe: 0 }), payment(5, { importe: -10 }),
  ], [call(1, { importe: 13 }), call(2, { importe: 0 }), call(3, { importe: -8 })]));
  expectTotal(result, client, { total: 33, compras: 2, pagos: 1, llamadas: 1 });
});

test('COALESCE call dates and inclusive window boundaries exclude future and backfilled old calls', async () => {
  const result = await totals(database([
    payment(1, { created_at: since, importe: 2 }), payment(2, { created_at: now, importe: 3 }),
    payment(3, { created_at: before, importe: 100 }), payment(4, { created_at: future, importe: 100 }),
  ], [
    call(1, { fecha_hora: since, created_at: future, importe: 5 }),
    call(2, { fecha_hora: now, created_at: before, importe: 7 }),
    call(3, { fecha_hora: null, created_at: inside, importe: 11 }),
    call(4, { fecha_hora: before, created_at: inside, importe: 100 }),
    call(5, { fecha_hora: future, created_at: inside, importe: 100 }),
    call(6, { fecha_hora: null, created_at: future, importe: 100 }),
    call(7, { fecha_hora: null, created_at: null, importe: 100 }),
    call(8, { fecha_hora: '2026-10-30T20:00:00+01:00', importe: 13 }),
  ]));
  expectTotal(result, client, { total: 41, compras: 6, pagos: 2, llamadas: 4 });
});

test('names never identify a purchase, and reads are scoped to the requested client IDs', async () => {
  const clients = [{ id: client, nombre: 'Same', apellido: 'Name' }, { id: id(2), nombre: 'Same', apellido: 'Name' }];
  const db = database([payment(1, { cliente_id: id(3), importe: 500 })], [
    call(1, { cliente_id: null, cliente_nombre: 'Same Name', importe: 500 }),
    call(2, { cliente_id: '', cliente_nombre: 'Same Name', importe: 500 }),
    call(3, { cliente_id: id(3), cliente_nombre: 'Same Name', importe: 500 }),
    call(4, { cliente_id: id(2), importe: 8 }),
  ]);
  const result = await totals(db, clients);
  assert.equal(result.size, 1);
  expectTotal(result, id(2), { total: 8, compras: 1, pagos: 0, llamadas: 1 });
  for (const q of db.queries) {
    assert.ok(!q.columns.includes('cliente_nombre'));
    if (!q.filters.some(([, column]) => column === 'source_rendimiento_id')) {
      assert.deepEqual(q.filters.find(([, column]) => column === 'cliente_id')[2], [client, id(2)]);
    }
  }
});

test('all payment and call pages are read beyond the 1,000-row PostgREST cap', async () => {
  const db = database(Array.from({ length: 1005 }, (_, n) => payment(n)), Array.from({ length: 1003 }, (_, n) => call(n)));
  expectTotal(await totals(db), client, { total: 2008, compras: 2008, pagos: 1005, llamadas: 1003 });
  for (const table of ['crm_cliente_pagos', 'rendimiento_llamadas']) {
    assert.ok(db.queries.some(q => q.table === table && q.bounds?.[0] === 1000));
  }
  for (const q of db.queries) assert.deepEqual(q.orderBy, { column: 'id', ascending: true });
});

test('link lookups also paginate, so a link after the first 1,000 records is not missed', async () => {
  const calls = [call(1), call(2)];
  const payments = Array.from({ length: 1001 }, (_, n) => payment(n, {
    estado: 'refunded', source_rendimiento_id: n === 1000 ? calls[1].id : calls[0].id,
  }));
  const db = database(payments, calls);
  assert.equal((await totals(db)).size, 0);
  assert.ok(db.queries.some(q => q.filters.some(([, c]) => c === 'source_rendimiento_id') && q.bounds?.[0] === 1000));
});

test('client IDs are batched and deduplicated without one query per client', async () => {
  const clients = Array.from({ length: 201 }, (_, n) => ({ id: id(n + 1) }));
  const db = database(clients.map((c, n) => payment(n, { cliente_id: c.id })));
  const result = await totals(db, [...clients, clients[0]]);
  assert.equal(result.size, 201);
  assert.equal(db.queries.length, 6);
  for (const q of db.queries) assert.ok(q.filters.find(([, c]) => c === 'cliente_id')[2].length <= 200);
});

test('an empty client selection makes no database queries', async () => {
  const db = database([payment(1)], [call(1)]);
  assert.equal((await totals(db, [])).size, 0);
  assert.equal(db.queries.length, 0);
});

test('database or later-page errors fail the whole calculation instead of returning a partial rank', async () => {
  await assert.rejects(totals(database([payment(1)], [], q => q.table === 'crm_cliente_pagos')), /fixture query failed/);
  await assert.rejects(totals(database(Array.from({ length: 1001 }, (_, n) => payment(n)), [], q => q.bounds?.[0] === 1000)), /fixture query failed/);
  await assert.rejects(totals(database([], [call(1)], q => q.filters.some(([, c]) => c === 'source_rendimiento_id'))), /fixture query failed/);
});
