const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261029122807_staff_chat_read_receipts.sql'),'utf8');
// Exact existing unread RPC captured from production; all rows below are fictitious.
const existingUnreadRpc="CREATE OR REPLACE FUNCTION public.staff_chat_unread_counts(p_worker_id uuid, p_thread_ids uuid[])\n RETURNS TABLE(thread_id uuid, unread_count bigint)\n LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$\r\n  select m.thread_id, count(*)::bigint\r\n  from public.chat_messages m\r\n  left join public.chat_thread_reads r\r\n    on r.thread_id = m.thread_id and r.worker_id = p_worker_id\r\n  where m.thread_id = any(p_thread_ids)\r\n    and m.sender_worker_id <> p_worker_id\r\n    and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)\r\n  group by m.thread_id;\r\n$function$\n";
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const existingParticipantPolicies="create policy chat_messages_participant_insert on public.chat_messages for insert to authenticated with check ((EXISTS ( SELECT 1\n   FROM (chat_threads t\n     JOIN current_worker() cw(worker_id, role) ON (true))\n  WHERE ((t.id = chat_messages.thread_id) AND (cw.worker_id = chat_messages.sender_worker_id) AND ((cw.role = 'admin'::text) OR (cw.worker_id = t.central_worker_id) OR (cw.worker_id = t.tarotist_worker_id))))));\ncreate policy chat_messages_participant_select on public.chat_messages for select to authenticated using ((EXISTS ( SELECT 1\n   FROM (chat_threads t\n     JOIN current_worker() cw(worker_id, role) ON (true))\n  WHERE ((t.id = chat_messages.thread_id) AND ((cw.role = 'admin'::text) OR (cw.worker_id = t.central_worker_id) OR (cw.worker_id = t.tarotist_worker_id))))));\ncreate policy chat_reads_own_insert on public.chat_thread_reads for insert to authenticated with check ((EXISTS ( SELECT 1\n   FROM current_worker() cw(worker_id, role)\n  WHERE (cw.worker_id = chat_thread_reads.worker_id))));\ncreate policy chat_reads_own_select on public.chat_thread_reads for select to authenticated using ((EXISTS ( SELECT 1\n   FROM current_worker() cw(worker_id, role)\n  WHERE (cw.worker_id = chat_thread_reads.worker_id))));\ncreate policy chat_reads_own_update on public.chat_thread_reads for update to authenticated using ((EXISTS ( SELECT 1\n   FROM current_worker() cw(worker_id, role)\n  WHERE (cw.worker_id = chat_thread_reads.worker_id)))) with check ((EXISTS ( SELECT 1\n   FROM current_worker() cw(worker_id, role)\n  WHERE (cw.worker_id = chat_thread_reads.worker_id))));\ncreate policy chat_threads_participant_insert on public.chat_threads for insert to authenticated with check (((central_worker_id IS NOT NULL) AND (EXISTS ( SELECT 1\n   FROM current_worker() cw(worker_id, role)\n  WHERE ((cw.role = 'admin'::text) OR (cw.worker_id = chat_threads.central_worker_id) OR (cw.worker_id = chat_threads.tarotist_worker_id))))));\ncreate policy chat_threads_participant_select on public.chat_threads for select to authenticated using ((EXISTS ( SELECT 1\n   FROM current_worker() cw(worker_id, role)\n  WHERE ((cw.role = 'admin'::text) OR (cw.worker_id = chat_threads.central_worker_id) OR (cw.worker_id = chat_threads.tarotist_worker_id)))));\ncreate policy chat_threads_participant_update on public.chat_threads for update to authenticated using ((EXISTS ( SELECT 1\n   FROM current_worker() cw(worker_id, role)\n  WHERE ((cw.role = 'admin'::text) OR (cw.worker_id = chat_threads.central_worker_id) OR (cw.worker_id = chat_threads.tarotist_worker_id))))) with check ((EXISTS ( SELECT 1\n   FROM current_worker() cw(worker_id, role)\n  WHERE ((cw.role = 'admin'::text) OR (cw.worker_id = chat_threads.central_worker_id) OR (cw.worker_id = chat_threads.tarotist_worker_id)))));";
let db,originalUnreadDefinition;
const scalar=async(sql,params=[])=>(await db.query(sql,params)).rows[0].v;
const ack=(worker,thread,message)=>scalar('select staff_chat_mark_read($1,$2,$3) v',[id(worker),id(thread),id(message)]);
const unread=(worker,thread)=>scalar('select coalesce((select unread_count from staff_chat_unread_counts($1,array[$2]::uuid[])),0)::int v',[id(worker),id(thread)]);
before(async()=>{
 db=new PGlite();
 await db.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to anon,authenticated,service_role;
 create table workers(id uuid primary key,role text not null,is_active boolean not null default true,user_id uuid unique,state text default 'offline');
 alter table workers enable row level security;
 create policy workers_select_self on workers for select to authenticated using(user_id=(select auth.uid()));
 grant select on workers to authenticated;
 create function current_worker() returns table(worker_id uuid,role text) language sql stable as $$select w.id,w.role from public.workers w where w.user_id=auth.uid() limit 1$$;
 create table chat_threads(id uuid primary key,central_worker_id uuid,tarotist_worker_id uuid not null,status text default 'open');
 create table chat_messages(id uuid primary key,thread_id uuid not null references chat_threads(id),sender_worker_id uuid not null references workers(id),sender_display_name text,body text not null,created_at timestamptz not null default now());
 create index chat_messages_thread_created_idx on chat_messages(thread_id,created_at);
 create table chat_thread_reads(thread_id uuid not null references chat_threads(id),worker_id uuid not null references workers(id),last_read_at timestamptz not null default now(),updated_at timestamptz not null default now(),constraint chat_thread_reads_pkey primary key(thread_id,worker_id));
 alter table chat_threads enable row level security;alter table chat_messages enable row level security;alter table chat_thread_reads enable row level security;
 grant all on chat_threads,chat_messages,chat_thread_reads to anon,authenticated;
 grant select,update on workers,chat_threads to service_role;
 grant select on chat_messages to service_role;
 grant select,insert,update on chat_thread_reads to service_role;
 `);
 await db.exec(existingParticipantPolicies);
 for(const [n,role,active] of [[1,'central',true],[2,'tarotista',true],[3,'central',true],[4,'tarotista',true],[5,'admin',true],[6,'tarotista',false]])await db.query('insert into workers(id,role,is_active,user_id) values($1,$2,$3,$1)',[id(n),role,active]);
 for(const [n,c,t] of [[10,1,2],[11,3,4],[12,null,2],[13,1,6]])await db.query('insert into chat_threads(id,central_worker_id,tarotist_worker_id) values($1,$2,$3)',[id(n),c===null?null:id(c),id(t)]);
 for(const [n,t,s,at] of [[100,10,2,'2026-10-20T10:00:00Z'],[101,10,2,'2026-10-20T10:01:00Z'],[102,10,1,'2026-10-20T10:02:00Z'],[103,11,4,'2026-10-20T10:03:00Z'],[104,12,1,'2026-10-20T10:04:00Z'],[105,13,1,'2026-10-20T10:05:00Z']])await db.query('insert into chat_messages values($1,$2,$3,$4,$5,$6)',[id(n),id(t),id(s),'Fixture worker','Fixture message '+n,at]);
 await db.exec(existingUnreadRpc);
 originalUnreadDefinition=await scalar("select pg_get_functiondef('staff_chat_unread_counts(uuid,uuid[])'::regprocedure) v");
 await db.exec(migration);await db.exec(migration);
});
after(async()=>{await db?.close();});

test('ack uses the displayed message timestamp; a later unseen message remains unread',async()=>{
 assert.equal(await unread(1,10),2);
 const readAt=await ack(1,10,100);
 assert.equal(readAt.toISOString(),'2026-10-20T10:00:00.000Z');
 assert.equal(await unread(1,10),1);
 assert.equal(await scalar('select count(*)::int v from chat_thread_reads where worker_id=$1',[id(2)]),0);
});

test('read cursors are monotonic and independent per worker, including queued acknowledgements',async()=>{
 await Promise.all([ack(1,10,101),ack(1,10,100),ack(1,10,101)]);
 assert.equal(await unread(1,10),0);
 const before=await scalar('select updated_at v from chat_thread_reads where worker_id=$1 and thread_id=$2',[id(1),id(10)]);
 await ack(1,10,100);
 const after=await scalar('select updated_at v from chat_thread_reads where worker_id=$1 and thread_id=$2',[id(1),id(10)]);
 assert.equal(after.toISOString(),before.toISOString());
 assert.equal(await unread(2,10),1);
 await ack(2,10,101);
 assert.equal(await unread(2,10),1); // sender1 message102 remains unseen
 assert.equal(await unread(1,10),0);
});

test('foreign participant, inactive worker and wrong-thread message fail without a write',async()=>{
 for(const args of [[3,10,100],[6,13,105],[1,11,103]])await assert.rejects(ack(...args),/FORBIDDEN/);
 await assert.rejects(ack(1,10,103),/MESSAGE_NOT_FOUND/);
 await assert.rejects(ack(1,10,999),/MESSAGE_NOT_FOUND/);
 assert.equal(await scalar('select count(*)::int v from chat_thread_reads where worker_id in($1,$2)',[id(3),id(6)]),0);
});

test('admin supervision and historical unassigned threads preserve isolated receipts',async()=>{
 await ack(5,11,103);
 assert.equal(await unread(3,11),1);
 await ack(2,12,104);assert.equal(await unread(2,12),0);
 await assert.rejects(ack(1,12,104),/FORBIDDEN/);
});

test('batch latest incoming filters private threads and excludes the requesting sender',async()=>{
 const c=await db.query('select * from staff_chat_latest_incoming($1,$2::uuid[])',[id(1),[id(10),id(11),id(12)]]);
 assert.equal(c.rows.length,1);assert.equal(c.rows[0].id,id(101));assert.equal(c.rows[0].thread_id,id(10));
 const t=await db.query('select * from staff_chat_latest_incoming($1,$2::uuid[])',[id(2),[id(10),id(11),id(12)]]);
 assert.deepEqual(t.rows.map(r=>r.id).sort(),[id(102),id(104)]);
 const inactive=await db.query('select * from staff_chat_latest_incoming($1,$2::uuid[])',[id(6),[id(13)]]);
 assert.equal(inactive.rows.length,0);
 const admin=await db.query('select * from staff_chat_latest_incoming($1,$2::uuid[])',[id(5),[id(10),id(11)]]);
 assert.equal(admin.rows.length,2);
});

test('new RPCs deny anon/authenticated, allow service_role and preserve the existing unread function',async()=>{
 for(const role of ['anon','authenticated'])for(const table of ['chat_threads','chat_messages','chat_thread_reads']){
  assert.equal(await scalar('select has_table_privilege($1,$2,\'SELECT\') v',[role,table]),true);
  for(const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])assert.equal(await scalar('select has_table_privilege($1,$2,$3) v',[role,table,privilege]),false);
 }
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  try{
   await assert.rejects(ack(1,10,101),/permission denied for function staff_chat_mark_read/);
   await assert.rejects(db.query('select * from staff_chat_latest_incoming($1,$2::uuid[])',[id(1),[id(10)]]),/permission denied for function staff_chat_latest_incoming/);
  }finally{await db.exec('reset role');}
 }
 await db.exec('set role service_role');
 try{await ack(1,10,101);assert.equal((await db.query('select * from staff_chat_latest_incoming($1,$2::uuid[])',[id(1),[id(10)]])).rows.length,1);}
 finally{await db.exec('reset role');}
 assert.equal(await scalar("select pg_get_functiondef('staff_chat_unread_counts(uuid,uuid[])'::regprocedure) v"),originalUnreadDefinition);
 assert.equal(await scalar("select count(*)::int v from pg_proc where proname in('staff_chat_mark_read','staff_chat_latest_incoming') and prosecdef"),0);
});

test('future-dated messages cannot swallow future unread messages',async()=>{
 await db.query("insert into chat_messages values($1,$2,$3,'Fixture','Future',now()+interval '1 day')",[id(106),id(10),id(2)]);
 await assert.rejects(ack(1,10,106),/INVALID_MESSAGE_TIMESTAMP/);
 assert.equal(await unread(1,10),1);
 await db.query('delete from chat_messages where id=$1',[id(106)]);
});

test('unread count includes all messages beyond the displayed page',async()=>{
 for(let n=0;n<121;n++)await db.query("insert into chat_messages values($1,$2,$3,'Fixture','Unread',timestamptz '2026-10-21T10:00:00Z'+$4*interval '1 second')",[id(1000+n),id(11),id(4),n]);
 assert.equal(await unread(3,11),122);
 await ack(3,11,1050);
 assert.equal(await unread(3,11),70);
});

test('active offline workers retain Realtime SELECT, but deactivated workers lose it with the same JWT',async()=>{
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(1)]);
 await db.exec('set role authenticated');
 try{
  assert.ok(await scalar('select count(*)::int v from chat_threads')>0);
  assert.ok(await scalar('select count(*)::int v from chat_messages')>0);
  assert.ok(await scalar('select count(*)::int v from chat_thread_reads')>0);
  assert.equal(await scalar('select count(*)::int v from chat_threads where id=$1',[id(11)]),0);
 }finally{await db.exec('reset role');}
 await db.query('update workers set is_active=false where id=$1',[id(1)]);
 await db.exec('set role authenticated');
 try{for(const table of ['chat_threads','chat_messages','chat_thread_reads'])assert.equal(await scalar('select count(*)::int v from '+table),0);}
 finally{await db.exec('reset role');await db.query('update workers set is_active=true where id=$1',[id(1)]);}
});

