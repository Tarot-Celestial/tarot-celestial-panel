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
      assert.equal(params.metric,"reach");
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
  h.calls.length=0;h.identity.verifyOfficeInstagramIdentity=async()=>{throw Error("WRONG_ACCOUNT")};
  await assert.rejects(h.api.readOfficeInstagramPerformance(),/WRONG_ACCOUNT/);
  assert.equal(h.calls.length,0);
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
