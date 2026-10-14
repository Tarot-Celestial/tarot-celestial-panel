const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

const workerId = '11111111-1111-4111-8111-111111111111';
const anotherWorker = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-10-14T10:00:00.000Z');
const exactQuestion = 'hola puedes mirar en la pestaña de captacion cuantos contactos nuevos entraron entre el dia de ayer y hoy ?';
const period = { from: '2026-10-13', to: '2026-10-14' };
const lead = (id, values = {}) => ({ id, created_at: '2026-10-13T12:00:00.000Z', origen: 'facebook_ads', assigned_worker_id: null, cliente: { origen: 'facebook_ads' }, ...values });

function database(rows = [], options = {}) {
  const queries = [];
  return { queries, from(table) {
    const filters = [], orders = []; let offset = 0, end = Infinity, single = false;
    const entry = { table, filters, fields: '', count: false }; queries.push(entry);
    const builder = {
      select(fields, opts) { entry.fields = fields; entry.count = opts?.count; return this; },
      eq(key, value) { filters.push([key, 'eq', value]); return this; },
      in(key, value) { filters.push([key, 'in', value]); return this; },
      is(key, value) { filters.push([key, 'is', value]); return this; },
      gte(key, value) { filters.push([key, 'gte', value]); return this; },
      lt(key, value) { filters.push([key, 'lt', value]); return this; },
      or(value) { filters.push(['or', 'or', value]); return this; },
      order(key, opts) { orders.push([key, opts?.ascending !== false]); return this; },
      range(a, b) { offset = a; end = b; return this; },
      limit(n) { end = n - 1; return this; },
      maybeSingle() { single = true; return this; },
      then(resolve, reject) {
        if (options.failTable === table || (table === 'captacion_leads' && options.failPage === offset)) return Promise.resolve({ data: null, count: null, error: { code: 'SOURCE_ERROR' } }).then(resolve, reject);
        let all = table === 'workers' ? [{ id: workerId, role: options.role || 'central', is_active: Object.hasOwn(options, 'active') ? options.active : true }] : table === 'captacion_leads' ? [...rows] : [];
        all = all.filter(row => filters.every(([key, op, value]) => {
          if (op === 'or') return row.assigned_worker_id == null || row.assigned_worker_id === value.split('.eq.')[1];
          if (op === 'gte') return row[key] >= value;
          if (op === 'lt') return row[key] < value;
          if (op === 'in') return value.includes(row[key]);
          if (op === 'is') return (row[key] ?? null) === value;
          return row[key] === value;
        }));
        all.sort((a, b) => { for (const [key, ascending] of orders) { if (a[key] < b[key]) return ascending ? -1 : 1; if (a[key] > b[key]) return ascending ? 1 : -1; } return 0; });
        let count = all.length;
        if (table === 'captacion_leads' && options.changeCount && offset) count++;
        if (table === 'captacion_leads' && options.noCount) count = null;
        const data = all.slice(offset, end + 1);
        return Promise.resolve({ data: single ? data[0] || null : data, count, error: null }).then(resolve, reject);
      },
    };
    return builder;
  } };
}

function modules(db, options = {}) {
  const cached = new Map(), root = path.join(__dirname, '../src/lib');
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now.toISOString()])); } static now() { return now.getTime(); } }
  function load(relative) {
    if (cached.has(relative)) return cached.get(relative);
    const exports = {}; cached.set(relative, exports);
    const source = fs.readFileSync(path.join(root, relative + '.ts'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, Date: FixedDate, Intl, Map, Set, Object, Number, Math, Error, AbortSignal, console: { error() {} }, process: { env: options.env || {} }, fetch: options.fetch || (async () => { throw Error('The deterministic count must not call the model'); }), require(name) {
      if (name === '@supabase/supabase-js') return {};
      if (name === 'node:crypto') return require(name);
      if (name === './central-assistant-learning') return { learningContext: async () => '' };
      if (name.startsWith('@/lib/')) return load(name.slice('@/lib/'.length));
      if (name.startsWith('./')) return load(path.posix.join(path.posix.dirname(relative), name));
      return {};
    } });
    return exports;
  }
  return { capture: load('server/central-assistant-capture'), chat: load('server/central-assistant-chat'), shared: load('central-assistant'), ctx: { db, worker: { id: workerId, role: options.role || 'central', user_id: 'verified-auth-user', display_name: 'Central' }, identityIds: [workerId, anotherWorker] } };
}

test('the exact reported question resolves yesterday and today before portfolio recovery', () => {
  const { capture, shared } = modules(database());
  const request = capture.parseCaptureRequest(exactQuestion, 'central', now);
  assert.equal(request.from, '2026-10-13'); assert.equal(request.to, '2026-10-14');
  assert.equal(capture.parseCaptureRequest('posibles captaciones', 'captacion', now), null);
  assert.equal(shared.parseClientQuery('posibles captaciones').kind, 'opportunities');
  assert.equal(capture.parseCaptureRequest('Cuántos contactos entraron ayer', 'captacion', now).from, '2026-10-13');
  assert.equal(capture.parseCaptureRequest('Cuántos clientes sin llamar en 30 días', 'central', now), null);
});

