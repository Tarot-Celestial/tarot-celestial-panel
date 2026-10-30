const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8');
const id=n=>'20000000-0000-4000-8000-'+String(n).padStart(12,'0');
let db,seq=100,legacyDefinitions;
const scalar=async(q,p=[]) => (await db.query(q,p)).rows[0].v;
const preview=c=>scalar('select tc_initial_consultation_gift_preview($1) v',[c]);
const balance=c=>scalar('select jsonb_build_array(minutos_free_pendientes,minutos_normales_pendientes) v from crm_clientes where id=$1',[c]);
async function client(free=0,normal=0,phone=null){const c=id(seq++);await db.query("insert into crm_clientes(id,nombre,apellido,minutos_free_pendientes,minutos_normales_pendientes,telefono) values($1,'Synthetic','Client',$2,$3,$4)",[c,free,normal,phone]);return c;}
const request=(c,tarotista=id(2),op=id(seq++))=>({operation_id:op,cliente_id:c,tarotista_worker_id:tarotista});
const call=(p,user=id(11))=>scalar('select tc_register_initial_consultation_gift($1,$2::jsonb) v',[user,JSON.stringify(p)]);
const intro=(c,op=id(seq++))=>scalar('select tc_register_new_tarotista_gift($1,$2::jsonb) v',[id(11),JSON.stringify({operation_id:op,cliente_id:c,tarotista_worker_id:id(2),rank_free_expected_rank:'sin_rango',rank_free_expected_minutes:7,rank_free_eligibility_key:id(2)})]);
const legacy=(c,op=id(seq++))=>scalar('select tc_register_call_minutes($1::jsonb) v',[JSON.stringify({operation_id:op,cliente_id:c,telefonista_worker_id:id(1),tarotista_worker_id:id(2),tipo_registro:'minutos',codigo_1:'FREE',minutos_1:1,minutos_2:0,note_text:'Synthetic legacy call'})]);
before(async()=>{
 db=new PGlite();
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 await db.exec(read('fixtures/purchase-reward-schema.sql'));
 await db.exec(`
 create table workers(id uuid primary key,user_id uuid,role text,is_active boolean,display_name text,email text,created_at timestamptz default now());
 create table crm_clientes(id uuid primary key,nombre text,apellido text,telefono text,telefono_normalizado text,minutos_free_pendientes numeric default 0,minutos_normales_pendientes numeric default 0,puntos numeric default 0,updated_at timestamptz);
 create index fixture_calls_client_idx on rendimiento_llamadas(cliente_id);
 create table first_tarotist_reservations(id uuid primary key default gen_random_uuid(),client_key text,phone text,free_consult_used boolean default false);
 create table captacion_state_events(id uuid primary key default gen_random_uuid(),lead_id uuid not null,cliente_id uuid,actor_worker_id uuid,previous_state text,next_state text,action text not null,source text not null,metadata jsonb);
 create table client_benefit_rules(id uuid primary key default gen_random_uuid(),name text,description text,rank text,event text,claim_mode text default 'automatic',scope text default 'regular',active boolean,free_minutes integer,coins integer,oracle_credits integer,roulette_spins integer,revision integer default 1,updated_at timestamptz default now(),archived_at timestamptz);
 create table client_rank_overrides(id uuid primary key default gen_random_uuid(),client_id uuid,assigned_rank text,active boolean,starts_at timestamptz,ends_at timestamptz,created_at timestamptz default now(),intervention_type text,reason text,notes text);
 create table crm_call_operations(operation_id uuid primary key,cliente_id uuid,worker_id uuid,request jsonb,result jsonb,created_at timestamptz default now());
 create table crm_client_notes(cliente_id text,texto text,author_user_id uuid,author_name text,author_email text,is_pinned boolean,created_at timestamptz default now(),event_type text,event_data jsonb);
 create table tc_diamond_tarotista_announcements(worker_id uuid primary key,announced_at timestamptz default now());
 create table cliente_notificaciones(cliente_id uuid,tipo text,titulo text,mensaje text,meta jsonb,leida boolean,created_at timestamptz);
 create table signal_calls(cliente_id uuid);
 create table worker_xp_events(id uuid primary key default gen_random_uuid(),worker_id uuid,action_key text,reference_id text,status text,created_at timestamptz default now());
 create table crm_client_capture_assignments(client_id uuid primary key,business text,created_by_worker_id uuid,candidate_worker_id uuid,responsible_worker_id uuid,first_contact_id uuid,first_contact_at timestamptz,status text,captured_by_worker_id uuid,captured_at timestamptz,updated_at timestamptz,xp_event_id uuid);
 create table crm_client_capture_audit(client_id uuid,action text,previous_responsible_worker_id uuid,new_responsible_worker_id uuid,actor_worker_id uuid,reason text,metadata jsonb);
 -- Only payment selection and the UI signal are doubles. Canonical v8, minute
 -- accounting and capture functions below are unmodified production snapshots.
 create function tc_register_call_with_payment(p jsonb) returns jsonb language plpgsql as $$begin
  if coalesce((p->>'cliente_compra_minutos')::boolean,false) or nullif(p->>'existing_payment_id','') is not null then raise exception 'UNEXPECTED_PAYMENT';end if;
  return crm_register_call_atomic_v8(p);end$$;
 create function tc_touch_roulette_signal(p uuid) returns void language sql as $$insert into signal_calls values(p)$$;
 create function award_worker_xp(p_worker_id uuid,p_action_key text,p_reference_id text,p_reference_label text,p_origin text,p_metadata jsonb) returns uuid language plpgsql as $$begin raise exception 'UNEXPECTED_CAPTURE_XP';end$$;
 create unique index uq_tc_client_benefit_events_delivery_key on tc_client_benefit_events(delivery_key) where delivery_key is not null;
 insert into tc_client_rank_benefits(rank_key,label,min_spend,sort_order) values('bronce','Bronce',.01,1),('plata','Plata',100,2),('oro','Oro',500,3),('diamante','Diamante',1000,4);
 insert into workers(id,user_id,role,is_active,display_name,email,created_at) values
 ('${id(1)}','${id(11)}','central',true,'Synthetic Central','central@example.invalid',now()-interval '1 day'),
 ('${id(2)}','${id(12)}','tarotista',true,'Synthetic Tarotist','reader@example.invalid',now()-interval '1 day'),
 ('${id(3)}','${id(13)}','tarotista',true,'Synthetic Other','other@example.invalid',now()-interval '1 day'),
 ('${id(4)}','${id(14)}','central',false,'Synthetic Inactive','inactive@example.invalid',now()-interval '1 day'),
 ('${id(5)}','${id(15)}','admin',true,'Synthetic Admin','admin@example.invalid',now()-interval '1 day');
 grant usage on schema public to service_role;grant select,insert,update on all tables in schema public to service_role;
 `);
 await db.exec(read('fixtures/new-tarotista-gift-production.sql'));
 await db.exec('create trigger trg_capture_client_first_contact after insert on rendimiento_llamadas for each row execute function capture_client_on_first_valid_contact();');
 await db.exec(read('../supabase/migrations/20261029233813_new_tarotista_intro_call.sql'));
 await db.exec(read('../supabase/migrations/20261030171707_new_tarotista_gift_all_ranks.sql'));
 await db.query("insert into crm_new_tarotista_releases(tarotista_worker_id,source) values($1,'explicit_rollout')",[id(2)]);
 legacyDefinitions=await scalar("select jsonb_object_agg(proname,md5(pg_get_functiondef(oid))) v from pg_proc where proname in ('crm_register_call_atomic_v8','tc_register_call_minutes','capture_client_on_first_valid_contact','register_client_capture_contact','tc_new_tarotista_gift_offer','tc_register_new_tarotista_gift')");
 await db.exec(read('../supabase/migrations/20261030171715_initial_consultation_free_gift.sql'));
});
after(async()=>{if(db)await db.close();});

