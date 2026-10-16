const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

function fixture({ model = true, response } = {}) {
  const queries = [], calls = [], requests = [];
  let now = Date.parse('2026-10-16T09:00:00Z');
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const evaluate = (file, imports) => {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib', file + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, require: imports, Date: Clock, Intl, AbortSignal, Map, Set, Object, Number, Math, Error, console, process: { env: model ? { OPENAI_API_KEY: 'test-only', CENTRAL_ASSISTANT_MODEL: 'configured-model' } : {} }, fetch: async (_, init) => {
      const request = JSON.parse(init.body); requests.push(request);
      return response ? response({ request, advance: ms => { now += ms; } }) : { ok: true, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Respuesta contextual del modelo.' }] }] }) };
    } });
    return exports;
  };
  const shared = evaluate('central-assistant', () => ({}));
  const server = evaluate('server/central-assistant', name => name === '@/lib/central-assistant' ? shared : {});
  const result = tool => ({ text: `Resultado verificado: ${tool}`, cards: [], updatedAt: new Clock().toISOString() });
  const db = { from(table) {
    queries.push(table);
    const query = { select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; }, then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); } };
    return query;
  } };
  const chat = evaluate('server/central-assistant-chat', name => {
    if (name === '@/lib/central-assistant') return shared;
    if (name === './central-assistant') return {
      checked: async query => (await query).data,
      currentResults: async (_ctx, results) => results,
      brief: async () => result('brief'),
      petInstructions: server.petInstructions,
      runTool: async (ctx, tool, args) => { calls.push({ workerId: ctx.worker.id, tool, args }); return result(tool); },
    };
    if (name === './central-assistant-learning') return { learningContext: async () => 'Sin resultados registrados.' };
    if (name === './central-assistant-lookup') return { parseLookupRequest: () => null, lastClientReference: () => undefined };
    if (name === './central-assistant-capture') return { parseCaptureRequest: q => /cuantos contactos entraron ayer y hoy/i.test(shared.normalizeText(q)) ? { from: '2026-10-15', to: '2026-10-16' } : null };
    if (name === './madrid-reporting-period') return { madridTodayKey: () => '2026-10-16' };
    return {};
  });
  return { chat, shared, server, queries, calls, requests, ctx: { db, worker: { id: 'worker-isa', user_id: 'auth-isa', display_name: 'Isa', role: 'central' }, identityIds: ['worker-isa'] } };
}

test('all companions welcome the current worker without model latency or private data reads', async () => {
  for (const pet of ['sol', 'draco', 'ambar']) {
    const f = fixture();
    const response = await f.chat.answer(f.ctx, `¡Hola, ${f.shared.PETS[pet].name}!`, 'crm', pet);
    assert.equal(response.mode, 'guided');
    assert.ok(response.result.text.includes(f.shared.PETS[pet].name));
    assert.match(response.result.text, /Isa/);
    assert.equal(f.requests.length, 0); assert.equal(f.queries.length, 0); assert.equal(f.calls.length, 0);
    assert.ok(response.result.cards.every(card => f.shared.safeTab(card.tab)));
  }
});

test('explicit navigation supplies a button without claiming that navigation or work already happened', async () => {
  const f = fixture();
  for (const question of ['Llévame a Captación', 'Ámbar, abre la pestaña de reservas, por favor']) {
    const { result } = await f.chat.answer(f.ctx, question, 'central', 'ambar');
    assert.equal(result.cards.length, 1);
    assert.equal(result.cards[0].tab, question.includes('Captación') ? 'captacion' : 'reservas');
    assert.match(result.text, /Pulsa el botón/);
  }
  assert.equal(f.requests.length, 0); assert.equal(f.calls.length, 0);
  const unknown = await f.chat.answer(f.ctx, 'Abre administración y cambia los permisos', 'central', 'ambar');
  assert.equal(unknown.mode, 'ai');
  assert.equal(unknown.result.cards.length, 0);
});

test('a greeting never swallows an operational request or manufactures its result', async () => {
  const f = fixture();
  const response = await f.chat.answer(f.ctx, 'Hola Ámbar, cuántos contactos entraron ayer y hoy?', 'captacion', 'ambar');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].tool, 'capture_summary');
  assert.equal(f.calls[0].workerId, 'worker-isa');
  assert.match(response.result.text, /Resultado verificado/);
  assert.equal(f.requests.length, 0);
});

test('support and memory explanations work without AI and avoid fabricated feelings or saved memories', async () => {
  const f = fixture({ model: false });
  assert.match((await f.chat.answer(f.ctx, 'Estoy agobiada', 'central', 'ambar')).result.text, /con calma/);
  assert.match((await f.chat.answer(f.ctx, '¿Me quieres?', 'central', 'draco')).result.text, /no tengo sentimientos propios/);
  const learning = (await f.chat.answer(f.ctx, '¿Cómo aprendes?', 'central', 'sol')).result;
  assert.match(learning.text, /recuerdos confirmados/); assert.match(learning.text, /revisar o borrar/);
  assert.equal(learning.proposal, undefined); assert.equal(f.calls.length, 0);
});

test('compound requests still reach the normal conversational tools and keep confirmation rules', async () => {
  const f = fixture();
  await f.chat.answer(f.ctx, 'Hola Ámbar, recuerda que mi turno empieza a las nueve', 'central', 'ambar', false);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].store, false);
  assert.match(f.requests[0].instructions, /Ámbar/);
  assert.match(f.requests[0].instructions, /No hagas bromas/);
  assert.match(f.requests[0].instructions, /propuestas pendientes de confirmación/);
  assert.match(f.requests[0].instructions, /No transfieras recuerdos/);
  assert.ok(f.requests[0].tools.some(tool => tool.name === 'prepare_memory'));
  assert.ok(f.requests[0].tools.some(tool => tool.name === 'capture_summary'));
});

test('a slow multi-step model returns the checked tool result instead of starting another long request', async () => {
  const f = fixture({ response: ({ advance }) => {
    advance(29_000);
    return { ok: true, json: async () => ({ output: [{ type: 'function_call', name: 'brief', arguments: '{}', call_id: 'verified-brief' }] }) };
  } });
  const response = await f.chat.answer(f.ctx, 'Revisa mis pendientes y ayúdame a organizar el turno', 'central', 'ambar');
  assert.equal(f.requests.length, 1); assert.equal(f.calls.length, 1);
  assert.equal(response.mode, 'guided');
  assert.match(response.result.text, /Resultado verificado: brief/);
  assert.ok(response.result.unavailable.includes('Conversación inteligente'));
});
