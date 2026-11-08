const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
let db;const scalar=async(q,p=[]) => (await db.query(q,p)).rows[0].v;
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261108205739_staff_chat_personal_appearance.sql'),'utf8');
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema storage;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 grant usage on schema storage,public to authenticated,anon,service_role;
 grant select,insert,update,delete on storage.objects to authenticated,anon,service_role;
 create policy existing_broad_policy on storage.objects for all to authenticated,anon using(true) with check(true);
 create table workers(id uuid primary key);create table chat_threads(id uuid primary key);
 insert into workers values('${id(1)}'),('${id(2)}');insert into chat_threads values('${id(10)}');`);
 await db.exec(migration);await db.exec(migration);
});
after(async()=>{await db.close();});
test('appearance migration is replay safe and neither files nor personal settings are browser-readable',async()=>{
 assert.equal(await scalar("select public v from storage.buckets where id='staff-chat-appearance'"),false);
 assert.equal(await scalar("select file_size_limit::int v from storage.buckets where id='staff-chat-appearance'"),2097152);
 for(const table of ['staff_chat_profiles','staff_chat_preferences']){
  assert.equal(await scalar(`select relrowsecurity v from pg_class where oid='${table}'::regclass`),true);
  for(const role of ['anon','authenticated'])assert.equal(await scalar('select has_table_privilege($1,$2,\'SELECT\') v',[role,table]),false);
  assert.equal(await scalar("select has_table_privilege('service_role',$1,'UPDATE') v",[table]),true);
 }
 await db.exec("insert into storage.objects(bucket_id,name) values('staff-chat-appearance','secret'),('other','visible')");
 for(const role of ['authenticated','anon']){await db.exec('set role '+role);try{
  assert.equal(await scalar('select count(*)::int v from storage.objects'),1);
  await assert.rejects(db.exec("insert into storage.objects(bucket_id,name) values('staff-chat-appearance','denied')"),/row-level security/);
 }finally{await db.exec('reset role');}}
});
test('database independently rejects foreign asset paths and incomplete profile/background states',async()=>{
 await assert.rejects(db.query("insert into staff_chat_profiles(worker_id,avatar_kind,photo_path) values($1,'photo',$2)",[id(1),id(2)+'/profile/private.png']),/check constraint/);
 await assert.rejects(db.query("insert into staff_chat_profiles(worker_id,avatar_kind) values($1,'photo')",[id(1)]),/check constraint/);
 await assert.rejects(db.query("insert into staff_chat_preferences(worker_id,thread_id,wallpaper) values($1,$2,'custom')",[id(1),id(10)]),/check constraint/);
 await assert.rejects(db.query("insert into staff_chat_preferences(worker_id,thread_id,wallpaper,background_path) values($1,$2,'custom',$3)",[id(1),id(10),id(2)+'/background/private.png']),/check constraint/);
});
test('preferences are independent for two workers in the same thread; deleting a thread removes only its preferences',async()=>{
 await db.query("insert into staff_chat_profiles(worker_id,avatar_kind,character) values($1,'character','owl')",[id(1)]);
 await db.query("insert into staff_chat_preferences(worker_id,thread_id,wallpaper) values($1,$3,'forest'),($2,$3,'sand')",[id(1),id(2),id(10)]);
 assert.equal(await scalar('select count(*)::int v from staff_chat_preferences'),2);
 await db.query('delete from chat_threads where id=$1',[id(10)]);
 assert.equal(await scalar('select count(*)::int v from staff_chat_preferences'),0);assert.equal(await scalar('select count(*)::int v from staff_chat_profiles'),1);
});
