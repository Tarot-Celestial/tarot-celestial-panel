const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks = {}, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => name === 'server-only' ? {} : name in mocks ? mocks[name] : require(name), console, Request, Response, URL, AbortController, AbortSignal, Date, setTimeout, clearTimeout, ...globals });
  return exports;
}
const clone = value => JSON.parse(JSON.stringify(value));
const guide = load('src/lib/leo-guide.ts');
const rankGuide = load('src/lib/client-rank-guide.ts');
const companion = load('src/lib/leonaris-companion.ts', { '@/lib/leo-guide': guide });
const clientId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const userId = '10000000-0000-4000-8000-000000000001';
const memory = { displayName: null, memoryEnabled: true, style: 'warm', memories: [], history: [], helpful: 0, unhelpful: 0, profile: { visit_counts: {}, interest_scores: {}, interaction_counts: {}, last_path: null, last_seen_at: null } };
function contextFixture(options = {}) {
  const calls = [];
  const now = new Date().toISOString();
  const state = { cliente_id: clientId, auth_user_id: userId, coins: 1200, minutes_total: 233, oracle_credits: 4, rank_state: { effective: 'diamante', automatic: 'oro', total: 650, compras: 4 }, ...options.state };
  const roulette = { cliente_id: clientId, level_1_spins: 0, level_2_spins: 2, level_3_spins: 0, level_4_spins: 0, level_5_spins: 3, diamond_access: false, next_spin_2: 'spin-two', next_spin_5: 'spin-five', catalogue: [{ nivel: 2 }, { nivel: 5 }], history: [], entitlements: [], ...options.roulette };
  const tables = {
    crm_clientes: [{ id: clientId, nombre: 'Ana' }, { id: otherId, nombre: 'Otra clienta' }],
    tc_client_promotions: [{ id: 'expired', name: 'Antigua', status: 'active', ends_at: '2000-01-01' }, { id: 'active', name: 'Oferta actual', status: 'active', active_until_disabled: true }],
    crm_cliente_pagos: [
      { id: 'other-payment', cliente_id: otherId, pack_name: 'Paquete ajeno', estado: 'completed', updated_at: now },
      { id: 'pending-payment', cliente_id: clientId, pack_name: 'Sin pagar', estado: 'pending', updated_at: now },
      { id: 'old-payment', cliente_id: clientId, pack_name: 'Antiguo', estado: 'completed', updated_at: '2000-01-01' },
      { id: 'own-payment', cliente_id: clientId, pack_name: 'Paquete celestial', estado: 'completed', updated_at: now },
    ],
    tc_client_benefit_events: [
      { cliente_id: clientId, payment_id: 'own-payment', coins: 500 },
      { cliente_id: otherId, payment_id: 'own-payment', coins: 9000 },
      { cliente_id: clientId, payment_id: 'other-payment', coins: 7000 },
    ],
    tc_client_rank_benefits: [['bronce', .01], ['plata', 100], ['oro', 500], ['diamante', 1000]].map(([rank_key, min_spend]) => ({ rank_key, min_spend, label: rank_key, ritual_access: rank_key === 'diamante' })),
    raffles: [{ id: 'active-raffle', title: 'Sorteo celestial', status: 'active' }],
    raffle_entries: [
      { raffle_id: 'active-raffle', client_id: clientId, raffle_number: 7 },
      { raffle_id: 'active-raffle', client_id: clientId, raffle_number: 19 },
      { raffle_id: 'active-raffle', client_id: otherId, raffle_number: 999 },
      { raffle_id: 'other-raffle', client_id: clientId, raffle_number: 555 },
    ],
    ...options.tables,
  };
  const admin = {
    async rpc(name, args) {
      calls.push({ rpc: name, args });
      const error = options.rpcErrors?.[name] || null;
      const data = name === 'tc_client_state_snapshot' ? state : name.startsWith('cliente_ruleta_resumen') ? roulette : name === 'tc_available_rank_bonuses' ? [] : null;
      return { data: error ? null : data, error };
    },
    from(table) {
      const filters = []; let columns, single = false, limit = Infinity;
      const query = {
        select(value) { columns = value; return this; },
        eq(key, value) { filters.push(['eq', key, value]); return this; },
        in(key, value) { filters.push(['in', key, value]); return this; },
        gte(key, value) { filters.push(['gte', key, value]); return this; },
        order() { return this; }, limit(value) { limit = value; return this; },
        maybeSingle() { single = true; return this; },
        then(resolve, reject) {
          calls.push({ table, columns, filters: clone(filters) });
          const rows = (tables[table] || []).filter(row => filters.every(([op, key, value]) => op === 'eq' ? row[key] === value : op === 'in' ? value.includes(row[key]) : row[key] >= value));
          const data = rows.slice(0, limit).map(row => Object.fromEntries(columns.split(',').map(key => [key, row[key]])));
          const error = options.tableErrors?.[table] || null;
          return Promise.resolve({ data: error ? null : single ? data[0] || null : data, count: rows.length, error }).then(resolve, reject);
        },
      }; return query;
    },
  };
  const api = load('src/lib/server/leonaris-context.ts', {
    '@/lib/server/client-promotions': { promotionIsLive: row => row.status === 'active' && (row.active_until_disabled || Date.parse(row.ends_at) > Date.now()) },
    '@/lib/client-rank-guide': rankGuide, '@/lib/leo-guide': guide, '@/lib/leonaris-companion': companion,
  });
  return { api, calls, admin, gate: { admin, cliente: { id: clientId }, user: { id: userId } } };
}

