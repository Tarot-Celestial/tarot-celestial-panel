const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

const client = "41111111-1111-4111-8111-111111111111";
const admin = "42222222-2222-4222-8222-222222222222";
let db;
async function scalar(sql, args = []) { return (await db.query(sql, args)).rows[0].v; }
const round = () => scalar("select public.office_agent_round() v");
const activity = () => scalar("select public.office_agent_activity($1) v", [admin]);

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table crm_clientes(id uuid primary key, origen text, created_at timestamptz default now());
    create table reservas(id uuid primary key,cliente_id uuid,fecha_reserva timestamp,estado text,tarotista_id uuid,
      tarotista_nombre_manual text,tarotista_nombre text,deleted_at timestamptz);
    create table first_tarotist_reservations(id uuid primary key,completion_cliente_id uuid,scheduled_at timestamptz,
      status text,tarotista_id uuid,tarotista_name text,brand text);
    create table office_crm_purchase_evidence(client_id uuid,at timestamptz,recorded_at timestamptz);
    create function office_actor(p_actor uuid) returns uuid language plpgsql as $$ begin
      if p_actor is distinct from '${admin}'::uuid then raise exception 'OFFICE_FORBIDDEN'; end if; return p_actor; end $$;
    create function office_crm_cohort_report(p_month date,p_as_of timestamptz) returns jsonb language sql as $$
      select jsonb_build_object('as_of',p_as_of,'captured_clients',count(distinct client_id),
        'origins',jsonb_build_array(jsonb_build_object('captured_clients',count(distinct client_id))),'totals','[]'::jsonb)
      from public.office_crm_purchase_evidence $$;
    grant select on all tables in schema public to service_role;
    insert into crm_clientes(id,origen) values('${client}','Celestial');
    insert into reservas(id,cliente_id,fecha_reserva,estado) values
      ('43333333-3333-4333-8333-333333333333','${client}',now(),'pendiente');
    insert into first_tarotist_reservations(id,completion_cliente_id,brand) values
      ('44444444-4444-4444-8444-444444444444',null,'celestial');`);
  const dir = path.join(__dirname, "../supabase/migrations");
  const migration = readdirSync(dir).find(name => name.endsWith("_office_agent_rounds.sql"));
  await db.exec(readFileSync(path.join(dir,migration),"utf8"));
  await db.exec("set role service_role");
});
after(async () => { if (db) await db.close(); });

test("una ronda entrega el cliente exacto y dos informes; un reintento conserva sus recibos", async () => {
  assert.deepEqual(await round(), { busy:false, bookings_reviewed:1, reports_delivered:2 });
  const initial = await activity();
  assert.equal(initial.handoffs.length, 7);
  const handoff = initial.handoffs.find(row => row.from === "clientes");
  assert.equal(handoff.taskId, "cliente:" + client);
  assert.equal(handoff.to, "captacion-reservas");
  assert.match(handoff.what, /pendiente de primera compra/);
  assert.deepEqual(await round(), { busy:false, bookings_reviewed:0, reports_delivered:0 });
  assert.deepEqual((await activity()).handoffs, initial.handoffs);
  await db.exec("reset role");
  await db.query("insert into office_crm_purchase_evidence values($1,now(),now())", [client]);
  await db.exec("set role service_role");
  assert.deepEqual(await round(), { busy:false, bookings_reviewed:1, reports_delivered:2 });
  assert.match((await activity()).handoffs.find(row => row.from === "clientes").what, /primera compra confirmada/);
  const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone:"Europe/Madrid", year:"numeric" }).format(new Date()));
  const counts = (await db.query("select * from office_crm_first_purchase_year($1,$2)",[admin,year])).rows;
  assert.equal(counts.reduce((n,row) => n + Number(row.captured_clients),0),1);
  assert.equal(counts[0].month,year+"-01");
  await db.exec("reset role; update reservas set deleted_at=now(); set role service_role");
  assert.ok(!(await activity()).handoffs.some(row => row.from === "clientes"));
});

test("las rondas y sus informes se protegen incluso al invocarlos fuera del API", async () => {
  await assert.rejects(() => scalar("select office_agent_activity(null) v"),/OFFICE_FORBIDDEN/);
  for (const role of ["anon","authenticated"]) {
    await db.exec("reset role; set role " + role);
    await assert.rejects(round, /permission denied/);
    await assert.rejects(activity, /permission denied/);
    await assert.rejects(() => db.query("select * from office_agent_monthly_reports"), /permission denied/);
  }
  await db.exec("reset role; set role service_role");
});
