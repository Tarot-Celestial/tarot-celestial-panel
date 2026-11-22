const {test,before,after} = require("node:test");
const assert = require("node:assert/strict");
const {readFileSync,readdirSync} = require("node:fs");
const path = require("node:path");
const {PGlite} = require("@electric-sql/pglite");
const admin = "70000000-0000-4000-8000-000000000001";
const client = "70000000-0000-4000-8000-000000000002";
const lease = "70000000-0000-4000-8000-000000000003";
let db;
const query = async (sql,args=[]) => (await db.query(sql,args)).rows;
const val = async (sql,args=[]) => Object.values((await query(sql,args))[0])[0];
const blank = {mode:"automatic",department:"",action:"",channel:"",account:"",window_start:null,window_end:null,daily_actions:null,daily_usd:null};
const set = (args,rev=0,actor=admin) => val("select office_autonomy_set($1,$2,$3)",[actor,JSON.stringify({...blank,...args}),rev]);
const policy=(action,channel,account,operation=null,reserve=false) => val("select office_autonomy_check($1,$2,$3,$4,$5)",[action,channel,account,operation,reserve]);
before(async ()=>{
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table workers(id uuid primary key,user_id uuid,is_active boolean);
    create table office_departments(id text primary key);
    create table office_events(department_id text,actor_id uuid,kind text,note text,details jsonb);
    create table office_runs(id uuid,status text,lease_token uuid,lease_until timestamptz,step int);
    create table office_run_attempts(usage jsonb,claimed_at timestamptz,step int,lease_token uuid);
    create table office_capture_attempts(request_id uuid,opportunity_id uuid,source_id text,actor_user_id uuid,body text,route text,created_at timestamptz default now());
    create table office_capture_settings(id boolean,enabled boolean,actor_user_id uuid);
    create table office_capture_opportunities(id uuid,status text,lease_token uuid,lease_until timestamptz,request_id uuid,claimed_by uuid,
      channel text,account_id text);
    create table office_instagram_posts(id uuid,lease_token uuid,lease_until timestamptz,dispatch_started_at timestamptz,status text,
      persisted_account_id text,preparation_attempts int,updated_at timestamptz,next_attempt_at timestamptz);
    create table tc_social_connections_v2(provider text,account_id text);
    create table office_tasks(id uuid);
    create function office_actor(p uuid) returns uuid language plpgsql as $$ begin if p is distinct from '${admin}'::uuid then raise exception 'OFFICE_FORBIDDEN';end if;return p;end $$;
    create function tc_has_admin_access(p uuid) returns bool language sql as $$ select p='${admin}'::uuid $$;
    create function office_capture_guard(p uuid) returns text language sql as $$ select null::text $$;
    insert into workers values ('${admin}','${admin}',true);
    insert into office_departments values ('marketing'),('captacion-reservas'),('creacion-contenido'),('seguridad-accesos');
    insert into tc_social_connections_v2 values ('instagram','connected-account');
    insert into office_capture_settings values (true,true,'${admin}');`);
  const dir=path.resolve(__dirname,"../supabase/migrations");
  await db.exec(readFileSync(path.join(dir,readdirSync(dir).find(f=>f.endsWith("_office_autonomy.sql"))),"utf8"));
});
after(async()=>{if(db)await db.close();});
test("migración conserva autorización existente y la política está cerrada a clientes de PostgREST",async()=>{
  assert.equal(await policy("instagram_publish","instagram","ig","post"),"allow");
  await assert.rejects(set({mode:"paused"},0,client),/OFFICE_FORBIDDEN/);
  assert.equal(await val("select has_function_privilege('authenticated','office_autonomy_set(uuid,jsonb,integer)','execute')"),false);
  assert.equal(await val("select has_table_privilege('anon','office_autonomy_rules','SELECT')"),false);
  await assert.rejects(policy("not_an_action","internal","","op",true),/OFFICE_INVALID/);
});
test("una pausa general y un relevo de departamento se acumulan aunque la cuenta tenga regla permisiva",async()=>{
  assert.equal(await set({mode:"paused"}),1);
  await set({channel:"instagram",account:"A"});
  assert.equal(await policy("capture_reply","instagram","A","1",true),"paused");
  assert.equal(await val("select count(*)::int from office_autonomy_usage"),0);
  await assert.rejects(set({mode:"automatic"},0),/OFFICE_CONFLICT/);
  await set({mode:"automatic"},1);
  await set({department:"captacion-reservas",mode:"human"});
  assert.equal(await policy("capture_reply","instagram","A"),"handoff");
  assert.equal(await policy("creative_copy","openai",""),"allow");
  await set({department:"captacion-reservas"},1);
});
test("tope conjunto entre dos acciones y presupuesto antes de gastar, reserva idempotente",async()=>{
  await set({channel:"openai",daily_actions:2,daily_usd:0.10});
  assert.equal(await policy("creative_brief","openai","","paid",true),"allow");
  assert.equal(await policy("creative_brief","openai","","paid",true),"allow");
  assert.equal(await policy("creative_copy","openai","","copy",true),"limit");
  assert.equal(await val("select count(*)::int from office_autonomy_usage"),1);
  await set({channel:"openai",daily_actions:2},1);
  assert.equal(await policy("creative_copy","openai","","second",true),"allow");
  assert.equal(await policy("creative_copy","openai","","third",true),"limit");
  await set({channel:"openai"},2);
  await set({channel:"whatsapp",daily_usd:0.50});
  assert.equal(await policy("capture_reply","meta_form","some-page","template",true),"limit");
  assert.equal(await policy("capture_reply","instagram","A"),"allow");
});
test("franjas Madrid incluidos cruces de medianoche y aislamiento entre cuentas",async()=>{
  const current = await val("select extract(hour from now() at time zone 'Europe/Madrid')::int");
  const hr = n => String((n+24)%24).padStart(2,"0")+":00";
  const scope = {action:"instagram_publish",channel:"instagram",account:"A"};
  await set({...scope,window_start:hr(current+1),window_end:hr(current+2)});
  assert.equal(await policy("instagram_publish","instagram","A"),"schedule");
  assert.equal(await policy("instagram_publish","instagram","B"),"allow");
  await set({...scope,window_start:hr(current-1),window_end:hr(current+1)},1);
  assert.equal(await policy("instagram_publish","instagram","A"),"allow");
  await assert.rejects(set({...scope,window_start:"08:00",window_end:"08:00"},2));
  const state=await val("select office_autonomy_snapshot($1)",[admin]);
  assert.equal(state.accounts[0].account,"connected-account");
  assert.equal(state.usage.reduce((n,row)=>n+row.operations,0),2);
});
test("una pausa entre claim y escritura detiene creativo, preparación de contenedor y respuesta al contacto",async()=>{
  await db.query("insert into office_runs values ($1,'running',$2,now()+interval '1 minute',0)",[client,lease]);
  await db.query("insert into office_instagram_posts values ($1,$2,now()+interval '1 minute',null,'preparing','B',1,now(),now())",[client,lease]);
  await db.query("insert into office_capture_opportunities values ($1,'dispatching',$2,now()+interval '1 minute',$1,$3,'instagram','B')",[client,lease,admin]);
  assert.equal(await val("select office_autonomy_dispatch($1,$2,$1)",[client,lease]),true);
  assert.equal(await val("select office_autonomy_dispatch($1,$2,$2)",[client,lease]),false);
  await set({mode:"paused"},2);
  assert.equal(await val("select office_autonomy_creative($1,$2)",[client,lease]),"paused");
  assert.equal(await val("select office_autonomy_ig_prepare($1,$2)",[client,lease]),false);
  assert.equal(await val("select status from office_instagram_posts where id=$1",[client]),"queued");
  assert.equal(await val("select office_autonomy_dispatch($1,$2,$1)",[client,lease]),false);
  assert.equal(await val("select office_autonomy_creative($1,$2)",[client,admin]),"stale");
});
test("la pausa de emergencia conserva el modo humano y las reglas más estrechas al retirarla",async()=>{
  const hold=(scope,value,revision)=>val("select office_autonomy_hold($1,$2,$3,$4)",[admin,scope,value,revision]);
  await set({mode:"human"},3);
  assert.equal(await hold("",true,4),5);
  assert.equal(await policy("creative_copy","openai",""),"paused");
  await assert.rejects(hold("",false,4),/OFFICE_CONFLICT/);
  assert.equal(await hold("",false,5),6);
  assert.equal(await policy("creative_copy","openai",""),"handoff");
  await set({mode:"automatic"},6);
  await hold("creacion-contenido",true,0);
  assert.equal(await policy("creative_copy","openai",""),"paused");
  assert.equal(await policy("creative_brief","openai",""),"allow");
  await hold("creacion-contenido",false,1);
});
test("las colas saltan cuentas en pausa, derivan a Comercial y protegen el cambio posterior al claim",async()=>{
  await db.exec(`alter table office_capture_opportunities add column latest_inbound_at timestamptz default now(),
    add column kind text default 'message', add column source_id text default 'in',
    add column last_error text,add column updated_at timestamptz;
    update office_capture_opportunities set status='pending',account_id='blocked-account';`);
  await set({action:"capture_reply",channel:"instagram",account:"blocked-account",mode:"paused"});
  const target="70000000-0000-4000-8000-000000000069";
  await db.query("insert into office_capture_opportunities(id,status,request_id,channel,account_id) values($1,'pending',$1,'instagram','B')",[target]);
  const claimed=await val("select office_capture_claim()");
  assert.equal(claimed.id,target);
  await set({action:"capture_reply",channel:"instagram",account:"B",mode:"paused"});
  assert.equal(await val("select office_capture_begin($1,$2,'respuesta','ask_country')",[target,claimed.lease_token]),null);
  assert.equal(await val("select status from office_capture_opportunities where id=$1",[target]),"pending");
  assert.equal(await val("select count(*)::int from office_capture_attempts"),0);
  await set({action:"capture_reply",channel:"instagram",account:"B",mode:"human"},1);
  assert.equal(await val("select office_capture_claim()"),null);
  assert.equal(await val("select last_error from office_capture_opportunities where id=$1",[target]),"autonomy_handoff");
});
test("la conciliación de una publicación incierta sigue siendo de solo lectura con pausa general",async()=>{
  await db.exec(`alter table office_instagram_posts add column container_id text,add column scheduled_at timestamptz default now(),
    add column approved_at timestamptz default now(),add column verification_attempts int default 0,add column last_error text;
    create table office_instagram_events(post_id uuid,status text,note text);
    create function office_ig_invalid_reason(uuid) returns text language sql as $$ select null::text $$;
    update office_instagram_posts set status='verifying',dispatch_started_at=now(),lease_token=null,lease_until=null,next_attempt_at=now();`);
  await val("select office_autonomy_hold($1,'',true,7)",[admin]);
  const claimed=await val("select office_ig_claim($1)",[client]);
  assert.equal(claimed.status,"verifying");
  assert.equal(claimed.verification_attempts,1);
  assert.equal(await val("select office_autonomy_ig_prepare($1,$2)",[client,claimed.lease_token]),false);
  assert.equal(await val("select count(*)::int from office_autonomy_usage where action='instagram_publish'"),0);
});