test('live context uses the authenticated owner and rejects missing, invalid or foreign balances', async () => {
  for (const options of [
    { rpcErrors: { tc_client_state_snapshot: { code: 'DOWN' } } },
    { state: { cliente_id: otherId } }, { state: { auth_user_id: 'other-user' } },
    { state: { coins: null } }, { state: { minutes_total: undefined } }, { state: { oracle_credits: -1 } },
  ]) {
    const f = contextFixture(options);
    await assert.rejects(f.api.loadLeonarisContext(f.gate), /LEONARIS_BALANCE_UNAVAILABLE/);
  }
  const f = contextFixture(), context = await f.api.loadLeonarisContext(f.gate);
  assert.equal(context.name, 'Ana'); assert.equal(context.facts.coins, 1200); assert.equal(context.facts.minutes, 233);
  for (const call of f.calls.filter(call => call.rpc)) assert.equal(call.args.p_cliente_id, clientId);
  assert.deepEqual(f.calls.find(call => call.table === 'crm_clientes').filters, [['eq', 'id', clientId]]);
});

test('purchase greeting names only a recent completed own payment and its own credited benefits', async () => {
  const f = contextFixture(), context = await f.api.loadLeonarisContext(f.gate);
  assert.deepEqual(clone(context.purchase), { id: 'own-payment', name: 'Paquete celestial', coins: 500 });
  const message = f.api.leonarisCompanion(memory, context).greeting.message;
  assert.match(message, /Ana/); assert.match(message, /Paquete celestial/); assert.match(message, /500 Coins/);
  assert.doesNotMatch(message, /ajeno|Sin pagar|Antiguo|9000|7000/);
  const noPayment = contextFixture({ tables: { crm_cliente_pagos: [{ id: 'p', cliente_id: clientId, estado: 'pending', updated_at: new Date().toISOString() }] } });
  assert.equal((await noPayment.api.loadLeonarisContext(noPayment.gate)).purchase, null);
});

test('purchase benefit lookup failure remains unknown and never announces invented credited coins', async () => {
  const f = contextFixture({ tableErrors: { tc_client_benefit_events: { code: 'DOWN' } } });
  const context = await f.api.loadLeonarisContext(f.gate);
  assert.equal(context.purchase.coins, null);
  assert.doesNotMatch(f.api.leonarisCompanion(memory, context).greeting.message, /Ha acreditado|\b0 Coins/);
});

test('greeting recommends only playable roulette levels and failed roulette lookup stays unavailable', async () => {
  const f = contextFixture(), context = await f.api.loadLeonarisContext(f.gate);
  const greeting = f.api.leonarisCompanion(memory, context).greeting;
  assert.match(greeting.message, /2 giros de nivel 2/); assert.doesNotMatch(greeting.message, /nivel 5/);
  assert.deepEqual(clone(greeting.actions.map(action => action.level)), [2]);
  for (const options of [{ rpcErrors: { cliente_ruleta_resumen_ultra_v1: { code: 'DOWN' } } }, { roulette: { cliente_id: otherId } }]) {
    const failed = contextFixture(options), result = await failed.api.loadLeonarisContext(failed.gate);
    assert.equal(result.snapshot.roulette, null);
    assert.match(guide.leoHelp(result.snapshot, '/cliente/ruleta', 'roulette').message, /no puedo confirmar/);
    assert.doesNotMatch(failed.api.leonarisCompanion(memory, result).greeting.message, /0 giros|no tienes giros/i);
  }
  const fallback = contextFixture({ rpcErrors: { cliente_ruleta_resumen_ultra_v1: { code: '42883' } } });
  assert.ok((await fallback.api.loadLeonarisContext(fallback.gate)).snapshot.roulette);
  assert.ok(fallback.calls.some(call => call.rpc === 'cliente_ruleta_resumen_v4'));
});

