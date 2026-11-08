// Simulated reservations only. Exercise the real route against concurrent changes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const reservationId = '00000000-0000-4000-8000-000000000041';
const workerId = '00000000-0000-4000-8000-000000000042';
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/app/api/central/first-tarotist-reservations/route.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness({ afterRead, role = 'central', auth = true } = {}) {
  const h = {
    row: { id: reservationId, brand: 'celestial', status: 'pendiente', free_consult_used: false,
      scheduled_at: '2026-11-08T10:00:00Z', updated_at: '2026-11-08T09:00:00Z', notes: 'Nota original', postponed_count: 0 },
    updates: 0,
    reads: 0,
  };
  const db = {
    from(table) {
      assert.equal(table, 'first_tarotist_reservations');
      const filters = [];
      let updates;
      return {
        select() { return this; },
        eq(field, value) { filters.push([field, value]); return this; },
        update(value) { updates = value; return this; },
        async maybeSingle() {
          if (!filters.every(([key, value]) => h.row[key] === value)) return { data: null, error: null };
          if (updates) {
            h.updates++;
            h.row = { ...h.row, ...updates };
            return { data: structuredClone(h.row), error: null };
          }
          h.reads++;
          const snapshot = structuredClone(h.row);
          if (afterRead) afterRead(h);
          return { data: snapshot, error: null };
        },
      };
    },
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports, URL, Date, console: { error() {} },
    require(name) {
      if (name === 'next/server') return { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } };
      if (name === '@/lib/server/auth-worker') return { getAdminClient: () => db, workerFromRequest: async () => auth ? { id: workerId, role } : null };
      throw new Error(`Unexpected module: ${name}`);
    },
  });
  h.post = async (action, extra = {}) => {
    const response = await exports.POST(new Request('https://fixture.test/api/central/first-tarotist-reservations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id: reservationId, brand: 'celestial', ...extra }),
    }));
    return { status: response.status, body: await response.json() };
  };
  return h;
}

for (const action of ['confirm', 'postpone', 'cancel', 'no_show', 'complete']) {
  test(`${action} cannot overwrite a consultation completed while its request was in flight`, async () => {
    const h = harness({ afterRead: state => {
      state.row = { ...state.row, status: 'cumplida', free_consult_used: true,
        completed_at: '2026-11-08T10:02:00Z', updated_at: '2026-11-08T10:02:00Z', notes: 'Consulta registrada automáticamente' };
    } });
    const result = await h.post(action, { new_scheduled_at: '2026-11-09T11:00:00Z', note: 'Acción antigua' });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'RESERVATION_CHANGED');
    assert.equal(h.updates, 0);
    assert.equal(h.row.status, 'cumplida');
    assert.equal(h.row.free_consult_used, true);
    assert.equal(h.row.notes, 'Consulta registrada automáticamente');
  });
}

test('a concurrent postponement is preserved instead of silently lost', async () => {
  const h = harness({ afterRead: state => { state.row.updated_at = '2026-11-08T10:03:00Z'; state.row.notes = 'Nota de otra central'; } });
  const result = await h.post('cancel', { note: 'Cancelación desde vista antigua' });
  assert.equal(result.status, 409);
  assert.equal(h.updates, 0);
  assert.equal(h.row.notes, 'Nota de otra central');
});

for (const role of ['central', 'admin']) {
  test(`${role} can complete an unchanged reservation exactly once`, async () => {
    const h = harness({ role });
    const first = await h.post('complete', { note: 'Consulta realizada' });
    assert.equal(first.status, 200);
    assert.equal(h.row.status, 'cumplida');
    assert.equal(h.row.free_consult_used, true);
    assert.equal(h.row.updated_by_worker_id, workerId);
    assert.ok(h.row.completed_at);
    const repeated = await h.post('complete');
    assert.equal(repeated.status, 409);
    assert.equal(repeated.body.code, 'FIRST_CONSULT_ALREADY_USED');
    assert.equal(h.updates, 1);
  });
}

test('manual reservation actions remain unavailable to tarotistas or anonymous callers', async () => {
  for (const options of [{ role: 'tarotista' }, { auth: false }]) {
    const h = harness(options);
    const result = await h.post('complete');
    assert.equal(result.status, options.auth === false ? 401 : 403);
    assert.equal(h.reads, 0);
    assert.equal(h.updates, 0);
  }
});
