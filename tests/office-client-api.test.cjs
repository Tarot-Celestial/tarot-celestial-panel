const {test} = require("node:test");
const assert = require("node:assert/strict");
const {randomUUID} = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function fixture() {
  const state = { calls:[], actor:randomUUID(), denied:null, reply:{data:[],error:null} };
  const db = { async rpc(name,args) { state.calls.push({name,args}); return state.reply; } };
  function load(file) {
    const source = fs.readFileSync(path.join(__dirname,"..",file),"utf8");
    const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const exports = {};
    vm.runInNewContext(code,{exports,URL,Request,Response,Date,Buffer,TextDecoder,require(mod) {
      if (mod === "@/lib/admin/require-admin") return { requireAdmin:async()=>state.denied ? {ok:false,error:state.denied} : {ok:true,admin:db,authUserId:state.actor,me:{id:randomUUID()}} };
      if (mod.startsWith("@/")) return load("src/"+mod.slice(2)+".ts");
      if (mod === "node:crypto") return require(mod);
      throw Error("Unexpected module: "+mod);
    }});
    return exports;
  }
  const api = load("src/app/api/admin/office/clients/route.ts");
  const totals = load("src/app/api/admin/office/clients/capture-totals/route.ts");
  state.get = params => api.GET(new Request("https://example.test/api/admin/office/clients?"+new URLSearchParams(params)));
  state.totals = () => totals.GET(new Request("https://example.test/api/admin/office/clients/capture-totals"));
  return state;
}

