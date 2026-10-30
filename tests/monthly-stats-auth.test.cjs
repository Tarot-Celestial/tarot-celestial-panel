const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');

function compile(file, modules) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: name => { if (!(name in modules)) throw new Error(`Unexpected module ${name}`); return modules[name]; },
    process: { env: {} }, URL, Date, Map, Promise, Number, Math,
  });
  return exports;
}

function fixture(options = {}) {
  const worker = options.worker === null ? null : { id: 'own-worker', user_id: 'verified-user', role: 'tarotista', is_active: true, display_name: 'Fixture', ...options.worker };
  const calls = { auth: [], lookups: [], metrics: 0 };
  const db = {
    auth: { getUser: async token => { calls.auth.push(token); return options.invalid ? { data: { user: null }, error: { message: 'Invalid token' } } : { data: { user: { id: 'verified-user', email: 'fixture@example.invalid' } }, error: null }; } },
    from(table) { const lookup = { table }; calls.lookups.push(lookup); return {
      select(value) { lookup.select = value; return this; }, eq(column, value) { lookup[column] = value; return this; },
      async maybeSingle() { return { data: lookup.user_id ? worker : worker ? { team: 'fuego', tarotista_level: options.level || 1 } : null, error: null }; },
    }; },
  };
  const attendance = compile('src/lib/server/panel-attendance.ts', {
    '@supabase/supabase-js': { createClient: () => db },
    '@/lib/server/asterisk-ami': { amiCommand: () => { throw new Error('Stats must not query phone calls'); } },
    '@/lib/attendance/panel-session': { confirmedCallStart: () => null },
  });
  const period = { currentStartIso: '2026-10-01', currentEndExclusiveIso: '2026-11-01', previousStartIso: '2026-09-01', previousEndExclusiveIso: '2026-10-01', timeZone: 'Europe/Madrid' };
  const rows = [
    { worker_id: 'own-worker', calls_total: 1, minutes_total: 10, minutes_free: 10, pay_minutes: 0.4, minutes_cliente: 0, minutes_repite: 0 },
    { worker_id: 'other-worker', calls_total: 3, minutes_total: 60, minutes_free: 60, pay_minutes: 2.4 },
  ];
  const route = compile('src/app/api/stats/monthly/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } },
    '@/lib/server/panel-attendance': attendance,
    '@/lib/server/auth-worker': { normalizeMonthKey: value => value || '2026-10', roundMoney: value => Math.round(Number(value || 0) * 100) / 100 },
    '@/lib/bonuses/engine': { applicable: () => true, captureTier: () => null, captureAmount: () => 0, rankingBonuses: () => ({ captadas: 0, cliente: 0, repite: 0 }), rankingPositions: () => ({}), sortRanking: values => values },
    '@/lib/server/tarotista-bonuses': { loadBonusRules: async () => [] },
    '@/lib/server/rendimiento-metrics': { aggregateRendimientoByTarotista: () => rows, listRendimientoRowsByIso: async () => { calls.metrics++; return []; }, listTarotistaWorkers: async () => [] },
    '@/lib/server/brand-filter': { brandFromRequest: () => null, filterRowsByBrand: async (_db, values) => values },
    '@/lib/server/economic-payments': { loadOfficialPayments: async () => [], totalOfficialRevenue: () => 0 },
    '@/lib/server/madrid-reporting-period': { fullMonthComparison: () => period, madridTodayKey: () => '2026-10-30', monthToDateComparison: () => period },
    '@/lib/server/tarotista-ranks': { loadTarotistaRankConfig: async () => [], resolveTarotistaRankState: () => ({ current: { code: 'fixture', benefit_config: {} } }) },
  });
  return { calls, get: token => route.GET(new Request('https://example.invalid/api/stats/monthly?month=2026-10&worker_id=other-worker', { headers: token ? { authorization: `Bearer ${token}` } : {} })) };
}

test('monthly stats require verified authentication before looking up workers or financial data', async () => {
  const missing = fixture(); assert.equal((await missing.get()).status, 401); assert.equal(missing.calls.auth.length, 0); assert.equal(missing.calls.lookups.length, 0);
  const forged = fixture({ invalid: true }); assert.equal((await forged.get('forged-claims')).status, 401); assert.deepEqual(forged.calls.auth, ['forged-claims']); assert.equal(forged.calls.lookups.length, 0); assert.equal(forged.calls.metrics, 0);
});

test('inactive, unrelated and unlinked accounts cannot read monthly staff statistics', async () => {
  for (const options of [{ worker: { is_active: false } }, { worker: { role: 'cliente' } }, { worker: null }]) {
    const f = fixture(options); assert.equal((await f.get('verified-fixture')).status, 403); assert.equal(f.calls.metrics, 0);
    assert.equal(f.calls.lookups.length, 1); assert.equal(f.calls.lookups[0].user_id, 'verified-user');
  }
});

test('a tarotista receives their own FREE minutes and current remuneration, ignoring a forged worker query', async () => {
  const f = fixture(); const response = await f.get('verified-fixture');
  assert.equal(response.status, 200); assert.equal(response.body.worker.id, 'own-worker');
  assert.equal(response.body.stats.minutes_free, 10); assert.equal(response.body.stats.pay_minutes, 0.4);
  assert.equal(response.body.rows, undefined); assert.equal(f.calls.lookups[1].id, 'own-worker');
});

test('level two keeps the existing earnings visibility rule and admin keeps the aggregate view', async () => {
  const restricted = fixture({ level: 2 }); assert.equal((await restricted.get('verified-fixture')).body.stats.pay_minutes, 0);
  const admin = fixture({ worker: { role: 'admin' } }); const response = await admin.get('verified-fixture');
  assert.equal(response.status, 200); assert.equal(response.body.rows.length, 2); assert.ok(response.body.previous);
});
