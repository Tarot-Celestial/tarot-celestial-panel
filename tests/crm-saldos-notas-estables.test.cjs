const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const crm = read('src/components/crm/CRMClientesPanel.tsx');
const modal = read('src/components/crm/RegistrarLlamadaModal.tsx');
const sql = read('migrations/20261008_21_crm_saldos_notas_sin_bonos_manual.sql');

test('Realtime actualiza los saldos de la ficha sin volver a cargar las notas', () => {
  const body = crm.split('  async function refreshCrmBenefits(): Promise<boolean>')[1].split('  useRouletteSignal')[0];
  assert.match(body,/fetch\("\/api\/crm\/clientes\/ficha\?id=/);
  assert.match(body,/requestVersion !== fichaFetchVersion\.current/);
  assert.doesNotMatch(body,/loadNotasCliente\s*\(/);
  assert.doesNotMatch(body,/openCRMFicha\s*\(/);
});

test('Una respuesta vieja de notas no sobrescribe las nuevas ni contrae la lista', () => {
  const body = crm.split('  async function loadNotasCliente(clienteId: string)')[1].split('  async function createCRMNote()')[0];
  assert.match(body,/notesRequestSeq\.current/);
  assert.match(body,/request !== notesRequestSeq\.current/);
  assert.doesNotMatch(body,/setCrmNotesExpanded\(false\)/);
  assert.doesNotMatch(body.split('    try {')[1],/setCrmNotes\(\[\]\)/);
});

test('Registro confirmado aplica saldo de la transacción y relee sin reiniciar la ficha', () => {
  const body=crm.split('        onSuccess={async (message, confirmed) => {')[1].split('        }}')[0];
  assert.match(body,/refreshCrmBenefits\(\)/);
  assert.match(body,/confirmed\?\.balances/);
  assert.doesNotMatch(body,/openCRMFicha\(/);
});

test('Guardar cambios incluye siempre los minutos visibles', () => {
  const body=crm.split('  async function saveCRMFicha()')[1].split('  async function crearReservaCRM()')[0];
  assert.match(body,/minutos_free_pendientes:/);
  assert.match(body,/minutos_normales_pendientes:/);
  assert.doesNotMatch(body,/balanceEdited\.current \?/);
  assert.doesNotMatch(body,/await openCRMFicha\(/);
});

test('El cálculo de la compra manual no incluye bono Diamante invisible y la nota no contiene Bonos',()=>{
  assert.match(sql,/referencia_externa.*registrar_llamada:/);
  assert.match(sql,/final_note := replace\(final_note/);
  assert.match(sql,/id=c for update/);
  assert.match(sql,/previous_free is distinct from 84/);
  assert.match(sql,/adjusted_to_zero/);
  assert.match(modal,/Saldo previsto al guardar/);
  assert.doesNotMatch(modal,/Saldo previsto sin bonos/);
});
