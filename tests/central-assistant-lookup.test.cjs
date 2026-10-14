const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

const maria = { id: '11111111-1111-4111-8111-111111111111', nombre: 'María', apellido: 'López', telefono: '+34600111222', is_active: true };
const ana = { id: '22222222-2222-4222-8222-222222222222', nombre: 'Ana', apellido: 'García', telefono: '+34600333444', is_active: true };
const other = { id: '33333333-3333-4333-8333-333333333333', nombre: 'María', apellido: 'López', telefono: '+34600555666', is_active: true };

function database(overrides = {}, failures = []) {
  const tables = {
    crm_client_capture_assignments: [maria, ana].map(c => ({ client_id: c.id, business: 'tarot', responsible_worker_id: 'worker-a', status: 'confirmed' })),
    crm_clientes: [maria, ana, other],
    raffles: [{ id: 'raffle-a', title: 'Sorteo de octubre', status: 'active', created_at: '2026-10-01' }],
    raffle_entries: [{ id: 'entry-a', raffle_id: 'raffle-a', client_id: maria.id, raffle_number: 7 }, { id: 'entry-b', raffle_id: 'raffle-a', client_id: maria.id, raffle_number: 24 }, { id: 'entry-secret', raffle_id: 'raffle-a', client_id: other.id, raffle_number: 99 }],
    crm_client_followups: [], central_assistant_messages: [], central_assistant_memories: [], central_assistant_knowledge: [],
    ...overrides,
  };
  const queries = [];
  return { queries, tables, from(table) {
    const filters = [], sorts = []; let start = 0, end = Infinity, single = false;
    const query = { table, filters }; queries.push(query);
    const builder = {
      select() { return this; }, eq(key, value) { filters.push([key, 'eq', value]); return this; },
      in(key, value) { filters.push([key, 'in', value]); return this; },
      is(key, value) { filters.push([key, 'is', value]); return this; },
      order(key, options) { sorts.push([key, options?.ascending !== false]); return this; },
      range(a, b) { start = a; end = b; return this; }, limit(n) { end = n - 1; return this; },
      maybeSingle() { single = true; return this; },
      then(resolve, reject) {
        if (failures.includes(table)) return Promise.resolve({ data: null, error: { code: 'SOURCE_UNAVAILABLE' } }).then(resolve, reject);
        let rows = [...(tables[table] || [])].filter(row => filters.every(([key, op, value]) => op === 'in' ? value.includes(row[key]) : op === 'is' ? (row[key] ?? null) === value : row[key] === value));
        rows.sort((a, b) => { for (const [key, asc] of sorts) { if (a[key] < b[key]) return asc ? -1 : 1; if (a[key] > b[key]) return asc ? 1 : -1; } return 0; });
        rows = rows.slice(start, end + 1);
        return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(resolve, reject);
      },
    };
    return builder;
  } };
}
function modules(db, env = {}, fetch = async () => { throw new Error('Unexpected model request'); }) {
  const cache = new Map();
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative);
    const exports = {}; cache.set(relative, exports);
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib', relative + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, process: { env }, console: { error() {} }, fetch, AbortSignal, Date, Intl, Map, Set, Object, Number, Math, Error, require(name) {
      if (name === '@supabase/supabase-js') return { createClient: () => db };
      if (name === 'node:crypto') return require(name);
      if (name === '@/lib/central-assistant') return load('central-assistant');
      if (name === '@/lib/companion-learning') return load('companion-learning');
      if (name === './central-assistant-learning') return load('server/central-assistant-learning');
      if (name === './central-assistant-capture') return load('server/central-assistant-capture');
      if (name === './madrid-reporting-period') return load('server/madrid-reporting-period');
      if (name === './brand-filter') return load('server/brand-filter');
      if (name === './central-assistant-lookup') return load('server/central-assistant-lookup');
      if (name === './central-assistant') return load('server/central-assistant');
      return {};
    } });
    return exports;
  }
  return { server: load('server/central-assistant'), lookup: load('server/central-assistant-lookup'), chat: load('server/central-assistant-chat'), ctx: { db, worker: { id: 'worker-a', user_id: 'auth-a', role: 'central', display_name: 'Central A' }, identityIds: ['worker-a'] } };
}

