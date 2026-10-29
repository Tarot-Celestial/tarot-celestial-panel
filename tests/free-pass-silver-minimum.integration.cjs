const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
// Exact live RPCs with minimal structural tables and entirely fictional clients.
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261029132055_free_pass_silver_minimum.sql'), 'utf8');
const id = n => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
let db, seq = 100, beforeBronze, legacyRankDefinition;
const scalar = async (sql, args=[]) => (await db.query(sql,args)).rows[0].value;
const status = client => scalar('select public.crm_free_pass_status($1) value',[client]);
const balance = client => scalar("select jsonb_build_array(minutos_free_pendientes,minutos_normales_pendientes) value from crm_clientes where id=$1",[client]);
async function client(amount=100, days=0) {
 const c=id(seq++);
 await db.query('insert into crm_clientes(id,minutos_free_pendientes,minutos_normales_pendientes) values($1,40,100)',[c]);
 if(amount!==null) await payment(c,amount,days);
 return c;
}
async function payment(c,amount,days=0,estado='completed',source=null) {
 const p=id(seq++);
 await db.query("insert into crm_cliente_pagos(id,cliente_id,importe,estado,created_at,source_rendimiento_id) values($1,$2,$3,$4,now()-($5*interval '1 day'),$6)",[p,c,amount,estado,days,source]);
 return p;
}
async function override(c,rank,expired=false) {
 await db.query("insert into client_rank_overrides(id,client_id,assigned_rank,active,starts_at,ends_at,created_at) values($1,$2,$3,true,now()-interval '1 day',now()+($4*interval '1 day'),clock_timestamp())",[id(seq++),c,rank,expired?-0.5:1]);
}
const consume = (c,s,request=id(seq++),worker=id(1)) => scalar('select public.crm_free_pass_use($1,$2,$3,$4,$5) value',[c,worker,request,s.cycle_start,s.used]);
before(async()=>{
 db=new PGlite();
 await db.exec(`
 create role anon; create role authenticated; create role service_role;
 create table crm_clientes(id uuid primary key,minutos_free_pendientes numeric,minutos_normales_pendientes numeric,updated_at timestamptz);
 create table workers(id uuid primary key,user_id uuid,role text,is_active boolean,display_name text,email text);
 create table crm_cliente_pagos(id uuid primary key,cliente_id uuid,importe numeric,estado text,created_at timestamptz,source_rendimiento_id uuid);
 create table rendimiento_llamadas(id uuid primary key,cliente_id text,importe numeric,cliente_compra_minutos boolean,misma_compra boolean,fecha_hora timestamptz,created_at timestamptz);
 create table tc_client_rank_benefits(rank_key text primary key,min_spend numeric,sort_order integer,is_active boolean default false);
 create table client_rank_overrides(id uuid primary key,client_id uuid,assigned_rank text,active boolean,starts_at timestamptz,ends_at timestamptz,created_at timestamptz,intervention_type text,reason text,notes text);
 create table crm_free_pass_policy(id boolean primary key check(id),passes integer check(passes between 1 and 20),minutes integer check(minutes between 1 and 60),cycle_days integer check(cycle_days=30));
 create table crm_free_pass_uses(request_id uuid primary key,cliente_id uuid references crm_clientes(id),cycle_start timestamptz not null,slot integer check(slot>0),minutes integer check(minutes>0),worker_id uuid references workers(id),created_at timestamptz default now(),unique(cliente_id,cycle_start,slot));
 create table crm_client_notes(cliente_id text,texto text,author_user_id uuid,author_name text,author_email text,is_pinned boolean,event_type text,event_data jsonb);
 create table cliente_ruleta_signal(cliente_id uuid primary key,version bigint,updated_at timestamptz);
 create table client_benefit_rules(id uuid primary key,name text,rank text,event text,description text,active boolean,revision integer,updated_at timestamptz);
 create table client_benefit_applications(id uuid primary key,rule_id uuid references client_benefit_rules(id),snapshot jsonb);
 insert into client_benefit_rules values
 ('${id(30)}','Pases de consulta','bronce','information','3 pases de 7 minutos cada 30 días, con alguna compra confirmada en los últimos 4 meses.',true,1,null),
 ('${id(31)}','Pases de consulta','plata','information','3 pases de 7 minutos cada 30 días, con alguna compra confirmada en los últimos 4 meses.',true,1,null),
 ('${id(32)}','Pases de consulta','oro','information','3 pases de 7 minutos cada 30 días, con alguna compra confirmada en los últimos 4 meses.',false,1,null),
 ('${id(33)}','Pases de consulta','diamante','information','3 pases de 7 minutos cada 30 días, con alguna compra confirmada en los últimos 4 meses.',true,1,null),
 ('${id(34)}','Minutos de tu rango','plata','purchase','Existing purchase rule',true,8,null),
 ('${id(35)}','Pases de consulta','bronce','purchase','An unrelated rule with the same name',true,2,null);
 insert into client_benefit_applications values('${id(36)}','${id(30)}','{"historical":true,"description":"Historical receipt"}');
 insert into crm_free_pass_policy values(true,3,7,30);
 insert into tc_client_rank_benefits(rank_key,min_spend,sort_order) values('bronce',.01,1),('plata',100,2),('oro',500,3),('diamante',1000,4);
 insert into workers(id,user_id,role,is_active,display_name,email) values
 ('${id(1)}','${id(11)}','central',true,'Test central','central@example.invalid'),
 ('${id(2)}','${id(12)}','admin',true,'Test admin','admin@example.invalid'),
 ('${id(3)}','${id(13)}','central',false,'Test inactive','inactive@example.invalid'),
 ('${id(4)}','${id(14)}','tarotista',true,'Test tarotista','tarotista@example.invalid');
 grant usage on schema public to service_role;
 grant select,insert,update on all tables in schema public to service_role;
 `);
 await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/free-pass-production-before.sql'),'utf8'));
 await db.query('insert into crm_clientes(id,minutos_free_pendientes,minutos_normales_pendientes) values($1,40,100)',[id(20)]);
 await payment(id(20),10);
 beforeBronze=await status(id(20));
 await consume(id(20),beforeBronze,id(21));
 legacyRankDefinition=await scalar("select pg_get_functiondef('tc_client_rank_state(uuid)'::regprocedure) value");
 await db.exec(migration);
});
after(async()=>{if(db)await db.close();});

