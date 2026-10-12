const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const TABLE = 'central_assistant_learning_episodes';
const NOW = Date.parse('2026-10-12T12:00:00Z');
const DAY = 86400000;
const HOUR = 3600000;
const WORKER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const SECRET = '44444444-4444-4444-8444-444444444444';
const EPISODE = '55555555-5555-4555-8555-555555555555';
const SOURCE = '66666666-6666-4666-8666-666666666666';
const AUTH = 'auth-a';
const iso = n => new Date(n).toISOString();
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const uuid = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;

function episode(changes = {}) {
  return {
    id: EPISODE, worker_id: WORKER, source_key: `recovery:${CLIENT}:0`, source_id: CLIENT, client_id: CLIENT,
    strategy: 'recovery_loyal', title: 'Propuesta de recuperación', reason: 'Última llamada hace tiempo', expected_outcome: 'Observar una llamada posterior',
    baseline: { last_call: 0 }, state: 'suggested', created_at: iso(NOW - 10 * DAY), updated_at: iso(NOW - 10 * DAY),
    tried_at: null, deadline_at: null, resolved_at: null, evidence: null, feedback: null, feedback_note: null, feedback_at: null,
    ...changes,
  };
}
function trying(changes = {}) {
  return episode({ state: 'trying', tried_at: iso(NOW - DAY), deadline_at: iso(NOW + 6 * DAY), updated_at: iso(NOW - DAY), baseline: { last_call: 0, observation_complete: false }, ...changes });
}
function expired(changes = {}) {
  return trying({ tried_at: iso(NOW - 8 * DAY), deadline_at: iso(NOW - DAY), updated_at: iso(NOW - 8 * DAY), ...changes });
}

function database(overrides = {}, failures = {}) {
  const tables = copy({
    [TABLE]: [], workers: [{ id: WORKER, user_id: AUTH, role: 'central', display_name: 'Central A', is_active: true }],
    crm_client_capture_assignments: [{ client_id: CLIENT, responsible_worker_id: WORKER, business: 'tarot', status: 'confirmed' }],
    crm_clientes: [{ id: CLIENT, nombre: 'Ana', apellido: 'López', is_active: true }, { id: SECRET, nombre: 'Privada', apellido: 'Ajena', is_active: true }],
    rendimiento_llamadas: [], crm_client_followups: [], v_attendance_incidents: [], ...overrides,
  });
  let sequence = 1000;
  const queries = [], authCalls = [];
  const db = { tables, queries, failures, authCalls, clock: { now: NOW }, auth: { async getUser(token) {
    authCalls.push(token);
    return token === 'valid' ? { data: { user: { id: AUTH } }, error: null } : { data: { user: null }, error: { code: 'INVALID_TOKEN' } };
  } }, from(table) {
    const filters = [], sorts = [];
    let from = 0, to = Infinity, single = false, operation = 'select', patch, records, upsertOptions, returning = true;
    const query = { table, filters, operation }; queries.push(query);
    const builder = {
      select() { returning = true; return this; },
      eq(key, value) { filters.push([key, 'eq', value]); return this; },
      in(key, value) { filters.push([key, 'in', value]); return this; },
      is(key, value) { filters.push([key, 'is', value]); return this; },
      gt(key, value) { filters.push([key, 'gt', value]); return this; },
      gte(key, value) { filters.push([key, 'gte', value]); return this; },
      lt(key, value) { filters.push([key, 'lt', value]); return this; },
      lte(key, value) { filters.push([key, 'lte', value]); return this; },
      order(key, options) { sorts.push([key, options?.ascending !== false]); return this; },
      range(a, b) { from = a; to = b; return this; },
      limit(n) { to = from + n - 1; return this; },
      maybeSingle() { single = true; return this; },
      update(value) { operation = query.operation = 'update'; patch = copy(value); query.patch = patch; returning = false; return this; },
      upsert(values, options) { operation = query.operation = 'upsert'; records = copy(Array.isArray(values) ? values : [values]); upsertOptions = options; returning = false; return this; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (failures[table]) return { data: null, error: { code: failures[table] } };
          let rows = tables[table] || [];
          const matches = row => filters.every(([key, op, value]) => {
            const actual = row[key];
            return op === 'eq' ? actual === value : op === 'in' ? value.includes(actual) : op === 'is' ? (actual ?? null) === value
              : op === 'gt' ? actual > value : op === 'gte' ? actual >= value : op === 'lt' ? actual < value : actual <= value;
          });
          if (operation === 'upsert') {
            const result = [];
            for (const record of records) {
              const conflictFields = (upsertOptions?.onConflict || 'id').split(',');
              const existing = rows.find(row => conflictFields.every(key => row[key] === record[key]));
              if (existing && upsertOptions?.ignoreDuplicates) continue;
              if (existing) { Object.assign(existing, record); result.push(existing); }
              else {
                const created = table === TABLE ? episode({ ...record, id: uuid(sequence++), created_at: iso(db.clock.now), updated_at: iso(db.clock.now) }) : record;
                rows.push(created); result.push(created);
              }
            }
            tables[table] = rows;
            return { data: returning ? copy(result) : null, error: null };
          }
          let selected = rows.filter(matches);
          if (operation === 'update') {
            for (const row of selected) {
              const updated = { ...row, ...patch };
              if (table === TABLE && updated.state === 'observed' && updated.evidence && rows.some(other => other.id !== row.id && other.worker_id === updated.worker_id && other.state === 'observed' && other.evidence?.kind === updated.evidence.kind && other.evidence?.id === updated.evidence.id)) return { data: null, error: { code: '23505' } };
            }
            for (const row of selected) Object.assign(row, patch);
          }
          selected = [...selected].sort((a, b) => {
            for (const [key, asc] of sorts) { if (a[key] < b[key]) return asc ? -1 : 1; if (a[key] > b[key]) return asc ? 1 : -1; }
            return 0;
          }).slice(from, to + 1);
          return { data: returning ? copy(single ? selected[0] || null : selected) : null, error: null };
        }).then(resolve, reject);
      },
    };
    return builder;
  } };
  return db;
}

