const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const base=path.join(__dirname,'..');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function load(file,mocks={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(base,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>{if(!(n in mocks))throw Error(n);return mocks[n];},URL,Date,Map,Set,console:{error(){}}});return exports;}
const shared=load('src/lib/client-referrals.ts');
const response={NextResponse:{json:(body,options)=>({body,...options})}};
const server=(worker=null)=>load('src/lib/server/client-referrals.ts',{'next/server':response,'@/lib/client-referrals':shared,'@/lib/server/auth-worker':{workerFromRequest:async()=>worker,getAdminClient:()=>({})}});

test('reward configuration rejects coercion, unsafe quantities and permanent ranks',()=>{
 const valid={title:'Un premio',referrals_required:3,reward_type:'coins',amount:50,enabled:true};
 assert.equal(shared.parseReferralReward(valid).amount,50);
 for(const changes of [{amount:-1},{amount:0},{amount:1.5},{amount:'50'},{amount:1000001},{referrals_required:0},{referrals_required:1.5},{enabled:'true'},{title:''},{reward_type:'unknown'},{reward_type:'rank',rank_key:'admin',rank_days:7},{reward_type:'rank',rank_key:'oro',rank_days:null},{reward_type:'rank',rank_key:'oro',rank_days:366},{reward_type:'roulette',roulette_level:6},{reward_type:'oracle',amount:101}])assert.throws(()=>shared.parseReferralReward({...valid,...changes}));
 assert.equal(shared.parseReferralReward({...valid,reward_type:'rank',rank_key:'oro',rank_days:7}).amount,1);
});

test('customer claim always uses verified client and identity, never ids supplied in request',async()=>{
 let gate={uid:id(1),cliente:{id:id(2)},admin:{rpc:async(name,args)=>{calls.push({name,args});return {data:{id:id(4)},error:null};}}},calls=[];
 const route=load('src/app/api/cliente/referidos/route.ts',{'@/lib/server/auth-cliente':{clientFromRequest:async()=>gate},'@/lib/client-referrals':shared,'@/lib/server/client-referrals':server()});
 const body={action:'claim',reward_id:id(3),operation_id:id(4),expected_version:1,cliente_id:id(999),auth_user_id:id(999),amount:1000000};
 const post=async data=>route.POST({json:async()=>data});
 const result=await post(body);
 assert.equal(result.status,200);assert.equal(calls[0].args.p_cliente_id,id(2));assert.equal(calls[0].args.p_auth_user_id,id(1));assert.equal(calls[0].args.p_operation_id,id(4));assert.equal('amount' in calls[0].args,false);
 assert.match(result.headers['Cache-Control'],/no-store/);assert.equal(result.headers.Vary,'Authorization');
 await post({...body,expected_version:0});assert.equal(calls.length,1);
 gate={uid:null,cliente:null};assert.equal((await post(body)).status,401);
 gate={uid:id(1),cliente:null};assert.equal((await post(body)).status,404);assert.equal(calls.length,1);
});

test('CRM access rejects tarotistas, inactive workers and legacy email matches with another auth id',async()=>{
 const person={id:id(1),user_id:id(2),resolved_uid:id(2),role:'central',is_active:true};
 for(const changes of [{role:'tarotista'},{resolved_uid:id(3)},{resolved_uid:null},{is_active:false}])assert.equal(await server({...person,...changes}).referralStaff({}),null);
 assert.equal((await server(person).referralStaff({})).authUserId,id(2));
});

test('admin catalog writes bind actor and preserve version checks',async()=>{
 let allowed=false,calls=[];
 const route=load('src/app/api/admin/referral-rewards/route.ts',{'@/lib/admin/require-admin':{requireAdmin:async()=>allowed?{ok:true,me:{id:id(1)},authUserId:id(2),admin:{rpc:async(name,args)=>{calls.push({name,args});return {data:{id:id(9)},error:null};}}}:{ok:false,error:'FORBIDDEN'}},'@/lib/client-referrals':shared,'@/lib/server/client-referrals':server()});
 const body={action:'save',operation_id:id(4),expected_version:null,reward:{title:'Coins',referrals_required:3,reward_type:'coins',amount:50,enabled:true},actor_worker_id:id(99),actor_user_id:id(99)};
 const post=async b=>route.POST({json:async()=>b});
 assert.equal((await post(body)).status,403);allowed=true;
 assert.equal((await post({...body,reward:{...body.reward,id:id(9)}})).status,400);
 assert.equal((await post(body)).status,200);assert.equal(calls.length,1);assert.equal(calls[0].args.p_actor_worker_id,id(1));assert.equal(calls[0].args.p_actor_user_id,id(2));
});

test('client state strips referred identities and spending and preserves claimed receipt',async()=>{
 const refs=[{id:id(11),referred_id:id(21),status:'available',created_at:'2026-11-22T00:00:00Z',paid_total:11},{id:id(12),referred_id:id(22),status:'claimed',created_at:'2026-11-21T00:00:00Z',paid_total:12,claimed_by:id(31)}];
 const reward={id:id(41),title:'Premio',referrals_required:1,reward_type:'coins',amount:50,enabled:true,version:1};
 function query(data){const q={select:()=>q,order:()=>q,range:()=>q,eq:()=>q,limit:()=>q,in:()=>q,then:resolve=>Promise.resolve({data,error:null}).then(resolve)};return q;}
 const admin={rpc:name=>{assert.equal(name,'tc_client_referral_status');return query(refs);},from:table=>query(table==='client_referral_rewards'?[reward]:table==='client_referral_claims'?[{id:id(31),reward_snapshot:reward,created_at:'2026-11-22T00:00:00Z'}]:[{id:id(21),nombre:'Michelle Apellido',apellido:'Privado'},{id:id(22),nombre:'+17870000000'}])};
 const data=await server().loadReferralState(admin,id(2));
 assert.equal(data.summary.available,1);assert.equal(data.summary.claimed,1);assert.equal(data.referrals[0].name,'Michelle');assert.equal(data.referrals[1].name,'Cliente');assert.equal(data.referrals[1].reward_title,'Premio');assert.equal(data.rewards[0].claimable,true);
 for(const r of data.referrals){assert.equal('referred_id' in r,false);assert.equal('paid_total' in r,false);}
 assert.equal(JSON.stringify(data).includes('17870000000'),false);assert.equal(data.qualification,'purchases_over_10');assert.equal(data.claim_mode,'consume');
 admin.rpc=()=>{const q=query(null);q.then=resolve=>Promise.resolve({data:null,error:Error('Connection failed')}).then(resolve);return q;};await assert.rejects(server().loadReferralState(admin,id(2)),/Connection failed/);
});
