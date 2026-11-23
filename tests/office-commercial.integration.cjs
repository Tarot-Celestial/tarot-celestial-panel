const {test,before,beforeEach,after}=require("node:test");
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{randomUUID}=require("node:crypto");
const {PGlite}=require("@electric-sql/pglite");
let db;
const dir=path.join(__dirname,"../supabase/migrations");
const migration=suffix=>fs.readFileSync(path.join(dir,fs.readdirSync(dir).find(f=>f.endsWith("_"+suffix+".sql"))),"utf8");
const id=n=>"70000000-0000-4000-8000-"+String(n).padStart(12,"0");
const q=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]||{})[0];
const page=(actor=1,state="active",at=null,after=null,op=null)=>q("select office_commercial_page($1,$2,$3,$4,$5)",[id(actor),state,at,after,op]);
const change=(op,act,version,actor=1,outcome=null,note=null,request=randomUUID())=>q("select office_commercial_change($1,$2,$3,$4,$5,$6,$7)",[id(actor),op,request,version,act,outcome,note]);
const filter=op=>q("select office_capture_guard($1,false)",[op]);
const source=(channel,peer,source,body,status="pending")=>q(`insert into office_capture_opportunities(channel,account_id,kind,thread_key,source_id,source_at,
 latest_inbound_at,window_until,verified,recipient_id,inbound_text,status,last_error) values($1,'test-account','message',$2,$3,now()-interval '5 minutes',now()-interval '5 minutes',
 now()+interval '23 hours',true,$2,$4,$5,'NEEDS_PERSONAL_RESPONSE') returning id`,[channel,peer,source,body,status]);
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table public.workers(id uuid primary key,user_id uuid,role text,is_active boolean,display_name text);
 create function public.tc_has_admin_access(uuid) returns boolean language sql as $$ select exists(select from public.workers where user_id=$1 and role='admin' and is_active) $$;
 create table public.crm_clientes(id uuid primary key,nombre text,pais text,origen text);
 create table public.captacion_leads(id uuid primary key,cliente_id uuid,estado text,closed_at timestamptz,contacted_at timestamptz,last_contact_at timestamptz);
 create table public.tc_social_connections_v2(provider text,account_id text);
 create table public.tc_instagram_threads(id uuid,kind text,account_id text,recipient_id text,remote_id text,name text,remote_created_at timestamptz,remote_updated_at timestamptz,last_reply_at timestamptz,private_reply_sent boolean,merged_into uuid);
 create table public.tc_facebook_threads(like public.tc_instagram_threads,is_deleted boolean default false);
 create table public.tc_instagram_sends(request_id uuid,thread_id uuid,status text,created_at timestamptz,completed_at timestamptz);
 create table public.tc_facebook_sends(like public.tc_instagram_sends);
 create table public.tc_social_inbox_activity(provider text,account_id text,kind text,remote_id text,thread_remote_id text,removed_at timestamptz,
   id bigint generated always as identity,occurred_at timestamptz);
 create table public.captacion_whatsapp_deliveries(lead_id uuid,submission_key text);
 create table public.purchases(client_id uuid);
 create table public.office_departments(id text primary key);
 create table public.office_events(department_id text,actor_id uuid,kind text,note text,details jsonb);
 create table public.office_tasks(id uuid);
 create table public.office_runs(id uuid,status text,lease_token uuid,lease_until timestamptz,step int);
 create table public.office_run_attempts(usage jsonb,claimed_at timestamptz,step int,lease_token uuid);
 create table public.office_instagram_posts(id uuid,lease_token uuid,lease_until timestamptz,dispatch_started_at timestamptz,status text,
      persisted_account_id text,preparation_attempts int,updated_at timestamptz,next_attempt_at timestamptz);
 create table public.office_capture_settings(id boolean primary key,enabled boolean,actor_user_id uuid);
 create function public.office_actor(uuid) returns uuid language sql stable as $$ select w.id from public.workers w where w.user_id=$1 and w.role='admin' and w.is_active $$;
 create function public.tc_crm_first_purchases_batch(uuid[]) returns table(client_id uuid) language sql as $$ select p.client_id from public.purchases p where p.client_id=any($1) $$;`);
 await db.exec(migration("office_capture_opportunities"));
 for(const [n,role,active] of [[1,"central",true],[2,"central",true],[3,"admin",true],[4,"tarotista",true],[5,"central",false]]) {
   await q("insert into workers values($1,$2,$3,$4,$5)",[id(n+10),id(n),role,active,"Operador "+n]);
 }
 const historic=await source("whatsapp","hist","old","Fixture","handoff");
 await q("insert into office_capture_settings values(true,true,$1)",[id(3)]);
 await db.exec("insert into office_departments values('captacion-reservas'),('marketing'),('seguridad-accesos');grant select on all tables in schema public to service_role;grant update on office_capture_settings to service_role");
 await db.exec(migration("office_autonomy"));
 await db.exec(migration("office_commercial_inbox"));
 await db.exec(migration("office_commercial_reply_windows"));
 await db.exec(migration("office_instagram_immediate_reply"));
 await db.exec(migration("office_instagram_comment_claim"));
 assert.equal((await page()).items[0].opportunity_id,historic);
});
after(async()=>db?.close());
beforeEach(async()=>db.exec("truncate office_capture_opportunities,office_capture_attempts,office_capture_events,office_capture_inbound,office_capture_suppressions,office_commercial_changes,office_commercial_cases,purchases cascade"));
test("assignment, release, resolution and explicit return are audited, versioned and idempotent",async()=>{
 const op=await source("whatsapp","customer","m1","Fixture","handoff");
 const first=await page();assert.equal(first.items[0].reason,"NEEDS_PERSONAL_RESPONSE"); assert.equal(first.central_path,"/panel-central");
 const req=randomUUID();assert.equal((await change(op,"claim",1,1,null,null,req)).state,"claimed");
 assert.equal((await change(op,"claim",1,1,null,null,req)).version,2);
 await assert.rejects(change(op,"claim",2,2),/OFFICE_CONFLICT/);await assert.rejects(change(op,"release",2,2),/OFFICE_FORBIDDEN/);
 assert.equal((await change(op,"release",2)).state,"open");
 await change(op,"claim",3,2);
 await change(op,"resolve",4,2,"appointment","Reserva acordada");
 const resolved=(await page(1,"resolved")).items[0];assert.equal(resolved.owner_name,"Operador 2");assert.equal(resolved.note,"Reserva acordada");
 assert.equal(await filter(op),"commercial_intervention");
 await change(op,"return",5,2);assert.equal(await filter(op),"commercial_wait_new_inbound");
 await q("update office_capture_opportunities set source_id='m2',latest_inbound_at=clock_timestamp(),status='handoff' where id=$1",[op]);
 assert.equal(await filter(op),null);assert.equal(await q("select status from office_capture_opportunities where id=$1",[op]),"pending");
 assert.equal(await q("select count(*)::int from office_capture_events where action='commercial_returned'"),1);
});
test("una reacción revisada conserva su historial y sólo una nueva entrada verificada puede reactivar la atención",async()=>{
 const op=await source("facebook","same-peer","comment1","Amén","handoff");
 await q("update office_capture_opportunities set kind='comment' where id=$1",[op]);
 await change(op,"claim",1);await change(op,"resolve",2,1,"no_inquiry");
 assert.equal((await page(1,"resolved")).items[0].outcome,"no_inquiry");
 assert.equal(await filter(op),"commercial_wait_new_inbound");assert.equal((await page()).items.length,0);
 // A delayed retry on the already reviewed source cannot reopen it.
 await q("insert into office_capture_events(opportunity_id,action,detail) values($1,'handoff','NEEDS_PERSONAL_RESPONSE')",[op]);
 assert.equal((await page()).items.length,0);
 // A distinct, verified source for the same person is not a lasting suppression.
 const dm=await source("facebook","same-peer","dm1","¿Puedo consultar?");assert.equal(await q("select office_commercial_blocked($1)",[dm]),false);
 await q("update office_capture_opportunities set source_id='comment2',latest_inbound_at=clock_timestamp(),status='handoff' where id=$1",[op]);
 assert.equal(await q("select status from office_capture_opportunities where id=$1",[op]),"pending");
 await q("update office_capture_opportunities set status='handoff',last_error='NEEDS_PERSONAL_RESPONSE' where id=$1",[op]);
 assert.equal((await page()).items[0].state,"open");
 assert.equal(await q("select count(*)::int from office_commercial_changes where opportunity_id=$1 and input->>2='no_inquiry'",[op]),1);
 assert.equal(await q("select count(*)::int from office_capture_suppressions"),0);
});
test("la prioridad usa ventana nativa vigente y pagina por fecha de cierre, con desempate por oportunidad",async()=>{
 for(let i=0;i<28;i++){
   const op=await source("whatsapp","valid"+i,"message"+i,"Consulta","handoff");
   await q("update office_capture_opportunities set session_id='central', window_until=date_trunc('hour',now())+interval '3 hours' + ($2::int%2)*interval '2 hours' where id=$1",[op,i]);
 }
 const invalid=await source("whatsapp","foreign","foreign","Consulta","handoff");
 await q("update office_capture_opportunities set session_id='w-other' where id=$1",[invalid]);
 const expired=await source("whatsapp","expired","expired","Consulta","handoff");
 await q("update office_capture_opportunities set session_id='central',window_until=now()-interval '1 hour' where id=$1",[expired]);
 const a=await page(1,"reply_window"), b=await page(1,"reply_window",a.next.at,a.next.id);
 const all=[...a.items,...b.items];assert.equal(a.items.length,25);assert.equal(b.items.length,3);
 assert.ok(all.every(({reply_until},i)=>!i||Date.parse(reply_until)>=Date.parse(all[i-1].reply_until)));
 assert.equal(new Set(all.map(x=>x.opportunity_id)).size,28);
 assert.equal(a.next.at,a.items.at(-1).reply_until);assert.equal(a.items[0].page_at,undefined);
});
test("other channels and unverified peers stay independent, linked CRM or verified accounts share a human hold",async()=>{
 const op=await source("instagram","peer","msg","Fixture","handoff");
 const fb=await source("facebook","peer","fb-message","Fixture");
 assert.equal(await q("select office_commercial_blocked($1)",[fb]),false);
 await q("insert into crm_clientes(id) values($1)",[id(101)]);
 await q("update office_capture_opportunities set client_id=$1",[id(101)]);
 assert.equal(await q("select office_commercial_blocked($1)",[fb]),true);
 await q("update office_capture_opportunities set status='handoff',last_error='commercial_intervention' where id=$1",[fb]);
 assert.equal((await page(1,"active",null,null,fb)).items[0].opportunity_id,op);
 await assert.rejects(q("update office_capture_opportunities set status='dispatching' where id=$1",[fb]),/OFFICE_COMMERCIAL_ACTIVE/);
 await change(op,"claim",1);await q("insert into purchases values($1)",[id(101)]);
 await assert.rejects(change(op,"return",2),/OFFICE_RETURN_UNAVAILABLE/);
 await q("update office_capture_opportunities set status='purchased' where id=$1",[op]);
 assert.equal((await page(1,"resolved")).items[0].outcome,"purchased");
});
test("a customer who writes after resolution reopens a human case with the previous operator",async()=>{
 const op=await source("whatsapp","client","first","Fixture","handoff");
 await change(op,"claim",1);await change(op,"resolve",2,1,"answered","Resuelta");
 await q("update office_capture_opportunities set source_id='second',latest_inbound_at=clock_timestamp() where id=$1",[op]);
 const item=(await page()).items[0];assert.equal(item.state,"claimed");assert.equal(item.owner_id,id(11));assert.equal(item.reason,"new_inbound");
 assert.equal(await filter(op),"commercial_intervention");
});
test("an attribution report form opens its existing native case; mutation still requires its canonical ID",async()=>{
 const lead=id(41);await q("insert into captacion_leads(id) values($1)",[lead]);
 const canonical=await q(`insert into office_capture_opportunities(channel,account_id,kind,thread_key,source_id,source_at,latest_inbound_at,window_until,status,lead_id)
  values('meta_form','123','form','lead:'||$1::uuid,'meta-1',now(),now(),now(),'handoff',$1) returning id`,[lead]);
 const alias=await q("select md5(jsonb_build_array('tc:meta:form','123',$1::uuid)::text)::uuid",[lead]);
 assert.notEqual(alias,canonical);assert.equal((await page(1,"active",null,null,alias)).items[0].opportunity_id,canonical);
 assert.equal((await page(1,"active",null,null,randomUUID())).items.length,0);
 await assert.rejects(change(alias,"claim",1),/OFFICE_NOT_FOUND/);assert.equal((await change(canonical,"claim",1)).state,"claimed");
});
test("WA staff receipts before return stay acknowledged; new staff activity hands control to the human team",async()=>{
 const wa="34600112233@s.whatsapp.net", account="34600889999@s.whatsapp.net", time=ms=>new Date(Date.now()+ms).toISOString();
 const ingest=(source,at,ownAt)=>q("select office_capture_record_whatsapp($1,'central',$2)",[account,JSON.stringify([{thread_key:wa,source_id:source,
   source_at:at,body:"consulta tarot",business_interest:true,last_own_id:"human",last_own_at:ownAt}])]);
 const old=time(-50000);await ingest("first",time(-30000),old);
 const op=(await page()).items[0].opportunity_id;await change(op,"claim",1);await change(op,"return",2);
 await ingest("second",time(500),old);assert.equal(await filter(op),null);
 await ingest("third",time(1000),time(800));assert.equal((await page()).items[0].reason,"human_takeover");
});
test("only active Central/admin users can see the inbox, and unprivileged roles cannot call its RPCs",async()=>{
 for(const actor of [4,5])await assert.rejects(page(actor),/OFFICE_FORBIDDEN/);
 assert.equal((await page(3)).is_admin,true);
 assert.equal(await q("select has_function_privilege('authenticated','office_commercial_page(uuid,text,timestamptz,uuid,uuid)','execute')"),false);
 assert.equal(await q("select has_table_privilege('service_role','office_commercial_changes','delete')"),false);
 for(let i=0;i<28;i++)await source("whatsapp","chat"+i,"m"+i,"Fixture","handoff");
 const a=await page(), b=await page(1,"active",a.next.at,a.next.id);assert.equal(a.items.length,25);assert.equal(b.items.length,3);
 assert.equal(new Set([...a.items,...b.items].map(x=>x.opportunity_id)).size,28);
});
test("real autonomy and capture RPCs hand off, then permit only fresh input and recheck related human attention at the transport boundary",async()=>{
 const setMode=(mode,rev)=>q("select office_autonomy_set($1,$2,$3)",[id(3),JSON.stringify({department:"captacion-reservas",mode,
   action:"",channel:"",account:"",window_start:null,window_end:null,daily_actions:null,daily_usd:null}),rev]);
 const op=await source("whatsapp","business-peer","native-first","Fixture");
 await setMode("human",0);await db.exec("set role service_role");
 try {
  assert.equal(await q("select office_capture_claim()"),null);assert.equal((await page()).items[0].reason,"autonomy_handoff");
  await change(op,"claim",1);await change(op,"return",2);assert.equal(await filter(op),"commercial_wait_new_inbound");
 } finally{await db.exec("reset role");}
 await setMode("automatic",1);
 await q("update office_capture_opportunities set status='handoff',source_id='fresh',latest_inbound_at=clock_timestamp() where id=$1",[op]);
 const job=await q("select office_capture_claim()");assert.equal(job.id,op);
 await q("select office_capture_begin($1,$2,'Fixture','ask_country')",[op,job.lease_token]);
 assert.equal(await q("select office_autonomy_dispatch($1,$2,$3)",[op,job.lease_token,job.request_id]),true);
 const other=await source("facebook","another-ID","different-msg","Fixture","handoff");
 await q("insert into crm_clientes(id) values($1)",[id(102)]);await q("update office_capture_opportunities set client_id=$1",[id(102)]);
 await assert.rejects(change(other,"claim",1),/OFFICE_DISPATCH_ACTIVE/);
 assert.equal(await q("select office_autonomy_dispatch($1,$2,$3)",[op,job.lease_token,job.request_id]),false);
 await q("insert into purchases values($1)",[id(102)]);
 assert.equal(await q("select office_capture_guard($1,true)",[other]),"purchased");
});

async function instagramFixture() {
  await db.exec(`truncate tc_social_inbox_activity,tc_instagram_threads,tc_instagram_sends,tc_social_connections_v2;
    insert into tc_social_connections_v2 values ('instagram','ig-fixture');
    insert into tc_instagram_threads(id,kind,account_id,recipient_id,remote_id,remote_updated_at)
      values(gen_random_uuid(),'message','ig-fixture','peer','conversation',now());`);
}
async function receiveDm(sourceId,minutesAgo=1) {
  await q(`insert into tc_social_inbox_activity(provider,account_id,kind,remote_id,thread_remote_id,occurred_at)
    values('instagram','ig-fixture','message',$1,'peer',now() - $2 * interval '1 minute')`,[sourceId,minutesAgo]);
  assert.equal(await q("select office_capture_record_social('instagram','ig-fixture',$1)",[
    JSON.stringify([{kind:"message",source_id:sourceId,thread_key:"peer",body:"Información sobre la consulta"}])]),1);
}
const claimDm=(sourceId,account="ig-fixture")=>q("select office_capture_claim_instagram_dm($1,$2)",[account,sourceId]);
const beginDm=job=>q("select office_capture_begin($1,$2,'Fixture','ask_country')",[job.id,job.lease_token]);
const finishDm=(job,outcome,reason,receipt=null)=>q("select office_capture_finish($1,$2,$3,$4,$5)",[job.id,job.lease_token,outcome,receipt,reason]);

async function receiveComment(sourceId,{root=sourceId,author=null,body="Quiero una consulta",daysAgo=0}={}) {
  await q(`insert into tc_instagram_threads(id,kind,account_id,recipient_id,remote_id,remote_updated_at,private_reply_sent)
    values(gen_random_uuid(),'comment','ig-fixture',$1,$2,now(),false)`,[author,root]);
  await q(`insert into tc_social_inbox_activity(provider,account_id,kind,remote_id,thread_remote_id,occurred_at)
    values('instagram','ig-fixture','comment',$1,$2,now()-interval '1 minute'-$3*interval '1 day')`,[sourceId,root,daysAgo]);
  assert.equal(await q("select office_capture_record_social('instagram','ig-fixture',$1)",[
    JSON.stringify([{kind:"comment",source_id:sourceId,thread_key:root,body}])]),1);
}
const claimComment=(sourceId,account="ig-fixture")=>q("select office_capture_claim_instagram_comment($1,$2)",[account,sourceId]);

test("el comentario firmado reclama su propio hilo por ID, incluso si Instagram omite el autor",async()=>{
  await instagramFixture();
  await receiveDm("same-id",5);
  await receiveComment("same-id");
  await receiveComment("other-comment",{author:"other-author"});
  assert.equal(await claimComment("absent"),null);
  assert.equal(await claimComment("same-id","another-account"),null);
  assert.equal(await claimComment(null),null);
  for(const role of ["anon","authenticated"]) {
    assert.equal(await q("select has_function_privilege($1,'office_capture_claim_instagram_comment(text,text)','execute')",[role]),false);
  }
  await db.exec("set role service_role");
  try {
    const job=await claimComment("same-id");
    assert.equal(job.kind,"comment");
    assert.equal(job.thread_key,"same-id");
    assert.equal(job.recipient_id,null);
    assert.equal(await claimComment("same-id"),null);
    const dm=await q("select office_capture_claim()");
    assert.equal(dm.kind,"message");
    const cronComment=await q("select office_capture_claim()");
    assert.equal(cronComment.source_id,"other-comment");
    assert.equal(await claimComment("other-comment"),null);
    assert.equal((await beginDm(job)).request_id,job.request_id);
    assert.equal(await finishDm(job,"sent",null,"receipt-comment"),true);
    assert.equal(await claimComment("same-id"),null);
    assert.equal(await q("select office_capture_claim()"),null);
  } finally { await db.exec("reset role"); }
});

test("la reserva inmediata de comentarios respeta identidad, retirada, ventana y respuesta privada previa",async()=>{
  await instagramFixture();
  await receiveComment("child",{root:"root"});
  await receiveComment("expired",{daysAgo:8});
  await receiveComment("managed");
  await receiveComment("deleted");
  await receiveComment("mismatch",{author:"source-author"});
  await receiveComment("unverified");
  await receiveComment("empty",{body:" "});
  await receiveComment("disabled");
  await q("update tc_instagram_threads set private_reply_sent=true where remote_id='managed'");
  await q("update tc_social_inbox_activity set removed_at=now() where remote_id='deleted'");
  await q("update office_capture_inbound set recipient_id='other-author' where source_id='mismatch'");
  await q("update office_capture_inbound set verified=false where source_id='unverified'");
  for(const sourceId of ["child","root","expired","managed","deleted","mismatch","unverified","empty"]) {
    assert.equal(await claimComment(sourceId),null,sourceId);
  }
  try {
    await q("update office_capture_settings set enabled=false");
    assert.equal(await claimComment("disabled"),null);
  } finally { await q("update office_capture_settings set enabled=true"); }
  assert.equal((await claimComment("disabled")).source_id,"disabled");
});

test("el webhook sólo reclama su DM verificado; duplicados, pausas y la ronda comparten autorización y lease",async()=>{
  await instagramFixture();
  const other=await source("whatsapp","otro","anterior","Fixture");
  await receiveDm("first",3);
  await receiveDm("newest",2);
  for(const [msg,account] of [["first","ig-fixture"],["newest","otra"],[null,null],["ausente","ig-fixture"]]) {
    assert.equal(await claimDm(msg,account),null);
  }
  await q("update office_capture_settings set enabled=false");
  assert.equal(await claimDm("newest"),null);
  await q("update office_capture_settings set enabled=true");
  await q("insert into office_autonomy_rules(action,channel,account,mode,updated_by) values('capture_reply','instagram','ig-fixture','paused',$1)",[id(13)]);
  assert.equal(await claimDm("newest"),null);
  await q("update office_autonomy_rules set mode='automatic' where account='ig-fixture'");
  assert.equal(await q("select status from office_capture_opportunities where id=$1",[other]),"pending");
  assert.equal(await q("select has_function_privilege('authenticated','office_capture_claim_instagram_dm(text,text)','execute')"),false);
  await db.exec("set role service_role");
  try {
    const job=await claimDm("newest");
    assert.equal(job.source_id,"newest");
    assert.equal(await claimDm("newest"),null);
    assert.equal((await q("select office_capture_claim()")).id,other);
    assert.equal(await q("select office_capture_claim()"),null);
    assert.equal((await beginDm(job)).request_id,job.request_id);
    assert.equal(await finishDm(job,"sent",null,"receipt"),true);
    assert.equal(await claimDm("newest"),null);
  } finally { await db.exec("reset role"); }
});

test("un DM nuevo durante una preparación obsoleta se recupera sin abrir un caso humano ni repetir la fuente anterior",async()=>{
  await instagramFixture();
  await receiveDm("a",3);
  const first=await claimDm("a");
  await beginDm(first);
  await receiveDm("b",2);
  assert.equal(await claimDm("b"),null);
  assert.equal(await finishDm(first,"blocked","NEWER_INSTAGRAM_DM"),true);
  const second=await claimDm("b");
  assert.equal(second.id,first.id);
  assert.notEqual(second.request_id,first.request_id);
  assert.equal(await claimDm("a"),null);
  assert.equal(await q("select count(*)::int from office_commercial_cases"),0);
  await beginDm(second);
  await receiveDm("c",1);
  assert.equal(await finishDm(second,"sent",null,"receipt-b"),true);
  assert.equal((await q("select office_capture_claim()")).source_id,"c");
});

test("un nuevo DM no reactiva una entrega incierta ni un relevo humano",async()=>{
  await instagramFixture();
  await receiveDm("original",3);
  const first=await claimDm("original");
  await beginDm(first);
  await receiveDm("waiting",2);
  assert.equal(await finishDm(first,"uncertain","PROVIDER_UNCONFIRMED"),true);
  assert.equal(await claimDm("waiting"),null);
  assert.equal(await finishDm(first,"blocked","NEWER_INSTAGRAM_DM"),false);
  // An eventual provider receipt releases the newer input through normal gates.
  assert.equal(await finishDm(first,"sent",null,"late-receipt"),true);
  const second=await claimDm("waiting");
  await beginDm(second);
  await receiveDm("third",1);
  assert.equal(await finishDm(second,"handoff","CONVERSATION_CHANGED"),true);
  assert.equal(await claimDm("third"),null);
  assert.equal(await q("select state from office_commercial_cases where opportunity_id=$1",[second.id]),"open");
});
