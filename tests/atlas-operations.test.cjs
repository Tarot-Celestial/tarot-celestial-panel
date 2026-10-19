const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const exportsObject = {};
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/server/atlas-operations.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(code, { exports: exportsObject, console, Intl, Date, Map, Set, Number });
const { productionSummary, ecuadorDay, nextWorkerDeadline } = exportsObject;
const paid = (id, client, amount, time, extra = {}) => ({ id, cliente_id: client, importe: amount, moneda: 'EUR', estado: 'completed', created_at: time, ...extra });

test('business calendar, confirmed EUR sums, cents, duplicate call exclusion and monthly captures', () => {
  const now = new Date('2026-10-19T16:00:00Z');
  const payments = [paid('1', 'a', 150.1, '2026-10-19T05:00:00Z'), paid('2', 'b', 150.2, '2026-10-19T13:00:00Z'),
    paid('3', 'c', 100, '2026-10-19T04:59:59Z'), paid('4', 'd', 99, '2026-10-19T12:00:00Z', { moneda: 'USD' }),
    paid('5', 'e', 99, '2026-10-19T12:00:00Z', { estado: 'pending' }), paid('6', 'f', -1, '2026-10-19T12:00:00Z')];
  const captures = [{ client_id: 'a', captured_at: '2026-10-19T13:00:00Z', first_purchase_at: '2026-10-01T05:00:00Z' }, { client_id: 'c', captured_at: '2026-10-19T13:00:00Z', first_purchase_at: '2026-10-01T04:59:59Z' }];
  const result = productionSummary(payments, captures, [], [], [], now);
  assert.equal(result.today.revenue, 300.3); assert.equal(result.today.purchases, 2);
  assert.equal(result.monthCaptures, 1); assert.equal(result.history.length, 30);
  assert.equal(ecuadorDay(new Date('2026-10-19T04:59:59Z')), '2026-10-18');
});

test('conversion only counts verified later payments and separates declared interest', () => {
  const outcomes = [{ client_id: 'a', channel: 'phone', outcome: 'interested', created_at: '2026-10-19T10:00:00Z' },
    { client_id: 'b', channel: 'whatsapp', outcome: 'no_answer', created_at: '2026-10-19T10:00:00Z' },
    { client_id: 'a', channel: 'phone', outcome: 'followup', created_at: '2026-10-19T11:00:00Z' }];
  const payments = [paid('1', 'a', 20, '2026-10-19T12:00:00Z'), paid('2', 'b', 20, '2026-10-19T09:00:00Z')];
  const { funnel } = productionSummary(payments, [], [], [], outcomes, new Date('2026-10-19T16:00:00Z'));
  assert.equal(funnel.contactsWithResult, 2); assert.equal(funnel.interested, 1); assert.equal(funnel.bought, 1);
  assert.equal(funnel.channels.find(c => c.channel === 'phone').sampleEnough, false);
});

test('default task deadline respects Ecuador shift end and advances past weekend', () => {
  assert.equal(nextWorkerDeadline('07:00:00', '15:00:00', new Date('2026-10-23T19:59:59Z')), '2026-10-23T20:00:00.000Z');
  assert.equal(nextWorkerDeadline('07:00:00', '15:00:00', new Date('2026-10-23T20:00:00Z')), '2026-10-26T20:00:00.000Z');
  assert.equal(nextWorkerDeadline('15:00:00', '23:00:00', new Date('2026-10-24T02:00:00Z')), '2026-10-24T04:00:00.000Z');
});

function overviewHarness() {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const tables = {
    crm_cliente_pagos: [paid(id(100), id(10), 300, '2026-10-19T12:00:00Z'), paid(id(101), id(11), 90, '2026-10-19T12:00:00Z'), paid(id(102), id(12), 90, '2026-10-19T12:00:00Z')],
    crm_clientes: [{ id: id(10), origen: 'celestial' }, { id: id(11), origen: 'orion' }],
    crm_client_capture_assignments: [], crm_recovery_contact_events: [], crm_recovery_daily_results: [], atlas_admin_jobs: [], atlas_admin_job_outcomes: [], crm_client_followups: [],
    workers: [{ id: id(2), display_name: 'Isa', role: 'central', is_active: true }],
    atlas_admin_settings: [{ singleton: true, daily_revenue_goal: 300, monthly_capture_goal: 10, timezone: 'America/Guayaquil' }], v_attendance_incidents: [],
  };
  const errors = new Set(), queries = [];
  const ctx = { worker: { id: id(1), user_id: id(1), role: 'admin', display_name: 'Admin' }, db: {
    rpc: async name => ({ data: { missions: [], timezone: 'America/Guayaquil' }, error: null }),
    from(table) {
      queries.push(table); let data = [...(tables[table] || [])], single = false;
      const q = { select(columns) { assert.ok(!columns.includes('!inner'), 'production has no client FK'); return q; },
        eq(key, value) { data = data.filter(row => row[key] === value); return q; },
        gte(key, value) { data = data.filter(row => row[key] >= value); return q; },
        lte(key, value) { data = data.filter(row => row[key] <= value); return q; },
        in(key, values) { data = data.filter(row => values.includes(row[key])); return q; },
        is(key, value) { data = data.filter(row => row[key] === value); return q; },
        or() { return q; }, order() { return q; }, range(a, b) { data = data.slice(a, b + 1); return q; },
        single() { single = true; return q; },
        then(resolve, reject) { return Promise.resolve(errors.has(table) ? { error: { code: 'SOURCE_UNAVAILABLE' }, data: null } : { error: null, data: single ? data[0] : data }).then(resolve, reject); } };
      return q;
    },
  } };
  return { ctx, tables, errors, queries, id };
}

