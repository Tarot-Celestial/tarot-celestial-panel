const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
let db;const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const scalar=async(q,p=[])=>(await db.query(q,p)).rows[0].v;
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table workers(id uuid primary key);
 create table crm_clientes(id uuid primary key,minutos_free_pendientes numeric default 0,minutos_normales_pendientes numeric default 0,puntos numeric default 0,updated_at timestamptz);
 create table rendimiento_llamadas(id uuid primary key default gen_random_uuid(),fecha date,fecha_hora timestamptz,cliente_id text,cliente_nombre text,telefonista_worker_id uuid,telefonista_nombre text,tarotista_worker_id uuid,tarotista_nombre text,tarotista_manual_call text,llamada_call boolean,tipo_registro text,cliente_compra_minutos boolean,usa_7_free boolean,usa_minutos boolean,misma_compra boolean,guarda_minutos boolean,minutos_guardados_free numeric,minutos_guardados_normales numeric,codigo_1 text,minutos_1 numeric,codigo_2 text,minutos_2 numeric,resumen_codigo text,tiempo numeric,forma_pago text,importe numeric,promo boolean,captado boolean,recuperado boolean);
 create table crm_cliente_pagos(id uuid primary key default gen_random_uuid(),cliente_id uuid,importe numeric,moneda text,metodo text,estado text,notas text,referencia_externa text,created_by_user_id uuid,created_by_role text,source_rendimiento_id uuid,created_at timestamptz,benefits_context jsonb);
 create table crm_paypal_orders(id uuid primary key default gen_random_uuid(),payment_id uuid,cliente_id uuid,status text,capture_id text);
 create table crm_client_notes(cliente_id text,texto text,author_user_id uuid,author_name text,author_email text,is_pinned boolean,created_at timestamptz,event_type text,event_data jsonb);
 -- Only the independent rewards system is stubbed. The actual installed v8 runs unchanged.
 create function tc_apply_purchase_benefits(uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
 grant all on crm_clientes,crm_cliente_pagos,crm_paypal_orders,rendimiento_llamadas,workers,crm_client_notes to service_role;
 `);
 await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/crm-v8-verification.sql'),'utf8'));
 for(const file of ['20261007173256_paypal_link_existing_call.sql','20261007233546_call_minute_accounting.sql'])
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));
 await db.query('insert into workers values($1)',[id(1)]);
});
after(async()=>db.close());
async function setup(n,free=42,normal=30){
 await db.query('insert into crm_clientes(id,minutos_free_pendientes,minutos_normales_pendientes) values($1,$2,$3)',[id(n),free,normal]);
 return {cliente_id:id(n),operation_id:id(n+2000),telefonista_worker_id:id(1),cliente_compra_minutos:false,tipo_registro:'minutos',usa_minutos:true,usa_7_free:false,codigo_1:'FREE',minutos_1:20,minutos_2:0,free_delta:999,normal_delta:999,note_text:'Prueba local',importe:0};
}
const call=p=>scalar('select tc_register_call_minutes($1::jsonb) v',[JSON.stringify(p)]);
const balance=c=>scalar("select jsonb_build_array(minutos_free_pendientes,minutos_normales_pendientes) v from crm_clientes where id=$1",[c]);
test('72 minutes minus 20 free = 52, using live v8 and ignoring forged browser deltas',async()=>{
 const p=await setup(10),r=await call(p);assert.deepEqual(await balance(p.cliente_id),[22,30]);assert.equal(r.balances.total_after,52);
 assert.equal(await scalar('select count(*)::int v from crm_cliente_pagos where cliente_id=$1',[p.cliente_id]),0);
 const note=await scalar('select event_data v from crm_client_notes where cliente_id=$1',[p.cliente_id]);assert.equal(note.free_delta,-20);
});
test('Mixed usage deducts each bucket once and normal code does not spend free',async()=>{
 const p=await setup(20);await call({...p,minutos_1:12,codigo_2:'CLIENTE',minutos_2:8});assert.deepEqual(await balance(p.cliente_id),[30,22]);
 await call({...p,operation_id:id(9020),codigo_1:'CLIENTE',minutos_1:10});assert.deepEqual(await balance(p.cliente_id),[30,12]);
});
test('Ordinary balance calls are idempotent across repeated requests including depleted saldo',async()=>{
 const p=await setup(30,20,0);const r=await Promise.all([call(p),call(p),call(p)]);assert.equal(new Set(r.map(x=>x.rendimiento.id)).size,1);
 assert.deepEqual(await balance(p.cliente_id),[0,0]);assert.equal((await call({...p,note_text:'New preview',expected_free:0})).duplicate_prevented,true);
 assert.equal(await scalar('select count(*)::int v from rendimiento_llamadas where cliente_id=$1',[p.cliente_id]),1);
});
test('Same operation with different usage is rejected; later actual call gets its own operation',async()=>{
 const p=await setup(40);await call(p);await assert.rejects(call({...p,minutos_1:5}),/PAYMENT_OPERATION_CONFLICT/);
 await call({...p,operation_id:id(9040),minutos_1:5});assert.deepEqual(await balance(p.cliente_id),[17,30]);
});
test('7free consumes exactly 7 free once',async()=>{
 const p=await setup(50);const pass={...p,usa_7_free:true,usa_minutos:false,tipo_registro:'7free',minutos_1:0};await call(pass);await call(pass);assert.deepEqual(await balance(p.cliente_id),[35,30]);
});
test('Insufficient free or normal balance rolls back call, note, and operation receipt',async()=>{
 const p=await setup(60,3,4);await assert.rejects(call(p),/INSUFFICIENT_FREE_MINUTES/);
 await assert.rejects(call({...p,codigo_1:'CLIENTE'}),/INSUFFICIENT_NORMAL_MINUTES/);
 assert.deepEqual(await balance(p.cliente_id),[3,4]);assert.equal(await scalar('select count(*)::int v from crm_call_operations where cliente_id=$1',[p.cliente_id]),0);
});
test('Zero, negative, non-finite, and uncoded usage cannot create fake consumption/credits',async()=>{
 const p=await setup(70);for(const extra of [{minutos_1:0},{minutos_1:-5},{minutos_1:'NaN'},{codigo_1:null},{codigo_1:'unknown'}])await assert.rejects(call({...p,...extra}),/INVALID_CALL_MINUTES/);
 assert.deepEqual(await balance(p.cliente_id),[42,30]);
});
test('New purchase saving 42+30 from zero yields exactly 72, with 0 usage allowed',async()=>{
 const p=await setup(80,0,0);const purchase={...p,cliente_compra_minutos:true,tipo_registro:'compra',usa_minutos:false,guarda_minutos:true,minutos_guardados_free:42,minutos_guardados_normales:30,minutos_1:0,importe:35,forma_pago:'paypal_manual'};
 const r=await call(purchase);assert.equal(r.balances.total_after,72);assert.equal(r.rendimiento.tiempo,0);assert.deepEqual(await balance(p.cliente_id),[42,30]);
 await call(purchase);assert.equal(await scalar('select count(*)::int v from crm_cliente_pagos where cliente_id=$1',[p.cliente_id]),1);
});
test('Saved means remaining: 15 earlier + 42 saved = 57; current use is not subtracted a second time',async()=>{
 const p=await setup(90,15,0);await call({...p,cliente_compra_minutos:true,tipo_registro:'compra',guarda_minutos:true,minutos_guardados_free:42,minutos_guardados_normales:30,minutos_1:1,importe:35,forma_pago:'tpv'});
 assert.deepEqual(await balance(p.cliente_id),[57,30]);
});
test('Already confirmed PayPal call keeps one economic row and consumes 20 minutes once',async()=>{
 const p=await setup(100);await db.query("insert into crm_cliente_pagos(id,cliente_id,importe,estado) values($1,$2,35,'completed')",[id(9100),p.cliente_id]);
 await db.query("insert into crm_paypal_orders(payment_id,cliente_id,status,capture_id) values($1,$2,'completed','LOCAL_CAPTURE')",[id(9100),p.cliente_id]);
 const linked={...p,existing_payment_id:id(9100)};await call(linked);await call(linked);
 assert.deepEqual(await balance(p.cliente_id),[22,30]);assert.equal(await scalar('select count(*)::int v from crm_cliente_pagos where cliente_id=$1',[p.cliente_id]),1);
});
test('Client/worker operation conflicts and public RPC access are denied',async()=>{
 const p=await setup(110),other=await setup(111);await call(p);
 await assert.rejects(call({...p,cliente_id:other.cliente_id}),/PAYMENT_OPERATION_CONFLICT/);
 await assert.rejects(call({...p,telefonista_worker_id:id(444)}),/PAYMENT_OPERATION_CONFLICT/);
 for(const role of ['anon','authenticated']){
  assert.equal(await scalar("select has_function_privilege($1,'tc_register_call_minutes(jsonb)','execute') v",[role]),false);
  assert.equal(await scalar("select has_table_privilege($1,'crm_call_operations','select') v",[role]),false);
 }
});
