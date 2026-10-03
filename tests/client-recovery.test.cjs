const {test}=require('node:test');
const assert=require('node:assert/strict');
const ts=require('typescript'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function load(file,mocks={}){
 const exports={};const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(code,{exports,require:n=>{if(n in mocks)return mocks[n];throw new Error(n)},process:{env:{NEXT_PUBLIC_SUPABASE_URL:'http://localhost',NEXT_PUBLIC_SUPABASE_ANON_KEY:'isolated'}},console,Date,Buffer});return exports;
}
for(const [file,method] of [['src/lib/admin/require-admin.ts','uidAndEmailFromBearer'],['src/lib/server/auth-cliente.ts','authUserFromBearer']]){
 for(const status of [400,401,403])test(`${method}: expired/invalid auth ${status} returns no identity`,async()=>{
  let token;const api=load(file,{'@supabase/supabase-js':{createClient:()=>({auth:{getUser:async value=>{token=value;return {data:{user:null},error:{status}}}}})},'@/lib/server/cliente-auth-password':{normalizePhoneDigits:x=>x||''}});
  const result=await api[method](new Request('http://localhost',{headers:{authorization:'Bearer invalid-test'}}));assert.equal(result.uid,null);assert.equal(token,'invalid-test');
 });
 test(`${method}: network/server failure is not turned into a successful identity`,async()=>{
  const api=load(file,{'@supabase/supabase-js':{createClient:()=>({auth:{getUser:async()=>({data:{user:null},error:{status:503}})}})},'@/lib/server/cliente-auth-password':{normalizePhoneDigits:x=>x||''}});
  await assert.rejects(api[method](new Request('http://localhost',{headers:{authorization:'Bearer test'}})));
 });
}
test('Automatic ritual progress resumes from stored dates; no reset or write required',()=>{
 const {computeRitual}=load('src/lib/rituals.ts');const row={estado:'activo',modo:'automatico',progreso_manual:0,override_automatico:false,fecha_inicio:'2026-09-25T00:00:00Z',fecha_fin_prevista:'2026-10-10T00:00:00Z',ritual_types:{fases:[]}};
 const old=JSON.stringify(row);assert.equal(computeRitual(row,Date.parse('2026-10-02T12:00:00Z')).progress,50);assert.equal(JSON.stringify(row),old);
 assert.equal(computeRitual({...row,modo:'manual',progreso_manual:37},Date.now()).progress,37);
});
