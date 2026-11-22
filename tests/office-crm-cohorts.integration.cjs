const {test,before,after} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {PGlite} = require("@electric-sql/pglite");
const migration = name=>fs.readFileSync(path.join(__dirname,"../supabase/migrations",name),"utf8");
const cohortFile = fs.readdirSync(path.join(__dirname,"../supabase/migrations")).filter(name=>name.endsWith("_office_crm_monthly_cohorts.sql"));
assert.equal(cohortFile.length,1);
const phase4 = migration("20261122210707_office_crm_client_reads.sql");
const history = migration("20261113225107_crm_activity_month_history_2026.sql");
const oracle = history.match(/create or replace function public\.tc_crm_is_paid_stripe_oracle_purchase\([\s\S]*?\n\$\$;/)[0];
const id = n=>"58000000-0000-4000-8000-"+String(n).padStart(12,"0");
const apr = "2024-04-10T12:00:00Z", may = "2024-05-10T12:00:00Z", cut = "2024-06-01T13:00:00Z";
let db;
async function sql(query,params) { return (await db.query(query,params)).rows; }
async function report(month="2024-04-01",cutoff=cut) { return (await sql("select office_crm_cohort_report($1,$2) r",[month,cutoff]))[0].r; }
async function payment(n,client,amount,currency,at,status="completed",reference=null,session=null,intent=null) {
  await sql("insert into crm_cliente_pagos(id,cliente_id,importe,moneda,estado,created_at,referencia_externa,stripe_session_id,payment_intent) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [id(n),id(client),amount,currency,status,at,reference,session,intent]);
}
before(async ()=>{
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table crm_clientes(id uuid primary key,nombre text,apellido text,pais text,auth_user_id uuid,origen text,created_at timestamptz,updated_at timestamptz);
    create table crm_cliente_pagos(id uuid,cliente_id uuid,importe numeric,moneda text,estado text,created_at timestamptz,referencia_externa text,
      stripe_session_id text,payment_intent text,paypal_capture_id text,paypal_order_id text,benefits_context jsonb,source_rendimiento_id uuid);
    create table rendimiento_llamadas(id uuid,cliente_id text,importe numeric,fecha_hora timestamptz,created_at timestamptz,cliente_compra_minutos boolean);
    create table cliente_payment_attempts(id uuid,cliente_id uuid,amount numeric,currency text,status text,completed_at timestamptz,created_at timestamptz,provider text,order_id text,provider_response jsonb);
    create table cliente_oracle_credit_movements(id uuid,cliente_id uuid,amount int,movement_type text,reference text,meta jsonb,created_at timestamptz);
    create table cliente_oracle_question_movements(like cliente_oracle_credit_movements);
    create table crm_paypal_orders(id uuid,payment_id uuid,cliente_id uuid,checkout_kind text,status text,capture_id text,amount numeric,currency text,checked_at timestamptz,remote_status text);
    create table cliente_chat_payment_links(id uuid,cliente_id uuid,amount numeric,created_at timestamptz,paid_at timestamptz,status text,stripe_session_id text);
    create table cliente_chat_creditos(id uuid,cliente_id uuid,cantidad int,tipo text,created_at timestamptz,meta jsonb);
    create table meta_lead_events(cliente_id uuid,status text,received_at timestamptz,inserted_at timestamptz);
    create table tc_client_registration_challenges(cliente_id uuid,created_at timestamptz,profile jsonb,state text);
    create table client_referrals(referred_id uuid,created_at timestamptz);
    create table captacion_leads(cliente_id uuid,origen text,created_at timestamptz,updated_at timestamptz);
    grant select on all tables in schema public to service_role;
  `);
  await db.exec(oracle);
  // Install the real previous view and its permissions, then replace it in place.
  await db.exec(phase4.slice(phase4.indexOf("create view"),phase4.indexOf("-- Used by the existing Central")));
  await db.exec(migration(cohortFile[0]));
  for(let n=1;n<=9;n++) await sql("insert into crm_clientes(id,origen,created_at,updated_at) values($1,$2,'2024-01-01','2024-06-02')",[id(n),n===8?"orion":null]);
  const stripe = {stripe_session_id:"cs_shared",payment_intent:"pi_shared",amount_eur:"15"};
  await payment(100,1,15,"EUR",apr,"completed","cs_shared",null,null);
  for (const table of ["cliente_oracle_credit_movements","cliente_oracle_question_movements"]) {
    await sql(`insert into ${table} values($1,$2,3,'purchase','stripe:cs_shared',$3,$4)`,[id(101),id(1),stripe,apr]);
  }
  await payment(102,1,15,"EUR",apr,"completed",null,null,"pi_shared");
  await payment(103,1,20,"USD",may,"completed","mollie:tr_mock");
  await sql("insert into cliente_payment_attempts values($1,$2,20,'USD','completed',$3,$3,'mollie','tr_mock',null)",[id(104),id(1),may]);
  // No trusted ID connects these two purchases; sharing amount/time alone never merges them.
  await payment(105,2,10,"EUR",apr,"completed","manual duplicated text");
  await payment(106,2,10,"EUR",apr,"completed","manual duplicated text");
  await sql("insert into rendimiento_llamadas values($1,$2,11,$3,$3,true)",[id(107),id(3),apr]);
  await payment(108,4,7,"EUR","2024-03-31T21:59:59Z");
  await payment(109,4,9,"EUR",apr); // Earlier real purchase already exists; not a new acquisition in April.
  await payment(110,5,18,"USD","2024-03-31T22:00:00Z");
  await sql("update crm_cliente_pagos set paypal_capture_id='CAPTURE09' where id=$1",[id(110)]);
  await sql("insert into crm_paypal_orders values($1,$2,$3,'client_purchase','completed','CAPTURE09',18,'USD',$4,'CAPTURE_PARTIALLY_REFUNDED')",[id(111),id(110),id(5),may]);
  await sql("insert into cliente_chat_payment_links values($1,$2,4,'2024-04-01',$3,'paid','cs_chat')",[id(112),id(6),apr]);
  await sql("insert into cliente_chat_creditos values($1,$2,3,'purchase',$3,$4)",[id(113),id(6),apr,{stripe_session_id:"cs_chat",amount_usd:4}]);
  await payment(114,7,15,"GBP",apr,"completed",null,"cs_clash");
  await payment(115,7,19,"GBP",apr,"completed",null,"cs_clash");
  await payment(116,8,40,"EUR",apr);
  await payment(117,9,3,"EUR",apr,"failed");
  await sql("insert into meta_lead_events values($1,'processed','2024-04-01','2024-04-01'),($2,'processed','2024-05-01','2024-05-01')",[id(1),id(2)]);
  await sql("insert into client_referrals values($1,'2024-04-02')",[id(2)]);
  await sql("insert into captacion_leads values($1,'private untrusted client label','2024-03-01','2024-03-01')",[id(6)]);
  await sql("update crm_clientes set origen='facebook_ads' where id=$1",[id(7)]);
});
after(async()=>{await db?.close();});

test("deduplica recibos enlazados transitivamente y concilia primera compra global, mes local y acumulado por divisa",async()=>{
  const r = await report();
  assert.equal(r.captured_clients,6);
  assert.deepEqual(r.totals.map(t=>t.currency),["EUR","GBP","USD",null]);
  const eur = r.totals[0], usd = r.totals[2];
  assert.equal(eur.first.purchases,2); assert.equal(eur.first.gross,25);
  assert.equal(eur.month_to_date.purchases,3); assert.equal(eur.month_to_date.gross,35);
  assert.equal(usd.first.gross,22); assert.equal(usd.month_to_date.confirmed,4); assert.equal(usd.month_to_date.refund_flagged,18);
  assert.equal(usd.month_to_date.refund_unknown_count,1); assert.equal(usd.lifetime_to_cutoff.gross,42);
  assert.equal(r.totals[1].first.gross,null); assert.equal(r.totals[1].first.unresolved_count,1);
  assert.equal(r.totals[3].first.gross,null); assert.equal(r.totals[3].first.purchases,1);
  assert.equal((await sql("select count(*)::integer n from office_crm_purchase_evidence where client_id=$1",[id(1)]))[0].n,2);
});
test("sólo categorías públicas y orígenes previos; orden determinista y corte contable explícito",async()=>{
  const r = await report();
  assert.deepEqual(r,await report());
  assert.deepEqual(r.origins.map(x=>[x.origin,x.basis,x.captured_clients]),[["meta_lead","current_only",1],["meta_lead","historical",1],
    ["other_recorded","historical",1],["referral","historical",1],["unknown","unknown",2]]);
  assert(!JSON.stringify(r).includes("private")); assert(!JSON.stringify(r).includes(id(1)));
  const old = await report("2024-04-01","2024-04-15T00:00:00Z");
  assert.equal(old.totals.find(x=>x.currency==="USD").lifetime_to_cutoff.gross,22);
  assert.equal(old.totals.find(x=>x.currency==="USD").lifetime_to_cutoff.refund_flagged,0);
  const empty = await report("2024-02-01");
  assert.deepEqual(empty.origins,[]); assert.deepEqual(empty.totals,[]); assert.equal(empty.captured_clients,0);
});
test("consulta de cohortes y evidencia restringidas a rol servidor",async()=>{
  for (const role of ["anon","authenticated"]) for(const fn of ["office_crm_receipts(timestamptz)","office_crm_cohort_report(date,timestamptz)"]) {
    assert.equal((await sql("select has_function_privilege($1,$2,'execute') allowed",[role,fn]))[0].allowed,false);
  }
  await assert.rejects(report("2024-05-02"),/OFFICE_INVALID/);
  await assert.rejects(report("2025-01-01",cut),/OFFICE_INVALID/);
  await db.exec("set role service_role");
  try {assert.equal((await report()).captured_clients,6);}
  finally {await db.exec("reset role");}
});
