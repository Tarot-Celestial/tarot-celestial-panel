const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto');
function load(file, mocks={}, globals={}){const exports={};const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{exports,URL,Buffer,Date,AbortSignal,process:{env:{}},...globals,require:n=> n in mocks?mocks[n]:n==='server-only'?{}:require(n)});return exports;}
function harness(){const h={role:'central',active:true,token:'valid',response:{data:[]},status:200,fetchCalls:[]};const db={auth:{getUser:async token=>({data:{user:token==='valid'?{id:'verified'}:null},error:null})},from:()=>({select:()=>({eq:async()=>({data:[{id:'worker',role:h.role,is_active:h.active}],error:null})})})};h.mod=load('src/lib/server/instagram-graph.ts',{'@/lib/supabase-admin':{supabaseAdmin:()=>db},'@/lib/server/social-connections':{}},{fetch:async(url,init)=>{h.fetchCalls.push({url:String(url),init});if(h.networkError)throw Error('network');return {ok:h.status===200,status:h.status,json:async()=>h.response};}});return h;}
test('verified auth required: fabricated JWT and inactive/client denied',async()=>{const h=harness();for(const token of['','fabricated.jwt.claims'])await assert.rejects(h.mod.instagramIdentity(new Request('https://local.test',{headers:{authorization:`Bearer ${token}`}})),e=>e.status===401);h.active=false;await assert.rejects(h.mod.instagramIdentity(new Request('https://local.test',{headers:{authorization:'Bearer valid'}})),e=>e.status===403);h.active=true;h.role='cliente';await assert.rejects(h.mod.instagramIdentity(new Request('https://local.test',{headers:{authorization:'Bearer valid'}})),e=>e.status===403);});
test('Graph tokens only in authorization header, fixed Meta host',async()=>{const h=harness();await h.mod.instagramGraph({token:'PRIVATE',accountId:'123'},'123/messages');assert.ok(!h.fetchCalls[0].url.includes('PRIVATE'));assert.equal(h.fetchCalls[0].init.headers.Authorization,'Bearer PRIVATE');assert.equal(new URL(h.fetchCalls[0].url).hostname,'graph.instagram.com');});
test('read failures and ambiguous send failures are distinguished',async()=>{const h=harness();h.networkError=true;await assert.rejects(h.mod.instagramGraph({token:'x'},'1'),e=>e.code==='META_UNAVAILABLE');await assert.rejects(h.mod.instagramGraph({token:'x'},'1',{}, {message:{text:'hello'}}),e=>e.code==='SEND_UNCERTAIN');h.networkError=false;h.status=503;h.response={};await assert.rejects(h.mod.instagramGraph({token:'x'},'1',{},{}),e=>e.code==='SEND_UNCERTAIN');});
test('permission errors are actionable and never reflect remote secrets',async()=>{const h=harness();h.status=400;h.response={error:{code:200,message:'sensitive remote details'}};await assert.rejects(h.mod.instagramGraph({token:'x'},'1'),e=>e.code==='META_PERMISSION'&&!e.message.includes('sensitive'));});

