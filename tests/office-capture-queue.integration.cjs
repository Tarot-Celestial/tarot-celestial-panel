const {test,before,after,beforeEach} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const {PGlite} = require("@electric-sql/pglite");
let db;
const id = n => "60000000-0000-4000-8000-"+String(n).padStart(12,"0");
const peer="34600111222@s.whatsapp.net", account="34600333444@s.whatsapp.net", thread=id(5);
const at = offset => new Date(Date.now()+offset).toISOString();
const q = async (query,params=[]) => (await db.query(query,params)).rows;
const scalar = async (query,params=[]) => Object.values((await q(query,params))[0])[0];
const wa = (items) => scalar("select office_capture_record_whatsapp($1,'central',$2)",[account,JSON.stringify(items)]);
const row = (key,time,more={}) => ({thread_key:peer,source_id:key,source_at:time,body:"Quiero una lectura de tarot",name:"Fixture",business_interest:true,...more});
const claim = ()=>scalar("select office_capture_claim()");
const begin = job=>scalar("select office_capture_begin($1,$2,'Fixture','phone')",[job.id,job.lease_token]);
const deliver = job=>scalar("select office_capture_finish($1,$2,'sent','DELIVERY',null)",[job.id,job.lease_token]);
const discover = ()=>scalar("select office_capture_discover()");
before(async()=>{
 db=new PGlite();
 await db.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;
 create table public.crm_clientes(id uuid primary key,nombre text,pais text,origen text);
 create table public.captacion_leads(id uuid primary key,cliente_id uuid,origen text,estado text,contacted_at timestamptz,last_contact_at timestamptz,closed_at timestamptz);
 create table public.office_crm_purchase_evidence(client_id uuid,at timestamptz,recorded_at timestamptz);
 create function public.tc_crm_first_purchases_batch(uuid[]) returns table(client_id uuid) language sql as $$ select p.client_id from public.office_crm_purchase_evidence p where p.client_id=any($1) and p.at<=now() and p.recorded_at<=now() $$;
 create table tc_social_connections_v2(provider text,account_id text);
 create table tc_instagram_threads(id uuid primary key,kind text,account_id text,recipient_id text,remote_id text,name text,remote_created_at timestamptz,remote_updated_at timestamptz,last_reply_at timestamptz,private_reply_sent boolean default false,merged_into uuid);
 create table tc_facebook_threads(like tc_instagram_threads,is_deleted boolean default false);
 create table tc_instagram_sends(request_id uuid,thread_id uuid,status text);
 create table tc_facebook_sends(like tc_instagram_sends);
 create table tc_social_inbox_activity(id bigint generated always as identity,provider text,account_id text,kind text,remote_id text,thread_remote_id text,occurred_at timestamptz,removed_at timestamptz);
 create table meta_lead_events(leadgen_id text,page_id text,form_id text,captacion_lead_id uuid,cliente_id uuid,meta_created_at timestamptz,status text,payload jsonb);
 create table captacion_whatsapp_deliveries(lead_id uuid,submission_key text);
 create table workers(id uuid,user_id uuid,is_active boolean);
 create table office_capture_settings(id boolean primary key,enabled boolean,actor_user_id uuid);
 create function tc_has_admin_access(uuid) returns boolean language sql as $$ select exists(select from public.workers where user_id=$1 and is_active) $$;
 grant select on all tables in schema public to service_role;`);
 const directory=path.join(__dirname,"../supabase/migrations");
 await db.exec(fs.readFileSync(path.join(directory,fs.readdirSync(directory).find(f=>f.endsWith("_office_capture_opportunities.sql"))),"utf8"));
 await q("insert into workers values($1,$2,true),($3,$4,true)",[id(1),id(2),id(3),id(4)]);
 await q("insert into office_capture_settings values(true,true,$1)",[id(2)]);
});
after(async()=>db?.close());
beforeEach(async()=>{
 await db.exec("truncate office_capture_inbound,office_capture_events,office_capture_suppressions,office_capture_attempts,office_capture_opportunities,tc_social_inbox_activity,tc_instagram_sends,tc_instagram_threads,tc_facebook_threads,tc_social_connections_v2,office_crm_purchase_evidence,meta_lead_events,captacion_whatsapp_deliveries,crm_clientes,captacion_leads cascade");
 await q("update office_capture_settings set enabled=true,actor_user_id=$1",[id(2)]);
});
test("leases are retryable only before dispatch; a receipt and newer input are reconciled exactly once",async()=>{
 const time=at(-10000), next=at(-5000);
 await wa([row("FIRST",time)]);await wa([row("FIRST",time)]);
 const a=await claim();assert.equal(a.source_id,"FIRST");assert.equal(await claim(),null);
 await q("update office_capture_opportunities set lease_until=now()-interval '1 second'");
 await discover();
 const b=await claim();assert.equal(b.request_id,a.request_id);assert.notEqual(b.lease_token,a.lease_token);
 assert.equal(await begin(a),null);assert.ok(await begin(b));assert.equal(await begin(b),null);
 await wa([row("NEXT",next,{business_interest:false,body:"Puerto Rico"})]);
 await q("update office_capture_opportunities set lease_until=now()-interval '1 second'");
 await discover();assert.equal(await claim(),null);assert.equal(await scalar("select status from office_capture_opportunities"),"uncertain");
 assert.equal(await deliver(b),true);assert.equal(await deliver(b),true);
 await discover();const c=await claim();assert.equal(c.source_id,"NEXT");assert.notEqual(c.request_id,a.request_id);
 assert.equal(await scalar("select count(*)::int from office_capture_events where action='discovered'"),1);
 assert.equal(await scalar("select count(*)::int from office_capture_inbound"),2);
});
test("durable opt-out is discovered even after expiry or with dispatch disabled; unrelated chats and groups stay private",async()=>{
 await wa([row("GROUP",at(-10000),{thread_key:"123@g.us"}),row("PRIVATE",at(-10000),{body:"hola",business_interest:false}),
   row("SELF",at(-10000),{thread_key:account})]);
 assert.equal(await scalar("select count(*)::int from office_capture_opportunities"),0);
 await q("update office_capture_settings set enabled=false");
 await wa([row("INTENT",at(-5*86400000)),row("STOP",at(-4*86400000),{body:"No me escriban más",business_interest:false})]);
 assert.equal(await scalar("select status from office_capture_opportunities"),"opted_out");
 await wa([row("NEW",at(-1000))]);assert.equal(await claim(),null);
 assert.equal(await scalar("select count(*)::int from office_capture_suppressions"),1);
});
test("account ownership, human receipt and first purchase are validated again before dispatch",async()=>{
 await wa([row("FIRST",at(-3000))]);let job=await claim();
 await q("update office_capture_settings set actor_user_id=$1",[id(4)]);assert.equal(await begin(job),null);
 job=await claim();assert.equal(job.actor_user_id,id(4));
 await q("insert into crm_clientes(id) values($1)",[id(8)]);
 await q("update office_capture_opportunities set client_id=$1",[id(8)]);
 await q("insert into office_crm_purchase_evidence values($1,now(),now())",[id(8)]);
 assert.equal(await begin(job),null);assert.equal(await scalar("select status from office_capture_opportunities"),"purchased");
 await wa([row("OTHER",at(-1000),{thread_key:"34600444555@s.whatsapp.net",last_own_id:"staff-message"})]);
 assert.equal(await scalar("select status from office_capture_opportunities where source_id='OTHER'"),"handoff");assert.equal(await claim(),null);
});
test("a real native event hydrates private identity; old previews cannot start messages or create fake evidence",async()=>{
 await q("insert into tc_instagram_threads(id,account_id,kind,remote_id,recipient_id,name,remote_updated_at) values($1,'IG','message','conversation','peer','Fixture',now()-interval '8 days')",[thread]);
 await q("insert into tc_social_connections_v2 values('instagram','IG')");
 await discover();assert.equal(await claim(),null);assert.equal(await scalar("select status from office_capture_opportunities"),"expired");
 assert.equal(await scalar("select count(*)::int from office_capture_inbound"),0);
 await q("insert into tc_social_inbox_activity(provider,account_id,kind,remote_id,thread_remote_id,occurred_at) values('instagram','IG','message','msg','peer',now()-interval '1 hour')");
 const body=JSON.stringify([{kind:"message",source_id:"msg",thread_key:"peer",body:"Fixture exact input"}]);
 assert.equal(await scalar("select office_capture_record_social('instagram','OTHER',$1)",[body]),0);
 await discover();assert.equal(await scalar("select office_capture_record_social('instagram','IG',$1)",[body]),1);
 assert.equal(await scalar("select recipient_id from office_capture_inbound"),"peer");
 assert.equal(await scalar("select inbound_text from office_capture_inbound"),"Fixture exact input");
 const job=await claim();assert.equal(job.verified,true);assert.equal(job.source_id,"msg");
 await q("insert into tc_instagram_sends values($1,$2,'sent')",[id(7),thread]);assert.equal(await begin(job),null);
 assert.equal(await scalar("select last_error from office_capture_opportunities"),"human_takeover");
});
test("form submission requires explicit WhatsApp permission on the matching CRM lead; later purchase terminates the flow",async()=>{
 for (const n of [8,9]) {
   await q("insert into crm_clientes values($1,'Fixture','ES','meta')",[id(n)]);
   await q("insert into captacion_leads(id,cliente_id,estado) values($1,$2,'nuevo')",[id(n+20),id(n)]);
   await q("insert into meta_lead_events values($1,'FB','FORM',$2,$3,now()-interval '1 hour','processed',$4)",
     ["lead"+n,id(n+20),id(n),{lead:{field_data:[{name:n===8?"consent_whatsapp":"phone_number",values:["sí"]}]}}]);
 }
 await discover();const job=await claim();assert.equal(job.client_id,id(8));assert.equal(job.submission_key,"meta:lead8");
 assert.equal(await scalar("select last_error from office_capture_opportunities where client_id=$1",[id(9)]),"whatsapp_consent_missing");
 await q("insert into captacion_whatsapp_deliveries values($1,'meta:lead8')",[id(28)]);
 assert.equal(await begin(job),null);assert.equal(await claim(),null);
 const priv=await q("select has_function_privilege('authenticated','public.office_capture_claim()','EXECUTE') f,has_table_privilege('anon','office_capture_inbound','SELECT') t");
 assert.deepEqual(priv[0],{f:false,t:false});
});