test('raffle context exposes only the own entries of the active raffle, never other clients or drawings', async () => {
  const f = contextFixture(), context = await f.api.loadLeonarisContext(f.gate, true);
  assert.equal(context.raffleAvailable, true);
  assert.deepEqual(clone(context.raffle), { title: 'Sorteo celestial', numbers: [7, 19], total: 2 });
  assert.deepEqual(f.calls.find(call => call.table === 'raffle_entries').filters, [['eq', 'raffle_id', 'active-raffle'], ['eq', 'client_id', clientId]]);
  for (const options of [{ tableErrors: { raffle_entries: { code: 'DOWN' } } }, { tables: { raffle_entries: [{ raffle_id: 'active-raffle', client_id: clientId, raffle_number: 'invalid' }] } }]) {
    const unavailable = contextFixture(options), result = await unavailable.api.loadLeonarisContext(unavailable.gate, true);
    assert.equal(result.raffleAvailable, false); assert.equal(result.raffle, null);
  }
});

test('missing rank catalogue or bonus state remains unavailable rather than a fabricated zero', async () => {
  const f = contextFixture({ tableErrors: { tc_client_rank_benefits: { code: 'DOWN' } }, rpcErrors: { tc_available_rank_bonuses: { code: 'DOWN' } } });
  const context = await f.api.loadLeonarisContext(f.gate, true);
  assert.equal(context.snapshot.ranks, null); assert.equal(context.snapshot.bonuses, null);
});

const requestId = '30000000-0000-4000-8000-000000000003';
function chatModule(contextApi, options = {}) {
  const requests = [], timeouts = [];
  const chat = load('src/lib/server/leonaris-chat.ts', {
    '@/lib/leo-guide': guide, '@/lib/leonaris-companion': companion, './leonaris-context': contextApi,
  }, {
    process: { env: options.noModel ? {} : { OPENAI_API_KEY: 'fixture-only-not-a-real-key', LEONARIS_MODEL: 'fixture-model' } },
    AbortSignal: { timeout: value => { timeouts.push(value); return new AbortController().signal; } },
    fetch: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      if (options.timeout) throw new DOMException('Timed out', 'TimeoutError');
      if (options.httpFailure) return new Response('{}', { status: 503 });
      const selection = options.selection ?? { opening: 'Te acompaño.', cardIds: ['balance'] };
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: options.invalidJSON ? 'invalid JSON' : JSON.stringify(selection) }] }] }), { status: 200 });
    },
  });
  return { chat, requests, timeouts };
}

test('model choices produce only verified amounts and server catalogue actions, never model URLs or rewards', async () => {
  const f = contextFixture(), context = await f.api.loadLeonarisContext(f.gate, true);
  const c = chatModule(f.api, { selection: { opening: 'Tienes 99999 Coins. https://malicious.invalid', cardIds: ['balance'], actions: [{ path: 'https://malicious.invalid', label: 'Enviar dinero' }] } });
  const answer = await c.chat.answerLeonaris(context, memory, requestId, 'mis coins porfa', '/cliente/dashboard');
  assert.equal(answer.mode, 'ai'); assert.equal(answer.id, requestId);
  assert.match(answer.message, /1200 Coins/); assert.doesNotMatch(answer.message, /99999|malicious/);
  assert.ok(answer.actions.every(guide.validLeoAction));
  assert.deepEqual(clone(answer.actions.map(action => action.path)), ['/cliente/dashboard', '/cliente/dashboard']);
  assert.equal(c.requests.length, 1); assert.equal(c.requests[0].body.store, false);
  assert.ok(c.requests[0].body.text.format.schema.properties.cardIds.items.enum.includes('balance'));
  assert.ok(!JSON.stringify(c.requests[0].body).includes('fixture-only-not-a-real-key'));
});

