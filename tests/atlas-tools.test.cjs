const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function harness(options = {}) {
  const tables = {
    workers: [{ id: id(2), display_name: 'Isa', role: 'central', is_active: true }, { id: id(3), display_name: 'Maria', role: 'central', is_active: true }],
    tc_client_promotions: [{ id: id(20), name: 'Promo Locura', promotion_kind: 'standard', status: 'active', active_until_disabled: true, updated_at: '2026-10-19T10:00:00Z' }],
    tc_client_promotion_packages: [{ id: id(21), promotion_id: id(20), name: 'Pack', price: 20, currency: 'EUR', is_active: true, updated_at: '2026-10-19T10:00:00Z' }],
  };
  const proposals = [], operations = [];
  const summary = {
    updatedAt: '2026-10-19T16:00:00Z', revenue: { today: 180, goal: 300 }, acquisition: { count: 4, goal: 10 }, unavailable: [],
    missions: [
      { worker_id: id(2), enabled: true, active: true, starts_at: '2026-10-19T12:00:00Z', ends_at: '2026-10-19T20:00:00Z', managed: 8, recovered: 2 },
      { worker_id: id(3), enabled: true, active: false, starts_at: '2026-10-19T20:00:00Z', ends_at: '2026-10-20T04:00:00Z', managed: 0, recovered: 0 },
    ],
    followups: [{ worker_id: id(2) }, { worker_id: id(2) }, { worker_id: id(3) }],
    followupSummary: { partial: false, byWorker: [{ worker_id: id(2), overdue: 2, upcoming: 1 }, { worker_id: id(3), overdue: 1, upcoming: 3 }] },
    ...(options.summary || {}),
  };
  const deadlines = options.deadlines || { [id(2)]: '2026-10-19T20:00:00Z', [id(3)]: '2026-10-20T04:00:00Z' };
  const db = { from(table) {
    let data = [...(tables[table] || [])], one = false;
    const q = { select() { return q; }, order() { return q; }, limit() { return q; },
      eq(key, val) { data = data.filter(r => r[key] === val); return q; },
      neq(key, val) { data = data.filter(r => r[key] !== val); return q; },
      in(key, val) { data = data.filter(r => val.includes(r[key])); return q; },
      insert(row) { proposals.push(row); data = [row]; return q; }, single() { one = true; return q; },
      then(resolve, reject) { return Promise.resolve({ data: one ? data[0] : data, error: null }).then(resolve, reject); } };
    return q;
  } };
  const context = { db, worker: { id: id(1), user_id: id(1), role: 'admin', display_name: 'Admin' } };
  const exports = {}, code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/server/atlas-tools.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const operationsModule = {
    ecuadorDay: date => new Date(date.getTime() - 5 * 3600000).toISOString().slice(0, 10),
    overview: async (...args) => { operations.push({ name: 'overview', args }); if (options.overviewError) throw new Error('Overview unavailable'); return summary; },
    candidates: async (...args) => {
      operations.push({ name: 'candidates', args });
      if (options.failedCandidates?.includes(args[3])) throw new Error('Candidates unavailable');
      return { candidates: options.candidates?.[args[3]] || [] };
    },
    prepareDispatch: async (...args) => {
      operations.push({ name: 'prepareDispatch', args }); const worker = args[3] || id(2);
      return { payload: { kind: args[1], title: 'Contactos', items: [{ worker_id: worker, client_id: id(10) }], due_at: '2026-10-20T04:00:00Z', due_by_worker: { [worker]: '2026-10-19T20:00:00Z' } }, candidates: [] };
    },
    prepareTask: async (...args) => {
      operations.push({ name: 'prepareTask', args });
      const [_ctx, title, description, workerIds, due] = args;
      const dueByWorker = Object.fromEntries(workerIds.map(workerId => [workerId, due || deadlines[workerId]]));
      return { payload: { kind: 'task', title, description, worker_ids: workerIds, due_at: Object.values(dueByWorker).sort().at(-1), due_by_worker: dueByWorker } };
    },
  };
  vm.runInNewContext(code, { exports, Date, Number, String, Set, Map, console, require: name => {
    if (name === 'node:crypto') return { randomUUID: () => id(1000 + proposals.length) };
    if (name === '@/lib/atlas') return { atlasUuid: x => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(x), atlasNormalize: s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() };
    if (name === './atlas-access') return { atlasChecked: async q => { const r = await q; if (r.error) throw r.error; return r.data; }, AtlasError: Error };
    if (name === './client-promotions') return { effectivePromotionStatus: r => r.status };
    if (name === './atlas-operations') return operationsModule;
    throw new Error(name);
  } });
  return { context, tables, proposals, operations, summary, run: (name, args) => exports.atlasRunTool(context, name, args) };
}

