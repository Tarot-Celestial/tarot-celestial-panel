const {test,before,after}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),{createHash,randomUUID}=require("node:crypto");
const {PGlite}=require("@electric-sql/pglite");
const migrations=path.join(__dirname,"../supabase/migrations");
const read=name=>fs.readFileSync(path.join(migrations,fs.readdirSync(migrations).find(f=>f.endsWith(name))),"utf8");
const hash=s=>createHash("sha256").update(s).digest("hex");
const actor=randomUUID(), customer=randomUUID(), user=randomUUID(), stranger=randomUUID(), strangerUser=randomUUID();
const opp=randomUUID(),other=randomUUID(),comment=randomUUID(),token=hash("fixture private URL"),code="TC-7AE0BA12BC00";let db;
const query=async(q,args)=>(await db.query(q,args)).rows;
const val=async(q,args)=>Object.values((await query(q,args))[0])[0];
async function inbound(id,source,body,peer="sender",privateVerified=true,offset=0) {
  await query(`insert into office_capture_inbound(opportunity_id,channel,account_id,kind,thread_key,source_id,source_at,inbound_text,verified,recipient_id)
    select id,channel,account_id,kind,thread_key,$2,clock_timestamp()+make_interval(secs=>$6),$3,$4,$5 from office_capture_opportunities where id=$1`,[id,source,body,privateVerified,peer,offset]);
}
before(async()=>{
  db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    create table crm_clientes(id uuid primary key,auth_user_id uuid,nombre text,origen text);
    create table captacion_leads(id uuid primary key,cliente_id uuid,origen text);
    create table meta_lead_events(leadgen_id text,status text,captacion_lead_id uuid,cliente_id uuid,meta_created_at timestamptz,
      received_at timestamptz,inserted_at timestamptz,page_id text,form_id text);
    create table crm_fixture_receipts(client_id uuid,id uuid,at timestamptz,source text,status text,amount numeric);
    create function office_crm_receipts(timestamptz) returns setof crm_fixture_receipts language sql as $$select * from public.crm_fixture_receipts where at<=$1 and amount>0 and status in ('completed','refunded')$$;
    create function office_actor(u uuid) returns uuid language plpgsql as $$begin if u<>'${actor}' or u is null then raise exception 'forbidden';end if;return u;end$$;
    create table tc_instagram_threads(id uuid primary key,kind text,account_id text,recipient_id text,remote_id text,name text,remote_created_at timestamptz,
      remote_updated_at timestamptz,last_reply_at timestamptz,private_reply_sent boolean default false,merged_into uuid);
    create table tc_facebook_threads(like tc_instagram_threads,is_deleted boolean default false);
    create table workers(id uuid primary key,user_id uuid,is_active boolean);
  `);
  await db.exec(read("_office_capture_opportunities.sql"));
  await db.exec(read("_office_meta_verified_attribution.sql"));
  await query("insert into crm_clientes(id,auth_user_id) values($1,$2),($3,$4)",[customer,user,stranger,strangerUser]);
  for(const [id,kind,key] of [[opp,"message","thread-a"],[other,"message","thread-b"],[comment,"comment","public"]]) {
    await query("insert into office_capture_opportunities(id,channel,account_id,kind,thread_key,recipient_id,source_id,latest_inbound_at,window_until,source_at,name) values($1,'instagram','account',$2,$3,'sender',$3,now(),now(),'2024-04-11T10:00:00Z',$4)",[id,kind,key,id===opp?"Contacto QA":"test@example.test"]);
    await query("insert into office_capture_inbound(opportunity_id,channel,account_id,kind,thread_key,source_id,source_at,inbound_text,verified,recipient_id) select id,channel,account_id,kind,thread_key,source_id,source_at,'Hola',true,recipient_id from office_capture_opportunities where id=$1",[id]);
  }
  await db.exec("set role service_role");
});
after(async()=>{await db?.close();});
test("solo un mensaje privado verificado permite emitir enlace. Las vistas previas no generan visitas",async()=>{
  assert.equal(await val("select office_meta_panel_issue($1,$2,'panel')",[comment,hash("público")]),false);
  assert.equal(await val("select office_meta_panel_issue($1,$2,'oracle')",[opp,token]),true);
  assert.equal(await val("select opened_at from office_meta_panel_links where digest=$1",[token]),null);
  assert.equal(await val("select office_meta_panel_challenge($1,$2,$3,$4)",[token,hash(code),customer,user]),"unavailable");
  assert.equal(await val("select office_meta_panel_visit($1)",[token]),"oracle");
  assert.equal(await val("select office_meta_panel_challenge($1,$2,$3,$4)",[token,hash(code),customer,strangerUser]),"unavailable");
  assert.equal(await val("select office_meta_panel_challenge($1,$2,$3,$4)",[token,hash(code),customer,user]),"pending");
});
test("un enlace reenviado, otro chat, otro remitente, código anterior, comentario o texto no autenticado no atribuyen ventas",async()=>{
  const forwarded="TC-777777777777";
  assert.equal(await val("select office_meta_panel_challenge($1,$2,$3,$4)",[token,hash(forwarded),stranger,strangerUser]),"pending");
  await inbound(other,"wrong-chat",forwarded);await inbound(opp,"wrong-peer",forwarded,"elsewhere");
  await inbound(comment,"public-code",forwarded); await inbound(opp,"before-code",forwarded,"sender",true,-90);
  await inbound(opp,"unverified",forwarded,"sender",false);await inbound(opp,"free-text","dijo "+forwarded);
  assert.equal(await val("select count(*)::int from office_meta_verified_clients"),0);
  await inbound(opp,"right",code);
  assert.equal(await val("select client_id from office_capture_opportunities where id=$1",[opp]),customer);
  assert.equal(await val("select office_meta_panel_confirm($1,'right',$2)",[opp,code]),true);
  assert.equal(await val("select office_meta_panel_confirm($1,'not-the-real-id',$2)",[opp,code]),false);
  await inbound(opp,"second",forwarded);
  assert.equal(await val("select count(*)::int from office_meta_verified_clients"),1);
  assert.equal(await val("select office_meta_panel_challenge($1,$2,$3,$4)",[token,hash(forwarded),stranger,strangerUser]),"unavailable");
});
test("informe restringido reúne primera compra real de Oráculo por cliente y respeta la primera pagada aunque se reembolse",async()=>{
  await assert.rejects(val("select office_meta_attribution_report($1,'2024-04-01',now())",[randomUUID()]),/forbidden/);
  async function report(){return val("select office_meta_attribution_report($1,'2024-04-01',now())",[actor]);}
  await query("insert into crm_fixture_receipts values ($1,$2,'2024-04-15','stripe_oracle_questions','completed',0),($1,$3,'2024-04-16','stripe_oracle_credits','pending',12)",[customer,randomUUID(),randomUUID()]);
  assert.equal((await report()).totals.first_purchases,0);
  await query("insert into crm_fixture_receipts values($1,$2,'2024-04-18','stripe_oracle_credits','completed',9)",[customer,randomUUID()]);
  let r=await report();assert.equal(r.totals.first_purchases,1);assert.equal(r.totals.linked_clients,1);
  assert.equal(r.items.find(i=>i.id===opp).display_name,"Contacto QA");assert.equal(r.items.find(i=>i.id===comment).display_name,null);
  assert.equal(r.purchases[0].source,"stripe_oracle_credits");
  await query("insert into crm_fixture_receipts values($1,$2,'2024-04-10','crm_cliente_pagos','refunded',10)",[customer,randomUUID()]);
  r=await report();assert.equal(r.totals.first_purchases,0);assert.equal(r.totals.prior_clients,1);
  assert.equal(r.items.find(i=>i.id===opp).first_purchase_status,"refunded");
});
test("RLS y grants no exponen códigos, contactos ni atribuciones a roles del navegador",async()=>{
  for(const t of ["office_meta_panel_links","office_meta_panel_proofs","office_meta_verified_clients"]) {
    assert.equal(await val("select relrowsecurity from pg_class where oid=$1::regclass",[t]),true);
    for(const role of ["anon","authenticated"]) assert.equal(await val("select has_table_privilege($1,$2,'select,insert,update,delete,truncate,trigger')",[role,t]),false);
    assert.equal(await val("select has_table_privilege('service_role',$1,'delete,truncate,trigger')",[t]),false);
  }
  assert.equal(await val("select has_function_privilege('authenticated','office_meta_panel_confirm(uuid,text,text)','execute')"),false);
});

test("formularios procesados con ambas FK se ven sin cron. Primera oportunidad por ficha entre canales y meses",async()=>{
  const only=randomUUID(),aprLead=randomUUID(),marLead=randomUUID(),wrongLead=randomUUID();
  await query("insert into crm_clientes values($1,null,'Micaela QA',null)",[only]);
  for (const [id,c] of [[aprLead,only],[marLead,customer],[wrongLead,stranger]]) await query("insert into captacion_leads values($1,$2,'meta')",[id,c]);
  async function form(remote,lead,c,at){
    await query("insert into meta_lead_events values($1,'processed',$2,$3,$4,$4,$4,'page','form')",[remote,lead,c,at]);
  }
  await form("100",aprLead,only,"2024-04-05T19:00Z");await form("101",aprLead,only,"2024-04-06T19:00Z");
  await form("102",marLead,customer,"2024-03-28T22:10Z");
  await form("conflict",wrongLead,only,"2024-04-02T19:00Z");
  await query("insert into crm_fixture_receipts values($1,$2,'2024-04-10','stripe_oracle_questions','completed',5)",[only,randomUUID()]);
  const report=async(month,status=null,q=null)=>val("select office_meta_attribution_report($1,$2,now(),null,null,$3,$4)",[actor,month,status,q]);
  const april=await report("2024-04-01");
  assert.equal(april.totals.first_purchases,1);assert.equal(april.totals.linked_elsewhere,1);
  assert.equal(april.items.find(i=>i.id===opp).conversion,"linked_elsewhere");
  const actual=april.items.filter(i=>i.channel==="meta_form");
  assert.equal(actual.length,1);assert.equal(actual[0].display_name,"Micaela QA");
  assert.equal(actual[0].first_purchase_source,"stripe_oracle_questions");assert.equal(actual[0].status,"recorded");
  const march=await report("2024-03-01");assert.equal(march.totals.first_purchases,1);assert.equal(march.items[0].lead_id,marLead);
  const filtered=await report("2024-04-01","recorded","MICAELA");assert.deepEqual(filtered.totals,april.totals);assert.equal(filtered.items.length,1);
  assert.equal((await report("2024-04-01",null,"%")).items.length,0);
  const materialized=randomUUID();
  await query("insert into office_capture_opportunities(id,channel,account_id,kind,thread_key,lead_id,client_id,source_at,status,source_id,latest_inbound_at,window_until) values($1,'meta_form','page','form',$2,$3,$4,'2024-04-05T19:00Z','handoff','100',now(),now())",
    [materialized,"lead:"+aprLead,aprLead,only]);
  const after=await report("2024-04-01");assert.deepEqual(after.totals,april.totals);
  assert.equal(after.items.find(x=>x.lead_id===aprLead).id,actual[0].id);
  assert.equal(after.items.find(x=>x.lead_id===aprLead).status,"handoff");
});
