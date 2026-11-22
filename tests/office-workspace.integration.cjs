const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

// Disposable PostgreSQL. No network, credentials, customer data or production project.
const actor = randomUUID(), user = randomUUID(), coworker = randomUUID(), inactive = randomUUID();
const request = (action, values) => ({ request_id: randomUUID(), action, ...values });
const base = { department_id: "marketing", objective: "Preparar campaña de prueba", expected_delivery: "Texto revisable",
  priority: "media", status: "pendiente", time_zone: "Europe/Madrid", due_at: "2026-12-10T13:00:00Z",
  assignee_role: "departamento", assignee_worker_id: null };
let db;
async function scalar(query, args = []) { return (await db.query(query,args)).rows[0].v; }
const snapshot = () => scalar("select public.office_snapshot($1) v",[user]);
const apply = (input, who = user) => scalar("select public.office_apply($1,$2::jsonb) v",[who,JSON.stringify(input)]);
const file = (id, who = user) => scalar("select public.office_file($1,$2) v",[who,id]);

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.workers (id uuid primary key,user_id uuid,display_name text,is_active boolean);
    create table public.admin_grants(user_id uuid primary key);
    create function public.tc_has_admin_access(p_user_id uuid) returns boolean language sql stable as
      $$select exists (select 1 from public.admin_grants where user_id=p_user_id)$$;
    grant select on public.workers,public.admin_grants to service_role;`);
  await db.query("insert into public.workers values($1,$2,'Álex',true),($3,null,'Celia',true),($4,null,'Baja',false)",[actor,user,coworker,inactive]);
  await db.query("insert into public.admin_grants values($1)",[user]);
  // Reproduce the managed project's grants on newly created public tables/functions.
  await db.exec(`alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  await db.exec(fs.readFileSync(path.join(__dirname,"../supabase/migrations/20261122191931_office_celestial_workspace.sql"),"utf8"));
  await db.exec("set role service_role");
});
after(async () => { if (db) await db.close(); });

test("migration replaces broad Supabase defaults with the effective Office privilege matrix", async () => {
  const tableGrants = {
    office_departments:["SELECT","UPDATE"], office_tasks:["SELECT","INSERT","UPDATE"],
    office_versions:["SELECT","INSERT"], office_events:["SELECT","INSERT"], office_requests:["SELECT","INSERT"],
  };
  const roles = ["anon","authenticated","service_role"];
  const allGrants = ["SELECT","INSERT","UPDATE","DELETE","TRUNCATE","TRIGGER","REFERENCES"];
  const columns = { office_versions:["status","review_note","reviewed_by","reviewed_at"], office_requests:["result_id"] };
  for (const role of roles) {
    for (const [table,grants] of Object.entries(tableGrants)) {
      const qualified = "public." + table;
      for (const privilege of allGrants) {
        const allowed = await scalar("select has_table_privilege($1,$2,$3) v",[role,qualified,privilege]);
        assert.equal(allowed,role === "service_role" && grants.includes(privilege),role + " " + privilege + " " + table);
      }
      if (columns[table]) {
        const actual = (await db.query("select attname from pg_catalog.pg_attribute where attrelid=$1::regclass and attnum>0 and not attisdropped and has_column_privilege($2,attrelid,attnum,'UPDATE') order by attname",[qualified,role])).rows.map(r=>r.attname);
        assert.deepEqual(actual,role === "service_role" ? [...columns[table]].sort() : []);
      }
    }
    for (const signature of ["office_actor(uuid)","office_snapshot(uuid)","office_file(uuid,uuid)","office_apply(uuid,jsonb)"]) {
      assert.equal(await scalar("select has_function_privilege($1,$2,'EXECUTE') v",[role,"public."+signature]),role === "service_role");
    }
  }
});

test("reloading reproduces 15 departments, real assignees, task state, notes and revisions", async () => {
  const before = await snapshot();
  assert.equal(before.departments.length,15); assert.equal(before.actorId,actor);
  assert.deepEqual(before.workers.map(w => w.id).sort(),[actor,coworker].sort());
  const payload = request("create_task",base);
  const created = await apply(payload);
  assert.deepEqual(await apply(payload),created);
  await assert.rejects(apply({ ...payload, objective: "Distinto" }),/OFFICE_CONFLICT/);
  const change = request("update_task",{ ...base, department_id:"inteligencia", id:created.id, revision:1, status:"en_curso", assignee_worker_id:coworker, assignee_role:null });
  await apply(change);
  await assert.rejects(apply({ ...change,request_id:randomUUID() }),/OFFICE_CONFLICT/);
  await apply(request("add_note",{ task_id:created.id,note:"Coordinar con Contenido" }));
  await apply(request("set_lead",{ department_id:"marketing",revision:1,lead_worker_id:coworker }));
  const reloaded = await snapshot(), task = reloaded.tasks.find(t => t.id === created.id);
  assert.equal(task.revision,2); assert.equal(task.assignee_worker_id,coworker); assert.equal(task.created_by,actor);
  assert.equal(task.time_zone,"Europe/Madrid"); assert.equal(Date.parse(task.due_at),Date.parse(base.due_at));
  assert.equal(reloaded.departments.find(d=>d.id==="marketing").lead_worker_id,coworker);
  const events = reloaded.events.filter(e=>e.task_id===created.id);
  assert.equal(events.length,3); assert.ok(events.every(e=>e.actor_id===actor && e.created_at));
  assert.ok(events.some(e=>e.note==="Coordinar con Contenido"));
  const transfer = events.find(e=>e.kind==="update_task");
  assert.equal(transfer.previous_department_id,"marketing"); assert.equal(transfer.department_id,"inteligencia");
  assert.match(transfer.note,/marketing → inteligencia/); assert.match(transfer.note,/responsable/);
  const audit = await scalar("select details v from public.office_events where id=$1",[transfer.id]);
  assert.equal(audit.previous.status,"pendiente"); assert.equal(audit.current.status,"en_curso");
  await assert.rejects(apply(request("set_lead",{ department_id:"marketing",revision:1,lead_worker_id:null })),/OFFICE_CONFLICT/);
  await assert.rejects(apply(request("update_task",{ ...base,id:created.id,revision:2,assignee_worker_id:inactive,assignee_role:null })),/OFFICE_INVALID/);
  await assert.rejects(apply(request("create_task",{ ...base,time_zone:"Zona/inexistente" })),/OFFICE_INVALID/);
  assert.equal((await snapshot()).tasks.find(t=>t.id===created.id).revision,2);
});

