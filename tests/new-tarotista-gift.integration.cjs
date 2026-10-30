const { test, before, after } = require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8');
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
let db,seq=100,legacyDefinitions,legacyDiamondDefinition;
const legacyClients=[];
const scalar=async(q,p=[]) => (await db.query(q,p)).rows[0].v;
const preview=c=>scalar('select tc_new_tarotista_gift_preview($1) v',[c]);
const balance=c=>scalar('select jsonb_build_array(minutos_free_pendientes,minutos_normales_pendientes) v from crm_clientes where id=$1',[c]);
async function client(rank='plata',free=0){
 const c=id(seq++);
 await db.query("insert into crm_clientes(id,nombre,apellido,minutos_free_pendientes,minutos_normales_pendientes) values($1,'Test','Client',$2,37)",[c,free]);
 if(rank)await db.query("insert into crm_cliente_pagos(cliente_id,importe,estado) values($1,$2,'completed')",[c,{bronce:10,plata:100,oro:500,diamante:1000}[rank]]);
 return c;
}
async function hire(active=true){
 const w=id(seq++);
 await db.query("insert into workers(id,user_id,role,is_active,display_name,email,created_at) values($1,$2,'tarotista',$3,'Test New Tarotist','test@example.invalid',clock_timestamp())",[w,id(seq++),active]);
 return w;
}
const request=(c,rank='plata',tarotista=id(2),op=id(seq++))=>({
 operation_id:op,cliente_id:c,tarotista_worker_id:tarotista,rank_free_expected_rank:rank,
 rank_free_expected_minutes:{plata:10,oro:12,diamante:15}[rank],rank_free_eligibility_key:tarotista
});
const call=(p,user=id(11))=>scalar('select tc_register_new_tarotista_gift($1,$2::jsonb) v',[user,JSON.stringify(p)]);
before(async()=>{
 db=new PGlite();
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;");
 await db.exec(read('fixtures/purchase-reward-schema.sql'));
 await db.exec(`
 create table workers(id uuid primary key,user_id uuid,role text,is_active boolean,display_name text,email text,created_at timestamptz default now());
 create table crm_clientes(id uuid primary key,nombre text,apellido text,minutos_free_pendientes numeric default 0,minutos_normales_pendientes numeric default 0,puntos numeric default 0,updated_at timestamptz);
 create table client_rank_overrides(id uuid primary key default gen_random_uuid(),client_id uuid,assigned_rank text,active boolean,starts_at timestamptz,ends_at timestamptz,created_at timestamptz default now(),intervention_type text,reason text,notes text);
 create table crm_call_operations(operation_id uuid primary key,cliente_id uuid,worker_id uuid,request jsonb,result jsonb,created_at timestamptz default now());
 create table crm_client_notes(cliente_id text,texto text,author_user_id uuid,author_name text,author_email text,is_pinned boolean,created_at timestamptz default now(),event_type text,event_data jsonb);
 create table tc_diamond_tarotista_announcements(worker_id uuid primary key,announced_at timestamptz default now());
 create table cliente_notificaciones(cliente_id uuid,tipo text,titulo text,mensaje text,meta jsonb,leida boolean,created_at timestamptz);
 create table signal_calls(cliente_id uuid);
 create table worker_xp_events(id uuid primary key default gen_random_uuid(),worker_id uuid,action_key text,reference_id text,status text,created_at timestamptz default now());
 create table crm_client_capture_assignments(client_id uuid primary key,business text,created_by_worker_id uuid,candidate_worker_id uuid,responsible_worker_id uuid,first_contact_id uuid,first_contact_at timestamptz,status text,captured_by_worker_id uuid,captured_at timestamptz,updated_at timestamptz,xp_event_id uuid);
 create table crm_client_capture_audit(client_id uuid,action text,previous_responsible_worker_id uuid,new_responsible_worker_id uuid,actor_worker_id uuid,reason text,metadata jsonb);
 -- The payment-selection adapter is a contract double. Gifts explicitly have no payment;
 -- canonical v8, minute accounting, rank, capture and Diamond triggers run unchanged.
 create function tc_register_call_with_payment(p jsonb) returns jsonb language plpgsql as $$
 begin
  if coalesce((p->>'cliente_compra_minutos')::boolean,false) or nullif(p->>'existing_payment_id','') is not null then raise exception 'UNEXPECTED_PAYMENT'; end if;
  return crm_register_call_atomic_v8(p);
 end $$;
 create function tc_touch_roulette_signal(p uuid) returns void language sql as $$insert into signal_calls values(p)$$;
 create function award_worker_xp(p_worker_id uuid,p_action_key text,p_reference_id text,p_reference_label text,p_origin text,p_metadata jsonb) returns uuid language plpgsql as $$begin raise exception 'UNEXPECTED_CAPTURE_XP';end$$;
 create unique index uq_tc_client_benefit_events_delivery_key on tc_client_benefit_events(delivery_key) where delivery_key is not null;
 insert into tc_client_rank_benefits(rank_key,label,min_spend,sort_order) values('bronce','Bronce',.01,1),('plata','Plata',100,2),('oro','Oro',500,3),('diamante','Diamante',1000,4);
 insert into workers(id,user_id,role,is_active,display_name,email,created_at) values
 ('${id(1)}','${id(11)}','central',true,'Test Central','central@example.invalid',now()-interval '1 day'),
 ('${id(3)}','${id(13)}','tarotista',true,'Test Historical','old@example.invalid',now()-interval '1 day'),
 ('${id(4)}','${id(14)}','central',false,'Test Inactive','inactive@example.invalid',now()-interval '1 day'),
 ('${id(5)}','${id(15)}','admin',true,'Test Admin','admin@example.invalid',now()-interval '1 day');
 grant usage on schema public to service_role;
 grant select,insert,update on all tables in schema public to service_role;
 `);
 await db.exec(read('fixtures/new-tarotista-gift-production.sql'));
 await db.exec(`
 create trigger trg_capture_client_first_contact after insert on rendimiento_llamadas for each row execute function capture_client_on_first_valid_contact();
 create trigger trg_tc_diamond_new_tarotista after insert or update of role,is_active on workers for each row execute function tc_diamond_new_tarotista_gift();
 `);
 // Real legacy gifts are delivered before the cutover, just as historical launches were.
 for(let i=0;i<3;i++)legacyClients.push(await client('diamante'));
 await db.query('update workers set is_active=true where id=$1',[id(3)]);
 legacyDefinitions=await scalar("select jsonb_object_agg(proname,md5(pg_get_functiondef(oid))) v from pg_proc where proname in ('crm_register_call_atomic_v8','tc_register_call_minutes','capture_client_on_first_valid_contact','register_client_capture_contact')");
 legacyDiamondDefinition=await scalar("select md5(pg_get_functiondef('tc_diamond_new_tarotista_gift()'::regprocedure)) v");
 await db.exec(read('../supabase/migrations/20261029233813_new_tarotista_intro_call.sql'));
 await db.query("insert into workers(id,user_id,role,is_active,display_name,email,created_at) values($1,$2,'tarotista',true,'Test Launch','launch@example.invalid',clock_timestamp())",[id(2),id(12)]);
});
after(async()=>{if(db)await db.close();});