test('relative dates follow Madrid around midnight and accept bounded calendar ranges', () => {
  const { capture } = modules(database());
  const request = capture.parseCaptureRequest(exactQuestion, '', new Date('2026-10-13T22:30:00Z'));
  assert.equal(request.from, '2026-10-13'); assert.equal(request.to, '2026-10-14');
  for (const phrase of ['Total de Captación del 12/10/2026 al 14/10/2026', 'Total Captación entre 2026-10-12 y 2026-10-14', 'Total Captación últimos 3 días']) {
    const query = capture.parseCaptureRequest(phrase, '', now);
    assert.equal(query.from, '2026-10-12'); assert.equal(query.to, '2026-10-14');
  }
  assert.equal(capture.parseCaptureRequest('Cuántos contactos entraron en captación anteayer', '', now).from, '2026-10-12');
});

test('invalid, reversed, future and unbounded dates ask for clarification instead of inventing a period', () => {
  const { capture } = modules(database());
  for (const phrase of ['Total Captación 31/02/2026', 'Total Captación del 14/10/2026 al 13/10/2026', 'Total Captación mañana', 'Total Captación últimos 367 días', 'Total Captación', 'Total Captación 2026-11-01']) assert.ok(capture.parseCaptureRequest(phrase, '', now).clarification, phrase);
  for (const query of [{ from: '2026-02-31', to: '2026-03-01' }, { from: '2026-10-14', to: '2026-10-13' }, { from: '2026-10-15', to: '2026-10-15' }, { from: '2024-01-01', to: '2026-10-14' }]) assert.throws(() => capture.capturePeriod(query, now));
});

test('Madrid calendar day boundaries remain correct on both daylight-saving transitions', () => {
  const { capture } = modules(database());
  const summer = capture.capturePeriod({ from: '2026-03-29', to: '2026-03-29' }, new Date('2026-11-01T12:00:00Z'));
  assert.equal(summer.start, '2026-03-28T23:00:00.000Z'); assert.equal(summer.endExclusive, '2026-03-29T22:00:00.000Z');
  assert.equal((Date.parse(summer.endExclusive) - Date.parse(summer.start)) / 3600000, 23);
  const winter = capture.capturePeriod({ from: '2026-10-25', to: '2026-10-25' }, new Date('2026-11-01T12:00:00Z'));
  assert.equal(winter.start, '2026-10-24T22:00:00.000Z'); assert.equal(winter.endExclusive, '2026-10-25T23:00:00.000Z');
  assert.equal((Date.parse(winter.endExclusive) - Date.parse(winter.start)) / 3600000, 25);
});

test('central counts only own and unassigned leads, preserving linked-client brand precedence', async () => {
  const db = database([
    lead('open'), lead('mine', { assigned_worker_id: workerId }), lead('other', { assigned_worker_id: anotherWorker }),
    lead('orion-client', { cliente: { origen: 'Orion Facebook' } }),
    lead('orion-lead', { origen: 'orion', cliente: null }),
    lead('client-wins', { origen: 'orion', cliente: { origen: 'celestial' } }),
    lead('fallback-origin', { origen: 'orion', cliente: { origen: '' } }),
  ]);
  const { capture, ctx } = modules(db), result = await capture.captureSummary(ctx, period, now);
  assert.equal(result.total, 3); assert.match(result.text, /sin asignar o asignadas a ti/);
  assert.ok(db.queries.find(q => q.table === 'captacion_leads').filters.some(f => f[1] === 'or' && f[2].endsWith(workerId)));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(`${workerId}|${anotherWorker}|client-wins`));
});

test('admin includes assignments to other workers but never Orion', async () => {
  const db = database([lead('open'), lead('mine', { assigned_worker_id: workerId }), lead('other', { assigned_worker_id: anotherWorker }), lead('orion', { cliente: { origen: 'orion' } })], { role: 'admin' });
  const { capture, ctx } = modules(db, { role: 'admin' }), result = await capture.captureSummary(ctx, period, now);
  assert.equal(result.total, 3); assert.match(result.text, /administrador/);
  assert.equal(db.queries.find(q => q.table === 'captacion_leads').filters.some(f => f[1] === 'or'), false);
});

test('inactive, missing-active or revoked roles cannot read lead aggregates', async () => {
  for (const options of [{ active: false }, { active: null }, { role: 'cliente' }]) {
    const db = database([lead('a')], options), { capture, ctx } = modules(db);
    await assert.rejects(capture.captureSummary(ctx, period, now), error => error.status === 403);
    assert.equal(db.queries.some(q => q.table === 'captacion_leads'), false);
  }
});

test('date filters include Madrid midnight and exclude the next day or future timestamps', async () => {
  const db = database([
    lead('before', { created_at: '2026-10-12T21:59:59.999Z' }),
    lead('start', { created_at: '2026-10-12T22:00:00.000Z' }),
    lead('last', { created_at: '2026-10-13T21:59:59.999Z' }),
    lead('next-day', { created_at: '2026-10-13T22:00:00.000Z' }),
    lead('future-today', { created_at: '2026-10-14T13:00:00.000Z' }),
  ]);
  const { capture, ctx } = modules(db);
  assert.equal((await capture.captureSummary(ctx, { from: '2026-10-13', to: '2026-10-13' }, now)).total, 2);
  const both = await capture.captureSummary(ctx, period, now);
  assert.equal(both.total, 3); assert.match(both.text, /2026-10-13: 2 · 2026-10-14: 1/);
});