test('initial seven-minute gift works at zero and preserves all pre-existing wallet balances',async()=>{
 for(const [free,normal] of [[0,0],[10,37],[21,15]]){
  const c=await client(free,normal),p=request(c);assert.equal((await preview(c)).eligible,true);
  const r=await call(p);assert.deepEqual(await balance(c),[free,normal]);
  assert.equal(r.initial_free.minutes,7);assert.equal(r.initial_free.grant_minutes,7);assert.equal(r.initial_free.consume_minutes,7);
  assert.equal(r.rendimiento.tiempo,7);assert.equal(r.rendimiento.codigo_1,'FREE');assert.equal(r.rendimiento.minutos_1,7);assert.equal(r.rendimiento.usa_7_free,true);
  assert.equal(r.rendimiento.captado,false);assert.equal(r.rendimiento.cliente_compra_minutos,false);
  assert.equal(r.minute_accounting.initial_free_granted,7);assert.equal(r.minute_accounting.free_before,free);assert.equal(r.minute_accounting.used_free,7);
  assert.equal(await scalar('select count(*)::int v from crm_cliente_pagos where cliente_id=$1',[c]),0);
  assert.equal(await scalar('select count(*)::int v from worker_xp_events'),0);
  const capture=await scalar('select to_jsonb(a) v from crm_client_capture_assignments a where client_id=$1',[c]);
  assert.equal(capture.status,'pending');assert.equal(capture.candidate_worker_id,id(1));assert.equal(capture.first_contact_id,r.rendimiento.id);
  const note=await scalar('select event_data v from crm_client_notes where cliente_id=$1',[c]);
  assert.equal(note.initial_free.minutes,7);assert.equal(note.free_before,free);assert.equal(note.free_after,free);assert.equal(note.free_delta,0);
  assert.deepEqual(await scalar('select result v from crm_call_operations where operation_id=$1',[p.operation_id]),r);
  assert.equal((await preview(c)).reason,'ALREADY_USED');
 }
});

