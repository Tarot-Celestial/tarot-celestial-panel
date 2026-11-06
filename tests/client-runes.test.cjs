const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const base = path.join(__dirname, '..');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const load = (file, mocks) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(base,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,require:name=>{if (!(name in mocks)) throw Error(name); return mocks[name];},URL,console:{error(){}},Date,Map});
  return exports;
};
const helpers = load('src/lib/client-runes.ts',{});

test('rune assignments are atomic, exclusive, audited and idempotent without changing balances', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table workers(id uuid primary key,user_id uuid,role text,is_active boolean);
      create table crm_clientes(id uuid primary key,coins integer default 300,minutes integer default 12);
      grant select on crm_clientes to service_role;
      create function tc_has_admin_access(u uuid) returns boolean language sql as $$ select exists(select 1 from public.workers where user_id=u and role='admin' and is_active) $$;`);
    const migration = fs.readFileSync(path.join(base,'supabase/migrations/20261106223000_client_runes.sql'),'utf8');
    await db.exec(migration); await db.exec(migration);
    await db.query("insert into workers values($1,$2,'admin',true),($3,$4,'central',true),($5,$6,'admin',false)",[id(1),id(101),id(2),id(102),id(3),id(103)]);
    await db.query('insert into crm_clientes(id) values($1),($2)',[id(10),id(11)]);
    const get = async(sql,params=[]) => (await db.query(sql,params)).rows[0];
    const assign = async({op=20,client=10,enabled=true,title='Obsidiana carmesí',benefit='Tu ventaja personal',stamp=null,worker=1,user=101}={}) =>
      (await get('select tc_admin_set_client_rune($1,$2,$3,$4,$5,$6,$7,$8) as rune',[id(client),enabled,title,benefit,stamp,id(op),id(worker),id(user)])).rune;
    for (const role of ['anon','authenticated']) {
      assert.equal((await get("select has_function_privilege($1,'tc_admin_set_client_rune(uuid,boolean,text,text,timestamptz,uuid,uuid,uuid)','execute') as allowed",[role])).allowed,false);
      assert.equal((await get("select has_table_privilege($1,'client_runes','select') as allowed",[role])).allowed,false);
    }
    await db.exec('set role service_role');
    for (const actor of [{worker:2,user:102},{worker:3,user:103},{worker:2,user:101}]) await assert.rejects(assign(actor),/RUNE_FORBIDDEN/);
    await assert.rejects(assign({client:12}),/RUNE_CLIENT_NOT_FOUND/);
    await assert.rejects(assign({benefit:''}),/RUNE_INVALID_INPUT/);
    const first = await assign();
    assert.equal(first.enabled,true); assert.equal(first.cliente_id,id(10));
    assert.deepEqual(await assign(),first);
    await assert.rejects(assign({benefit:'Otra'}),/RUNE_OPERATION_REUSED/);
    await assert.rejects(assign({op:21}),/RUNE_CONFLICT/);
    const disabled = await assign({op:21,enabled:false,stamp:first.updated_at});
    assert.equal(disabled.enabled,false);
    assert.deepEqual(await assign(),first); // Lost receipt retry must not reactivate it.
    const row = await get('select enabled from client_runes where cliente_id=$1',[id(10)]);
    assert.equal(row.enabled,false);
    assert.equal((await get('select count(*)::int as n from client_runes')).n,1);
    assert.equal((await get('select count(*)::int as n from client_rune_events')).n,2);
    assert.deepEqual(await get('select coins,minutes from crm_clientes where id=$1',[id(10)]),{coins:300,minutes:12});
    await db.exec('reset role');
    await db.exec("create function fail_rune_audit() returns trigger language plpgsql as $$ begin raise exception 'AUDIT_UNAVAILABLE'; end $$; create trigger fail_audit before insert on client_rune_events for each row execute function fail_rune_audit();");
    await assert.rejects(assign({op:22,stamp:disabled.updated_at}),/AUDIT_UNAVAILABLE/);
    assert.equal((await get('select enabled from client_runes where cliente_id=$1',[id(10)])).enabled,false);
  } finally { await db.close(); }
});

test('admin rune API validates input and binds the actor to verified identity', async () => {
  let allowed=false, calls=[], failure=null;
  const route=load('src/app/api/admin/client-runes/route.ts',{
    'next/server':{NextResponse:{json:(body,opts)=>({body,...opts})}},
    '@/lib/client-runes':helpers,
    '@/lib/admin/require-admin':{requireAdmin:async()=>allowed?{ok:true,me:{id:id(1)},authUserId:id(101),admin:{rpc:async(name,args)=>{calls.push({name,args});return {data:{enabled:true},error:failure};}}}:{ok:false,error:'FORBIDDEN'}},
  });
  const input={cliente_id:id(10),operation_id:id(20),enabled:true,title:' Runa ',benefit:' Ventaja ',expected_updated_at:null};
  const post=async(overrides={})=>route.POST({json:async()=>({...input,...overrides})});
  assert.equal((await post()).status,403); assert.equal(calls.length,0);
  allowed=true;
  for(const value of [{cliente_id:'bad'},{enabled:'true'},{title:''},{title:'x'.repeat(101)},{benefit:''},{benefit:'x'.repeat(2001)},{expected_updated_at:undefined}]) assert.equal((await post(value)).status,400);
  assert.equal(calls.length,0);
  const result=await post({actor_user_id:id(999),actor_worker_id:id(999)});
  assert.equal(result.status,200); assert.equal(calls[0].args.p_actor_user_id,id(101)); assert.equal(calls[0].args.p_actor_worker_id,id(1));
  assert.equal(calls[0].args.p_title,'Runa'); assert.match(result.headers['Cache-Control'],/private, no-store/);
  failure={message:'RUNE_CONFLICT'}; assert.equal((await post()).status,409);
});

test('customer rune lookup uses authenticated ficha only, hides inactive grants and never masks database errors as no grant', async () => {
  let uid=id(101), cliente={id:id(10)}, data={title:'Runa',benefit:'Ventaja',updated_at:'2026-11-06T00:00:00Z'}, error=null, filters=[];
  const route=load('src/app/api/cliente/runas/route.ts',{
    'next/server':{NextResponse:{json:(body,opts)=>({body,...opts})}},
    '@/lib/server/auth-cliente':{clientFromRequest:async()=>({uid,cliente,admin:{from:table=>{assert.equal(table,'client_runes');const q={select:()=>q,eq:(...a)=>{filters.push(a);return q;},maybeSingle:async()=>({data,error})};return q;}}})},
  });
  const result=await route.GET({url:'https://example.test/api/cliente/runas?cliente_id='+id(11)});
  assert.deepEqual(filters,[['cliente_id',id(10)],['enabled',true]]); assert.equal(result.body.rune,data);
  assert.match(result.headers['Cache-Control'],/no-store/);
  data=null; assert.equal((await route.GET({})).body.rune,null);
  error={code:'CONNECTION_FAILED'}; assert.equal((await route.GET({})).status,500);
  uid=null; filters=[]; assert.equal((await route.GET({})).status,401); assert.equal(filters.length,0);
  uid=id(101); cliente=null; assert.equal((await route.GET({})).status,404);
});