test('explicit dispatch names resolve to the exact active worker UUID and never fall back to both', async () => {
  const h = harness();
  await h.run('prepare_dispatch', { kind: 'recovery', count: 10, worker: 'María' });
  assert.equal(h.operations[0].args[3], id(3));
  assert.equal(h.proposals[0].payload.items[0].worker_id, id(3));
  const count = h.proposals.length, calls = h.operations.length;
  const missing = await h.run('prepare_dispatch', { kind: 'recovery', count: 10, worker: 'Mariana' });
  assert.match(missing.text, /central activa única/); assert.equal(h.proposals.length, count); assert.equal(h.operations.length, calls);
  const mismatch = await h.run('prepare_dispatch', { kind: 'recovery', count: 10, worker_id: id(2), worker: 'Maria' });
  assert.match(mismatch.text, /no coinciden/); assert.equal(h.operations.length, calls);
});

test('candidate lookups preserve the explicit owner and duplicate worker names require clarification', async () => {
  const h = harness(); await h.run('candidates', { kind: 'capture', count: 10, worker: 'Isa' });
  assert.equal(h.operations[0].args[3], id(2));
  h.tables.workers.push({ id: id(4), display_name: 'Isa', role: 'central', is_active: true });
  const answer = await h.run('prepare_dispatch', { kind: 'capture', count: 10, worker: 'Isa' });
  assert.match(answer.text, /central activa única/); assert.equal(h.operations.length, 1); assert.equal(h.proposals.length, 0);
});

test('deactivation list and selected proposal preserve the operation without changing another promotion', async () => {
  const h = harness(); const list = await h.run('promotions', { activate: false });
  assert.match(list.text, /desactivar/); assert.match(list.cards[0].prompt, /^Desactiva /);
  const selected = await h.run('prepare_promotion', { query: id(20), activate: false });
  assert.equal(selected.proposal.kind, 'deactivate_promotion'); assert.equal(h.proposals[0].payload.promotion_id, id(20));
});

test('task approval shows the actual deadline for each responsible central', async () => {
  const h = harness(); await h.run('prepare_task', { title: 'Revisar seguimientos', description: 'Registrar el resultado', worker: '' });
  const details = h.proposals[0].payload.details, isa = details.find(d => d.label === 'Isa'), maria = details.find(d => d.label === 'Maria');
  assert.ok(isa && maria); assert.notEqual(isa.value, maria.value);
  assert.match(isa.value, /15:00/); assert.match(maria.value, /23:00/);
});

test('a weekly recovery plan consults current evidence per worker and prepares concrete steps without dispatching', async () => {
  const h = harness({ candidates: {
    [id(2)]: [{ client_id: id(40), reasons: ['Seguimiento vencido', 'Pendiente propio'] }, { client_id: id(41), reasons: ['Seguimiento vencido'] }],
    [id(3)]: [{ client_id: id(42), reasons: ['Pendiente propio'] }],
  } });
  const response = await h.run('prepare_task', { title: 'Plan semanal para mejorar recuperación', description: 'Organiza el trabajo de Isa y María esta semana', worker: '' });
  assert.equal(h.operations.filter(call => call.name === 'overview').length, 1);
  const candidates = h.operations.filter(call => call.name === 'candidates');
  assert.deepEqual(candidates.map(call => [call.args[1], call.args[2], call.args[3]]), [['recovery', 5, id(2)], ['recovery', 5, id(3)]]);
  assert.equal(h.operations.some(call => call.name === 'prepareDispatch'), false);
  assert.equal(response.proposal.status, 'pending'); assert.equal(response.proposal.kind, 'create_task');
  const { title, description, details } = h.proposals[0].payload;
  assert.equal(title, 'Plan semanal de recuperación');
  assert.match(description, /8\/30 gestiones y 2\/5 recuperaciones registradas/);
  assert.match(description, /2 seguimientos vencidos y 1 próximos/);
  assert.match(description, /2 candidatos elegibles en una muestra de hasta 5; no se han reservado/);
  assert.match(description, /Prioridad: Seguimiento vencido; Pendiente propio/);
  assert.match(description, /superar 300 EUR diarios.*10 captaciones al mes entre todas las centrales/);
  assert.match(description, /1\. Al comenzar el turno.*preparar o revisar la misión propia/);
  assert.match(description, /2\. Antes de contactar.*Registrar el canal real, respuesta o interés/);
  assert.match(description, /3\. Completar 30 gestiones distintas.*compra confirmada/);
  assert.match(description, /4\. Antes del plazo.*pendientes para el relevo/);
  assert.match(description, /no reserva ni reasigna clientes/);
  assert.match(description, /no exigir recuperación en descanso/);
  assert.equal(details.find(detail => detail.label === 'Encargo').value, description);
});