test('same operation replays once, but another operation or tarotist cannot grant a second initial consultation',async()=>{
 const c=await client(),p=request(c),results=await Promise.all([call(p),call(p),call(p)]);
 assert.equal(results.filter(r=>!r.duplicate_prevented).length,1);assert.equal(new Set(results.map(r=>r.rendimiento.id)).size,1);
 await assert.rejects(call(request(c,id(3))),/ALREADY_USED/);
 await assert.rejects(call({...p,tarotista_worker_id:id(3)}),/PAYMENT_OPERATION_CONFLICT/);
 await assert.rejects(call({...p,cliente_id:await client()}),/PAYMENT_OPERATION_CONFLICT/);
 assert.equal(await scalar('select count(*)::int v from crm_initial_consultation_gift_uses where cliente_id=$1',[c]),1);
});

test('positive historical calls, FREE slots and the historical seven-minute flag block a first consultation',async()=>{
 for(const record of [{tiempo:4},{minutos_1:2,codigo_1:'FREE'},{usa_7_free:true}]){
  const c=await client();await db.query('insert into rendimiento_llamadas(cliente_id,tiempo,minutos_1,codigo_1,usa_7_free) values($1,$2,$3,$4,$5)',[c,record.tiempo||0,record.minutos_1||0,record.codigo_1||null,record.usa_7_free||false]);
  assert.equal((await preview(c)).reason,'PREVIOUS_CONSULTATION');await assert.rejects(call(request(c)),/PREVIOUS_CONSULTATION/);
  assert.deepEqual(await balance(c),[0,0]);
 }
});

test('completed reservations use exact phone digits; names, incomplete reservations and balances are not first-use proof',async()=>{
 const c=await client(0,0,'+34 (600) 111 222');
 await db.query("insert into first_tarotist_reservations(client_key,phone,free_consult_used) values('phone:34600111222',null,true)");
 assert.equal((await preview(c)).reason,'PREVIOUS_CONSULTATION');await assert.rejects(call(request(c)),/PREVIOUS_CONSULTATION/);
 const other=await client(10,0,'+34 600 111 223');
 await db.query("insert into first_tarotist_reservations(client_key,phone,free_consult_used) values('name:synthetic client',null,true),('phone:34600111223','+34 600 111 223',false)");
 assert.equal((await preview(other)).eligible,true);await call(request(other));assert.deepEqual(await balance(other),[10,0]);
});

test('duplicate CRM records with the same exact normalized phone cannot repeat an initial gift',async()=>{
 const a=await client(0,0,'+34 600 222 111'),b=await client(0,0,'34600222111');
 const attempts=await Promise.allSettled([call(request(a)),call(request(b))]);
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
 assert.match(attempts.find(r=>r.status==='rejected').reason.message,/PREVIOUS_CONSULTATION/);
 assert.equal((await preview(b)).reason,'PREVIOUS_CONSULTATION');
});

test('explicit historical hizo_free events block by client or exact phone alias, but generic lead states do not',async()=>{
 const a=await client(0,0,'+34 600 333 222'),b=await client(0,0,'34600333222');
 await db.query("insert into captacion_state_events(lead_id,cliente_id,action,source,next_state) values($1,$2,'hizo_free','captacion_panel','pend_cap')",[id(seq++),a]);
 for(const c of [a,b]){assert.equal((await preview(c)).reason,'PREVIOUS_CONSULTATION');await assert.rejects(call(request(c)),/PREVIOUS_CONSULTATION/);}
 const c=await client();await db.query("insert into captacion_state_events(lead_id,cliente_id,action,source,next_state) values($1,$2,'recontacto','captacion_panel','pend_cap')",[id(seq++),c]);
 assert.equal((await preview(c)).eligible,true);await call(request(c));
});

