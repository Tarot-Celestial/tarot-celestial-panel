const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const ISA = 'b4ad3ac9-e5fd-44b4-bff1-cf043766b4ef';
const MARIA = 'f2256fe7-2b57-4e84-92aa-05153aebb1cc';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let db;
const sql = async (query, params = []) => (await db.query(query, params)).rows;
const clock = async time => db.query('update test_clock set instant=$1', [time]);
const state = async (user = 1, assign = false) => (await sql('select tc_recovery_mission_state($1,$2) v', [id(user), assign]))[0].v;
const version = async client => (await sql('select version from crm_client_recovery where client_id=$1', [client]))[0]?.version || 0;
async function act(client, action = 'contacted', { user = 1, request = 10000, payment = null, channel = 'whatsapp', revision } = {}) {
 return (await sql('select tc_recovery_act_v2($1,$2,$3,$4,$5,$6,$7,$8) v',
  [id(user), client, action, revision ?? await version(client), payment, 'Gestión de prueba', channel, id(request)]))[0].v;
}
async function pay(client, n) {
 const payment = id(20000 + n);
 await sql("insert into crm_cliente_pagos(id,cliente_id,estado,importe,created_at) values($1,$2,'completed',20,now())", [payment, client]);
 return payment;
}
before(async () => {
 db = new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create table test_clock(instant timestamptz); insert into test_clock values('2026-10-19T12:00:00Z');
 create function tc_test_now() returns timestamptz language sql stable as $$select instant from test_clock$$;
 create table workers(id uuid primary key,user_id uuid,role text,is_active boolean,display_name text,email text);
 create table crm_clientes(id uuid primary key,nombre text,apellido text,telefono text,origen text);
 create table crm_etiquetas(id uuid primary key,nombre text);
 create table crm_cliente_etiquetas(cliente_id uuid references crm_clientes(id),etiqueta_id uuid references crm_etiquetas(id));
 create table crm_cliente_pagos(id uuid primary key,cliente_id uuid references crm_clientes(id),estado text,importe numeric,created_at timestamptz default now());
 create table worker_xp_rules(action_key text primary key,name text,description text,xp_reward integer,frequency text,enabled boolean,integration_status text);
 create table worker_xp_events(id uuid primary key default gen_random_uuid(),worker_id uuid references workers(id),action_key text,xp_amount integer,reference_id text,reference_label text,origin text,status text,metadata jsonb,created_by_worker_id uuid,created_at timestamptz default tc_test_now());
 create table test_registered_calls(id uuid primary key default gen_random_uuid(),client_id uuid,payload jsonb);
 -- Atomic dependency fixture: the real minute/payment behavior has its own
 -- integration suites; this observable write verifies wrapper rollback/replay.
 create function tc_register_call_minutes(p_payload jsonb) returns jsonb language plpgsql as $$
 declare call_id uuid; payment_id uuid; begin
 insert into test_registered_calls(client_id,payload) values((p_payload->>'cliente_id')::uuid,p_payload) returning id into call_id;
 if p_payload->>'source_tag_id' is not null then insert into crm_cliente_etiquetas values((p_payload->>'cliente_id')::uuid,(p_payload->>'source_tag_id')::uuid); end if;
 insert into crm_cliente_pagos(id,cliente_id,estado,importe,created_at) values(gen_random_uuid(),(p_payload->>'cliente_id')::uuid,coalesce(p_payload->>'test_payment_state','completed'),(p_payload->>'importe')::numeric,now()) returning id into payment_id;
 return jsonb_build_object('ok',true,'rendimiento',jsonb_build_object('id',call_id),'payment',jsonb_build_object('id',payment_id));
 end $$;
 insert into workers values('${ISA}','${id(1)}','central',true,'Isa','isa@example.test'),('${MARIA}','${id(2)}','central',true,'Maria','maria@example.test'),('${id(3)}','${id(3)}','admin',true,'Admin','admin@example.test'),('${id(4)}','${id(4)}','central',true,'Michael','michael@example.test'),('${id(5)}','${id(5)}','central',false,'Inactive','inactive@example.test');`);
 const dir = path.join(__dirname, '../supabase/migrations');
 await db.exec(fs.readFileSync(path.join(dir, '20261006182809_client_recovery.sql'), 'utf8'));
 const migration = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(f => f.endsWith('_central_recovery_missions.sql'))), 'utf8');
 await db.exec(migration);
 await db.exec(migration); // Rerunning preserves rows and definitions, without duplicate schedules/rules.
 // Only the isolated test clock is replaced. The migration itself runs verbatim above.
 await db.exec('create or replace function tc_recovery_mission_now() returns timestamptz language sql stable security invoker set search_path=public,pg_temp as $$select tc_test_now()$$');
});
beforeEach(async () => {
 await db.exec('truncate test_registered_calls,crm_recovery_daily_results,crm_recovery_contact_events,crm_recovery_mission_requests,crm_recovery_mission_assignments,crm_client_recovery_history,crm_client_recovery,worker_xp_events,crm_cliente_pagos,crm_cliente_etiquetas,crm_clientes cascade');
 await clock('2026-10-19T12:00:00Z');
 await db.exec(`insert into crm_clientes(id,nombre,apellido,telefono,origen) select ('00000000-0000-4000-8000-'||lpad((100+g)::text,12,'0'))::uuid,'Cliente '||g,'Prueba','346000'||lpad(g::text,5,'0'),'celestial' from generate_series(1,100) g`);
});
after(async () => db.close());

test('Ecuador shifts are weekday-only, independent, with Isa notice at 10 and Maria at 15', async () => {
 const ctx = async (worker, time) => (await sql('select tc_recovery_mission_context($1,$2) v',[worker,time]))[0].v;
 assert.equal((await ctx(ISA,'2026-10-19T11:59:59Z')).active,false);
 assert.equal((await ctx(ISA,'2026-10-19T12:00:00Z')).active,true);
 assert.equal((await ctx(ISA,'2026-10-19T20:00:00Z')).active,false);
 assert.equal((await ctx(MARIA,'2026-10-19T20:00:00Z')).active,true);
 assert.equal((await ctx(MARIA,'2026-10-20T04:00:00Z')).active,false);
 assert.equal((await ctx(ISA,'2026-10-24T15:40:00Z')).active,false);
 assert.equal((await ctx(ISA,'2026-10-19T15:40:00Z')).expected_managed,4);
 assert.equal((await ctx(MARIA,'2026-10-19T20:40:00Z')).expected_managed,2);
 assert.equal((await state(4,true)).enabled,false);
});

test('GET is read only; explicit preparation assigns 30 distinct contacts to each central without overlap', async () => {
 assert.deepEqual((await state()).assigned_client_ids,[]);
 const isa = await state(1,true);
 assert.equal(isa.assigned_count,30);
 assert.deepEqual((await state(1,true)).assigned_client_ids,isa.assigned_client_ids);
 await clock('2026-10-19T20:00:00Z');
 const maria = await state(2,true);
 assert.equal(maria.assigned_count,30);
 assert.equal(maria.assigned_client_ids.filter(c=>isa.assigned_client_ids.includes(c)).length,0);
 await assert.rejects(act(isa.assigned_client_ids[0],'contacted',{user:2}),/OTHER_OWNER/);
 const listing=(await sql("select tc_recovery_mission_list($1,'pending','','','',2) v",[id(2)]))[0].v;
 assert.equal(listing.total,30);
 assert.equal(listing.contacts.length,5);
 assert.ok(listing.contacts.every(c=>maria.assigned_client_ids.includes(c.id)));
});

test('30 unique valid contacts award 10 XP once, while retries and repeated clicks cannot inflate counts', async () => {
 const { assigned_client_ids: clients } = await state(1,true);
 const first = await act(clients[0],'contacted',{request:10001,revision:0});
 assert.equal(first.counted,true);
 const retry = await act(clients[0],'contacted',{request:10001,revision:0});
 assert.equal(retry.duplicate_prevented,true);
 await assert.rejects(act(clients[0],'contacted',{request:10001,revision:0,channel:'phone'}),/OPERATION_CONFLICT/);
 const repeat = await act(clients[0],'contacted',{request:10002});
 assert.equal(repeat.counted,false);
 assert.equal(repeat.count_reason,'already_counted');
 for(let n=1;n<30;n++) await act(clients[n],'contacted',{request:10100+n});
 const result = await state();
 assert.equal(result.managed,30);
 assert.equal(result.management_bonus_awarded,true);
 assert.equal(result.awarded_xp,10);
 assert.equal((await sql("select count(*)::int n from worker_xp_events where action_key='recovery_daily_management'"))[0].n,1);
 assert.equal((await sql('select count(*)::int n from crm_recovery_contact_events'))[0].n,31);
});

test('no_response, unassigned, outside-shift and weekend contacts do not satisfy the daily goal', async () => {
 const { assigned_client_ids: clients } = await state(1,true);
 await act(clients[0],'no_response',{request:11000});
 assert.equal((await state()).managed,0);
 assert.equal((await act(id(200),'contacted',{request:11001})).count_reason,'not_assigned');
 await clock('2026-10-19T20:00:00Z');
 assert.equal((await act(clients[1],'contacted',{request:11002})).count_reason,'outside_shift');
 await clock('2026-10-24T12:00:00Z');
 assert.equal((await act(clients[2],'contacted',{request:11003})).count_reason,'outside_shift');
 assert.equal((await state(1,true)).assigned_count,0);
 assert.equal((await sql('select count(*)::int n from worker_xp_events'))[0].n,0);
});

test('the next working day skips recent contacts; a due follow-up is eligible after seven days', async () => {
 const { assigned_client_ids: clients } = await state(1,true);
 for(let n=0;n<30;n++) await act(clients[n],'contacted',{request:12000+n});
 await clock('2026-10-20T12:00:00Z');
 const next = await state(1,true);
 assert.equal(next.assigned_client_ids.filter(c=>clients.includes(c)).length,0);
 await sql("update crm_client_recovery_history set created_at='2026-10-01T12:00:00Z' where client_id=$1",[clients[0]]);
 await clock('2026-10-21T12:00:00Z');
 // Only this owned contact remains eligible: an expired follow-up may enter a later mission.
 await sql("update crm_clientes set origen='orion' where id<>$1",[clients[0]]);
 const due = await state(1,true);
 assert.deepEqual(due.assigned_client_ids,[clients[0]]);
});

test('five distinct recoveries give 200 XP independently of thirty contacts and preserve the 75 XP per client', async () => {
 const { assigned_client_ids: clients } = await state(1,true);
 for(let n=0;n<5;n++) {
  await act(clients[n],'contacted',{request:13000+n});
  const payment = await pay(clients[n],n);
  const recovered = await act(clients[n],'recovered',{request:13100+n,payment});
  assert.equal(recovered.xp,75);
  await act(clients[n],'recovered',{request:13200+n,payment});
 }
 const result=await state();
 assert.equal(result.managed,5);
 assert.equal(result.recovered,5);
 assert.equal(result.management_bonus_awarded,false);
 assert.equal(result.recovery_bonus_awarded,true);
 assert.equal(result.awarded_xp,575);
 assert.equal((await sql("select count(*)::int n from worker_xp_events where action_key='client_recovery'"))[0].n,5);
});

test('historical contact can convert today; an unpaid or foreign payment rolls back recovery and XP', async () => {
 const client=id(101);
 await sql("insert into crm_client_recovery(client_id,status,responsible_id,contacted_at) values($1,'contacted',$2,now()-interval '3 days')",[client,ISA]);
 await assert.rejects(act(client,'recovered',{request:14000}),/PAYMENT_REQUIRED/);
 const foreign=await pay(id(102),99);
 await assert.rejects(act(client,'recovered',{request:14001,payment:foreign}),/PAYMENT_REQUIRED/);
 const payment=await pay(client,100);
 await act(client,'recovered',{request:14002,payment});
 const result=await state();
 assert.equal(result.managed,0);
 assert.equal(result.recovered,1);
 assert.equal(result.awarded_xp,75);
});

test('admin overview is isolated; browser roles and inactive identities cannot access mission writes', async () => {
 await assert.rejects(state(5,true),/FORBIDDEN/);
 await assert.rejects(sql('select tc_recovery_mission_overview($1)',[id(1)]),/FORBIDDEN/);
 const overview=(await sql('select tc_recovery_mission_overview($1) v',[id(3)]))[0].v;
 assert.equal(overview.missions.length,2);
 const permissions=(await sql("select has_function_privilege('authenticated','tc_recovery_act_v2(uuid,uuid,text,integer,uuid,text,text,uuid)','execute') f,has_function_privilege('anon','tc_recovery_mission_state(uuid,boolean)','execute') s,has_table_privilege('authenticated','crm_recovery_contact_events','insert') t"))[0];
 assert.deepEqual(permissions,{f:false,s:false,t:false});
 assert.equal((await sql("select count(*)::int n from pg_class where relkind='r' and relname like 'crm_recovery_%' and not relrowsecurity"))[0].n,0);
});

test('registration wrapper atomically recovers a paid client, returns the persisted XP receipt and replays without creating another call or award', async () => {
 const {assigned_client_ids:clients}=await state(1,true);
 await act(clients[0],'contacted',{request:15000});
 const payload={operation_id:id(15001),cliente_id:clients[0],telefonista_worker_id:ISA,cliente_compra_minutos:true,importe:20,recuperado:true,expected_free:0};
 const register=async p=>(await sql('select tc_register_call_recovery($1,$2) v',[id(1),p]))[0].v;
 const first=await register(payload);
 assert.equal(first.recovery.xp,75);
 assert.equal(first.recovery.xp_event.worker_id,ISA);
 assert.equal(first.recovery.counted,true);
 assert.equal(first.recovery.mission.recovered,1);
 const replay=await register({...payload,expected_free:999,note_text:'Server refreshed balance'});
 assert.equal(replay.duplicate_prevented,true);
 assert.equal(replay.recovery.xp,0);
 assert.equal(replay.recovery.xp_event,null);
 assert.equal(replay.recovery.counted,false);
 assert.equal((await sql('select count(*)::int n from test_registered_calls'))[0].n,1);
 assert.equal((await sql('select count(*)::int n from crm_cliente_pagos'))[0].n,1);
 await assert.rejects(register({...payload,importe:21}),/OPERATION_CONFLICT/);
 const subsequent=await register({...payload,operation_id:id(15002)});
 assert.equal(subsequent.recovery.duplicate_prevented,true);
 assert.equal(subsequent.recovery.xp_event,null);
 assert.equal((await state()).recovered,1);
 assert.equal((await sql("select count(*)::int n from worker_xp_events where action_key='client_recovery'"))[0].n,1);
});

test('registration wrapper rolls back both call and payment if recovery is invalid, and rejects spoofed workers or unpaid intentions', async () => {
 const {assigned_client_ids:clients}=await state(1,true);
 await act(clients[0],'contacted',{request:16000});
 const payload={operation_id:id(16001),cliente_id:clients[0],telefonista_worker_id:ISA,cliente_compra_minutos:true,importe:20,recuperado:true};
 const register=async p=>(await sql('select tc_register_call_recovery($1,$2) v',[id(1),p]))[0].v;
 await assert.rejects(register({...payload,test_payment_state:'pending'}),/PAYMENT_REQUIRED/);
 assert.equal((await sql('select count(*)::int n from test_registered_calls'))[0].n,0);
 assert.equal((await sql('select count(*)::int n from crm_cliente_pagos'))[0].n,0);
 assert.equal((await sql('select count(*)::int n from worker_xp_events'))[0].n,0);
 await assert.rejects(register({...payload,telefonista_worker_id:MARIA}),/FORBIDDEN/);
 await assert.rejects(register({...payload,cliente_compra_minutos:false}),/PAYMENT_REQUIRED/);
 await assert.rejects(register({...payload,cliente_id:clients[1]}),/CONTACT_FIRST/);
});

test('pre-purchase eligibility survives a source tag added by registration, while an already ineligible client is rejected', async () => {
 const {assigned_client_ids:clients}=await state(1,true);
 await act(clients[0],'contacted',{request:17000});
 await act(clients[1],'contacted',{request:17001});
 await sql("insert into crm_etiquetas(id,nombre) values($1,'CALL MARIO') on conflict do nothing",[id(17002)]);
 const payload={operation_id:id(17003),cliente_id:clients[0],telefonista_worker_id:ISA,cliente_compra_minutos:true,importe:20,recuperado:true,source_tag_id:id(17002)};
 const result=(await sql('select tc_register_call_recovery($1,$2) v',[id(1),payload]))[0].v;
 assert.equal(result.recovery.xp,75);
 assert.equal(result.recovery.counted,true);
 assert.equal((await sql('select eligible from tc_recovery_candidates where id=$1',[clients[0]]))[0].eligible,false);
 await sql('insert into crm_cliente_etiquetas values($1,$2)',[clients[1],id(17002)]);
 await assert.rejects(sql('select tc_register_call_recovery($1,$2)',[id(1),{...payload,operation_id:id(17004),cliente_id:clients[1]}]),/NOT_ELIGIBLE/);
 assert.equal((await sql('select count(*)::int n from test_registered_calls'))[0].n,1);
});

test('preparation replaces unusable uncounted contacts while retaining assignment history and completed work', async () => {
 const {assigned_client_ids:clients}=await state(1,true);
 await act(clients[0],'recycled',{request:18000});
 await act(clients[1],'contacted',{request:18001});
 await act(clients[1],'recycled',{request:18002});
 await sql("insert into crm_etiquetas(id,nombre) values($1,'OCTUBRE2026') on conflict do nothing",[id(18003)]);
 await sql('insert into crm_cliente_etiquetas values($1,$2)',[clients[2],id(18003)]);
 const replacement=await state(1,true);
 assert.equal(replacement.assigned_count,30);
 assert.equal(replacement.managed,1);
 assert.equal(replacement.shortage,0);
 assert.ok(!replacement.assigned_client_ids.includes(clients[0]));
 assert.ok(replacement.assigned_client_ids.includes(clients[1]));
 assert.ok(!replacement.assigned_client_ids.includes(clients[2]));
 assert.equal((await sql('select count(*)::int n from crm_recovery_mission_assignments'))[0].n,32);
 const list=(await sql("select tc_recovery_mission_list($1,'pending','','','',1) v",[id(1)]))[0].v;
 assert.equal(list.total,29); // 1 valid management is already in the recycling history.
 assert.ok(!list.contacts.some(c=>c.id===clients[2]));
});
