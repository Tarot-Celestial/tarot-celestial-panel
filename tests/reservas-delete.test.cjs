const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, overrides = {}) {
  const filename = path.resolve(__dirname, '..', relative), exports = {};
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, Date, Request, Response, console: { error() {} }, require(name) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`, overrides);
    if (name.startsWith('.')) return load(path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(filename), `${name}.ts`)), overrides);
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  return exports;
}

const helpers = load('src/lib/reservas.ts');
const id = '00000000-0000-4000-8000-000000000051';
const workerId = '00000000-0000-4000-8000-000000000008';
const version = '2026-10-16T12:00:00.000Z';
const now = new Date('2026-10-16T14:00:00.000Z');
const initial = (extra = {}) => ({ id, cliente_id: '00000000-0000-4000-8000-000000000151', cliente_nombre: 'Clienta de prueba', tarotista_id: '00000000-0000-4000-8000-000000000091', fecha_reserva: '2026-10-17T12:00:00.000Z', estado: 'pendiente', nota: 'Nota original que debe conservarse.', updated_at: version, deleted_at: null, deleted_by_worker_id: null, notify_when_tarotista_idle: true, ...extra });
const deletion = (extra = {}) => ({ id, version, action: 'eliminar', confirmed: true, ...extra });
const request = body => new Request('http://localhost/api/crm/reservas/actualizar', { method: 'POST', headers: { Authorization: 'Bearer synthetic-test-token', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function fixture(options = {}) {
  let row = options.row === null ? null : initial(options.row);
  let reads = 0, writes = 0, calls = 0;
  const patches = [], filters = [];
  const db = { from(table) {
    calls++; assert.equal(table, 'reservas');
    const conditions = []; let patch;
    const query = {
      select() { return this; },
      eq(field, value) { conditions.push([field, value]); return this; },
      is(field, value) { conditions.push([field, value]); return this; },
      update(value) { patch = value; return this; },
      delete() { throw new Error('Physical deletion is forbidden in this test.'); },
      async maybeSingle() {
        if (!patch) { reads++; if (options.readError) return { data: null, error: options.readError }; return { data: row ? { ...row } : null, error: null }; }
        filters.push(conditions);
        if (options.beforeUpdate) row = options.beforeUpdate(row);
        if (options.writeError) return { data: null, error: options.writeError };
        if (!row || !conditions.every(([field, value]) => row[field] === value)) return { data: null, error: null };
        row = { ...row, ...patch }; writes++; patches.push({ ...patch });
        return { data: { ...row }, error: null };
      },
    };
    return query;
  } };
  const server = load('src/lib/server/reservas-update.ts', {
    './reservas-staff': { reservasStaff: async () => options.denied ? { response: Response.json({ error: 'Denied by test gate' }, { status: options.denied }) } : { db, worker: { id: workerId, display_name: 'Central de prueba' } } },
  });
  return { server, patches, filters, get row() { return row; }, get reads() { return reads; }, get writes() { return writes; }, get calls() { return calls; } };
}

test('deletion requires explicit boolean confirmation and does not mutate its input', () => {
  for (const confirmed of [undefined, false, null, 'true', 1]) {
    const row = initial(), before = JSON.stringify(row);
    assert.throws(() => helpers.reservaChange(row, deletion({ confirmed }), 'Central de prueba', now), /confirma/i);
    assert.equal(JSON.stringify(row), before);
  }
});

test('soft deletion preserves identifying data and original notes for active and closed reservations', () => {
  for (const estado of ['pendiente', 'confirmada', 'completada', 'finalizada', 'cancelada']) {
    const row = initial({ estado }), before = JSON.stringify(row);
    const patch = helpers.reservaChange(row, deletion({ motivo: '  Duplicada  ' }), 'Central de prueba', now);
    const result = { ...row, ...patch };
    assert.equal(result.deleted_at, now.toISOString());
    assert.equal(result.updated_at, now.toISOString());
    assert.equal(result.estado, 'cancelada');
    assert.equal(result.notify_when_tarotista_idle, false);
    for (const field of ['id', 'cliente_id', 'cliente_nombre', 'tarotista_id', 'fecha_reserva']) assert.equal(result[field], row[field]);
    assert.ok(result.nota.startsWith(row.nota));
    assert.match(result.nota, /Central de prueba/);
    assert.match(result.nota, /eliminad/i);
    assert.ok(result.nota.includes(estado));
    assert.match(result.nota, /Duplicada/);
    assert.equal(JSON.stringify(row), before);
  }
});

test('oversized reasons are rejected and existing completion/rescheduling behavior remains available', () => {
  assert.throws(() => helpers.reservaChange(initial(), deletion({ motivo: 'x'.repeat(501) }), 'Central', now), /500/);
  assert.equal(helpers.reservaChange(initial(), { action: 'completar' }, 'Central', now).estado, 'completada');
  const postponed = helpers.reservaChange(initial(), { action: 'aplazar', motivo: 'Nuevo horario', fecha_reserva: '2026-10-18T12:00:00Z' }, 'Central', now);
  assert.equal(postponed.fecha_reserva, '2026-10-18T12:00:00.000Z');
  assert.equal(postponed.estado, 'pendiente');
});

test('unauthenticated and unauthorized callers never access the reservation table', async () => {
  for (const denied of [401, 403]) {
    const f = fixture({ denied });
    assert.equal((await f.server.updateReserva(request(deletion()))).status, denied);
    assert.equal(f.calls, 0);
    assert.equal(f.writes, 0);
  }
});

test('API deletion rejects absent or non-boolean confirmation without saving', async () => {
  for (const confirmed of [undefined, false, 'true']) {
    const f = fixture();
    assert.equal((await f.server.updateReserva(request(deletion({ confirmed })))).status, 400);
    assert.equal(f.writes, 0);
    assert.equal(f.row.deleted_at, null);
  }
});

test('API deletion requires a version and rejects a stale version including null mismatches', async () => {
  const incomplete = fixture();
  assert.equal((await incomplete.server.updateReserva(request({ id, action: 'eliminar', confirmed: true }))).status, 400);
  assert.equal(incomplete.calls, 0);
  for (const body of [deletion({ version: '2026-10-16T11:00:00.000Z' }), deletion({ version: null })]) {
    const f = fixture();
    assert.equal((await f.server.updateReserva(request(body))).status, 409);
    assert.equal(f.writes, 0);
  }
  const legacy = fixture({ row: { updated_at: null } });
  assert.equal((await legacy.server.updateReserva(request(deletion({ version: null })))).status, 200);
  assert.equal(legacy.writes, 1);
});

test('authorized removal preserves the row and attributes one audit note to the actual worker', async () => {
  const f = fixture();
  const response = await f.server.updateReserva(request(deletion({ motivo: 'Duplicada' })));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.reserva.id, id);
  assert.ok(result.reserva.deleted_at);
  assert.equal(result.reserva.deleted_by_worker_id, workerId);
  assert.equal(result.reserva.cliente_id, initial().cliente_id);
  assert.equal(result.reserva.fecha_reserva, initial().fecha_reserva);
  assert.equal(f.writes, 1);
  assert.equal(result.reserva.nota.split('\n').length, 2);
  assert.ok(f.filters[0].some(([field, value]) => field === 'updated_at' && value === version));
});

test('repeating a confirmed deletion with the original version is idempotent', async () => {
  const f = fixture();
  const first = await f.server.updateReserva(request(deletion()));
  assert.equal(first.status, 200);
  const saved = JSON.stringify(f.row);
  const second = await f.server.updateReserva(request(deletion()));
  assert.equal(second.status, 200);
  assert.equal((await second.json()).ok, true);
  assert.equal(f.writes, 1);
  assert.equal(JSON.stringify(f.row), saved);
  const missingVersion = await f.server.updateReserva(request({ id, action: 'eliminar', confirmed: true }));
  assert.equal(missingVersion.status, 400);
  assert.equal(f.writes, 1);
});

test('removed reservations cannot be completed, cancelled or rescheduled', async () => {
  for (const action of ['completar', 'cancelar', 'aplazar']) {
    const f = fixture({ row: { deleted_at: now.toISOString(), deleted_by_worker_id: workerId, estado: 'cancelada' } });
    const response = await f.server.updateReserva(request({ id, version, action, motivo: 'No debe cambiar', fecha_reserva: '2026-10-18T12:00:00Z' }));
    assert.ok([400, 409].includes(response.status), `Rejected ${action}: ${response.status}`);
    assert.equal(f.writes, 0);
  }
});

test('concurrent edits fail the compare-and-swap without losing the other update', async () => {
  const f = fixture({ beforeUpdate: row => ({ ...row, updated_at: '2026-10-16T13:00:00.000Z', nota: 'Cambio de otra central' }) });
  assert.equal((await f.server.updateReserva(request(deletion()))).status, 409);
  assert.equal(f.writes, 0);
  assert.equal(f.row.deleted_at, null);
  assert.equal(f.row.nota, 'Cambio de otra central');
});

test('invalid or missing reservations cannot produce a write', async () => {
  const invalid = fixture();
  assert.equal((await invalid.server.updateReserva(request(deletion({ id: 'invalid' })))).status, 400);
  assert.equal(invalid.calls, 0);
  const missing = fixture({ row: null });
  assert.equal((await missing.server.updateReserva(request(deletion()))).status, 404);
  assert.equal(missing.writes, 0);
});

test('database read and write failures return 500 without exposing internals or mutating rows', async () => {
  for (const failure of ['readError', 'writeError']) {
    const f = fixture({ [failure]: { message: 'PRIVATE_DATABASE_DIAGNOSTIC', code: 'XX000' } });
    const response = await f.server.updateReserva(request(deletion()));
    assert.equal(response.status, 500);
    assert.ok(!(await response.text()).includes('PRIVATE_DATABASE_DIAGNOSTIC'));
    assert.equal(f.writes, 0);
    assert.equal(f.row.deleted_at, null);
  }
});
