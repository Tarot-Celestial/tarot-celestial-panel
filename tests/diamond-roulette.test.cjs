const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
function load(file,mocks={}){
 const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const exports={};
 vm.runInNewContext(code,{exports,require:name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),console:{...console,error:()=>{}},Request,Response,URL,AbortSignal,setTimeout,clearTimeout});
 return exports;
}
const diamond=load('src/lib/diamond-roulette.ts');
const labels=load('src/lib/ruleta.ts');
class AccessError extends Error{constructor(status,message){super(message);this.status=status;}}
const client='10000000-0000-4000-8000-000000000001';
const spinId='20000000-0000-4000-8000-000000000001';

test('Client instructions distinguish manual prizes, already-credited assets and the seven-day deadline',()=>{
 assert.match(diamond.rouletteRewardMessage({reward_type:'perk',fulfillment_mode:'manual'}),/captura de pantalla/);
 assert.match(diamond.rouletteRewardMessage({reward_type:'perk',fulfillment_mode:'manual'}),/llámanos/);
 assert.match(diamond.rouletteRewardMessage({reward_type:'streak_minutes',fulfillment_mode:'claim'}),/7 días naturales/);
 assert.match(diamond.rouletteRewardMessage({reward_type:'streak_minutes',fulfillment_mode:'claim'}),/no se acumulan/);
 assert.match(diamond.rouletteRewardMessage({reward_type:'roulette_spins',fulfillment_mode:'immediate'}),/giro ya está acreditado/);
 assert.match(diamond.rouletteRewardMessage({reward_type:'oracle_credits',fulfillment_mode:'immediate'}),/Oráculo ya están acreditadas/);
});

test('Extended reward storage preserves metadata, and result labels identify the actual winning roulette',()=>{
 const stored=diamond.diamondRewardStorage('roulette_spins',{roulette_level:4,prize_code:'spin-special'});
 assert.equal(stored.reward_type,'perk');assert.equal(stored.metadata.roulette_level,4);
 assert.equal(diamond.diamondRewardType(stored),'roulette_spins');
 assert.equal(labels.prizeLabel({reward_type:'roulette_spins',reward_value:1,reward_label:'Giro Nivel Especial'}),'Giro Nivel Especial');
 assert.equal(diamond.diamondRewardType(diamond.diamondRewardStorage('oracle_credits',{})),'oracle_credits');
});

test('Roulette summary replaces only Diamond catalogue entries and computes totals without double-counting',async()=>{
 const helper=load('src/lib/server/diamond-roulette.ts');
 const data=await helper.loadRouletteSummary({rpc:async(name)=>({data:name==='cliente_ruleta_resumen_ultra_v1'?{catalogue:[{id:'bronze',nivel:1},{id:'old',nivel:5}],level_1_spins:2,level_4_spins:3,level_5_spins:8,history:['existing']}:{catalogue:[{id:'new',nivel:5}],level_5_spins:1,diamond_access:true}})},client);
 assert.equal(data.available_spins,6);assert.equal(data.next_level,1);assert.equal(data.catalogue.length,2);assert.equal(data.catalogue[1].id,'new');assert.equal(data.history[0],'existing');
 await assert.rejects(helper.loadRouletteSummary({rpc:async()=>({error:new Error('DB_DOWN')})},client),/DB_DOWN/);
});

test('Diamond spin route derives ownership from the authenticated client and never calls the legacy award RPC',async()=>{
 const calls=[];
 const route=load('src/app/api/cliente/ruleta/route.ts',{
  '@/lib/server/ruleta-access':{RouletteAccessError:AccessError,rouletteClient:async()=>({cliente:{id:client},admin:{rpc:async(name,args)=>{calls.push({name,args});return {data:{spin_id:spinId,reward_value:7}};}}})},
  '@/lib/server/diamond-roulette':{loadRouletteSummary:async()=>({catalogue:[],level_5_spins:0})},
 });
 const response=await route.POST(new Request('http://local/api/cliente/ruleta',{method:'POST',body:JSON.stringify({spin_id:spinId,level:5,cliente_id:'forged',reward_value:10000})}));
 assert.equal(response.status,200);assert.equal(calls.length,1);assert.equal(calls[0].name,'tc_diamond_roulette_spin_v1');
 assert.equal(calls[0].args.p_cliente_id,client);assert.equal(calls[0].args.p_spin_id,spinId);assert.equal(Object.keys(calls[0].args).length,2);
 assert.match(response.headers.get('cache-control'),/no-store/);
});

