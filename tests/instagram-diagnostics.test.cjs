const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function load(file,mocks={},globals={}){const exports={};const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{exports,URL,Buffer,Date,AbortSignal,process:{env:{}},...globals,require:n=>n in mocks?mocks[n]:n==='server-only'?{}:require(n)});return exports;}
test('diagnostic comparisons use identical reads and never return token, comment text or remote errors',async()=>{
  class InstagramError extends Error{constructor(code,message){super(message);this.code=code;}}
  const calls=[],account={accountId:'account',token:'PRIVATE'},chain={};
  for(const method of ['select','eq','in','not','order','limit'])chain[method]=()=>chain;
  chain.maybeSingle=async()=>({data:{external_post_id:'18107808317369936'}});
  const graph={instagramConnection:async()=>account,InstagramError,graphId:v=>typeof v==='string',instagramGraph:async(a,p,q)=>{calls.push({a,p,q,mode:'header'});return {data:[]};},instagramReadWithQueryToken:async(a,p,q)=>{calls.push({a,p,q,mode:'query'});return {data:[{id:'id',text:'PRIVATE COMMENT'}]};}};
  const mod=load('src/lib/server/instagram-diagnostics.ts',{'@/lib/supabase-admin':{supabaseAdmin:()=>({from:()=>chain})},'./instagram-graph':graph});
  const result=await mod.instagramDiagnostics();
  assert.equal(result.checks.length,4);
  assert.deepEqual(Array.from(result.checks,c=>c.count),[0,1,0,1]);
  for(let i=0;i<4;i+=2){assert.equal(calls[i].p,calls[i+1].p);assert.deepEqual(calls[i].q,calls[i+1].q);}
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('central workers cannot run administrative connection diagnostics',async()=>{
  let called=0;
  class InstagramError extends Error{constructor(code,message,status){super(message);this.code=code;this.status=status;}}
  const mod=load('src/app/api/central/instagram/route.ts',{'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},'@/lib/server/instagram-graph':{InstagramError,instagramIdentity:async()=>({worker:{role:'central'}})},'@/lib/server/instagram-inbox':{},'@/lib/server/instagram-diagnostics':{instagramDiagnostics:async()=>{called++;}}});
  const result=await mod.GET(new Request('https://local.test/api/central/instagram?action=diagnostics'));
  assert.equal(result.status,403);assert.equal(called,0);
});
test('alternative token transport remains a server-side GET to the fixed Instagram host',async()=>{
  let request;
  const mod=load('src/lib/server/instagram-graph.ts',{'@/lib/supabase-admin':{},'@/lib/server/social-connections':{}},{fetch:async(url,options)=>{request={url,options};return {ok:true,json:async()=>({data:[]})};}});
  await mod.instagramReadWithQueryToken({token:'PRIVATE'},'123/comments',{fields:'id'});
  assert.equal(request.url.hostname,'graph.instagram.com');
  assert.equal(request.url.searchParams.get('access_token'),'PRIVATE');
  assert.equal(request.options.method,'GET');
  assert.equal(request.options.headers.Authorization,undefined);
});
