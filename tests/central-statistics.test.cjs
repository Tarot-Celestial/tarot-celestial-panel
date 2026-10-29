const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:n=>{if(n in imports)return imports[n];throw new Error(n);},Date,Intl,Map,Set,Math,Number,JSON,Response,Request,URL,console});return exports;}
const core=load('lib/central-statistics.ts');
const {centralHours}=load('lib/server/central-statistics-hours.ts',{'@/lib/central-statistics':core});
const config={id:'c1',worker_id:'m',effective_from:'2026-10-01T05:00:00Z',timezone:'America/Guayaquil',monthly_salary_eur:400,overtime_hourly_rate_eur:null,weekday_start:'15:00',weekday_end:'23:00',weekend_start:'09:00',weekend_end:'15:00'};
const session=(start,end,extra={})=>({id:start,worker_id:'m',started_at:start,ended_at:end,expires_at:end,close_reason:'manual',...extra});
const input=(extra={})=>({workerId:'m',from:'2026-10-01T05:00:00Z',to:'2026-11-01T05:00:00Z',now:Date.parse('2026-11-02T05:00:00Z'),coverageStart:'2026-10-01T05:00:00Z',sessions:[],versions:[config],overrides:[],adjustments:[],...extra});
test('Ecuador MTD stays at UTC-5 across Spain DST and compares the same elapsed local clock',()=>{
 const p=core.centralPeriod('2026-10',new Date('2026-10-28T23:15:00Z'));
 assert.equal(p.current_start,'2026-10-01T05:00:00.000Z');assert.equal(p.previous_end,'2026-09-28T23:15:00.000Z');assert.equal(p.is_partial,true);
 const end=core.centralPeriod('2026-03',new Date('2026-03-31T21:00:00Z'));assert.equal(end.previous_end,'2026-03-01T05:00:00.000Z');
 assert.throws(()=>core.centralPeriod('2026-13',new Date('2026-10-28')),/INVALID_MONTH/);
 assert.throws(()=>core.centralPeriod('2026-11',new Date('2026-10-28')),/INVALID_MONTH/);
 assert.equal(core.metric(3,0).percent,null);assert.equal(core.metric(3,null).delta,null);
});
test('overlapping tabs cannot double hours, expired sessions stop counting and shifts cross UTC midnight',()=>{
 const result=centralHours(input({sessions:[session('2026-10-05T19:00:00Z','2026-10-06T04:30:00Z'),session('2026-10-05T20:00:00Z','2026-10-05T22:00:00Z')]}));
 assert.equal(result.worked_minutes,570);assert.equal(result.ordinary_minutes,480);assert.equal(result.outside_schedule_minutes,90);assert.equal(result.extra_amount,null);
 const expired=centralHours(input({sessions:[session('2026-10-05T20:00:00Z',null,{expires_at:'2026-10-05T20:10:00Z'})]}));assert.equal(expired.worked_minutes,10);
});
test('months before new coverage remain unknown, not zero worked hours',()=>{
 const result=centralHours(input({from:'2026-09-01T05:00:00Z',to:'2026-10-01T05:00:00Z',coverageStart:'2026-10-28T22:00:00Z'}));
 assert.equal(result.worked_minutes,null);assert.equal(result.available,false);assert.equal(result.days.length,0);
});
test('a total panel outage can be corrected from activation without inventing sessions',()=>{
 const result=centralHours(input({sessions:[],adjustments:[{id:'a',worker_id:'m',work_date:'2026-10-05',minutes:480,category:'ordinary',reason:'Trabajo verificado durante corte de internet',created_by:'admin',created_at:'2026-10-06T10:00:00Z',hourly_rate_eur:null}]}));
 assert.equal(result.worked_minutes,480);assert.equal(result.ordinary_minutes,480);assert.equal(result.adjustment_minutes,480);
});
test('unassigned weekends are not automatically payable extras; selected weekend fixes one 6-hour shift',()=>{
 const sessions=[session('2026-10-10T14:00:00Z','2026-10-10T20:00:00Z')];
 const unassigned=centralHours(input({sessions}));assert.equal(unassigned.unclassified_minutes,360);assert.equal(unassigned.outside_schedule_minutes,0);
 const overrides=[{id:'o1',worker_id:'m',work_date:'2026-10-10',is_working:true,start_time:'09:00',end_time:'15:00',created_at:'2026-10-08T10:00:00Z'}];
 const planned=centralHours(input({sessions,overrides}));assert.equal(planned.ordinary_minutes,360);assert.equal(planned.unclassified_minutes,0);
 const restDay=centralHours(input({sessions:[session('2026-10-11T14:00:00Z','2026-10-11T15:00:00Z')],overrides}));assert.equal(restDay.outside_schedule_minutes,60);
});
test('config and approved rate changes apply only after their effective instant',()=>{
 const result=centralHours(input({sessions:[session('2026-10-05T18:00:00Z','2026-10-05T20:00:00Z')],versions:[{...config,overtime_hourly_rate_eur:10},{...config,id:'c2',effective_from:'2026-10-05T19:00:00Z',overtime_hourly_rate_eur:20}]}));
 assert.equal(result.extra_amount,30);assert.equal(result.outside_schedule_minutes,120);
});
test('audited corrections are separate and preserve their stored rate',()=>{
 const result=centralHours(input({sessions:[session('2026-10-05T20:00:00Z','2026-10-05T21:00:00Z')],adjustments:[{id:'a',worker_id:'m',work_date:'2026-10-05',minutes:30,category:'outside_schedule',reason:'Trabajo verificado fuera del panel',created_by:'admin',created_at:'2026-10-06T10:00:00Z',hourly_rate_eur:12}]}));
 assert.equal(result.worked_minutes,90);assert.equal(result.adjustment_minutes,30);assert.equal(result.extra_amount,6);assert.equal(result.days.find(d=>d.date==='2026-10-05').ordinary_minutes,60);
});
test('stats endpoint verifies Supabase user and requires active admin and connection',async()=>{
 let authenticated=true,role='central',active=true,connected=false,reads=0,lookups=0;
 const db={auth:{getUser:async()=>{lookups++;return {data:{user:authenticated?{id:'auth'}:null},error:authenticated?null:{message:'invalid'}};}},from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id:'admin',role,is_active:active},error:null})})};
 const route=load('app/api/admin/central-statistics/route.ts',{'@/lib/server/auth-worker':{getAdminClient:()=>db},'@/lib/server/panel-attendance':{requireActivePanelSession:async()=>connected?{ok:true}:{ok:false,status:423,error:'PANEL_CONNECTION_REQUIRED'}},'@/lib/server/central-statistics':{loadCentralStatistics:async()=>{reads++;return {ok:true};}},'@/lib/central-statistics':core});
 const req=()=>new Request('https://test/api/admin/central-statistics?month=2026-10',{headers:{authorization:'Bearer test'}});
 assert.equal((await route.GET(new Request('https://test/api/admin/central-statistics'))).status,401);
 assert.equal((await route.GET(req())).status,403);role='admin';active=false;assert.equal((await route.GET(req())).status,403);
 active=true;assert.equal((await route.GET(req())).status,423);assert.equal(reads,0);
 connected=true;assert.equal((await route.GET(req())).status,200);assert.equal(reads,1);authenticated=false;assert.equal((await route.GET(req())).status,401);assert.equal(reads,1);assert.equal(lookups,5);
});
test('partial source history suppresses trends, historical queues stay unknown, activation measures an empty day',async()=>{
 const row={id:'m',display_name:'Central',role:'central',is_active:true,salary_base:400,xp_total:10,...Object.fromEntries(core.CENTRAL_METRICS.map(k=>[k,5]))};
 let planningBound;
 const db={rpc:async()=>({data:{workers:[row],payment_days:[],totals:{},coverage:{capture_actions:'2026-09-08T05:00:00Z'}},error:null}),from:table=>{
  const chain={select(){return this;},order(){return this;},lt(key,value){if(table==='central_workday_overrides')planningBound=value;return this;},gt(){return this;},gte(){return this;},eq(){return this;},range:async()=>({data:table==='central_workday_overrides'?[{id:'o1',worker_id:'m',work_date:'2026-11-07',is_working:true,start_time:'09:00',end_time:'15:00',created_at:'2026-10-28T10:00:00Z'}]:[],error:null}),single:async()=>({data:{activated_at:'2026-10-28T20:00:00Z'},error:null})};return chain;
 }};
 const backend=load('lib/server/central-statistics.ts',{'@/lib/central-statistics':core,'@/lib/xp-levels':{configuredXpProgress:()=>({level:1,current:10,span:100,next:100,maxed:false})},'@/lib/server/xp-level-config':{loadXpLevelConfiguration:async()=>({levels:[],tiers:[]})},'./central-statistics-hours':load('lib/server/central-statistics-hours.ts',{'@/lib/central-statistics':core})});
 const current=await backend.loadCentralStatistics(db,'2026-10',new Date('2026-10-28T23:00:00Z'));
 assert.equal(current.workers[0].metrics.capture_actions.current,5);assert.equal(current.workers[0].metrics.capture_actions.previous,5);assert.equal(current.workers[0].metrics.capture_actions.delta,null);assert.equal(current.workers[0].metrics.capture_actions.percent,null);
 assert.equal(current.workers[0].hours.worked_minutes,0);assert.equal(current.workers[0].day_breakdown.length,1);assert.equal(current.workers[0].hours.previous_worked_minutes,null);
 assert.equal(current.workers[0].weekend_days[0],'2026-11-07');assert.equal(planningBound,'2027-11-08');
 const past=await backend.loadCentralStatistics(db,'2026-09',new Date('2026-10-28T23:00:00Z'));
 assert.equal(past.workers[0].metrics.leads_assigned.current,null);assert.equal(past.workers[0].metrics.pending_followups.current,null);assert.equal(past.workers[0].hours.worked_minutes,null);
});