test('initial and new-tarotist gifts are distinct; initial must still precede every positive consultation',async()=>{
 const first=await client(),p=request(first);await call(p);const met=await intro(first);
 assert.equal(met.rank_free.minutes,7);assert.deepEqual(await balance(first),[0,0]);
 assert.equal(await scalar('select count(*)::int v from crm_initial_consultation_gift_uses where cliente_id=$1',[first]),1);
 assert.equal(await scalar('select count(*)::int v from crm_new_tarotista_gift_uses where cliente_id=$1',[first]),1);
 const reverse=await client();await intro(reverse);await assert.rejects(call(request(reverse)),/PREVIOUS_CONSULTATION/);
 const legacyFirst=await client(7,2);await legacy(legacyFirst);await assert.rejects(call(request(legacyFirst)),/PREVIOUS_CONSULTATION/);assert.deepEqual(await balance(legacyFirst),[6,2]);
 const initialFirst=await client(7,2);await call(request(initialFirst));await legacy(initialFirst);assert.deepEqual(await balance(initialFirst),[6,2]);
});

test('forged flags, inactive actors, nonstaff and inactive tarotists fail without a gift',async()=>{
 const c=await client(),p=request(c);
 for(const bad of [{cliente_compra_minutos:true},{captado:true},{recuperado:true},{usa_7_free:true},{importe:1},{tarotista_manual_call:'CALL'},{collaborator_source:'CALL_MARIO'},{clasificacion:'captado'}])await assert.rejects(call({...p,...bad}),/INVALID_INITIAL_FREE_REQUEST/);
 for(const uid of [id(12),id(14),id(999)])await assert.rejects(call(p,uid),/FORBIDDEN/);
 await db.query('update workers set is_active=false where id=$1',[id(3)]);await assert.rejects(call(request(c,id(3))),/TAROTISTA_INACTIVE/);
 assert.deepEqual(await balance(c),[0,0]);assert.equal(await scalar('select count(*)::int v from tc_client_benefit_events where cliente_id=$1',[c]),0);
});

test('failure rolls back grant, capture candidate, note, minute receipt and use; retry then succeeds',async()=>{
 const c=await client(10,3),p=request(c);
 await db.exec("alter table rendimiento_llamadas add constraint fail_initial_fixture check(cliente_id<>'"+c+"')");
 await assert.rejects(call(p),/fail_initial_fixture/);assert.deepEqual(await balance(c),[10,3]);
 for(const [table,col] of [['tc_client_benefit_events','cliente_id'],['crm_initial_consultation_gift_uses','cliente_id'],['crm_client_notes','cliente_id'],['crm_client_capture_assignments','client_id']])assert.equal(await scalar(`select count(*)::int v from ${table} where ${col}=$1`,[c]),0);
 assert.equal(await scalar('select count(*)::int v from crm_call_operations where operation_id=$1',[p.operation_id]),0);
 await db.exec('alter table rendimiento_llamadas drop constraint fail_initial_fixture');await call(p);
});

test('operation IDs from other calls cannot be repurposed into a free gift',async()=>{
 const c=await client(7),op=id(seq++);await legacy(c,op);
 await assert.rejects(call(request(c,id(2),op)),/PAYMENT_OPERATION_CONFLICT/);
 assert.deepEqual(await balance(c),[6,0]);
});

test('new ledger and functions are service-only, existing canonical functions remain byte-for-byte unchanged',async()=>{
 assert.equal(await scalar("select relrowsecurity v from pg_class where oid='crm_initial_consultation_gift_uses'::regclass"),true);
 for(const role of ['anon','authenticated']){
  for(const p of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal(await scalar('select has_table_privilege($1,$2,$3) v',[role,'crm_initial_consultation_gift_uses',p]),false);
  for(const fn of ['tc_initial_consultation_gift_preview(uuid)','tc_register_initial_consultation_gift(uuid,jsonb)'])assert.equal(await scalar("select has_function_privilege($1,$2,'EXECUTE') v",[role,fn]),false);
 }
 const c=await client(),p=request(c);await db.exec('set role service_role');try{await call(p);}finally{await db.exec('reset role');}
 assert.deepEqual(await scalar("select jsonb_object_agg(proname,md5(pg_get_functiondef(oid))) v from pg_proc where proname in ('crm_register_call_atomic_v8','tc_register_call_minutes','capture_client_on_first_valid_contact','register_client_capture_contact','tc_new_tarotista_gift_offer','tc_register_new_tarotista_gift')"),legacyDefinitions);
});
