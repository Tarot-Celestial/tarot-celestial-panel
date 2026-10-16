const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/central-daily-performance.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsObject, Intl, Date, Map, Set });
const { buildCentralDailyPerformance: build, selectCentralDayXpEvents: selectDay } = exportsObject;
const now = new Date('2026-10-16T12:30:00+02:00');
let seq = 0;
const event = (day, xp, time = '09:00:00', extra = {}) => ({
  id: `event-${++seq}`, worker_id: 'isa', status: 'applied', xp_amount: xp,
  created_at: `${day}T${time}+02:00`, ...extra,
});
const baseline = () => ['2026-10-13', '2026-10-14', '2026-10-15'].map(day => event(day, 100));
const run = (events, date = '2026-10-16', at = now) => build(events, date, { workerId: 'isa', now: at });

test('new workers and days without positive XP stay neutral', () => {
  const empty = run([]);
  assert.equal(empty.status, 'neutral'); assert.equal(empty.reason, 'no_activity');
  assert.equal(empty.reference_xp, null); assert.equal(empty.current_xp, 0);
  const newWorker = run([event('2026-10-16', 80)]);
  assert.equal(newWorker.status, 'neutral'); assert.equal(newWorker.reason, 'insufficient_history');
  assert.equal(newWorker.current_xp, 80); assert.equal(newWorker.ratio_percent, null);
  const noActivity = run(baseline());
  assert.equal(noActivity.status, 'neutral'); assert.equal(noActivity.reference_xp, 100);
});

test('compares today at the same Madrid clock time and does not draw future activity', () => {
  const result = run([...baseline(), ...['2026-10-13', '2026-10-14', '2026-10-15'].map(day => event(day, 1000, '13:00:00')),
    event('2026-10-16', 80, '12:15:00'), event('2026-10-16', 900, '13:00:00')]);
  assert.equal(result.reference_xp, 100); assert.equal(result.current_xp, 80); assert.equal(result.status, 'medium');
  assert.equal(result.hourly.length, 25); assert.equal(result.cutoff_hour, 12.5);
  assert.equal(result.hourly[0].hour, 0); assert.equal(result.hourly[0].cumulative_xp, 0);
  assert.equal(result.hourly[10].hour, 10); assert.equal(result.hourly[10].reference_xp, 100);
  assert.equal(result.hourly[13].hour, 12.5); assert.equal(result.hourly[13].label, '12:30');
  assert.equal(result.hourly[13].cumulative_xp, 80);
  assert.equal(result.hourly[14].cumulative_xp, null); assert.equal(result.hourly[14].reference_xp, null);
});

test('thresholds are transparent and boundaries are not rounded into another band', () => {
  for (const [xp, status] of [[100, 'good'], [120, 'good'], [99.9, 'medium'], [70, 'medium'], [69.9, 'low']]) {
    const result = run([...baseline(), event('2026-10-16', xp)]);
    assert.equal(result.status, status); assert.equal(result.ratio_percent, xp);
    assert.match(result.description, /referencia orientativa, no un objetivo/);
  }
});

test('requires three comparable active days rather than assuming absent shifts performed badly', () => {
  const result = run([event('2026-10-13', 100), event('2026-10-14', 100), event('2026-10-15', 500, '18:00:00'), event('2026-10-16', 60)]);
  assert.equal(result.sample_days, 2); assert.equal(result.status, 'neutral'); assert.equal(result.reference_xp, null);
});

test('uses median of at most seven recent active days within the previous 28 Madrid days', () => {
  const events = [];
  for (let day = 1; day <= 15; day++) events.push(event(`2026-10-${String(day).padStart(2, '0')}`, day === 15 ? 10000 : day));
  events.push(event('2026-09-17', 900000), event('2026-10-16', 12));
  const result = run(events);
  assert.equal(result.sample_days, 7); assert.equal(result.reference_xp, 12);
  assert.equal(result.baseline_dates[0], '2026-10-15'); assert.equal(result.baseline_dates.at(-1), '2026-10-09');
  const boundary = run([event('2026-09-18', 10), event('2026-09-17', 999), event('2026-10-14', 10), event('2026-10-15', 10), event('2026-10-16', 10)]);
  assert.equal(boundary.sample_days, 3); assert.equal(boundary.reference_xp, 10);
});