test('Bronze changes from three virtual passes to zero without removing credited or paid minutes',async()=>{
 assert.equal(beforeBronze.eligible,true); assert.equal(beforeBronze.available,3);
 const s=await status(id(20));
 assert.equal(s.effective_rank,'bronce');assert.equal(s.rank_eligible,false);assert.equal(s.eligible,false);
 assert.equal(s.available,0);assert.equal(s.used,1);assert.equal(s.eligibility_reason,'RANK_NOT_ELIGIBLE');
 assert.equal(s.cycle_start,beforeBronze.cycle_start);assert.equal(s.renews_at,beforeBronze.renews_at);
 assert.deepEqual(await balance(id(20)),[47,100]);
 assert.equal(await scalar('select count(*)::int value from crm_free_pass_uses where cliente_id=$1',[id(20)]),1);
 assert.equal(await scalar('select count(*)::int value from crm_client_notes where cliente_id=$1',[id(20)]),1);
});

test('Silver, Gold and Diamond retain 3 x 7 and use preserves paid balance',async()=>{
 for(const [amount,rank] of [[100,'plata'],[500,'oro'],[1000,'diamante']]){
  const c=await client(amount), s=await status(c);
  assert.equal(s.effective_rank,rank);assert.equal(s.rank_eligible,true);assert.equal(s.eligible,true);
  assert.equal(s.available,3);assert.equal(s.minutes,7);assert.equal(s.cycle_days,30);
  const used=await consume(c,s);assert.equal(used.benefits.available,2);assert.deepEqual(await balance(c),[47,100]);
 }
});