test('named and full-phone raffle requests work without a model and stay within assigned clients', async () => {
  const db = database(), { chat, ctx } = modules(db);
  for (const question of ['Búscame los números de sorteo de María López', 'Números del sorteo de +34 600 111 222']) {
    const answer = await chat.answer(ctx, question, 'central', 'sol');
    assert.equal(answer.mode, 'guided'); assert.match(answer.result.text, /7, 24/); assert.doesNotMatch(answer.result.text, /99/);
    assert.equal(answer.result.cards[0].clientId, maria.id);
  }
  const reads = db.queries.filter(q => q.table === 'raffle_entries');
  assert.equal(reads.length, 2);
  for (const q of reads) assert.ok(q.filters.some(f => f[0] === 'client_id' && f[2] === maria.id));
});

test('specific lookups retain UUIDs and do not take over existing portfolio filters', () => {
  const { lookup } = modules(database());
  assert.equal(lookup.parseLookupRequest(`Números del sorteo de ${maria.id}`).query, maria.id);
  assert.equal(lookup.parseLookupRequest('Busca clientes que más consultan a la tarotista Luna'), null);
  assert.equal(lookup.parseLookupRequest('Busca clientes con +34'), null);
  assert.equal(lookup.parseLookupRequest('Búscame a María López').query, 'María López');
});

test('a guessed client UUID outside the current portfolio cannot read raffle entries', async () => {
  const db = database(), { server, ctx } = modules(db);
  const result = await server.raffleNumbers(ctx, other.id);
  assert.equal(result.cards.length, 0); assert.match(result.text, /cartera autorizada/);
  assert.equal(db.queries.some(q => q.table === 'raffle_entries'), false);
});

test('ambiguous names request clarification before reading any raffle numbers', async () => {
  const db = database({ crm_client_capture_assignments: [maria, other].map(c => ({ client_id: c.id, business: 'tarot', responsible_worker_id: 'worker-a', status: 'confirmed' })) });
  const { server, ctx } = modules(db), result = await server.raffleNumbers(ctx, 'María López');
  assert.equal(result.cards.length, 2); assert.match(result.text, /Indica el nombre completo o teléfono/);
  assert.equal(db.queries.some(q => q.table === 'raffle_entries'), false);
});

test('Orion assignments and inactive clients never enter lookup results', async () => {
  const db = database({ crm_client_capture_assignments: [{ client_id: maria.id, business: 'orion', responsible_worker_id: 'worker-a', status: 'confirmed' }, { client_id: ana.id, business: 'tarot', responsible_worker_id: 'worker-a', status: 'confirmed' }], crm_clientes: [maria, { ...ana, is_active: false }] });
  const { server, ctx } = modules(db);
  assert.equal((await server.clientLookup(ctx, 'María')).cards.length, 0);
  assert.equal((await server.clientLookup(ctx, 'Ana')).cards.length, 0);
});

test('a referential query uses the open ficha but rechecks access', async () => {
  const db = database(), { chat, ctx } = modules(db);
  assert.match((await chat.guidedAnswer(ctx, 'Busca los números del sorteo de esa clienta', 'crm', maria.id)).text, /7, 24/);
  const denied = await chat.guidedAnswer(ctx, 'Busca los números del sorteo de esa clienta', 'crm', other.id);
  assert.equal(denied.cards.length, 0); assert.doesNotMatch(denied.text, /99/);
});

test('conversation references use one currently authorized client and do not guess between a list', async () => {
  const history = result => [{ worker_id: 'worker-a', status: 'completed', created_at: '2026-10-12', question: 'Busca una ficha', result }];
  const db = database({ central_assistant_messages: history({ text: 'Encontrada', cards: [{ clientId: maria.id }] }) });
  const { chat, ctx } = modules(db);
  assert.match((await chat.guidedAnswer(ctx, 'Números del sorteo de esa clienta', 'central')).text, /7, 24/);
  db.tables.central_assistant_messages = history({ text: 'Varias', cards: [{ clientId: maria.id }, { clientId: ana.id }] });
  assert.match((await chat.guidedAnswer(ctx, 'Números del sorteo de esa clienta', 'central')).text, /De qué clienta/);
  db.tables.central_assistant_messages = history({ text: 'Fuera de cartera', cards: [{ clientId: other.id }] });
  assert.match((await chat.guidedAnswer(ctx, 'Números del sorteo de esa clienta', 'central')).text, /De qué clienta/);
});

test('no active raffle and unavailable data are not reported as invented numbers', async () => {
  const absent = modules(database({ raffles: [] }));
  assert.match((await absent.server.raffleNumbers(absent.ctx, maria.id)).text, /no hay un sorteo activo/);
  const failed = modules(database({}, ['raffle_entries']));
  await assert.rejects(failed.server.raffleNumbers(failed.ctx, maria.id), /fuente no está disponible/);
});