test('zero balance Silver/Gold/Diamond gift grants and consumes actual FREE minutes atomically',async()=>{
 for(const [rank,minutes] of [['plata',10],['oro',12],['diamante',15]]){
  const c=await client(rank),p=request(c,rank);
  const offer=(await preview(c)).offers.find(o=>o.tarotista_worker_id===id(2));
  assert.equal(offer.eligible,true);assert.equal(offer.grant_minutes,minutes);
  const r=await call(p);
  assert.deepEqual(await balance(c),[0,37]);assert.equal(r.rank_free.grant_minutes,minutes);
  assert.equal(r.rendimiento.tiempo,minutes);assert.equal(r.rendimiento.codigo_1,'FREE');
  assert.equal(r.rendimiento.minutos_1,minutes);assert.equal(r.rendimiento.usa_7_free,false);
  assert.equal(r.rendimiento.captado,false);assert.equal(r.rendimiento.cliente_compra_minutos,false);
  assert.equal(r.minute_accounting.rank_free_granted,minutes);assert.equal(r.minute_accounting.used_free,minutes);
  assert.equal(await scalar("select count(*)::int v from crm_cliente_pagos where cliente_id=$1",[c]),1);
  assert.equal(await scalar("select count(*)::int v from worker_xp_events"),0);
  assert.equal(await scalar("select status v from crm_client_capture_assignments where client_id=$1",[c]),'pending');
  assert.equal(await scalar("select count(*)::int v from crm_client_notes where cliente_id=$1 and event_data ? 'rank_free'",[c]),1);
  const note=await scalar("select event_data v from crm_client_notes where cliente_id=$1",[c]);
  assert.equal(note.free_before,0);assert.equal(note.free_delta,0);assert.equal(note.free_after,0);
  assert.equal(note.rank_free.grant_minutes,minutes);assert.equal(note.minute_accounting.used_free,minutes);
  assert.deepEqual(await scalar('select result v from crm_call_operations where operation_id=$1',[p.operation_id]),r);
 }
});
test('one client x tarotist, operation replay and changed intent are distinct',async()=>{
 const c=await client(),p=request(c);
 const results=await Promise.all([call(p),call(p),call(p)]);
 assert.equal(results.filter(x=>!x.duplicate_prevented).length,1);
 assert.equal(new Set(results.map(x=>x.rendimiento.id)).size,1);
 await assert.rejects(call({...p,operation_id:id(seq++)}),/ALREADY_USED/);
 const other=await client();await assert.rejects(call({...p,cliente_id:other}),/PAYMENT_OPERATION_CONFLICT/);
 await db.query("insert into client_rank_overrides(client_id,assigned_rank,active,starts_at) values($1,'bronce',true,now()-interval '1 minute')",[c]);
 assert.equal((await call(p)).duplicate_prevented,true);
 assert.equal(await scalar('select count(*)::int v from crm_new_tarotista_gift_uses where cliente_id=$1',[c]),1);
});
test('a separate newly launched tarotist can be met once, but historic reactivation does not launch',async()=>{
 const c=await client(),p=request(c);await call(p);
 const next=await hire();await call(request(c,'plata',next));
 await assert.rejects(call(request(c,'plata',id(3))),/GIFT_NOT_AVAILABLE/);
 await db.query("update workers set is_active=false where id=$1",[id(3)]);
 await db.query("update workers set is_active=true where id=$1",[id(3)]);
 assert.equal(await scalar('select count(*)::int v from crm_new_tarotista_releases where tarotista_worker_id=$1',[id(3)]),0);
 // Explicit, fictitious rollout models the private authorized seed.
 await db.query("insert into crm_new_tarotista_releases(tarotista_worker_id,source) values($1,'explicit_rollout')",[id(3)]);
 assert.equal((await preview(c)).offers.find(x=>x.tarotista_worker_id===id(3)).eligible,true);
});
test('Bronze/no rank, stale rank, forged identity and inactive workers cannot grant',async()=>{
 for(const rank of ['bronce',null]){
  const c=await client(rank);await assert.rejects(call(request(c)),/RANK_NOT_ELIGIBLE/);assert.deepEqual(await balance(c),[0,37]);
 }
 const c=await client('oro');await assert.rejects(call(request(c,'plata')),/RANK_CHANGED/);
 await assert.rejects(call(request(c,'oro'),id(14)),/FORBIDDEN/);
 await assert.rejects(call(request(c,'oro'),id(12)),/FORBIDDEN/);
 const inactive=await hire(false);
 await assert.rejects(call(request(c,'oro',inactive)),/TAROTISTA_INACTIVE/);
 for(const bad of [{captado:true},{importe:1},{usa_7_free:true},{cliente_compra_minutos:true},{tarotista_manual_call:'CALL'},{collaborator_source:'CALL_MARIO'},{rank_free_eligibility_key:id(3)}])
  await assert.rejects(call({...request(c,'oro'),...bad}),/INVALID_RANK_FREE_REQUEST/);
 assert.deepEqual(await balance(c),[0,37]);
});
test('historical Diamond credit remains untouched by the independent introductory allowance',async()=>{
 const c=legacyClients[0],tarot=id(3);
 assert.deepEqual(await balance(c),[15,37]);
 const offer=(await preview(c)).offers.find(o=>o.tarotista_worker_id===tarot);
 assert.equal(offer.grant_minutes,15);assert.equal(offer.consume_minutes,15);
 const r=await call(request(c,'diamante',tarot));
 assert.equal(r.rank_free.grant_minutes,15);assert.ok(r.rank_free.previous_credit_event_id);
 assert.deepEqual(await balance(c),[15,37]);
 assert.equal(await scalar("select sum(minutes)::int v from tc_client_benefit_events where cliente_id=$1 and delivery_key in ($2,$3)",[c,'diamond-new-tarotista:'+tarot+':'+c,'new-tarotista-call:'+tarot+':'+c]),30);
});
test('spent historical Diamond credit does not block; current rank sets the independent allowance',async()=>{
 const c=legacyClients[1],tarot=id(3);
 await db.query('update crm_clientes set minutos_free_pendientes=0 where id=$1',[c]);
 const p=request(c,'diamante',tarot);
 assert.equal((await preview(c)).offers.find(o=>o.tarotista_worker_id===tarot).eligible,true);
 const used=await call(p);assert.equal(used.rank_free.grant_minutes,15);assert.ok(used.rank_free.previous_credit_event_id);
 assert.deepEqual(await balance(c),[0,37]);
 const d=legacyClients[2];
 await db.query("insert into client_rank_overrides(client_id,assigned_rank,active,starts_at) values($1,'plata',true,now()-interval '1 minute')",[d]);
 const r=await call(request(d,'plata',tarot));assert.equal(r.rank_free.grant_minutes,10);assert.deepEqual(await balance(d),[15,37]);
});
test('both real hire triggers grant only the new allowance, including delayed activation and reactivation',async()=>{
 const c=await client('diamante'),active=await hire();
 assert.deepEqual(await balance(c),[0,37]);
 assert.equal(await scalar('select count(*)::int v from crm_new_tarotista_releases where tarotista_worker_id=$1',[active]),1);
 assert.equal(await scalar('select count(*)::int v from tc_diamond_tarotista_announcements where worker_id=$1',[active]),1);
 const result=await call(request(c,'diamante',active));
 assert.equal(result.rank_free.grant_minutes,15);assert.equal(result.rank_free.previous_credit_event_id,null);
 await db.query('update workers set is_active=false where id=$1',[active]);
 await db.query('update workers set is_active=true where id=$1',[active]);
 assert.deepEqual(await balance(c),[0,37]);
 assert.equal(await scalar("select count(*)::int v from tc_client_benefit_events where delivery_key=$1",['diamond-new-tarotista:'+active+':'+c]),0);
 const inactive=await hire(false);
 assert.equal((await preview(c)).offers.find(o=>o.tarotista_worker_id===inactive).reason,'TAROTISTA_INACTIVE');
 await db.query('update workers set is_active=true where id=$1',[inactive]);
 assert.deepEqual(await balance(c),[0,37]);
 assert.equal((await preview(c)).offers.find(o=>o.tarotista_worker_id===inactive).eligible,true);
 assert.equal((await call(request(c,'diamante',inactive))).rank_free.grant_minutes,15);
 assert.deepEqual(await balance(c),[0,37]);
 assert.equal(await scalar("select count(*)::int v from tc_client_benefit_events where delivery_key=$1",['diamond-new-tarotista:'+inactive+':'+c]),0);
});
test('call failure rolls back grant, note, event, ledger and consumption, allowing a retry',async()=>{
 const c=await client(),p=request(c);
 await db.exec("alter table rendimiento_llamadas add constraint fail_fixture_call check(cliente_id<>'"+c+"')");
 await assert.rejects(call(p),/fail_fixture_call/);
 assert.deepEqual(await balance(c),[0,37]);
 assert.equal(await scalar('select count(*)::int v from tc_client_benefit_events where cliente_id=$1',[c]),0);
 assert.equal(await scalar('select count(*)::int v from crm_new_tarotista_gift_uses where cliente_id=$1',[c]),0);
 assert.equal(await scalar('select count(*)::int v from crm_call_operations where operation_id=$1',[p.operation_id]),0);
 await db.exec('alter table rendimiento_llamadas drop constraint fail_fixture_call');
 await call(p);assert.equal((await preview(c)).offers.find(o=>o.tarotista_worker_id===id(2)).reason,'ALREADY_USED');
});
test('old regular balance operation cannot be reused as a new gift',async()=>{
 const c=await client('plata',10),p=request(c);
 await scalar("select tc_register_call_minutes($1::jsonb) v",[JSON.stringify({operation_id:p.operation_id,cliente_id:c,telefonista_worker_id:id(1),tipo_registro:'minutos',codigo_1:'FREE',minutos_1:10,minutos_2:0,note_text:'Test'})]);
 await assert.rejects(call(p),/PAYMENT_OPERATION_CONFLICT/);assert.deepEqual(await balance(c),[0,37]);
});
test('new objects are service-only with RLS; only the legacy new-hire gift function changes',async()=>{
 for(const name of ['crm_new_tarotista_gift_policy','crm_new_tarotista_releases','crm_new_tarotista_gift_uses']){
  assert.equal(await scalar('select relrowsecurity v from pg_class where oid=$1::regclass',[name]),true);
  for(const role of ['anon','authenticated']) for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])
   assert.equal(await scalar('select has_table_privilege($1,$2,$3) v',[role,name,privilege]),false);
 }
 for(const fn of ['tc_new_tarotista_gift_preview(uuid)','tc_register_new_tarotista_gift(uuid,jsonb)']){
  for(const role of ['anon','authenticated'])assert.equal(await scalar('select has_function_privilege($1,$2,\'EXECUTE\') v',[role,fn]),false);
  assert.equal(await scalar('select prosecdef v from pg_proc where oid=$1::regprocedure',[fn]),false);
 }
 const c=await client(),p=request(c);
 await db.exec('set role service_role');try{await call(p);}finally{await db.exec('reset role');}
 assert.deepEqual(await scalar("select jsonb_object_agg(proname,md5(pg_get_functiondef(oid))) v from pg_proc where proname in ('crm_register_call_atomic_v8','tc_register_call_minutes','capture_client_on_first_valid_contact','register_client_capture_contact')"),legacyDefinitions);
 assert.notEqual(await scalar("select md5(pg_get_functiondef('tc_diamond_new_tarotista_gift()'::regprocedure)) v"),legacyDiamondDefinition);
});