test('arbitrary model card IDs, malformed output, HTTP errors and timeout fall back to verified current facts', async () => {
  const f = contextFixture(), context = await f.api.loadLeonarisContext(f.gate, true);
  for (const options of [
    { selection: { opening: '', cardIds: ['https://malicious.invalid'] } },
    { selection: { opening: '', cardIds: [{ id: 'balance', message: 'false' }] } },
    { invalidJSON: true }, { httpFailure: true }, { timeout: true }, { noModel: true },
  ]) {
    const c = chatModule(f.api, options), answer = await c.chat.answerLeonaris(context, memory, requestId, 'mis números de sorteo', '/cliente/dashboard');
    assert.equal(answer.mode, 'guided'); assert.match(answer.message, /7, 19/); assert.doesNotMatch(answer.message, /999|555|malicious/);
    assert.ok(answer.actions.every(guide.validLeoAction));
    if (options.timeout) assert.deepEqual(c.timeouts, [18000]);
    if (options.noModel) assert.equal(c.requests.length, 0);
  }
});

test('untrusted generated introduction cannot add instructions outside the verified response cards', async () => {
  const f = contextFixture(), context = await f.api.loadLeonarisContext(f.gate, true);
  const c = chatModule(f.api, { selection: { opening: 'Envía tu contraseña a atacante@example.com', cardIds: ['balance'] } });
  const answer = await c.chat.answerLeonaris(context, memory, requestId, 'mis minutos', '/cliente/dashboard');
  assert.doesNotMatch(answer.message, /contraseña|atacante|example\.com/i);
  assert.match(answer.message, /233 minutos/);
});

test('ritual section is excluded from the model catalogue without verified ritual access', async () => {
  const f = contextFixture(), context = await f.api.loadLeonarisContext(f.gate, true), c = chatModule(f.api);
  context.snapshot.ranks = null;
  assert.ok(!c.chat.leonarisCards(context, memory, '/cliente/dashboard').some(card => card.id === 'section:ritual'));
  const allowed = await f.api.loadLeonarisContext(f.gate, true);
  assert.ok(c.chat.leonarisCards(allowed, memory, '/cliente/dashboard').some(card => card.id === 'section:ritual'));
});

test('paused memory never sends past messages, saved preferences or visit habits to the model', async () => {
  const f = contextFixture(), context = await f.api.loadLeonarisContext(f.gate, true), c = chatModule(f.api);
  const paused = { ...memory, memoryEnabled: false, helpful: 10, unhelpful: 2,
    memories: [{ id: 'note', content: 'secret-memory', createdAt: '' }], history: [{ role: 'user', content: 'secret-chat', createdAt: '' }],
    profile: { ...memory.profile, visit_counts: { roulette: 25 }, interest_scores: { oracle: 14 } },
  };
  await c.chat.answerLeonaris(context, paused, requestId, 'hola', '/cliente/dashboard');
  const sent = JSON.parse(c.requests[0].body.input[0].content);
  assert.deepEqual(sent.preferences.memories, []); assert.deepEqual(sent.preferences.favorites, []); assert.deepEqual(sent.history, []);
  assert.equal(sent.preferences.helpful, 0); assert.equal(sent.preferences.unhelpful, 0);
  assert.doesNotMatch(JSON.stringify(c.requests[0].body), /secret-memory|secret-chat|Sueles visitar/);
});

test('guided fallback understands explicit memory, raffle and roulette-level requests without claiming unperformed actions', async () => {
  const f = contextFixture(), context = await f.api.loadLeonarisContext(f.gate, true), c = chatModule(f.api, { noModel: true });
  for (const [question, expected, forbidden] of [
    ['Recuerda que prefiero mensajes cortos', /Guardar recuerdo/, /he guardado|ya est[aá] guardado/i],
    ['¿Qué recuerdas de mí?', /Aún no me has pedido guardar/, /recuerdo que/i],
    ['¿Cuáles son mis números de sorteo?', /7, 19/, /999|555/],
    ['¿Puedo usar mi ruleta de nivel 5?', /Acceso Diamante no disponible/, /Puedes revisar sus premios y pulsar/],
    ['¿Qué giro tengo en la ruleta de nivel 2?', /2 giros/, /he girado|he utilizado un giro/i],
  ]) {
    const answer = await c.chat.answerLeonaris(context, memory, requestId, question, '/cliente/dashboard');
    assert.equal(answer.mode, 'guided'); assert.match(answer.message, expected); assert.doesNotMatch(answer.message, forbidden);
  }
  const failed = contextFixture({ rpcErrors: { cliente_ruleta_resumen_ultra_v1: { code: 'DOWN' } } });
  const unknown = await failed.api.loadLeonarisContext(failed.gate, true);
  const answer = await chatModule(failed.api, { noModel: true }).chat.answerLeonaris(unknown, memory, requestId, 'mi ruleta de nivel 2', '/cliente/ruleta');
  assert.match(answer.message, /no puedo confirmar/); assert.doesNotMatch(answer.message, /\b0 giros|no tienes giros/i);
});