test("version decisions bind to exact bytes and newest revision; retries and duplicate decisions have one effect",async () => {
  const { id: task_id } = await apply(request("create_task",base));
  const first = request("add_version",{ task_id,deliverable_id:null,base_version:0,title:"Pieza inicial",body:"",
    file_name:"guion.txt",file_type:"text/plain",file_base64:Buffer.from("Primera versión").toString("base64") });
  const one = await apply(first);
  assert.deepEqual(await apply(first),one);
  await assert.rejects(apply({ ...first,file_base64:Buffer.from("Bytes diferentes").toString("base64") }),/OFFICE_CONFLICT/);
  const receipt = await scalar("select to_jsonb(r) v from public.office_requests r where request_id=$1",[first.request_id]);
  assert.equal(receipt.fingerprint.length,66); // 32 bytes, including the Postgres hex prefix.
  assert.deepEqual(Object.keys(receipt).sort(),["actor_id","fingerprint","request_id","result_id"]);
  const audit = await scalar("select details v from public.office_events where task_id=$1 and kind='add_version'",[task_id]);
  assert.deepEqual(Object.keys(audit).sort(),["deliverable_id","version","version_id"]);
  let state = await snapshot();
  const previous = state.versions.find(v=>v.id===one.id);
  assert.equal(previous.version,1); assert.equal(previous.status,"pendiente");
  assert.equal(previous.file_size,Buffer.byteLength("Primera versión")); assert.ok(!("file_bytes" in previous));
  assert.equal(Buffer.from((await file(one.id)).base64,"base64").toString(),"Primera versión");
  const next = request("add_version",{ task_id,deliverable_id:previous.deliverable_id,base_version:1,title:"Pieza revisada",body:"Nueva versión" });
  const two = await apply(next);
  await assert.rejects(apply({ ...next,request_id:randomUUID() }),/OFFICE_CONFLICT/);
  await assert.rejects(apply(request("review_version",{ id:one.id,decision:"aprobado",note:"" })),/OFFICE_CONFLICT/);
  const review = request("review_version",{ id:two.id,decision:"cambios",note:"Revisar fecha" });
  await apply(review); await apply(review);
  await assert.rejects(apply({ ...review,request_id:randomUUID(),decision:"aprobado" }),/OFFICE_CONFLICT/);
  state = await snapshot();
  const decision = state.versions.find(v=>v.id===two.id);
  assert.equal(decision.status,"cambios"); assert.equal(decision.reviewed_by,actor); assert.equal(decision.review_note,"Revisar fecha");
  assert.equal(state.events.filter(e=>e.task_id===task_id && e.kind==="review_version").length,1);
  assert.equal(await file(two.id),null);
  assert.equal((await file(one.id)).name,"guion.txt");
  const three = await apply({ ...next,base_version:2,request_id:randomUUID() });
  await apply(request("review_version",{ id:three.id,decision:"aprobado",note:"Validado" }));
  const four = await apply({ ...next,base_version:3,request_id:randomUUID() });
  await apply(request("review_version",{ id:four.id,decision:"rechazado",note:"Nueva versión descartada" }));
  state = await snapshot();
  assert.equal(state.versions.find(v=>v.id===three.id).status,"aprobado");
  assert.equal(state.versions.find(v=>v.id===four.id).status,"rechazado");
});

test("non-admins cannot read records, mutate or download, including direct database access", async () => {
  const unknown = randomUUID();
  await assert.rejects(scalar("select public.office_snapshot($1) v",[unknown]),/OFFICE_FORBIDDEN/);
  await assert.rejects(apply(request("create_task",base),unknown),/OFFICE_FORBIDDEN/);
  await assert.rejects(file(randomUUID(),unknown),/OFFICE_FORBIDDEN/);
  for (const role of ["anon","authenticated"]) {
    await db.exec("reset role; set role " + role);
    await assert.rejects(snapshot(),/permission denied/);
    await assert.rejects(file(randomUUID()),/permission denied/);
    await assert.rejects(apply(request("create_task",base)),/permission denied/);
    await assert.rejects(db.query("select file_bytes from public.office_versions"),/permission denied/);
  }
  await db.exec("reset role; set role service_role");
});
