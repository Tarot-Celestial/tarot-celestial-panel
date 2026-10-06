const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const client='10000000-0000-4000-8000-000000000001';
const other='10000000-0000-4000-8000-000000000002';
const campaign='20000000-0000-4000-8000-000000000001';
let db;
const migration=fs.readFileSync(path.join(__dirname,'../migrations/20261006_01_diamond_roulette_rewards.sql'),'utf8');
const scalar=async(sql,args=[]) => (await db.query(sql,args)).rows[0].value;
const rpc=async(name,args=[])=>scalar(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`,args);
const newSpin=async(id=client,level=5,source='test')=>scalar("insert into cliente_ruleta_giros(cliente_id,nivel,estado,source) values($1,$2,'pending',$3) returning id as value",[id,level,source]);
const spin=async(id)=>rpc('tc_diamond_roulette_spin_v1',[client,id]);
const free=async()=>Number(await scalar('select minutos_free_pendientes as value from crm_clientes where id=$1',[client]));
async function forcePrize(code){
 await db.query("update tc_client_roulette_rewards set weight=case when metadata->>'prize_code'=$1 then 100 else 0 end where campaign_id=$2 and nivel=5",[code,campaign]);
}
async function resetWeights(){
 const preset=JSON.parse(migration.match(/preset jsonb := '([\s\S]*?)'::jsonb/)[1]);
 for(const row of preset)await db.query("update tc_client_roulette_rewards set weight=$1 where metadata->>'prize_code'=$2 and campaign_id=$3",[row.weight,row.code,campaign]);
}
before(async()=>{
 db=new PGlite();
 await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/diamond-roulette-base.sql'),'utf8'));
 await db.query('insert into crm_clientes(id,minutos_free_pendientes,minutos_normales_pendientes) values($1,5,20),($2,0,0)',[client,other]);
 await db.query('insert into tc_client_roulette_campaigns(id) values($1)',[campaign]);
 await db.exec(migration);
 await rpc('tc_seed_diamond_roulette',[campaign,actor]);
});
after(async()=>{await db?.close()});

test('Diamante installs exactly the requested 16 probabilities and is repeatable without touching other levels',async()=>{
 const expected=[21.3,17,15,12,9,7.5,5.5,4.5,2.8,2.2,1.2,.8,.5,.35,.25,.1];
 const rows=(await db.query('select weight from tc_client_roulette_rewards where nivel=5 order by sort_order')).rows;
 assert.deepEqual(rows.map(x=>Number(x.weight)),expected);
 assert.equal(expected.reduce((a,b)=>a+Math.round(b*100),0),10000);
 const old=await scalar("insert into tc_client_roulette_rewards(campaign_id,nivel,name,is_active,weight) values($1,4,'Especial existente',true,100) returning id as value",[campaign]);
 const again=await rpc('tc_seed_diamond_roulette',[campaign,actor]);
 assert.equal(again.already_installed,true);
 assert.equal(await scalar('select is_active as value from tc_client_roulette_rewards where id=$1',[old]),true);
 assert.equal(await scalar('select count(*)::int as value from tc_client_roulette_rewards where nivel=5'),16);
});

test('All eight minute prizes credit the real FREE field once, preserve purchased minutes and replay their receipt',async()=>{
 for(const value of [7,9,10,15,30,50,70,100]){
  await forcePrize('minutes-'+value);
  const id=await newSpin(),balance=await free();
  const result=await spin(id);
  assert.equal(result.reward_type,'minutes');assert.equal(result.reward_value,value);
  assert.equal(result.balance_before,balance+20);assert.equal(result.balance_after,balance+20+value);
  assert.equal(await free(),balance+value);
  const replay=await spin(id);assert.equal(replay.duplicate,true);assert.equal(replay.reward_id,result.reward_id);
  assert.equal(await free(),balance+value);
  assert.equal(Number(await scalar('select minutos_normales_pendientes as value from crm_clientes where id=$1',[client])),20);
 }
});

test('Level 1, Level 2 and Special prizes mint one usable spin at the correct level, including after rank loss',async()=>{
 for(const [code,level] of [['spin-1',1],['spin-2',2],['spin-special',4]]){
  await forcePrize(code);
  const id=await newSpin();
  await db.query("update crm_clientes set rank='bronce' where id=$1",[client]);
  const result=await spin(id);
  assert.equal(result.reward_type,'roulette_spins');assert.equal(result.reward_meta.roulette_level,level);
  await spin(id);
  const rows=(await db.query("select * from cliente_ruleta_giros where payment_key=$1",['diamond-spin:'+id+':gift:1'])).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].nivel,level);assert.equal(rows[0].estado,'pending');assert.equal(rows[0].required_rank,null);
 }
 await db.query("update crm_clientes set rank='diamante' where id=$1",[client]);
});

test('Two oracle credits invoke the shared ledger exactly once with a stable delivery key',async()=>{
 await forcePrize('oracle-2');const id=await newSpin();
 assert.equal((await spin(id)).reward_type,'oracle_credits');await spin(id);
 assert.equal(await scalar('select sum(amount)::int as value from fixture_oracle_ledger where delivery_key=$1',['diamond-spin:'+id+':oracle']),2);
});

test('Each manual prize persists an identifiable pending benefit and cannot be claimed as minutes',async()=>{
 for(const code of ['runa','tarotista-a','mystery']){
  await forcePrize(code);const id=await newSpin(),balance=await free();const result=await spin(id);
  assert.equal(result.fulfillment_mode,'manual');assert.ok(result.entitlement_id);
  assert.equal(await free(),balance);
  const benefit=(await db.query('select * from tc_diamond_roulette_benefits where id=$1',[result.entitlement_id])).rows[0];
  assert.equal(benefit.status,'pending');assert.equal(benefit.expires_at,null);
  await assert.rejects(rpc('tc_diamond_roulette_claim_v1',[client,benefit.id]),/INVALID_BENEFIT/);
  const notice=await scalar("select mensaje as value from cliente_notificaciones where meta->>'spin_id'=$1",[id]);
  assert.match(notice,/captura de pantalla/);assert.match(notice,/llámanos/);
  await assert.rejects(rpc('tc_complete_diamond_benefit_v1',[benefit.id,other]),/FORBIDDEN/);
  assert.equal((await rpc('tc_complete_diamond_benefit_v1',[benefit.id,actor])).completed,true);
  assert.equal((await rpc('tc_complete_diamond_benefit_v1',[benefit.id,actor])).duplicate,true);
 }
});

test('Seven-day prize requires an explicit daily claim, prevents duplicates and returns server-day readiness',async()=>{
 await forcePrize('daily-7');const beforeBalance=await free();const result=await spin(await newSpin());
 assert.equal(await free(),beforeBalance);
 const id=result.entitlement_id;
 const list=await rpc('tc_diamond_roulette_benefits_v1',[client]);const benefit=list.find(x=>x.id===id);
 assert.equal(benefit.can_claim,true);assert.equal(benefit.total_claims,7);assert.equal(benefit.daily_minutes,10);
 const claim=await rpc('tc_diamond_roulette_claim_v1',[client,id]);assert.equal(claim.minutes,10);assert.equal(claim.duplicate,false);
 const duplicate=await rpc('tc_diamond_roulette_claim_v1',[client,id]);assert.equal(duplicate.duplicate,true);assert.equal(await free(),beforeBalance+10);
 const updated=(await rpc('tc_diamond_roulette_benefits_v1',[client])).find(x=>x.id===id);
 assert.equal(updated.claimed_today,true);assert.equal(updated.can_claim,false);assert.equal(updated.claims_used,1);
 assert.equal(await scalar("select ((next_day at time zone 'Europe/Madrid')::time='00:00:00'::time) as value from (select $1::timestamptz next_day) q",[updated.next_claim_at]),true);
 await assert.rejects(rpc('tc_diamond_roulette_claim_v1',[other,id]),/INVALID_BENEFIT/);
 await assert.rejects(rpc('tc_complete_diamond_benefit_v1',[id,actor]),/INVALID_BENEFIT/);
});

test('Expired, completed and future daily prizes cannot create a claim or credit a balance',async()=>{
 await forcePrize('daily-7');const result=await spin(await newSpin());const id=result.entitlement_id,balance=await free();
 await db.query("update tc_diamond_roulette_benefits set expires_at=now()-interval '1 second' where id=$1",[id]);
 await assert.rejects(rpc('tc_diamond_roulette_claim_v1',[client,id]),/BENEFIT_EXPIRED/);
 assert.equal((await rpc('tc_diamond_roulette_benefits_v1',[client])).find(x=>x.id===id).status,'expired');
 await db.query("update tc_diamond_roulette_benefits set expires_at=now()+interval '7 days',status='completed' where id=$1",[id]);
 await assert.rejects(rpc('tc_diamond_roulette_claim_v1',[client,id]),/BENEFIT_COMPLETED/);
 await db.query("update tc_diamond_roulette_benefits set status='active',starts_on=(now() at time zone 'Europe/Madrid')::date+1 where id=$1",[id]);
 await assert.rejects(rpc('tc_diamond_roulette_claim_v1',[client,id]),/BENEFIT_NOT_READY/);
 assert.equal(await free(),balance);
});

test('Ownership, level, required rank, paused campaign and invalid probability distribution preserve spins',async()=>{
 await resetWeights();const id=await newSpin();
 await assert.rejects(rpc('tc_diamond_roulette_spin_v1',[other,id]),/INVALID_SPIN/);
 await assert.rejects(spin(await newSpin(client,1)),/INVALID_SPIN/);
 await db.query("update cliente_ruleta_giros set required_rank='oro' where id=$1",[id]);
 await assert.rejects(spin(id),/RANK_BENEFIT_FORBIDDEN/);
 await db.query('update cliente_ruleta_giros set required_rank=null where id=$1',[id]);
 await db.query('update tc_client_roulette_campaigns set diamond_enabled=false where id=$1',[campaign]);
 await assert.rejects(spin(id),/DIAMOND_ROULETTE_PAUSED/);
 await db.query('update tc_client_roulette_campaigns set diamond_enabled=true where id=$1',[campaign]);
 await db.query("update tc_client_roulette_rewards set weight=0 where metadata->>'prize_code'='mystery'");
 await assert.rejects(spin(id),/DIAMOND_INVALID_CATALOGUE/);
 assert.equal(await scalar('select estado as value from cliente_ruleta_giros where id=$1',[id]),'pending');
 await resetWeights();
});

test('A downstream delivery failure rolls back the award, balance, spin, receipt and benefit together',async()=>{
 await forcePrize('minutes-100');const id=await newSpin(),balance=await free();
 await db.exec("create function fixture_reject_notice() returns trigger language plpgsql as $$ begin raise exception 'SIMULATED_NOTIFICATION_FAILURE'; end $$; create trigger fixture_notice_failure before insert on cliente_notificaciones for each row execute function fixture_reject_notice();");
 await assert.rejects(spin(id),/SIMULATED_NOTIFICATION_FAILURE/);
 assert.equal(await free(),balance);assert.equal(await scalar('select estado as value from cliente_ruleta_giros where id=$1',[id]),'pending');
 assert.equal(await scalar('select count(*)::int as value from tc_diamond_roulette_results where spin_id=$1',[id]),0);
 await db.exec('drop trigger fixture_notice_failure on cliente_notificaciones');
 assert.equal((await spin(id)).reward_value,100);assert.equal(await free(),balance+100);
});

test('Probability edits validate all IDs and exact 100% atomically and require administrator identity',async()=>{
 await resetWeights();const rows=(await db.query('select id,weight as probability from tc_client_roulette_rewards where nivel=5 order by sort_order')).rows.map(r=>({...r,probability:Number(r.probability)}));
 await assert.rejects(rpc('tc_save_roulette_probabilities_v1',[campaign,5,JSON.stringify(rows),other]),/FORBIDDEN/);
 await assert.rejects(rpc('tc_save_roulette_probabilities_v1',[campaign,5,JSON.stringify(rows.slice(1)),actor]),/PROBABILIDADES_INVALIDAS/);
 const invalid=rows.map(x=>({...x}));invalid[0].probability+=1;
 await assert.rejects(rpc('tc_save_roulette_probabilities_v1',[campaign,5,JSON.stringify(invalid),actor]),/PROBABILIDADES_INVALIDAS/);
 assert.equal((await rpc('tc_save_roulette_probabilities_v1',[campaign,5,JSON.stringify(rows),actor])).saved,true);
});

test('Normalization distinguishes legacy Diamond grants from Special and canonical state reports both',async()=>{
 const diamond=await newSpin(client,4,'diamond_rank_purchase'),special=await newSpin(client,4,'diamond_reward');
 assert.equal(await scalar('select nivel as value from cliente_ruleta_giros where id=$1',[diamond]),5);
 assert.equal(await scalar('select nivel as value from cliente_ruleta_giros where id=$1',[special]),4);
 const state=await rpc('tc_client_state_snapshot_diamond_v1',[client]);assert.equal(state.preserved_field,true);
 assert.equal(state.spins.diamond,await scalar("select count(*)::int as value from cliente_ruleta_giros where cliente_id=$1 and nivel=5 and estado='pending'",[client]));
 const summary=await rpc('tc_diamond_roulette_summary_v1',[client]);assert.equal(summary.catalogue.length,16);assert.equal(summary.diamond_access,true);
});

test('Browser roles cannot read receipts or execute any awarding or claim RPC; migrations can be reapplied',async()=>{
 for(const role of ['anon','authenticated']){
  for(const fn of ['tc_diamond_roulette_spin_v1(uuid,uuid)','tc_diamond_roulette_claim_v1(uuid,uuid)','tc_seed_diamond_roulette(uuid,uuid)','tc_complete_diamond_benefit_v1(uuid,uuid)']){
   assert.equal(await scalar('select has_function_privilege($1,$2,\'EXECUTE\') as value',[role,fn]),false);
  }
  assert.equal(await scalar("select has_table_privilege($1,'tc_diamond_roulette_results','SELECT') as value",[role]),false);
 }
 const n=await scalar('select count(*)::int as value from tc_diamond_roulette_results');
 await db.exec(migration);
 assert.equal(await scalar('select count(*)::int as value from tc_diamond_roulette_results'),n);
 assert.equal((await rpc('tc_seed_diamond_roulette',[campaign,actor])).already_installed,true);
});

test('Legacy award paths cannot consume a Diamond spin without its atomic delivery receipt',async()=>{
 const id=await newSpin();
 await assert.rejects(db.query("update cliente_ruleta_giros set estado='used' where id=$1",[id]),/DIAMOND_ENGINE_REQUIRED/);
 assert.equal(await scalar('select estado as value from cliente_ruleta_giros where id=$1',[id]),'pending');
});

test('Daily prize delivers exactly 70 minutes over seven business days and the last-day retry is idempotent',async()=>{
 await forcePrize('daily-7');const prize=await spin(await newSpin()),id=prize.entitlement_id,balance=await free();
 for(let day=0;day<7;day++){
  if(day){
   // Advance the fixture's existing claim dates, preserving production server-time checks.
   await db.query('update tc_diamond_roulette_claims set claim_day=claim_day-1 where benefit_id=$1',[id]);
   await db.query('update tc_diamond_roulette_benefits set starts_on=starts_on-1 where id=$1',[id]);
  }
  assert.equal((await rpc('tc_diamond_roulette_claim_v1',[client,id])).duplicate,false);
 }
 assert.equal(await free(),balance+70);
 const last=await rpc('tc_diamond_roulette_claim_v1',[client,id]);assert.equal(last.duplicate,true);assert.equal(await free(),balance+70);
 const benefit=(await rpc('tc_diamond_roulette_benefits_v1',[client])).find(x=>x.id===id);
 assert.equal(benefit.status,'completed');assert.equal(benefit.claims_used,7);assert.equal(benefit.can_claim,false);
});

test('Claim boundaries follow Madrid midnight across both DST transitions, not rolling 24-hour periods',async()=>{
 for(const [start,hours] of [['2026-03-29',23],['2026-10-25',25]]){
  const elapsed=await scalar("select extract(epoch from ((($1::date+1)::timestamp at time zone 'Europe/Madrid')-($1::date::timestamp at time zone 'Europe/Madrid')))/3600 as value",[start]);
  assert.equal(Number(elapsed),hours);
 }
});
