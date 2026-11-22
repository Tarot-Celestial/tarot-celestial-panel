const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),ts=require("typescript");
const React=require("react"),{create,act}=require("react-test-renderer"),{randomUUID}=require("node:crypto");
const root=path.join(__dirname,".."),id="70000000-0000-4000-8000-000000000001",user="70000000-0000-4000-8000-000000000002";
function load(file,mocks,extra={}){
 const js=ts.transpileModule(fs.readFileSync(path.join(root,file),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const out={};vm.runInNewContext(js,{exports:out,URL,URLSearchParams,Date,Intl,Response,Error,AbortController,crypto:{randomUUID},...extra,
   require:n=>n in mocks?mocks[n]:n.endsWith(".css")?{default:{}}:require(n)});return out;
}
function api(actor=user){
 const calls=[];
 const route=load("src/app/api/central/comercial/route.ts",{
   "@/lib/admin/require-admin":{uidAndEmailFromBearer:async()=>({uid:actor}),getServiceClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:{ok:true},error:null};}})},
   "@/lib/server/office-access":{officeError:(message,status)=>Response.json({error:message},{status}),officeJson:body=>Response.json(body),officeUuid:v=>typeof v==="string" && /^[0-9a-f-]{36}$/.test(v)}
 });return {route,calls};
}
test("API requires verified auth, strips caller actor, validates cursor/body and never submits an outgoing message",async()=>{
 const unauth=api(null);assert.equal((await unauth.route.GET(new Request("http://test.invalid"))).status,401);assert.equal(unauth.calls.length,0);
 const f=api(), body={id,request_id:randomUUID(),version:1,action:"claim",p_actor:"fake",actor:"fake"};
 const post=b=>f.route.POST(new Request("http://test.invalid",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)}));
 assert.equal((await f.route.GET(new Request("http://test.invalid?before=2026-11-01"))).status,400);
 assert.equal((await post({...body,action:"send"})).status,400);assert.equal((await post({...body,action:"resolve",outcome:"other",note:""})).status,400);
 assert.equal((await post(body)).status,200);assert.equal(f.calls[0].name,"office_commercial_change");assert.equal(f.calls[0].args.p_actor,user);
 assert.equal((await post({...body,action:"resolve",outcome:"no_inquiry"})).status,200);
 assert.equal(f.calls.at(-1).args.p_outcome,"no_inquiry");
 assert.equal((await f.route.GET(new Request("http://test.invalid?state=reply_window"))).status,200);
 assert.equal(f.calls.at(-1).args.p_filter,"reply_window");
});
const example={opportunity_id:id,name:"Contacto de prueba",reason:"needs_personal_response",channel:"instagram",kind:"message",state:"open",owner_id:null,owner_name:null,
  version:1,opened_at:"2026-11-01T11:00:00Z",latest_inbound_at:"2026-11-01T12:00:00Z",capture_status:"handoff",thread_id:id};
test("inbox renders real case detail, claims it, links the correct Central and releases to its human queue",async()=>{
 const row={...example},calls=[];
 const window={setInterval:()=>1,clearInterval(){},addEventListener(){},removeEventListener(){}};
 const View=load("src/features/office/OfficeCommercialInbox.tsx",{
  "next/dynamic":{default:()=>()=>null},"./OfficeCaptureThread":{OfficeCaptureThread:()=>null},
  "./office-client":{OfficeRequestError:class extends Error{},officeRequest:async(url,init)=>{
    calls.push([url,init]);if(init?.method==="POST"){const p=JSON.parse(init.body);assert.equal(p.id,id);assert.ok(p.request_id);assert.equal(p.version,row.version);
      row.version++;row.state=p.action==="claim"?"claimed":"open";row.owner_id=p.action==="claim"?user:null;row.owner_name=row.owner_id?"Mar":null;return {};}
    return {items:[{...row}],actor_id:user,is_admin:false,native_access:true,central_path:"/panel-central",next:null};
  }}
 },{window,document:{visibilityState:"visible"}}).default;
 let tree;await act(async()=>{tree=create(React.createElement(View,{opportunityId:id}));});
 const rendered=()=>JSON.stringify(tree.toJSON()),button=s=>tree.root.findAllByType("button").find(b=>b.children.includes(s));
 assert.match(rendered(),/respuesta personal/);assert.equal(calls.filter(([,r])=>r?.method==="POST").length,0);assert.ok(calls[0][0].includes("id="+id));
 await act(async()=>{await button("Tomar caso").props.onClick();});assert.match(rendered(),/En atención/);
 assert.ok(tree.root.findAllByType("option").some(o=>o.props.value==="no_inquiry" && o.children.includes("Sin solicitud de consulta")));
 assert.ok(tree.root.findAllByType("a").some(a=>a.props.href==="/panel-central?tab=comercial&caso="+id+"&origen=1"));
 await act(async()=>{await button("Liberar para otro operador").props.onClick();});assert.ok(button("Tomar caso"));
 assert.deepEqual(calls.filter(([,r])=>r?.method==="POST").map(([,r])=>JSON.parse(r.body).action),["claim","release"]);
 await act(async()=>tree.unmount());
});
