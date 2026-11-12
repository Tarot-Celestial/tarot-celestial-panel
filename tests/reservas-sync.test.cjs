const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.resolve(__dirname, '../src/lib/reservas-sync.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const helpers = {};
vm.runInNewContext(code, { exports: helpers, Date, Math, URL, URLSearchParams });

const id = '00000000-0000-4000-8000-000000000051';
const first = { id, estado: 'pendiente', updated_at: '2026-11-09T20:00:00', fecha_reserva: '2026-11-12T14:00:00', nota: 'Inicial', deleted_at: null };

test('cada lectura usa una URL nueva sin perder marca o filtros', () => {
  const a = helpers.reservasFreshUrl('/api/crm/reservas/listar?brand=celestial&scope=alerts', 'primer-intento');
  const b = helpers.reservasFreshUrl('/api/crm/reservas/listar?brand=celestial&scope=alerts', 'segundo-intento');
  assert.notEqual(a, b);
  const parsed = new URL(a, 'https://example.com');
  assert.equal(parsed.pathname, '/api/crm/reservas/listar');
  assert.equal(parsed.searchParams.get('brand'), 'celestial');
  assert.equal(parsed.searchParams.get('scope'), 'alerts');
  assert.equal(parsed.searchParams.get('reserva_sync'), 'primer-intento');
});

test('eliminar solo se confirma si el servidor guardó tombstone y una lectura nueva ya no incluye la reserva', () => {
  const deleted = { ...first, estado: 'cancelada', deleted_at: '2026-11-09T21:00:00Z' };
  assert.equal(helpers.reservaMutationInSnapshot('eliminar', deleted, []), true);
  assert.equal(helpers.reservaMutationInSnapshot('eliminar', deleted, [first]), false);
  assert.equal(helpers.reservaMutationInSnapshot('eliminar', first, []), false);
});

test('confirmar, cumplir y cancelar requieren el estado persistente y la versión actual', () => {
  for (const [action, estado] of [['confirmar', 'confirmada'], ['completar', 'completada'], ['cancelar', 'cancelada']]) {
    const saved = { ...first, estado, updated_at: '2026-11-09T20:01:00' };
    assert.equal(helpers.reservaMutationInSnapshot(action, saved, [saved]), true, action);
    assert.equal(helpers.reservaMutationInSnapshot(action, saved, [first]), false, `${action} no puede aparentar éxito con el estado anterior`);
    assert.equal(helpers.reservaMutationInSnapshot(action, saved, [{ ...saved, updated_at: first.updated_at }]), false, `${action} debe detectar una lectura antigua`);
  }
});

test('aplazamientos y notas solo son exitosos si se reflejan los datos realmente guardados', () => {
  const aplazada = { ...first, fecha_reserva: '2026-11-14T16:00:00', updated_at: '2026-11-09T20:01:00' };
  assert.equal(helpers.reservaMutationInSnapshot('aplazar', aplazada, [aplazada]), true);
  assert.equal(helpers.reservaMutationInSnapshot('aplazar', aplazada, [{ ...aplazada, fecha_reserva: first.fecha_reserva }]), false);
  const conNota = { ...first, nota: 'Inicial\nConfirmación telefónica', updated_at: '2026-11-09T20:01:00' };
  assert.equal(helpers.reservaMutationInSnapshot('nota', conNota, [conNota]), true);
  assert.equal(helpers.reservaMutationInSnapshot('nota', conNota, [{ ...conNota, nota: 'Inicial' }]), false);
});
