const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, overrides = {}) {
  const filename = path.resolve(__dirname, '..', relative), exports = {};
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, Date, Response, console, ...overrides.globals, require(name) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts', overrides);
    if (name.startsWith('.')) return load(path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(filename), name + '.ts')), overrides);
    return require(name);
  } });
  return exports;
}
const helpers = load('src/lib/reservation-alerts.ts');
const due = Date.parse('2026-10-16T18:00:00Z'); // 20:00 Madrid.
const reservation = (extra = {}) => ({ id: 'booking-a', fecha_reserva: '2026-10-16T18:00:00', estado: 'pendiente', deleted_at: null, tarotista_id: 'tarotist-a', notify_when_tarotista_idle: true, ready_notified_at: null, updated_at: '2026-10-16T17:25:14.606612', ...extra });

test('20:00 Madrid never triggers the scheduled popup at creation or even 1ms early', () => {
  const row = reservation();
  for (const now of [Date.parse('2026-10-16T17:25:16Z'), due - 30000, due - 1]) assert.equal(helpers.reservationAlertDue(row, now), false);
  assert.equal(helpers.reservationAlertDue(row, due), true);
  assert.equal(helpers.reservationAlertDue(row, due + 5000), true);
  assert.equal(helpers.reservationAlertDue(row, due + 30001), false);
  assert.equal(helpers.reservationAlertDate(reservation({ fecha_reserva: '2026-10-16T20:00:00+02:00' })).getTime(), due);
});

test('cancelled, deleted, invalid or unknown bookings cannot produce a popup', () => {
  for (const estado of ['cancelada', 'anulada', 'eliminada', 'completada', 'finalizada', 'unknown']) assert.equal(helpers.reservationAlertDue(reservation({ estado }), due), false);
  assert.equal(helpers.reservationAlertDue(reservation({ deleted_at: '2026-10-16T17:30:00Z' }), due), false);
  assert.equal(helpers.reservationAlertDue(reservation({ fecha_reserva: 'invalid' }), due), false);
  assert.equal(helpers.reservationAlertDue(reservation({ estado: 'confirmada' }), due), true);
});

test('rescheduling creates a new delivery key and invalidates the old displayed popup', () => {
  const row = reservation(), later = reservation({ fecha_reserva: '2026-10-16T19:00:00' });
  assert.notEqual(helpers.reservationAlertKey(row), helpers.reservationAlertKey(later));
  assert.equal(helpers.sameReservationAlert(row, later), false);
  assert.equal(helpers.sameReservationAlert(row, reservation({ ready_notified_at: '2026-10-16T18:00:00Z' })), true);
  assert.equal(helpers.sameReservationAlert(row, reservation({ deleted_at: '2026-10-16T18:00:00Z' })), false);
});

