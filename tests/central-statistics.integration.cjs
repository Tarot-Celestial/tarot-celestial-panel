const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table workers(id uuid primary key,user_id uuid,display_name text,role text,is_active boolean,salary_base numeric);
 create table crm_clientes(id uuid primary key,origen text);
 create table crm_cliente_pagos(id uuid primary key,cliente_id uuid,importe numeric,moneda text,created_at timestamptz,created_by_user_id uuid,created_by_role text,estado text,source_rendimiento_id uuid);
 create table worker_xp_events(id uuid primary key,worker_id uuid,action_key text,xp_amount integer,status text,created_at timestamptz);
 create table crm_client_capture_audit(id uuid primary key,client_id uuid,new_responsible_worker_id uuid,actor_worker_id uuid,action text,created_at timestamptz);
 create table crm_client_recovery(client_id uuid primary key,responsible_id uuid,status text,recovered_at timestamptz);
 create table crm_recovery_contact_events(id uuid primary key,worker_id uuid,client_id uuid,contacted_at timestamptz,counted boolean);
 create table captacion_state_events(id uuid primary key,actor_worker_id uuid,cliente_id uuid,created_at timestamptz,source text);
 create table crm_client_followups(id uuid primary key,worker_id uuid,client_id uuid,completed_at timestamptz,status text);
 create table crm_client_notes(id uuid primary key,cliente_id text,author_user_id uuid,event_type text,created_at timestamptz);
 create table rendimiento_llamadas(id uuid primary key,telefonista_worker_id text,cliente_id text,fecha_hora timestamptz,tiempo numeric,importe numeric);
 create table captacion_leads(id uuid primary key,assigned_worker_id uuid,estado text);
 create table attendance_panel_sessions(id uuid primary key,worker_id uuid,started_at timestamptz,ended_at timestamptz,expires_at timestamptz);
 insert into workers values('${id(1)}','${id(11)}','Admin','admin',true,0),('${id(2)}','${id(12)}','Central A','central',true,400),('${id(3)}','${id(13)}','Central B','central',true,0);
 insert into crm_clientes values('${id(101)}','celestial'),('${id(102)}','celestial');
 insert into rendimiento_llamadas values('${id(201)}','${id(2)}','${id(101)}','2026-10-01 05:30Z',20,100);
 insert into crm_cliente_pagos values('${id(301)}','${id(101)}',100,'EUR','2026-10-01 05:30Z','${id(2)}','central','completed','${id(201)}'),('${id(302)}','${id(102)}',30,'EUR','2026-10-01 06:00Z',null,'cliente_webhook','completed',null),('${id(303)}','${id(102)}',200,'EUR','2026-10-01 06:00Z','${id(2)}','central','pending',null),('${id(304)}','${id(102)}',20,'EUR','2026-10-01 06:00Z','${id(13)}','central','completed',null),('${id(305)}','${id(102)}',50,'EUR','2026-10-01 04:59:59Z','${id(2)}','central','completed',null);
 insert into attendance_panel_sessions values('${id(401)}','${id(2)}','2026-10-01 05:00Z','2026-10-01 06:00Z','2026-10-01 06:00Z'),('${id(402)}','${id(2)}','2026-10-01 05:10Z','2026-10-01 06:00Z','2026-10-01 06:00Z');
 insert into crm_client_capture_audit values('${id(501)}','${id(101)}','${id(2)}','${id(3)}','capture_confirmed','2026-10-01 05:30Z'),('${id(502)}','${id(101)}','${id(2)}','${id(3)}','capture_confirmed','2026-10-01 05:31Z'),('${id(503)}','${id(102)}','${id(3)}','${id(3)}','baseline_to_corporate','2026-10-01 05:32Z');
 insert into worker_xp_events values('${id(601)}','${id(2)}','client_capture',75,'applied','2026-10-01 05:30Z'),('${id(602)}','${id(2)}','client_capture',1000,'reversed','2026-10-01 05:30Z'),('${id(603)}','${id(2)}','other',100,'applied','2026-09-01 05:30Z');
 insert into crm_recovery_contact_events values('${id(701)}','${id(2)}','${id(101)}','2026-10-01 05:40Z',true),('${id(702)}','${id(2)}','${id(101)}','2026-10-01 05:41Z',false);
 insert into captacion_state_events values('${id(801)}','${id(2)}','${id(101)}','2026-10-01 05:40Z','captacion_panel'),('${id(802)}','${id(3)}','${id(101)}','2026-10-01 05:40Z','capture_assignment');
 insert into crm_client_notes values('${id(850)}','${id(101)}','${id(12)}',null,'2026-10-01 05:40Z'),('${id(851)}','${id(101)}','${id(12)}','call_activity','2026-10-01 05:40Z');
 `);
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261028222853_central_statistics.sql'),'utf8'));
});
after(async()=>{await db?.close();});
const report=async()=> (await db.query("select tc_central_statistics('2026-10-01 05:00Z','2026-11-01 05:00Z') result")).rows[0].result;
test('canonical payments stay single despite linked call and overlapping sessions, web remains separate',async()=>{
 const r=await report(),a=r.workers.find(w=>w.id===id(2)),b=r.workers.find(w=>w.id===id(3));
 assert.equal(a.payments_count,1);assert.equal(a.payments_amount,100);assert.equal(a.payments_during_session_count,1);assert.equal(a.payments_during_session_amount,100);
 assert.equal(b.payments_amount,20);assert.equal(r.totals.payments_amount,150);assert.equal(r.totals.web_payments_amount,30);assert.equal(r.totals.web_payments_count,1);
});
test('capture belongs to original captor, not closer; duplicate audit and reversed XP do not inflate totals',async()=>{
 const r=await report(),a=r.workers.find(w=>w.id===id(2)),b=r.workers.find(w=>w.id===id(3));
 assert.equal(a.captures_confirmed,1);assert.equal(b.captures_confirmed,0);assert.equal(a.xp_earned,75);assert.equal(a.xp_total,175);
 assert.equal(a.recovery_attempts,2);assert.equal(a.recovery_counted,1);assert.equal(a.capture_actions,1);assert.equal(b.capture_actions,0);assert.equal(a.unique_clients,1);
 assert.equal(a.notes_written,1);
});
test('offline corrections work without a session and preserve rate precision, bounds and concurrent-category protection',async()=>{
 const {rows:[{today}]}=await db.query("select (now() at time zone 'America/Guayaquil')::date::text today");
 const call=(action,payload,op)=>db.query('select tc_central_statistics_update($1,$2,$3,$4,$5) result',[id(1),id(3),action,JSON.stringify(payload),id(op)]);
 await call('settings',{monthly_salary_eur:0,overtime_hourly_rate_eur:1.6667,weekday_start:'07:00',weekday_end:'15:00',weekend_start:'09:00',weekend_end:'15:00'},930);
 const correction={date:today,minutes:60,category:'outside_schedule',reason:'Trabajo verificado durante corte total',expected_category_adjustment:0,expected_total_adjustment:0,category_recorded_minutes:0,total_recorded_minutes:0};
 await call('adjustment',correction,931);const retry=await call('adjustment',correction,931);assert.equal(retry.rows[0].result.duplicate_prevented,true);
 const rate=await db.query('select hourly_rate_eur::text rate from central_time_adjustments where id=$1',[id(931)]);assert.equal(rate.rows[0].rate,'1.6667');
 await assert.rejects(call('adjustment',{...correction,category:'ordinary'},932),/ADJUSTMENT_CHANGED/);
 await assert.rejects(call('adjustment',{...correction,category:'ordinary',expected_total_adjustment:60,minutes:1400,total_recorded_minutes:60},933),/INVALID_DAILY_HOURS/);
 await assert.rejects(call('adjustment',{...correction,category:'ordinary',expected_total_adjustment:60,minutes:-1,total_recorded_minutes:60},934),/NEGATIVE_RECORDED_HOURS/);
});
test('new ledgers and service RPCs are inaccessible to browser roles',async()=>{
 const r=await db.query("select has_function_privilege('anon','tc_central_statistics(timestamptz,timestamptz)','EXECUTE') a,has_table_privilege('authenticated','central_time_adjustments','INSERT') b,relrowsecurity rls from pg_class where relname='central_time_adjustments'");
 assert.equal(r.rows[0].a,false);assert.equal(r.rows[0].b,false);assert.equal(r.rows[0].rls,true);
 await assert.rejects(db.query("select tc_central_statistics('2026-10-01','2026-12-01')"),/INVALID_PERIOD/);
});
test('schedule settings require active admin, append versions and deduplicate retries',async()=>{
 const payload={monthly_salary_eur:400,overtime_hourly_rate_eur:null,weekday_start:'15:00',weekday_end:'23:00',weekend_start:'09:00',weekend_end:'15:00'};
 const call=(actor,op,values=payload)=>db.query('select tc_central_statistics_update($1,$2,$3,$4,$5) result',[actor,id(2),'settings',JSON.stringify(values),id(op)]);
 await assert.rejects(call(id(2),900),/FORBIDDEN/);
 const first=await call(id(1),901),retry=await call(id(1),901);assert.equal(retry.rows[0].result.duplicate_prevented,true);assert.equal(first.rows[0].result.version_id,retry.rows[0].result.version_id);
 await assert.rejects(call(id(1),901,{...payload,monthly_salary_eur:500}),/OPERATION_CONFLICT/);
 await call(id(1),902,{...payload,weekday_start:'14:00'});
 const rows=await db.query('select count(*) n,min(weekday_start)::text first from central_work_config_versions where worker_id=$1',[id(2)]);assert.equal(rows.rows[0].n,2);
});
test('weekend roster rejects two days per week, including adjacent month boundary',async()=>{
 const {rows:[{today}]}=await db.query("select (now() at time zone 'America/Guayaquil')::date::text today");
 let saturday=new Date(`${today}T12:00:00Z`);saturday.setUTCDate(saturday.getUTCDate()+1);while(saturday.getUTCDay()!==6)saturday.setUTCDate(saturday.getUTCDate()+1);
 const sunday=new Date(saturday);sunday.setUTCDate(sunday.getUTCDate()+1);const sat=saturday.toISOString().slice(0,10),sun=sunday.toISOString().slice(0,10);
 const call=(op,month,days)=>db.query('select tc_central_statistics_update($1,$2,$3,$4,$5)',[id(1),id(2),'weekends',JSON.stringify({month,days}),id(op)]);
 await call(910,sat.slice(0,7),[sat]);
 await assert.rejects(call(911,sun.slice(0,7),sat.slice(0,7)===sun.slice(0,7)?[sat,sun]:[sun]),/ONE_WEEKEND_DAY_PER_WEEK/);
 await assert.rejects(call(912,today.slice(0,7),[today]),/ONLY_FUTURE_WEEKEND_DATES/);
});
test('an immutable Saturday selection prevents adding Sunday in the same month',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261028222853_central_statistics.sql'),'utf8');
 const procedure=source.slice(source.indexOf('create or replace function public.tc_central_statistics_update'),source.indexOf('revoke all on function public.tc_central_statistics_update'));
 // Fix the database wall-clock boundary for this calendar scenario, preserving the procedure itself.
 await db.exec(procedure.replace("today date:=(clock_timestamp() at time zone 'America/Guayaquil')::date", "today date:='2026-10-10'::date"));
 try {
  await db.query("insert into central_workday_overrides(worker_id,work_date,is_working,start_time,end_time,created_by) values($1,'2026-10-10',true,'09:00','15:00',$2)",[id(3),id(1)]);
  await assert.rejects(db.query('select tc_central_statistics_update($1,$2,$3,$4,$5)',[id(1),id(3),'weekends',JSON.stringify({month:'2026-10',days:['2026-10-11']}),id(950)]),/ONE_WEEKEND_DAY_PER_WEEK/);
 }finally{await db.exec(procedure);}
});