test('a failed purchase lookup is described as unavailable, not as proof that no purchase was confirmed', async () => {
  const f = contextFixture({ tableErrors: { crm_cliente_pagos: { code: 'DOWN' } } });
  const context = await f.api.loadLeonarisContext(f.gate, true);
  const answer = await chatModule(f.api, { noModel: true }).chat.answerLeonaris(context, memory, requestId, 'mi última compra confirmada', '/cliente/dashboard');
  assert.match(answer.message, /no he podido|no puedo|no est[aá] disponible/i);
  assert.doesNotMatch(answer.message, /No aparece una compra|no tienes compras/i);
});

function endpoint(options = {}) {
  const calls = [], logs = [];
  const f = contextFixture({ ...options.context, tables: {
    crm_clientes: [{ id: clientId, auth_user_id: userId, nombre: 'Ana' }, { id: otherId, auth_user_id: 'other-user', nombre: 'Otra clienta' }],
    tc_client_leo_profiles: [{ client_id: clientId, hidden: false, muted: true, visit_counts: {}, interest_scores: {}, interaction_counts: {} }],
    ...options.context?.tables,
  } });
  f.admin.auth = { getUser: async token => ({ data: { user: token === 'valid' ? { id: userId } : null }, error: token === 'valid' ? null : { status: 401 } }) };
  const access = load('src/lib/server/ruleta-access.ts', { '@supabase/supabase-js': { createClient: () => f.admin } }, { process: { env: {} } });
  class LeonarisMemoryError extends Error { constructor(code) { super(code); this.code = code; } }
  const operations = {
    LeonarisMemoryError,
    getLeonarisMemory: async id => { calls.push({ operation: 'read', id }); return options.memory || memory; },
    claimLeonarisChat: async (id, rid, question) => { calls.push({ operation: 'claim', id, rid, question }); return options.claim || { status: 'claimed', claimToken: '40000000-0000-4000-8000-000000000004' }; },
  };
  for (const [name, operation] of Object.entries({ updateLeonarisPreferences: 'preferences', rememberLeonarisMemory: 'remember', forgetLeonarisMemory: 'forget', resetLeonarisMemory: 'reset', completeLeonarisChat: 'complete', failLeonarisChat: 'fail', recordLeonarisFeedback: 'feedback', recordLeonarisSignal: 'signal' })) {
    operations[name] = async (id, ...args) => { calls.push({ operation, id, args }); if (options.memoryError === operation) throw new LeonarisMemoryError('unavailable'); };
  }
  const c = chatModule(f.api, { noModel: true });
  const intelligence = load('src/lib/leo-celestial-intelligence.ts');
  const api = load('src/app/api/cliente/leo/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), { ...init, headers: { ...init?.headers, 'Content-Type': 'application/json' } }) } },
    '@/lib/server/ruleta-access': access, '@/lib/leo-celestial-intelligence': intelligence, '@/lib/leo-guide': guide,
    '@/lib/leonaris-companion': companion, '@/lib/server/leonaris-context': f.api, '@/lib/server/leonaris-memory': operations,
    '@/lib/server/leonaris-chat': { answerLeonaris: async (...args) => { calls.push({ operation: 'answer', contextClient: args[0].snapshot.roulette?.cliente_id, pathname: args[4] }); return c.chat.answerLeonaris(...args); } },
  }, { console: { error: (...args) => logs.push(args) } });
  return { api, calls, queries: f.calls, logs };
}
const postRequest = (body, token = 'valid') => new Request('http://local/api/cliente/leo', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('API authenticates before reads and mutations and cannot be redirected by request-supplied client identity', async () => {
  for (const token of ['', 'invalid']) {
    const f = endpoint();
    assert.equal((await f.api.GET(new Request('http://local/api/cliente/leo', { headers: token ? { authorization: 'Bearer ' + token } : {} }))).status, 401);
    assert.equal((await f.api.POST(postRequest({ action: 'forget_all', client_id: otherId }, token))).status, 401);
    assert.equal(f.calls.length, 0); assert.equal(f.queries.length, 0);
  }
  const f = endpoint();
  const response = await f.api.GET(new Request('http://local/api/cliente/leo?client_id=' + otherId, { headers: { authorization: 'Bearer valid' } }));
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /private.*no-store/); assert.equal(response.headers.get('vary'), 'Authorization');
  const data = await response.json(); assert.match(data.companion.greeting.message, /Hola, Ana/); assert.doesNotMatch(JSON.stringify(data), /Otra clienta/);
  for (const call of f.calls.filter(call => call.id)) assert.equal(call.id, clientId);
  assert.deepEqual(f.queries.find(query => query.table === 'tc_client_leo_profiles').filters, [['eq', 'client_id', clientId]]);
});

