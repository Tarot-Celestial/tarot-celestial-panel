const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function fixture() {
  const x={denied:null,calls:[],report:{month:"2024-05",zone:"Europe/Madrid",as_of:"2024-06-01T00:00:00Z",captured_clients:0,origins:[],totals:[]}};
  const route=fs.readFileSync(path.join(__dirname,"../src/app/api/admin/office/cohorts/route.ts"),"utf8");
  const code=ts.transpileModule(route,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exp={}; const json=(value,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"private, no-store"}});
  vm.runInNewContext(code,{exports:exp,Intl,URL,Date,require(mod) {
    assert.equal(mod,"@/lib/server/office-access");
    return {officeJson:json,officeError:(error,status)=>json({ok:false,error},status),officeDatabaseError:()=>json({ok:false},503),
      officeAccess:async()=>x.denied ? {ok:false,response:json({ok:false},x.denied)} : {ok:true,admin:{rpc:async(name,args)=>{
        x.calls.push({name,args}); return {data:x.report,error:x.error}; }}}};
  }});
  x.get=(m)=>exp.GET(new Request("https://example.test/api/admin/office/cohorts?month="+encodeURIComponent(m)));
  return x;
}
test("el informe verifica el permiso de Oficina antes de validar el mes; la SQL interna no suplanta al administrador",async()=>{
  const f=fixture(); f.denied=403; assert.equal((await f.get("inválido")).status,403);
  f.denied=null;for(const month of ["2024-00","2024-13","2024-5","9999-01"]) assert.equal((await f.get(month)).status,400);
  assert.equal(f.calls.length,0);
  f.report.email="privado";
  const res=await f.get("2024-05");
  assert.equal(res.status,200); assert.match(res.headers.get("cache-control"),/no-store/);
  assert.equal((await res.json()).email,undefined); assert.equal(f.calls[0].name,"office_crm_cohort_report");
  assert.deepEqual(Object.keys(f.calls[0].args).sort(),["p_as_of","p_month"]);
  assert.equal(f.calls[0].args.p_month,"2024-05-01");
});
test("una fuente caída, recuentos que no concilian y orígenes libres jamás se muestran como un informe vacío",async()=>{
  const f=fixture(); f.report.captured_clients=1;assert.equal((await f.get("2024-05")).status,503);
  f.report.origins=[{origin:"texto privado",basis:"current_only",captured_clients:1,amounts:[]}];
  const invalid=await f.get("2024-05"); assert.equal(invalid.status,503);assert(!JSON.stringify(await invalid.json()).includes("texto privado"));
  f.error={message:"error"};assert.equal((await f.get("2024-05")).status,503);
});
