const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

const migration = name => fs.readFileSync(path.join(__dirname, "../supabase/migrations", name), "utf8");
const office = migration("20261122191931_office_celestial_workspace.sql");
const commercial = migration("20261113225107_crm_activity_month_history_2026.sql");
const actorSql = office.match(/create function public\.office_actor\([\s\S]*?end \$\$;/)[0];
const oracleSql = commercial.match(/create or replace function public\.tc_crm_is_paid_stripe_oracle_purchase\([\s\S]*?\n\$\$;/)[0];
const id = n => "67000000-0000-4000-8000-" + String(n).padStart(12, "0");
const actor = id(801), at = "2022-03-05T12:00:00Z", asOf = "2023-01-01T00:00:00Z";
let db;
const rows = async (sql, args) => (await db.query(sql, args)).rows;
const page = (stage = "all", after = null, limit = 50, term = "") => rows("select * from office_crm_client_page($1,$2,$3,$4,$5,$6)",
  [actor,term,after,limit,asOf,stage]);
const detail = async (client, limit = 25, after = {}) => (await rows(
  "select office_crm_client_detail($1,$2,$3,$4,$5,$6) v", [actor,id(client),after.at || null,after.id || null,limit,after.source || null]))[0].v;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table workers(id uuid primary key,user_id uuid,is_active boolean,role text);
    create function tc_has_admin_access(p_user uuid) returns boolean language sql as $$
      select exists(select 1 from public.workers where user_id=p_user and role='admin' and is_active is not false) $$;
    create table crm_clientes(id uuid primary key,nombre text,apellido text,pais text,created_at timestamptz,auth_user_id uuid,origen text);
    create table crm_cliente_pagos(id uuid primary key,cliente_id uuid,importe numeric,moneda text,estado text,created_at timestamptz,
      source_rendimiento_id uuid,referencia_externa text,benefits_context jsonb,paypal_capture_id text);
    create table rendimiento_llamadas(id uuid primary key,cliente_id text,importe numeric,fecha_hora timestamptz,created_at timestamptz,cliente_compra_minutos boolean);
    create table cliente_payment_attempts(id uuid primary key,cliente_id uuid,amount numeric,currency text,status text,completed_at timestamptz,
      created_at timestamptz,provider text,order_id text,provider_response jsonb);
    create table cliente_oracle_credit_movements(id uuid,cliente_id uuid,amount int,movement_type text,reference text,meta jsonb,created_at timestamptz);
    create table cliente_oracle_question_movements(like cliente_oracle_credit_movements);
    create table reservas(id uuid,cliente_id uuid,fecha_reserva timestamp without time zone,estado text,tarotista_nombre text,tarotista_nombre_manual text,deleted_at timestamptz);
    create table first_tarotist_reservations(id uuid,completion_cliente_id uuid,scheduled_at timestamptz,status text,tarotista_name text,brand text);
    create table captacion_leads(id uuid,cliente_id uuid,estado text,created_at timestamptz,next_contact_at timestamptz,origen text);
    grant usage on schema public to service_role;
    grant select on all tables in schema public to service_role;
  `);
  await db.exec(actorSql); await db.exec(oracleSql);
  await db.exec(migration("20261122210707_office_crm_client_reads.sql"));
  await db.query("insert into workers values($1,$2,true,'admin'),($3,$4,true,'central')", [id(800),actor,id(802),id(803)]);
  for(let n=1;n<=11;n++) await db.query("insert into crm_clientes values($1,'Ficha','Sintética','España',$2,$3,$4)",
    [id(n), "2020-01-01T00:00Z", n===2?id(900):null, n===11?"Otra Orion":null]);
  function call(row, client, amount, marked, date = at) {
    return db.query("insert into rendimiento_llamadas values($1,$2,$3,$4,$4,$5)", [id(row),id(client),amount,date,marked]);
  }
  function payment(row,client,state,amount,source=null,ref=null,context=null) {
    return db.query("insert into crm_cliente_pagos values($1,$2,$3,'USD',$4,$5,$6,$7,$8)",[id(row),id(client),amount,state,at,source,ref,context]);
  }
  function attempt(row,client,state,completed,order,metadata=null) {
    return db.query("insert into cliente_payment_attempts values($1,$2,17,'EUR',$3,$4,$5,'mollie',$6,$7)",
      [id(row),id(client),state,completed,at,order,metadata]);
  }
  // Genuine historical purchase even if refunded later. Failed linked calls never resurrect a sale.
  await call(101,1,19,true,"2022-03-01T12:00:00Z"); await payment(201,1,"refunded",19,id(101));
  await call(102,2,25,true); await payment(202,2,"failed",25,id(102),"mollie:failed");
  await attempt(302,2,"completed",at,"failed");
  await call(103,3,13,true); await call(104,4,9,false); await call(105,4,0,true);
  await payment(204,4,"completed",9,null,null,{collection_only:true});
  await attempt(305,5,"completed",at,"verified");
  await attempt(306,6,"pending",null,"pending"); await attempt(307,6,"refunded",null,"no-prior-capture");
  for(const [table,client,meta] of [
    ["cliente_oracle_credit_movements",6,{ stripe_session_id:"cs_mock", amount_eur:"bad" }],
    ["cliente_oracle_credit_movements",7,{ stripe_session_id:"cs_mock", amount_eur:"5.50" }],
    ["cliente_oracle_question_movements",8,{ stripe_session_id:"cs_mock", amount_eur:"4" }],
  ]) await db.query(`insert into ${table} values($1,$2,2,'purchase','stripe:cs_mock',$3,$4)`,[id(400+client),id(client),meta,at]);
  await payment(209,9,"completed",0); await payment(210,10,"completed",7); await payment(211,11,"completed",8);
  await payment(309,9,"reversed",9);
  await payment(310,10,"reversed",12);
  await db.query("update crm_cliente_pagos set paypal_capture_id='CAPTURE-TEST',created_at='2021-01-01T00:00Z' where id=$1",[id(310)]);
  // Same date AND same UUID across distinct booking sources. The cursor must preserve both.
  for(const [pk,date,deleted] of [[501,at,null],[502,"2022-01-01T10:00:00Z",null],[503,null,null],[504,at,at]])
    await db.query("insert into reservas values($1,$2,$3,'pendiente',null,'Equipo',$4)",[id(pk),id(1),date,deleted]);
  for(const [pk,client,brand] of [[501,id(1),"celestial"],[505,id(1),"orion"],[506,null,"celestial"]])
    await db.query("insert into first_tarotist_reservations values($1,$2,$3,'completada','Equipo',$4)",[id(pk),client,at,brand]);
  await db.query("insert into captacion_leads values($1,$2,'nuevo',$3,null,'formulario')",[id(601),id(1),at]);
});
after(async () => { await db?.close(); });

test("primera compra histórica global, prueba de pago y exclusiones de duplicados, llamadas y cobros visuales", async () => {
  const expected = [1,3,5,7,8,10];
  assert.deepEqual((await page("captured")).map(r=>r.id),expected.map(id));
  assert.deepEqual((await page("pending")).map(r=>r.id),[2,4,6,9].map(id));
  assert.equal((await detail(1)).first_purchase.status,"refunded");
  assert.equal((await detail(1)).first_purchase.id,id(201));
  assert.equal((await detail(3)).first_purchase.currency,null);
  assert.equal((await detail(5)).first_purchase.source,"cliente_payment_attempts");
  assert.equal((await detail(7)).first_purchase.amount,5.5);
  assert.equal((await detail(8)).first_purchase.source,"stripe_oracle_questions");
  assert.equal((await detail(9)).first_purchase,null);
  assert.equal((await detail(10)).first_purchase.status,"reversed");
  const firsts = await rows("select client_id from tc_crm_first_purchases_batch($1) order by client_id", [Array.from({length:10},(_,i)=>id(i+1))]);
  assert.deepEqual(firsts.map(r=>r.client_id),expected.map(id));
  assert.deepEqual((await rows("select office_crm_capture_totals($1) t",[actor]))[0].t,{total_clients:10,captured_clients:6});
});

test("filtros antes de paginar, UUID fiable, búsqueda literal y separación de marcas", async () => {
  const first = await page("captured",null,2);
  assert.deepEqual(first.map(r=>r.id),[1,3].map(id));
  assert.deepEqual((await page("captured",first.at(-1).id,2)).map(r=>r.id),[5,7].map(id));
  assert.equal((await page("all",null,25,id(2)))[0].account_linked,true);
  assert.equal((await page("all",null,25,"%")).length,0);
  assert.equal(await detail(11),null); assert.equal(await detail(999),null);
  assert.equal((await detail(1)).capture.id,id(601));
  assert.equal((await detail(2)).capture,null);
});

test("página todas las reservas reales por fecha, UUID y fuente sin enlazar identidades por nombre", async () => {
  const out = []; let cursor;
  do {
    const value = await detail(1,1,cursor);
    const line = value.appointments[0];
    assert.equal(value.appointments.length,1);
    out.push([line.id,line.source]);
    cursor = value.appointments_has_more ? line : null;
    if(out.length===1) assert.equal(Date.parse(line.at),Date.parse(at));
    assert(out.length<=4);
  } while(cursor);
  assert.deepEqual(out,[[id(501),"first_tarotist_reservations"],[id(501),"reservas"],[id(502),"reservas"],[id(503),"reservas"]]);
});

test("solo administración puede acceder por RPC con rol servidor y límites validados", async () => {
  for (const role of ["anon","authenticated"]) {
    for (const fn of ["office_crm_capture_totals(uuid)", "office_crm_client_page(uuid,text,uuid,integer,timestamptz,text)", "tc_crm_first_purchases_batch(uuid[])"]) {
      assert.equal((await rows("select has_function_privilege($1,$2,'execute') allowed",[role,fn]))[0].allowed,false);
    }
    assert.equal((await rows("select has_table_privilege($1,'office_crm_purchase_evidence','select') allowed",[role]))[0].allowed,false);
  }
  await assert.rejects(rows("select office_crm_capture_totals($1)",[id(803)]), /OFFICE_FORBIDDEN/);
  await assert.rejects(page("all",null,52), /OFFICE_INVALID/);
  await assert.rejects(detail(1,51), /OFFICE_INVALID/);
  await assert.rejects(page("any"), /OFFICE_INVALID/);
  await assert.rejects(rows("select * from tc_crm_first_purchases_batch($1)",[Array.from({length:201},()=>id(1))]),/OFFICE_INVALID/);
  await db.exec("set role service_role");
  try { assert.equal((await detail(1)).client.id,id(1)); }
  finally { await db.exec("reset role"); }
});

test("Mi cartera conserva contacto y minutos FREE con la misma fecha de compra que la Oficina", async () => {
  const ts = require("typescript");
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname,"../src/lib/server/client-capture-status.ts"),"utf8");
  require("node:vm").runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
  const clients = [2,4,7].map(n=>({id:id(n)}));
  const admin = {
    async rpc(name,{p_client_ids}) {
      assert.equal(name,"tc_crm_first_purchases_batch");
      assert.deepEqual(Array.from(p_client_ids),clients.map(c=>c.id));
      return { data:await rows("select * from tc_crm_first_purchases_batch($1)",[Array.from(p_client_ids)]) };
    },
    from(table) {
      assert(["rendimiento_llamadas","crm_interacciones"].includes(table));
      return {select(){return this;},in(){return this;},range(){
        return {data:table==="rendimiento_llamadas" ? [{cliente_id:id(4),tiempo:7,usa_7_free:true,created_at:at}] : []};
      }};
    },
  };
  const stats = await exports.loadClientCaptureStatusBatch(admin,clients);
  assert.equal(stats.get(id(2)).stage,"untouched");
  assert.equal(stats.get(id(4)).stage,"pending"); assert.equal(stats.get(id(4)).free_minutes_used,7);
  assert.equal(stats.get(id(7)).stage,"captured");
  assert.equal(Date.parse(stats.get(id(7)).first_purchase_at),Date.parse((await detail(7)).first_purchase.at));
});