test('historical selection compares complete earlier days and cannot use later days as reference', () => {
  const result = run([event('2026-10-11', 100, '20:00:00'), event('2026-10-12', 120, '20:00:00'),
    event('2026-10-13', 140, '20:00:00'), event('2026-10-14', 130, '21:00:00'), event('2026-10-15', 9999)], '2026-10-14');
  assert.equal(result.reference_xp, 120); assert.equal(result.current_xp, 130); assert.equal(result.cutoff_hour, 24);
  assert.equal(result.hourly.at(-1).hour, 24); assert.equal(result.hourly.at(-1).label, '24:00');
  assert.equal(result.hourly.at(-1).cumulative_xp, 130);
});

test('only counts this worker applied valid events and deduplicates stable IDs', () => {
  const valid = event('2026-10-16', '80');
  const result = run([...baseline(), valid, { ...valid }, event('2026-10-16', 999, '09:00:00', { worker_id: 'other' }),
    event('2026-10-16', 999, '09:00:00', { status: 'pending' }), event('2026-10-16', NaN),
    event('2026-10-16', Infinity), event('2026-10-16', true), event('2026-10-16', ''),
    event('2026-10-16', 123, '09:00:00', { created_at: 'invalid' })]);
  assert.equal(result.current_xp, 80); assert.equal(result.status, 'medium');
  assert.equal(build([valid], '2026-10-16', { workerId: '', now }).current_xp, 0);
});

test('keeps corrections in the real net XP without treating a zero-net day as poor work', () => {
  const result = run([...baseline(), event('2026-10-16', 20), event('2026-10-16', -20)]);
  assert.equal(result.current_xp, 0); assert.equal(result.status, 'neutral');
});

test('Madrid date boundaries and daylight saving time are honored', () => {
  const midnight = run([event('2026-10-16', 20, '00:15:00'), event('2026-10-15', 90, '23:59:00')]);
  assert.equal(midnight.current_xp, 20);
  const spring = run([{ ...event('2026-03-29', 40), created_at: '2026-03-29T01:30:00Z' }],
    '2026-03-29', new Date('2026-03-29T02:00:00Z'));
  assert.equal(spring.current_xp, 40); assert.equal(spring.hourly[4].xp, 40); assert.equal(spring.cutoff_hour, 4);
  const fall = run([{ ...event('2026-10-25', 10), created_at: '2026-10-25T00:30:00Z' },
    { ...event('2026-10-25', 20), created_at: '2026-10-25T01:30:00Z' }], '2026-10-25', new Date('2026-10-26T12:00:00Z'));
  assert.equal(fall.current_xp, 30); assert.equal(fall.hourly[3].xp, 30);
  const repeatedHour = run([{ ...event('2026-10-25', 10), created_at: '2026-10-25T00:30:00Z' },
    { ...event('2026-10-25', 20), created_at: '2026-10-25T01:30:00Z' }], '2026-10-25', new Date('2026-10-25T01:15:00Z'));
  assert.equal(repeatedHour.current_xp, 10); assert.equal(repeatedHour.cutoff_hour, 2.25);
  assert.equal(repeatedHour.hourly[3].cumulative_xp, 10);
});

test('invalid and future selected dates are rejected instead of presenting misleading zeroes', () => {
  assert.throws(() => run([], '2026-02-30'), /INVALID_PERFORMANCE_DATE/);
  assert.throws(() => run([], '2026-10-17'), /FUTURE_PERFORMANCE_DATE/);
});

test('activity list and chart agree at exact Madrid midnight with Postgres +00:00 timestamps', () => {
  const midnight = { ...event('2026-10-16', 20), created_at: '2026-10-15T22:00:00+00:00' };
  const rows = [midnight, { ...midnight },
    { ...event('2026-10-16', 11), created_at: '2026-10-15T21:59:59.999Z' },
    { ...event('2026-10-16', 44), created_at: '2026-10-16T22:00:00+00:00' },
    event('2026-10-16', 9, '13:00:00'), event('2026-10-16', 5, '12:30:00')];
  const selected = selectDay(rows, { workerId: 'isa', start: '2026-10-15T22:00:00.000Z', end: '2026-10-16T22:00:00.000Z', now });
  const result = run(rows);
  assert.equal(selected.length, 2); assert.equal(selected.reduce((sum, row) => sum + Number(row.xp_amount), 0), result.current_xp);
  assert.equal(result.current_xp, 25);
});

