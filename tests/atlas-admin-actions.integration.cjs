const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;
 create table workers(id uuid primary key,user_id uuid,role text,is_active boolean);
 create table atlas_admin_proposals(id uuid primary key,worker_id uuid,kind text,title text,payload jsonb,status text default 'pending',result jsonb,expires_at timestamptz default now()+interval '30 minutes',executed_at timestamptz,updated_at timestamptz);
 create table atlas_admin_audit(worker_id uuid,operation_id uuid,action text,entity_type text,entity_id text,detail jsonb);
 create table atlas_admin_memories(id uuid default gen_random_uuid(),worker_id uuid,content text);
 create table tc_client_promotions(id uuid primary key,name text,status text,starts_at timestamptz,ends_at timestamptz,active_until_disabled boolean,updated_at timestamptz,activated_at timestamptz,activated_by uuid,deactivated_at timestamptz,promotion_kind text default 'standard');
 create table tc_client_promotion_packages(id uuid primary key,promotion_id uuid,is_active boolean,price numeric,updated_at timestamptz);
 create table tc_client_promotion_audit(promotion_id uuid,action text,actor_user_id uuid,snapshot jsonb);
 create table observed_rewards(operation_id uuid primary key,kind text,client_id uuid,actor uuid,level integer,amount integer,reason text);
 create function tc_admin_adjust_spins(op uuid,client uuid,actor uuid,level integer,amount integer,reason text) returns jsonb language plpgsql as $$begin if amount>100 or amount<1 then raise exception 'INVALID_ADJUSTMENT';end if;insert into observed_rewards values(op,'spins',client,actor,level,amount,reason);return jsonb_build_object('amount',amount,'level',level);end$$;
 create function admin_gift_client_coins(client uuid,actor uuid,amount integer,reason text,op uuid) returns jsonb language plpgsql as $$begin if amount<1 then raise exception 'INVALID_AMOUNT';end if;insert into observed_rewards values(op,'coins',client,actor,null,amount,reason);return jsonb_build_object('amount',amount);end$$;
 create function tc_atlas_dispatch(actor uuid,payload jsonb,op uuid) returns jsonb language plpgsql as $$begin if payload->>'kind'='invalid' then raise exception 'CANDIDATE_CHANGED';end if;return jsonb_build_object('assigned',2);end$$;
 insert into workers values('${id(1)}','${id(2)}','admin',true),('${id(3)}','${id(4)}','central',true),('${id(5)}','${id(6)}','admin',false);
 `);const migrations=path.join(__dirname,'../supabase/migrations');await db.exec(fs.readFileSync(path.join(migrations,fs.readdirSync(migrations).find(name=>name.endsWith('_atlas_admin_actions.sql'))),'utf8'));
});after(()=>db.close());
async function proposal(n,kind,payload){await db.query('insert into atlas_admin_proposals(id,worker_id,kind,payload) values($1,$2,$3,$4)',[id(n),id(1),kind,payload]);}
async function execute(n,actor=2){return(await db.query('select tc_atlas_execute_action($1,$2) result',[id(actor),id(n)])).rows[0].result;}
test('rewards reuse existing RPC with exact client/level/actor and duplicate replay cannot award twice',async()=>{
 await proposal(10,'grant_spins',{client_id:id(9),level:1,amount:1,reason:'Test atlas'});
 assert.equal((await execute(10)).result.level,1);assert.equal((await execute(10)).replayed,true);
 let rows=(await db.query('select * from observed_rewards')).rows;assert.equal(rows.length,1);assert.equal(rows[0].actor,id(2));assert.equal(rows[0].client_id,id(9));
 await proposal(11,'grant_coins',{client_id:id(9),amount:25,reason:'Test coins'});await execute(11);await execute(11);
 rows=(await db.query("select * from observed_rewards where kind='coins'")).rows;assert.equal(rows.length,1);assert.equal(rows[0].actor,id(1));
});
test('role, ownership, inactive user and expired proposals prevent writes',async()=>{
 for(const actor of [4,6,9]) await assert.rejects(execute(10,actor),/FORBIDDEN/);
 await proposal(12,'grant_coins',{client_id:id(9),amount:5,reason:'Test'});await db.query("update atlas_admin_proposals set worker_id=$1 where id=$2",[id(5),id(12)]);await assert.rejects(execute(12),/PROPOSAL_NOT_FOUND/);
 await proposal(13,'grant_coins',{client_id:id(9),amount:5,reason:'Test'});await db.query("update atlas_admin_proposals set expires_at=now()-interval '1 hour' where id=$1",[id(13)]);await assert.rejects(execute(13),/PROPOSAL_UNAVAILABLE/);
});
test('failed RPC rolls back receipt and audit; it remains safe to retry',async()=>{
 await proposal(14,'grant_spins',{client_id:id(9),level:1,amount:101,reason:'Test'});await assert.rejects(execute(14),/INVALID_ADJUSTMENT/);
 assert.equal((await db.query('select status from atlas_admin_proposals where id=$1',[id(14)])).rows[0].status,'pending');
 assert.equal((await db.query('select count(*)::int n from atlas_admin_audit where operation_id=$1',[id(14)])).rows[0].n,0);
});
test('activation compares preview versions, disables previous active and writes one audit atomically',async()=>{
 await db.query("insert into tc_client_promotions(id,name,status,active_until_disabled,updated_at) values($1,'Old','active',true,now()),($2,'New','inactive',true,now())",[id(20),id(21)]);
 await db.query('insert into tc_client_promotion_packages values($1,$2,true,20,now())',[id(22),id(21)]);
 const p=(await db.query('select updated_at::text from tc_client_promotions where id=$1',[id(21)])).rows[0];
 const packs=(await db.query("select jsonb_agg(jsonb_build_object('id',id,'updated_at',updated_at) order by id) versions from tc_client_promotion_packages where promotion_id=$1",[id(21)])).rows[0].versions;
 await proposal(23,'activate_promotion',{promotion_id:id(21),updated_at:p.updated_at,previous_active:[id(20)],package_versions:packs});
 await execute(23);await execute(23);
 assert.equal((await db.query('select status from tc_client_promotions where id=$1',[id(20)])).rows[0].status,'inactive');
 assert.equal((await db.query('select count(*)::int n from tc_client_promotion_audit')).rows[0].n,1);
 await proposal(24,'activate_promotion',{promotion_id:id(20),updated_at:'2000-01-01',previous_active:[id(21)],package_versions:[]});await assert.rejects(execute(24),/PROMOTION_CHANGED/);
});
test('private memory and dispatch receipts commit only once',async()=>{
 await proposal(30,'save_memory',{content:'Objetivos del conjunto.'});await execute(30);await execute(30);assert.equal((await db.query('select count(*)::int n from atlas_admin_memories')).rows[0].n,1);
 await proposal(31,'dispatch_contacts',{kind:'invalid'});await assert.rejects(execute(31),/CANDIDATE_CHANGED/);
 await proposal(32,'create_task',{kind:'task'});assert.equal((await execute(32)).result.assigned,2);
});
test('browser database roles cannot execute privileged actions',async()=>{
 const r=(await db.query("select has_function_privilege('anon','tc_atlas_execute_action(uuid,uuid)','execute') a,has_function_privilege('authenticated','tc_atlas_execute_action(uuid,uuid)','execute') b")).rows[0];assert.deepEqual(r,{a:false,b:false});
});
