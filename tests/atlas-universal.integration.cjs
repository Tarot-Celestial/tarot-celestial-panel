const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
test('Atlas migration is repeatable and changes only the identity of existing profiles',async()=>{
 const db=new PGlite();try{
 await db.exec(`create table central_assistant_profiles(worker_id text primary key,pet text not null default 'draco' constraint central_assistant_profiles_pet_check check(pet in ('sol','draco','ambar')),preferences jsonb,updated_at timestamptz default '2026-10-01');
 create table central_assistant_memories(worker_id text references central_assistant_profiles, content text);
 create table central_assistant_tasks(worker_id text references central_assistant_profiles, title text);
 insert into central_assistant_profiles(worker_id,pet,preferences) values ('a','sol','{"motion":false,"sound":true}'),('b','draco','{"motion":true,"humor":false}'),('c','ambar','{"proactive":false}');
 insert into central_assistant_memories values ('a','Private A'),('b','Private B');insert into central_assistant_tasks values ('c','Task C');`);
 const snapshot=async()=>({profiles:(await db.query('select worker_id,preferences,updated_at from central_assistant_profiles order by worker_id')).rows,memories:(await db.query('select * from central_assistant_memories order by worker_id')).rows,tasks:(await db.query('select * from central_assistant_tasks')).rows});
 const before=await snapshot();const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261103042046_atlas_universal_identity.sql'),'utf8');
 await db.exec(sql);await db.exec(sql);
 assert.deepEqual(await snapshot(),before);
 assert.deepEqual((await db.query('select distinct pet from central_assistant_profiles')).rows,[{pet:'atlas'}]);
 await db.exec(`insert into central_assistant_profiles(worker_id) values('new');`);
 assert.equal((await db.query("select pet from central_assistant_profiles where worker_id='new'")).rows[0].pet,'atlas');
 // Cached sessions can still save preferences during a rolling deployment.
 await db.exec(`update central_assistant_profiles set pet='sol' where worker_id='a';`);
 await db.exec(sql);assert.equal((await db.query("select pet from central_assistant_profiles where worker_id='a'")).rows[0].pet,'atlas');
 }finally{await db.close();}
});
