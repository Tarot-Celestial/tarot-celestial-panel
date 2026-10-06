const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
let db;const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const scalar=async(q,p=[])=>(await db.query(q,p)).rows[0].v;
const list=(bucket='pending',status='',search='',tag='',page=1)=>scalar('select tc_recovery_list($1,$2,$3,$4,$5,$6) v',[id(101),bucket,status,search,tag,page]);
const act=(client,action,version,payment=null,user=101)=>scalar('select tc_recovery_act($1,$2,$3,$4,$5,$6) v',[id(user),id(client),action,version,payment?id(payment):null,'Nota de prueba']);
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table workers(id uuid primary key,user_id uuid,role text,display_name text,is_active boolean);
 create table crm_clientes(id uuid primary key,nombre text,apellido text,telefono text,origen text);
 create table crm_etiquetas(id uuid primary key,nombre text);
 create table crm_cliente_etiquetas(cliente_id uuid references crm_clientes(id),etiqueta_id uuid references crm_etiquetas(id));
 create table crm_cliente_pagos(id uuid primary key,cliente_id uuid references crm_clientes(id),importe numeric,estado text,created_at timestamptz);
 create table worker_xp_rules(action_key text primary key,name text,description text,xp_reward int,frequency text,enabled boolean,integration_status text);
 create table worker_xp_events(id uuid primary key default gen_random_uuid(),worker_id uuid references workers(id),action_key text references worker_xp_rules(action_key),xp_amount int,reference_id text,reference_label text,origin text,status text,metadata jsonb,created_by_worker_id uuid,created_at timestamptz default now());
 `);
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261006182809_client_recovery.sql'),'utf8'));
 for(const [n,role,active] of [[101,'central',true],[102,'central',true],[103,'admin',true],[104,'central',false],[105,'tarotista',true]])await db.query('insert into workers values($1,$1,$2,$3,$4)',[id(n),role,'Operadora '+n,active]);
 const labels=['JUNIO2026','JULIO2026','MAYO 2025','VIP','ENERO2027','2026-06','AGOSTO2026'];
 for(let i=0;i<labels.length;i++)await db.query('insert into crm_etiquetas values($1,$2)',[id(201+i),labels[i]]);
 for(let n=1;n<=35;n++)await db.query('insert into crm_clientes values($1,$2,$3,$4,$5)',[id(n),'Clienta '+String(n).padStart(2,'0'),'Ejemplo','+34 600 '+String(n).padStart(6,'0'),n===7?'tarot_orion':'tarot_celestial']);
 for(const [c,t] of [[1,201],[2,202],[3,203],[3,202],[4,204],[5,205],[6,206],[8,207]])await db.query('insert into crm_cliente_etiquetas values($1,$2)',[id(c),id(t)]);
 });
after(async()=>db.close());
test('Date labels, including old/fresh boundaries and ambiguous labels',async()=>{
 for(const [label,expected] of [['JUNIO2026',202606],['JULIO2026',202607],[' junio 2026 ',202606],['JUN-2026',202606],['06/2026',202606],['2026-07',202607],['SEPTIEMBRE2025',202509],['SET2025',202509],['2025',202512],['2026',202612],['VIP',null],['JUNIO2025 JULIO2026',202607]])assert.equal(await scalar('select tc_recovery_tag_month($1) v',[label]),expected,label);
});
test('Candidates exclude fresh labels, mixed fresh+old, other brand and non-date-only labels',async()=>{
 const data=await list();assert.equal(data.total,29);assert.equal(data.contacts.length,25);const all=[...data.contacts,...(await list('pending','','','',2)).contacts].map(c=>c.id);
 for(const n of [2,3,4,5,7,8])assert.ok(!all.includes(id(n)));for(const n of [1,6,9])assert.ok(all.includes(id(n)));
 assert.equal((await list('pending','','','__none__')).total,27);assert.equal((await list('pending','','600000001')).total,1);
});
test('Unauthenticated, inactive and wrong role cannot list or mutate',async()=>{
 for(const n of [104,105,999]){await assert.rejects(scalar('select tc_recovery_list($1) v',[id(n)]),/FORBIDDEN/);await assert.rejects(act(1,'contacted',0,null,n),/FORBIDDEN/);}
 await assert.rejects(act(2,'contacted',0),/NOT_ELIGIBLE/);
});
test('Contact orange, no response, recycle and restore retain owner, history and dates',async()=>{
 await act(1,'contacted',0);let row=await scalar('select to_jsonb(r) v from crm_client_recovery r where client_id=$1',[id(1)]);const when=row.contacted_at;assert.equal(row.responsible_id,id(101));
 await assert.rejects(act(1,'no_response',0),/STALE_VERSION/);await assert.rejects(act(1,'recycled',1,null,102),/OTHER_OWNER/);
 await act(1,'no_response',1);assert.equal((await list('pending','no_response')).total,1);
 await act(1,'recycled',2);assert.equal((await list('recycled')).total,1);
 await assert.rejects(act(1,'contacted',3),/RESTORE_FIRST/);await act(1,'restore',3);
 row=await scalar('select to_jsonb(r) v from crm_client_recovery r where client_id=$1',[id(1)]);assert.equal(row.status,'contacted');assert.equal(row.contacted_at,when);
 assert.equal(await scalar('select count(*)::int v from crm_client_recovery_history where client_id=$1',[id(1)]),4);
 assert.equal(await scalar('select count(*)::int v from worker_xp_events'),0);
});
test('Payment must be completed, positive, same client and after the contact',async()=>{
 await assert.rejects(act(9,'recovered',0,301),/CONTACT_FIRST/);
 for(const [n,client,amount,state,delta] of [[301,1,20,'completed',-86400000],[302,1,20,'pending',0],[303,10,20,'completed',0],[304,1,0,'completed',0],[305,1,20,'completed',86400000]]){
 await db.query('insert into crm_cliente_pagos values($1,$2,$3,$4,$5)',[id(n),id(client),amount,state,new Date(Date.now()+delta).toISOString()]);
 await assert.rejects(act(1,'recovered',4,n),/PAYMENT_REQUIRED/);
 }assert.equal(await scalar('select count(*)::int v from worker_xp_events'),0);
});
test('Confirmed purchase atomically moves card and grants 75 XP once to original owner',async()=>{
 await db.query('insert into crm_cliente_pagos values($1,$2,25,\'completed\',now())',[id(306),id(1)]);
 const detail=await scalar('select tc_recovery_detail($1,$2) v',[id(101),id(1)]);assert.equal(detail.payments.length,1);
 const result=await act(1,'recovered',4,306,102);assert.equal(result.xp,75);assert.equal((await list('recovered')).total,1);
 const event=await scalar('select to_jsonb(e) v from worker_xp_events e');assert.equal(event.worker_id,id(101));assert.equal(event.created_by_worker_id,id(102));assert.equal(event.xp_amount,75);
 await act(1,'recovered',4,306,102);await act(1,'recycled',5);assert.equal(await scalar('select count(*)::int v from worker_xp_events'),1);
 assert.equal((await list('recovered')).contacts[0].purchase_amount,25);
});
test('XP insert failure rolls back recovery, payment link and history',async()=>{
 await act(10,'contacted',0);await db.query('insert into crm_cliente_pagos values($1,$2,30,\'completed\',now())',[id(310),id(10)]);
 await db.exec(`create function reject_recovery_xp() returns trigger language plpgsql as $$ begin raise exception 'SIMULATED_XP_FAILURE';end $$;create trigger reject_xp before insert on worker_xp_events for each row execute function reject_recovery_xp();`);
 await assert.rejects(act(10,'recovered',1,310),/SIMULATED_XP_FAILURE/);
 await db.exec('drop trigger reject_xp on worker_xp_events');
 const row=await scalar('select to_jsonb(r) v from crm_client_recovery r where client_id=$1',[id(10)]);assert.equal(row.status,'contacted');assert.equal(row.payment_id,null);assert.equal(row.version,1);
 assert.equal(await scalar('select count(*)::int v from crm_client_recovery_history where client_id=$1',[id(10)]),1);
});
test('RLS and function privileges block browser roles',async()=>{
 for(const role of ['anon','authenticated']){
 assert.equal(await scalar('select has_table_privilege($1,\'crm_client_recovery\',\'SELECT\') v',[role]),false);
 assert.equal(await scalar("select has_function_privilege($1,'tc_recovery_act(uuid,uuid,text,integer,uuid,text)','EXECUTE') v",[role]),false);
 }
 assert.equal(await scalar("select relrowsecurity v from pg_class where relname='crm_client_recovery'"),true);
});
test('RPC works with service-role grants; no definer privileges are needed',async()=>{
 await db.exec('grant select on workers,crm_clientes,crm_etiquetas,crm_cliente_etiquetas,crm_cliente_pagos,worker_xp_events,worker_xp_rules to service_role; grant insert on worker_xp_events to service_role; grant update on crm_cliente_pagos to service_role; set role service_role');
 try { assert.ok((await list()).total>0);await act(11,'contacted',0); } finally { await db.exec('reset role'); }
});
test('Repeated competing recovery requests keep exactly one XP event',async()=>{
 await db.query("insert into crm_cliente_pagos values($1,$2,20,'completed',now())",[id(311),id(11)]);
 const results=await Promise.all([act(11,'recovered',1,311),act(11,'recovered',1,311,102)]);
 assert.equal(results.filter(r=>r.already_recovered).length,1);
 assert.equal(await scalar("select count(*)::int v from worker_xp_events where reference_id=$1",['client_recovery:'+id(11)]),1);
});
test('Migration can be run again without erasing states or granting more XP',async()=>{
 const count=await scalar('select count(*)::int v from worker_xp_events');
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261006182809_client_recovery.sql'),'utf8'));
 assert.equal(await scalar('select count(*)::int v from worker_xp_events'),count);
 assert.equal((await list('recovered')).total,2);
});
