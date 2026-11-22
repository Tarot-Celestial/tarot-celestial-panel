const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const ts=require("typescript"), React=require("react"),{create,act}=require("react-test-renderer");
const root=path.join(__dirname,".."), spendFile="src/lib/server/office-campaign-spend.ts",routeFile="src/app/api/admin/office/campaign-pilot/route.ts";
function load(file,mocks={},extra={}) {
  const js=ts.transpileModule(fs.readFileSync(path.join(root,file),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports={};
  vm.runInNewContext(js,{exports,URL,URLSearchParams,Buffer,TextDecoder,AbortController,AbortSignal,Date,Intl,Error,process:{env:{}},...extra,
    require:n=>n in mocks?mocks[n]:n.endsWith(".css")?{default:{}}:require(n)});
  return exports;
}
const now=new Date("2024-04-20T16:00:00Z"),month="2024-04",zone="Europe/Madrid",id="123456789012345678";
const heading="Identificador de la campaña;ID de la cuenta publicitaria;Inicio del informe;Fin del informe;Importe gastado (EUR)";
const spanish=amount=>Buffer.from("\uFEFF"+heading+"\r\n"+[id,99,"01/04/2024","17/04/2024",amount].join(";")+"\r\n");
test("CSV oficial en ES/EN conserva IDs extensos y exige moneda, cuenta y período comparables",()=>{
  const {parsePilotCsv}=load(spendFile),parse=(bytes,m=month)=>parsePilotCsv(bytes,id,m,zone,now);
  const result=parse(spanish("1.234,56"));assert.equal(result.amount,"1234.56");assert.equal(result.campaign,id);
  assert.equal(result.account,"99");assert.equal(result.currency,"EUR");assert.equal(result.through,"2024-04-17");
  assert.match(result.sha256,/^[a-f0-9]{64}$/);assert.equal(parse(spanish("1 234,56")).amount,"1234.56");
  const en=Buffer.from("Campaign ID,Account ID,Reporting starts,Reporting ends,Amount spent (USD)\n"+id+',99,2024-04-01,2024-04-20,"1,234.56"');
  assert.equal(parse(en).amount,"1234.56");assert.equal(parse(en).currency,"USD");assert.equal(parse(spanish("0")).amount,"0");
  assert.throws(()=>parse(spanish("1.234")),/ambiguo/);assert.throws(()=>parse(spanish("1"),"2024-05"),/período/);
  assert.throws(()=>parse(Buffer.from(spanish("9").toString().replace("17/04/2024","30/04/2024"))),/período/);
  assert.throws(()=>parse(Buffer.from(spanish("9").toString().replace("(EUR)",""))),/moneda/);
  assert.throws(()=>parse(Buffer.from(spanish("9").toString().replace("ID de la cuenta publicitaria","Nombre de la cuenta"))),/columnas/);
  assert.throws(()=>parse(Buffer.from(spanish("9").toString()+id+";99;01/04/2024;17/04/2024;1")),/una sola fila/);
});
test("Insights exige la campaña, cuenta, divisa y fecha exactas; diferencia cero confirmado, ausencia y denegación",async()=>{
  const row={campaign_id:id,account_id:"99",account_currency:"EUR",date_start:"2024-04-01",date_stop:"2024-04-20",spend:"0.00"};
  async function run(last) {
    const queue=[{id,account_id:"99"},{account_id:"99",currency:"EUR",timezone_name:zone},last],calls=[];
    const svc=load(spendFile,{}, {process:{env:{META_ADS_READ_TOKEN:"synthetic-fixture"}},fetch:async(url,options)=>{
      calls.push(url);assert.equal(options.method,"GET");assert.equal(options.headers.Authorization,"Bearer synthetic-fixture");assert.equal(url.searchParams.has("access_token"),false);
      return Response.json(queue.shift(),{status:calls.length===3 && last.error?403:200});
    }});
    const resp=await svc.readPilotSpend(id,month,now);assert.equal(calls.length,3);return resp;
  }
  assert.equal((await run({data:[row]})).spend.amount,0);
  assert.equal((await run({data:[]})).spend,null);
  assert.equal((await run({data:[{...row,date_start:"2024-04-04"}]})).reason,"unverified_period");
  assert.equal((await run({data:[{...row,account_currency:"USD"}]})).reason,"unverified_period");
  assert.equal((await run({error:{code:190}})).reason,"no_access");
  assert.equal((await load(spendFile).readPilotSpend(id,month,now)).reason,"not_connected");
});

const actor="12345678-0000-4000-8000-000000000000";
function makeRoute({allowed=true,imported=null,liveSpend=null,liveCurrency=null,empty=false}={}) {
  const calls=[],catalog=empty?[]:[{id,name:"Campaña de prueba"}];
  const db={rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==="office_pilot_catalog")return {data:catalog};
    if(name==="office_pilot_record_csv")return {data:actor};
    return {data:{campaign:args.p_campaign,month,zone:args.p_zone,as_of:args.p_as_of,contacts:3,first_buyers:2,cost_first_buyers:1,
      unattributed_first_purchases:5,amounts:[{currency:"EUR",receipts:3,first_count:2,first_gross:20,gross:25,confirmed:25,refund_flagged:0}],buyers:[],has_more:false}};
  },from:()=>{const chain={select:()=>chain,eq:()=>chain,order:()=>chain,limit:()=>chain,maybeSingle:async()=>({data:imported})};return chain;}};
  const helpers=load(spendFile);
  const api=load(routeFile,{"@/lib/server/office-campaign-spend":{...helpers,readPilotSpend:async()=>({spend:liveSpend,reason:"no_access",account:"99",zone,currency:liveCurrency})},
    "@/lib/server/office-access":{officeAccess:async()=>allowed?{ok:true,authUserId:actor,admin:db}:{ok:false,response:new Response(null,{status:403})},
      officeUuid:v=>typeof v==="string"&&/^[\da-f-]{36}$/.test(v),officeDatabaseError:()=>new Response(null,{status:500}),
      officeError:(error,status)=>Response.json({error},{status}),officeJson:x=>Response.json(x)}});
  return {api,calls,get:(query="")=>api.GET(new Request("http://test.local/?month="+month+query))};
}
test("API privada emplea solo el gasto de mayor autoridad, CPA de su período y control de correspondencia",async()=>{
  let f=makeRoute({allowed:false});assert.equal((await f.get()).status,403);assert.equal(f.calls.length,0);
  f=makeRoute();assert.equal((await f.get("&campaign=000")).status,404);assert.equal(f.calls.length,1);
  const imported={account_id:"99",currency:"EUR",account_zone:zone,from_day:"2024-04-01",through_day:"2024-04-17",spend:45,
    file_sha256:"a".repeat(64),recorded_at:"2024-04-18T00:00:00Z",workers:{display_name:"Ana"}};
  f=makeRoute({imported});let r=await (await f.get()).json();assert.equal(r.cpa,45);assert.equal(r.spend.source,"ads_manager_csv");
  assert.equal(r.spend.worker,"Ana");assert.equal(f.calls[1].args.p_through,"2024-04-17");assert.equal(r.unattributed_first_purchases,5);
  f=makeRoute({imported,liveCurrency:"USD"});r=await (await f.get()).json();assert.equal(r.spend,null);assert.equal(r.spend_reason,"conflicting_account");
  f=makeRoute({imported,liveSpend:{...imported,source:"meta_insights",amount:30,zone,from:"2024-04-01",through:"2024-04-30"}});
  r=await (await f.get()).json();assert.equal(r.cpa,30);assert.equal(r.spend.source,"meta_insights");
  f=makeRoute({empty:true});r=await (await f.get()).json();assert.equal(r.selected,null);assert.equal(r.unattributed_first_purchases,5);
});
test("importación requiere atestación administrativa y nunca adopta el actor del formulario",async()=>{
  const f=makeRoute(),body=new FormData();
  body.set("campaign",id);body.set("month",month);body.set("zone",zone);body.set("p_actor","untrusted");
  body.set("file",new Blob([spanish("20,12")],{type:"text/csv"}),"export.csv");
  const post=()=>f.api.POST(new Request("http://test.local/",{method:"POST",body}));
  assert.equal((await post()).status,400);assert.equal(f.calls.length,0);
  body.set("attested","true");assert.equal((await post()).status,200);
  assert.equal(f.calls[0].args.p_actor,actor);assert.equal(f.calls[0].args.p_spend,"20.12");
});
test("el enlace mantiene campaña y mes al volver atrás y el formulario no sube archivos automáticamente",async()=>{
  let href="http://test.local/admin/oficina?departamento=campanas&mes=2024-04&campana=202",tree;
  const stack=[href],calls=[];
  const win={get location(){return {href};},history:{state:null,replaceState(_s,_t,u){href=u.href;stack[stack.length-1]=href;},
    pushState(_s,_t,u){href=u.href;stack.push(href);}},addEventListener(){},removeEventListener(){}};
  const View=load("src/features/office/OfficeCampaignPilot.tsx",{"./office-client":{officeRequest:async(url,req)=>{
    assert.equal(req.method,undefined);calls.push(url);const q=new URL(url,"http://test.local").searchParams,sel=q.get("campaign")||id;
    return {ok:true,month:q.get("month"),selected:{id:sel,name:"Campaña de prueba"},campaigns:[{id:sel,name:"Campaña de prueba"}],
      zone,as_of:"2024-04-20T00:00:00Z",period_from:"2024-04-01",period_through:"2024-04-20",contacts:3,first_buyers:2,cost_first_buyers:0,
      amounts:[],buyers:[],next_cursor:null,spend:null,spend_reason:"no_access",cpa:null,unattributed_first_purchases:5};
  }}},{window:win}).default;
  function App(){const [value,set]=React.useState(month);return React.createElement(View,{month:value,onMonthChange:m=>{
    const u=new URL(href);u.searchParams.delete("campana");u.searchParams.set("mes",m);win.history.pushState(null,"",u);set(m);
  }});}
  await act(async()=>{tree=create(React.createElement(App));});
  assert.ok(calls[0].includes("campaign=202"));assert.match(JSON.stringify(tree.toJSON()),/Sin atribuir/);
  await act(async()=>tree.root.findAllByType("input").find(i=>i.props.type==="month").props.onChange({target:{value:"2024-03"}}));
  assert.ok(stack[0].includes("mes=2024-04&campana=202"));assert.ok(href.endsWith("mes=2024-03&campana="+id));
  await act(async()=>tree.unmount());
});
