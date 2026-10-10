const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/components/crm/CRMClientesPanel.tsx'), 'utf8');
const file = ts.createSourceFile('panel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let refresh, success;
function visit(n) {
  if (ts.isFunctionDeclaration(n) && n.name?.text === 'refreshCrmBenefits') refresh = n.getText(file);
  if (ts.isJsxSelfClosingElement(n) && n.tagName.getText(file) === 'RegistrarLlamadaModal') {
    const attr = n.attributes.properties.find(a => a.name?.getText(file) === 'onSuccess');
    success = attr.initializer.expression.getText(file);
  }
  ts.forEachChild(n, visit);
}
visit(file);
function harness({ dirty = false, free = '23', normal = '15', serverFree = 0, serverNormal = 13 } = {}) {
  const h = { free, normal, client: { id: 'a', minutos_free_pendientes: serverFree, minutos_normales_pendientes: serverNormal }, notes: [], payments: [], message: '', opened: true };
  const ctx = {
    console, fichaOpening: { current: false }, fichaFetchVersion: { current: 0 }, visibleClientRef: { current: 'a' },
    balanceEdited: { current: dirty }, liveCrmBalance: { current: { cliente: h.client, free, normal } },
    getTokenOrLogin: async () => 'test', fetch: async () => ({}),
    safeJson: async () => ({ ok: true, cliente: { ...h.client, minutos_free_pendientes: serverFree, minutos_normales_pendientes: serverNormal } }),
    crmClienteFicha: h.client, crmClienteSelId: 'a',
    setCrmEditMinFree: x => h.free = x, setCrmEditMinNormales: x => h.normal = x,
    setCrmClienteFicha: fn => h.client = fn(h.client), setCrmRegistrarOpen: x => h.opened = x,
    setCrmFichaMsg: x => h.message = x,
    loadNotasCliente: async id => h.notes.push(id), loadPagosCliente: async id => h.payments.push(id),
  };
  vm.createContext(ctx);
  vm.runInContext(ts.transpile(refresh, { target: ts.ScriptTarget.ES2020 }), ctx);
  h.refresh = ctx.refreshCrmBenefits;
  h.success = vm.runInContext(ts.transpile('(' + success + ')', { target: ts.ScriptTarget.ES2020 }), ctx);
  h.ctx = ctx;
  return h;
}
test('Refresh corrects stale visible 23/15 fields even when internal client already has 0/13', async () => {
  const h = harness(); assert.equal(await h.refresh(), true);
  assert.equal(h.free, '0'); assert.equal(h.normal, '13'); assert.deepEqual(h.notes, []);
});
test('Automatic refresh preserves explicit manual minute edits', async () => {
  const h = harness({ dirty: true }); await h.refresh(); assert.equal(h.free, '23'); assert.equal(h.normal, '15');
});
test('Confirmed call clears old draft and reads current balance rather than replayed receipt', async () => {
  const h = harness({ dirty: true }); await h.success('ok', { clienteId: 'a', balances: { free_after: 99, normal_after: 99 } });
  assert.equal(h.free, '0'); assert.equal(h.normal, '13'); assert.equal(h.ctx.balanceEdited.current, false);
  assert.deepEqual(h.notes, ['a']); assert.deepEqual(h.payments, ['a']); assert.equal(h.message, 'ok');
});
test('Late success for another client cannot overwrite the visible form', async () => {
  const h = harness(); await h.success('ok', { clienteId: 'b' }); assert.equal(h.free, '23'); assert.deepEqual(h.notes, []);
});
test('Outdated balance response cannot overwrite another client', async () => {
  const h = harness(); h.ctx.safeJson = async () => { h.ctx.visibleClientRef.current = 'b'; return { ok: true, cliente: { id: 'a', minutos_free_pendientes: 0, minutos_normales_pendientes: 13 } }; };
  assert.equal(await h.refresh(), false); assert.equal(h.free, '23'); assert.equal(h.normal, '15');
});
