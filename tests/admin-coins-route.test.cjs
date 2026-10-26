// API/auth contracts only: no network, live customers or balance mutations.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function load(file,mocks,globals={}) {
 const exports={};
 const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:n=>{if(n in mocks)return mocks[n];throw Error('Unexpected import: '+n);},URL,...globals});
 return exports;
}
function harness() {
 const h={authenticated:true,role:'admin',active:true,userId:id(1),workerUserId:id(1),balance:17,rpcCalls:[],reads:[],ledger:new Map(),rpcError:null,historyError:false,failAfterCommit:false,malformed:false};
 const worker=()=>({id:id(2),user_id:h.workerUserId,email:'admin@example.test',role:h.role,is_active:h.active});
 const admin={from(table){
  const filters=[];let columns,options,limit,order;
  const q={select(c,o){columns=c;options=o;return q;},eq(k,v){filters.push([k,v]);return q;},order(k,o){order={key:k,...o};return q;},limit(n){limit=n;return q;},maybeSingle(){return q;},or(){return q;},
   then(resolve,reject){
    h.reads.push({table,filters,columns,options,limit,order});
    let data=null,error=null,count;
    if(table==='workers') data=filters.every(([k,v])=>worker()[k]===v)?worker():null;
    if(table==='crm_clientes') data={id:id(3),nombre:'Clienta',apellido:'Prueba',telefono:'123',email:'cliente@example.test'};
    if(table==='tc_admin_spin_adjustments') data=[{operation_id:id(20),nivel:1,delta:1,reason:'Prueba giros',before_count:0,after_count:1,created_at:'2026-10-26T00:00:00Z'}];
    if(table==='tc_admin_coin_adjustments') {data=[{operation_id:id(21),amount:5,reason:'Prueba Coins',before_balance:12,after_balance:17,movement_id:id(30),created_at:'2026-10-26T00:00:00Z'}];if(h.historyError){data=null;error={message:'temporary unavailable'};}}
    if(table==='cliente_ruleta_giros') {data=null;count=filters.find(([k])=>k==='nivel')[1];}
    return Promise.resolve({data,error,count}).then(resolve,reject);
   }};return q;
  },
  async rpc(name,payload) {
   h.rpcCalls.push({name,payload});
   if(name==='tc_client_state_snapshot') return {data:{coins:h.balance,minutes_free:7,minutes_normal:12,minutes_total:19,effective_rank:'oro'},error:null};
   if(name==='cliente_ruleta_resumen_ultra_v1') return {data:{level_1_spins:1,level_2_spins:2,level_3_spins:3,level_4_spins:4,level_5_spins:0},error:null};
   if(name==='tc_admin_adjust_spins') return {data:{operation_id:payload.p_operation_id,delta:payload.p_delta},error:h.rpcError};
   if(name!=='tc_admin_adjust_coins') throw Error('Unexpected RPC: '+name);
   if(h.rpcError)return {data:null,error:h.rpcError};
   // Mimics only the RPC return/replay contract; transaction guarantees are
   // covered by the independent database integration suite.
   if(payload.p_actor_user_id!==h.workerUserId || h.role!=='admin' || !h.active) return {data:null,error:{message:'FORBIDDEN'}};
   const existing=h.ledger.get(payload.p_operation_id);
   if(existing) {
    if(JSON.stringify(existing.payload)!==JSON.stringify(payload))return {data:null,error:{message:'OPERATION_CONFLICT'}};
    return {data:{...existing.result,replayed:true},error:null};
   }
   const result={operation_id:payload.p_operation_id,cliente_id:payload.p_cliente_id,amount:payload.p_amount,before_balance:h.balance,after_balance:h.balance+payload.p_amount,reason:payload.p_reason,replayed:false};
   h.balance=result.after_balance;h.ledger.set(payload.p_operation_id,{payload,result});
   if(h.failAfterCommit){h.failAfterCommit=false;throw Error('connection lost after commit');}
   return {data:h.malformed?null:result,error:null};
  }};
 const auth=load('src/lib/admin/require-admin.ts',{'@supabase/supabase-js':{createClient:(_url,key)=>key==='anon'?{auth:{getUser:async()=>({data:{user:h.authenticated?{id:h.userId,email:'admin@example.test'}:null},error:h.authenticated?null:{status:401}})}}:admin},'@/lib/month-key':{}},{process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.test',NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'}}});
 const route=load('src/app/api/admin/client-balances/route.ts',{'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},'@/lib/admin/require-admin':auth});
 h.body={action:'coins',cliente_id:id(3),operation_id:id(4),amount:50,reason:'Reposición autorizada'};
 h.post=(overrides={})=>route.POST({headers:new Headers({authorization:'Bearer fixture'}),json:async()=>({...h.body,...overrides})});
 h.get=(query='id='+id(3))=>route.GET({url:'https://panel.test/api/admin/client-balances?'+query,headers:new Headers({authorization:'Bearer fixture'})});
 return h;
}
test('Coins API denies unauthenticated, non-admin and inactive users before balance reads or writes',async()=>{
 for(const change of [{authenticated:false},{role:'central'},{role:'tarotista'},{active:false}]) {
  const h=harness();Object.assign(h,change);
  assert.equal((await h.post()).status,403);assert.equal((await h.get()).status,403);
  assert.equal(h.rpcCalls.length,0);assert.ok(h.reads.every(read=>read.table==='workers'));assert.equal(h.balance,17);
 }
});
test('Only positive whole Coins within the existing limit and a meaningful reason reach the RPC',async()=>{
 for(const change of [{amount:0},{amount:-1},{amount:0.5},{amount:1_000_001},{amount:'50'},{amount:null},{amount:Number.MAX_SAFE_INTEGER},{reason:''},{reason:'  a  '},{reason:'x'.repeat(501)},{reason:1},{cliente_id:'bad'},{operation_id:'bad'},{action:'delete'}]) {
  const h=harness(),r=await h.post(change);assert.equal(r.status,400);assert.equal(h.rpcCalls.length,0);assert.equal(h.balance,17);
 }
 for(const amount of [1,1_000_000]) {const h=harness();assert.equal((await h.post({amount})).status,200);}
});
test('Coins actor comes from the verified Auth user; request substitution is ignored and reasons are trimmed',async()=>{
 const h=harness(),r=await h.post({actor_user_id:id(90),p_actor_user_id:id(91),user_id:id(92),reason:'  Corrección solicitada  ',before_balance:0,after_balance:99999});
 assert.equal(r.status,200);const call=h.rpcCalls[0];assert.equal(call.name,'tc_admin_adjust_coins');
 assert.deepEqual(Object.keys(call.payload).sort(),['p_actor_user_id','p_amount','p_cliente_id','p_operation_id','p_reason']);
 assert.equal(call.payload.p_actor_user_id,h.userId);assert.equal(call.payload.p_reason,'Corrección solicitada');
 assert.equal(r.body.adjustment.before_balance,17);assert.equal(r.body.adjustment.after_balance,67);assert.match(r.headers['Cache-Control'],/private.*no-store/);
});
test('Email fallback never attributes a gift to an old worker Auth link',async()=>{
 const h=harness();h.workerUserId=id(8);const r=await h.post();
 assert.equal(r.status,403);assert.equal(h.rpcCalls[0].payload.p_actor_user_id,h.userId);assert.notEqual(h.rpcCalls[0].payload.p_actor_user_id,h.workerUserId);
 assert.equal(h.ledger.size,0);assert.equal(h.balance,17);
});
test('Lost response retains operation identity: retry returns the original before/after without a second sum',async()=>{
 const h=harness();h.failAfterCommit=true;
 const first=await h.post();assert.equal(first.status,503);assert.equal(first.body.code,'COINS_ADJUSTMENT_UNCONFIRMED');assert.equal(first.body.uncertain,true);
 const retry=await h.post();assert.equal(retry.status,200);assert.equal(retry.body.adjustment.replayed,true);
 assert.equal(retry.body.adjustment.before_balance,17);assert.equal(retry.body.adjustment.after_balance,67);assert.equal(h.balance,67);assert.equal(h.ledger.size,1);
 assert.equal(h.rpcCalls[0].payload.p_operation_id,h.rpcCalls[1].payload.p_operation_id);
 const conflict=await h.post({amount:51});assert.equal(conflict.status,409);assert.equal(conflict.body.code,'OPERATION_CONFLICT');assert.equal(h.balance,67);
});
test('Known transactional errors have bounded messages; unknown or malformed responses remain unconfirmed',async()=>{
 for(const [message,status,code] of [['CLIENT_NOT_FOUND',404,'CLIENT_NOT_FOUND'],['FORBIDDEN',403,'FORBIDDEN'],['OPERATION_CONFLICT',409,'OPERATION_CONFLICT'],['COIN_BALANCE_LIMIT',409,'COIN_BALANCE_LIMIT'],['INVALID_AMOUNT',400,'INVALID_COINS_ADJUSTMENT'],['INVALID_REASON',400,'INVALID_COINS_ADJUSTMENT'],['INVALID_ADJUSTMENT',400,'INVALID_COINS_ADJUSTMENT'],['COIN_GIFT_CONTRACT_MISMATCH private detail',503,'COINS_ADJUSTMENT_UNCONFIRMED']]) {
  const h=harness();h.rpcError={message};const r=await h.post();assert.equal(r.status,status);assert.equal(r.body.code,code);assert.doesNotMatch(r.body.error,/private detail/);assert.match(r.headers['Cache-Control'],/no-store/);
 }
 const h=harness();h.malformed=true;const r=await h.post();assert.equal(r.status,503);assert.equal(r.body.code,'COINS_ADJUSTMENT_UNCONFIRMED');
});
test('GET adds ordered Coins audit without changing existing wallet, available spins or spin history',async()=>{
 const h=harness(),r=await h.get();assert.equal(r.status,200);assert.equal(r.body.wallet.coins,17);assert.equal(r.body.wallet.minutes_total,19);
 assert.equal(r.body.history[0].delta,1);assert.equal(r.body.spins[4].count,5);assert.equal(r.body.spins[4].available,0);
 assert.equal(r.body.coins_history[0].amount,5);assert.equal(r.body.coins_history[0].before_balance,12);assert.equal(r.body.coins_history[0].after_balance,17);
 const audit=h.reads.find(row=>row.table==='tc_admin_coin_adjustments');assert.equal(audit.limit,20);assert.equal(audit.order.key,'created_at');assert.equal(audit.order.ascending,false);assert.deepEqual(audit.filters,[['cliente_id',id(3)]]);
 assert.doesNotMatch(audit.columns,/actor|private|email/);assert.match(r.headers['Cache-Control'],/no-store/);
 h.historyError=true;assert.equal((await h.get()).status,503);
});
test('Existing spin request contract remains available and calls only its original RPC',async()=>{
 const h=harness();const r=await h.post({action:undefined,level:3,delta:-1});assert.equal(r.status,200);
 assert.equal(h.rpcCalls[0].name,'tc_admin_adjust_spins');assert.equal(h.rpcCalls[0].payload.p_level,3);assert.equal(h.rpcCalls[0].payload.p_delta,-1);assert.equal(h.ledger.size,0);
});
