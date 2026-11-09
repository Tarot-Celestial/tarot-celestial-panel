const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const plain=value=>JSON.parse(JSON.stringify(value));
const sources=new Map();
// Model Postgres timestamp comparison including sub-millisecond precision and
// timezone offsets; string comparison would conceal cursor precision failures.
function comparable(key,value){
 if(key==='created_at'&&value){
  const match=String(value).match(/^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/);
  if(match)return BigInt(Date.parse(match[1]+match[3]))*1000n+BigInt((match[2]||'').padEnd(6,'0'));
 }
 return String(value??'');
}
function compare(key,a,b){const left=comparable(key,a),right=comparable(key,b);return left<right?-1:left>right?1:0;}
function splitFilters(value){
 const parts=[];let start=0,depth=0;
 for(let i=0;i<value.length;i++){if(value[i]==='(')depth++;else if(value[i]===')')depth--;else if(value[i]===','&&depth===0){parts.push(value.slice(start,i));start=i+1;}}
 parts.push(value.slice(start));return parts;
}
function filterExpression(expression){
 const group=expression.match(/^(and|or)\((.*)\)$/);
 if(group){const predicates=splitFilters(group[2]).map(filterExpression);return row=>group[1]==='and'?predicates.every(p=>p(row)):predicates.some(p=>p(row));}
 const match=expression.match(/^(\w+)\.(eq|lt|gt)\.(.*)$/);assert.ok(match,'Unsupported fixture filter: '+expression);
 return row=>{const comparison=compare(match[1],row[match[1]],match[3]);return match[2]==='eq'?comparison===0:match[2]==='lt'?comparison<0:comparison>0;};
}
function loadSource(file){
 if(!sources.has(file))sources.set(file,ts.transpileModule(fs.readFileSync(path.join(__dirname,'../'+file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
 return sources.get(file);
}
function harness(options={}){
 const tables={
  workers:[
   {id:id(1),user_id:id(201),role:'central',display_name:'Central fixture',is_active:true,state:'offline',can_admin:options.delegated===true},
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
  rendimiento_llamadas:[], staff_chat_call_appeals:[],
 };
 const calls=[],writes=[],authCalls=[],connectionCalls=[];
 class Query {
  constructor(table){this.table=table;this.filters=[];this.orders=[];this.cap=Infinity;this.action='select';}
  select(){return this;}
  eq(k,v){this.filters.push(r=>r[k]===v);return this;}
  is(k,v){return this.eq(k,v);}
  in(k,values){this.filters.push(r=>values.includes(r[k]));return this;}
  lt(k,v){this.filters.push(r=>compare(k,r[k],v)<0);return this;}
  gt(k,v){this.filters.push(r=>r[k]>v);return this;}
  or(value){this.rawOr=value;this.filters.push(filterExpression('or('+value+')'));return this;}
  order(k,o={}){this.orders.push([k,o.ascending!==false]);return this;}
  limit(n){this.cap=n;return this;}
  insert(value){this.action='insert';this.value=value;return this;}
  update(value){this.action='update';this.value=value;return this;}
  upsert(value){this.action='upsert';this.value=value;return this;}
  async run(single=false){
   calls.push({table:this.table,action:this.action,or:this.rawOr,order:this.orders});
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
   for(const [key,ascending] of [...this.orders].reverse())rows.sort((a,b)=>compare(key,a[key],b[key])*(ascending?1:-1));
   rows=rows.slice(0,this.cap);
   return {data:single?rows[0]??null:rows,error:null};
  }
  maybeSingle(){return this.run(true);}
  single(){return this.run(true);}
  then(resolve,reject){return this.run().then(resolve,reject);}
 }
 const db={
  auth:{getUser:async token=>{authCalls.push(token);return options.authError?{data:{user:null},error:options.authError}:options.invalidAuth?{data:{user:null},error:{message:'bad signature'}}:{data:{user:{id:id(200+(options.actor??1))}},error:null};}},
  from:table=>options.messageClient&&table==='chat_messages'?options.messageClient.from(table):new Query(table),
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
  '@/lib/server/admin-access':{hasAdminAccess:async(_db,userId)=>tables.workers.some(w=>w.user_id===userId&&w.is_active===true&&(w.role==='admin'||w.can_admin===true))},
  '@/lib/server/panel-attendance':{requireActivePanelSession:async(_db,worker)=>{connectionCalls.push(worker);return options.connected===false?{ok:false,status:423,error:'PANEL_CONNECTION_REQUIRED'}:{ok:true};}},
  'next/server':{NextResponse:{json:(data,init={})=>new Response(JSON.stringify(data),{...init,headers:{'Content-Type':'application/json',...(init.headers||{})}})}},
 };
 function load(file){const exports={};vm.runInNewContext(loadSource(file),{exports,require:name=>{if(!(name in dependencies))throw Error('Unexpected dependency '+name);return dependencies[name];},URL,Request,Response,Headers,Date,crypto,console,Buffer,Uint8Array});return exports;}
 dependencies['@/lib/server/staff-chat']=load('src/lib/server/staff-chat.ts');
 dependencies['@/lib/server/staff-chat-media']=load('src/lib/server/staff-chat-media.ts');
 dependencies['@/lib/activity-codes']=load('src/lib/activity-codes.ts');
 dependencies['@/lib/staff-chat-operations']=load('src/lib/staff-chat-operations.ts');
 dependencies['@/lib/server/staff-chat-operations']=load('src/lib/server/staff-chat-operations.ts');
 const messages=load('src/app/api/chat/messages/route.ts'),threads=load('src/app/api/chat/threads/route.ts');
 dependencies['@/app/api/chat/messages/route']=messages;
 dependencies['@/app/api/chat/threads/route']=threads;
 return {tables,calls,writes,authCalls,connectionCalls,helper:dependencies['@/lib/server/staff-chat'],messages,threads,read:load('src/app/api/chat/read/route.ts'),legacy:{messages:load('src/app/api/central/chat/messages/route.ts'),threads:load('src/app/api/central/chat/threads/route.ts'),send:load('src/app/api/central/chat/send/route.ts'),open:load('src/app/api/central/chat/open/route.ts')}};
}
function req(url,body,authorization='Bearer signed-fixture-token'){return new Request('https://panel.test'+url,{method:body===undefined?'GET':'POST',headers:authorization?{authorization,'content-type':'application/json'}:{},...(body===undefined?{}:{body:JSON.stringify(body)})});}

function historyMessage(n,createdAt='2026-11-08T12:00:00.123456+00:00'){
 return {id:id(1000+n),thread_id:id(10),sender_worker_id:id(2),sender_display_name:'Tarotista fixture',body:'History '+n,created_at:createdAt,client_message_id:'history-'+n};
}
async function historyPage(h,before,extra=''){
 const response=await h.messages.GET(req('/api/chat/messages?thread_id='+id(10)+(before?'&before='+encodeURIComponent(before):'')+extra));
 assert.equal(response.status,200);return response.json();
}

test('history pagination returns every message once across many pages, including identical timestamps',async()=>{
 for(const actor of [1,2,3])for(const tied of [false,true]){
  const h=harness({actor});
  h.tables.chat_messages=Array.from({length:123},(_,n)=>historyMessage(n,tied?undefined:new Date(Date.UTC(2026,10,8,12,0,n)).toISOString()));
  // Deliberately scramble insertion order: timestamp ties must use the ID.
  h.tables.chat_messages.reverse();
  const seen=[],counts=[];let cursor;
  for(let attempt=0;attempt<5;attempt++){
   const page=await historyPage(h,cursor);counts.push(page.messages.length);seen.push(...page.messages.map(m=>m.id));
   for(let i=1;i<page.messages.length;i++){
    const a=page.messages[i-1],b=page.messages[i];assert.ok(compare('created_at',a.created_at,b.created_at)<0||(compare('created_at',a.created_at,b.created_at)===0&&a.id<b.id),'chronological and stable within each page');
   }
   if(!page.has_more){assert.equal(page.next_cursor,null);break;}
   assert.match(page.next_cursor,/^v1\|/);assert.notEqual(page.next_cursor,cursor);cursor=page.next_cursor;
  }
  assert.deepEqual(counts,[40,40,40,3]);assert.equal(new Set(seen).size,123);
  assert.deepEqual([...seen].sort(),h.tables.chat_messages.map(m=>m.id).sort());assert.equal(h.writes.length,0);
 }
});

test('cursor preserves all six fractional digits and walks messages within one millisecond',async()=>{
 const h=harness();
 h.tables.chat_messages=Array.from({length:65},(_,n)=>historyMessage(n,'2026-11-08T12:00:00.'+String(123000+Math.floor(n/3)).padStart(6,'0')+'+00:00'));
 const first=await historyPage(h),boundary=first.messages[0];
 assert.equal(first.next_cursor,'v1|'+boundary.created_at+'|'+boundary.id);
 assert.match(first.next_cursor,/\.123008\+00:00/);
 const second=await historyPage(h,first.next_cursor);
 assert.equal(second.has_more,false);assert.equal(second.messages.length,25);
 assert.equal(new Set([...first.messages,...second.messages].map(m=>m.id)).size,65);
 const sent=h.calls.filter(call=>call.table==='chat_messages').at(-1);
 assert.ok(sent.or.includes(boundary.created_at));assert.deepEqual(plain(sent.order),[['created_at',false],['id',false]]);
});

test('pagination anchor remains usable after deletion and new incoming messages do not shift older pages',async()=>{
 const h=harness();h.tables.chat_messages=Array.from({length:82},(_,n)=>historyMessage(n));
 const first=await historyPage(h),anchorId=first.messages[0].id;
 h.tables.chat_messages=h.tables.chat_messages.filter(m=>m.id!==anchorId);
 h.tables.chat_messages.push(historyMessage(900),historyMessage(901,'2026-11-08T12:00:01.000001Z'));
 const second=await historyPage(h,first.next_cursor),third=await historyPage(h,second.next_cursor);
 assert.deepEqual([first.messages.length,second.messages.length,third.messages.length],[40,40,2]);
 const seen=[...first.messages,...second.messages,...third.messages].map(m=>m.id);
 assert.equal(new Set(seen).size,82);assert.ok(!seen.includes(id(1900)));assert.ok(!seen.includes(id(1901)));
 assert.equal(third.has_more,false);assert.equal(h.writes.length,0);
});

test('legacy timestamp cursors remain valid and return a composite cursor for subsequent pages',async()=>{
 const h=harness();h.tables.chat_messages=Array.from({length:75},(_,n)=>historyMessage(n));
 const first=await historyPage(h,'2026-11-08T13:00:00.123457+01:00');
 assert.equal(first.messages.length,40);assert.match(first.next_cursor,/^v1\|2026-11-08T12:00:00\.123456\+00:00\|/);
 const second=await historyPage(h,first.next_cursor);assert.equal(second.messages.length,35);assert.equal(second.has_more,false);
 assert.equal((await historyPage(h,'2026-11-08T12:00:00.123456Z')).messages.length,0,'legacy timestamp semantics stay strictly earlier');
});

test('composite cursor cannot broaden thread ownership or return another thread through its OR clause',async()=>{
 const h=harness();h.tables.chat_messages=Array.from({length:41},(_,n)=>historyMessage(n));
 h.tables.chat_messages.push({...historyMessage(999,'2020-01-01T00:00:00.000001Z'),thread_id:id(11),body:'Other private thread'});
 const first=await historyPage(h),second=await historyPage(h,first.next_cursor);
 assert.equal(second.messages.length,1);assert.ok(second.messages.every(m=>m.thread_id===id(10)));
 const response=await h.messages.GET(req('/api/chat/messages?thread_id='+id(11)+'&before='+encodeURIComponent(first.next_cursor)));
 assert.equal(response.status,403);assert.equal(h.writes.length,0);
});

test('invalid composite cursors and filter injection are rejected before querying chat messages',async()=>{
 const timestamp='2026-11-08T12:00:00.123456+00:00',messageId=id(1000);
 const invalid=[
  `v2|${timestamp}|${messageId}`,`v1|${timestamp}|`, `v1|${timestamp}|not-a-uuid`,
  `v1|${timestamp}|${messageId}|extra`,`v1|${timestamp}|${messageId},thread_id.neq.null`,
  `v1|${timestamp}|${messageId}\n`,`v1|${timestamp}|${messageId}\r\n`,
  `v1|${timestamp}),id.neq.null|${messageId}`,`v1|${timestamp}\n|${messageId}`,
  `v1|2026-02-29T12:00:00Z|${messageId}`,`v1|2026-11-08T12:00:00.1234567Z|${messageId}`,
  `v1|2026-11-08T12:00:00+16:00|${messageId}`,`v1|${timestamp}|${'a'.repeat(200)}`,
  `${timestamp},id.neq.null`,`${timestamp}\0`, `v1|${timestamp}|${messageId}%2Cthread_id.neq.null`,
 ];
 for(const cursor of invalid){
  const h=harness(),response=await h.messages.GET(req('/api/chat/messages?thread_id='+id(10)+'&before='+encodeURIComponent(cursor)));
  assert.equal(response.status,400,cursor);assert.equal((await response.json()).error,'INVALID_CURSOR');
  assert.equal(h.calls.filter(call=>call.table==='chat_messages').length,0);assert.equal(h.writes.length,0);
 }
});

test('empty and exactly full final pages stop pagination, while limit clamps remain unchanged',async()=>{
 for(const [count,limit,expected,more] of [[0,40,0,false],[40,40,40,false],[10,1,10,false],[51,999,50,true]]){
  const h=harness();h.tables.chat_messages=Array.from({length:count},(_,n)=>historyMessage(n));
  const page=await historyPage(h,null,'&limit='+limit);
  assert.equal(page.messages.length,expected);assert.equal(page.has_more,more);assert.equal(page.next_cursor!==null,more);
 }
});

test('real Supabase client serializes the composite timestamp and UUID filters without precision or scope loss',async()=>{
 const {createClient}=require('@supabase/supabase-js');const requests=[];
 const client=createClient('https://fixture.supabase.test','fixture-anon-key',{
  auth:{persistSession:false,autoRefreshToken:false},
  global:{fetch:async(input,init)=>{requests.push({url:new URL(String(input)),method:init?.method});return new Response('[]',{status:200,headers:{'Content-Type':'application/json'}});}},
 });
 const h=harness({messageClient:client}),timestamp='2026-11-08T13:00:00.123456+01:00',messageId='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
 const page=await historyPage(h,`v1|${timestamp}|${messageId.toUpperCase()}`);
 assert.equal(page.has_more,false);assert.equal(requests.length,1);
 const params=requests[0].url.searchParams;
 assert.equal(requests[0].method,'GET');assert.equal(params.get('thread_id'),'eq.'+id(10));
 assert.equal(params.get('order'),'created_at.desc,id.desc');assert.equal(params.get('limit'),'41');
 assert.equal(params.get('or'),`(created_at.lt.${timestamp},and(created_at.eq.${timestamp},id.lt.${messageId}))`);
 assert.equal(h.writes.length,0);
});

test('tarotista receives only first name and codes from consultation, never client identifiers or phones',async()=>{
 const h=harness({actor:2});
 h.tables.chat_messages[0].kind='consultation';h.tables.chat_messages[0].body='10 FREE · 20 CLIENTE · Michell';
 h.tables.chat_messages[0].operation_meta={client_phone:'17870009999',private_note:'private fixture'};
 h.tables.rendimiento_llamadas.push({id:id(701),cliente_nombre:'Michell ApellidoConfidencial',cliente_id:'17870009999',telefono:'17870009999',tiempo:30,fecha_hora:'2026-11-08T12:00:00Z',created_at:'2026-11-08T12:00:00Z',edit_revision:1,code_blocks:[{code:'FREE',minutes:10},{code:'CLIENTE',minutes:20}],telefonista_worker_id:id(1),tarotista_worker_id:id(2)});
 const response=await h.messages.GET(req('/api/chat/messages?thread_id='+id(10)));
 assert.equal(response.status,200);const data=await response.json();
 assert.equal(data.messages[0].consultation.first_name,'Michell');
 assert.deepEqual(data.messages[0].consultation.blocks,[{code:'FREE',minutes:10},{code:'CLIENTE',minutes:20}]);
 assert.doesNotMatch(JSON.stringify(data),/17870009999|ApellidoConfidencial|private fixture|cliente_id|telefono|operation_meta/);
 h.tables.rendimiento_llamadas[0].cliente_nombre='17870009999';h.tables.chat_messages[0].body='10 FREE · 20 CLIENTE · Clienta';
 const hidden=await(await h.messages.GET(req('/api/chat/messages?thread_id='+id(10)))).json();
 assert.equal(hidden.messages[0].consultation.first_name,'Clienta');assert.doesNotMatch(JSON.stringify(hidden),/17870009999/);
});

test('overview uses live panel sessions instead of stale worker heartbeat and never renews them',async()=>{
 const h=harness();const future=new Date(Date.now()+600000).toISOString();
 h.tables.workers.find(w=>w.id===id(2)).state='offline';
 h.tables.attendance_panel_sessions.push({worker_id:id(2),ended_at:null,expires_at:future});
 let body=await (await h.threads.GET(req('/api/chat/threads'))).json();
 assert.equal(body.contacts.find(c=>c.id===id(2)).state,'online');assert.equal(body.threads[0].contact.state,'online');assert.equal(body.contacts.find(c=>c.id===id(2)).presence_expires_at,future);
 assert.ok(Date.parse(body.presence_checked_at));assert.equal(h.writes.length,0);assert.equal(h.connectionCalls.length,0);
 h.tables.workers.find(w=>w.id===id(2)).state='online';
 h.tables.attendance_panel_sessions[0].expires_at=new Date(Date.now()-1).toISOString();
 body=await (await h.threads.GET(req('/api/chat/threads'))).json();assert.equal(body.contacts.find(c=>c.id===id(2)).state,'offline');
 h.tables.attendance_state.push({worker_id:id(2),status:'bathroom'});
 body=await (await h.threads.GET(req('/api/chat/threads'))).json();assert.equal(body.contacts.find(c=>c.id===id(2)).state,'break');
 h.tables.attendance_panel_sessions[0]={worker_id:id(2),ended_at:new Date().toISOString(),expires_at:future};
 h.tables.attendance_state[0].status='offline';
 body=await (await h.threads.GET(req('/api/chat/threads'))).json();assert.equal(body.contacts.find(c=>c.id===id(2)).state,'offline','closed sessions are never online');
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

test('delegated Central supervises chats with the same worker identity and loses that access when revoked',async()=>{
 const h=harness({delegated:true});
 const actor=(await h.helper.getStaffChatActor(req('/api/chat/threads'))).me;
 assert.equal(actor.id,id(1));assert.equal(actor.role,'central');assert.equal(actor.can_admin,true);
 const overview=await(await h.threads.GET(req('/api/chat/threads'))).json();
 assert.equal(overview.mode,'admin');assert.ok(overview.contacts.some(c=>c.id===id(4)));
 assert.equal((await h.messages.GET(req('/api/chat/messages?thread_id='+id(11)))).status,200);
 assert.equal(h.writes.length,0);assert.equal(h.connectionCalls.length,0);
 h.tables.workers[0].can_admin=false;
 assert.equal((await h.messages.GET(req('/api/chat/messages?thread_id='+id(11)))).status,403);
 assert.equal((await h.messages.GET(req('/api/chat/messages?thread_id='+id(10)))).status,200);
 assert.equal(h.tables.workers[0].role,'central');
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
test('Central-Tarotista pairs stay unchanged and Admin can initiate its own staff conversations',async()=>{
 const h=harness();
 assert.equal((await h.threads.POST(req('/api/chat/threads',{contact_worker_id:id(4)}))).status,400);
 assert.equal((await h.threads.POST(req('/api/chat/threads',{contact_worker_id:id(2)}))).status,200);
 for (const peer of [1,2]) {
  const admin=harness({actor:3});
  const created=await admin.threads.POST(req('/api/chat/threads',{contact_worker_id:id(peer),central_worker_id:id(4)}));
  assert.equal(created.status,201);
  const data=await created.json();
  assert.equal(data.thread.central_worker_id,id(peer===1?1:3));
  assert.equal(data.thread.tarotist_worker_id,id(peer===1?3:2));
  const retry=await admin.threads.POST(req('/api/chat/threads',{contact_worker_id:id(peer)}));
  assert.equal(retry.status,200);assert.equal((await retry.json()).thread.id,data.thread.id);
  const overview=await(await admin.threads.GET(req('/api/chat/threads'))).json();
  assert.equal(overview.threads.find(t=>t.id===data.thread.id).contact.id,id(peer));
 }
});

test('staff can reply to Admin in the same pair without gaining other private threads',async()=>{
 for(const actor of [1,2]) {
  const h=harness({actor});
  const pair={id:id(15),central_worker_id:id(actor===1?1:3),tarotist_worker_id:id(actor===1?3:2),status:'open'};
  h.tables.chat_threads.push(pair);
  const response=await h.threads.POST(req('/api/chat/threads',{contact_worker_id:id(3)}));
  assert.equal(response.status,200);assert.equal((await response.json()).thread.id,pair.id);
  const overview=await(await h.threads.GET(req('/api/chat/threads'))).json();
  assert.ok(overview.contacts.some(c=>c.id===id(3)));
  assert.equal(overview.threads.find(t=>t.id===pair.id).contact.id,id(3));
  assert.equal((await h.messages.GET(req('/api/chat/messages?thread_id='+id(11)))).status,403);
 }
});

test('Admin cannot create a chat when disconnected, with itself or with inactive staff',async()=>{
 const disconnected=harness({actor:3,connected:false});
 assert.equal((await disconnected.threads.POST(req('/api/chat/threads',{contact_worker_id:id(2)}))).status,423);
 assert.equal(disconnected.writes.length,0);
 const admin=harness({actor:3});
 assert.equal((await admin.threads.POST(req('/api/chat/threads',{contact_worker_id:id(3)}))).status,400);
 assert.equal((await admin.threads.POST(req('/api/chat/threads',{contact_worker_id:id(5)}))).status,404);
 assert.equal(admin.writes.length,0);
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