test('all lead states count as registrations and separate lead IDs are not collapsed by CRM client', async () => {
  const db = database([lead('one', { estado: 'nuevo', cliente_id: 'same-client' }), lead('two', { estado: 'captado', closed_at: '2026-10-13', cliente_id: 'same-client' }), lead('three', { estado: 'no_interesado', cliente_id: 'same-client' })]);
  const { capture, ctx } = modules(db), result = await capture.captureSummary(ctx, period, now);
  assert.equal(result.total, 3); assert.match(result.text, /cada alta una vez, en cualquier estado/); assert.match(result.text, /no son teléfonos únicos/);
  const query = db.queries.find(q => q.table === 'captacion_leads');
  assert.doesNotMatch(query.fields, /nombre|telefono|email|notas|cliente_id/);
  assert.equal(query.filters.some(f => ['estado', 'closed_at'].includes(f[0])), false);
});

test('the count reads more than 300 and 500 rows rather than copying the truncated list endpoint', async () => {
  const db = database(Array.from({ length: 1251 }, (_, i) => lead(String(i).padStart(5, '0'))));
  const { capture, ctx } = modules(db), result = await capture.captureSummary(ctx, period, now);
  assert.equal(result.total, 1251); assert.equal(db.queries.filter(q => q.table === 'captacion_leads').length, 3);
});

test('failed, incomplete or changing sources never become a zero or partial count', async () => {
  const rows = Array.from({ length: 501 }, (_, i) => lead(String(i).padStart(5, '0')));
  for (const options of [{ failTable: 'captacion_leads' }, { failPage: 500 }, { noCount: true }, { changeCount: true }]) {
    const db = database(rows, options), { capture, ctx } = modules(db);
    await assert.rejects(capture.captureSummary(ctx, period, now), error => [409, 503].includes(error.status));
  }
  const duplicate = modules(database([lead('same'), lead('same')]));
  await assert.rejects(duplicate.capture.captureSummary(duplicate.ctx, period, now), /no está completo/);
});

test('an empty successful source returns an explicit zero for each requested day', async () => {
  const { capture, ctx } = modules(database()), result = await capture.captureSummary(ctx, period, now);
  assert.equal(result.total, 0); assert.match(result.text, /2026-10-13: 0 · 2026-10-14: 0/);
  assert.equal(result.cards[0].tab, 'captacion'); assert.match(result.cards[0].source, /created_at/); assert.equal(result.cards[0].clientId, undefined);
});

test('the exact question returns live counts even with a configured model, without using recovery/history', async () => {
  const db = database([lead('a')]), { chat, ctx } = modules(db, { env: { OPENAI_API_KEY: 'test-only', CENTRAL_ASSISTANT_MODEL: 'fixture-model' } });
  const answer = await chat.answer(ctx, exactQuestion, 'central', 'sol');
  assert.equal(answer.mode, 'guided'); assert.equal(answer.result.total, 1);
  assert.equal(db.queries.some(q => ['crm_client_capture_assignments', 'central_assistant_messages', 'rendimiento_llamadas'].includes(q.table)), false);
});

test('missing dates ask for clarification without touching client or lead data', async () => {
  const db = database(), { chat, ctx } = modules(db);
  const answer = await chat.answer(ctx, 'Cuántos contactos nuevos hay en Captación', 'central', 'sol');
  assert.match(answer.result.text, /Qué período/); assert.equal(db.queries.length, 0);
});

test('the model tool uses the same date and permission validation for less literal questions', async () => {
  const requests = [], db = database([lead('a')]);
  const { chat, ctx } = modules(db, { env: { OPENAI_API_KEY: 'test-only', CENTRAL_ASSISTANT_MODEL: 'fixture-model' }, fetch: async (_, init) => {
    requests.push(JSON.parse(init.body));
    return { ok: true, json: async () => requests.length === 1 ? { output: [{ type: 'function_call', name: 'capture_summary', arguments: JSON.stringify(period), call_id: 'capture-call' }] } : { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hay una alta registrada entre ayer y hoy.' }] }] } };
  } });
  const answer = await chat.answer(ctx, 'Revisa las altas que llegaron entre ayer y hoy', 'captacion', 'sol');
  assert.equal(answer.mode, 'ai'); assert.equal(answer.result.total, 1);
  assert.ok(requests[0].tools.some(tool => tool.name === 'capture_summary'));
  assert.ok(requests[0].input.some(item => item.content.includes('Fecha local de hoy: 2026-10-14')));
  const output = requests[1].input.find(item => item.type === 'function_call_output');
  assert.equal(JSON.parse(output.output).total, 1); assert.doesNotMatch(output.output, /telefono|email|nombre/);
});