test('weekly plans finish on the same Ecuador Friday at each central closing time', async () => {
  const h = harness();
  await h.run('prepare_task', { title: 'Plan semanal de recuperación', description: 'Mejorar la recuperación esta semana' });
  const payload = h.proposals[0].payload;
  assert.equal(payload.due_by_worker[id(2)], '2026-10-23T20:00:00.000Z');
  assert.equal(payload.due_by_worker[id(3)], '2026-10-24T04:00:00.000Z');
  assert.equal(payload.due_at, '2026-10-24T04:00:00.000Z');
  assert.match(payload.details.find(detail => detail.label === 'Isa').value, /23\/10\/2026.*15:00/);
  assert.match(payload.details.find(detail => detail.label === 'Maria').value, /23\/10\/2026.*23:00/);
});

test('Friday closing across UTC midnight does not move the plan into the next week', async () => {
  const h = harness({ deadlines: { [id(2)]: '2026-10-23T20:00:00Z', [id(3)]: '2026-10-24T04:00:00Z' } });
  await h.run('prepare_task', { title: 'Plan semanal de recuperación', description: 'Organiza el equipo' });
  assert.equal(h.proposals[0].payload.due_by_worker[id(3)], '2026-10-24T04:00:00.000Z');
  assert.equal(h.proposals[0].payload.due_by_worker[id(2)], '2026-10-23T20:00:00.000Z');
});

test('a weekly plan respects an explicit deadline rather than silently changing it to Friday', async () => {
  const h = harness(); const requested = '2026-10-21T18:30:00Z';
  await h.run('prepare_task', { title: 'Plan semanal de recuperación', description: 'Organizar trabajo', worker: 'Isa', due_at: requested });
  const payload = h.proposals[0].payload;
  assert.equal(payload.due_by_worker[id(2)], '2026-10-21T18:30:00.000Z');
  assert.equal(payload.due_by_worker[id(3)], undefined);
  assert.equal(payload.due_at, '2026-10-21T18:30:00.000Z');
});

test('a capture plan uses capture candidates and keeps the monthly goal collective', async () => {
  const h = harness();
  await h.run('prepare_task', { title: 'Plan de captación', description: 'Organizar captación para Isa', worker: 'Isa' });
  const candidateCalls = h.operations.filter(call => call.name === 'candidates');
  assert.equal(candidateCalls.length, 1); assert.equal(candidateCalls[0].args[1], 'capture'); assert.equal(candidateCalls[0].args[3], id(2));
  const payload = h.proposals[0].payload;
  assert.equal(payload.title, 'Plan del turno de captación');
  assert.match(payload.description, /Abrir Captación.*excluir bajas, cerrados y seguimientos futuros/);
  assert.match(payload.description, /Confirmar la primera compra antes de clasificar una captación/);
  assert.match(payload.description, /meta mensual conjunta de 10 sin convertirla en una cuota individual/);
  assert.doesNotMatch(payload.description, /3\. Completar 30 gestiones/);
  assert.equal(payload.due_by_worker[id(2)], '2026-10-19T20:00:00Z');
});

test('unavailable sources are reported as unverified instead of fabricated zero activity', async () => {
  const h = harness({ overviewError: true, failedCandidates: [id(2), id(3)] });
  await h.run('prepare_task', { title: 'Plan semanal de recuperación', description: 'Organiza el equipo' });
  const description = h.proposals[0].payload.description;
  assert.match(description, /Isa: Revisar su turno antes de comenzar/);
  assert.match(description, /Maria: Revisar su turno antes de comenzar/);
  assert.match(description, /Seguimientos sin verificar en esta consulta/);
  assert.match(description, /Candidatos sin verificar; consultar el listado al empezar/);
  assert.doesNotMatch(description, /0 seguimientos|0 candidatos|0\/30|undefined|NaN|Objetivos compartidos/);
  assert.match(description, /Si falta una fuente.*marcar el encargo como bloqueado/);
  assert.equal(h.proposals[0].status, 'pending');
});

test('partially unavailable followups stay unverified while a verified empty candidate sample remains zero', async () => {
  const h = harness({ summary: { unavailable: ['Seguimientos'], followups: [], followupSummary: { partial: true, byWorker: [{ worker_id: id(2), overdue: 0, upcoming: 0 }] } } });
  await h.run('prepare_task', { title: 'Plan de recuperación', description: 'Organiza el equipo', worker: 'Isa' });
  const description = h.proposals[0].payload.description;
  assert.match(description, /Seguimientos sin verificar en esta consulta/);
  assert.match(description, /0 candidatos elegibles en una muestra de hasta 5/);
  assert.doesNotMatch(description, /0 seguimientos/);
});

test('a concrete task does not expand into a generic plan or consult unrelated production data', async () => {
  const h = harness();
  await h.run('prepare_task', { title: 'Revisar el seguimiento de Ana', description: 'Comprobar la nota y registrar el resultado', worker: 'Isa' });
  assert.equal(h.operations.length, 1); assert.equal(h.operations[0].name, 'prepareTask');
  assert.equal(h.proposals[0].payload.description, 'Comprobar la nota y registrar el resultado');
});
