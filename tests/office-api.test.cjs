const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function fixture(options = {}) {
  const calls = [], modules = new Map(), verifiedUser = randomUUID();
  const admin = { async rpc(name, args) { calls.push({ name,args }); return options.reply || { data:{ id:randomUUID() },error:null }; } };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname,"..",file),"utf8"),{
      compilerOptions: { module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code,{ exports,URL,Request,Response,Buffer,Uint8Array,TextDecoder,require(name) {
      if (name === "@/lib/admin/require-admin") return { requireAdmin:async () => options.denied
        ? { ok:false,error:options.denied } : { ok:true,admin,authUserId:verifiedUser } };
      if (name.startsWith("@/")) return load("src/"+name.slice(2)+".ts");
      throw new Error("Unexpected import " + name);
    } });
    modules.set(file,exports); return exports;
  }
  const main = load("src/app/api/admin/oficina/route.ts"), download = load("src/app/api/admin/oficina/archivo/route.ts");
  const base = "https://panel.example.test/api/admin/oficina";
  return { calls,verifiedUser,
    get:() => main.GET(new Request(base)),
    post:(input,headers={}) => main.POST(new Request(base,{ method:"POST",headers:{ "Content-Type":"application/json",...headers },body:JSON.stringify(input) })),
    file:(id=randomUUID()) => download.GET(new Request(base+"/archivo?id="+id)),
  };
}

test("all three Office HTTP operations reject missing or unauthorized identities before querying records",async () => {
  for (const [denied,status] of [["NO_AUTH",401],["NO_WORKER",403],["FORBIDDEN",403]]) {
    const f = fixture({ denied });
    for (const response of [await f.get(),await f.post({}),await f.file()]) {
      assert.equal(response.status,status);
      assert.match(response.headers.get("cache-control"),/no-store/);
    }
    assert.equal(f.calls.length,0);
  }
});

test("Office validates request size, file type, UUIDs, explicit timezone and task inputs on the server",async () => {
  const f = fixture();
  const version = { action:"add_version",task_id:randomUUID(),request_id:randomUUID(),deliverable_id:null,base_version:0,
    title:"Adjunto de prueba",body:"",file_name:"lectura.txt",file_type:"text/plain",file_base64:Buffer.from("texto").toString("base64") };
  const task = { action:"create_task",request_id:randomUUID(),department_id:"finanzas",objective:"Objetivo",expected_delivery:"Informe",
    priority:"baja",status:"pendiente",due_at:"2026-12-10T12:00:00",time_zone:"Europe/Madrid",assignee_worker_id:null,assignee_role:null };
  for (const bad of [{ ...version,file_type:"image/png" },{ ...version,file_name:"../../lectura.txt" },
    { ...version,file_base64:"bad*bytes" },{ ...version,file_name:null,file_type:null,file_base64:null }, task]) {
    assert.equal((await f.post(bad)).status,400);
  }
  assert.equal((await f.post(version,{ "content-length":String(4*1024*1024) })).status,413);
  assert.equal((await f.post(version,{ "content-type":"text/plain" })).status,415);
  assert.equal((await f.file("invalid")).status,400);
  assert.equal(f.calls.length,0);
  assert.equal((await f.post({ ...version,p_user:randomUUID() })).status,200);
  assert.equal(f.calls[0].name,"office_apply"); assert.equal(f.calls[0].args.p_user,f.verifiedUser);
  assert.equal((await f.post({ ...task,due_at:"2026-12-10T12:00:00Z" })).status,200);
});

test("a private file downloads as an attachment and write conflicts are explicit",async () => {
  const bytes = Buffer.from("Revisión local"), f = fixture({ reply:{ data:{ name:"revisión.txt",type:"text/plain",base64:bytes.toString("base64") },error:null } });
  const response = await f.file();
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  assert.match(response.headers.get("content-disposition"),/^attachment.*revisi%C3%B3n\.txt$/);
  assert.equal(response.headers.get("x-content-type-options"),"nosniff");
  assert.equal(f.calls[0].args.p_user,f.verifiedUser);
  const conflict = fixture({ reply:{ data:null,error:{ message:"OFFICE_CONFLICT" } } });
  assert.equal((await conflict.post({ action:"add_note",request_id:randomUUID(),task_id:randomUUID(),note:"Nota" })).status,409);
});
