const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
let db;
const scalar=async(q,p=[]) => (await db.query(q,p)).rows[0].v;
before(async()=>{
 db=new PGlite();
 await db.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;
 create schema storage;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 grant usage on schema storage,public to authenticated,anon,service_role;
 grant select,insert,update,delete on storage.objects to authenticated,anon,service_role;
 create policy existing_broad_policy on storage.objects for all to authenticated,anon using(true) with check(true);
 create table workers(id uuid primary key,role text,is_active boolean,display_name text);
 create table chat_threads(id uuid primary key,central_worker_id uuid,tarotist_worker_id uuid,status text default 'open',last_message_at timestamptz,last_message_preview text);
 create table chat_messages(id uuid primary key default gen_random_uuid(),thread_id uuid not null references chat_threads(id),sender_worker_id uuid not null references workers(id),sender_display_name text,body text not null check(length(btrim(body)) between 1 and 2000),created_at timestamptz default now(),client_message_id text);
 create unique index chat_messages_client_message_unique on chat_messages(sender_worker_id,client_message_id) where client_message_id is not null;
 grant select,insert,update on all tables in schema public to service_role;
 insert into workers values('${id(1)}','central',true,'Fixture central'),('${id(2)}','tarotista',true,'Fixture tarotist'),('${id(3)}','central',true,'Other central'),('${id(4)}','central',false,'Inactive'),('${id(5)}','admin',true,'Admin');
 insert into chat_threads values('${id(10)}','${id(1)}','${id(2)}'),('${id(11)}','${id(3)}','${id(2)}');
 `);
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261030150643_staff_chat_private_media.sql'),'utf8'));
});
after(async()=>{await db.close();});
async function attachment(n,{worker=1,thread=10,validated=true}={}){
 const a=id(n);await db.query("insert into staff_chat_attachments(id,thread_id,sender_worker_id,object_path,kind,mime_type,file_name,size_bytes,validated_at) values($1,$2,$3,$4,'image','image/png','fixture.png',24,$5)",[a,id(thread),id(worker),'fixture/'+a,validated?'2026-10-30T10:00:00Z':null]);return a;
}
const send=(a,{worker=1,thread=10,message='message-'+a,body='📷 Imagen'}={})=>scalar('select staff_chat_send_media_message($1,$2,$3,$4,$5) v',[id(worker),id(thread),message,body,a]);
test('private bucket and restrictive browser policies survive broad existing access',async()=>{
 assert.equal(await scalar("select public v from storage.buckets where id='staff-chat-private'"),false);
 await db.exec("insert into storage.objects(bucket_id,name) values('staff-chat-private','private'),('other','visible')");
 await db.exec('set role authenticated');
 try{
  assert.equal(await scalar('select count(*)::int v from storage.objects'),1);
  await assert.rejects(db.exec("insert into storage.objects(bucket_id,name) values('staff-chat-private','denied')"),/row-level security/);
 }finally{await db.exec('reset role');}
 for(const role of ['anon','authenticated']){
  assert.equal(await scalar("select has_function_privilege($1,'staff_chat_send_media_message(uuid,uuid,text,text,uuid)','EXECUTE') v",[role]),false);
  assert.equal(await scalar("select has_table_privilege($1,'staff_chat_attachments','SELECT') v",[role]),false);
 }
 assert.equal(await scalar("select relrowsecurity v from pg_class where oid='staff_chat_attachments'::regclass"),true);
 assert.equal(await scalar("select prosecdef v from pg_proc where oid='staff_chat_send_media_message(uuid,uuid,text,text,uuid)'::regprocedure"),false);
});
test('delivery and attachment linkage are atomic and retries return the same message',async()=>{
 const a=await attachment(20),results=await Promise.all([send(a),send(a),send(a)]);
 assert.equal(new Set(results.map(r=>r.message.id)).size,1);assert.equal(results.filter(r=>!r.duplicate).length,1);
 assert.equal(await scalar('select message_id::text v from staff_chat_attachments where id=$1',[a]),results[0].message.id);
 await assert.rejects(send(a,{message:'another'}),/ATTACHMENT_ALREADY_USED/);
 await assert.rejects(send(a,{body:'Different'}),/MESSAGE_ID_CONFLICT/);
 assert.equal(await scalar('select count(*)::int v from chat_messages where id=$1',[results[0].message.id]),1);
});
test('sender, thread, actor activity and validation state are checked by SQL independently',async()=>{
 const other=await attachment(21,{worker:2}),unverified=await attachment(22,{validated:false}),own=await attachment(23);
 await assert.rejects(send(other),/FORBIDDEN/);
 await assert.rejects(send(own,{worker:3}),/FORBIDDEN/);
 await assert.rejects(send(own,{worker:4}),/FORBIDDEN/);
 await assert.rejects(send(own,{thread:11}),/FORBIDDEN/);
 await assert.rejects(send(unverified),/ATTACHMENT_NOT_UPLOADED/);
 assert.equal(await scalar('select count(*)::int v from staff_chat_attachments where id in ($1,$2,$3) and message_id is not null',[other,unverified,own]),0);
});
test('message failure rolls back linkage; corrected retry works under service_role',async()=>{
 const a=await attachment(24);
 await db.exec("alter table chat_messages add constraint fixture_fail check(body<>'reject')");
 await assert.rejects(send(a,{body:'reject'}),/fixture_fail/);
 assert.equal(await scalar('select message_id v from staff_chat_attachments where id=$1',[a]),null);
 await db.exec('alter table chat_messages drop constraint fixture_fail');
 await db.exec('set role service_role');
 try{assert.ok((await send(a)).message.id);}finally{await db.exec('reset role');}
});
test('an ordinary message cannot be repurposed as a media replay',async()=>{
 const a=await attachment(25);
 await db.query('insert into chat_messages(thread_id,sender_worker_id,body,client_message_id) values($1,$2,$3,$4)',[id(10),id(1),'📷 Imagen','plain-existing']);
 await assert.rejects(send(a,{message:'plain-existing'}),/MESSAGE_ID_CONFLICT/);
 assert.equal(await scalar('select message_id v from staff_chat_attachments where id=$1',[a]),null);
});
