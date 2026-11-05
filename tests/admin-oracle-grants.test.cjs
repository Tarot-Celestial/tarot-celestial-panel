const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const {PGlite} = require('@electric-sql/pglite');
const app = path.join(__dirname, '..');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const reason = 'Compensación de prueba';

test('manual draw grants credit the canonical wallet and return the original receipt on retry',async()=>{
 const db = new PGlite();
 try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table workers(id uuid primary key,user_id uuid unique,role text,is_active boolean,display_name text);
    create table crm_clientes(id uuid primary key);
    create table cliente_oracle_credit_movements(id uuid primary key default gen_random_uuid(),
      cliente_id uuid not null references crm_clientes(id),amount integer not null check(amount<>0),
      movement_type text not null check(movement_type in ('purchase','draw','adjustment')),
      reference text not null unique,pack_id text,draw_type text,notes text,
      meta jsonb not null default '{}'::jsonb,created_at timestamptz not null default now());
    alter table cliente_oracle_credit_movements enable row level security;
    grant all on all tables in schema public to service_role;
    create function get_cliente_oracle_balance(p_cliente_id uuid) returns integer language sql stable
      as $$select greatest(0,coalesce(sum(amount),0))::integer from public.cliente_oracle_credit_movements where cliente_id=p_cliente_id$$;
  `);
  // Use the project's actual consumption RPC to exercise the customer side of the grant.
  const consume = fs.readFileSync(path.join(__dirname,'fixtures/oracle-existing-rpcs.sql'),'utf8')
    .split('CREATE OR REPLACE FUNCTION public.consume_cliente_oracle_question')[0];
  await db.exec(consume);
  const migration = fs.readFileSync(path.join(app,'supabase/migrations/20261105000100_admin_oracle_draw_grants.sql'),'utf8');
  await db.exec(migration);
  await db.exec(migration);
  for(const [n,role,active] of [[1,'admin',true],[2,'admin',true],[3,'central',true],[4,'admin',false]]) {
   await db.query('insert into workers values($1,$2,$3,$4,$5)',[id(n),id(100+n),role,active,'Admin prueba '+n]);
  }
  await db.query('insert into crm_clientes values($1),($2)',[id(10),id(11)]);
  await db.query("insert into cliente_oracle_credit_movements(cliente_id,amount,movement_type,reference) values($1,2,'purchase','payment-fixture')",[id(10)]);
  const query = async(sql,args=[]) => (await db.query(sql,args)).rows[0];
  const grant = async(op=81,client=10,actor=101,amount=3,motif=reason) =>
   (await query('select tc_admin_grant_oracle_draws($1,$2,$3,$4,$5) as receipt',[id(op),id(client),id(actor),amount,motif])).receipt;

  const perms = await query(`select p.prosecdef as definer,
    has_function_privilege('anon',p.oid,'execute') as anon,
    has_function_privilege('authenticated',p.oid,'execute') as client,
    has_function_privilege('service_role',p.oid,'execute') as server
    from pg_proc p where p.oid='tc_admin_grant_oracle_draws(uuid,uuid,uuid,numeric,text)'::regprocedure`);
  assert.deepEqual(perms,{definer:false,anon:false,client:false,server:true});
  await db.exec('set role service_role');
  const receipt = await grant();
  assert.equal(receipt.before_balance,2);
  assert.equal(receipt.after_balance,5);
  assert.equal(receipt.actor_user_id,id(101));
  assert.equal(receipt.actor_worker_id,id(1));
  assert.equal(receipt.actor_name,'Admin prueba 1');
  assert.equal(receipt.reason,reason);
  assert.equal(receipt.replayed,false);
  const movement = await query('select movement_type,pack_id,notes,reference from cliente_oracle_credit_movements where id=$1',[receipt.movement_id]);
  assert.deepEqual(movement,{movement_type:'adjustment',pack_id:null,notes:reason,reference:'admin:oracle:tiradas:'+id(81)});
  assert.equal((await query("select consume_cliente_oracle_credit($1,'draw-after-grant','clarity','Tirada de prueba') as balance",[id(10)])).balance,4);
  assert.deepEqual(await grant(),{...receipt,replayed:true});
  for(const args of [[81,11,101,3,reason],[81,10,102,3,reason],[81,10,101,4,reason],[81,10,101,3,'Otro motivo']]) {
   await assert.rejects(grant(...args),/OPERATION_CONFLICT/);
  }
  for(const actor of [103,104,105]) await assert.rejects(grant(82,10,actor),/FORBIDDEN/);
  for(const amount of [0,-1,101,1.5]) await assert.rejects(grant(83,10,101,amount),/INVALID_AMOUNT/);
  await assert.rejects(grant(84,10,101,2,'  '),/INVALID_REASON/);
  await assert.rejects(grant(85,12),/CLIENT_NOT_FOUND/);
  assert.equal((await query("select count(*)::int as count from cliente_oracle_credit_movements where movement_type='adjustment'")).count,1);
  assert.equal((await query('select get_cliente_oracle_balance($1) as balance',[id(10)])).balance,4);
  assert.equal((await query('select get_cliente_oracle_balance($1) as balance',[id(11)])).balance,0);
 } finally { await db.close(); }
});

test('API accepts positive grants only from the verified admin and treats a lost receipt as uncertain',async()=>{
 const source = fs.readFileSync(path.join(app,'src/app/api/admin/client-balances/route.ts'),'utf8');
 const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 let allowed = false, outcome, rpcCalls = [];
 const admin = {rpc:async(name,args)=>{ rpcCalls.push({name,args}); if(outcome instanceof Error) throw outcome; return outcome; }};
 const mocks = {
  'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},
  '@/lib/admin/require-admin':{requireAdmin:async()=>allowed?{ok:true,authUserId:id(101),me:{user_id:id(999)},admin}:{ok:false}},
 };
 const exports = {};
 vm.runInNewContext(code,{exports,require:name=>mocks[name],URL});
 const body = {action:'oracle',operation_id:id(81),cliente_id:id(10),amount:3,reason,actor_user_id:id(999)};
 const post = (payload=body) => exports.POST({json:async()=>payload});
 assert.equal((await post()).status,403);
 allowed = true;
 for(const amount of [0,-1,101,0.5,'3']) assert.equal((await post({...body,amount})).status,400);
 assert.equal((await post({...body,operation_id:'invalid'})).status,400);
 assert.equal(rpcCalls.length,0);
 const receipt = {operation_id:id(81),cliente_id:id(10),actor_user_id:id(101),amount:3,reason,
  before_balance:2,after_balance:5,movement_id:id(24),created_at:'2026-11-05T12:00:00Z',replayed:false};
 outcome = {data:receipt,error:null};
 const result = await post();
 assert.equal(result.status,200);
 assert.deepEqual(result.body.adjustment,receipt);
 assert.equal(result.headers['Cache-Control'],'private, no-store');
 assert.equal(rpcCalls[0].name,'tc_admin_grant_oracle_draws');
 assert.equal(rpcCalls[0].args.p_actor_user_id,id(101));
 outcome = new Error('timeout');
 const uncertain = await post();
 assert.equal(uncertain.status,503);
 assert.equal(uncertain.body.uncertain,true);
 outcome = {data:{...receipt,after_balance:17},error:null};
 assert.equal((await post()).body.uncertain,true);
 outcome = {data:null,error:{message:'OPERATION_CONFLICT'}};
 assert.equal((await post()).status,409);
});

test('admin detail shows only that customer’s manual Oracle history and isolates an unavailable wallet',async()=>{
 const source = fs.readFileSync(path.join(app,'src/app/api/admin/client-balances/route.ts'),'utf8');
 const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const client = id(10), movement = id(25), stamp = '2026-11-05T12:00:00Z';
 const manual = {id:movement,created_at:stamp,cliente_id:client,movement_type:'adjustment',
  reference:'admin:oracle:tiradas:'+id(81),meta:{source:'admin_client_balances',operation_id:id(81),
   actor_user_id:id(101),actor_name:'Equipo prueba',reason,amount:2,before_balance:1,after_balance:3}};
 const rows = [manual,
  {...manual,cliente_id:id(11)},
  {...manual,movement_type:'purchase'},
  {...manual,meta:{...manual.meta,source:'unrelated'}},
  {...manual,reference:'other-adjustment'}];
 let failBalance = false;
 const admin = {
  from(table) {
   let matches = table === 'cliente_oracle_credit_movements' ? rows : [];
   const api = {
    select(){return api}, eq(field,val){matches=matches.filter(r=>r[field]===val);return api},
    contains(field,expected){matches=matches.filter(r=>Object.keys(expected).every(k=>r[field][k]===expected[k]));return api},
    like(field,pattern){matches=matches.filter(r=>r[field].startsWith(pattern.slice(0,-1)));return api},
    order(){return api}, limit(n){matches=matches.slice(0,n);return api},
    maybeSingle(){return Promise.resolve({data:{id:client},error:null})},
    then(resolve,reject){return Promise.resolve({data:matches,count:0,error:null}).then(resolve,reject)},
   };
   return api;
  },
  async rpc(name,args) {
   assert.equal(args.p_cliente_id,client);
   if(name==='get_cliente_oracle_balance') return failBalance ? {error:{message:'temporarily unavailable'}} : {data:3,error:null};
   return {data:{coins:99},error:null};
  },
 };
 const mocks={
  'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},
  '@/lib/admin/require-admin':{requireAdmin:async()=>({ok:true,admin,authUserId:id(101)})},
 };
 const exports={};vm.runInNewContext(code,{exports,require:n=>mocks[n],URL});
 const read=()=>exports.GET({url:'http://localhost/api/admin/client-balances?id='+client});
 const {body,status}=await read();
 assert.equal(status,200);
 assert.equal(body.oracle.credits,3);
 assert.equal(body.oracle.history.length,1);
 assert.equal(body.oracle.history[0].movement_id,movement);
 assert.equal(body.oracle.history[0].cliente_id,client);
 assert.equal(body.oracle.history[0].before_balance,1);
 assert.equal(body.oracle.history[0].after_balance,3);
 failBalance=true;
 const degraded=await read();
 assert.equal(degraded.status,200);
 assert.equal(degraded.body.oracle,null);
 assert.equal(degraded.body.wallet.coins,99);
});
