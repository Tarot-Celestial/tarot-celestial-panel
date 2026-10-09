const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function server(db){
 const exports={};
 const source=fs.readFileSync(path.join(__dirname,'../src/lib/server/central-assistant.ts'),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture'}},console,Date,Set,Map,Error,require(name){if(name==='@supabase/supabase-js')return {createClient:()=>db};if(name==='node:crypto')return require(name);return {};}});
 return exports;
}
test('forged identity is rejected by verified Auth before any database query',async()=>{
 let queried=false;const s=server({auth:{getUser:async()=>({data:{user:null},error:{message:'Invalid signature'}})},from(){queried=true;throw Error('must not run');}});
 await assert.rejects(s.assistantAuth({headers:new Headers({authorization:'Bearer forged-token'})}),e=>e.status===401);assert.equal(queried,false);
});
test('valid session with a client role cannot use central assistant',async()=>{
 const s=server({auth:{getUser:async()=>({data:{user:{id:'user1'}},error:null})},from(){return {select(){return this},eq:async()=>({data:[{id:'worker1',role:'cliente',is_active:true}],error:null})};}});
 await assert.rejects(s.assistantAuth({headers:new Headers({authorization:'Bearer valid-token'})}),e=>e.status===403);
});
test('model tool names cannot execute arbitrary actions or silently save proposals',async()=>{
 const s=server({});await assert.rejects(s.runTool({},'delete_clients',{}),/Herramienta no disponible/);
 const result=await s.runTool({},'prepare_memory',{topic:'Orden',content:'Priorizar incidencias'});
 assert.equal(result.proposal.type,'memory');assert.equal(result.proposal.content,'Priorizar incidencias');
 await assert.rejects(s.runTool({},'prepare_task',{title:'Test',kind:'send_whatsapp',due_at:'2030-01-01',days:30,recurrence:'daily'}));
});
