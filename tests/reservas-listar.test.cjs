const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadRoute(db) {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/app/api/crm/reservas/listar/route.ts'), 'utf8');
  const transpiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(transpiled, { exports, Date, URL, Response, console: { error() {} }, require(name) {
    if (name === '@/lib/server/reservas-staff') return { reservasStaff: async () => ({ db, worker: { id: 'central-test' } }) };
    if (name === '@/lib/server/brand-filter') return { brandFromRequest: () => 'celestial', filterRowsByBrand: async (_db, rows) => rows };
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  return exports;
}

test('listar devuelve solo reservas activas y recorre todas las páginas sin repetir u omitir IDs', async () => {
  const rows = Array.from({ length: 720 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    estado: i % 2 ? 'pendiente' : 'completada',
    fecha_reserva: '2026-11-12T10:00:00',
    deleted_at: i < 92 ? '2026-11-09T20:00:00Z' : null,
  }));
  const pages = [];
  const db = { from(table) {
    assert.equal(table, 'reservas');
    let deletedOnly = false, afterId = '';
    return {
      select() { return this; },
      is(field, value) { if (field === 'deleted_at') { assert.equal(value, null); deletedOnly = true; } return this; },
      gt(field, value) { assert.equal(field, 'id'); afterId = value; return this; },
      order(field) { assert.equal(field, 'id'); return this; },
      limit(max) {
        assert.equal(max, 500);
        const selected = rows.filter(r => (!deletedOnly || !r.deleted_at) && r.id > afterId).slice(0, max);
        pages.push({ afterId, count: selected.length });
        // Otro operador modifica la fecha durante la paginación: ningún registro
        // debe cambiar de página por ello.
        if (pages.length === 1) rows[650].fecha_reserva = '2027-01-31T12:00:00';
        return Promise.resolve({ data: selected, error: null });
      },
    };
  } };
  const route = loadRoute(db);
  const response = await route.GET(new Request('https://example.com/api/crm/reservas/listar?brand=celestial'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.reservas.length, 628);
  assert.equal(new Set(body.reservas.map(row => row.id)).size, 628);
  assert.ok(body.reservas.every(row => !row.deleted_at));
  assert.equal(pages.length, 2);
  assert.equal(pages[0].count, 500);
  assert.equal(pages[1].count, 128);
  assert.equal(pages[1].afterId, body.reservas[499].id);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
});
