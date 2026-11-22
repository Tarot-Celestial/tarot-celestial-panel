const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"), path=require("node:path"), vm=require("node:vm"), ts=require("typescript");
function fixture(){
  const h={denied:null, actor:"current-admin", calls:[], reply:{data:{},error:null}};
  function load(file){
    const exports={};
    const source=fs.readFileSync(path.join(__dirname,"..",file),"utf8");
    const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(js,{exports,Response,require(name){
      if(name==="@/lib/admin/require-admin")return {requireAdmin:async()=>h.denied?{ok:false,error:h.denied}:
        {ok:true,authUserId:h.actor,admin:{async rpc(name,args){h.calls.push({name,args});return h.reply;}}}};
      if(name.startsWith("@/")) return load("src/"+name.slice(2)+".ts");
      throw Error(name);
    }});
    return exports;
  }
  const api=load("src/app/api/admin/office/autonomy/route.ts"),url="https://example.test/api/admin/office/autonomy";
  return Object.assign(h,{get:()=>api.GET(new Request(url)),post:body=>api.POST(new Request(url,{method:"POST",body:JSON.stringify(body)}))});
}
const rule={department:"marketing",action:"capture_reply",channel:"instagram",account:"business",mode:"human",
  window_start:"22:00",window_end:"02:00",daily_actions:8,daily_usd:0.50,revision:2};
test("solo un administrador abre o modifica reglas; el actor procede exclusivamente de la sesión",async()=>{
  const h=fixture();
  for(const [denied,status] of [["NO_AUTH",401],["FORBIDDEN",403]]){
    h.denied=denied;
    assert.equal((await h.get()).status,status);
    assert.equal((await h.post(rule)).status,status);
  }
  assert.equal(h.calls.length,0);
  h.denied=null;
  const get=await h.get();
  assert.equal(get.status,200);assert.match(get.headers.get("cache-control"),/no-store/);
  assert.equal(h.calls[0].args.p_actor,h.actor);
  assert.equal((await h.post({...rule,actor_user_id:"fake"})).status,200);
  assert.equal(h.calls[1].name,"office_autonomy_set");
  assert.equal(h.calls[1].args.p_revision,2);
  assert.equal(h.calls[1].args.p_rule.actor_user_id,undefined);
  assert.equal(h.calls[1].args.p_actor,h.actor);
});
test("rechaza reglas incoherentes y devuelve conflicto ante dos ediciones de la misma revisión",async()=>{
  const h=fixture();
  for(const changes of [{channel:"openai"},{mode:"go"},{department:"clientes"},{window_end:null},
      {daily_actions:1.5},{daily_usd:-1},{revision:null},{window_start:"24:00"}]){
    assert.equal((await h.post({...rule,...changes})).status,400);
  }
  assert.equal(h.calls.length,0);
  h.reply={data:null,error:{message:"OFFICE_CONFLICT"}};
  assert.equal((await h.post(rule)).status,409);
  assert.equal((await h.post({operation:"hold",department:"marketing",held:true,revision:7})).status,409);
  assert.equal(h.calls.at(-1).name,"office_autonomy_hold");
});