test('API memory, feedback and activity operations always use verified client id, ignoring foreign body identity', async () => {
  const actions = [
    { action: 'remember', content: 'Prefiero respuestas breves' }, { action: 'forget', memoryId: requestId },
    { action: 'forget_all' }, { action: 'feedback', answerId: requestId, helpful: true },
    { action: 'preference', memoryEnabled: false, style: 'concise' }, { action: 'preference', hidden: true },
    { action: 'visit', pathname: '/cliente/ruleta' }, { action: 'interaction', pathname: 'https://malicious.invalid', context: 'not-a-context' },
  ];
  for (const action of actions) {
    const f = endpoint(), result = await f.api.POST(postRequest({ ...action, client_id: otherId, cliente_id: otherId }));
    assert.equal(result.status, 200);
    for (const call of f.calls.filter(call => call.id)) assert.equal(call.id, clientId);
    for (const query of f.queries.filter(query => query.rpc)) assert.equal(query.args.p_cliente_id ?? query.args.p_client_id, clientId);
    if (action.action === 'interaction') assert.equal(f.calls.find(call => call.operation === 'signal').args[0].pathname, '/cliente/dashboard');
  }
});

test('API rejects malformed, oversized and invalid chat requests without claiming a conversation', async () => {
  for (const body of ['{', 'null', '[]', JSON.stringify({ action: 'unknown' }), JSON.stringify({ action: 'chat', requestId: 'invalid', message: 'hola' }), JSON.stringify({ action: 'chat', requestId, message: 'x'.repeat(2001) }), ' '.repeat(16001)]) {
    const f = endpoint(), response = await f.api.POST(postRequest(body));
    assert.ok([400, 413].includes(response.status)); assert.equal(f.calls.length, 0);
  }
});

test('API chat completion is scoped and follows claim ownership; in-progress and cached requests never regenerate', async () => {
  const f = endpoint();
  const response = await f.api.POST(postRequest({ action: 'chat', requestId, message: ' mis números del sorteo ', pathname: '/cliente/sorteo', client_id: otherId }));
  assert.equal(response.status, 200); assert.match((await response.json()).answer.message, /7, 19/);
  assert.equal(f.calls.find(call => call.operation === 'answer').contextClient, clientId);
  const complete = f.calls.find(call => call.operation === 'complete'); assert.equal(complete.id, clientId); assert.equal(complete.args[0], requestId); assert.equal(complete.args[1], '40000000-0000-4000-8000-000000000004');
  assert.ok(!f.calls.some(call => call.operation === 'fail'));
  for (const status of ['in_progress', 'rate_limited']) {
    const blocked = endpoint({ claim: { status, retryAfter: 7 } });
    const result = await blocked.api.POST(postRequest({ action: 'chat', requestId, message: 'hola' }));
    assert.equal(result.status, 429); assert.equal(result.headers.get('retry-after'), '7'); assert.deepEqual(blocked.calls.map(call => call.operation), ['claim']);
  }
  const saved = { id: requestId, title: 'Respuesta guardada', message: 'Ya respondido', actions: [], mode: 'guided' };
  const cached = endpoint({ claim: { status: 'completed', answer: saved } });
  assert.deepEqual((await (await cached.api.POST(postRequest({ action: 'chat', requestId, message: 'hola' }))).json()).answer, saved);
  assert.deepEqual(cached.calls.map(call => call.operation), ['claim']);
});

test('unavailable live facts fail the claimed chat safely without logging question text or inventing a balance', async () => {
  const f = endpoint({ context: { rpcErrors: { tc_client_state_snapshot: { code: 'DOWN' } } } });
  const response = await f.api.POST(postRequest({ action: 'chat', requestId, message: 'private-sensitive-question' }));
  assert.equal(response.status, 503); assert.equal((await response.json()).ok, false);
  assert.ok(f.calls.some(call => call.operation === 'fail' && call.id === clientId));
  assert.ok(!f.calls.some(call => call.operation === 'answer' || call.operation === 'complete'));
  assert.doesNotMatch(JSON.stringify(f.logs), /private-sensitive-question|DOWN/);
});
