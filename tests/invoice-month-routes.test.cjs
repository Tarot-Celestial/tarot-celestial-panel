const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute real TypeScript modules with isolated, synthetic persistence and auth.
// Unknown imports fail, so these tests cannot contact Supabase or another service.
function load(file, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, URL, Date, Intl, Map, Set, console,
    process: { env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic.invalid',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon',
      SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
    } },
    require(name) {
      if (name === 'next/server') return { NextResponse: { json: (body, options) => Response.json(body, options) } };
      if (Object.hasOwn(mocks, name)) return mocks[name];
      throw new Error(`Unexpected import: ${name}`);
    },
  }, { filename: file });
  return exports;
}

const monthKey = load('src/lib/month-key.ts');
const noNetwork = { createClient() { throw new Error('Unexpected database client'); } };
const authWorker = load('src/lib/server/auth-worker.ts', {
  '@supabase/supabase-js': noNetwork,
  '@/lib/server/auth-fast': {},
  '@/lib/month-key': monthKey,
});
const requireAdmin = load('src/lib/admin/require-admin.ts', {
  '@supabase/supabase-js': noNetwork,
  '@/lib/month-key': monthKey,
});
const bonusEngine = load('src/lib/bonuses/engine.ts');
const reporting = load('src/lib/server/madrid-reporting-period.ts');
const invoiceComparison = load('src/lib/server/invoice-period-comparison.ts');

