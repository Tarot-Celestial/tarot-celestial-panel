const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../src/components/cliente/LeoCelestialGuide.tsx'),'utf8');
const facts=coins=>({coins,minutes:20,oracleCredits:1,activePromotion:null});
function fixture(){
 const state={data:{wallet:facts(1620)},answer:{id:'welcome',message:'Ahora tienes 1620 Coins.'},reaction:{id:'welcome',message:'Ahora tienes 1620 Coins.'},refreshes:0};
 const scope={useCallback:fn=>fn,userRef:{current:'client'},walletFactsRef:{current:facts(1620)},walletFactsAtRef:{current:0},
  setAnswer:value=>state.answer=value,setReaction:value=>state.reaction=value,setData:fn=>state.data=fn(state.data),wake(){},Date,
  setExpanded(){},focusReturn:{current:null},document:{activeElement:null},setOpen(){},setMemoryOpen(){},reaction:null,focusTimer:{current:null},panelRef:{current:null},setTimeout:()=>1,clearTimeout(){},refresh:()=>{state.refreshes++;return Promise.resolve();}};
 vm.createContext(scope);
 const apply=source.slice(source.indexOf('  const applyLeo ='),source.indexOf('  const signal ='));
 const show=source.slice(source.indexOf('  function show()'),source.indexOf('  function go('));
 vm.runInContext(ts.transpileModule(apply+show+'\nglobalThis.apply=applyLeo;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope);
 return{state,scope};
}
test('Atlas drops a stale 1620-Coin greeting or answer once the server confirms 420',()=>{
 const f=fixture();f.scope.apply({facts:facts(420)},'client');
 assert.equal(f.state.data.wallet.coins,420);assert.equal(f.state.answer,null);assert.equal(f.state.reaction,null);
});
test('unchanged balances keep the conversation and another account cannot replace facts',()=>{
 const f=fixture();f.scope.apply({facts:facts(1620)},'client');assert.match(f.state.answer.message,/1620/);
 f.scope.apply({facts:facts(999)},'different-client');assert.equal(f.state.data.wallet.coins,1620);
});
test('opening Atlas refreshes facts instead of relying only on an old greeting',()=>{
 const f=fixture();f.scope.show();assert.equal(f.state.refreshes,1);
});
test('an older or unversioned response cannot restore 1620 after Atlas confirmed 420',()=>{
 const f=fixture();f.scope.apply({facts:facts(420),facts_refreshed_at:'2026-11-05T21:57:00Z'},'client');
 for(const stamp of ['2026-11-05T21:13:00Z',null]){
  f.scope.apply({facts:facts(1620),facts_refreshed_at:stamp},'client');assert.equal(f.state.data.wallet.coins,420);
 }
 assert.equal(f.state.data.updatedAt,Date.parse('2026-11-05T21:57:00Z'));
});
test('newer canonical facts may reflect new grants without freezing the wallet',()=>{
 const f=fixture();f.scope.apply({facts:facts(420),facts_refreshed_at:'2026-11-05T21:57:00Z'},'client');
 f.scope.apply({facts:facts(1420),facts_refreshed_at:'2026-11-05T21:59:00Z'},'client');assert.equal(f.state.data.wallet.coins,1420);
});
test('chat accepts a current answer but not a delayed answer or a historical retry with an old balance',async()=>{
 for(const result of [
  {answer_refreshed_at:'2026-11-05T21:13:00Z',answer_historical:false},
  {answer_refreshed_at:null,answer_historical:true},
  {answer_refreshed_at:'2026-11-05T21:58:00Z',answer_historical:false,current:true},
 ]){
  const state={answer:null,error:'',refreshes:0};
  const scope={question:'Mis Coins',chatBusy:false,uid:'client',pathname:'/cliente/dashboard',accountEpoch:{current:1},chatEpoch:{current:0},chatRequest:{current:null},walletFactsAtRef:{current:Date.parse('2026-11-05T21:57:00Z')},currentPath:{current:'/cliente/dashboard'},
   setChatBusy(){},setError:v=>state.error=v,setJourney(){},setReaction(){},setTopic(){},setQuestion(){},wake(){},crypto:{randomUUID:()=> 'request'},
   signal:async()=>({...result,answer:{id:'answer',title:'Tu saldo',message:'Tienes 1620 Coins',actions:[],mode:'guided'}}),safeAnswer:v=>v,setAnswer:v=>state.answer=v,refresh:()=>{state.refreshes++;return Promise.resolve();},Date};
  vm.createContext(scope);
  const snippet=source.slice(source.indexOf('  async function ask('),source.indexOf('  async function remember('));
  vm.runInContext(ts.transpileModule(snippet,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope);
  await scope.ask({preventDefault(){}});
  if(result.current){assert.equal(state.answer.id,'answer');assert.equal(state.refreshes,0);assert.equal(state.error,'');}
  else{assert.equal(state.answer,null);assert.equal(state.refreshes,1);assert.match(state.error,/saldo anterior/);}
 }
});