function setup(overrides = {}, failures = {}) {
  const db = database(overrides, failures), cache = new Map();
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [db.clock.now])); }
    static now() { return db.clock.now; }
  }
  function load(relative) {
    relative = relative.replace(/\\/g, '/').replace(/\.ts$/, '');
    if (cache.has(relative)) return cache.get(relative);
    const exports = {}; cache.set(relative, exports);
    const filename = path.join(__dirname, '../src', relative + '.ts');
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, Date: ClockDate, Intl, Map, Set, Object, Number, Math, RangeError, Request, Response, Headers, URL, URLSearchParams,
      console: { error() {} }, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture' } },
      require(name) {
        if (name === '@supabase/supabase-js') return { createClient: () => db };
        if (name === 'next/server') return { NextResponse: { json: (body, init = {}) => new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } }) } };
        if (name === 'node:crypto') return require(name);
        if (name.startsWith('@/')) return load(name.slice(2));
        if (name.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(relative), name)));
        throw new Error(`Unexpected dependency: ${name}`);
      },
    });
    return exports;
  }
  const learning = load('lib/server/central-assistant-learning'), server = load('lib/server/central-assistant'), route = load('app/api/central/assistant/learning/route');
  const ctx = { db, worker: db.tables.workers[0], identityIds: [WORKER] };
  function request(body, token = 'valid', extraHeaders = {}) {
    return new Request('https://fixture.invalid/api/central/assistant/learning', {
      method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
  }
  return { db, learning, server, route, ctx, request };
}

test('learning routes reject absent or forged sessions before reading any learning data', async () => {
  const f = setup({ [TABLE]: [episode()] });
  for (const [handler, request] of [[f.route.GET, f.request(undefined, null)], [f.route.POST, f.request({ action: 'review' }, 'fake')]]) {
    const response = await handler(request);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
  assert.equal(f.db.queries.length, 0);
  assert.deepEqual(f.db.authCalls, ['fake']);
});

test('unauthorized staff roles cannot access evolution or mutate episodes', async () => {
  const f = setup({ workers: [{ id: WORKER, user_id: AUTH, role: 'tarotista', is_active: true }], [TABLE]: [episode()] });
  assert.equal((await f.route.POST(f.request({ action: 'start', episodeId: EPISODE }))).status, 403);
  assert.equal(f.db.queries.some(q => q.table === TABLE), false);
});

test('GET isolates worker history and strips baseline data from visible journal rows', async () => {
  const f = setup({ [TABLE]: [episode({ baseline: { last_call: 123, internal: 'private' } }), episode({ id: uuid(2), worker_id: OTHER, title: 'Secret mission' })] });
  assert.equal((await f.server.assistantAuth(f.request())).worker.id, WORKER);
  const response = await f.route.GET(f.request());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.summary.recent.length, 1);
  assert.deepEqual(body.summary.recent[0].baseline, {});
  assert.doesNotMatch(JSON.stringify(body), /Secret mission/);
  for (const q of f.db.queries.filter(q => q.table === TABLE)) assert.ok(q.filters.some(([key, op, value]) => key === 'worker_id' && op === 'eq' && value === WORKER));
});

test('forged episode and worker IDs cannot start or rate another worker mission', async () => {
  const f = setup({ [TABLE]: [episode({ worker_id: OTHER })] });
  for (const action of ['start', 'feedback']) {
    const response = await f.route.POST(f.request({ action, episodeId: EPISODE, worker_id: OTHER, value: 'helpful', xp: 9999, evidence: { id: 'forged' } }));
    assert.equal(response.status, 404);
  }
  assert.equal(f.db.tables[TABLE][0].state, 'suggested');
  assert.equal(f.db.tables[TABLE][0].feedback, null);
  assert.equal(f.db.queries.some(q => q.operation === 'update'), false);
});

test('missing SQL is a graceful feature limitation and never breaks authorized GET', async () => {
  const f = setup({}, { [TABLE]: '42P01' });
  const response = await f.route.GET(f.request());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.enabled, false);
  assert.equal(body.summary, null);
  assert.match(body.message, /SQL/);
});

