const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

const user = randomUUID(), actor = randomUUID(), promo = randomUUID(), pack = randomUUID();
let db;
const historical = [];
const scalar = async (sql,args=[]) => (await db.query(sql,args)).rows[0].v;
const rpc = (name,...args) => scalar("select public."+name+"("+args.map((_,i)=>"$"+(i+1)).join(",")+") v",args);
const office = (body) => rpc("office_apply",user,JSON.stringify({ request_id:randomUUID(),...body }));
const task = async () => (await office({ action:"create_task",department_id:"marketing",objective:"Preparar campaña de prueba",
  expected_delivery:"Borrador revisable",priority:"media",status:"pendiente",due_at:null,time_zone:"Europe/Madrid",
  assignee_worker_id:null,assignee_role:"atlas" })).id;
const enqueue = (id,request=randomUUID(),revision=null) => rpc("office_run_enqueue",user,id,request,revision);
const claim = (id) => rpc("office_run_claim",id);
const finish = (job,status="ok",output={},usage={},delivery=null) => rpc("office_run_finish_step",job.id,job.lease_token,
  status,JSON.stringify(output),JSON.stringify(usage),null,delivery && JSON.stringify(delivery));
const state = (id) => scalar("select to_jsonb(r) v from public.office_runs r where id=$1",[id]);
const scope = (currency="EUR") => rpc("office_promotion_scope_live",promo,"España",currency,"instagram");
const setScope = (enabled=true) => rpc("office_promotion_scope_set",user,promo," España ","eur","Instagram",enabled);
const approvedOffer = async () => ({
  promotion_id:promo,currency:"EUR",market:"españa",channel:"instagram",
  offer:{ source_fingerprint:await rpc("office_promotion_fingerprint",promo,"EUR") },
});
const brand = { sources:["manual de marca sintético"],promotion_id:null };
const deliverable = { title:"Pieza de prueba",body:"Texto comprobado",file_name:"guion.txt",file_type:"text/plain",
  file_base64:Buffer.from("Entrega privada").toString("base64") };
const migrations = ["20261122191931_office_celestial_workspace.sql","20261122195239_office_campaign_runs.sql","20261122195721_office_run_reconciliation.sql"];

async function migrateDeliveryStatus() {
  for (const [label,taskStatus,taskRevision,latestStatus] of [
    ["entrega original","pendiente",1,null], ["edición editorial","en_curso",1,"pendiente"],
    ["v2 ya aprobada","pendiente",1,"aprobado"], ["edición manual del encargo","pendiente",2,null],
    ["cancelado","cancelado",1,null], ["completado","completado",1,null],
  ]) {
    const taskId=randomUUID(), series=randomUUID(), v1=randomUUID(), runId=randomUUID(), newest=latestStatus ? randomUUID() : v1;
    await db.query(`insert into public.office_tasks(id,department_id,objective,expected_delivery,priority,status,time_zone,created_by,revision,updated_at)
      values($1,'marketing','Prueba sintética','Borrador','media',$2,'Europe/Madrid',$3,$4,'2026-01-01')`,[taskId,taskStatus,actor,taskRevision]);
    await db.query(`insert into public.office_versions(id,task_id,deliverable_id,version,title,body,status,created_by)
      values($1,$2,$3,1,'Entrega sintética','Texto',$4,$5)`,[v1,taskId,series,latestStatus ? "cambios" : "pendiente",actor]);
    if (latestStatus) await db.query(`insert into public.office_versions(id,task_id,deliverable_id,version,title,body,status,created_by)
      values($1,$2,$3,2,'Edición','Nuevo texto',$4,$5)`,[newest,taskId,series,latestStatus,actor]);
    await db.query(`insert into public.office_runs(id,task_id,task_revision,actor_id,actor_user_id,request_id,status,task_snapshot,result_version_id)
      values($1,$2,1,$3,$4,$5,'review','{}',$6)`,[runId,taskId,actor,user,randomUUID(),v1]);
    historical.push({ label,taskId,taskStatus,taskRevision,latestStatus,v1,newest });
  }
  const dir=path.join(__dirname,"../supabase/migrations");
  const matching=fs.readdirSync(dir).filter(name=>/^\d+_office_tasks_delivery_review\.sql$/.test(name));
  assert.equal(matching.length,1);
  await db.exec(fs.readFileSync(path.join(dir,matching[0]),"utf8"));
}

