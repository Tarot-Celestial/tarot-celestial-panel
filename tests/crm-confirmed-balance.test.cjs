const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/components/crm/CRMClientesPanel.tsx'), 'utf8');
const file = ts.createSourceFile('panel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let refresh, success, save, open;
function visit(n) {
  if (ts.isFunctionDeclaration(n) && n.name?.text === 'openCRMFicha') open = n.getText(file);
  if (ts.isFunctionDeclaration(n) && n.name?.text === 'saveCRMFicha') save = n.getText(file);
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
    console, fichaSaving: { current: false }, fichaOpening: { current: false }, fichaOpenVersion: { current: 0 }, fichaFetchVersion: { current: 0 }, visibleClientRef: { current: 'a' },
    balanceEdited: { current: dirty }, liveCrmBalance: { current: { cliente: h.client, free, normal } },
    getTokenOrLogin: async () => 'test', fetch: async () => ({}),
    safeJson: async () => ({ ok: true, cliente: { ...h.client, minutos_free_pendientes: serverFree, minutos_normales_pendientes: serverNormal } }),
    crmClienteFicha: h.client, crmClienteSelId: 'a',
    crmEditMinFree: free, crmEditMinNormales: normal, crmEditNombre: 'Cliente', crmEditApellido: '', crmEditTelefono: '', crmEditPais: '', crmEditEmail: '', crmEditNotas: '', crmEditOrigen: '', crmEditDeuda: '0',
    setCrmSaveLoading: () => {}, saveEtiquetasCliente: async () => {}, searchCRM: () => {},
    setCrmEditMinFree: x => h.free = x, setCrmEditMinNormales: x => h.normal = x,
    setCrmClienteFicha: fn => h.client = typeof fn === 'function' ? fn(h.client) : fn, setCrmRegistrarOpen: x => h.opened = x,
    setCrmFichaMsg: x => h.message = x,
    loadNotasCliente: async id => h.notes.push(id), loadPagosCliente: async id => h.payments.push(id),
  };
  vm.createContext(ctx);
  vm.runInContext(ts.transpile(refresh, { target: ts.ScriptTarget.ES2020 }), ctx);
  h.refresh = ctx.refreshCrmBenefits; ctx.refreshBenefitsRef = { current: h.refresh };
  h.success = vm.runInContext(ts.transpile('(' + success + ')', { target: ts.ScriptTarget.ES2020 }), ctx);
  h.save = vm.runInContext(ts.transpile('(' + save + ')', { target: ts.ScriptTarget.ES2020 }), ctx);
  for (const name of open.match(/\bset[A-Z]\w+/g) || []) if (!ctx[name]) ctx[name] = () => {};
  ctx.notesRequestSeq = {current:0};
  ctx.loadEtiquetasCliente = async () => {};
  h.open = vm.runInContext(ts.transpile('(' + open + ')', {target:ts.ScriptTarget.ES2020}), ctx);
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

test('Confirmed call immediately updates both fields even if the follow-up read fails', async () => {
  const h=harness({dirty:true}); h.ctx.safeJson=async()=>({ok:false});
  await h.success('ok',{clienteId:'a',balances:{free_after:0,normal_after:13}});
  assert.equal(h.free,'0'); assert.equal(h.normal,'13'); assert.equal(h.client.minutos_normales_pendientes,13);
});
test('Save always sends the visible minutes, even without a dirty flag, captured before authentication', async () => {
  const h=harness(); let body;
  h.ctx.getTokenOrLogin=async()=>{h.ctx.crmEditMinFree='99';h.ctx.crmEditMinNormales='99';return 'token';};
  h.ctx.fetch=async(url,options)=>{body=JSON.parse(options.body);return {};};
  h.ctx.safeJson=async()=>({_ok:true,ok:true,cliente:{id:'a',minutos_free_pendientes:23,minutos_normales_pendientes:15}});
  await h.save();assert.equal(body.minutos_free_pendientes,23);assert.equal(body.minutos_normales_pendientes,15);
  assert.equal(h.ctx.fichaSaving.current,false);assert.equal(h.ctx.fichaFetchVersion.current,1);
});
test('Background refresh is paused during save',async()=>{
 const h=harness();h.ctx.fichaSaving.current=true;assert.equal(await h.refresh(),false);assert.equal(h.free,'23');
});

test('Another operator consuming 10 FREE replaces the old draft 98 with confirmed 88',async()=>{
 const h=harness({dirty:true,free:'98',normal:'66',serverFree:88,serverNormal:66});
 h.ctx.liveCrmBalance.current.cliente={id:'a',minutos_free_pendientes:98,minutos_normales_pendientes:66};
 await h.refresh();assert.equal(h.free,'88');assert.equal(h.normal,'66');assert.equal(h.ctx.balanceEdited.current,false);
});
test('Saving while notes are loading cannot permanently disable balance refresh',async()=>{
 const h=harness();let release;
 h.ctx.safeJson=async()=>({_ok:true,ok:true,cliente:{id:'a',minutos_free_pendientes:23,minutos_normales_pendientes:15}});
 h.ctx.loadNotasCliente=()=>new Promise(r=>release=r);
 const opening=h.open('a');while(!release)await new Promise(r=>setImmediate(r));
 await h.save();release();await opening;
 assert.equal(h.ctx.fichaOpening.current,false);
 h.ctx.safeJson=async()=>({_ok:true,ok:true,cliente:{id:'a',minutos_free_pendientes:0,minutos_normales_pendientes:13}});
 assert.equal(await h.refresh(),true);assert.equal(h.free,'0');assert.equal(h.normal,'13');
});


test('An older opening cannot release the loading guard of a newer opening',async()=>{
 const h=harness(),releases=[];
 h.ctx.safeJson=async()=>({_ok:true,ok:true,cliente:{id:'a',minutos_free_pendientes:0,minutos_normales_pendientes:13}});
 h.ctx.loadNotasCliente=()=>new Promise(r=>releases.push(r));
 const first=h.open('a');while(releases.length<1)await new Promise(r=>setImmediate(r));
 const second=h.open('a');while(releases.length<2)await new Promise(r=>setImmediate(r));
 releases[0]();await first;assert.equal(h.ctx.fichaOpening.current,true);
 releases[1]();await second;assert.equal(h.ctx.fichaOpening.current,false);
});
