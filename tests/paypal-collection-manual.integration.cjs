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
 create table crm_client_notes(cliente_id text,texto text,author_user_id uuid,author_name text,author_email text,is_pinned boolean,created_at timestamptz,event_type text,event_data jsonb);
 -- Only the independent rewards system is stubbed. The actual installed v8 runs unchanged.
 create table benefit_calls(payment_id uuid);
 create function tc_apply_purchase_benefits(p uuid) returns jsonb language plpgsql as $$begin insert into benefit_calls values(p);return '{}'::jsonb;end$$;
 create function cliente_confirmar_compra_ruleta_v2(jsonb) returns jsonb language plpgsql as $$begin raise exception 'AUTOMATIC_PURCHASE_FORBIDDEN';end$$;
 create function cliente_confirmar_compra_ruleta_v3(jsonb) returns jsonb language plpgsql as $$begin raise exception 'AUTOMATIC_PURCHASE_FORBIDDEN';end$$;
 grant all on crm_clientes,crm_cliente_pagos,rendimiento_llamadas,workers,crm_client_notes to service_role;
 `);
 await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/crm-v8-verification.sql'),'utf8'));
 for(const file of ['20261006235223_paypal_crm_checkout.sql','20261008175017_paypal_collection_only.sql','20261007173256_paypal_link_existing_call.sql','20261007233546_call_minute_accounting.sql','20261008113235_purchase_minutes_before_use.sql'])
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8'));
 await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/crm-call-minutes-current.sql'),'utf8'));
 await db.query('insert into workers values($1)',[id(1)]);
});
after(async()=>db.close());
async function setup(n,free=42,normal=30){
 await db.query('insert into crm_clientes(id,minutos_free_pendientes,minutos_normales_pendientes) values($1,$2,$3)',[id(n),free,normal]);
 return {cliente_id:id(n),operation_id:id(n+2000),telefonista_worker_id:id(1),cliente_compra_minutos:false,tipo_registro:'minutos',usa_minutos:true,usa_7_free:false,codigo_1:'FREE',minutos_1:20,minutos_2:0,free_delta:999,normal_delta:999,note_text:'Prueba local',importe:0};
}
const call=p=>scalar('select tc_register_call_minutes($1::jsonb) v',[JSON.stringify(p)]);
const balance=c=>scalar("select jsonb_build_array(minutos_free_pendientes,minutos_normales_pendientes) v from crm_clientes where id=$1",[c]);


test('Collection: zero purchases or benefits; manual purchase: exactly one including retry',async()=>{
 const p=await setup(30,0,0);
 await db.query("insert into crm_paypal_orders(id,cliente_id,worker_id,environment,order_id,amount,pack_id,pack_name,purchase_payload,create_payload) values($1,$2,$3,'sandbox','ORDER30',12,'pack10','10 minutos','{}','{}')",[id(90),id(30),id(1)]);
 const confirm=()=>scalar("select tc_complete_paypal_crm($1,'ORDER30','CAP30',12,'EUR') v",[id(90)]);
 await confirm();await confirm();
 assert.deepEqual(await balance(id(30)),[0,0]);
 assert.equal(await scalar('select count(*)::int v from crm_cliente_pagos'),0);
 assert.equal(await scalar('select count(*)::int v from benefit_calls'),0);
 assert.equal(await scalar('select puntos::int v from crm_clientes where id=$1',[id(30)]),0);
 const purchase={...p,cliente_compra_minutos:true,tipo_registro:'compra',importe:12,forma_pago:'paypal_manual',guarda_minutos:true,minutos_guardados_free:10,minutos_guardados_normales:0,minutos_1:0,tiempo:0,points_to_add:120};
 await call(purchase);await call(purchase);await confirm();
 assert.deepEqual(await balance(id(30)),[10,0]);
 assert.equal(await scalar('select count(*)::int v from crm_cliente_pagos'),1);
 assert.equal(await scalar('select count(*)::int v from benefit_calls'),1);
 assert.equal(await scalar('select count(*)::int v from rendimiento_llamadas'),1);
 assert.equal(await scalar('select payment_id v from crm_paypal_orders where id=$1',[id(90)]),null);
});