before(async () => {
  db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.workers(id uuid primary key,user_id uuid,display_name text,is_active boolean);
    create table public.admin_grants(user_id uuid primary key);
    create function public.tc_has_admin_access(p_user_id uuid) returns boolean language sql stable as
      $$select exists(select 1 from public.admin_grants where user_id=p_user_id)$$;
    create table public.tc_client_promotions(id uuid primary key,name text,subtitle text,description text,status text,starts_at timestamptz,
      ends_at timestamptz,active_until_disabled boolean,updated_at timestamptz,promotion_kind text,authorized_rank text,max_uses_per_client integer,benefit_revision integer);
    create table public.tc_client_promotion_packages(id uuid primary key,promotion_id uuid references public.tc_client_promotions(id),name text,
      description text,price numeric,regular_price numeric,currency text,paid_minutes int,free_minutes int,extra_benefit text,is_active boolean,updated_at timestamptz);
    grant select on public.workers,public.admin_grants,public.tc_client_promotions,public.tc_client_promotion_packages to service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  await db.query("insert into public.workers values($1,$2,'Administrador sintético',true)",[actor,user]);
  await db.query("insert into public.admin_grants values($1)",[user]);
  await db.query("insert into public.tc_client_promotions(id,name,status,active_until_disabled,updated_at,promotion_kind) values($1,'Promo de prueba','active',true,now(),'standard')",[promo]);
  await db.query("insert into public.tc_client_promotion_packages(id,promotion_id,name,price,currency,paid_minutes,free_minutes,is_active,updated_at) values($1,$2,'Paquete de prueba',15,'EUR',20,5,true,now())",[pack,promo]);
  for (const file of migrations) await db.exec(fs.readFileSync(path.join(__dirname,"../supabase/migrations",file),"utf8"));
  await migrateDeliveryStatus();
  await db.exec("set role service_role");
});
after(async()=>{ if(db) await db.close(); });

test("historical delivery backfill uses the current pending version and preserves manual changes and terminal tasks",async () => {
  for (const x of historical) {
    const expected=x.taskRevision===1 && ["pendiente","en_curso"].includes(x.taskStatus) && x.latestStatus!=="aprobado";
    const t=(await db.query("select status,revision,updated_at>'2026-01-01' as touched from public.office_tasks where id=$1",[x.taskId])).rows[0];
    assert.deepEqual(t,{status:expected ? "en_revision" : x.taskStatus,revision:x.taskRevision+Number(expected),touched:expected},x.label);
    const events=(await db.query("select details from public.office_events where task_id=$1 and kind='task_review_requested'",[x.taskId])).rows;
    assert.equal(events.length,Number(expected),x.label);
    if (expected) { assert.equal(events[0].details.version_id,x.newest); assert.equal(events[0].details.run_version_id,x.v1); }
  }
});

test("market approval is explicit, currency-specific and is invalidated by a price edit or expiry",async () => {
  assert.equal(await scope(),false); assert.equal(await setScope(),true); assert.equal(await scope(),true);
  assert.equal(await scope("USD"),false);
  await assert.rejects(rpc("office_promotion_scope_set",user,promo,"España","USD","instagram",true),/OFFICE_OFFER_UNAVAILABLE/);
  await db.exec("reset role; update public.tc_client_promotion_packages set price=16; set role service_role");
  assert.equal(await scope(),false); await setScope();
  await db.exec("reset role; update public.tc_client_promotions set active_until_disabled=false,ends_at=now()-interval '1 day'; set role service_role");
  assert.equal(await scope(),false);
  await db.exec("reset role; update public.tc_client_promotions set active_until_disabled=true,ends_at=null; set role service_role");
  await setScope(false);
});

