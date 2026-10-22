const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {PGlite}=require('@electric-sql/pglite');
let db;
test.before(async()=>{
 db=new PGlite();await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261022201314_whatsapp_local_gateway_bridge.sql'),'utf8'));
});
test.after(async()=>db?.close());
const id='00000000-0000-4000-8000-000000000001';
test('bridge requires a fresh local heartbeat and browser roles cannot read commands',async()=>{
 let r=await db.query("select tc_whatsapp_bridge_enqueue($1,'GET','/sessions/central/status',null) as ok",[id]);assert.equal(r.rows[0].ok,false);
 const rights=await db.query("select has_table_privilege('authenticated','whatsapp_bridge_commands','SELECT') as can_read,has_function_privilege('anon','tc_whatsapp_bridge_exchange(jsonb)','EXECUTE') as can_call");
 assert.deepEqual(rights.rows[0],{can_read:false,can_call:false});
 await db.query("select tc_whatsapp_bridge_exchange('[]')");
 r=await db.query("select tc_whatsapp_bridge_enqueue($1,'GET','/sessions/central/status',null) as ok",[id]);assert.equal(r.rows[0].ok,true);
});
test('each command is claimed once, receipts survive retry and payloads expire',async()=>{
 const take=()=>db.query("select tc_whatsapp_bridge_exchange('[]') as v");
 const both=await Promise.all([take(),take()]);assert.equal(both.flatMap(x=>x.rows[0].v.commands).length,1);
 const result=JSON.stringify([{id,status:200,json:{ok:true,state:'qr',qr:'fixture-private-qr'}}]);
 await db.query('select tc_whatsapp_bridge_exchange($1)',[result]);await db.query('select tc_whatsapp_bridge_exchange($1)',[result]);
 let r=await db.query('select state,result from whatsapp_bridge_commands where id=$1',[id]);assert.equal(r.rows[0].state,'completed');assert.equal(r.rows[0].result.qr,'fixture-private-qr');
 await db.exec("update whatsapp_bridge_commands set expires_at=now()-interval '1 second'");await take();
 r=await db.query('select count(*)::int as n from whatsapp_bridge_commands');assert.equal(r.rows[0].n,0);
});
test('local worker rejects arbitrary URLs and unsafe paths before any request',async()=>{
 const {allowedCommand,executeCommand}=await import(pathToFileURL(path.join(__dirname,'../whatsapp-gateway/bridge-worker.mjs')).href);
 for(const command of [{method:'GET',path:'https://evil.invalid/'},{method:'GET',path:'/sessions/central/../../secrets'},{method:'POST',path:'/sessions/central/captacion/../logout'},{method:'DELETE',path:'/sessions/central/status'}])assert.equal(allowedCommand({id,...command}),false);
 assert.equal(allowedCommand({id,method:'GET',path:'/sessions/central/chats/17875550123%40s.whatsapp.net/messages?limit=120'}),true);
 for(const badId of ['a'.repeat(36),'-'.repeat(36),'000000000000400080000000000000000001'])assert.equal(allowedCommand({id:badId,method:'GET',path:'/sessions/central/status'}),false);
 assert.equal(allowedCommand({id,method:'GET',path:'/sessions/central/captacion/'+('a'.repeat(36))}),false);
 assert.equal(allowedCommand({id,method:'GET',path:'/sessions/central/captacion/'+id}),true);
 let calls=0;const r=await executeCommand({id,method:'POST',path:'/arbitrary',expires_at:new Date(Date.now()+10000).toISOString()},{localOrigin:'http://127.0.0.1:8787',secret:'fixture',fetcher:()=>{calls++;}});assert.equal(calls,0);assert.equal(r.status,400);
 for(const expires_at of [undefined,null,'not-a-date',new Date(Date.now()-1000).toISOString()]){
  const invalid=await executeCommand({id,method:'GET',path:'/sessions/central/status',expires_at},{localOrigin:'http://127.0.0.1:8787',secret:'fixture',fetcher:()=>{calls++;}});
  assert.equal(invalid.status,400);assert.equal(invalid.json.error,'INVALID_COMMAND');
 }
 assert.equal(calls,0);
});
test('local transport posts once and returns uncertainty rather than retrying a send',async()=>{
 const {executeCommand}=await import(pathToFileURL(path.join(__dirname,'../whatsapp-gateway/bridge-worker.mjs')).href);
 let calls=0;const command={id,method:'POST',path:'/sessions/central/captacion',payload:{operationId:id},expires_at:new Date(Date.now()+10000).toISOString()};
 const result=await executeCommand(command,{localOrigin:'http://127.0.0.1:8787',secret:'fixture',fetcher:async(url,options)=>{calls++;assert.equal(url,'http://127.0.0.1:8787/sessions/central/captacion');assert.equal(options.headers.Authorization,'Bearer fixture');assert.equal(options.redirect,'error');throw new Error('timeout');}});
 assert.equal(calls,1);assert.equal(result.status,502);assert.equal(result.json.error,'LOCAL_GATEWAY_UNAVAILABLE');
});