function client(id=randomUUID()) {
  return {id,display_name:"Nombre de prueba",country:null,account_linked:false,created_at:"2026-11-22T14:00:00Z",
    capture_stage:"pending",first_purchase_at:null,email:"not-exposed",phone:"not-exposed"};
}
function details(row, appointments=[], more=false) {
  return {client:row,first_purchase:null,capture:null,appointments,appointments_has_more:more};
}
test("authenticating the admin precedes query validation and all CRM reads",async()=>{
  const h=fixture();
  for (const [denied,status] of [["NO_AUTH",401],["FORBIDDEN",403]]) {
    h.denied=denied;
    const res=await h.get({id:"not-a-uuid"});
    assert.equal(res.status,status);assert.match(res.headers.get("cache-control"),/private.*no-store/);
  }
  assert.equal(h.calls.length,0);
});
test("invalid filters, malformed cursors, ids and unbounded limits reject before the RPC",async()=>{
  const h=fixture();
  for(const params of [{q:"a".repeat(121)},{q:"a\u0000b"},{limit:"0"},{limit:"51"},{limit:"2.5"},{id:"x"},{stage:"todos"},{cursor:""},{cursor:"bad"}]){
    assert.equal((await h.get(params)).status,400);
  }
  assert.equal(h.calls.length,0);
});
test("directory preserves the snapshot and cursor, enforces actor, filter and search, strips unrelated fields",async()=>{
  const h=fixture(), a={...client(),display_name:null}, b=client(), c=client();
  h.reply={data:[a,b,c],error:null};
  const res=await h.get({q:" Jose\u0301 ",stage:"pending",limit:2});
  assert.equal(res.status,200);const json=await res.json();
  assert.equal(json.items.length,2);assert.equal(json.items[0].display_name,"Sin nombre registrado");assert.equal(json.items[0].phone,undefined);
  assert.equal(json.items[0].email,undefined);assert.ok(json.next_cursor);assert.deepEqual(h.calls[0].args.p_search,"José");
  assert.equal(h.calls[0].args.p_stage,"pending");assert.equal(h.calls[0].args.p_actor,h.actor);assert.equal(h.calls[0].args.p_limit,3);
  assert.equal((await h.get({q:"other",stage:"pending",cursor:json.next_cursor})).status,400);
  assert.equal((await h.get({q:"José",stage:"all",cursor:json.next_cursor})).status,400);
  h.reply={data:[c],error:null};
  const next=await (await h.get({q:"José",stage:"pending",limit:2,cursor:json.next_cursor})).json();
  assert.equal(next.next_cursor,null);assert.equal(next.items[0].id,c.id);
  assert.equal(h.calls[1].args.p_after,b.id);assert.equal(h.calls[1].args.p_as_of,h.calls[0].args.p_as_of);
  h.actor=randomUUID();assert.equal((await h.get({q:"José",stage:"pending",cursor:json.next_cursor})).status,400);
});
test("reservation cursor preserves source and null dates and remains bound to the correct client",async()=>{
  const h=fixture(), row=client(), id=randomUUID();
  const res={id,source:"reservas",at:null,status:"pendiente",tarotist_name:null,private_notes:"never return"};
  const data=details(row,[res],true);
  data.client.origin="web";
  data.capture={id:randomUUID(),origin:"crm",status:"pendiente",created_at:null,next_contact_at:null,phone:"private"};
  data.first_purchase={id:"123",source:"crm_cliente_pagos",status:"refunded",at:"2026-11-20T20:00:00Z",amount:0,currency:null,unrelated:"private"};
  h.reply={data,error:null};
  const first=await(await h.get({id:row.id,limit:"1"})).json();
  assert.equal(first.capture.lead_id,data.capture.id);assert.equal(first.first_purchase.amount,0);assert.equal(first.first_purchase.currency,null);
  assert.equal(first.first_purchase.status,"refunded");
  assert.equal(first.client.origin,"web");assert.equal(first.capture.origin,"crm");
  assert.ok(first.next_reservations_cursor);assert.equal(first.reservations[0].private_notes,undefined);assert.ok(!JSON.stringify(first).includes("private"));
  assert.equal((await h.get({id:randomUUID(),cursor:first.next_reservations_cursor})).status,400);
  h.reply={data:details(row,[{...res,source:"first_tarotist_reservations"}]),error:null};
  const second=await(await h.get({id:row.id,limit:"1",cursor:first.next_reservations_cursor})).json();
  assert.equal(second.next_reservations_cursor,null);assert.equal(second.reservations[0].source,"first_tarotist_reservations");
  assert.equal(h.calls[1].args.p_after_id,id);assert.equal(h.calls[1].args.p_after_at,null);assert.equal(h.calls[1].args.p_after_source,"reservas");
});
test("unavailable, unknown and cross-client records cannot masquerade as an empty purchase history",async()=>{
  const h=fixture(), id=randomUUID();
  h.reply={data:null,error:null};assert.equal((await h.get({id})).status,404);
  h.reply={data:null,error:{message:"private-internal-detail"}};const failed=await h.get({id});
  assert.equal(failed.status,503);assert.ok(!(await failed.text()).includes("private-internal-detail"));
  h.reply={data:details(client()),error:null};assert.equal((await h.get({id})).status,503);
  h.reply={data:{...details(client(id)),first_purchase:undefined},error:null};assert.equal((await h.get({id})).status,503);
});

test("capture overview uses one authorized aggregate and rejects missing or inconsistent totals",async()=>{
  const h=fixture();
  for (const [denied,expected] of [["NO_AUTH",401],["FORBIDDEN",403]]) {
    h.denied=denied; assert.equal((await h.totals()).status,expected);
  }
  assert.equal(h.calls.length,0); h.denied=null;
  h.reply={ data:[{total_clients:"1234",captured_clients:0,internal:"private"}], error:null };
  const result=await h.totals();
  assert.deepEqual(await result.json(),{ok:true,total_clients:1234,captured_clients:0});
  assert.match(result.headers.get("cache-control"),/private.*no-store/);
  assert.equal(h.calls[0].name,"office_crm_capture_totals");assert.equal(h.calls[0].args.p_actor,h.actor);
  for (const data of [null,[],{total_clients:1,captured_clients:2},{total_clients:"9007199254740992",captured_clients:0},
    {total_clients:10,captured_clients:null},{total_clients:10,captured_clients:-1},{total_clients:10,captured_clients:"2.2"}]) {
    h.reply={data,error:null};assert.equal((await h.totals()).status,503);
  }
});
