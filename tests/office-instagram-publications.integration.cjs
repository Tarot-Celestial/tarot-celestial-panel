const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID,createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

// All media, account identifiers and provider receipts in this file are synthetic.
const user=randomUUID(), actor=randomUUID(), promo=randomUUID(), pack=randomUUID();
const account="ig-professional",stored="ig-app-scoped",username="ejemplo_sintetico";
const hash=createHash("sha256").update("JPEG derivado sintético").digest("hex");
let db;
const scalar=async(sql,values=[]) => (await db.query(sql,values)).rows[0].v;
const rpc=(name,...args)=>scalar("select public."+name+"("+args.map((_,i)=>"$"+(i+1)).join(",")+") v",args);
const office=(action)=>rpc("office_apply",user,JSON.stringify({request_id:randomUUID(),...action}));
const post=(id)=>scalar("select to_jsonb(p) v from public.office_instagram_posts p where id=$1",[id]);
const claim=(id)=>rpc("office_ig_claim",id);
const transition=(id,lease,next,container=null,media=null,link=null,error=null)=>rpc("office_ig_transition",id,lease,next,container,media,link,error);
const attempt=async(id,options={})=>rpc("office_ig_approve",options.actor||user,id,options.request||randomUUID(),account,username,
  options.owner||user,options.caption||"Un texto aprobado","Imagen de prueba",options.digest||hash,options.when||null,"Europe/Madrid",stored,
  options.generation||await scalar("select connected_at::text v from public.tc_social_connections_v2 where provider='instagram'"));
async function newTask() {
  return (await office({action:"create_task",department_id:"marketing",objective:"Crear una pieza de prueba",expected_delivery:"Pieza para revisar",
    priority:"media",status:"pendiente",due_at:null,time_zone:"Europe/Madrid",assignee_worker_id:null,assignee_role:"atlas"})).id;
}
async function version(task,previous=null,type="image/png") {
  return (await office({action:"add_version",task_id:task,deliverable_id:previous?.deliverable_id||null,base_version:previous?.version||0,
    title:"Prueba interna",body:"Texto de la versión",file_name:type==="video/mp4"?"prueba.mp4":"prueba.png",file_type:type,
    file_base64:Buffer.from("Bytes sintéticos de prueba").toString("base64")})).id;
}
const versionInfo=id=>scalar("select to_jsonb(v)-'file_bytes' v from public.office_versions v where id=$1",[id]);
const expire=async(id)=>{
  await db.exec("reset role"); await db.query("update public.office_instagram_posts set lease_until=now()-interval '1 minute',next_attempt_at=now() where id=$1",[id]);
  await db.exec("set role service_role");
};

before(async()=>{
  db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.workers(id uuid primary key,user_id uuid,display_name text,is_active boolean);
    create table public.admin_grants(user_id uuid primary key);
    create function public.tc_has_admin_access(p_user_id uuid) returns boolean language sql stable as
      $$select exists(select 1 from public.admin_grants where user_id=p_user_id)$$;
    create table public.tc_social_connections_v2(provider text primary key,account_id text,username text,connected_by uuid,connected_at timestamptz not null);
    create table public.tc_client_promotions(id uuid primary key,name text,subtitle text,description text,status text,starts_at timestamptz,
      ends_at timestamptz,active_until_disabled boolean,updated_at timestamptz,promotion_kind text,authorized_rank text,max_uses_per_client integer,benefit_revision integer);
    create table public.tc_client_promotion_packages(id uuid primary key,promotion_id uuid references public.tc_client_promotions(id),name text,
      description text,price numeric,regular_price numeric,currency text,paid_minutes int,free_minutes int,extra_benefit text,is_active boolean,updated_at timestamptz);
    grant select on public.workers,public.admin_grants,public.tc_client_promotions,public.tc_client_promotion_packages,public.tc_social_connections_v2 to service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  await db.query("insert into public.workers values($1,$2,'Administración sintética',true)",[actor,user]);
  await db.query("insert into public.admin_grants values($1)",[user]);
  await db.query("insert into public.tc_social_connections_v2 values('instagram',$1,$2,null,now())",[stored,username]);
  await db.query("insert into public.tc_client_promotions(id,name,status,starts_at,active_until_disabled,promotion_kind,updated_at) values($1,'Oferta sintética','active',now()-interval '1 day',true,'standard',now())",[promo]);
  await db.query("insert into public.tc_client_promotion_packages(id,promotion_id,name,price,currency,paid_minutes,free_minutes,is_active,updated_at) values($1,$2,'Paquete',15,'EUR',20,5,true,now())",[pack,promo]);
  const migrations=path.join(__dirname,"../supabase/migrations");
  for(const name of fs.readdirSync(migrations).filter(n=>/^\d+_office_.*\.sql$/.test(n)).sort()) await db.exec(fs.readFileSync(path.join(migrations,name),"utf8"));
  await db.exec("set role service_role");
});
after(async()=>{if(db)await db.close();});