test('oversized multibyte results fit the real SQL exchange, survive transport retry and allow later commands',async()=>{
 const {runBridge}=await import(pathToFileURL(path.join(__dirname,'../whatsapp-gateway/bridge-worker.mjs')).href);
 const commandIds=Array.from({length:4},(_,index)=>`00000000-0000-4000-8000-${String(index+11).padStart(12,'0')}`);
 const nextId='00000000-0000-4000-8000-000000000015';
 await db.query("select tc_whatsapp_bridge_exchange('[]')");
 for(const commandId of commandIds)await db.query("select tc_whatsapp_bridge_enqueue($1,'POST','/sessions/central/captacion',$2)",[commandId,JSON.stringify({operationId:commandId})]);
 const huge={ok:true,privateText:'✨'.repeat(190000)};
 assert.ok(Buffer.byteLength(JSON.stringify({results:commandIds.map(id=>({id,status:200,json:huge}))}))>2097152);
 const shutdown=new AbortController(),localCalls=new Map(),posted=[];
 let remoteCalls=0;
 await runBridge({origin:'https://clientestarotcelestial.es',secret:'test-only-secret-'.repeat(3),signal:shutdown.signal,wait:async()=>{},fetcher:async(url,options)=>{
  assert.equal(options.redirect,'error','both local and remote requests must reject redirects');
  if(url.startsWith('http://127.0.0.1:8787/')){
   const key=options.method==='POST'?JSON.parse(options.body).operationId:'status';
   localCalls.set(key,(localCalls.get(key)||0)+1);
   return {status:200,json:async()=>options.method==='POST'?huge:{ok:true,state:'connected'}};
  }
  assert.equal(url,'https://clientestarotcelestial.es/api/internal/whatsapp-bridge');
  remoteCalls++;posted.push(options.body);
  assert.ok(Buffer.byteLength(options.body)<=1900*1024,'entire serialized request remains below the server limit');
  if(remoteCalls===2)throw new Error('Connection dropped before the server accepted results');
  if(remoteCalls>5){shutdown.abort();throw new Error('Unexpected extra exchange');}
  const body=JSON.parse(options.body);
  const exchanged=await db.query('select tc_whatsapp_bridge_exchange($1) as v',[JSON.stringify(body.results)]);
  if(remoteCalls===3)await db.query("select tc_whatsapp_bridge_enqueue($1,'GET','/sessions/central/status',null)",[nextId]);
  if(remoteCalls===5)shutdown.abort();
  return {ok:true,json:async()=>({ok:true,commands:exchanged.rows[0].v.commands})};
 }});
 assert.equal(remoteCalls,5);assert.equal(posted[1],posted[2],'retry only acknowledges the same bounded results');
 for(const commandId of commandIds)assert.equal(localCalls.get(commandId),1,'an oversized response never repeats a send');
 assert.equal(localCalls.get('status'),1,'a later read still reaches the local connector');
 const results=await db.query('select id,state,response_status,result from whatsapp_bridge_commands where id=any($1::uuid[])',[commandIds]);
 assert.equal(results.rows.length,4);
 for(const row of results.rows){assert.equal(row.state,'completed');assert.equal(row.response_status,502);assert.deepEqual(row.result,{ok:false,error:'LOCAL_GATEWAY_RESPONSE_TOO_LARGE'});}
 const later=await db.query('select state,result from whatsapp_bridge_commands where id=$1',[nextId]);
 assert.equal(later.rows[0].state,'completed');assert.equal(later.rows[0].result.state,'connected');
 await db.query('delete from whatsapp_bridge_commands where id=any($1::uuid[])',[[...commandIds,nextId]]);
});
