const {test}=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),ts=require("typescript");
const {randomUUID,createHash}=require("node:crypto"),{NextRequest}=require("next/server");
const digest=s=>createHash("sha256").update(s).digest("hex");
function setup() {
  const s={calls:[],actor:randomUUID(),uid:randomUUID(),client:randomUUID(),denied:false,response:{data:true}};
  const admin={async rpc(name,args){s.calls.push({name,args});return typeof s.response==="function"?s.response(args):s.response;}};
  const loaded=new Map();
  function load(file){
    if(loaded.has(file))return loaded.get(file);
    const js=ts.transpileModule(fs.readFileSync(path.join(__dirname,"..",file+".ts"),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const exports={};
    vm.runInNewContext(js,{exports,URL,Headers,Date,Intl,Buffer,process:{env:{SUPABASE_SERVICE_ROLE_KEY:"local-fixture"}},require(name){
      if(name==="@/lib/server/auth-cliente")return {clientFromRequest:async()=>({uid:s.uid,cliente:{id:s.client},admin})};
      if(name==="@/lib/supabase-admin")return {supabaseAdmin:()=>admin};
      if(name==="@/lib/admin/require-admin")return {requireAdmin:async()=>s.denied?{ok:false,error:"NO_AUTH"}:{ok:true,authUserId:s.actor,me:{id:s.actor},admin}};
      if(name==="@/features/office/model")return {OFFICE_FILE_LIMIT:2097152};
      if(name.startsWith("@/"))return load("src/"+name.slice(2));
      return require(name);
    },Response,Request,TextDecoder});
    loaded.set(file,exports);return exports;
  }
  s.server=load("src/lib/server/office-meta-attribution");
  s.admin=admin;s.landing=load("src/app/cliente/meta/[token]/route");
  const entry=load("src/app/api/cliente/meta-attribution/route"),report=load("src/app/api/admin/office/meta-attribution/route");
  s.post=(token,body,origin="https://panel.example",ref=digest(token).slice(0,24))=>entry.POST(new NextRequest("https://panel.example/api/cliente/meta-attribution?ref="+ref,{method:"POST",
    headers:{origin,cookie:"tc_meta_panel_v1_"+ref+"="+token},body:JSON.stringify(body)}));
  s.report=query=>report.GET(new Request("https://panel.example/api/admin/office/meta-attribution?"+query));
  return s;
}
test("enlace privado opaco, ruta sin escritura y previsualización sin token en la URL de destino",async()=>{
  const s=setup(),opp=randomUUID();
  const generated=await s.server.getMetaPanelLink(s.admin,opp,"https://panel.example","oracle");
  const token=generated.split("/").at(-1);assert.match(token,/^[A-Za-z0-9_-]{43}$/);assert.equal(generated.includes(opp),false);
  assert.equal(s.calls[0].args.p_digest,digest(token));assert.equal(s.calls[0].args.p_destination,"oracle");
  s.calls.length=0;
  const response=await s.landing.GET(new Request(generated),{params:{token}});
  assert.equal(response.headers.get("location"),"https://panel.example/cliente/vincular-meta?ref="+digest(token).slice(0,24));
  assert.match(response.headers.get("set-cookie"),/HttpOnly/i);assert.equal(response.headers.get("referrer-policy"),"no-referrer");assert.equal(s.calls.length,0);
  s.response={data:false};await assert.rejects(s.server.getMetaPanelLink(s.admin,opp,"https://panel.example"),/UNAVAILABLE/);
  await assert.rejects(s.server.getMetaPanelLink(s.admin,opp,"https://panel.example@phishing.test"),/ORIGIN_INVALID/);
});
test("solo el cliente autenticado puede obtener un código y únicamente el mensaje aislado se remite al ledger",async()=>{
  const s=setup(),token="A".repeat(43);
  const foreign=await s.post(token,{action:"challenge"},"https://other.example");assert.equal(foreign.status,403);assert.equal(s.calls.length,0);
  const swapped=await s.post(token,{action:"challenge"},"https://panel.example","f".repeat(24));assert.equal(swapped.status,404);assert.equal(s.calls.length,0);
  s.response={data:"pending"};
  const res=await s.post(token,{action:"challenge",cliente_id:randomUUID(),auth_user_id:randomUUID()});
  const data=await res.json();assert.match(data.code,/^TC-[\dA-F]{12}$/);
  const args=s.calls.at(-1).args;assert.equal(args.p_code_hash,digest(data.code));assert.equal(args.p_user,s.uid);assert.equal(args.p_client,s.client);
  assert.equal(await s.server.confirmMetaPanelCode(s.admin,randomUUID(),"provider","Otra persona dijo "+data.code),"not_code");
  s.response={data:false};assert.equal(await s.server.confirmMetaPanelCode(s.admin,randomUUID(),"provider",data.code),"unmatched");
  s.response={data:true};assert.equal(await s.server.confirmMetaPanelCode(s.admin,randomUUID(),"provider",data.code),"confirmed");assert.equal(s.calls.at(-1).args.p_source_id,"provider");
});
test("informe de Marketing exige admin, rechaza cursor alterado y no confunde error con cero",async()=>{
  const s=setup();s.denied=true;assert.equal((await s.report("month=bad")).status,401);
  s.denied=false;assert.equal((await s.report("month=2024-04&cursor=oops")).status,400);assert.equal(s.calls.length,0);
  s.response={data:{},error:null};assert.equal((await s.report("month=2024-04")).status,503);
  const zero={opportunities:0,opened_opportunities:0,proof_pending:0,linked_clients:0,first_purchases:0,prior_clients:0,linked_elsewhere:0,pending:0};
  s.response=args=>({data:{month:"2024-04",as_of:args.p_as_of,totals:zero,platforms:[],states:[],purchases:[],items:[],has_more:false,secret:"never-return"}});
  const reply=await s.report("month=2024-04"),data=await reply.json();assert.equal(reply.status,200);assert.equal(data.totals.opportunities,0);
  assert.equal(data.secret,undefined);assert.match(reply.headers.get("cache-control"),/no-store/);
});
