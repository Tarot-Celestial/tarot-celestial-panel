// Exercise the actual component request helper with a stalled SDK; no network or accounts.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const session={data:{session:{access_token:'fixture-token'}}};
function trackedController() {
 const controller=new AbortController(),listeners=new Set();
 const add=controller.signal.addEventListener.bind(controller.signal),remove=controller.signal.removeEventListener.bind(controller.signal);
 controller.signal.addEventListener=(name,listener,options)=>{if(name==='abort')listeners.add(listener);add(name,listener,options);};
 controller.signal.removeEventListener=(name,listener,options)=>{if(name==='abort')listeners.delete(listener);remove(name,listener,options);};
 return {controller,listeners};
}
function harness(readSession) {
 const h={sessionCalls:0,fetches:[]},exports={};
 const source=fs.readFileSync(path.join(__dirname,'../src/components/admin/AdminWhatsAppCampaignsPanel.tsx'),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const mocks={'react':{},'react/jsx-runtime':{},'lucide-react':{},'@/lib/supabase-browser':{supabaseBrowser:()=>({auth:{getSession:()=>{h.sessionCalls++;return readSession();}}})},'@/lib/whatsapp-campaign-drafts':{},'./AdminWhatsAppCampaignsPanel.module.css':{}};
 vm.runInNewContext(code+'\nexports.testRequest = request;',{exports,require:name=>{if(name in mocks)return mocks[name];throw Error('Unexpected import '+name);},DOMException,FormData,fetch:async(...args)=>{h.fetches.push(args);return {ok:true,json:async()=>({ok:true,draft:{version:0}})};}});
 h.request=exports.testRequest;return h;
}

test('A deadline releases a request stuck in getSession and a late valid session never starts fetch',async()=>{
 const pending=deferred(),h=harness(()=>pending.promise),{controller,listeners}=trackedController();
 let released=false;
 const request=h.request(undefined,controller.signal).finally(()=>{released=true;});
 assert.equal(h.sessionCalls,1);assert.equal(listeners.size,1);assert.equal(h.fetches.length,0);
 controller.abort();await assert.rejects(request,error=>error.name==='AbortError');
 assert.equal(released,true);assert.equal(listeners.size,0);
 pending.resolve(session);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.fetches.length,0);assert.equal(listeners.size,0);
});
test('Late SDK rejection after cancellation is consumed, with no orphan abort listener or send',async()=>{
 const pending=deferred(),h=harness(()=>pending.promise),{controller,listeners}=trackedController();
 const request=h.request({action:'save'},controller.signal);controller.abort();
 await assert.rejects(request,error=>error.name==='AbortError');pending.reject(new Error('Late refresh failure'));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(h.fetches.length,0);assert.equal(listeners.size,0);
});
test('Already aborted requests never access the SDK or fetch',async()=>{
 const h=harness(()=>Promise.resolve(session)),{controller,listeners}=trackedController();controller.abort();
 await assert.rejects(h.request(undefined,controller.signal),error=>error.name==='AbortError');
 assert.equal(h.sessionCalls,0);assert.equal(h.fetches.length,0);assert.equal(listeners.size,0);
});
test('Abort between session settlement and its await continuation still prevents fetch',async()=>{
 const pending=deferred(),h=harness(()=>pending.promise),{controller,listeners}=trackedController();
 const request=h.request(undefined,controller.signal);
 // The helper's first .then settles its wait; this .then aborts before await resumes.
 pending.promise.then(()=>controller.abort());pending.resolve(session);
 await assert.rejects(request,error=>error.name==='AbortError');assert.equal(h.fetches.length,0);assert.equal(listeners.size,0);
});
test('Normal session resolution keeps bearer/body/signal semantics and removes the temporary listener',async()=>{
 const h=harness(()=>Promise.resolve(session)),{controller,listeners}=trackedController();
 const result=await h.request({action:'resolve',phones:['+34600111222']},controller.signal);
 assert.equal(result.ok,true);assert.equal(h.fetches.length,1);assert.equal(listeners.size,0);
 const [url,init]=h.fetches[0];assert.equal(url,'/api/admin/whatsapp-campaign-drafts');assert.equal(init.method,'POST');
 assert.equal(init.headers.Authorization,'Bearer fixture-token');assert.equal(init.signal,controller.signal);
 assert.deepEqual(JSON.parse(init.body),{action:'resolve',phones:['+34600111222']});
});
test('Session errors and synchronous SDK failure both clean up without fetch',async()=>{
 for(const readSession of [()=>Promise.reject(new Error('Session unavailable')),()=>{throw new Error('Session unavailable');}]){
  const h=harness(readSession),{controller,listeners}=trackedController();
  await assert.rejects(h.request(undefined,controller.signal),/Session unavailable/);assert.equal(h.fetches.length,0);assert.equal(listeners.size,0);
 }
 const h=harness(()=>Promise.resolve({data:{session:null}}));await assert.rejects(h.request(),/Inicia sesión/);assert.equal(h.fetches.length,0);
});
