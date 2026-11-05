// In-memory contracts only. No network, provider calls or customer balances.
const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), vm=require('node:vm'), ts=require('typescript');
const cache=new Map();
function load(file,mocks={}) {
 const key=file+Object.keys(mocks).join();if(!Object.keys(mocks).length&&cache.has(key))return cache.get(key);
 const exports={};const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const req=name=>name in mocks?mocks[name]:name.startsWith('@/')?load('src/'+name.slice(2)+'.ts'):name.startsWith('./')?load(path.join(path.dirname(file),name+'.ts')):require(name);
 vm.runInNewContext(code,{exports,require:req,Request,Response,URL,Date,console,process:{env:{SUPABASE_SERVICE_ROLE_KEY:'fictional-local-test-secret'}}});if(!Object.keys(mocks).length)cache.set(key,exports);return exports;
}
const tarot=load('src/lib/server/oracle-tarot.ts'),catalog=load('src/lib/oracle-catalog.ts');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
test('78 distinct cards and six complete topic readings without missing content',()=>{
 assert.equal(tarot.TAROT_CARDS.length,78);assert.equal(new Set(tarot.TAROT_CARDS.map(c=>c.id)).size,78);
 for(const c of tarot.TAROT_CARDS)for(const t of catalog.ORACLE_TOPICS){const r=tarot.buildTarotReading(c,t.id);assert.ok(r.message.length>160);assert.ok(r.advice.length>15);assert.doesNotMatch(r.message,/undefined|NaN/);}
});
test('all 21 displayed positions are distinct, independent of pick order, including the former 7 then 0 collision',()=>{
 for(let seed=0;seed<25;seed++)for(const topic of catalog.ORACLE_TOPICS){const params={clientId:id(1),shuffleId:String(seed),topic:topic.id,secret:'fixture'};const picks=Array.from({length:21},(_,i)=>tarot.resolveTarotSpreadCard({...params,position:i,pickIndex:20-i}));assert.equal(new Set(picks.map(c=>c.id)).size,21);assert.notEqual(picks[0].id,picks[7].id);}
});
test('resuming a legacy session never redraws one of its stored cards',()=>{
 const p={clientId:id(1),shuffleId:'old',topic:'amor',secret:'fixture',position:7,pickIndex:0};const first=tarot.resolveTarotSpreadCard(p);const second=tarot.resolveTarotSpreadCard({...p,pickIndex:1,excludedCardIds:[first.id]});assert.notEqual(first.id,second.id);
});
test('followup does not automatically agree with a claim or diagnose health',()=>{
 const p={card:tarot.TAROT_CARDS[0],topic:'general',reading:'Una perspectiva simbólica.'};assert.doesNotMatch(tarot.answerTarotFollowup({...p,question:'¿Puede significar que me engaña?'}),/^Sí/);assert.match(tarot.answerTarotFollowup({...p,question:'¿Estoy embarazada?'}),/no pueden confirmar/);
});
function harness({auth=true,conflict=false}={}){
 const state={conflict,session:{id:id(8),cliente_id:id(1),draw_key:'session-fixture',draw_type:'clarity',shuffle_id:'fixture',cards_json:[],required_cards:3,status:'in_progress',updated_at:'2026-11-01T12:00:00Z'},tables:{cliente_oraculo_diario:[{id:id(2),cliente_id:id(1),card_id:'star',card_name:'La Estrella',draw_type:'free_daily',is_free:true,fecha:'2026-11-01',tema:'amor',created_at:'2026-11-01T12:00:00Z',revealed_at:'2026-11-01T12:00:00Z'},{id:id(3),cliente_id:id(99),card_id:'moon',card_name:'La Luna',created_at:'2026-11-02T12:00:00Z'}],cliente_oraculo_mensajes:[{id:id(5),cliente_id:id(1),draw_id:id(99),fecha:'2026-11-01',tema:'amor',contenido:'OTHER DRAW MUST NOT LEAK'}],cliente_secret_prize_claims:[]}};
 const admin={async rpc(name,args){state.rpcCalls=(state.rpcCalls||[]).concat({name,args});if(name==='tc_oracle_answer_question')return{data:{answer:'Respuesta guardada de la operación'},error:null};throw Error('Unexpected RPC '+name);},from(table){let filters=[],operation='read',values,one=false,limit=Infinity;const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},is(k,v){filters.push(r=>(r[k]??null)===v);return q},not(k,_op,v){filters.push(r=>(r[k]??null)!==v);return q},in(k,vs){filters.push(r=>vs.includes(r[k]));return q},order(){return q},limit(n){limit=n;return q},update(v){operation='update';values=v;return q},insert(v){operation='insert';values=v;return q},single(){one=true;return q},maybeSingle(){one=true;return q},then(resolve,reject){try{const list=table==='cliente_oracle_draw_sessions'?[state.session]:state.tables[table]||[];let rows=list.filter(r=>filters.every(f=>f(r))).slice(0,limit);if(operation==='update'){if(state.conflict)rows=[];else rows.forEach(r=>Object.assign(r,values));}if(operation==='insert'){const row={...values,id:id(40)};list.push(row);rows=[row];}return Promise.resolve({data:one?rows[0]||null:rows,error:null}).then(resolve,reject);}catch(e){return Promise.reject(e).then(resolve,reject)}}};return q;}};
 const route=load('src/app/api/cliente/oraculo/route.ts',{'next/server':{NextResponse:{json:(json,opt)=>new Response(JSON.stringify(json),{status:opt?.status||200})}},'@/lib/server/auth-cliente':{clientFromRequest:async()=>({uid:auth?id(1):null,cliente:auth?{id:id(1)}:null,admin})},'@/lib/server/oracle-premium':{getOracleCreditBalance:async()=>4,ORACLE_PACKS:[]},'@/lib/server/oracle-questions':{getOracleQuestionBalance:async()=>0,ORACLE_QUESTION_PACK:{},consumeOracleQuestion:async()=>({source:'included'})},'@/lib/supabase-admin':{supabaseAdmin:()=>admin},'@/lib/server/brain-observability':{recordBrainIncident:async()=>{},classifyBrainIncident:e=>e}});
 return{state,route,post:body=>route.POST(new Request('http://localhost/api/cliente/oraculo',{method:'POST',body:JSON.stringify(body)}))};
}
test('history and selected draw remain scoped to the authenticated customer',async()=>{const h=harness();const json=await(await h.route.GET(new Request('http://localhost/api/cliente/oraculo?drawId='+id(2)))).json();assert.equal(json.latestDraw.id,id(2));assert.equal(json.history.length,1);assert.equal(json.mensajes.length,0);const foreign=await(await h.route.GET(new Request('http://localhost/api/cliente/oraculo?drawId='+id(3)))).json();assert.equal(foreign.latestDraw,null);assert.equal((await harness({auth:false}).route.GET(new Request('http://localhost/api/cliente/oraculo'))).status,401);});
test('premium picks persist distinct cards; duplicate position and stale writes are rejected',async()=>{const h=harness();const a=await(await h.post({action:'premium_pick',drawKey:'session-fixture',position:7})).json();assert.equal(a.ok,true);assert.equal(h.state.session.cards_json.length,1);const b=await(await h.post({action:'premium_pick',drawKey:'session-fixture',position:0})).json();assert.equal(b.ok,true);assert.notEqual(a.card.cardId,b.card.cardId);assert.equal((await h.post({action:'premium_pick',drawKey:'session-fixture',position:0})).status,409);assert.equal((await harness({conflict:true}).post({action:'premium_pick',drawKey:'session-fixture',position:3})).status,409);});
test('new ten-card and family spreads coexist with every legacy saved spread',()=>{for(const key of ['daily','yes_no','choice','love','relationships','question','monthly'])assert.ok(catalog.ORACLE_SPREAD_BY_ID[key]);assert.equal(catalog.ORACLE_SPREAD_BY_ID.celtic.positions.length,10);assert.equal(catalog.ORACLE_SPREAD_BY_ID.family.topic,'familia');});

