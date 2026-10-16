const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, overrides = {}) {
  const filename = path.resolve(__dirname, '..', relative);
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, console, Date, Set, Map, Error, ...overrides.globals, require(name) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`, overrides);
    if (name.startsWith('.')) return load(path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(filename), `${name}.ts`)), overrides);
    return require(name);
  } });
  return exports;
}
const helpers = load('src/lib/reservation-reminders.ts');
const now = Date.parse('2026-10-12T12:00:00Z');
const clientId = '10000000-0000-4000-8000-000000000001';
const id = '20000000-0000-4000-8000-000000000001';
const row = (milliseconds) => ({ id, clientId, clientName: 'Cliente de prueba', tarotistName: 'Luna', scheduledAt: new Date(now + milliseconds).toISOString(), actionPath: '/panel-central?tab=reservas' });

test('threshold boundaries are 10, 5 and 1 minutes, never early or after the scheduled time', () => {
  for (const [remaining, expected] of [[600001,null],[600000,10],[300001,10],[300000,5],[60001,5],[60000,1],[1,1],[0,null],[-1,null]]) {
    assert.equal(helpers.reservationThreshold(row(remaining).scheduledAt, now), expected, `${remaining}ms`);
  }
  assert.equal(helpers.reservationThreshold('invalid', now), null);
});

test('late entry produces a single current threshold and UTC-naive timestamps preserve the established storage convention', () => {
  assert.deepEqual(Array.from(helpers.reservationCandidates([row(240000)], now), item => item.threshold), [5]);
  assert.deepEqual(Array.from(helpers.reservationCandidates([row(50000)], now), item => item.threshold), [1]);
  assert.equal(helpers.reservationThreshold('2026-10-12T12:05:00', now), 5);
  assert.equal(helpers.reservationThreshold('2026-10-12T14:05:00+02:00', now), 5);
});

test('rescheduling changes deduplication identity and removes an old displayed reminder', () => {
  const old = row(240000), changed = row(540000);
  const reminder = helpers.reservationCandidates([old], now)[0];
  assert.notEqual(reminder.key, helpers.reservationCandidates([changed], now)[0].key);
  assert.equal(helpers.isCurrentReservationReminder(reminder, [changed], now), false);
  assert.equal(helpers.isCurrentReservationReminder(reminder, [], now), false);
  assert.equal(helpers.isCurrentReservationReminder(reminder, [old], now + 181000), false);
  assert.equal(helpers.isCurrentReservationReminder(reminder, [old], now), true);
});

class AssistantError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
function fixture(extra = {}) {
  const schedule = new Date(Date.now() + 240000).toISOString();
  const tables = {
    reservas: [{ id, cliente_id: clientId, cliente_nombre: 'Cliente de prueba', tarotista_nombre: 'Luna', estado: 'pendiente', fecha_reserva: schedule.replace('Z','') }],
    crm_client_capture_assignments: [{ client_id: clientId, responsible_worker_id: 'worker-a', status: 'confirmed', business: 'celestial' }],
    crm_clientes: [{ id: clientId, is_active: true, origen: 'celestial', telefono: 'must not leave the server' }],
    ...extra,
  };
  const deliveries = new Set(), queries = [];
  const db = { from(table) {
    const filters = []; let slice = [0, Infinity];
    const query = {
      select(columns) { queries.push({ table, columns, filters }); return this; },
      in(field, values) { filters.push({ field, values }); return this; },
      eq(field, value) { filters.push({ field, value }); return this; },
      is(field, value) { filters.push({ field, is: value }); return this; },
      gt(field, value) { filters.push({ field, gt: value }); return this; },
      lte(field, value) { filters.push({ field, lte: value }); return this; },
      order() { return this; },
      range(start, end) { slice = [start, end + 1]; return this; },
      insert(value) { const key = `${value.worker_id}:${value.key}`; if (deliveries.has(key)) return Promise.resolve({ error: { code: '23505' } }); deliveries.add(key); return Promise.resolve({ error: null }); },
      then(resolve, reject) { return Promise.resolve({ data: (tables[table] || []).filter(row => filters.every(filter => Object.hasOwn(filter, 'is') ? (row[filter.field] ?? null) === filter.is : filter.values ? filter.values.includes(row[filter.field]) : filter.gt ? row[filter.field] > filter.gt.replace('Z','') : filter.lte ? row[filter.field] <= filter.lte.replace('Z','') : row[filter.field] === filter.value)).slice(...slice), error: null }).then(resolve, reject); },
    }; return query;
  } };
  const ctx = { db, worker: { id: 'worker-a', user_id: 'auth-a' }, identityIds: ['worker-a'] };
  const server = load('src/lib/server/central-assistant-reservations.ts', {
    './central-assistant': { AssistantError, allRows: async make => { const result = await make(); if (result.error) throw result.error; return result.data; } },
    '@/lib/central-assistant': { normalizeText: value => value.toLowerCase(), validUuid: value => /^[0-9a-f-]{36}$/i.test(value) },
  });
  return { server, ctx, tables, deliveries, queries, schedule };
}

test('server only returns imminent active reservations for currently assigned Celestial clients', async () => {
  const f = fixture();
  const allowed = await f.server.upcomingReservations(f.ctx);
  assert.equal(allowed.length, 1);
  assert.deepEqual(Object.keys(allowed[0]).sort(), ['actionPath','clientId','clientName','id','scheduledAt','tarotistName']);
  assert.equal(allowed[0].scheduledAt, f.schedule);
  assert.ok(f.queries.find(query => query.table === 'crm_client_capture_assignments').filters.some(filter => filter.field === 'responsible_worker_id'));
  f.tables.crm_client_capture_assignments[0].responsible_worker_id = 'other-worker';
  assert.equal((await f.server.upcomingReservations(f.ctx)).length, 0);
  f.tables.crm_client_capture_assignments[0].responsible_worker_id = 'worker-a';
  f.tables.crm_clientes[0].is_active = false;
  assert.equal((await f.server.upcomingReservations(f.ctx)).length, 0);
  f.tables.crm_clientes[0].is_active = true;
  f.tables.crm_clientes[0].origen = 'orion';
  assert.equal((await f.server.upcomingReservations(f.ctx)).length, 0);
});

test('cancelled, completed, unknown and expired reservations never produce reminders', async () => {
  const f = fixture();
  for (const state of ['cancelada','anulada','completada','finalizada','unknown']) {
    f.tables.reservas[0].estado = state;
    assert.equal((await f.server.upcomingReservations(f.ctx)).length, 0, state);
  }
  f.tables.reservas[0].estado = 'pendiente';
  f.tables.reservas[0].fecha_reserva = new Date(Date.now() - 1000).toISOString();
  assert.equal((await f.server.upcomingReservations(f.ctx)).length, 0);
});

test('a deleted reservation is excluded even if its legacy state is still pending', async () => {
  const f = fixture();
  f.tables.reservas[0].deleted_at = new Date().toISOString();
  assert.equal((await f.server.upcomingReservations(f.ctx)).length, 0);
  assert.equal((await f.server.claimReservationReminder(f.ctx, { id, scheduledAt: f.schedule, threshold: 5 })).reason, 'stale');
  assert.equal(f.deliveries.size, 0);
});

test('simultaneous tabs and refresh claim a threshold only once per worker and scheduled time', async () => {
  const f = fixture(), input = { id, scheduledAt: f.schedule, threshold: 5 };
  const results = await Promise.all([f.server.claimReservationReminder(f.ctx, input), f.server.claimReservationReminder(f.ctx, input)]);
  assert.equal(results.filter(result => result.delivered).length, 1);
  assert.equal((await f.server.claimReservationReminder(f.ctx, input)).delivered, false);
  assert.equal(f.deliveries.size, 1);
  f.tables.reservas[0].fecha_reserva = new Date(Date.now() + 230000).toISOString();
  assert.equal((await f.server.claimReservationReminder(f.ctx, input)).reason, 'stale');
  assert.equal((await f.server.claimReservationReminder(f.ctx, { ...input, scheduledAt: f.tables.reservas[0].fecha_reserva })).delivered, true);
  assert.equal(f.deliveries.size, 2);
});

test('delivery rechecks cancellation and assignment after a schedule was fetched', async () => {
  const f = fixture(), input = { id, scheduledAt: f.schedule, threshold: 5 };
  await f.server.upcomingReservations(f.ctx);
  f.tables.reservas[0].estado = 'cancelada';
  assert.equal((await f.server.claimReservationReminder(f.ctx, input)).reason, 'stale');
  f.tables.reservas[0].estado = 'pendiente';
  f.tables.crm_client_capture_assignments[0].status = 'cancelled';
  assert.equal((await f.server.claimReservationReminder(f.ctx, input)).reason, 'stale');
  assert.equal(f.deliveries.size, 0);
});

test('stale thresholds cannot claim later reminders early or produce a cascade', async () => {
  const f = fixture();
  for (const threshold of [10,1]) assert.equal((await f.server.claimReservationReminder(f.ctx, { id, scheduledAt: f.schedule, threshold })).reason, 'stale');
  assert.equal(f.deliveries.size, 0);
});

function hookFixture() {
  const React = require('react'), renderer = require('react-test-renderer');
  const listeners = new Map(), intervals = new Map();
  let nextTimer = 1, authCallback, latest, component;
  let session = { user: { id: 'auth-a' }, access_token: 'token-a' };
  let clock = Date.now();
  class Clock extends Date { static now() { return clock; } }
  const document = { hidden: false, addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name) { listeners.delete(name); } };
  const window = {
    setInterval(callback, delay) { const key = nextTimer++; intervals.set(key, { callback, delay }); return key; },
    clearInterval(key) { intervals.delete(key); }, setTimeout() { return nextTimer++; }, clearTimeout() {},
    addEventListener: document.addEventListener, removeEventListener: document.removeEventListener,
  };
  const reservations = [{ ...row(240000), scheduledAt: new Date(clock + 240000).toISOString() }];
  const notices = [], claims = new Set(), requests = [];
  let failure = false, blockedGet;
  const hook = load('src/features/central/assistant/useReservationReminders.ts', {
    react: React,
    '@/lib/supabase-browser': { supabaseBrowser: () => ({ auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange(callback) { authCallback = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    } }) },
    globals: { window, document, AbortController, Date: Clock, fetch: async (_url, options) => {
      requests.push(options.method);
      if (failure) throw Error('Fuente de reservas no disponible');
      if (options.method === 'GET' && blockedGet) await blockedGet;
      if (options.signal.aborted) throw Error('Aborted');
      const identity = { workerId: 'worker-a', userId: 'auth-a', ok: true };
      if (options.method === 'GET') return { ok: true, json: async () => ({ ...identity, reservations: [...reservations], serverNow: new Date(clock).toISOString() }) };
      const body = JSON.parse(options.body), reminder = helpers.reservationCandidates(reservations, clock).find(item => item.id === body.id && item.threshold === body.threshold);
      const delivered = !!reminder && !claims.has(reminder.key);
      if (reminder) claims.add(reminder.key);
      return { ok: true, json: async () => ({ ...identity, delivered, reminder: delivered ? reminder : undefined, reason: reminder ? 'duplicate' : 'stale' }) };
    } },
  });
  function Component(props) { latest = hook.useReservationReminders({ enabled: true, workerId: 'worker-a', onReminder: reminder => notices.push(reminder), ...props }); return null; }
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const act = async callback => renderer.act(async () => { callback(); await settle(); });
  return {
    document, reservations, notices, requests, claims,
    get latest() { return latest; },
    async mount(props) { await act(() => { component = renderer.create(React.createElement(Component, props)); }); },
    async unmount() { await act(() => component.unmount()); },
    async update(props) { await act(() => component.update(React.createElement(Component, props))); },
    async event(name, detail) { await act(() => listeners.get(name)?.({ detail })); },
    async tick(delay) { await act(() => { for (const timer of intervals.values()) if (timer.delay === delay) timer.callback(); }); },
    async signOut() { await act(() => { session = null; authCallback('SIGNED_OUT', null); }); },
    advance(milliseconds) { clock += milliseconds; },
    fail() { failure = true; },
    blockGet(promise) { blockedGet = promise; },
    async settle() { await act(() => {}); },
  };
}

test('hook clears cancelled reminders immediately and reports fetch failure instead of serving a stale agenda', async () => {
  const h = hookFixture();
  await h.mount();
  assert.equal(h.latest.reminder.threshold, 5);
  assert.equal(h.notices.length, 1);
  h.reservations.length = 0;
  await h.event('tc-reservation-changed');
  assert.equal(h.latest.reminder, null);
  h.fail();
  await h.tick(25000);
  assert.match(h.latest.error, /no disponible/);
  assert.equal(h.latest.reminder, null);
  await h.unmount();
});

test('hook catches up on visibility and updates a displayed countdown without delivering duplicate notices', async () => {
  const h = hookFixture();
  h.document.hidden = true;
  await h.mount();
  assert.equal(h.requests.length, 0);
  h.document.hidden = false;
  await h.event('visibilitychange');
  assert.equal(h.latest.reminder.minutesRemaining, 4);
  h.advance(61000);
  await h.tick(25000);
  await h.tick(1000);
  assert.equal(h.latest.reminder.minutesRemaining, 3);
  assert.equal(h.notices.length, 1);
  await h.unmount();
});

test('creating an unrelated reservation preserves an already displayed reminder', async () => {
  const h = hookFixture();
  await h.mount();
  assert.equal(h.latest.reminder.id, id);
  await h.event('tc-reservation-changed', { id: '20000000-0000-4000-8000-000000000002' });
  assert.equal(h.latest.reminder.id, id);
  assert.equal(h.notices.length, 1);
  await h.unmount();
});

test('account switch and sign-out clear private reminders and reject an old in-flight response', async () => {
  const h = hookFixture();
  await h.mount();
  assert.ok(h.latest.reminder);
  await h.signOut();
  assert.equal(h.latest.reminder, null);
  await h.unmount();

  const pending = hookFixture();
  let release;
  pending.blockGet(new Promise(resolve => { release = resolve; }));
  await pending.mount();
  await pending.update({ workerId: 'worker-b' });
  release();
  await pending.settle();
  assert.equal(pending.latest.reminder, null);
  assert.equal(pending.notices.length, 0);
  await pending.unmount();
});