test('overview global target is strictly greater than EUR300 and joins verified brand without an FK', async () => {
  const h = overviewHarness();
  const result = await exportsObject.overview(h.ctx, new Date('2026-10-19T16:00:00Z'));
  assert.equal(result.revenue.today, 300); assert.equal(result.revenue.met, false);
  assert.equal(result.revenue.goal, 300); assert.equal(result.acquisition.goal, 10);
  assert.ok(h.queries.includes('crm_clientes')); assert.ok(!h.queries.includes('central_assistant_memories'));
  h.tables.crm_cliente_pagos[0].importe = 300.01;
  assert.equal((await exportsObject.overview(h.ctx, new Date('2026-10-19T16:00:00Z'))).revenue.met, true);
});

test('overview failed source stays unknown while independent mission/job data remains visible', async () => {
  const h = overviewHarness(); h.errors.add('crm_cliente_pagos');
  h.tables.atlas_admin_jobs.push({ id: h.id(900), worker_id: h.id(2), title: 'Revisar seguimiento', status: 'pending', created_at: '2026-10-19T10:00:00Z' });
  const result = await exportsObject.overview(h.ctx, new Date('2026-10-19T16:00:00Z'));
  assert.equal(result.revenue.today, null); assert.equal(result.revenue.met, null);
  assert.ok(result.unavailable.includes('Pagos confirmados'));
  assert.equal(result.pendingJobs.length, 1); assert.equal(result.history.at(-1).revenue, null);
  assert.equal(result.patterns.periods, null);
});

test('overview counts confirmed captures only with a verified first purchase in the requested month', async () => {
  const h = overviewHarness();
  h.tables.crm_client_capture_assignments = [{ client_id: h.id(10), captured_at: '2026-10-19T12:00:00Z', captured_by_worker_id: h.id(2), status: 'confirmed', business: 'celestial' },
    { client_id: h.id(13), captured_at: '2026-10-19T12:00:00Z', captured_by_worker_id: h.id(2), status: 'confirmed', business: 'celestial' }];
  let result = await exportsObject.overview(h.ctx, new Date('2026-10-19T16:00:00Z'));
  assert.equal(result.acquisition.count, 1);
  assert.ok(result.anomalies.some(a => a.id === 'captures-without-payment'));
  h.tables.crm_cliente_pagos.push(paid(h.id(103), h.id(10), 20, '2026-09-20T12:00:00Z'));
  result = await exportsObject.overview(h.ctx, new Date('2026-10-19T16:00:00Z'));
  assert.equal(result.acquisition.count, 0);
});

test('Atlas promises remain visible after task completion, with due dates and partial-source status', async () => {
  const h=overviewHarness();
  h.tables.atlas_current_followups=[{id:h.id(950),worker_id:h.id(2),client_id:h.id(10),next_contact_at:'2026-10-19T14:00:00Z',created_at:'2026-10-18T14:00:00Z'},
    {id:h.id(951),worker_id:h.id(2),client_id:h.id(11),next_contact_at:'2026-10-20T14:00:00Z',created_at:'2026-10-18T14:00:00Z'}];
  let result=await exportsObject.overview(h.ctx,new Date('2026-10-19T16:00:00Z'));
  assert.equal(result.followupSummary.overdue,1);assert.equal(result.followupSummary.upcoming,1);assert.equal(result.followupSummary.partial,false);
  assert.equal(result.followupSummary.byWorker[0].worker_id,h.id(2));
  assert.equal(result.followups[0].source,'atlas_current_followups');
  assert.match(result.alerts.find(a=>a.id==='overdue-followups').evidence[0],/Isa.*Ecuador.*Acuerdo de Atlas/);
  h.errors.add('atlas_current_followups');result=await exportsObject.overview(h.ctx,new Date('2026-10-19T16:00:00Z'));
  assert.equal(result.followupSummary.partial,true);assert.ok(result.unavailable.includes('Seguimientos de Atlas'));
});