test("leased stages persist evidence, usage, one private deliverable and a requested correction",async () => {
  await setScope();
  const offer=await approvedOffer();
  const taskId=await task(),request=randomUUID(),id=await enqueue(taskId,request);
  assert.equal(await enqueue(taskId,request),id);
  await assert.rejects(enqueue(taskId),/OFFICE_RUN_ACTIVE/);
  const first=await claim(id);
  assert.equal(first.step,0); assert.equal(first.actor_id,actor); assert.equal(await claim(id),null);
  assert.equal(await finish({ ...first,lease_token:randomUUID() }),null);
  const out={ source_snapshot:offer,brief:"Objetivo y fuentes" };
  const use={ input_tokens:35,output_tokens:20,estimated_cost_usd:0.002 };
  const done=await finish(first,"ok",out,use);
  assert.deepEqual(await finish(first,"ok",out,use),done);
  const second=await claim(id);
  assert.deepEqual(second.outputs["0"],out); assert.deepEqual(second.source_snapshot,offer);
  await finish(second,"ok",{ copy:"Texto comercial" },{ input_tokens:22,output_tokens:18 });
  const third=await claim(id);
  const result=await finish(third,"ok",{ asset:"Pieza privada" },{},deliverable);
  assert.equal(result.status,"review"); assert.ok(result.result_version_id);
  assert.deepEqual((await db.query("select status,revision from public.office_tasks where id=$1",[taskId])).rows[0],{status:"en_revision",revision:2});
  assert.deepEqual(await finish(third,"ok",{}, {},deliverable),result);
  assert.equal(await scalar("select count(*)::int v from public.office_versions where task_id=$1",[taskId]),1);
  const row=await state(id);
  assert.equal(row.usage.input_tokens,57); assert.equal(row.usage.output_tokens,38);
  assert.equal(row.usage.claims,3); assert.equal(row.usage.estimated_cost_usd,0.002); assert.ok(!("cost_usd" in row.usage));
  await assert.rejects(enqueue(taskId),/OFFICE_RUN_ALREADY_DELIVERED/);
  await assert.rejects(enqueue(taskId,randomUUID(),result.result_version_id),/OFFICE_CONFLICT/);
  await office({ action:"review_version",id:result.result_version_id,decision:"cambios",note:"Ajustar imagen" });
  const id2=await enqueue(taskId,randomUUID(),result.result_version_id);
  await finish(await claim(id2),"ok",out);
  await finish(await claim(id2),"ok",{ copy:"Texto revisado" });
  const corrected=await finish(await claim(id2),"ok",{ asset:"Pieza revisada" },{},deliverable);
  assert.equal(corrected.status,"review");
  const versions=(await db.query("select deliverable_id,version,status from public.office_versions where task_id=$1 order by version",[taskId])).rows;
  assert.equal(versions[0].deliverable_id,versions[1].deliverable_id); assert.equal(versions[1].version,2);
  assert.equal(versions[0].status,"cambios"); assert.equal(versions[1].status,"pendiente");
  assert.equal(await scalar("select count(*)::int v from public.office_events where task_id=$1 and kind='task_review_requested'",[taskId]),1);
  await assert.rejects(enqueue(taskId,randomUUID(),result.result_version_id),/OFFICE_CONFLICT/);
});

test("claims for overlapping requests stay isolated and cancelled in-flight work keeps its concurrency slot",async () => {
  const a=await enqueue(await task()), b=await enqueue(await task()), c=await enqueue(await task());
  const candidates=await Promise.all([claim(a),claim(a)]);
  assert.equal(candidates.filter(Boolean).length,1);
  const first=candidates.find(Boolean),second=await claim(b);
  assert.equal(await claim(c),null);
  assert.equal(await finish({ ...first,lease_token:second.lease_token }),null);
  await rpc("office_run_cancel",user,a);
  assert.equal(await claim(c),null);
  assert.equal((await finish(first,"ok",{source_snapshot:brand})).status,"cancelled");
  const third=await claim(c);
  assert.ok(third);
  await finish(second,"waiting_input");
  await finish(third,"waiting_input");
});

test("blocked, cancelled, expired and over-budget executions never emit a draft",async () => {
  const taskId=await task(),waiting=await enqueue(taskId);
  assert.equal((await finish(await claim(waiting),"waiting_connection")).status,"waiting_connection");
  const retry=await enqueue(taskId),working=await claim(retry);
  await rpc("office_run_cancel",user,retry);
  assert.equal((await finish(working,"ok",{ source_snapshot:brand },{ input_tokens:12 })).status,"cancelled");
  assert.equal((await state(retry)).usage.input_tokens,12);
  const limited=await enqueue(taskId);
  assert.equal((await finish(await claim(limited),"ok",{source_snapshot:brand},{cost_usd:0.11})).status,"limit_reached");
  const unresolved=await enqueue(taskId),lost=await claim(unresolved);
  await db.exec("reset role");
  await db.query("update public.office_runs set lease_until=now()-interval '1 minute' where id=$1",[unresolved]);
  await db.exec("set role service_role");
  assert.equal(await claim(unresolved),null); assert.equal((await state(unresolved)).status,"needs_reconciliation");
  await assert.rejects(enqueue(taskId),/OFFICE_RUN_ACTIVE/);
  assert.equal((await finish(lost,"ok",{source_snapshot:brand})).status,"needs_reconciliation");
  assert.equal(await scalar("select count(*)::int v from public.office_versions where task_id=$1",[taskId]),0);
});