test('all topics share one rolling 24-hour free draw even with purchased credit', async t => {
  const lastFree = '2026-11-01T12:00:00.000Z';
  const boundary = Date.parse(lastFree) + 24 * 60 * 60 * 1000;
  t.mock.timers.enable({ apis: ['Date'], now: boundary - 1 });
  const h = harness();
  const draws = h.state.tables.cliente_oraculo_diario;
  const later = '2026-11-02T09:00:00.000Z';
  draws.push(
    { id: id(51), cliente_id: id(1), is_free: false, card_id: 'sun', tema: 'dinero', created_at: later, revealed_at: later },
    { id: id(52), cliente_id: id(99), is_free: true, card_id: 'moon', tema: 'familia', created_at: later, revealed_at: later }
  );
  const initialCount = draws.length;
  const initial = await (await h.route.GET(new Request('http://localhost/api/cliente/oraculo'))).json();
  assert.equal(initial.freeAvailable, false);
  assert.equal(initial.premiumCredits, 4);
  assert.equal(initial.totalAvailable, 4);

  for (const { id: tema } of catalog.ORACLE_TOPICS) {
    for (const action of ['shuffle', 'reveal']) {
      const response = await h.post({ action, tema, position: 8, shuffleId: 'previous-tab' });
      const body = await response.json();
      assert.equal(response.status, 409, action + ' / ' + tema);
      assert.equal(body.error, 'FREE_DRAW_RECHARGING');
      assert.equal(body.freeState.lastFreeAt, lastFree);
      assert.equal(body.freeState.nextFreeAt, new Date(boundary).toISOString());
      assert.equal(body.freeState.remainingSeconds, 1);
    }
  }
  assert.equal(draws.length, initialCount);

  t.mock.timers.tick(1);
  const shuffle = await h.post({ action: 'shuffle', tema: 'familia' });
  const shuffled = await shuffle.json();
  assert.equal(shuffle.status, 200);
  assert.equal(shuffled.freeAvailable, true);
  assert.ok(shuffled.shuffleId);
  assert.equal(draws.length, initialCount);
  const reveal = await h.post({ action: 'reveal', tema: 'familia', shuffleId: shuffled.shuffleId, position: 8 });
  const revealed = await reveal.json();
  assert.equal(reveal.status, 200);
  assert.equal(revealed.draw.isFree, true);
  assert.equal(revealed.draw.tema, 'familia');
  assert.equal(revealed.draw.revealedAt, new Date(boundary).toISOString());
  assert.equal(revealed.draw.creditConsumed, false);
  assert.equal(revealed.credits, 4);
  assert.equal(draws.length, initialCount + 1);

  const replay = await h.post({ action: 'reveal', tema: 'dinero', shuffleId: shuffled.shuffleId, position: 2 });
  assert.equal(replay.status, 409);
  assert.equal((await replay.json()).error, 'FREE_DRAW_RECHARGING');
  assert.equal(draws.length, initialCount + 1);
  assert.equal(h.state.rpcCalls, undefined, 'the free route never reserves a paid credit');
});

test('question route uses one atomic RPC and returns its saved answer; foreign draws never reach it',async()=>{const h=harness();const result=await(await h.post({action:'question',drawId:id(2),pregunta:'¿Qué significa para mí?'})).json();assert.equal(result.ok,true);assert.equal(result.respuesta,'Respuesta guardada de la operación');assert.equal(h.state.rpcCalls.length,1);assert.equal(h.state.rpcCalls[0].name,'tc_oracle_answer_question');assert.equal(h.state.rpcCalls[0].args.p_cliente_id,id(1));assert.equal(h.state.tables.cliente_oraculo_mensajes.length,1);const foreign=harness();assert.equal((await foreign.post({action:'question',drawId:id(3),pregunta:'Ajena'})).status,409);assert.equal(foreign.state.rpcCalls,undefined);});