test('current rank overrides, downgrade and expiry determine eligibility',async()=>{
 const upgraded=await client(10);await override(upgraded,'plata');assert.equal((await status(upgraded)).eligible,true);
 const downgraded=await client(1000);await override(downgraded,'bronce');assert.equal((await status(downgraded)).eligible,false);
 const expired=await client(10);await override(expired,'plata',true);assert.equal((await status(expired)).effective_rank,'bronce');
 const none=await client(10,200);assert.equal((await status(none)).effective_rank,null);assert.equal((await status(none)).available,0);
});

test('historical purchase remains valid for Silver override, without inventing four-month expiry',async()=>{
 const c=await client(10,200);await override(c,'plata');
 const s=await status(c);assert.equal(s.eligible,true);assert.equal(s.eligible_until,null);
 await consume(c,s);assert.deepEqual(await balance(c),[47,100]);
});

test('no confirmed purchase, refunds, future payments and zero amounts cannot qualify',async()=>{
 const c=await client(null);await override(c,'plata');
 await payment(c,100,0,'pending');await payment(c,100,0,'refunded');await payment(c,100,-1);await payment(c,0);
 const s=await status(c);assert.equal(s.rank_eligible,true);assert.equal(s.eligible,false);
 assert.equal(s.eligibility_reason,'NO_CONFIRMED_PURCHASE');assert.equal(s.cycle_start,null);
});

test('canonical rank deduplicates linked payments and legacy first-purchase excludes same-purchase rows',async()=>{
 const c=await client(null), link=id(seq++);
 await db.query("insert into rendimiento_llamadas values($1,$2,60,true,false,now(),now())",[link,c]);
 await payment(c,60,0,'completed',link);
 assert.equal((await status(c)).effective_rank,'bronce');assert.equal((await status(c)).eligible,false);
 const legacy=await client(null);await override(legacy,'plata');
 await db.query("insert into rendimiento_llamadas values($1,$2,10,true,true,now(),now())",[id(seq++),legacy]);
 assert.equal((await status(legacy)).eligible,false);
 await db.query("insert into rendimiento_llamadas values($1,$2,10,true,false,now()-interval '150 days',now())",[id(seq++),legacy]);
 assert.equal((await status(legacy)).eligible,true);
});

test('stale UI cannot spend after downgrade; historical request replay remains safe',async()=>{
 const c=await client(100), s=await status(c), request=id(seq++);
 await consume(c,s,request);const oldVisible=await status(c);
 await override(c,'bronce');
 await assert.rejects(consume(c,oldVisible),/RANK_NOT_ELIGIBLE/);
 const repeated=await consume(c,s,request);
 assert.equal(repeated.replayed,true);assert.equal(repeated.benefits.available,0);assert.deepEqual(await balance(c),[47,100]);
});

test('three-pass cap, stale counter, request identity and worker role are enforced',async()=>{
 const c=await client(100), initial=await status(c), request=id(seq++);
 await consume(c,initial,request);
 await assert.rejects(consume(c,initial),/PASS_STATE_CHANGED/);
 await assert.rejects(consume(c,initial,request,id(2)),/INVALID_REQUEST/);
 const other=await client(100);await assert.rejects(consume(other,await status(other),request),/INVALID_REQUEST/);
 for(const worker of [id(3),id(4)])await assert.rejects(consume(c,await status(c),id(seq++),worker),/FORBIDDEN/);
 await consume(c,await status(c));await consume(c,await status(c));
 assert.equal((await status(c)).available,0);await assert.rejects(consume(c,await status(c)),/NO_PASSES/);
 assert.deepEqual(await balance(c),[61,100]);
});

