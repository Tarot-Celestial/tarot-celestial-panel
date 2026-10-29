// Isolated client helper contract: no network, auth service or real purchase.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const attempt='00000000-0000-4000-8000-000000000001',ref='00000000-0000-4000-8000-000000000002';
function fixture(){
 const storage=new Map(),requests=[],timers=new Set();let current=true,refreshes=0;
 const session={user:{id:'fixture-user'},access_token:'fixture-token'},state={reply:async()=>Response.json({ok:true,url:`https://fixture.invalid/pago-tarjeta?ref=${ref}`}),refreshed:{...session,access_token:'fixture-refreshed'}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/client-purchase-checkout.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  exports,URL,Error,AbortController,crypto:{randomUUID:()=>attempt},window:{location:{origin:'https://fixture.invalid'}},
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>{if(state.storageError)throw Error('fixture storage blocked');storage.set(k,v);}},
  setTimeout:fn=>{timers.add(fn);return fn;},clearTimeout:fn=>timers.delete(fn),fetch:async(url,init)=>{requests.push({url,init,body:JSON.parse(init.body)});return state.reply(requests.length);},
 });
 const auth={refreshSession:async()=>{refreshes++;return {data:{session:state.refreshed}};}};
 return {storage,requests,state,timers,get refreshes(){return refreshes;},stop(){current=false;},run:()=>exports.prepareClientPurchase({auth,session,packId:'oracle_questions_3',isCurrent:()=>current})};
}
test('401 refresh retries the identical Oracle attempt with the refreshed bearer',async()=>{
 const f=fixture();f.state.reply=async n=>n===1?Response.json({ok:false},{status:401}):Response.json({ok:true,url:`/pago-tarjeta?ref=${ref}`});
 assert.equal(await f.run(),`/pago-tarjeta?ref=${ref}`);assert.equal(f.refreshes,1);assert.deepEqual(f.requests.map(x=>x.body),[{packId:'oracle_questions_3',attemptId:attempt},{packId:'oracle_questions_3',attemptId:attempt}]);
 assert.equal(f.requests[1].init.headers.Authorization,'Bearer fixture-refreshed');assert.equal(f.timers.size,0);
});
test('a refresh changing owner never sends a purchase as the replacement user',async()=>{
 const f=fixture();f.state.reply=async()=>Response.json({ok:false},{status:401});f.state.refreshed={user:{id:'other-user'},access_token:'other-token'};
 await assert.rejects(f.run(),/sesión ha caducado/);assert.equal(f.requests.length,1);assert.equal(JSON.parse([...f.storage.values()][0]).attemptId,attempt);
});
test('network loss retains the same persisted attempt for an eventual retry',async()=>{
 const f=fixture();f.state.reply=async()=>{throw Error('fixture connection lost');};await assert.rejects(f.run(),/connection lost/);await assert.rejects(f.run(),/connection lost/);
 assert.equal(f.requests.length,2);assert.equal(f.requests[0].body.attemptId,f.requests[1].body.attemptId);assert.equal(JSON.parse([...f.storage.values()][0]).url,undefined);
});
test('untrusted redirects and pending links cannot send the customer outside the card page',async()=>{
 for(const url of ['https://other.invalid/pago-tarjeta?ref='+ref,'/cliente?ref='+ref,'/pago-tarjeta?ref=bad','javascript:alert(1)']){
  const f=fixture();f.state.reply=async()=>Response.json({ok:true,url});await assert.rejects(f.run(),/verificar el enlace/);
  f.state.reply=async()=>Response.json({ok:false,url,error:'fixture pending'},{status:409});await assert.rejects(f.run(),e=>e.pendingUrl===null);
 }
});
test('account change ignores a late successful response and does not store its link',async()=>{
 const f=fixture();f.state.reply=async()=>{f.stop();return Response.json({ok:true,url:`/pago-tarjeta?ref=${ref}`});};assert.equal(await f.run(),null);assert.equal(JSON.parse([...f.storage.values()][0]).url,undefined);
});
test('blocked storage prevents sending an unrepeatable purchase',async()=>{
 const f=fixture();f.state.storageError=true;await assert.rejects(f.run(),/almacenamiento/);assert.equal(f.requests.length,0);
});
