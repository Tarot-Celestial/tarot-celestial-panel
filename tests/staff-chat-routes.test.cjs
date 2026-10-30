const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const plain=value=>JSON.parse(JSON.stringify(value));
const sources=new Map();
function loadSource(file){
 if(!sources.has(file))sources.set(file,ts.transpileModule(fs.readFileSync(path.join(__dirname,'../'+file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
 return sources.get(file);
}
function harness(options={}){
 const tables={
  workers:[
   {id:id(1),user_id:id(201),role:'central',display_name:'Central fixture',is_active:true,state:'offline'},
   {id:id(2),user_id:id(202),role:'tarotista',display_name:'Tarotista fixture',is_active:true,state:'offline'},
   {id:id(3),user_id:id(203),role:'admin',display_name:'Admin fixture',is_active:true,state:'offline'},
   {id:id(4),user_id:id(204),role:'central',display_name:'Other fixture',is_active:true,state:'offline'},
   {id:id(5),user_id:id(205),role:'tarotista',display_name:'Inactive fixture',is_active:false,state:'offline'},
  ],
  chat_threads:[
   {id:id(10),central_worker_id:id(1),tarotist_worker_id:id(2),status:'open',created_at:'2026-10-20T10:00:00Z'},
   {id:id(11),central_worker_id:id(4),tarotist_worker_id:id(5),status:'open',created_at:'2026-10-20T11:00:00Z'},
   {id:id(12),central_worker_id:null,tarotist_worker_id:id(2),status:'open',created_at:'2026-10-20T09:00:00Z'},
  ],
  chat_messages:[
   {id:id(100),thread_id:id(10),sender_worker_id:id(2),sender_display_name:'Tarotista fixture',body:'Fixture message',created_at:'2026-10-20T10:01:00.000Z',client_message_id:'existing-message'},
  ],
  chat_thread_reads:[],
  attendance_panel_sessions:[],
  attendance_state:[],
  staff_chat_attachments:[],
 };
 const calls=[],writes=[],authCalls=[],connectionCalls=[];
 class Query {
  constructor(table){this.table=table;this.filters=[];this.orders=[];this.cap=Infinity;this.action='select';}
  select(){return this;}
  eq(k,v){this.filters.push(r=>r[k]===v);return this;}
  is(k,v){return this.eq(k,v);}
  in(k,values){this.filters.push(r=>values.includes(r[k]));return this;}
  lt(k,v){this.filters.push(r=>r[k]<v);return this;}
  or(value){const conditions=value.split(',').map(v=>v.split('.eq.'));this.filters.push(r=>conditions.some(([k,v])=>r[k]===v));return this;}
  order(k,o={}){this.orders.push([k,o.ascending!==false]);return this;}
  limit(n){this.cap=n;return this;}
  insert(value){this.action='insert';this.value=value;return this;}
  update(value){this.action='update';this.value=value;return this;}
  upsert(value){this.action='upsert';this.value=value;return this;}
  async run(single=false){
   calls.push({table:this.table,action:this.action});
   if(options.failTable===this.table)return {data:null,error:{message:'synthetic unavailable'}};
   let rows=(tables[this.table]||[]).filter(r=>this.filters.every(f=>f(r)));
   if(this.action==='insert'){
    if(options.duplicateMessage&&this.table==='chat_messages')return {data:null,error:{code:'23505'}};
    const row={id:id(900),created_at:'2026-10-20T12:00:00Z',...this.value};tables[this.table].push(row);rows=[row];writes.push({table:this.table,action:this.action,value:this.value});
   }else if(this.action==='update'){
    for(const row of rows)Object.assign(row,this.value);writes.push({table:this.table,action:this.action,value:this.value});
   }else if(this.action==='upsert'){
    writes.push({table:this.table,action:this.action,value:this.value});rows=[this.value];
   }
   for(const [key,ascending] of [...this.orders].reverse())rows.sort((a,b)=>(String(a[key]??'').localeCompare(String(b[key]??'')))*(ascending?1:-1));
   rows=rows.slice(0,this.cap);
   return {data:single?rows[0]??null:rows,error:null};
  }
  maybeSingle(){return this.run(true);}
  single(){return this.run(true);}
  then(resolve,reject){return this.run().then(resolve,reject);}
 }
 const db={
  auth:{getUser:async token=>{authCalls.push(token);return options.authError?{data:{user:null},error:options.authError}:options.invalidAuth?{data:{user:null},error:{message:'bad signature'}}:{data:{user:{id:id(200+(options.actor??1))}},error:null};}},
  from:table=>new Query(table),
  rpc:async(name,args)=>{
   calls.push({rpc:name,args});
   if(name==='staff_chat_unread_counts')return {data:options.unreadRows??[{thread_id:id(10),unread_count:72}],error:null};
   if(name==='staff_chat_latest_incoming')return {data:[{id:id(100),thread_id:id(10),sender_worker_id:id(2),sender_display_name:'Tarotista fixture',text:'Fixture message',created_at:'2026-10-20T10:01:00.000Z'}],error:null};
   if(name==='staff_chat_mark_read'){if(options.readError)return {data:null,error:{message:options.readError}};writes.push({rpc:name,args});return {data:'2026-10-20T10:01:00+00:00',error:null};}
   throw new Error('UNEXPECTED_RPC');
  }
 };
 const dependencies={
  '@/lib/supabase-admin':{supabaseAdmin:()=>db},
  '@/lib/server/panel-attendance':{requireActivePanelSession:async(_db,worker)=>{connectionCalls.push(worker);return options.connected===false?{ok:false,status:423,error:'PANEL_CONNECTION_REQUIRED'}:{ok:true};}},
  'next/server':{NextResponse:{json:(data,init={})=>new Response(JSON.stringify(data),{...init,headers:{'Content-Type':'application/json',...(init.headers||{})}})}},
 };
 function load(file){const exports={};vm.runInNewContext(loadSource(file),{exports,require:name=>{if(!(name in dependencies))throw Error('Unexpected dependency '+name);return dependencies[name];},URL,Request,Response,Headers,Date,crypto,console,Buffer,Uint8Array});return exports;}
 dependencies['@/lib/server/staff-chat']=load('src/lib/server/staff-chat.ts');
 dependencies['@/lib/server/staff-chat-media']=load('src/lib/server/staff-chat-media.ts');
 const messages=load('src/app/api/chat/messages/route.ts'),threads=load('src/app/api/chat/threads/route.ts');
 dependencies['@/app/api/chat/messages/route']=messages;
 dependencies['@/app/api/chat/threads/route']=threads;
 return {tables,calls,writes,authCalls,connectionCalls,helper:dependencies['@/lib/server/staff-chat'],messages,threads,read:load('src/app/api/chat/read/route.ts'),legacy:{messages:load('src/app/api/central/chat/messages/route.ts'),threads:load('src/app/api/central/chat/threads/route.ts'),send:load('src/app/api/central/chat/send/route.ts'),open:load('src/app/api/central/chat/open/route.ts')}};
}
function req(url,body,authorization='Bearer signed-fixture-token'){return new Request('https://panel.test'+url,{method:body===undefined?'GET':'POST',headers:authorization?{authorization,'content-type':'application/json'}:{},...(body===undefined?{}:{body:JSON.stringify(body)})});}

test('overview uses live panel sessions instead of stale worker heartbeat and never renews them',async()=>{
 const h=harness();const future=new Date(Date.now()+600000).toISOString();
 h.tables.workers.find(w=>w.id===id(2)).state='offline';
 h.tables.attendance_panel_sessions.push({worker_id:id(2),ended_at:null,expires_at:future});
 let body=await (await h.threads.GET(req('/api/chat/threads'))).json();
 assert.equal(body.contacts[0].state,'online');assert.equal(body.threads[0].contact.state,'online');assert.equal(body.contacts[0].presence_expires_at,future);
 assert.ok(Date.parse(body.presence_checked_at));assert.equal(h.writes.length,0);assert.equal(h.connectionCalls.length,0);
 h.tables.workers.find(w=>w.id===id(2)).state='online';
 h.tables.attendance_panel_sessions[0].expires_at=new Date(Date.now()-1).toISOString();
 body=await (await h.threads.GET(req('/api/chat/threads'))).json();assert.equal(body.contacts[0].state,'offline');
 h.tables.attendance_state.push({worker_id:id(2),status:'bathroom'});
 body=await (await h.threads.GET(req('/api/chat/threads'))).json();assert.equal(body.contacts[0].state,'break');
 h.tables.attendance_panel_sessions[0]={worker_id:id(2),ended_at:new Date().toISOString(),expires_at:future};
 h.tables.attendance_state[0].status='offline';
 body=await (await h.threads.GET(req('/api/chat/threads'))).json();assert.equal(body.contacts[0].state,'offline','closed sessions are never online');
});

test('presence read failure fails overview instead of publishing a false offline snapshot',async()=>{
 const h=harness({failTable:'attendance_panel_sessions'}),r=await h.threads.GET(req('/api/chat/threads'));
 assert.equal(r.status,500);assert.equal((await r.json()).error,'CHAT_ERROR');assert.equal(h.writes.length,0);
});

test('Auth service retryable errors return 503 without pretending token rejection or querying private chat',async()=>{
 for(const authError of [{name:'AuthRetryableFetchError',status:0},{name:'AuthApiError',status:503},{name:'AuthApiError',status:429}]){
  const h=harness({authError}),r=await h.threads.GET(req('/api/chat/threads'));
  assert.equal(r.status,503);assert.equal((await r.json()).error,'CHAT_UNAVAILABLE');assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);
 }
});
test('verified getUser is required: absent and invalid bearer never query chat',async()=>{
 for(const [authorization,invalidAuth] of [[null,false],['Bearer forged-token',true]]){
  const h=harness({invalidAuth}),r=await h.threads.GET(req('/api/chat/threads',undefined,authorization));
  assert.equal(r.status,401);assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);
  assert.equal(h.authCalls.length,authorization?1:0);
 }
});
test('inactive workers cannot read overview even with a verified auth user',async()=>{
 const h=harness({actor:5}),r=await h.threads.GET(req('/api/chat/threads'));
 assert.equal(r.status,403);assert.equal((await r.json()).error,'NO_WORKER');assert.equal(h.writes.length,0);
});
test('offline overview returns exact count and batched latest incoming without acknowledgement',async()=>{
 const h=harness({connected:false}),r=await h.threads.GET(req('/api/chat/threads')),body=await r.json();
 assert.equal(r.status,200);assert.equal(body.unread_total,72);assert.equal(body.threads.length,1);
 assert.equal(body.threads[0].latest_incoming.id,id(100));assert.equal(body.threads[0].latest_incoming.text,'Fixture message');
 assert.equal(h.connectionCalls.length,0);assert.equal(h.writes.length,0);
 assert.deepEqual(h.calls.filter(c=>c.rpc).map(c=>c.rpc).sort(),['staff_chat_latest_incoming','staff_chat_unread_counts']);
 assert.deepEqual(plain(h.calls.find(c=>c.rpc==='staff_chat_unread_counts').args.p_thread_ids),[id(10)]);
});
test('hidden fetch, repeated poll and history fetch never write a read receipt',async()=>{
 const h=harness({connected:false});
 for(const suffix of ['', '', '&before=2026-10-21T10%3A00%3A00.123456%2B00%3A00']){
  const r=await h.messages.GET(req('/api/chat/messages?thread_id='+id(10)+suffix));
  assert.equal(r.status,200);
 }
 assert.equal(h.writes.length,0);assert.equal(h.connectionCalls.length,0);assert.equal(h.calls.filter(c=>c.rpc).length,0);
});
test('message GET rejects invalid limit, malformed/calendar timestamp, and UUID with 400',async()=>{
 const h=harness();
 for(const q of ['limit=oops','limit=NaN','limit=1.5','limit=0','limit=Infinity','before=bad','before=2026-02-30T10:00:00Z','before=2026-10-20T25:00:00Z','before=','limit=9007199254740993']){
  const r=await h.messages.GET(req('/api/chat/messages?thread_id='+id(10)+'&'+q));assert.equal(r.status,400,q);
 }
 assert.equal((await h.messages.GET(req('/api/chat/messages?thread_id=bad'))).status,400);
 assert.equal(h.writes.length,0);
});
test('cross-thread participant access is denied and admin supervision remains available',async()=>{
 const central=harness();
 assert.equal((await central.messages.GET(req('/api/chat/messages?thread_id='+id(11)))).status,403);
 const admin=harness({actor:3});
 assert.equal((await admin.messages.GET(req('/api/chat/messages?thread_id='+id(11)))).status,200);
 const tarotista=harness({actor:2});
 const body=await (await tarotista.threads.GET(req('/api/chat/threads'))).json();
 assert.equal(body.threads.length,2);assert.equal(body.threads.find(t=>t.id===id(12)).legacy,true);
});
test('sending, opening a thread and ACK require a connected panel',async()=>{
 const h=harness({connected:false});
 assert.equal((await h.messages.POST(req('/api/chat/messages',{thread_id:id(10),text:'Fixture'}))).status,423);
 assert.equal((await h.threads.POST(req('/api/chat/threads',{contact_worker_id:id(2)}))).status,423);
 assert.equal((await h.read.POST(req('/api/chat/read',{thread_id:id(10),through_message_id:id(100)}))).status,423);
 assert.equal(h.writes.length,0);assert.equal(h.calls.filter(c=>c.rpc).length,0);
});
test('ACK passes only verified actor and saved message ID, ignoring forged worker/timestamp',async()=>{
 const h=harness(),r=await h.read.POST(req('/api/chat/read',{thread_id:id(10),through_message_id:id(100),worker_id:id(4),last_read_at:'2099-01-01T00:00:00Z'}));
 assert.equal(r.status,200);assert.equal((await r.json()).last_read_at,'2026-10-20T10:01:00+00:00');
 assert.deepEqual(plain(h.calls.find(c=>c.rpc==='staff_chat_mark_read').args),{p_worker_id:id(1),p_thread_id:id(10),p_through_message_id:id(100)});
 assert.equal(h.connectionCalls.length,1);
});
test('ACK rejects missing/bad identity and maps wrong-thread message from RPC safely',async()=>{
 for(const [body,expected] of [[{thread_id:id(10)},400],[{thread_id:id(10),through_message_id:'bad'},400],[{thread_id:id(11),through_message_id:id(100)},403]]){
  const h=harness(),r=await h.read.POST(req('/api/chat/read',body));assert.equal(r.status,expected);assert.equal(h.writes.length,0);
 }
 const h=harness({readError:'MESSAGE_NOT_FOUND'}),r=await h.read.POST(req('/api/chat/read',{thread_id:id(10),through_message_id:id(103)}));assert.equal(r.status,404);assert.equal(h.writes.length,0);
 const failed=harness({readError:'private database error secret'}),bad=await failed.read.POST(req('/api/chat/read',{thread_id:id(10),through_message_id:id(100)}));
 assert.equal(bad.status,500);assert.equal((await bad.json()).error,'CHAT_ERROR');
});
test('connected send is scoped to verified actor and does not mark incoming read',async()=>{
 const h=harness(),r=await h.messages.POST(req('/api/chat/messages',{thread_id:id(10),text:'New fixture',sender_worker_id:id(4),client_message_id:'new-message'}));
 assert.equal(r.status,201);const message=(await r.json()).message;assert.equal(message.sender_worker_id,id(1));
 assert.equal(h.writes.filter(w=>w.table==='chat_thread_reads'||w.rpc).length,0);
});
test('message idempotency cannot recover a message from a different thread/body',async()=>{
 const h=harness({duplicateMessage:true});
 h.tables.chat_messages[0].sender_worker_id=id(1);
 const mismatch=await h.messages.POST(req('/api/chat/messages',{thread_id:id(10),text:'Different fixture',client_message_id:'existing-message'}));
 assert.equal(mismatch.status,409);assert.equal((await mismatch.json()).error,'MESSAGE_ID_CONFLICT');
 h.tables.chat_messages[0].thread_id=id(11);
 const crossThread=await h.messages.POST(req('/api/chat/messages',{thread_id:id(10),text:'Fixture message',client_message_id:'existing-message'}));
 assert.equal(crossThread.status,409);assert.equal(h.writes.length,0);
});
test('central-tarotista contact model and admin create restriction remain unchanged',async()=>{
 const h=harness();
 assert.equal((await h.threads.POST(req('/api/chat/threads',{contact_worker_id:id(4)}))).status,400);
 assert.equal((await h.threads.POST(req('/api/chat/threads',{contact_worker_id:id(2)}))).status,200);
 const admin=harness({actor:3});assert.equal((await admin.threads.POST(req('/api/chat/threads',{contact_worker_id:id(2)}))).status,403);
});

test('legacy endpoints enforce verified auth and private-thread ownership',async()=>{
 const invalid=harness({invalidAuth:true});
 assert.equal((await invalid.legacy.open.POST(req('/api/central/chat/open',{tarotist_worker_id:id(2)}))).status,401);
 const h=harness();
 assert.equal((await h.legacy.messages.GET(req('/api/central/chat/messages?thread_id='+id(11)))).status,403);
 assert.equal((await h.legacy.send.POST(req('/api/central/chat/send',{thread_id:id(11),text:'Fixture'}))).status,403);
 assert.equal(h.writes.length,0);
 const tarotista=harness({actor:2});
 assert.equal((await tarotista.legacy.threads.GET(req('/api/central/chat/threads'))).status,403);
});

test('legacy writes require connected panel; a legacy read has no acknowledgement side effect',async()=>{
 const h=harness({connected:false});
 assert.equal((await h.legacy.send.POST(req('/api/central/chat/send',{thread_id:id(10),text:'Fixture'}))).status,423);
 assert.equal((await h.legacy.open.POST(req('/api/central/chat/open',{tarotist_worker_id:id(2)}))).status,423);
 assert.equal((await h.legacy.messages.GET(req('/api/central/chat/messages?thread_id='+id(10)))).status,200);
 assert.equal(h.writes.length,0);
});

test('legacy inbox retains field names, exact counts and shared contact scoping',async()=>{
 const h=harness();h.tables.chat_threads[0].last_message_preview='Fixture preview';
 const overview=await (await h.legacy.threads.GET(req('/api/central/chat/threads'))).json();
 assert.equal(overview.threads.length,1);assert.equal(overview.threads[0].unread_count,72);
 assert.equal(overview.threads[0].tarotist_display_name,'Tarotista fixture');assert.equal(overview.threads[0].last_message_text,'Fixture preview');
 const opened=await (await h.legacy.open.POST(req('/api/central/chat/open',{tarotist_worker_id:id(2)}))).json();
 assert.equal(opened.thread.id,id(10));assert.equal(opened.thread.central_worker_id,id(1));
 const admin=harness({actor:3});assert.equal((await admin.legacy.messages.GET(req('/api/central/chat/messages?thread_id='+id(11)))).status,200);
});