test("explicit approval binds owner, account, final bytes, caption, private version and schedule",async()=>{
  const t=await newTask(),v=await version(t),req=randomUUID(),when="2050-01-04T12:00:00Z";
  await assert.rejects(attempt(v,{when:"2000-01-01T00:00:00Z"}),/OFFICE_IG_SCHEDULE_PAST/);
  await assert.rejects(attempt(v,{caption:"Solo hoy 25 EUR"}),/OFFICE_IG_APPROVAL_INVALID/);
  assert.equal((await versionInfo(v)).status,"pendiente");
  const id=await attempt(v,{request:req,when});
  assert.equal(await attempt(v,{request:req,when}),id);
  await assert.rejects(attempt(v,{request:req,when,caption:"Texto cambiado"}),/OFFICE_CONFLICT/);
  await assert.rejects(attempt(v,{when}),/OFFICE_CONFLICT/);
  const row=await post(id);
  assert.equal(row.version_id,v);assert.equal(row.account_id,account);assert.equal(row.persisted_account_id,stored);
  assert.equal(row.connection_owner,user); assert.equal(row.media_sha256,hash); assert.notEqual(row.original_sha256,hash);
  assert.equal(row.media_type,"image/jpeg"); assert.equal((await versionInfo(v)).status,"aprobado");
  assert.equal(await claim(id),null);
  assert.equal(await scalar("select connected_by v from public.tc_social_connections_v2 where account_id=$1",[stored]),null);
  assert.equal(await scalar("select actor_user_id v from public.office_ig_connection_owners where account_id=$1",[stored]),user);
  assert.equal(await rpc("office_ig_cancel",user,id),true);
  await assert.rejects(attempt(v,{generation:"2020-01-01T00:00:00Z"}),/OFFICE_IG_CONNECTION_CHANGED/);
  assert.notEqual(await attempt(v),id);
});

test("a revised asset invalidates consent, and an obsolete/declined version or wrong connection cannot be approved",async()=>{
  const t=await newTask(),v=await version(t),id=await attempt(v),leased=await claim(id);
  const v2=await version(t,await versionInfo(v));
  assert.equal((await post(id)).status,"invalidated");
  assert.equal(await transition(id,leased.lease_token,"container_ready","container-old"),false);
  await assert.rejects(attempt(v),/OFFICE_CONFLICT/);
  await assert.rejects(attempt(v2,{owner:"another-owner"}),/OFFICE_IG_CONNECTION_CHANGED/);
  assert.equal((await versionInfo(v2)).status,"pendiente");
  await office({action:"review_version",id:v2,decision:"rechazado",note:"Prueba"});
  await assert.rejects(attempt(v2),/OFFICE_CONFLICT/);
});

test("dispatch is single-use; expired leases verify only; a late media ID, permalink and metrics are retained",async()=>{
  const t=await newTask(),v=await version(t),id=await attempt(v);
  const peers=await Promise.all([claim(id),claim(id)]),job=peers.find(Boolean);assert.equal(peers.filter(Boolean).length,1);
  assert.equal(await transition(id,randomUUID(),"container_ready","container-1"),false);
  assert.equal(await transition(id,job.lease_token,"container_ready","container-1"),true);
  assert.equal(await transition(id,job.lease_token,"defer"),true);
  assert.equal(await claim(id),null);await expire(id);
  const ready=await claim(id); assert.equal(ready.status,"container_ready"); assert.equal(ready.container_id,"container-1");
  assert.equal(await transition(id,ready.lease_token,"dispatching"),true);
  assert.equal(await transition(id,ready.lease_token,"dispatching"),false);
  await assert.rejects(rpc("office_ig_cancel",user,id),/OFFICE_CONFLICT/);await expire(id);
  const verify=await claim(id);assert.equal(verify.status,"verifying");
  assert.equal(await transition(id,verify.lease_token,"dispatching"),false);
  assert.equal(await transition(id,ready.lease_token,"receipt",null,"media-1"),true);
  assert.equal((await post(id)).external_post_id,"media-1");
  assert.equal(await transition(id,verify.lease_token,"published",null,"other-media"),false);
  assert.equal(await transition(id,verify.lease_token,"published",null,"media-1"),true);
  assert.equal((await post(id)).permalink,null);
  assert.equal(await rpc("office_ig_metrics",id,"media-1",JSON.stringify({day:"2026-11-22",reach:null,likes:0}),"https://www.instagram.com/p/Example1/"),true);
  const complete=await post(id);assert.equal(complete.status,"published");assert.equal(complete.metrics.likes,0);assert.equal(complete.metrics.reach,null);
  assert.equal(await rpc("office_ig_metrics",id,"wrong",JSON.stringify({likes:100}),null),false);
  await assert.rejects(attempt(v),/OFFICE_CONFLICT/);
});