test('mission GET uses the current daily period, never the selected historical summary day', () => {
  const route = fs.readFileSync(path.join(__dirname, '../src/app/api/central/xp-system/route.ts'), 'utf8');
  const file = ts.createSourceFile('route.ts', route, ts.ScriptTarget.Latest, true);
  const declarations = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ['periodInfo', 'activeMissions'].includes(node.name.getText(file))) declarations.set(node.name.getText(file), node.getText(file));
    ts.forEachChild(node, visit);
  }
  visit(file);
  const context = {
    Date, Set, Math, num: value => Number(value) || 0,
    operationalDay: { date: '2026-10-12', start: '2026-10-11T22:00:00.000Z', end: '2026-10-12T22:00:00.000Z' },
    missionToday: { date: '2026-10-16', start: '2026-10-15T22:00:00.000Z', end: '2026-10-16T22:00:00.000Z' },
    missionSnapshot: now, week: new Date('2026-10-12T00:00:00Z'), monthStartDate: new Date('2026-10-01T00:00:00Z'),
    missionSystemAvailable: true, unlockedIds: new Set(['daily']), missionClaimsR: { data: [] },
    missionsR: { data: [{ id: 'daily', period: 'daily', source_action_key: 'capture', target_count: 2, max_claims: 1 }] },
    events: [
      { action_key: 'capture', created_at: '2026-10-12T10:00:00+00:00' },
      { action_key: 'capture', created_at: '2026-10-15T22:00:00+00:00' },
      { action_key: 'capture', created_at: '2026-10-16T22:00:00+00:00' },
      { action_key: 'capture', created_at: '2026-10-16T20:00:00+00:00' },
    ],
  };
  vm.runInNewContext(ts.transpileModule(`const ${declarations.get('periodInfo')}; const ${declarations.get('activeMissions')}; globalThis.result=activeMissions; globalThis.period=periodInfo;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  assert.equal(context.result[0].period_key, '2026-10-16');
  assert.equal(context.result[0].progress, 1); assert.equal(context.result[0].completed, false);
  assert.equal(context.period('weekly').key, '2026-10-12'); assert.equal(context.period('weekly').end, '2026-10-19T00:00:00.000Z');
  assert.equal(context.period('monthly').key, '2026-10'); assert.equal(context.period('monthly').end, '2026-11-01T00:00:00.000Z');
});

test('mission POST eligibility uses Madrid midnight and cannot borrow next-day events for a historical claim', () => {
  const route = fs.readFileSync(path.join(__dirname, '../src/app/api/central/xp-system/route.ts'), 'utf8');
  const file = ts.createSourceFile('route.ts', route, ts.ScriptTarget.Latest, true);
  const names = ['claimSnapshot', 'claimedDay', 'start', 'startInstant', 'end', 'matching', 'count'];
  const declarations = new Map();
  const postStart = route.indexOf('export async function POST');
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.pos > postStart && names.includes(node.name.getText(file))) declarations.set(node.name.getText(file), node.getText(file));
    ts.forEachChild(node, visit);
  }
  visit(file);
  const functions = ['zonedParts', 'zonedMidnightUtc', 'buildOperationalDay'].map(name => file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(file));
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now.getTime()])); }
    static now() { return now.getTime(); }
  }
  const execute = (periodKey, period = 'daily') => {
    const context = {
      Date: FixedDate, Intl, Set, mission: { period, source_action_key: 'capture', unique_clients: false }, periodKey,
      xpR: { data: [
        { action_key: 'capture', created_at: '2026-10-15T21:59:59.999Z' },
        { action_key: 'capture', created_at: '2026-10-15T22:00:00+00:00' },
        { action_key: 'capture', created_at: '2026-10-16T10:00:00+00:00' },
        { action_key: 'capture', created_at: '2026-10-16T22:00:00+00:00' },
      ] },
    };
    const body = `const APP_TIMEZONE="Europe/Madrid"; ${functions.join('\n')} ${names.map(name => `const ${declarations.get(name)};`).join('\n')} globalThis.result={start,end,count};`;
    vm.runInNewContext(ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    return context.result;
  };
  const today = execute('2026-10-16');
  assert.equal(today.start, '2026-10-15T22:00:00.000Z'); assert.equal(today.end, '2026-10-16T22:00:00.000Z');
  assert.equal(today.count, 2);
  const yesterday = execute('2026-10-15'); assert.equal(yesterday.count, 1);
  assert.equal(execute('2026-10-12', 'weekly').start, '2026-10-12T00:00:00.000Z');
  assert.equal(execute('2026-10-12', 'weekly').end, '2026-10-19T00:00:00.000Z');
  assert.equal(execute('2026-10', 'monthly').end, '2026-11-01T00:00:00.000Z');
});

test('mission claim rejects arbitrary, noncanonical and future period keys before calling its reward RPC', async () => {
  const route = fs.readFileSync(path.join(__dirname, '../src/app/api/central/xp-system/route.ts'), 'utf8');
  const file = ts.createSourceFile('route.ts', route, ts.ScriptTarget.Latest, true);
  const selectedFunctions = ['zonedParts', 'validMissionPeriodKey'].map(name => file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(file));
  const post = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'POST');
  let guard;
  function visit(node) {
    if (ts.isIfStatement(node) && node.expression.getText(file).includes('validMissionPeriodKey(')) guard = node.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(post);
  assert.ok(guard, 'POST must reject invalid keys, not merely expose a validation helper');
  const context = { Date, Intl, NextResponse: { json: (body, options) => ({ body, status: options.status }) }, claimSnapshot: now };
  vm.runInNewContext(ts.transpileModule(`const APP_TIMEZONE="Europe/Madrid"; ${selectedFunctions.join('\n')} globalThis.validate=validMissionPeriodKey; globalThis.claim=(mission,periodKey)=>{ ${guard} return "accepted"; };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  for (const [period, keys] of [
    ['daily', ['different-key', '2026-10-16#2', '2026-10-16\n', '2026-2-01', '2026-02-30', '2026-10-17']],
    ['weekly', ['different-key', '2026-10-12#2', '2026-10-13', '2026-10-19', '2026-02-30']],
    ['monthly', ['different-key', '2026-10#2', '2026-1', '2026-13', '2026-11', '2026-10\n']],
  ]) {
    for (const key of keys) {
      const result = context.claim({ period }, key);
      assert.equal(result.status, 400, `${period} ${JSON.stringify(key)}`);
      assert.equal(result.body.error, 'INVALID_MISSION_PERIOD');
    }
  }
  for (const [period, key] of [['daily', '2026-10-16'], ['daily', '2026-10-15'], ['weekly', '2026-10-12'], ['weekly', '2026-10-05'], ['monthly', '2026-10'], ['monthly', '2026-09']]) {
    assert.equal(context.claim({ period }, key), 'accepted');
  }
  assert.equal(context.validate('daily', '2026-10-17', new Date('2026-10-16T22:30:00Z')), true, 'Madrid day starts before UTC midnight');
});