test('starting a valid mission checks source eligibility and retries preserve its measurement window', async () => {
  const f = setup({ [TABLE]: [episode()] });
  await f.learning.learningAction(f.ctx, { action: 'start', episodeId: EPISODE });
  const started = copy(f.db.tables[TABLE][0]);
  assert.equal(started.state, 'trying');
  assert.equal(started.tried_at, iso(NOW));
  assert.equal(started.deadline_at, iso(NOW + 7 * DAY));
  assert.equal(started.baseline.observation_complete, false);
  f.db.clock.now += HOUR;
  await f.learning.learningAction(f.ctx, { action: 'start', episodeId: EPISODE });
  assert.deepEqual(f.db.tables[TABLE][0], started);
  assert.equal((await f.learning.learningPayload(f.ctx)).summary.xp, 0);
});

test('stale recovery baseline, open followup and contact opt-out block new attempts', async () => {
  const variants = [
    { rendimiento_llamadas: [{ id: SOURCE, cliente_id: CLIENT, tiempo: 10, fecha_hora: iso(NOW - DAY), created_at: iso(NOW - DAY) }] },
    { crm_client_followups: [{ id: SOURCE, client_id: CLIENT, worker_id: WORKER, business: 'tarot', status: 'pending', completed_at: null }] },
    { crm_clientes: [{ id: CLIENT, nombre: 'Ana', is_active: true, do_not_contact: true }] },
  ];
  for (const variant of variants) {
    const f = setup({ [TABLE]: [episode()], ...variant });
    await assert.rejects(f.learning.learningAction(f.ctx, { action: 'start', episodeId: EPISODE }), error => error.status === 409);
    assert.equal(f.db.tables[TABLE][0].state, 'suggested');
  }
});

test('server-generated suggestions remain one mission across refreshes and award no click XP', async () => {
  const f = setup();
  for (let i = 0; i < 3; i++) {
    const card = { id: `client:${CLIENT}`, title: 'Ana', detail: 'Sin actividad reciente', tab: 'mis-clientas', clientId: CLIENT, priority: 'info', source: 'Cartera' };
    await f.learning.attachLearning(f.ctx, [{ card, strategy: 'recovery_loyal', sourceKey: 'stable-source', sourceId: CLIENT, clientId: CLIENT, baseline: { last_call: 0 } }]);
    assert.equal(card.learning.episodeId, f.db.tables[TABLE][0].id);
  }
  assert.equal(f.db.tables[TABLE].length, 1);
  assert.equal((await f.learning.learningPayload(f.ctx)).summary.xp, 0);
});