test("a provider-observed publication only reconciles; a definitive rejection permits a fresh approval",async()=>{
  const v=await version(await newTask()),id=await attempt(v),j=await claim(id);
  await transition(id,j.lease_token,"container_ready","externally-confirmed");
  assert.equal(await transition(id,j.lease_token,"observed_published"),true);
  const verify=await claim(id);assert.equal(verify.status,"verifying");
  assert.equal(await transition(id,verify.lease_token,"dispatching"),false);
  await assert.rejects(attempt(v),/OFFICE_CONFLICT/);
  const w=await version(await newTask()),failed=await attempt(w),dispatch=await claim(failed);
  await transition(failed,dispatch.lease_token,"container_ready","rejected-container");
  await transition(failed,dispatch.lease_token,"dispatching");
  assert.equal(await transition(failed,dispatch.lease_token,"provider_rejected"),false);
  assert.equal(await transition(failed,dispatch.lease_token,"provider_rejected",null,null,null,"Meta rechazó expresamente el permiso."),true);
  assert.ok((await post(failed)).provider_rejected_at); assert.notEqual(await attempt(w),failed);
});

test("connection generations and commercial authorization are rechecked immediately before dispatch",async()=>{
  const t=await newTask(),v1=await version(t);
  await rpc("office_promotion_scope_set",user,promo,"es","EUR","instagram",true);
  const fingerprint=await rpc("office_promotion_fingerprint",promo,"EUR");
  const source={promotion_id:promo,market:"es",currency:"EUR",channel:"instagram",offer:{source_fingerprint:fingerprint}};
  await db.query(`insert into public.office_runs(task_id,task_revision,actor_id,actor_user_id,request_id,status,task_snapshot,result_version_id,source_snapshot)
    values($1,1,$2,$3,$4,'review','{}',$5,$6)`,[t,actor,user,randomUUID(),v1,JSON.stringify(source)]);
  const v2=await version(t,await versionInfo(v1));
  assert.deepEqual(await rpc("office_ig_source",v2),source);
  const id=await attempt(v2),job=await claim(id);assert.equal(await transition(id,job.lease_token,"container_ready","offer-container"),true);
  await db.exec("reset role; update public.tc_client_promotion_packages set price=21; set role service_role");
  await rpc("office_promotion_scope_set",user,promo,"es","EUR","instagram",true);
  assert.equal(await transition(id,job.lease_token,"dispatching"),false);assert.equal((await post(id)).status,"invalidated");
  const movie=await version(await newTask(),null,"video/mp4"),videoId=await attempt(movie),video=await claim(videoId);
  assert.equal(video.media_type,"video/mp4");
  await transition(videoId,video.lease_token,"container_ready","reel-container");
  await db.exec("reset role; update public.tc_social_connections_v2 set connected_at=now(); set role service_role");
  assert.equal(await transition(videoId,video.lease_token,"dispatching"),false);assert.equal((await post(videoId)).status,"invalidated");
});

test("neither browser role can read private publication rows or call publisher RPCs",async()=>{
  for(const role of ["anon","authenticated"]) {
    await db.exec("reset role; set role "+role);
    await assert.rejects(claim(null),/permission denied/);
    await assert.rejects(rpc("office_ig_source",randomUUID()),/permission denied/);
    await assert.rejects(db.query("select * from public.office_instagram_posts"),/permission denied/);
  }
  await db.exec("reset role; set role service_role");
  assert.equal(await scalar("select has_table_privilege('service_role','public.office_instagram_posts','TRUNCATE') v"),false);
  assert.equal(await scalar("select has_column_privilege('service_role','public.office_instagram_posts','caption','UPDATE') v"),false);
});