test('the real API event loader paginates past 1000 rows with worker and applied filters on every page', async () => {
  const route = fs.readFileSync(path.join(__dirname, '../src/app/api/central/xp-system/route.ts'), 'utf8');
  const file = ts.createSourceFile('route.ts', route, ts.ScriptTarget.Latest, true);
  const loader = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'loadAllAppliedXpEvents');
  assert.ok(loader);
  const context = {};
  vm.runInNewContext(ts.transpileModule(loader.getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const pages = [], rows = Array.from({ length: 1005 }, (_, index) => ({ id: `xp-${index}` }));
  const admin = { from(table) {
    const page = { table, filters: [] }; pages.push(page);
    return {
      select() { return this; }, eq(key, value) { page.filters.push([key, value]); return this; },
      order() { return this; }, range(start, end) { page.start = start; page.end = end; return this; },
      then(resolve) { return Promise.resolve({ data: rows.slice(page.start, page.end + 1), error: null }).then(resolve); },
    };
  } };
  const loaded = await context.loadAllAppliedXpEvents(admin, 'isa');
  assert.equal(loaded.length, 1005); assert.equal(pages.length, 2);
  assert.equal(pages[0].start, 0); assert.equal(pages[1].start, 1000);
  pages.forEach(page => {
    assert.equal(page.table, 'worker_xp_events');
    assert.deepEqual(page.filters, [['status', 'applied'], ['worker_id', 'isa']]);
  });
});
