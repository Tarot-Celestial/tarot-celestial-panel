const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript'),vm=require('vm');
const source=fs.readFileSync(require('path').join(__dirname,'../src/components/crm/CRMClientesPanel.tsx'),'utf8');
const file=ts.createSourceFile('panel.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let callback;
function visit(n){if(ts.isJsxSelfClosingElement(n)&&n.tagName.getText(file)==='RegistrarLlamadaModal'){const a=n.attributes.properties.find(x=>x.name?.getText(file)==='onSuccess');callback=a.initializer.expression.getText(file);}ts.forEachChild(n,visit);}visit(file);
function harness(){const h={free:'0',normal:'0',client:{id:'a',minutos_free_pendientes:0,minutos_normales_pendientes:0},opened:[],notes:[],visibleClientRef:{current:'a'},fichaFetchVersion:{current:1},fichaOpening:{current:false},balanceEdited:{current:false},balanceConflict:{current:false},liveCrmBalance:{current:{cliente:{id:'a'},free:'0',normal:'0'}}};
 const c={...h,crmClienteFicha:h.client,crmClienteSelId:'a',setCrmRegistrarOpen:()=>{},setCrmFichaLoading:()=>{},setCrmEditMinFree:x=>h.free=x,setCrmEditMinNormales:x=>h.normal=x,setCrmSendMinFree:x=>h.sendFree=x,setCrmSendMinNormales:x=>h.sendNormal=x,setCrmClienteFicha:f=>h.client=f(h.client),loadPagosCliente:async()=>{},loadNotasCliente:async id=>h.notes.push(id),openCRMFicha:async id=>h.opened.push(id),setCrmFichaMsg:()=>{}};
 h.run=vm.runInNewContext(ts.transpile('('+callback+')',{target:ts.ScriptTarget.ES2020}),c);return h;}
test('Committed balances update both fields, sidebar and send values; older requests invalidated',async()=>{const h=harness();await h.run('ok',{clienteId:'a',balances:{free_after:15,normal_after:20}});assert.equal(h.free,'15');assert.equal(h.normal,'20');assert.equal(h.client.minutos_free_pendientes,15);assert.equal(h.sendNormal,'20');assert.equal(h.fichaFetchVersion.current,2);assert.deepEqual(h.opened,[]);assert.deepEqual(h.notes,['a']);});
test('A call updates a depleted balance to zero, not the earlier purchase receipt',async()=>{const h=harness();await h.run('ok',{clienteId:'a',balances:{free_after:0,normal_after:20}});assert.equal(h.free,'0');assert.equal(h.normal,'20');});
test('Missing or replayed receipt forces a fresh read',async()=>{const h=harness();await h.run('ok',{clienteId:'a',balances:null});assert.deepEqual(h.opened,['a']);});
test('Late success for another client cannot overwrite the visible form',async()=>{const h=harness();await h.run('ok',{clienteId:'b',balances:{free_after:15,normal_after:20}});assert.equal(h.free,'0');assert.deepEqual(h.notes,[]);});

function refreshHarness(dirty){
 const match=source.match(/  async function refreshCrmBenefits\(\) \{[\s\S]*?\n  \}/)[0];
 const h={free:'0',normal:'0',balanceConflict:{current:false}};
 const ctx={fichaOpening:{current:false},fichaFetchVersion:{current:0},crmClienteFicha:{id:'a'},visibleClientRef:{current:'a'},getTokenOrLogin:async()=>'test',fetch:async()=>({}),safeJson:async()=>({ok:true,cliente:{id:'a',minutos_free_pendientes:15,minutos_normales_pendientes:20}}),liveCrmBalance:{current:{cliente:{id:'a',minutos_free_pendientes:15,minutos_normales_pendientes:20},free:'0',normal:'0'}},balanceEdited:{current:dirty},balanceConflict:h.balanceConflict,setCrmFichaMsg:()=>{},setCrmEditMinFree:x=>h.free=x,setCrmEditMinNormales:x=>h.normal=x,setCrmClienteFicha:()=>{},loadNotasCliente:async()=>{}};
 h.run=vm.runInNewContext(ts.transpile('('+match.trim().replace('async function refreshCrmBenefits','async function')+')',{target:ts.ScriptTarget.ES2020}),ctx);return h;
}
test('Refresh repairs zero inputs even when the model already has 15/20',async()=>{const h=refreshHarness(false);await h.run();assert.equal(h.free,'15');assert.equal(h.normal,'20');assert.equal(h.balanceConflict.current,false);});
test('Refresh preserves actual manual edits',async()=>{const h=refreshHarness(true);await h.run();assert.equal(h.free,'0');assert.equal(h.normal,'0');});