test('unavailable conversation and deleted message reads never claim a rejected send',async()=>{const h=harness();h.status=400;h.response={error:{code:100,error_subcode:33,message:'private remote details'}};await assert.rejects(h.mod.instagramGraph({token:'x'},'1'),e=>e.code==='META_OBJECT_UNAVAILABLE'&&!e.message.includes('private'));await assert.rejects(h.mod.instagramGraph({token:'x'},'1',{},{}),e=>e.code==='META_REJECTED');h.response={error:{code:9000001}};await assert.rejects(h.mod.instagramGraph({token:'x'},'1'),e=>e.code==='META_MESSAGE_UNAVAILABLE');});
test('response window rejects invalid, future and expired timestamps',()=>{const {replyWindowOpen}=harness().mod;const now=Date.parse('2026-10-19T12:00:00Z');assert.equal(replyWindowOpen('2026-10-18T12:00:01Z',24,now),true);for(const date of[null,'invalid','2026-10-18T12:00:00Z','2026-10-20T12:00:00Z'])assert.equal(replyWindowOpen(date,24,now),false);});
test('webhook validates raw signature and both Instagram event formats; ignores another account',()=>{const w=load('src/lib/server/instagram-webhook.ts');const body={object:'instagram',entry:[{id:'a',field:'comments',value:{id:'c1'}},{id:'a',changes:[{field:'comments',value:{comment_id:'c1'}},{field:'comments',value:{id:'c2'}}]},{id:'a',messaging:[{message:{mid:'m1'}},{message:{mid:'m2',is_echo:true}}]},{id:'other',field:'comments',value:{id:'foreign'}}]};const raw=JSON.stringify(body),signature='sha256='+crypto.createHmac('sha256','secret').update(raw).digest('hex');assert.equal(w.validInstagramSignature(raw,signature,'secret'),true);assert.equal(w.validInstagramSignature(raw+' ',signature,'secret'),false);assert.equal(w.validInstagramSignature(raw,null,'secret'),false);const events=w.instagramWebhookEvents(body,'a');assert.equal(events.length,4);assert.ok(events.every(e=>e.account_id==='a'));assert.equal(w.instagramWebhookEvents({...body,object:'page'},'a').length,0);});

test('verified webhook aliases route to canonical ledger and reject foreign recipients, echoes and own actors',()=>{const w=load('src/lib/server/instagram-webhook.ts'),canonical='38731579339820579',alias='17841451159294130',foreign='17841499999999999',timestamp=Date.now()-1000;const dm=(mid,sender='222',recipient=alias,echo=false)=>({sender:{id:sender},recipient:{id:recipient},timestamp,message:{mid,text:'fixture',is_echo:echo}});const body={object:'instagram',entry:[{id:alias,time:timestamp/1000,messaging:[dm('valid'),dm('echo','222',alias,true),dm('self',alias),dm('self-canonical',canonical),dm('foreign-recipient','222',foreign)],changes:[{field:'comments',value:{id:'comment',from:{id:'222'},text:'fixture'}},{field:'comments',value:{id:'own-comment',from:{id:alias},text:'fixture'}}]},{id:canonical,messaging:[dm('valid')]},{id:foreign,messaging:[dm('foreign-entry')]}]};assert.equal(w.instagramInboundEvents(body,canonical,'tarotcelestialof').length,0);const incoming=w.instagramInboundEvents(body,canonical,'tarotcelestialof',[alias]);assert.deepEqual(Array.from(incoming,e=>e.remoteId),['valid','comment']);assert.ok(incoming.every(e=>e.senderId==='222'));const ledger=w.instagramWebhookEvents(body,canonical,[alias]);assert.ok(ledger.every(e=>e.account_id===canonical&&e.event_key.startsWith(canonical+':')));assert.ok(!ledger.some(e=>e.remote_id==='foreign-entry'));});
test('connection exposes only validated server metadata aliases without replacing canonical account ID',async()=>{const canonical='38731579339820579',alias='17841451159294130',chain={};chain.select=()=>chain;chain.eq=()=>chain;chain.maybeSingle=async()=>({data:{account_id:canonical,username:'tarotcelestialof',access_token_ciphertext:'encrypted',metadata:{instagram_verified_account_ids:[alias,alias,123,null,'not-an-id','https://foreign']}}});const mod=load('src/lib/server/instagram-graph.ts',{'@/lib/supabase-admin':{supabaseAdmin:()=>({from:()=>chain})},'@/lib/server/social-connections':{decryptSecret:()=> 'PRIVATE'}});const account=await mod.instagramConnection();assert.equal(account.accountId,canonical);assert.deepEqual(Array.from(account.verifiedAccountIds),[alias]);});