test('A lost post-award summary returns a retryable error without falling back to a second awarding path',async()=>{
 let count=0;
 const route=load('src/app/api/cliente/ruleta/route.ts',{
  '@/lib/server/ruleta-access':{RouletteAccessError:AccessError,rouletteClient:async()=>({cliente:{id:client},admin:{rpc:async()=>{count++;return {data:{spin_id:spinId}};}}})},
  '@/lib/server/diamond-roulette':{loadRouletteSummary:async()=>{throw new Error('NETWORK_INTERRUPTED')}},
 });
 const response=await route.POST(new Request('http://local',{method:'POST',body:JSON.stringify({spin_id:spinId,level:5})}));
 assert.equal(response.status,503);assert.equal(count,1);
});

test('Daily claim route validates identifiers and ignores caller-provided client, amount and date',async()=>{
 const calls=[];
 const route=load('src/app/api/cliente/ruleta/diamond-rewards/route.ts',{
  '@/lib/server/ruleta-access':{RouletteAccessError:AccessError,rouletteClient:async()=>({cliente:{id:client},admin:{rpc:async(name,args)=>{calls.push({name,args});return {data:{minutes:10,duplicate:false}};}}})},
 });
 const bad=await route.POST(new Request('http://local',{method:'POST',body:JSON.stringify({entitlement_id:'invalid'})}));
 assert.equal(bad.status,400);assert.equal(calls.length,0);
 const valid=await route.POST(new Request('http://local',{method:'POST',body:JSON.stringify({entitlement_id:spinId,cliente_id:'forged',minutes:1000,claim_day:'2099-01-01'})}));
 assert.equal(valid.status,200);assert.equal(calls[0].args.p_cliente_id,client);assert.equal(Object.keys(calls[0].args).length,2);
});

test('Unauthenticated access and expired claims never return success',async()=>{
 const denied=load('src/app/api/cliente/ruleta/diamond-rewards/route.ts',{
  '@/lib/server/ruleta-access':{RouletteAccessError:AccessError,rouletteClient:async()=>{throw new AccessError(401,'Sesión requerida')}},
 });
 assert.equal((await denied.GET(new Request('http://local'))).status,401);
 const expired=load('src/app/api/cliente/ruleta/diamond-rewards/route.ts',{
  '@/lib/server/ruleta-access':{RouletteAccessError:AccessError,rouletteClient:async()=>({cliente:{id:client},admin:{rpc:async()=>({error:{message:'BENEFIT_EXPIRED'}})}})},
 });
 const response=await expired.POST(new Request('http://local',{method:'POST',body:JSON.stringify({entitlement_id:spinId})}));
 assert.equal(response.status,409);assert.equal((await response.json()).ok,false);
});

test('Manual prize instructions render all established contact numbers and the durable prize reference',()=>{
 const React=require('react');const renderer=require('react-test-renderer');
 const Component=load('src/components/cliente/DiamondRewardBenefits.tsx',{
  '@/lib/supabase-browser':{supabaseClienteBrowser:()=>({})},
  '@/hooks/useRouletteSignal':{useRouletteSignal:()=>{}},
  '@/lib/leo-celestial-events':{announceLeoCelestial:()=>{}},
  '@/lib/diamond-roulette':diamond,
  '@/lib/client-purchase-maintenance':load('src/lib/client-purchase-maintenance.ts'),
  './DiamondRewardBenefits.module.css':{},
 });
 const tree=renderer.create(React.createElement(Component.DiamondPrizeContact,{reference:spinId}));
 const text=JSON.stringify(tree.toJSON());assert.match(text,/captura de pantalla/);assert.match(text,new RegExp(spinId));
 assert.deepEqual(tree.root.findAllByType('a').map(x=>x.props.href),['tel:+17879450710','tel:+17865394750','tel:+34930502586']);tree.unmount();
});
