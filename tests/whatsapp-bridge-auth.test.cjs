const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const ts=require('typescript');
function fixture(env={WHATSAPP_GATEWAY_MODE:'bridge',WHATSAPP_GATEWAY_SECRET:'fixture-private-key-with-more-than-32-characters'}){
 const calls=[];const exports={};const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/app/api/internal/whatsapp-bridge/route.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,process:{env},Buffer,Request,Response,require(name){if(name==='next/server')return {NextResponse:class extends Response{static json(body,init){return new Response(JSON.stringify(body),init)}}};if(name==='@/lib/server/whatsapp-local-bridge')return {whatsappBridgeAdmin:()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:{commands:[]}}}})};return require(name);}});
 const post=(token,body={results:[]})=>exports.POST(new Request('https://fixture.invalid/api/internal/whatsapp-bridge',{method:'POST',headers:{authorization:`Bearer ${token}`},body:JSON.stringify(body)}));
 return {post,calls,secret:env.WHATSAPP_GATEWAY_SECRET};
}
test('bridge rejects wrong secret and disabled mode before reading its database',async()=>{
 const f=fixture();for(const key of ['', 'wrong-key', 'fixture-private-key'])assert.equal((await f.post(key)).status,401);assert.equal(f.calls.length,0);
 const disabled=fixture({WHATSAPP_GATEWAY_MODE:'',WHATSAPP_GATEWAY_SECRET:f.secret});assert.equal((await disabled.post(f.secret)).status,503);assert.equal(disabled.calls.length,0);
});
test('bridge accepts only bounded result batches and never exposes secrets',async()=>{
 const f=fixture();assert.equal((await f.post(f.secret,{results:{}})).status,400);assert.equal((await f.post(f.secret,{results:Array(11).fill({})})).status,400);assert.equal(f.calls.length,0);
 const response=await f.post(f.secret);assert.equal(response.status,200);assert.equal(f.calls.length,1);assert.match(response.headers.get('cache-control'),/no-store/);assert.doesNotMatch(await response.text(),/private-key/);
});