test('positive-duration calls inside the actual attempt window are observed once', async () => {
  const f = setup({ [TABLE]: [trying()], rendimiento_llamadas: [
    { id: uuid(20), cliente_id: CLIENT, tiempo: 0, fecha_hora: iso(NOW - HOUR), created_at: iso(NOW - HOUR) },
    { id: SOURCE, cliente_id: CLIENT, tiempo: 8, fecha_hora: iso(NOW - HOUR), created_at: iso(NOW - HOUR) },
  ] });
  await f.learning.reviewLearning(f.ctx);
  const row = f.db.tables[TABLE][0];
  assert.equal(row.state, 'observed');
  assert.equal(row.evidence.id, SOURCE);
  assert.equal(row.evidence.kind, 'call_observed');
  assert.match(row.evidence.detail, /no demuestra/);
  assert.equal((await f.learning.learningPayload(f.ctx)).summary.xp, 20);
  f.db.clock.now += HOUR;
  await f.learning.reviewLearning(f.ctx);
  assert.equal((await f.learning.learningPayload(f.ctx)).summary.xp, 20);
});

test('late-imported historical calls and calls outside the deadline are not new results', async () => {
  const f = setup({ [TABLE]: [expired()], rendimiento_llamadas: [
    { id: uuid(20), cliente_id: CLIENT, tiempo: 10, fecha_hora: iso(NOW - 20 * DAY), created_at: iso(NOW - HOUR) },
    { id: uuid(21), cliente_id: CLIENT, tiempo: 10, fecha_hora: iso(NOW - HOUR), created_at: iso(NOW - HOUR) },
  ] });
  await f.learning.reviewLearning(f.ctx);
  assert.equal(f.db.tables[TABLE][0].state, 'no_result');
  assert.equal(f.db.tables[TABLE][0].baseline.observation_complete, true);
  const summary = (await f.learning.learningPayload(f.ctx)).summary;
  assert.equal(summary.xp, 0);
  assert.equal(summary.lessons[0].noResult, 1);
});

test('unavailable call data never converts an expired mission into a failed observation', async () => {
  const f = setup({ [TABLE]: [expired()] }, { rendimiento_llamadas: 'SOURCE_UNAVAILABLE' });
  const unavailable = await f.learning.reviewLearning(f.ctx);
  assert.ok(unavailable.includes('Llamadas'));
  assert.equal(f.db.tables[TABLE][0].state, 'trying');
  assert.equal((await f.learning.learningPayload(f.ctx)).summary.lessons[0].attempts, 0);
});

test('missing or malformed event timestamps remain insufficient data instead of no_result', async () => {
  for (const badDate of [null, 'invalid']) {
    const f = setup({ [TABLE]: [expired()], rendimiento_llamadas: [{ id: SOURCE, cliente_id: CLIENT, tiempo: 10, fecha_hora: badDate, created_at: iso(NOW - HOUR) }] });
    const unavailable = await f.learning.reviewLearning(f.ctx);
    assert.equal(f.db.tables[TABLE][0].state, 'trying', `Malformed event date ${badDate} must not count against strategy`);
    assert.ok(unavailable.length > 0);
    assert.equal((await f.learning.learningPayload(f.ctx)).summary.lessons[0].attempts, 0);
  }
});

