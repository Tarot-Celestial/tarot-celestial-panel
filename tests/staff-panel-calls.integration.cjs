const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261108205853_staff_panel_audio_calls.sql'),'utf8');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const sdp='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=candidate:fixture\r\n';
let db;
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table workers(id uuid primary key,display_name text,role text,is_active boolean,user_id uuid,auth_user_id uuid);
 create table chat_threads(id uuid primary key,central_worker_id uuid,tarotist_worker_id uuid);
 create function tc_has_admin_access(p_user_id uuid) returns boolean language sql as $$select p_user_id='${id(5)}'::uuid$$;
 grant select on workers,chat_threads to service_role;
 insert into workers values('${id(1)}','Central','central',true,'${id(1)}',null),('${id(2)}','Tarotista','tarotista',true,'${id(2)}',null),('${id(3)}','Other','central',true,'${id(3)}',null),('${id(4)}','Inactive','tarotista',false,'${id(4)}',null),('${id(5)}','Supervisor','central',true,'${id(5)}',null),('${id(6)}','Orphan','central',true,null,null);
 insert into chat_threads values('${id(10)}','${id(1)}','${id(2)}'),('${id(11)}','${id(3)}','${id(2)}'),('${id(12)}','${id(1)}','${id(4)}');`);
 await db.exec(migration);await db.exec(migration);
});
after(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('reset role;truncate staff_panel_calls;');});
async function action(actor,call,what,tab,thread=null,target=null,description=null){
 await db.exec('set role service_role');
 try{return (await db.query('select staff_panel_call_action($1,$2,$3,$4,$5,$6,$7) result',[id(actor),id(call),what,id(tab),thread&&id(thread),target&&id(target),description])).rows[0].result;}
 finally{await db.exec('reset role');}
}
const start=(caller=1,call=100,tab=201,thread=10,target=2)=>action(caller,call,'start',tab,thread,target,sdp);

test('service role starts invitation with actual worker attribution and no granted audio access',async()=>{
 const row=await start();assert.equal(row.status,'ringing');assert.equal(row.caller_name,'Central');assert.equal(row.callee_name,'Tarotista');assert.equal(row.callee_tab_id,null);assert.equal(row.answer_sdp,null);
 assert.ok(Date.parse(row.expires_at)-Date.parse(row.created_at)<=75000);
});
test('start is idempotent per stable call id; different ownership cannot overwrite',async()=>{
 const a=await start(),b=await start();assert.equal(a.id,b.id);assert.equal((await db.query('select count(*)::int n from staff_panel_calls')).rows[0].n,1);
 await assert.rejects(start(1,100,299),/CALL_ID_CONFLICT/);
});
test('worker can have only one live call, including crossed incoming/outgoing calls',async()=>{
 await start();await assert.rejects(start(2,101,202,10,1),/CALL_BUSY/);await assert.rejects(start(3,102,203,11,2),/CALL_BUSY/);
});
test('only participants or delegated supervisor can start, and target belongs to thread',async()=>{
 await assert.rejects(start(3),/FORBIDDEN/);await assert.rejects(start(6),/FORBIDDEN/);await assert.rejects(start(1,100,201,10,3),/FORBIDDEN/);
 const row=await start(5);assert.equal(row.caller_name,'Supervisor');assert.equal(row.caller_worker_id,id(5));
});
test('inactive target, self calls and video descriptions rejected',async()=>{
 await assert.rejects(start(1,100,201,12,4),/CONTACT_NOT_FOUND/);
 await assert.rejects(start(1,100,201,10,1),/FORBIDDEN/);
 await assert.rejects(action(1,100,'start',201,10,2,sdp+'m=video 9 RTP/AVP 96\r\n'),/INVALID_CALL_SDP/);
 await assert.rejects(action(1,100,'start',201,10,2,'x'.repeat(50000)),/INVALID_CALL_SDP/);
});
test('only recipient can answer, one tab owns accepted call, duplicate same tab harmless',async()=>{
 await start();await assert.rejects(action(1,100,'answer',201,null,null,sdp),/FORBIDDEN/);
 const row=await action(2,100,'answer',202,null,null,sdp);assert.equal(row.status,'accepted');assert.equal(row.callee_tab_id,id(202));
 assert.deepEqual(await action(2,100,'answer',202,null,null,sdp),row);
 await assert.rejects(action(2,100,'answer',203,null,null,sdp),/CALL_ALREADY_ANSWERED/);
});
test('outsider including administrator cannot end or heartbeat another call',async()=>{
 await start();await assert.rejects(action(3,100,'end',203),/FORBIDDEN/);await assert.rejects(action(5,100,'end',205),/FORBIDDEN/);
 await assert.rejects(action(1,100,'heartbeat',202),/CALL_ALREADY_ANSWERED/);
});
test('reject and hangup are idempotent, erase network signaling, release busy slot',async()=>{
 await start();const row=await action(2,100,'reject',202);assert.equal(row.status,'rejected');assert.equal(row.offer_sdp,null);assert.equal(row.answer_sdp,null);
 assert.equal((await action(2,100,'reject',202)).status,'rejected');
 const next=await start(1,101);assert.equal(next.status,'ringing');assert.equal((await action(1,101,'end',201)).status,'ended');
});
test('expired invitation cannot be answered and new call clears expired signaling',async()=>{
 await start();await db.query("update staff_panel_calls set expires_at=now()-interval '1 second' where id=$1",[id(100)]);
 const row=await action(2,100,'answer',202,null,null,sdp);assert.equal(row.status,'missed');assert.equal(row.offer_sdp,null);
 assert.equal((await start(1,101)).status,'ringing');
});
test('heartbeat cannot keep a call alive when the other panel disappears',async()=>{
 await start();await action(2,100,'answer',202,null,null,sdp);
 await db.query("update staff_panel_calls set callee_seen_at=now()-interval '80 seconds' where id=$1",[id(100)]);
 const row=await action(1,100,'heartbeat',201);assert.ok(Date.parse(row.expires_at)-Date.now()<11000);
});
test('browser roles cannot read signaling or invoke privileged mutation',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);
  await assert.rejects(db.query('select * from staff_panel_calls'),/permission denied/);
  await assert.rejects(db.query('select staff_panel_call_action($1,$2,$3,$4)',[id(1),id(100),'end',id(201)]),/permission denied/);
  await db.exec('reset role');
 }
 const row=(await db.query("select prosecdef,proconfig from pg_proc where oid='staff_panel_call_action(uuid,uuid,text,uuid,uuid,uuid,text)'::regprocedure")).rows[0];assert.equal(row.prosecdef,false);assert.ok(row.proconfig.some(value=>value==='search_path=""'));
});
