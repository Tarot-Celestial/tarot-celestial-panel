const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function load(file,mocks={},globals={}){
 const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const exports={};
 vm.runInNewContext(code,{exports,require:n=>n in mocks?mocks[n]:require(n),console,Request,Response,URL,AbortController,Date,setTimeout,clearTimeout,...globals});
 return exports;
}
const guide=load('src/lib/client-rank-guide.ts');
const ranks=[['bronce',.01],['plata',100],['oro',500],['diamante',1000]].map(([key,min_spend])=>({key,label:key,min_spend,active:true,benefits:[],package_benefits:[]}));
test('progress uses rolling spend at exact thresholds and does not use an override as purchase progress',()=>{
 for(const [total,next,remaining] of [[0,'bronce',.01],[.01,'plata',99.99],[99.99,'plata',.01],[100,'oro',400],[499.99,'oro',.01],[500,'diamante',500],[999.99,'diamante',.01],[1000,null,0],[1500,null,0]]){
  const p=guide.guideProgress({state:{total,effective:'diamante',automatic:'bronce'},ranks});
  assert.equal(p.next?.key||null,next);assert.equal(p.remaining,remaining);assert.ok(p.percent>=0&&p.percent<=100);
 }
});
function endpoint({total=650,matrixFailure=false,stateFailure=false,configFailure=false}={}){
 const calls=[];
 const tables={
  crm_clientes:[{id:'client-a',auth_user_id:'user-a'}],
  tc_client_rank_benefits:ranks.map(r=>({rank_key:r.key,label:r.key,min_spend:r.min_spend,is_active:false,ritual_access:r.key==='diamante'})),
  tc_rank_package_benefits:[{rank_key:'oro',package_level:2,enabled:true,coins:10,oracle_credits:0,roulette_level_1_spins:0,roulette_level_2_spins:1,roulette_level_3_spins:0,roulette_special_spins:0}],
  tc_rank_daily_bonus_config:[],
 };
 const admin={
  auth:{getUser:async token=>({data:{user:token==='valid'?{id:'user-a'}:null},error:token==='valid'?null:{status:401}})},
  rpc:async(name,args)=>{calls.push({name,args});return {data:stateFailure?null:{total,compras:4,effective:'diamante',automatic:'oro',override:{reason:'private',notes:'private',ends_at:null}},error:stateFailure?{code:'DOWN'}:null};},
  from:table=>{
   let columns,filters=[],single=false;
   const query={
    select(value){columns=value;return this;},eq(key,value){filters.push([key,value]);return this;},
    in(){return this;},order(){return this;},limit(){return this;},maybeSingle(){single=true;return this;},
    then(resolve,reject){
      let data=(tables[table]||[]).filter(row=>filters.every(([key,value])=>row[key]===value));
      calls.push({table,columns,filters});
      if(columns)data=data.map(row=>Object.fromEntries(columns.split(',').map(k=>[k,row[k]])));
      const error=matrixFailure&&table==='tc_rank_package_benefits'||configFailure&&table==='tc_client_rank_benefits'?{code:'DOWN'}:null;
      return Promise.resolve({data:single?data[0]||null:data,error}).then(resolve,reject);
    },
   };return query;
  },
 };
 const access=load('src/lib/server/ruleta-access.ts',{'@supabase/supabase-js':{createClient:()=>admin}},{process:{env:{}}});
 const api=load('src/app/api/cliente/rangos/route.ts',{
  'next/server':{NextResponse:{json:(body,options)=>new Response(JSON.stringify(body),{...options,headers:{...options?.headers,'Content-Type':'application/json'}})}},
  '@/lib/server/ruleta-access':access,'@/lib/client-rank-guide':guide,
  '@/lib/server/cliente-platform':{currentRankBenefits:()=>['Ventaja del programa','Acceso a Mi Ritual']},
 });
 return {api,calls};
}
test('rank endpoint verifies authentication and scopes personal state to the token owner',async()=>{
 const {api,calls}=endpoint();
 for(const token of [null,'invalid']){
  const result=await api.GET(new Request('http://local/api/cliente/rangos',{headers:token?{authorization:'Bearer '+token}:{}}));
  assert.equal(result.status,401);
 }
 assert.equal(calls.length,0);
 const response=await api.GET(new Request('http://local/api/cliente/rangos?client_id=client-b',{headers:{authorization:'Bearer valid'}}));
 assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);
 const body=await response.json();
 assert.equal(body.cliente_id,'client-a');assert.equal(body.state.total,650);assert.equal(body.state.has_override,true);
 assert.equal(calls.find(x=>x.name==='tc_client_rank_state').args.p_cliente_id,'client-a');
 assert.equal(body.ranks.length,4);assert.equal(body.ranks[3].min_spend,1000);
 assert.ok(body.ranks[3].benefits.some(x=>x.includes('Mi ritual')));
 assert.ok(!body.ranks[0].benefits.some(x=>/ritual/i.test(x)));
 assert.ok(!JSON.stringify(body).includes('private'));
 for(const q of calls.filter(x=>x.table!=='crm_clientes'&&x.table)) assert.doesNotMatch(q.columns,/notes|updated_by|actor/);
});
test('database errors never become a zero balance or invented package extras',async()=>{
 for(const options of [{stateFailure:true},{configFailure:true}]){
  const result=await endpoint(options).api.GET(new Request('http://local',{headers:{authorization:'Bearer valid'}}));
  assert.equal(result.status,503);assert.equal((await result.json()).ok,false);
 }
 const result=await endpoint({matrixFailure:true}).api.GET(new Request('http://local',{headers:{authorization:'Bearer valid'}}));
 const body=await result.json();assert.equal(body.state.total,650);assert.equal(body.ranks[0].package_benefits,null);assert.equal(body.warnings.length,1);
});
test('Diamond benefits change without changing Gold or Silver',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/lib/server/cliente-platform.ts'),'utf8');
 const fragment=source.slice(source.indexOf('export function currentRankBenefits('),source.indexOf('const CRM_MONTH_TAGS'));
 const exports={};
 vm.runInNewContext(ts.transpileModule(fragment,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
 const diamond=exports.currentRankBenefits('diamante').join(' ');
 assert.match(diamond,/15 minutos GRATIS cuando se incorpora/);
 assert.ok(diamond.includes('+15 minutos GRATIS permanentes en cada compra'));
 assert.ok(diamond.includes('+500 Coins por cada compra de paquete de nivel 1, 2 o 3'));
 assert.match(diamond,/promoción diaria exclusiva de un solo uso/);
 assert.doesNotMatch(diamond,/12 minutos|precio regular/);
 const gold=exports.currentRankBenefits('oro').join(' ');
 assert.match(gold,/12 minutos/);assert.match(gold,/precio regular/);assert.doesNotMatch(gold,/500 Coins/);
 assert.match(exports.currentRankBenefits('plata').join(' '),/10 minutos/);
});

test('Purchase responses and notifications include recorded Diamond FREE minutes, including retries',async()=>{
 for(const promotional of [false,true])for(const duplicated of [false,true])for(const gift of [0,15]){
  const notifications=[],payment={id:'payment-a',paid_minutes:20,bonus_minutes:5};
  const admin={rpc:async()=>({data:{payment,duplicated},error:null}),from:table=>{
   let single=false;
   const query={select(){return this;},eq(){return this;},neq(){return this;},gte(){return this;},lt(){return this;},order(){return this;},update(){return this;},insert(){return this;},maybeSingle(){single=true;return this;},
    then(resolve,reject){const data=table==='tc_client_benefit_events'?[{benefit_key:'diamond_purchase_minutes',minutes:gift,coins:0},{benefit_key:'other',minutes:99,coins:500}]:table==='crm_clientes'?{nombre:'Cliente'}:[];return Promise.resolve({data:single?data:data,error:null}).then(resolve,reject);}};return query;}};
  const mocks={
   '@/lib/server/cliente-platform':{createClientNotification:async(_,n)=>notifications.push(n),monthRange:()=>({start:new Date(),end:new Date()}),splitMinutes:()=>({normal:20,free:5}),syncClientMonthTag:async()=>{},toNum:Number},
   '@/lib/server/rank-benefits':{rankState:async()=>({effective:'diamante'})},
   '@/lib/ruleta':{rouletteLevelForPurchaseAmount:()=>null},
   '@/lib/server/cliente-minute-packs':{getConfiguredMinutePack:()=>({id:'pack',nombre:'Paquete',totalMinutes:25})},
  };
  let response;
  if(promotional){
   const mod=load('src/lib/server/client-promotions.ts',mocks);
   response=await mod.applyPromotionMinutePurchase(admin,{clienteId:'client-a',attemptId:'attempt',paymentRef:'ref',amount:10,currency:'USD',snapshot:{kind:'promotion_minute_pack',price:10,currency:'USD',paid_minutes:20,free_minutes:5,roulette_spins:0,coins:7,promotion_name:'Promo',package_name:'Pack'}});
   assert.equal(response.totalMinutes,25+gift);
  }else{
   const mod=load('src/lib/server/client-minute-purchase.ts',mocks);
   response=await mod.applyConfiguredMinutePurchase(admin,{clienteId:'client-a',packId:'pack',paymentRef:'ref',amount:10,currency:'USD'});
   assert.equal(response.creditedMinutes.normal,20);assert.equal(response.creditedMinutes.free,5+gift);
  }
  assert.equal(notifications.length,duplicated?0:1);
  if(!duplicated) assert.equal(notifications[0].meta.total_minutes,25+gift);
 }
});