test('feedback retries and edits keep one reward and preserve the first rating day', async () => {
  const f = setup({ [TABLE]: [episode()] });
  const concurrent = await Promise.allSettled([f.learning.learningAction(f.ctx, { action: 'feedback', episodeId: EPISODE, value: 'helpful', note: 'Bien' }), f.learning.learningAction(f.ctx, { action: 'feedback', episodeId: EPISODE, value: 'helpful', note: 'Bien' })]);
  assert.ok(concurrent.some(result => result.status === 'fulfilled'));
  assert.ok(concurrent.every(result => result.status === 'fulfilled' || result.reason.status === 409));
  await f.learning.learningAction(f.ctx, { action: 'feedback', episodeId: EPISODE, value: 'helpful', note: 'Bien' });
  const firstDate = f.db.tables[TABLE][0].feedback_at;
  f.db.clock.now += DAY;
  await f.learning.learningAction(f.ctx, { action: 'feedback', episodeId: EPISODE, value: 'not_helpful', note: 'Mejor por la tarde' });
  assert.equal(f.db.tables[TABLE][0].feedback_at, firstDate);
  assert.equal(f.db.tables[TABLE][0].feedback, 'not_helpful');
  assert.equal(f.db.tables[TABLE][0].feedback_note, 'Mejor por la tarde');
  const summary = (await f.learning.learningPayload(f.ctx)).summary;
  assert.equal(summary.xp, 5);
  assert.equal(summary.feedbackCount, 1);
  assert.equal(summary.lessons[0].notHelpful, 1);
});

