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
 for(const file of ['20261007173256_paypal_link_existing_call.sql','20261007233546_call_minute_accounting.sql','20261008113235_purchase_minutes_before_use.sql'])
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));
 await db.query('insert into workers values($1)',[id(1)]);
});
after(async()=>db.close());
async function setup(n,free=42,normal=30){
 await db.query('insert into crm_clientes(id,minutos_free_pendientes,minutos_normales_pendientes) values($1,$2,$3)',[id(n),free,normal]);
 return {cliente_id:id(n),operation_id:id(n+2000),telefonista_worker_id:id(1),cliente_compra_minutos:false,tipo_registro:'minutos',usa_minutos:true,usa_7_free:false,codigo_1:'FREE',minutos_1:20,minutos_2:0,free_delta:999,normal_delta:999,note_text:'Prueba local',importe:0};
}
const call=p=>scalar('select tc_register_call_minutes_v2($1::jsonb) v',[JSON.stringify(p)]);
const balance=c=>scalar("select jsonb_build_array(minutos_free_pendientes,minutos_normales_pendientes) v from crm_clientes where id=$1",[c]);

test('Purchase 20 FREE + 20 normal minus 5 FREE leaves 15 + 20; note matches actual balance',async()=>{
 const p=await setup(10,0,0);const r=await call({...p,cliente_compra_minutos:true,tipo_registro:'compra',guarda_minutos:true,minutos_guardados_free:20,minutos_guardados_normales:20,minutos_1:5,forma_pago:'tpv',importe:1});
 assert.deepEqual(await balance(p.cliente_id),[15,20]);assert.equal(r.minute_accounting.used_free,5);
 const text=await scalar('select texto v from crm_client_notes where cliente_id=$1',[p.cliente_id]);assert.match(text,/Consumo: 5 FREE/);assert.match(text,/Saldo final: 15 FREE/);
});
test('Prior balance and real bonus are distinct; replay does not consume or award twice',async()=>{
 await db.exec(`create or replace function tc_apply_purchase_benefits(p uuid) returns jsonb language plpgsql as $$begin update crm_clientes set minutos_free_pendientes=minutos_free_pendientes+15 where id=(select cliente_id from crm_cliente_pagos where id=p);return '{}'::jsonb;end $$;`);
 const p={...await setup(20,134,0),cliente_compra_minutos:true,tipo_registro:'compra',guarda_minutos:true,minutos_guardados_free:20,minutos_guardados_normales:20,minutos_1:5,forma_pago:'tpv',importe:1};
 const r=await call(p);assert.deepEqual(await balance(p.cliente_id),[164,20]);assert.equal(r.minute_accounting.bonus_free,15);await call(p);assert.deepEqual(await balance(p.cliente_id),[164,20]);
});
test('Consumption cannot exceed new purchase buckets; no mutation on error',async()=>{
 const p={...await setup(30,100,100),cliente_compra_minutos:true,tipo_registro:'compra',guarda_minutos:true,minutos_guardados_free:20,minutos_guardados_normales:20,minutos_1:25};
 await assert.rejects(call(p),/PURCHASE_MINUTES_EXCEEDED/);assert.deepEqual(await balance(p.cliente_id),[100,100]);
});
test('Ordinary call still deducts 5 FREE once',async()=>{
 const p={...await setup(40,20,20),minutos_1:5};await call(p);await call(p);assert.deepEqual(await balance(p.cliente_id),[15,20]);
});

test('Targeted historical adjustment subtracts only confirmed five, with audit and safe replay',async()=>{
 const c='25c68fc9-0512-4d0c-894b-e591a2a81376';
 await db.query('insert into crm_clientes(id,minutos_free_pendientes,minutos_normales_pendientes) values($1,169,20)',[c]);
 await db.query('insert into crm_client_notes(cliente_id,texto,event_data) values($1,$2,$3::jsonb)',[c,'Original',JSON.stringify({rendimiento_id:'075385c4-9cdd-4bd8-89b8-8b8c143ac617',payment_id:'e4fe44f7-8811-443f-a540-c49de9cb3727',free_before:134,free_after:154,free_delta:20})]);
 const sql=fs.readFileSync(path.join(__dirname,'fixtures/correct-anonymus-5-free.sql'),'utf8');await db.exec(sql);await db.exec(sql);
 assert.deepEqual(await balance(c),[164,20]);assert.equal(await scalar("select count(*)::int v from crm_client_notes where cliente_id=$1 and event_type='minute_adjustment'",[c]),1);
});