test("manual reconciliation needs an admin and note, fences pending callbacks, preserves receipts and never enqueues",async () => {
  const taskId=await task(), id=await enqueue(taskId), first=await claim(id);
  const note="Se revisó la actividad del proveedor y se cerró el intento de prueba.";
  const resolve=(run,reason=note,who=user)=>rpc("office_run_resolve",who,run,reason);
  await assert.rejects(resolve(id),/OFFICE_CONFLICT/);
  const reported=await finish(first,"needs_reconciliation",{},{input_tokens:19,output_tokens:8});
  const attemptBefore=await scalar("select to_jsonb(a) v from public.office_run_attempts a where lease_token=$1",[first.lease_token]);
  await assert.rejects(resolve(id,note,randomUUID()),/OFFICE_FORBIDDEN/);
  await assert.rejects(resolve(id," "),/OFFICE_INVALID/);
  assert.equal(await resolve(id),true); assert.equal(await resolve(id),true);
  assert.equal((await state(id)).usage.input_tokens,19);
  assert.deepEqual(await finish(first,"ok",{source_snapshot:brand}),reported);
  assert.deepEqual(await scalar("select to_jsonb(a) v from public.office_run_attempts a where lease_token=$1",[first.lease_token]),attemptBefore);
  assert.equal(await scalar("select count(*)::int v from public.office_events where task_id=$1 and kind='campaign_reconciled'",[taskId]),1);
  assert.equal(await scalar("select count(*)::int v from public.office_runs where task_id=$1",[taskId]),1);
  const retry=await enqueue(taskId),lost=await claim(retry);
  // Exercise the expired-lease path with a truly unconfirmed attempt.
  await db.exec("reset role");
  await db.query("update public.office_runs set status='needs_reconciliation' where id=$1",[retry]);
  await db.exec("set role service_role"); await assert.rejects(resolve(retry),/OFFICE_CONFLICT/);
  await db.exec("reset role"); await db.query("update public.office_runs set lease_until=now()-interval '1 second' where id=$1",[retry]);
  await db.exec("set role service_role"); assert.equal(await resolve(retry),true);
  assert.equal((await finish(lost,"ok",{source_snapshot:brand})).status,"cancelled");
  assert.equal(await scalar("select count(*)::int v from public.office_versions where task_id=$1",[taskId]),0);
});

test("a source withdrawn after briefing, revoked admin and exhausted daily allowance stop processing",async () => {
  await setScope(); const id=await enqueue(await task());
  const offer=await approvedOffer();
  await finish(await claim(id),"ok",{source_snapshot:offer}); await setScope(false);
  assert.equal((await finish(await claim(id),"ok",{copy:"Texto"})).status,"waiting_input");
  await setScope(); const changed=await enqueue(await task());
  await finish(await claim(changed),"ok",{source_snapshot:await approvedOffer()});
  await db.exec("reset role; update public.tc_client_promotion_packages set price=18; set role service_role");
  await setScope();
  assert.equal((await finish(await claim(changed),"ok",{copy:"Texto con precio antiguo"})).status,"waiting_input");
  const revoked=await enqueue(await task());
  const inFlight=await claim(await enqueue(await task()));
  await db.exec("reset role; delete from public.admin_grants; set role service_role");
  assert.equal(await claim(revoked),null); assert.equal((await state(revoked)).status,"failed");
  assert.equal((await finish(inFlight,"ok",{source_snapshot:brand})).status,"failed");
  await db.exec("reset role"); await db.query("insert into public.admin_grants values($1)",[user]);
  await db.exec("set role service_role");
  const expensive=await enqueue(await task()),attempt=await claim(expensive);
  assert.equal((await finish(attempt,"ok",{source_snapshot:brand},{cost_usd:2.40})).status,"limit_reached");
  const capped=await enqueue(await task());
  assert.equal(await claim(capped),null); assert.equal((await state(capped)).status,"limit_reached");
  assert.equal(await scalar("select count(*)::int v from public.office_run_attempts where run_id=$1",[capped]),0);
});

test("browser roles cannot operate runs or approve markets through the Data API",async () => {
  for(const role of ["anon","authenticated"]) {
    await db.exec("reset role; set role "+role);
    await assert.rejects(claim(null),/permission denied/);
    await assert.rejects(setScope(),/permission denied/);
    await assert.rejects(rpc("office_run_resolve",user,randomUUID(),"Revisión manual"),/permission denied/);
    await assert.rejects(db.query("select * from public.office_runs"),/permission denied/);
  }
  await db.exec("reset role; set role service_role");
  await assert.rejects(rpc("office_run_enqueue",randomUUID(),randomUUID(),randomUUID(),null),/OFFICE_FORBIDDEN/);
  assert.equal(await scalar("select has_table_privilege('service_role','public.office_runs','TRUNCATE') v"),false);
});