test('simultaneous differing edits cannot silently overwrite each other at the same millisecond', async () => {
  const f = setup({ [TABLE]: [episode({ feedback: 'helpful', feedback_note: 'Original', feedback_at: iso(NOW), updated_at: iso(NOW) })] });
  const results = await Promise.allSettled([
    f.learning.learningAction(f.ctx, { action: 'feedback', episodeId: EPISODE, value: 'helpful', note: 'Primera corrección' }),
    f.learning.learningAction(f.ctx, { action: 'feedback', episodeId: EPISODE, value: 'not_helpful', note: 'Segunda corrección' }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected')?.reason.status, 409);
  assert.equal((await f.learning.learningPayload(f.ctx)).summary.xp, 5);
});

test('reassigned clients disappear from history and model corrections and cannot be started', async () => {
  const f = setup({ [TABLE]: [episode({ title: 'Private name', feedback: 'helpful', feedback_note: 'Secret client correction', feedback_at: iso(NOW - DAY) })], crm_client_capture_assignments: [] });
  const payload = await f.learning.learningPayload(f.ctx);
  assert.equal(payload.summary.recent.length, 0);
  assert.doesNotMatch(await f.learning.learningContext(f.ctx), /Secret client correction/);
  await assert.rejects(f.learning.learningAction(f.ctx, { action: 'start', episodeId: EPISODE }), error => error.status === 404);
});

test('lost portfolio access invalidates active recovery without querying that client calls', async () => {
  const f = setup({ [TABLE]: [trying()], crm_client_capture_assignments: [] });
  await f.learning.reviewLearning(f.ctx);
  assert.equal(f.db.tables[TABLE][0].state, 'invalidated');
  assert.equal(f.db.queries.some(q => q.table === 'rendimiento_llamadas'), false);
  assert.equal((await f.learning.learningPayload(f.ctx)).summary.xp, 0);
});

test('cancelled or reassigned followups are invalidated instead of negative strategy outcomes', async () => {
  for (const changes of [{ status: 'cancelled' }, { worker_id: OTHER }]) {
    const f = setup({ [TABLE]: [expired({ strategy: 'followup_due', source_id: SOURCE })], crm_client_followups: [{ id: SOURCE, client_id: CLIENT, worker_id: WORKER, business: 'tarot', status: 'pending', completed_at: null, ...changes }] });
    await f.learning.reviewLearning(f.ctx);
    assert.equal(f.db.tables[TABLE][0].state, 'invalidated');
    assert.equal((await f.learning.learningPayload(f.ctx)).summary.lessons[2].attempts, 0);
  }
});

test('completed followups and fully closed incidents supply actual dated evidence', async () => {
  const f = setup({ [TABLE]: [trying({ strategy: 'followup_due', source_id: SOURCE }), trying({ id: uuid(30), strategy: 'incident_pending', source_id: uuid(31), client_id: null })],
    crm_client_followups: [{ id: SOURCE, client_id: CLIENT, worker_id: WORKER, business: 'tarot', status: 'completed', completed_at: iso(NOW - HOUR) }],
    v_attendance_incidents: [{ id: uuid(31), pending_minutes: 0, status: 'closed', closed_at: iso(NOW - HOUR) }],
  });
  await f.learning.reviewLearning(f.ctx);
  assert.ok(f.db.tables[TABLE].every(row => row.state === 'observed'));
  assert.equal((await f.learning.learningPayload(f.ctx)).summary.xp, 40);
});

test('duplicate evidence conflicts do not fail the entire review or double-credit a call', async () => {
  const first = trying({ id: uuid(40) }), duplicate = trying({ id: uuid(41), source_key: 'different-source' });
  const f = setup({ [TABLE]: [first, duplicate], rendimiento_llamadas: [{ id: SOURCE, cliente_id: CLIENT, tiempo: 10, fecha_hora: iso(NOW - HOUR), created_at: iso(NOW - HOUR) }] });
  const response = await f.route.POST(f.request({ action: 'review' }));
  assert.equal(response.status, 200, `Duplicate evidence should be handled: ${await response.clone().text()}`);
  const body = await response.json();
  assert.equal(body.summary.xp, 20);
  assert.equal(body.summary.observedCount, 1);
  assert.equal(f.db.tables[TABLE].filter(row => row.state === 'observed').length, 1);
  assert.equal(f.db.tables[TABLE].filter(row => row.state === 'trying').length, 0);
});

test('focusing an older owned episode pins it into the journal and still rechecks access', async () => {
  const rows = Array.from({ length: 25 }, (_, i) => episode({ id: uuid(i), created_at: iso(NOW - (i + 1) * HOUR), updated_at: iso(NOW - (i + 1) * HOUR) }));
  const f = setup({ [TABLE]: rows });
  const request = new Request(`https://fixture.invalid/api/central/assistant/learning?episodeId=${uuid(24)}`, { headers: { Authorization: 'Bearer valid' } });
  const response = await f.route.GET(request);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.summary.recent[0].id, uuid(24));
  assert.deepEqual(body.summary.recent[0].baseline, {});
  f.db.tables.crm_client_capture_assignments = [];
  const revoked = await f.route.GET(request);
  assert.equal(revoked.status, 200);
  assert.equal((await revoked.json()).summary.recent.length, 0);
  const foreign = setup({ [TABLE]: [episode({ worker_id: OTHER })] });
  const foreignResponse = await foreign.route.GET(new Request(`https://fixture.invalid/api/central/assistant/learning?episodeId=${EPISODE}`, { headers: { Authorization: 'Bearer valid' } }));
  assert.equal(foreignResponse.status, 200);
  assert.equal((await foreignResponse.json()).summary.recent.length, 0);
});

test('model context prioritizes recently edited corrections while preserving original reward timestamps', async () => {
  const rows = Array.from({ length: 8 }, (_, i) => episode({ id: uuid(300 + i), feedback: 'helpful', feedback_note: `Correction ${i}`, feedback_at: iso(NOW - (i + 1) * DAY), updated_at: iso(NOW - (i + 1) * DAY) }));
  rows[7].updated_at = iso(NOW);
  rows[7].feedback_note = 'Recently revised oldest correction';
  const f = setup({ [TABLE]: rows });
  const context = JSON.parse(await f.learning.learningContext(f.ctx));
  assert.equal(context.corrections.length, 6);
  assert.equal(context.corrections[0].correction, 'Recently revised oldest correction');
  assert.equal(f.db.tables[TABLE][7].feedback_at, iso(NOW - 8 * DAY));
});

test('negative feedback modestly changes real opportunity order and preserves factual eligibility', async () => {
  const clients = Array.from({ length: 14 }, (_, i) => ({ id: uuid(100 + i), nombre: `Cliente ${i}`, is_active: true }));
  const assignments = clients.map(client => ({ client_id: client.id, responsible_worker_id: WORKER, business: 'tarot', status: 'confirmed' }));
  const calls = clients.flatMap((client, i) => Array.from({ length: i < 7 ? 3 : 1 }, (_, n) => ({ id: uuid(10000 + i * 10 + n), cliente_id: client.id, tiempo: 10, fecha_hora: iso(NOW - (40 + n) * DAY), created_at: iso(NOW - (40 + n) * DAY) })));
  const base = { crm_clientes: clients, crm_client_capture_assignments: assignments, rendimiento_llamadas: calls };
  const initial = setup(base);
  const before = await initial.server.clientQuery(initial.ctx, { kind: 'opportunities', days: 30, page: 1 });
  assert.deepEqual(copy(before.cards.slice(0, 7).map(card => card.clientId)), clients.slice(0, 7).map(client => client.id));
  const ratings = Array.from({ length: 3 }, (_, i) => episode({ id: uuid(20000 + i), client_id: clients[i].id, source_key: `rated:${i}`, feedback: 'not_helpful', feedback_note: 'Demasiadas sugerencias así', feedback_at: iso(NOW - DAY) }));
  const tooSmall = setup({ ...base, [TABLE]: ratings.slice(0, 2) });
  const unchanged = await tooSmall.server.clientQuery(tooSmall.ctx, { kind: 'opportunities', days: 30, page: 1 });
  assert.deepEqual(copy(unchanged.cards.map(card => card.clientId)), copy(before.cards.map(card => card.clientId)));
  assert.ok(unchanged.cards.every(card => card.learning.quiet === false));
  const adapted = setup({ ...base, [TABLE]: ratings });
  const after = await adapted.server.clientQuery(adapted.ctx, { kind: 'opportunities', days: 30, page: 1 });
  const order = after.cards.map(card => card.clientId);
  assert.ok(order.indexOf(clients[7].id) < order.indexOf(clients[6].id));
  assert.match(after.text, /ajustado suavemente/);
  assert.match(after.text, /no es una predicción de compra/);
  assert.ok(after.cards.every(card => card.learning && card.source === 'Cartera asignada · rendimiento de llamadas'));
  assert.ok(after.cards.filter(card => card.learning.strategy === 'recovery_loyal').every(card => card.learning.quiet === true));
  assert.ok(after.cards.filter(card => card.learning.strategy === 'recovery_recent').every(card => card.learning.quiet === false));

  const observations = Array.from({ length: 5 }, (_, i) => episode({ id: uuid(21000 + i), client_id: clients[i].id, source_key: `observed:${i}`, strategy: 'recovery_recent', state: 'observed',
    tried_at: iso(NOW - 2 * DAY), deadline_at: iso(NOW + 5 * DAY), resolved_at: iso(NOW - DAY), updated_at: iso(NOW - DAY),
    evidence: { id: uuid(22000 + i), kind: 'call_observed', detail: 'Llamada posterior comprobada', occurredAt: iso(NOW - 1.5 * DAY) },
  }));
  const tooFewOutcomes = setup({ ...base, [TABLE]: observations.slice(0, 4) });
  const notAdapted = await tooFewOutcomes.server.clientQuery(tooFewOutcomes.ctx, { kind: 'opportunities', days: 30, page: 1 });
  assert.deepEqual(copy(notAdapted.cards.map(card => card.clientId)), copy(before.cards.map(card => card.clientId)));
  const enoughOutcomes = setup({ ...base, [TABLE]: observations });
  const learned = await enoughOutcomes.server.clientQuery(enoughOutcomes.ctx, { kind: 'opportunities', days: 30, page: 1 });
  const learnedOrder = learned.cards.map(card => card.clientId);
  assert.ok(learnedOrder.indexOf(clients[7].id) < learnedOrder.indexOf(clients[6].id));
});

test('bad or oversized action input is rejected before episode mutation', async () => {
  const f = setup({ [TABLE]: [episode()] });
  const cases = [['{broken', 400], [[], 400], [{ action: 'start', episodeId: 'not-a-uuid' }, 400], [{ action: 'feedback', episodeId: EPISODE, value: 'helpful', note: 'x'.repeat(601) }, 400], [{ action: 'start', episodeId: EPISODE, padding: 'x'.repeat(5000) }, 413]];
  for (const [body, status] of cases) assert.equal((await f.route.POST(f.request(body))).status, status);
  assert.equal(f.db.queries.some(q => q.operation === 'update'), false);
});