function fixture(options = {}) {
  let clock = options.now ?? due;
  class Clock extends Date { constructor(value) { super(arguments.length ? value : clock); } static now() { return clock; } }
  const clone = value => JSON.parse(JSON.stringify(value));
  const calls = [];
  const tables = {
    workers: [{ id: 'worker-a', user_id: 'auth-a', role: 'central', is_active: true, ...options.worker }],
    reservas: [reservation(options.row)],
    pbx_extensions: options.extensions || [{ worker_id: 'tarotist-a', registered: true, status: 'registered', active_call_count: 0, extension: '200', label: 'Luna', last_seen_at: new Date(clock - 1000).toISOString(), updated_at: new Date(clock - 1000).toISOString() }],
  };
  const db = {
    auth: { async getUser(token) { calls.push({ kind: 'auth', token }); return options.authError ? { data: { user: null }, error: { message: 'Revoked' } } : { data: { user: { id: 'auth-a' } }, error: null }; } },
    from(table) {
      let patch, single = false, limit = Infinity;
      const filters = [];
      const query = {
        select() { return this; }, eq(field, value) { filters.push(['eq', field, value]); return this; },
        is(field, value) { filters.push(['is', field, value]); return this; },
        in(field, value) { filters.push(['in', field, value]); return this; },
        lte(field, value) { filters.push(['lte', field, value]); return this; },
        order() { return this; }, limit(value) { limit = value; return this; },
        maybeSingle() { single = true; return this; },
        update(value) { patch = value; return this; },
        then(resolve, reject) {
          if (patch && options.beforeClaim) options.beforeClaim(tables.reservas[0]);
          calls.push({ kind: patch ? 'update' : 'query', table, filters: clone(filters), patch: patch ? clone(patch) : undefined });
          const rows = tables[table].filter(row => filters.every(([op, field, value]) => op === 'is' ? (row[field] ?? null) === value : op === 'in' ? value.includes(row[field]) : op === 'lte' ? Date.parse(row[field] + (/(?:Z|[+-]\d{2}:\d{2})$/i.test(row[field]) ? '' : 'Z')) <= Date.parse(value) : row[field] === value)).slice(0, limit);
          if (patch) rows.forEach(row => Object.assign(row, patch));
          return Promise.resolve({ data: clone(single ? rows[0] || null : rows), error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const api = load('src/app/api/crm/reservas/ready/route.ts', { '@/lib/server/auth-cliente': { adminClient: () => db }, globals: { Date: Clock } });
  const request = token => new Request('https://example.test/api/crm/reservas/ready', { headers: token === false ? {} : { Authorization: 'Bearer test-token' } });
  return { tables, calls, async get(token) { const response = await api.GET(request(token)); return { status: response.status, body: await response.json(), response }; } };
}

test('ready authenticates with getUser and blocks disabled or wrong-role workers', async () => {
  const missing = fixture();
  assert.equal((await missing.get(false)).status, 401);
  assert.equal(missing.calls.length, 0);
  for (const options of [{ authError: true }, { worker: { is_active: false } }, { worker: { role: 'tarotista' } }]) {
    const f = fixture(options);
    assert.equal((await f.get()).status, options.authError ? 401 : 403);
    assert.equal(f.calls.some(c => c.table === 'reservas'), false);
    assert.equal(f.calls[0].kind, 'auth');
  }
});

test('ready cannot notify a future 20:00 booking immediately after its 19:25 creation', async () => {
  const f = fixture({ now: Date.parse('2026-10-16T17:25:16Z') });
  const result = await f.get();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.reservas, []);
  assert.equal(f.tables.reservas[0].ready_notified_at, null);
  assert.equal(f.calls.some(c => c.table === 'pbx_extensions'), false);
});

test('when due, ready claims only one booking and preserves confirmed state', async () => {
  const f = fixture({ row: { estado: 'confirmada' } });
  f.tables.reservas.push(reservation({ id: 'booking-b' }));
  const result = await f.get();
  assert.equal(result.body.reservas.length, 1);
  assert.equal(result.body.reservas[0].estado, 'confirmada');
  assert.equal(f.tables.reservas[1].ready_notified_at, null);
  assert.deepEqual(Object.keys(f.calls.find(c => c.kind === 'update').patch), ['ready_notified_at']);
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
});

test('missing, inactive, offline, unknown, busy or stale telemetry never means available', async () => {
  const base = fixture().tables.pbx_extensions[0];
  const variants = [[], [{ ...base, is_active: false }], [{ ...base, registered: false }], [{ ...base, status: 'offline' }], [{ ...base, status: 'unknown' }], [{ ...base, status: 'in_call' }], [{ ...base, active_call_count: 1 }], [{ ...base, active_call_count: null }], [{ ...base, last_seen_at: null }], [{ ...base, last_seen_at: '2026-04-29T00:00:00Z' }], [{ ...base, last_seen_at: new Date(due - 20000).toISOString() }]];
  for (const extensions of variants) {
    const f = fixture({ extensions });
    assert.equal((await f.get()).body.reservas.length, 0, JSON.stringify(extensions));
    assert.equal(f.tables.reservas[0].ready_notified_at, null);
  }
});

test('PBX timestamps without a zone keep the same UTC convention as reservations', async () => {
  const base = fixture().tables.pbx_extensions[0];
  const f = fixture({ extensions: [{ ...base, last_seen_at: '2026-10-16T17:59:59' }] });
  assert.equal((await f.get()).body.reservas.length, 1);
});

test('cancelled or soft-deleted bookings are filtered before PBX lookup', async () => {
  for (const row of [{ estado: 'cancelada' }, { estado: 'completada' }, { deleted_at: '2026-10-16T17:50:00Z' }]) {
    const f = fixture({ row });
    assert.equal((await f.get()).body.reservas.length, 0);
    assert.equal(f.calls.some(c => c.table === 'pbx_extensions'), false);
  }
});

test('a concurrent cancellation, deletion, reschedule or edit prevents the claim and cannot reopen it', async () => {
  for (const patch of [{ estado: 'cancelada' }, { deleted_at: '2026-10-16T18:00:00Z' }, { fecha_reserva: '2026-10-16T19:00:00' }, { updated_at: '2026-10-16T17:59:59' }, { notify_when_tarotista_idle: false }]) {
    const f = fixture({ beforeClaim: row => Object.assign(row, patch) });
    assert.equal((await f.get()).body.reservas.length, 0);
    assert.equal(f.tables.reservas[0].ready_notified_at, null);
    for (const [key, value] of Object.entries(patch)) assert.equal(f.tables.reservas[0][key], value);
  }
});

test('two pollers cannot both claim the same ready alert', async () => {
  const f = fixture();
  const results = await Promise.all([f.get(), f.get()]);
  assert.equal(results.reduce((sum, r) => sum + r.body.reservas.length, 0), 1);
  assert.equal((await f.get()).body.reservas.length, 0);
});