test('signed webhook schedules only newly recorded inbound DMs on its verified account',async()=>{
 const canonical='38731579339820579',alias='17841451159294130',foreign='17841499999999999';
 const queued=[], ledger=new Set(), dispatched=[];
 let dbReads=0, failStorage=false, release;
 const blockedWorker=new Promise(resolve=>{release=resolve;});
 const webhook=load('src/lib/server/instagram-webhook.ts');
 const store={select:()=>store,eq:()=>store,maybeSingle:async()=>{
   dbReads++;
   return {data:{account_id:canonical,username:'tarotcelestialof',metadata:{instagram_verified_account_ids:[alias]}}};
 },upsert:(events,options)=>({select:async columns=>{
   assert.equal(options.ignoreDuplicates,true); assert.equal(columns,'kind,remote_id');
   if(failStorage)return {error:{message:'transient'}};
   const inserted=events.filter(event=>!ledger.has(event.event_key));
   for(const event of inserted)ledger.add(event.event_key);
   return {data:inserted};
 }})};
 const mod=load('src/app/api/webhooks/instagram/route.ts',{
   'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},
   '@vercel/functions':{waitUntil:promise=>queued.push(promise)},
   '@/lib/supabase-admin':{supabaseAdmin:()=>({from:()=>store})},
   '@/lib/server/social-connections':{SOCIAL_CONNECTIONS_TABLE:'connections'},
   '@/lib/server/instagram-webhook':webhook,
   '@/lib/server/instagram-sync':{processInstagramWebhook:async(body,account)=>{
     assert.deepEqual(Array.from(account.verifiedAccountIds),[alias]);
     const inbound=webhook.instagramInboundEvents(body,account.accountId,account.username,account.verifiedAccountIds);
     return {messageIds:inbound.filter(e=>e.kind==='message').map(e=>e.remoteId)};
   }},
   '@/lib/server/office-social-worker':{dispatchInstagramWebhookMessages:async(db,account,ids)=>{
     dispatched.push({account,ids:Array.from(ids)}); await blockedWorker; throw Error('background offline');
   }},
 },{Response,process:{env:{INSTAGRAM_APP_SECRET:'fixture-secret',INSTAGRAM_WEBHOOK_VERIFY_TOKEN:'fixture-verify'}},console:{warn:()=>{}}});
 const timestamp=Date.now()-1000;
 const entry=(id,mid,sender='222',echo=false)=>({id,messaging:[{sender:{id:sender},recipient:{id},timestamp,message:{mid,text:'fixture',is_echo:echo}}]});
 const post=(entries,invalid=false)=>{
   const body=JSON.stringify({object:'instagram',metadata:{instagram_verified_account_ids:[foreign]},entry:entries});
   const signature='sha256='+crypto.createHmac('sha256','fixture-secret').update(body).digest('hex');
   return mod.POST(new Request('https://local.test',{method:'POST',body,headers:{'x-hub-signature-256':invalid?'sha256='+'0'.repeat(64):signature}}));
 };
 const challenge=await mod.GET(new Request('https://local.test?hub.mode=subscribe&hub.verify_token=fixture-verify&hub.challenge=test'));
 assert.equal(await challenge.text(),'test');
 assert.equal((await post([entry(alias,'one')],true)).status,401);
 assert.equal(dbReads,0);
 const noise=[entry(foreign,'foreign'),entry(alias,'echo','222',true),entry(alias,'self',canonical)];
 assert.equal((await post(noise)).status,200);
 assert.equal(queued.length,0);
 const batch=[...noise,entry(alias,'one'),entry(canonical,'one')];
 failStorage=true;
 assert.equal((await post(batch)).status,503);
 assert.equal(queued.length,0);
 failStorage=false;
 assert.equal((await post(batch)).status,200);
 assert.deepEqual(dispatched,[{account:canonical,ids:['one']}]);
 assert.equal((await post(batch)).status,200);
 assert.equal(queued.length,1);
 release();
 await queued[0];
});
