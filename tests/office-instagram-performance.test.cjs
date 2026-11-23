const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, dependencies) {
  const source = fs.readFileSync(path.join(__dirname, "../src", file), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  vm.runInNewContext(js.outputText, { exports, require: key => dependencies[key], Date, Error, Set, Promise });
  return exports;
}
function post(id, days, likes, comments, patch={}) {
  return { id, username:"tarotcelestialof", caption:"Pieza " + id, timestamp:new Date(Date.now() - days * 86400000).toISOString(),
    like_count:likes, comments_count:comments, media_type:"IMAGE", permalink:"https://www.instagram.com/p/media" + id + "/", ...patch };
}
function fixture(rows, reaches) {
  const calls = [];
  class GraphError extends Error { constructor(code) { super(code); this.code=code; } }
  const graph = {
    InstagramError:GraphError, instagramConnection:async()=>({accountId:"11"}),
    instagramGraph:async (_account,route,params,body) => {
      assert.equal(body,undefined);
      calls.push(route);
      if (route === "11/media") { assert.match(params.fields,/like_count,comments_count/); return {data:rows}; }
      if (!route.endsWith("/insights")) return {id:route};
      assert.deepEqual(Object.keys(params),["metric"]);assert.equal(params.metric,"reach");
      const value = reaches[route.split("/")[0]];
      if (typeof value === "string") throw new GraphError(value);
      return {data:value === undefined ? [] : [{name:"reach",period:"lifetime",values:[{value}]}]};
    },
  };
  const identity = {verifyOfficeInstagramIdentity:async()=>({ids:["11"]})};
  const api = load("lib/server/office-instagram-performance.ts", {"./instagram-graph":graph,"./office-instagram-graph":identity});
  return {api,calls,identity,graph};
}

test("compara publicaciones propias con el mismo denominador y muestra los datos recientes o incompletos",async()=>{
  const h=fixture([
    post("1",4,8,2),post("2",3,2,1),post("3",4,0,0),post("4",0.1,900,2),post("5",10,null,3),
    post("6",3,9000,10,{username:"otra_cuenta"}),post("1",4,100,100),
    post("7",3,9000,10,{media_product_type:"STORY"}),post("8",110,9000,2),post("9",3,2,2,{permalink:"https://example.com/p/fake"}),
  ],{"1":100,"2":10,"3":0,"4":1000,"5":100,"8":20});
  const result=await h.api.readOfficeInstagramPerformance();
  const byId=id=>result.posts.find(row=>row.id===id);
  assert.equal(result.basis,"per_reach");assert.equal(result.variant_source.id,"2");
  assert.equal(byId("2").score,30);assert.equal(byId("1").rank,2);
  assert.equal(byId("3").reach,0);assert.equal(byId("3").interactions,0);assert.equal(byId("3").rank,null);
  assert.equal(byId("4").rank,null);assert.equal(byId("8").rank,null);
  assert.equal(byId("5").likes,null);assert.equal(byId("5").interactions,null);
  assert.equal(byId("9").reach,null);assert.equal(byId("9").permalink,null);
  assert.equal(byId("6"),undefined);assert.equal(byId("7"),undefined);
  assert.equal(h.calls.filter(r=>r==="1/insights").length,1);
});

test("sin alcance autorizado usa recuentos completos; empates, ceros y muestras insuficientes no producen ganador",async()=>{
  const h=fixture([post("1",3,5,1),post("2",3,4,1),post("3",3,2,undefined)],{"1":"META_PERMISSION","2":0});
  const report=await h.api.readOfficeInstagramPerformance();
  assert.equal(report.basis,"interactions");assert.equal(report.posts[0].score,6);
  assert.equal(report.posts[0].reach,null);assert.equal(report.variant_source.id,"1");
  assert.equal(report.posts.find(p=>p.id==="3").comments,null);
  for(const quantity of [0,3]) {
    const tied=await fixture([post("1",4,quantity,0),post("2",8,quantity,0)],{}).api.readOfficeInstagramPerformance();
    assert.equal(tied.variant_source,null);
    assert.equal(tied.posts.every(p=>p.rank===1),true);
  }
  const single=await fixture([post("1",4,100,0)],{}).api.readOfficeInstagramPerformance();
  assert.equal(single.basis,null);assert.equal(single.variant_source,null);
});

test("rechaza una cuenta no verificada y un token inválido sin inventar un informe vacío",async()=>{
  const h=fixture([post("1",4,1,0)],{"1":"TOKEN_EXPIRED"});
  await assert.rejects(h.api.readOfficeInstagramPerformance(),/TOKEN_EXPIRED/);
  h.calls.length=0;h.identity.verifyOfficeInstagramIdentity=async()=>{throw Object.assign(Error("raw private detail"),{code:"WRONG_ACCOUNT"})};
  await assert.rejects(h.api.readOfficeInstagramPerformance(),/WRONG_ACCOUNT/);
  assert.equal(h.calls.length,0);
});

test("si el listado rechaza los campos opcionales recoge las métricas disponibles de los medios de la cuenta verificada",async()=>{
  const a=post("101",4,0,0), b=post("102",5,0,0), foreign=post("103",5,30,11,{username:"otra_cuenta"});
  const h=fixture([],{}), seen=[];
  h.graph.instagramGraph=async (_account,route,params)=>{
    seen.push(route);
    if (route==="11/media") {
      if (params.fields.includes("media_type")) throw new h.graph.InstagramError("META_PERMISSION");
      return {data:[{...a,username:undefined,like_count:undefined,comments_count:undefined},
        {...b,like_count:undefined},foreign]};
    }
    if (route==="101/insights") throw Error("optional API failure");
    if (route==="102/insights") return {data:[]};
    if (route==="101") return {id:"101",like_count:4,comments_count:2};
    if (route==="102") return {id:"999",like_count:100};
    assert.fail("unexpected route "+route);
  };
  const report=await h.api.readOfficeInstagramPerformance();
  assert.equal(seen.filter(r=>r==="11/media").length,3);assert.equal(report.posts.length,2);
  assert.equal(report.posts.find(p=>p.id==="101").interactions,6);assert.equal(report.posts.find(p=>p.id==="101").reach,null);
  assert.equal(report.posts.find(p=>p.id==="102").likes,null);assert.equal(report.basis,null);
  assert.equal(seen.some(r=>r.startsWith("103")),false);
});

test("diagnóstico acotado de etapa sin información remota y sin reintentar credenciales inválidas",async()=>{
  const h=fixture([],{});let calls=0;
  h.graph.instagramGraph=async()=>{calls++;throw new h.graph.InstagramError("TOKEN_EXPIRED")};
  await assert.rejects(h.api.readOfficeInstagramPerformance(),e=>e.stage==="media" && e.code==="TOKEN_EXPIRED");
  assert.equal(calls,1);
  h.graph.instagramConnection=async()=>{throw Object.assign(Error("private"),{code:"sensitive-provider-string"})};
  await assert.rejects(h.api.readOfficeInstagramPerformance(),e=>e.code==="UNAVAILABLE" && e.stage==="connection" && !String(e).includes("private"));
});

test("el endpoint de métricas solo llama a Instagram tras comprobar el acceso administrativo",async()=>{
  let permitted=false, calls=0;
  const api=load("app/api/admin/office/instagram/performance/route.ts",{
    "@/lib/server/office-access":{officeAccess:async()=>permitted?{ok:true}:{ok:false,response:403},officeJson:data=>data,officeError:(_s,code)=>code},
    "@/lib/server/office-instagram-performance":{readOfficeInstagramPerformance:async()=>{calls++;return {posts:[],variant_source:null};}},
  });
  assert.equal(await api.GET({}),403);assert.equal(calls,0);
  permitted=true;assert.equal((await api.GET({})).ok,true);assert.equal(calls,1);
});
