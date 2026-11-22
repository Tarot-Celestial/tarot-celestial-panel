const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const folder=path.join(__dirname,"../supabase/migrations");
const migration=suffix=>fs.readFileSync(path.join(folder,fs.readdirSync(folder).find(f=>f.endsWith(suffix))),"utf8");
const id=n=>"97000000-0000-4000-8000-"+String(n).padStart(12,"0");
const actor=id(991);
let db;
const query=async(q,v=[]) => (await db.query(q,v)).rows;
async function report(key="101",through=null) {
  return (await query("select office_campaign_pilot($1,$2,'2024-04-01','Europe/Madrid','2024-06-30',null,null,$3) r",[actor,key,through]))[0].r;
}
async function form(client,seq,campaign,at) {
  const lead=id(100+seq);
  await query("insert into captacion_leads values($1,$2,'Campaña','Formulario','meta')",[lead,id(client)]);
  await query("insert into meta_lead_events values($1,'processed','23','88',$2,$3,$4,$5,$5,$5,'{}')",[String(seq),campaign,id(client),lead,at]);
}
async function pay(seq,client,amount,currency,at,extra={}) {
  await query("insert into crm_cliente_pagos(id,cliente_id,importe,moneda,estado,created_at,stripe_session_id,source_rendimiento_id) values($1,$2,$3,$4,$5,$6,$7,$8)",
    [id(seq),id(client),amount,currency,extra.status||"completed",at,extra.stripe||null,extra.call||null]);
}
before(async()=>{
  db=new PGlite();
  await db.exec(`set time zone 'UTC'; create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to service_role,anon,authenticated;
    alter default privileges in schema public grant execute on functions to service_role,anon,authenticated;
    create table workers(id uuid primary key,display_name text,user_id uuid);
    create function office_actor(p_user uuid) returns uuid language sql as $$ select id from public.workers where user_id=p_user $$;
    create table crm_clientes(id uuid primary key,origen text,pais text);
    create table captacion_leads(id uuid primary key,cliente_id uuid,campaign_name text,form_name text,origen text);
    create table meta_lead_events(leadgen_id text,status text,page_id text,form_id text,campaign_id text,cliente_id uuid,captacion_lead_id uuid,
      meta_created_at timestamptz,received_at timestamptz,inserted_at timestamptz,payload jsonb);
    create table crm_cliente_pagos(id uuid,cliente_id uuid,importe numeric,moneda text,estado text,created_at timestamptz,referencia_externa text,
      stripe_session_id text,payment_intent text,paypal_capture_id text,paypal_order_id text,benefits_context jsonb,source_rendimiento_id uuid);
    create table rendimiento_llamadas(id uuid,cliente_id text,importe numeric,fecha_hora timestamptz,created_at timestamptz,cliente_compra_minutos boolean,telefonista_worker_id text,tiempo numeric,usa_minutos boolean,usa_7_free boolean);
    create table cliente_payment_attempts(id uuid,cliente_id uuid,amount numeric,currency text,status text,completed_at timestamptz,created_at timestamptz,provider text,order_id text,provider_response jsonb);
    create table cliente_oracle_credit_movements(id uuid,cliente_id uuid,amount int,movement_type text,reference text,meta jsonb,created_at timestamptz);
    create table cliente_oracle_question_movements(like cliente_oracle_credit_movements);
    create table crm_paypal_orders(id uuid,payment_id uuid,cliente_id uuid,checkout_kind text,status text,capture_id text,amount numeric,currency text,checked_at timestamptz,remote_status text);
    create table cliente_chat_payment_links(id uuid,cliente_id uuid,amount numeric,created_at timestamptz,paid_at timestamptz,status text,stripe_session_id text);
    create table cliente_chat_creditos(id uuid,cliente_id uuid,cantidad int,tipo text,created_at timestamptz,meta jsonb);
    create table office_meta_verified_clients(client_id uuid,contact_at timestamptz,opportunity_id uuid,channel text,bound_at timestamptz);
    create table office_capture_opportunities(id uuid,channel text,kind text,account_id text,lead_id uuid,client_id uuid,thread_id uuid);
    create table office_capture_attempts(request_id uuid,opportunity_id uuid,completed_at timestamptz,outcome text,receipt_id text,route text,source_id text);
    create table tc_instagram_sends(thread_id uuid,status text,remote_message_id text,completed_at timestamptz,resolved_at timestamptz);
    create table tc_facebook_sends(like tc_instagram_sends);
    create table captacion_whatsapp_deliveries(request_id uuid,lead_id uuid,cliente_id uuid,updated_at timestamptz,worker_id uuid,status text,message_sid text,submission_key text,id uuid default gen_random_uuid());
    create table captacion_whatsapp_delivery_events(delivery_id uuid,status text,message_sid text,created_at timestamptz,id bigint generated always as identity);
    create table office_commercial_changes(opportunity_id uuid,created_at timestamptz,actor_id uuid,action text);
  `);
  const history=migration("_crm_activity_month_history_2026.sql");
  await db.exec(history.match(/create or replace function public\.tc_crm_is_paid_stripe_oracle_purchase\([\s\S]*?\n\$\$;/)[0]);
  const canonical=migration("_office_crm_monthly_cohorts.sql");
  await db.exec(canonical.slice(canonical.indexOf("create function"),canonical.indexOf("-- Keep the phase 4")));
  await db.exec(migration("_office_campaign_pilot.sql"));
  await db.exec(migration("_office_conversion_funnel.sql"));
  await query("insert into workers values($1,'Operador de prueba',$2)",[id(990),actor]);
  for(let c=1;c<=13;c++)await query("insert into crm_clientes values($1,$2)",[id(c),c===11?"orion":"meta"]);
  for(let c=1;c<=8;c++)await form(c,c,"101",c===7?"2024-04-24":"2024-04-03");
  await form(1,30,"101","2024-04-07"); // The same person filled out the same campaign twice.
  await form(2,31,"202","2024-03-02"); // Earlier campaign in another month.
  await form(8,32,"202","2024-04-03"); // Different campaigns at exactly the same first instant.
  await form(9,33,null,"2024-04-03"); // Known form, no ad campaign identifier.
  await form(11,34,"101","2024-04-03"); // Orion is another business.
  await form(12,35,"101","2024-04-03");
  await query("update meta_lead_events set cliente_id=$1 where leadgen_id='35'",[id(13)]); // Conflicting CRM FK.
  await query("insert into office_meta_verified_clients values($1,'2024-03-25',$2,'instagram','2024-04-02')",[id(3),id(500)]);
  await query("insert into rendimiento_llamadas values($1,$2,12,'2024-04-10','2024-04-10',true,$3)",[id(710),id(1),id(990)]);
  await pay(201,1,12,"EUR","2024-04-10",{call:id(710)});
  await pay(202,1,15,"USD","2024-05-10");
  await pay(203,2,8,"EUR","2024-04-10"); await pay(204,3,8,"EUR","2024-04-10");
  await pay(205,4,9,"EUR","2024-02-01",{status:"refunded"});await pay(206,4,19,"EUR","2024-04-10");
  await pay(207,5,5,"EUR","2024-04-10",{stripe:"cs_test_skip"});await pay(208,6,0,"EUR","2024-04-10");
  await query("insert into cliente_oracle_question_movements values($1,$2,1,'purchase','stripe:cs_live_alpha',$3,'2024-05-01')",
    [id(209),id(7),{stripe_session_id:"cs_live_alpha",amount_eur:"5"}]);
  for(const c of [8,9,10,11,12])await pay(220+c,c,4,"USD","2024-04-15");
  await query("insert into office_capture_opportunities values($1,'meta_form','form','23',$2,$3)",[id(501),id(101),id(1)]);
  await query("insert into office_capture_attempts values($1,$2,'2024-04-04','sent','receiptA','oracle')",[id(600),id(501)]);
  await query("insert into office_commercial_changes values($1,'2024-04-05',$2,'claim')",[id(501),id(990)]);
  await query("insert into captacion_whatsapp_deliveries values($1,$2,$3,'2024-04-17',$4,'read','receiptB','meta:1'),($5,$2,$3,'2024-04-07',$4,'read','receiptA','meta:1'),($6,$2,$3,'2024-04-14',$4,'delivered','receiptC','meta:1')",
    [id(601),id(101),id(1),id(990),id(600),id(602)]);
  await query("insert into captacion_whatsapp_delivery_events select id,'accepted','receiptB','2024-04-06' from captacion_whatsapp_deliveries where request_id=$1",[id(601)]);
});
after(async()=>{await db?.close();});

test("embudo por país exige recibo, conserva compras sin respuesta previa y compara sólo cohortes observables",async()=>{
  await db.exec("begin");
  try {
    await query("update crm_clientes set pais=case when id=$1 then 'ES' when id=$2 then 'USA' else 'texto ajeno a un país' end",[id(1),id(7)]);
    await query("update meta_lead_events set payload=$1 where leadgen_id='2'",[{lead:{field_data:[{name:"country",values:["AR"]}]}}]);
    await query("update office_capture_attempts set source_id='1' where request_id=$1",[id(600)]);
    await query("update rendimiento_llamadas set tiempo=4,usa_minutos=true where cliente_id=$1",[id(1)]);
    await query("insert into office_capture_opportunities(id,channel,kind,account_id,client_id,thread_id) values($1,'instagram','message','account',$2,$3)",
      [id(730),id(7),id(732)]);
    await query("insert into office_meta_verified_clients values($1,'2024-04-24 00:01Z',$2,'instagram','2024-04-24 01:00Z')",[id(7),id(730)]);
    await query("insert into tc_instagram_sends values($1,'sent','remote','2024-04-24 00:05Z',null),($1,'uncertain','maybe','2024-04-24 00:02Z',null),($1,'confirmed_sent','late','2024-04-24 00:03Z','2024-07-02')",[id(732)]);
    await query("insert into captacion_whatsapp_deliveries(request_id,lead_id,cliente_id,updated_at,status,message_sid,submission_key) values($1,$2,$3,'2024-04-05','undelivered','never','meta:5'),($4,$5,$6,'2024-04-04','sent','wrong','meta:99')",
      [id(710),id(105),id(5),id(711),id(106),id(6)]);
    await query("insert into captacion_whatsapp_delivery_events(delivery_id,status,message_sid,created_at) select id,'accepted','never','2024-04-04' from captacion_whatsapp_deliveries where message_sid='never'");
    const q="select office_conversion_funnel($1,'101','2024-04-01','Europe/Madrid',$2,$3) r";
    const countries={es:"España",ar:"Argentina",usa:"Estados Unidos"};
    const current=(await query(q,[actor,"2024-04-25",countries]))[0].r;
    assert.deepEqual(current.funnel.total,{country:null,contacts:8,replied:2,median_reply_minutes:722.5,first_buyers:1,
      buyers_after_reply:1,phone_routed:0,oracle_routed:1,without_reply_or_purchase:6,matured_contacts:7,buyers_within_7d:1,recorded_consultations:1});
    assert.deepEqual(current.funnel.countries.map(x=>[x.country,x.contacts,x.first_buyers]),[[null,5,0],["Argentina",1,0],["España",1,1],["Estados Unidos",1,0]]);
    assert.equal(current.funnel.countries.find(c=>c.country==="Estados Unidos").matured_contacts,0);
    const later=(await query(q,[actor,"2024-06-30",countries]))[0].r;
    assert.equal(later.funnel.total.first_buyers,2);assert.equal(later.funnel.total.matured_contacts,8);assert.equal(later.funnel.total.buyers_within_7d,2);
    await query("update office_capture_attempts set outcome='failed' where request_id=$1",[id(600)]);
    await query("delete from captacion_whatsapp_deliveries where cliente_id=$1",[id(1)]);
    const noReceipt=(await query(q,[actor,"2024-06-30",countries]))[0].r;
    assert.equal(noReceipt.funnel.total.first_buyers,2);assert.equal(noReceipt.funnel.total.replied,1);assert.equal(noReceipt.funnel.total.buyers_after_reply,1);
    assert.equal(noReceipt.funnel.total.recorded_consultations,1);
    const permission="office_conversion_funnel(uuid,text,date,text,timestamptz,jsonb,timestamptz,uuid,date)";
    for(const role of ["anon","authenticated"])assert.equal((await query("select has_function_privilege($1,$2,'execute') allowed",[role,permission]))[0].allowed,false);
    await assert.rejects(query(q,[id(85),"2024-04-25",countries]),/OFFICE_INVALID/);
  } finally {await db.exec("rollback");}
});

test("deduplica contactos y adjudica primeras compras comprobadas en todas las campañas y canales",async()=>{
  const r=await report("101","2024-04-15");
  assert.equal(r.contacts,8);assert.equal(r.first_buyers,2);assert.equal(r.cost_first_buyers,1);
  assert.deepEqual(r.buyers.map(b=>b.client_id),[id(7),id(1)]);
  assert.equal(r.buyers[0].source,"stripe_oracle_questions");
  assert.deepEqual(r.amounts.map(m=>[m.currency,m.first_count,m.first_gross,m.receipts,m.gross]),[["EUR",2,17,2,17],["USD",0,0,1,15]]);
  assert.equal(r.unattributed_first_purchases,5); // earlier DM, ambiguous tie, form only, no form, FK mismatch.
  assert.equal((await report(null)).unattributed_first_purchases,5);
  assert.equal((await report("form-88")).first_buyers,1);
  assert.equal((await report("202")).first_buyers,0);
});
test("la traza exige fuente y persona exactas, limita al intervalo real y conserva el operador de llamada",async()=>{
  const r=await report(),b=r.buyers.find(b=>b.client_id===id(1));
  assert.deepEqual(b.handling.map(h=>[h.kind,h.route,h.operator||null]),[["automated","oracle",null],["commercial","claim","Operador de prueba"],["whatsapp","whatsapp","Operador de prueba"]]);
  assert.equal(b.call_operator,"Operador de prueba");
  assert.equal(r.buyers.find(b=>b.client_id===id(7)).handling,null);
  const page=(await query("select office_campaign_pilot($1,'101','2024-04-01','Europe/Madrid','2024-06-30',$2,$3,null) r",
    [actor,r.buyers[0].purchase_at,r.buyers[0].client_id]))[0].r;
  assert.deepEqual(page.buyers.map(b=>b.client_id),[id(1)]);
});
test("CSV idempotente, inmutable, una cuenta por campaña y permisos de servidor",async()=>{
  const args=[actor,"101","999","EUR","Europe/Madrid","2024-04-01","2024-04-29","90","a".repeat(64)];
  const call=params=>query("select office_pilot_record_csv($1,$2,$3,$4,$5,$6,$7,$8,$9) id",params);
  const first=await call(args);assert.deepEqual(await call(args),first);
  await assert.rejects(call(args.with(7,"91")),/OFFICE_CONFLICT/);
  await assert.rejects(call(args.with(2,"998").with(6,"2024-04-20")),/OFFICE_CONFLICT/);
  await assert.rejects(call(args.with(5,"2024-04-15")),/OFFICE_INVALID/);
  await assert.rejects(call(args.with(0,id(77))),/OFFICE_INVALID/);
  for(const role of ["anon","authenticated"]) {
    assert.equal((await query("select has_table_privilege($1,'office_campaign_cost_evidence','select') allowed",[role]))[0].allowed,false);
    assert.equal((await query("select has_function_privilege($1,'office_campaign_pilot(uuid,text,date,text,timestamptz,timestamptz,uuid,date)','execute') allowed",[role]))[0].allowed,false);
  }
  assert.equal((await query("select has_table_privilege('service_role','office_campaign_cost_evidence','truncate') allowed"))[0].allowed,false);
  await db.exec("set role service_role");
  try{assert.equal((await report()).first_buyers,2);}finally{await db.exec("reset role");}
});
