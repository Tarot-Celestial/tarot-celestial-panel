const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../src/app/cliente/dashboard/page.tsx'),'utf8');
const stamp=n=>`2026-11-05T21:${n}:00Z`;
const wallet=(coins,time)=>({coins,minutes_free:20,minutes_normal:0,effective_rank:'diamante',refreshed_at:time});
const response=body=>({ok:true,json:async()=>body});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function fixture(initial={id:'client',puntos:2820,minutos_free_pendientes:0,minutos_normales_pendientes:0,onboarding_completado:true}){
 const state={cliente:initial,oracle:0,spins:0};
 const scope={useCallback:fn=>fn,walletAppliedAtRef:{current:0},latestWalletRef:{current:null},dataRevisionRef:{current:0},
  setCliente:fn=>{state.cliente=fn(state.cliente);},setOracleCredits:n=>state.oracle=n,setRouletteSpins:n=>state.spins=n,
  sb:{auth:{getSession:async()=>({data:{session:{access_token:'fixture'}}})}},fetch:async()=>response({ok:true,state:wallet(420,stamp('57'))}),AbortSignal,Date};
 vm.createContext(scope);
 const snippet=source.slice(source.indexOf('  const applyWalletSnapshot ='),source.indexOf('  const loadData ='));
 vm.runInContext(ts.transpileModule(snippet+'\nglobalThis.apply=applyWalletSnapshot;globalThis.load=loadWalletState;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope);
 return{state,scope};
}
test('a delayed /me cannot restore 2820 or 1620 Coins after /state confirmed 420',()=>{
 const f=fixture();f.scope.apply(wallet(420,stamp('57')));
 for(const [coins,time] of [[2820,stamp('00')],[1620,stamp('13')]]){
  const applied=f.scope.apply(wallet(coins,time),{id:'client',nombre:'Nombre actualizado',puntos:coins,minutos_free_pendientes:10,onboarding_completado:false});
  assert.equal(applied,false);assert.equal(f.state.cliente.puntos,420);assert.equal(f.state.cliente.minutos_totales,20);
  assert.equal(f.state.cliente.nombre,'Nombre actualizado');assert.equal(f.state.cliente.onboarding_completado,true);
 }
});
test('a wallet response arriving before the profile is retained when the older profile finishes',()=>{
 const f=fixture(null);f.scope.apply(wallet(420,stamp('57')));assert.equal(f.state.cliente,null);
 f.scope.apply(wallet(1620,stamp('13')),{id:'client',puntos:1620});assert.equal(f.state.cliente.puntos,420);
 assert.equal(f.state.cliente.minutos_totales,20);
});
test('/state in flight before a confirmed redemption cannot overwrite its receipt',async()=>{
 const f=fixture(),pending=deferred();f.scope.fetch=()=>pending.promise;
 f.scope.apply(wallet(1620,stamp('13')));const loading=f.scope.load();
 await new Promise(r=>setImmediate(r));
 // The confirmed redemption invalidates both /me and /state requests in flight.
 f.scope.dataRevisionRef.current+=1;f.state.cliente={...f.state.cliente,puntos:420};
 pending.resolve(response({ok:true,state:wallet(1620,stamp('58'))}));await loading;
 assert.equal(f.state.cliente.puntos,420);
 f.scope.fetch=async()=>response({ok:true,state:wallet(420,stamp('59'))});await f.scope.load();assert.equal(f.state.cliente.puntos,420);
});
test('later confirmed balances may decrease or increase; no client-side maximum freezes spending',()=>{
 const f=fixture();f.scope.apply(wallet(2820,stamp('00')));f.scope.apply(wallet(1620,stamp('13')));assert.equal(f.state.cliente.puntos,1620);
 f.scope.apply(wallet(420,stamp('57')));assert.equal(f.state.cliente.puntos,420);
 f.scope.apply(wallet(1420,stamp('59')));assert.equal(f.state.cliente.puntos,1420);
});