test('parallel retries of one operation credit once',async()=>{
 const c=await client(100), s=await status(c), request=id(seq++);
 const outcomes=await Promise.all(Array.from({length:5},()=>consume(c,s,request)));
 assert.equal(outcomes.filter(x=>!x.replayed).length,1);
 assert.equal((await status(c)).used,1);assert.deepEqual(await balance(c),[47,100]);
});

test('failed note insertion rolls back use and balance, and same request can retry',async()=>{
 const c=await client(100), s=await status(c), request=id(seq++);
 await db.exec("alter table crm_client_notes add constraint simulated_note_failure check(event_data->>'request_id' <> '"+request+"')");
 await assert.rejects(consume(c,s,request),/simulated_note_failure/);
 assert.equal((await status(c)).used,0);assert.deepEqual(await balance(c),[40,100]);
 await db.exec('alter table crm_client_notes drop constraint simulated_note_failure');
 await consume(c,s,request);assert.deepEqual(await balance(c),[47,100]);
});

test('cycle remains anchored to original purchase and resets exactly at the thirty-day boundary',async()=>{
 await db.exec('begin');
 try{
  const c=await client(10,90);await override(c,'plata');
  const s=await status(c);
  assert.equal(await scalar('select ($1::timestamptz=now()) value',[s.cycle_start]),true);
  await db.query("insert into crm_free_pass_uses values($1,$2,now()-interval '30 days',1,7,$3,now()-interval '1 day')",[id(seq++),c,id(1)]);
  assert.equal((await status(c)).used,0);assert.equal((await status(c)).available,3);
  await consume(c,s);assert.equal((await status(c)).used,1);
 }finally{await db.exec('rollback');}
});

test('RPC grants stay service-only, invoker and rank calculation remain unchanged',async()=>{
 assert.equal(await scalar("select pg_get_functiondef('tc_client_rank_state(uuid)'::regprocedure) value"),legacyRankDefinition);
 for(const fn of ['crm_free_pass_status(uuid)','crm_free_pass_use(uuid,uuid,uuid,timestamptz,integer)']){
  for(const role of ['anon','authenticated']) assert.equal(await scalar('select has_function_privilege($1,$2,\'EXECUTE\') value',[role,fn]),false);
  assert.equal(await scalar('select has_function_privilege(\'service_role\',$1,\'EXECUTE\') value',[fn]),true);
  assert.equal(await scalar('select prosecdef value from pg_proc where oid=$1::regprocedure',[fn]),false);
 }
 await db.exec('set role service_role');
 try{assert.equal((await status(id(20))).available,0);}finally{await db.exec('reset role');}
});

test('informational rules retire Bronze, correct stale wording and preserve IDs, names and receipts',async()=>{
 const rows=(await db.query("select * from client_benefit_rules order by id")).rows;
 assert.deepEqual(rows.slice(0,4).map(r=>r.id),[id(30),id(31),id(32),id(33)]);
 assert.ok(rows.slice(0,4).every(r=>r.name==='Pases de consulta' && r.revision===2));
 assert.equal(rows[0].active,false);assert.match(rows[0].description,/Bronce no incluye pases FREE de 7 minutos/);
 for(const row of rows.slice(1,4)){
  assert.match(row.description,/3 pases de 7 minutos cada 30 días/);
  assert.match(row.description,/compra confirmada histórica/);
  assert.doesNotMatch(row.description,/4 meses/);
 }
 assert.deepEqual(rows.slice(1,4).map(r=>r.active),[true,false,true]);
 assert.equal(rows[4].description,'Existing purchase rule');assert.equal(rows[4].revision,8);
 assert.equal(rows[5].description,'An unrelated rule with the same name');assert.equal(rows[5].revision,2);
 assert.deepEqual(await scalar('select snapshot value from client_benefit_applications where id=$1',[id(36)]),{historical:true,description:'Historical receipt'});
 await db.exec(migration);
 assert.deepEqual((await db.query('select * from client_benefit_rules order by id')).rows,rows);
});