test('raffle retrieval pages beyond the Data API page size without truncation', async () => {
  const db = database({ raffle_entries: Array.from({ length: 503 }, (_, n) => ({ id: String(n), raffle_id: 'raffle-a', client_id: maria.id, raffle_number: n + 1 })) });
  const { server, ctx } = modules(db), result = await server.raffleNumbers(ctx, maria.id);
  assert.equal(result.total, 503); assert.match(result.text, /200 de 503/);
  assert.equal(db.queries.filter(q => q.table === 'raffle_entries').length, 2);
});

test('followups exclude completed, cancelled and Orion records while keeping authorized pending work', async () => {
  const db = database({ crm_client_followups: [{ id: 'a', client_id: maria.id, reason: 'Revisar llamada', status: 'pendiente', business: 'tarot' }, { id: 'b', client_id: maria.id, status: 'cancelled', business: 'tarot' }, { id: 'c', client_id: maria.id, status: 'pendiente', business: 'orion' }, { id: 'd', client_id: other.id, status: 'pendiente', business: 'tarot' }, { id: 'e', client_id: maria.id, completed_at: '2026-10-10', business: 'tarot' }] });
  const { chat, ctx } = modules(db), result = await chat.guidedAnswer(ctx, 'Seguimientos de María López', 'central');
  assert.equal(result.total, 1); assert.match(result.cards[0].title, /Revisar llamada/); assert.equal(result.cards[0].clientId, maria.id);
});

test('guided memories are scoped to the worker and explicit writes remain uncommitted proposals', async () => {
  const db = database({ central_assistant_memories: [{ worker_id: 'worker-a', topic: 'Horario', content: 'Trabajo por la mañana' }, { worker_id: 'worker-b', topic: 'Privado', content: 'Secreto de otra central' }] });
  const { chat, ctx } = modules(db);
  const memory = await chat.guidedAnswer(ctx, 'Recuerda que prefiero revisar el sorteo al empezar', 'central');
  assert.equal(memory.proposal.type, 'memory'); assert.match(memory.text, /antes de guardarlo/);
  const stored = await chat.guidedAnswer(ctx, '¿Qué recuerdas de mí?', 'central');
  assert.match(stored.text, /Trabajo por la mañana/); assert.doesNotMatch(stored.text, /Secreto/);
});

test('an unavailable model falls back to verified deterministic data and the existing text model configuration', async () => {
  let model;
  const db = database(), { chat, ctx } = modules(db, { OPENAI_API_KEY: 'fixture-only', OPENAI_TEXT_MODEL: 'configured-text-model' }, async (_, init) => { model = JSON.parse(init.body).model; return { ok: false }; });
  const result = await chat.answer(ctx, 'Números del sorteo de María López', 'central', 'sol');
  assert.equal(model, 'configured-text-model'); assert.equal(result.mode, 'guided'); assert.match(result.result.text, /7, 24/);
  assert.ok(result.result.unavailable.includes('Conversación inteligente'));
});

test('the Responses tool loop forwards grounded results and private memory without allowing writes', async () => {
  const requests = [], db = database({ central_assistant_memories: [{ worker_id: 'worker-a', topic: 'Preferencia', content: 'Sé breve' }] });
  const { chat, ctx } = modules(db, { OPENAI_API_KEY: 'fixture-only', CENTRAL_ASSISTANT_MODEL: 'configured-model' }, async (_, init) => {
    const request = JSON.parse(init.body); requests.push(request);
    return { ok: true, json: async () => requests.length === 1 ? { usage: { input_tokens: 10, output_tokens: 8 }, output: [{ type: 'function_call', name: 'raffle_numbers', arguments: JSON.stringify({ query: maria.id }), call_id: 'call-a' }] } : { usage: { input_tokens: 15, output_tokens: 9 }, output: [{ type: 'message', content: [{ type: 'output_text', text: 'María tiene los números 7 y 24. Aquí está su ficha.' }] }] } };
  });
  const result = await chat.answer(ctx, 'Números del sorteo de esa clienta', 'crm', 'sol', false, maria.id);
  assert.equal(result.mode, 'ai'); assert.equal(result.inputTokens, 25); assert.equal(result.result.cards[0].clientId, maria.id);
  assert.equal(requests[0].store, false); assert.match(requests[0].instructions, /No hagas bromas/);
  const output = requests[1].input.find(item => item.type === 'function_call_output');
  assert.match(output.output, /7, 24/); assert.equal(output.call_id, 'call-a');
  assert.ok(requests[0].tools.some(tool => tool.name === 'client_lookup'));
});