function request(endpoint, method = 'GET', body) {
  return new Request(`https://synthetic.invalid${endpoint}`, {
    method,
    headers: { authorization: 'Bearer synthetic-user', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function database(resolve) {
  const queries = [];
  const db = { from(table) {
    const trace = { table, operations: [] };
    queries.push(trace);
    const query = {};
    for (const operation of ['select', 'eq', 'in', 'or', 'order', 'gte', 'lt', 'is']) {
      query[operation] = (...args) => { trace.operations.push([operation, ...args]); return query; };
    }
    query.maybeSingle = () => Promise.resolve(resolve(trace, true));
    query.then = (yes, no) => Promise.resolve(resolve(trace, false)).then(yes, no);
    return query;
  } };
  return { db, queries };
}

test('invoice validators share canonical month handling for September and reject invalid input', () => {
  for (const normalize of [monthKey.normalizeMonthKey, authWorker.normalizeMonthKey, requireAdmin.normalizeMonthKey]) {
    assert.equal(normalize('2026-9'), '2026-09');
    assert.equal(normalize(' 2026-09 '), '2026-09');
    assert.equal(normalize('2026-12'), '2026-12');
    for (const invalid of ['', ' ', null, undefined, 202609, {}, '2026-00', '2026-0', '2026-13',
      '2026-', '2026-009', '26-09', '0000-09', '0999-09', '10000-09', '2026/09', '2026-09-01']) {
      assert.throws(() => normalize(invalid), /INVALID_MONTH_KEY/, `Rejected ${String(invalid)}`);
    }
  }
});

function generateHarness() {
  const calls = { bonusMonths: [], reportingRanges: [], rpc: [], rankConfig: 0 };
  const worker = { id: 'worker-1', display_name: 'Synthetic central', role: 'central', salary_base: 400 };
  const { db, queries } = database(({ table }) => {
    assert.equal(table, 'workers');
    return { data: [worker], error: null };
  });
  db.rpc = async (name, args) => {
    calls.rpc.push({ name, args });
    return { data: { id: 'invoice-september', created: true, line_count: 2, total: 400 }, error: null };
  };
  const route = load('src/app/api/invoices/generate/route.ts', {
    '@/lib/server/auth-worker': authWorker,
    '@/lib/bonuses/engine': bonusEngine,
    '@/lib/server/madrid-reporting-period': reporting,
    '@/lib/server/tarotista-bonuses': {
      bonusAccess: async () => ({ db, worker: { id: 'admin-1' } }),
      loadBonusReport: async (_db, month) => {
        calls.bonusMonths.push(month);
        return { activation_month: '2026-01', closed: false, versions: [] };
      },
      bonusCandidates: () => [],
    },
    '@/lib/server/tarotista-ranks': {
      loadTarotistaRankConfig: async () => { calls.rankConfig += 1; return {}; },
      resolveTarotistaRankState: () => null,
    },
    '@/lib/server/rendimiento-metrics': {
      listTarotistaWorkers: async () => [],
      listRendimientoRowsByIso: async (start, end) => { calls.reportingRanges.push([start, end]); return []; },
      aggregateRendimientoByTarotista: () => [{ worker_id: worker.id, display_name: worker.display_name }],
    },
  });
  return { route, calls, queries };
}

test('generation converts 2026-9 to September for bonuses, Madrid production range, and preserving RPC', async () => {
  const { route, calls } = generateHarness();
  const response = await route.POST(request('/api/invoices/generate', 'POST', { month: '2026-9' }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.month, '2026-09');
  assert.equal(body.created, 1);
  assert.deepEqual(calls.bonusMonths, ['2026-09']);
  assert.deepEqual(calls.reportingRanges, [['2026-08-31T22:00:00.000Z', '2026-09-30T22:00:00.000Z']]);
  assert.equal(calls.rpc.length, 1);
  assert.equal(calls.rpc[0].name, 'invoice_regenerate_preserving_manual');
  assert.equal(calls.rpc[0].args.p_month, '2026-09');
  assert.equal(calls.rpc[0].args.p_snapshot.salary_base, 400);
  assert.equal(calls.rpc[0].args.p_snapshot.actor_id, 'admin-1');
});

test('invalid generation month returns 400 before production reads or invoice mutation', async () => {
  for (const invalid of ['', '2026-00', '2026-13', '2026-', '0999-09', null]) {
    const { route, calls, queries } = generateHarness();
    const response = await route.POST(request('/api/invoices/generate', 'POST', { month: invalid }));
    assert.equal(response.status, 400, `Invalid month ${String(invalid)}`);
    assert.equal((await response.json()).error, 'INVALID_MONTH_KEY');
    assert.equal(calls.rpc.length, 0);
    assert.equal(calls.bonusMonths.length, 0);
    assert.equal(calls.reportingRanges.length, 0);
    assert.equal(calls.rankConfig, 0);
    assert.equal(queries.length, 0);
  }
});

function listHarness() {
  const collaboratorMonths = [];
  const { db, queries } = database(({ table }, single) => {
    if (table === 'workers') return { data: single ? { role: 'admin' } : [{ id: 'worker-1' }], error: null };
    if (table === 'v_invoice_full') return { data: [{ invoice_id: 'september', worker_id: 'worker-1',
      display_name: 'Synthetic central', role: 'central', month_key: '2026-09', total: 400, worker_ack: 'accepted' }], error: null };
    if (table === 'invoices') return { data: [{ id: 'august', worker_id: 'worker-1', total: 350, worker_ack: 'accepted' }], error: null };
    if (table === 'invoice_lines' || table === 'manual_invoices') return { data: [], error: null };
    throw new Error(`Unexpected table ${table}`);
  });
  const route = load('src/app/api/admin/invoices/list/route.ts', {
    '@/lib/month-key': monthKey,
    '@supabase/supabase-js': { createClient: () => db },
    '@/lib/server/auth-fast': { getAuthUserFromRequest: () => ({ data: { user: { id: 'admin-1' } } }) },
    '@/lib/server/invoice-period-comparison': invoiceComparison,
    '@/lib/server/collaborator-billing': {
      listActiveCollaborators: async () => [{ id: 'collaborator-1' }],
      loadCollaboratorMonthlyReport: async (_db, _id, month) => { collaboratorMonths.push(month); return { month }; },
      collaboratorReportToInvoiceRow: report => ({ invoice_id: 'collaborator', role: 'collaborator', month_key: report.month }),
    },
  });
  return { route, queries, collaboratorMonths };
}

test('invoice list uses September, previous August, and September-only manual and collaborator ranges', async () => {
  const { route, queries, collaboratorMonths } = listHarness();
  const response = await route.GET(request('/api/admin/invoices/list?month=2026-9'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.month, '2026-09');
  assert.equal(body.previous_month, '2026-08');
  assert.equal(body.previous_summary.invoice_total, 350);
  assert.equal(body.invoices.find(row => row.invoice_id === 'september').total, 400);
  assert.equal(body.invoices.find(row => row.invoice_id === 'september').previous_total, 350);
  assert.deepEqual(queries.find(q => q.table === 'v_invoice_full').operations.find(op => op[0] === 'eq'), ['eq', 'month_key', '2026-09']);
  assert.deepEqual(queries.find(q => q.table === 'invoices').operations.find(op => op[0] === 'eq'), ['eq', 'month_key', '2026-08']);
  const manualFilters = queries.find(q => q.table === 'manual_invoices').operations.filter(op => ['gte', 'lt'].includes(op[0]));
  assert.deepEqual(manualFilters, [['gte', 'issue_date', '2026-09-01'], ['lt', 'issue_date', '2026-10-01']]);
  assert.deepEqual(collaboratorMonths, ['2026-09']);
});

test('invoice list rejects invalid or explicitly empty months instead of showing another month', async () => {
  for (const invalid of ['', '2026-00', '2026-13', '2026-09-01']) {
    const { route, queries, collaboratorMonths } = listHarness();
    const response = await route.GET(request(`/api/admin/invoices/list?month=${encodeURIComponent(invalid)}`));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'INVALID_MONTH_KEY');
    assert.equal(queries.length, 1, 'Only admin authorization may access the database');
    assert.equal(queries[0].table, 'workers');
    assert.deepEqual(collaboratorMonths, []);
  }
});
