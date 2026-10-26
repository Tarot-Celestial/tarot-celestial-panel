const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname,'..');
function load(file,mocks={},globals={}) {
  const text = fs.readFileSync(path.join(root,file),'utf8');
  const code = ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const exports={}; vm.runInNewContext(code,{exports,require:name => Object.hasOwn(mocks,name)?mocks[name]:require(name),console,Request,Response,URL,Date,Error,...globals},{filename:file});return exports;
}
const rules = load('src/lib/tarotista-percentage-ranks.ts');
const activity = load('src/lib/activity-codes.ts');
const metrics = load('src/lib/server/rendimiento-metrics.ts',{
  '@/lib/activity-codes':activity,
  '@/lib/server/auth-worker':{normalizeText:x=>String(x||'').trim().toLowerCase(),isSpecialCallName:x=>String(x||'').toLowerCase()==='call400',roundMoney:n=>Math.round(n*100)/100,rateForCode:()=>0,getAdminClient:()=>{throw Error('must use provided admin');}},
});
const ranks=load('src/lib/server/tarotista-ranks.ts');
const dates=load('src/lib/server/madrid-reporting-period.ts');
const evalRank=(c,r,t=1000)=>rules.evaluatePercentageRanks({minutes_total:t,minutes_cliente:c,minutes_repite:r},rules.proposedPercentageRules());
const json=x=>JSON.parse(JSON.stringify(x));
test('same proportions yield identical ranks regardless of call volume',()=>{
 assert.equal(evalRank(300,200).candidate,'A'); assert.equal(evalRank(900,600,3000).candidate,'A');
 assert.deepEqual(json(evalRank(300,200).eligible),json(evalRank(900,600,3000).eligible));
});
test('both targets must be met; high Cliente never substitutes Repite',()=>{
 for(const [c,r,rank] of [[199,100,'C'],[200,100,'B'],[300,150,'A'],[400,200,'S'],[420,120,'B'],[100,800,'C']]) assert.equal(evalRank(c,r).candidate,rank);
});
test('no attended minutes is not zero performance and never promotes',()=>{
 const e=evalRank(0,0,0);assert.equal(e.evaluable,false);assert.equal(e.candidate,null);assert.equal(e.cliente_pct,null);assert.equal(e.next,null);assert.equal(e.goals.length,0);
});
test('sample with tiny volume remains review-only; calculator never confirms rank',()=>{
 const e=evalRank(4,2,10);assert.equal(e.candidate,'S');assert.equal(e.review_required,true);assert.equal('confirmed' in e,false);
});
test('raw fractions, not rounded display, govern eligibility',()=>{
 assert.equal(evalRank(299.999,150).candidate,'B');assert.equal(evalRank(300,149.999).candidate,'B');
 assert.equal(rules.percentLabel(29.9999),'29,99 %');assert.equal(evalRank(300,150).candidate,'A');
});
test('progress uses two objectives, percentage-point shortfalls and bounded bars',()=>{
 const e=evalRank(320,130);assert.equal(e.next,'A');assert.equal(e.goals.filter(g=>g.met).length,1);
 assert.equal(e.goals[1].remaining_points,2);assert.equal(e.goals[0].bar,100);assert.equal(e.goals[1].bar,13/15*100);
 assert.equal(rules.pointsLabel(2),'2 puntos porcentuales');
});
test('invalid minutes fail instead of fabricating a rank',()=>{
 for(const m of [{minutes_total:-1,minutes_cliente:0,minutes_repite:0},{minutes_total:100,minutes_cliente:60,minutes_repite:50},{minutes_total:100,minutes_cliente:NaN,minutes_repite:0},{minutes_total:Infinity,minutes_cliente:0,minutes_repite:0}]) assert.throws(()=>rules.evaluatePercentageRanks(m,rules.proposedPercentageRules()));
});
test('rank config requires four unique, monotonic and jointly achievable steps',()=>{
 const p=()=>rules.proposedPercentageRules();
 for(const mutate of [r=>r.pop(),r=>{r[1].code='C'},r=>{r[3].cliente_pct=90;r[3].repite_pct=20},r=>{r[2].cliente_pct=19},r=>{r[3].cliente_pct=30;r[3].repite_pct=15},r=>{r[1].cliente_pct=0},r=>{r[0].repite_pct=1},r=>{r[1].repite_pct='10'},r=>{r[2].health_bonus=-1},r=>{r[2].cliente_pct=30.005}]) {const r=p();mutate(r);assert.throws(()=>rules.validatePercentageRules(r));}
});
test('hidden minute and capture gates are rejected and converter clears all old gates',()=>{
 const r=rules.proposedPercentageRules();r[1].min_minutes_cliente=1500;assert.throws(()=>rules.validatePercentageRules(r));
 const q=rules.percentageRequirements(rules.proposedPercentageRules()[1]);
 for(const k of ['min_minutes_total','min_minutes_cliente','min_minutes_repite','min_captadas']) assert.equal(q[k],null);
 assert.equal(q.min_cliente_pct,20);assert.equal(q.min_repite_pct,10);
});
test('benefits use numerical deltas only, not tariff totals or stacked rank rewards',()=>{
 const p=rules.proposedPercentageRules();assert.equal(rules.percentageBenefitAmount(p[2],{minutes_total:1000,minutes_cliente:320,minutes_repite:180}),26.8);
 assert.equal(rules.percentageBenefitAmount(p[3],{minutes_total:1000,minutes_cliente:400,minutes_repite:200}),56);
 assert.equal(p[2].repite_rate_bonus,.01);assert.equal(p[3].cliente_rate_bonus,.01);
 assert.match(rules.structuredBenefitWarnings([{code:'A',benefit_config:{extras:['Bono de salud: 15 €'],health_bonus:0}}])[0],/texto no se suma/);
});
test('month validation rejects malformed values and preserves Madrid DST boundaries',()=>{
 for(const v of ['2026-00','2026-13','2026-1','2026-10-01',null])assert.throws(()=>rules.validateSimulationMonth(v));
 assert.equal(dates.fullMonthComparison('2026-10').currentStartIso,'2026-09-30T22:00:00.000Z');
 assert.equal(dates.fullMonthComparison('2026-10').currentEndExclusiveIso,'2026-10-31T23:00:00.000Z');
});
function activeRows(){return rules.proposedPercentageRules().map((r,i)=>({code:r.code,name:r.code,subtitle:r.code,requirements:rules.percentageRequirements(r),sort_order:i+1,benefit_config:{health_bonus:r.health_bonus,rank_bonus:r.rank_bonus,cliente_rate_bonus:r.cliente_rate_bonus,repite_rate_bonus:r.repite_rate_bonus,extras:[]}}));}
const worker=(id='a')=>({id,display_name:`Tarotista ${id}`,role:'tarotista',is_active:true});
const call=(id='1',wid='a',c=32,r=13)=>({id,tarotista_worker_id:wid,fecha_hora:'2026-08-10T12:00:00Z',code_blocks:[{code:'CLIENTE',minutes:c},{code:'REPITE',minutes:r},{code:'FREE',minutes:100-c-r}],captado:false});
function harness(options={}){
 const writes=[],reads=[],filters=[];
 const db={from(table){
  const q={select:()=>q,eq:(...x)=>{filters.push([table,'eq',...x]);return q},or:()=>q,gte:(...x)=>{filters.push([table,'gte',...x]);return q},lt:(...x)=>{filters.push([table,'lt',...x]);return q},order:()=>q,
    update:()=>{writes.push(table);throw Error('write forbidden')},insert:()=>{writes.push(table);throw Error('write forbidden')},upsert:()=>{writes.push(table);throw Error('write forbidden')},delete:()=>{writes.push(table);throw Error('write forbidden')},
    range:async(a,b)=>{reads.push([table,a,b]);if(options.pageError===a && table==='rendimiento_llamadas')return {data:null,error:{message:'failure'}}; const data=table==='workers'?(options.workers||[worker(),worker('b')]):(options.rows||[call()]);return {data:data.slice(a,b+1),error:null};},
    then:(res,rej)=>Promise.resolve({data:options.config||activeRows(),error:options.configError?{message:'bad config'}:null}).then(res,rej)};return q;
 }};
 const route=load('src/app/api/admin/tarotista-ranks/simulate/route.ts',{
  'next/server':{NextResponse:{json:(body,opt)=>Response.json(body,opt)}},
  '@/lib/admin/require-admin':{requireAdmin:async()=>options.gate||{ok:true,admin:db}},
  '@/lib/server/rendimiento-metrics':metrics,
  '@/lib/server/brand-filter':{brandFromRequest:()=> 'test',filterRowsByBrand:async(_,rows)=>rows.filter(r=>r.keep!==false)},
  '@/lib/server/madrid-reporting-period':{...dates,madridTodayKey:()=> '2026-10-16'},
  '@/lib/server/tarotista-ranks':ranks,
  '@/lib/tarotista-percentage-ranks':rules,
 });
 return {writes,reads,filters,post:(body={month:'2026-08',rules:rules.proposedPercentageRules()})=>route.POST(new Request('http://localhost/api/admin/tarotista-ranks/simulate',{method:'POST',body:typeof body==='string'?body:JSON.stringify(body)}))};
}
test('simulation denies anonymous and non-admin callers before reading any data',async()=>{
 for(const [error,status] of [['NO_AUTH',401],['FORBIDDEN',403]]){const h=harness({gate:{ok:false,error}});assert.equal((await h.post()).status,status);assert.equal(h.reads.length,0);assert.equal(h.writes.length,0);}
});
test('simulation endpoint is read-only, no-store, numerical and explicitly provisional',async()=>{
 const h=harness();const res=await h.post();assert.equal(res.status,200);assert.match(res.headers.get('cache-control'),/no-store/);
 const b=await res.json();assert.equal(b.simulation_only,true);assert.equal(b.results[0].candidate,'B');assert.equal(b.results[1].candidate,null);assert.equal(b.results[0].status,'pending_review');assert.equal(b.totals.evaluable,1);assert.equal(h.writes.length,0);
 assert.equal(b.time_zone,'Europe/Madrid');assert.match(b.financial_scope,/No es una factura/);
});
test('simulator reads more than 1000 calls and aggregates minutes rather than daily percentages',async()=>{
 const rows=Array.from({length:1250},(_,i)=>call(String(i),'a',32,18));const h=harness({rows});const b=await (await h.post()).json();assert.equal(b.results[0].calls_total,1250);assert.equal(b.results[0].minutes_total,125000);assert.equal(b.results[0].candidate,'A');assert.ok(h.reads.some(r=>r[0]==='rendimiento_llamadas'&&r[1]===1000));assert.equal(h.writes.length,0);
});
test('brand-excluded or unmatched workers are not silently attributed',async()=>{
 const h=harness({rows:[call('1'),{...call('2'),keep:false},call('3','missing')]});const b=await (await h.post()).json();assert.equal(b.results[0].calls_total,1);assert.ok(b.warnings.some(x=>x.startsWith('1 registros')));
});
test('missing config and any failing page abort rather than returning partial or fallback success',async()=>{
 for(const options of [{config:[]},{configError:true},{rows:Array.from({length:1001},(_,i)=>call(String(i))),pageError:1000}]){
  const h=harness(options);const res=await h.post();assert.equal(res.status,503);const b=await res.json();assert.equal(b.ok,false);assert.equal('results' in b,false);assert.equal(h.writes.length,0);
 }
});
test('oversized, malformed and future requests fail before metric reads',async()=>{
 for(const [body,status] of [['x'.repeat(32769),413],['{',400],[{month:'2099-01',rules:rules.proposedPercentageRules()},400],[{month:'2026-00',rules:rules.proposedPercentageRules()},400]]) {const h=harness();assert.equal((await h.post(body)).status,status);assert.equal(h.reads.length,0);}
});
test('prose-only bonuses appear as warning but are not counted as real money',async()=>{
 const config=activeRows();config[1].benefit_config={health_bonus:0,rank_bonus:0,cliente_rate_bonus:0,repite_rate_bonus:0,extras:['Bono salud: 10 €']};
 const b=await (await harness({config}).post()).json();assert.equal(b.results[0].current_rank_extras,0);assert.equal(b.results[0].proposed_rank_extras,15);assert.equal(b.results[0].difference,15);assert.equal(b.warnings.length,1);
});
test('exact pagination cap succeeds but extra data prevents a partial result',async()=>{
 const rows=Array.from({length:50000},(_,i)=>call(String(i)));
 const ok=await harness({rows}).post();assert.equal(ok.status,200);
 const bad=await harness({rows:[...rows,call('50001')]}).post();assert.equal(bad.status,503);
});
test('draft is integrated in administration only, not live tarotista billing',()=>{
 const admin=fs.readFileSync(path.join(root,'src/components/admin/TarotistaRanksAdminPanel.tsx'),'utf8');assert.match(admin,/TarotistaPercentageRanksDraft/);assert.match(admin,/Abrir propuesta y simulación/);
 for(const file of ['src/app/api/invoices/generate/route.ts','src/app/api/stats/monthly/route.ts','src/components/tarotista/TarotistaRanksPanel.tsx'])assert.doesNotMatch(fs.readFileSync(path.join(root,file),'utf8'),/tarotista-percentage-ranks|TarotistaPercentageRanksView/);
 const route=fs.readFileSync(path.join(root,'src/app/api/admin/tarotista-ranks/simulate/route.ts'),'utf8');assert.doesNotMatch(route,/\.(upsert|insert|update|delete|rpc)\(/);
});
