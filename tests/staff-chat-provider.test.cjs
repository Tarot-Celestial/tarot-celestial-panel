const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), React = require('react');
const { act, create } = require('react-test-renderer');

// Synthetic workers/messages only. No request reaches Supabase or a real worker.
const flush = async fn => act(async () => { fn?.(); await new Promise(r => setImmediate(r)); });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve=r; }); return {promise,resolve}; };
const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX } }).outputText;
function helper() { const exports={}; vm.runInNewContext(compile('src/lib/staff-chat-alerts.ts'), {exports,Number,Math,JSON,Array}); return exports; }
const contact = {id:'central-a',display_name:'Central de prueba',role:'central',team:'agua',state:'online'};
const message = (id='message-a', thread='thread-a', sender='central-a') => ({id,thread_id:thread,sender_worker_id:sender,sender_display_name:'Central de prueba',text:'Mensaje simulado',created_at:new Date(Date.now()+1000).toISOString()});
const thread = (count=0, latest=null,id='thread-a') => ({id,contact,unread_count:count,latest_incoming:latest});
async function fixture(t, initial=[thread()], options={}) {
  let snapshot, view, oscillatorCount=0, timerId=0, enabled=true;
  let simulatedNow=options.now??null;
  class FixtureDate extends Date {
    constructor(...args){super(...(args.length?args:[simulatedNow??Date.now()]));}
    static now(){return simulatedNow??Date.now();}
  }
  const listeners=new Map(), timers=new Map(), subscriptions=[], authCallbacks=[], storage=new Map();
  const state={me:{id:'worker-a',role:'tarotista',display_name:'Tarotista de prueba'},contacts:[contact],threads:initial};
  const attendance={online:true,status:'working',sessionId:'session-a',expiresAt:new FixtureDate(FixtureDate.now()+600000).toISOString(),error:null};
  const input={response:()=>Promise.resolve({...state,threads:[...state.threads]}),requests:[],session:{access_token:'fixture',user:{id:'user-a'}}};
  const listen=(name,fn)=>{if(!listeners.has(name)) listeners.set(name,new Set());listeners.get(name).add(fn);};
  const unlisten=(name,fn)=>listeners.get(name)?.delete(fn);
  class AudioContext {
    state='suspended';currentTime=0;destination={};
    async resume(){this.state='running';} async close(){this.state='closed';}
    createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
    createOscillator(){oscillatorCount++;return {frequency:{value:0},connect(){},disconnect(){},start(){},stop(){}};}
  }
  const browser={AudioContext,addEventListener:listen,removeEventListener:unlisten,
    setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    setInterval:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearInterval:id=>timers.delete(id)};
  const document={visibilityState:'visible',hasFocus:()=>true,addEventListener:listen,removeEventListener:unlisten};
  const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
  const client={auth:{getSession:async()=>({data:{session:input.session}}),onAuthStateChange(fn){authCallbacks.push(fn);return {data:{subscription:{unsubscribe(){}}}};}},realtime:{setAuth:async()=>{}},
    channel(){const channel={handlers:[],on(event,filter,callback){this.handlers.push({filter,callback});return this;},subscribe(fn){subscriptions.push(this);fn('SUBSCRIBED');return this;}};return channel;},removeChannel(){}};
  const exports={};
  const access={};vm.runInNewContext(compile('src/hooks/usePanelSessionAccess.ts'),{exports:access,require,window:browser,document,Date:FixtureDate});
  vm.runInNewContext(compile('src/providers/StaffChatProvider.tsx'),{exports,require(name){
    if(name==='next/navigation')return {usePathname:()=>enabled?'/panel-tarotista':'/login'};
    if(name==='@/lib/supabase-browser')return {supabaseBrowser:()=>client};
    if(name==='@/hooks/useAttendance')return {useAttendance:()=>attendance};
    if(name==='@/hooks/usePanelSessionAccess')return access;
    if(name==='@/lib/attendance/panel-session')return {isPanelPath:p=>p==='/panel-tarotista'};
    if(name==='@/lib/staff-chat-alerts')return helper();
    if(name==='@/lib/staff-chat-client')return {chatRequest:async(url)=>{input.requests.push(url);return input.response();}};
    return require(name);
  },window:browser,document,localStorage,navigator:{locks:{request:async(_key,fn)=>fn()}},console,Date:FixtureDate,Map,Set,Promise,Number,JSON,Math,Array,Error});
  function Probe(){snapshot=exports.useStaffChat();return null;}
  await act(async()=>{view=create(React.createElement(exports.StaffChatProvider,null,React.createElement(Probe)));});
  await flush();
  t.after(()=>act(()=>view.unmount()));
  return {input,state,attendance,document,storage,timers,get chat(){return snapshot;},get oscillatorCount(){return oscillatorCount;},
    now:()=>FixtureDate.now(),
    async advance(ms){assert.notEqual(simulatedNow,null,'advance requires an explicit fake clock');simulatedNow+=ms;await flush(()=>{for(const timer of timers.values())if(timer.ms===1000)timer.fn();});},
    async incoming(row){await flush(()=>{const current=subscriptions.at(-1);current.handlers.find(h=>h.filter.table==='chat_messages').callback({new:{...row,body:row.text}});});},
    async auth(session){input.session=session;await flush(()=>authCallbacks.forEach(fn=>fn('SIGNED_IN',session)));},
    async reRender(){await act(async()=>view.update(React.createElement(exports.StaffChatProvider,null,React.createElement(Probe))));},
  };
}

test('preexisting unread counts appear without playing old notifications',async t=>{
  const f=await fixture(t,[thread(12,message('old'))]);
  assert.equal(f.chat.unreadTotal,12);assert.equal(f.chat.notice,null);assert.equal(f.oscillatorCount,0);
  assert.ok(f.input.requests.every(url=>url==='/api/chat/threads'),'provider never fetches or acknowledges hidden messages');
});
test('duplicate realtime deliveries create one sound and preserve an exact count from the server',async t=>{
  const f=await fixture(t);await act(async()=>f.chat.testSound());const baseline=f.oscillatorCount;
  const incoming=message();f.state.threads=[thread(1,incoming)];
  await f.incoming(incoming);await f.incoming(incoming);
  assert.equal(f.oscillatorCount,baseline+4);assert.equal(f.chat.unreadTotal,1);assert.equal(f.chat.notice.id,incoming.id);
});
test('zero volume remains zero, and unsupported desktop notifications do not break arrivals',async t=>{
  const f=await fixture(t);await act(async()=>{f.chat.setVolume(0);await f.chat.testSound();await f.chat.enableNotifications();});
  assert.equal(f.chat.volume,0);assert.equal(f.oscillatorCount,0);assert.equal(f.chat.notificationPermission,'unsupported');
  await f.incoming(message());assert.ok(f.chat.notice);assert.equal(f.oscillatorCount,0);
  assert.equal(JSON.parse(f.storage.get('tc_staff_chat_sound')).volume,0);
});
test('own messages and a genuinely visible focused conversation do not create distracting alerts',async t=>{
  const f=await fixture(t);await act(async()=>f.chat.setVisibleThread('panel','thread-a'));
  await f.incoming({...message('own','thread-a','worker-a'),client_message_id:'stable-client-id'});
  assert.equal(f.chat.incoming.id,'own');assert.equal(f.chat.incoming.client_message_id,'stable-client-id');assert.equal(f.chat.notice,null);
  await f.incoming(message('visible'));assert.equal(f.chat.incoming.id,'visible');assert.equal(f.chat.notice,null);
  f.document.visibilityState='hidden';await f.incoming(message('hidden'));assert.equal(f.chat.notice.id,'hidden');
});
test('reconnect polling discovers a missed new thread but ignores an unverified realtime payload',async t=>{
  const f=await fixture(t);await f.incoming(message('not-authorized','unknown-thread'));assert.equal(f.chat.notice,null);
  const newer=message('new-thread-message','new-thread');f.state.threads=[thread(),thread(1,newer,'new-thread')];
  await act(async()=>f.chat.refresh());assert.equal(f.chat.notice.id,newer.id);assert.equal(f.chat.unreadTotal,1);
  await act(async()=>f.chat.requestOpen('new-thread'));assert.equal(f.chat.openRequest.threadId,'new-thread');assert.equal(f.chat.notice,null);
});
test('an old account response cannot restore its private threads after an account switch',async t=>{
  const f=await fixture(t), pending=deferred();let oldRefresh;
  f.input.response=()=>pending.promise;
  await flush(()=>{oldRefresh=f.chat.refresh();});
  f.state.me={id:'worker-b',role:'central',display_name:'Nueva cuenta'};f.state.threads=[];
  f.input.response=()=>Promise.resolve({...f.state});
  await f.auth({access_token:'fixture-b',user:{id:'user-b'}});
  assert.equal(f.chat.me.id,'worker-b','new account does not wait for the previous account request');
  await act(async()=>{pending.resolve({me:{id:'worker-a',role:'tarotista'},threads:[thread(9)],contacts:[contact]});await oldRefresh;});
  await flush();assert.equal(f.chat.me.id,'worker-b');assert.equal(f.chat.unreadTotal,0);assert.equal(f.chat.notice,null);
});

test('503 and malformed responses preserve the last verified overview; auth denial clears it',async t=>{
 const f=await fixture(t,[thread(3)]);
 f.input.response=async()=>{throw Object.assign(new Error('Temporary failure'),{status:503});};
 await act(async()=>f.chat.refresh());assert.equal(f.chat.me.id,'worker-a');assert.equal(f.chat.threads[0].id,'thread-a');assert.equal(f.chat.unreadTotal,3);
 f.input.response=async()=>({ok:true});
 await act(async()=>f.chat.refresh());assert.equal(f.chat.threads.length,1);assert.equal(f.chat.contacts.length,1);
 f.input.response=async()=>{throw Object.assign(new Error('Expired session'),{status:401,code:'NO_AUTH'});};
 await act(async()=>f.chat.refresh());assert.equal(f.chat.me,null);assert.equal(f.chat.threads.length,0);assert.equal(f.chat.notice,null);
});

test('temporary attendance errors preserve visible chat reading but expiry and auth rejection do not',async t=>{
 const f=await fixture(t);await act(async()=>f.chat.setVisibleThread('panel','thread-a'));
 f.attendance.error='HTTP 503';await f.reRender();await f.incoming(message('during-retry'));assert.equal(f.chat.notice,null);
 f.attendance.expiresAt=new Date(Date.now()-1).toISOString();await f.reRender();await f.incoming(message('after-expiry'));assert.equal(f.chat.notice.id,'after-expiry');
 await act(async()=>f.chat.dismissNotice());
 f.attendance.expiresAt=new Date(Date.now()+600000).toISOString();f.attendance.error='NO_AUTH';await f.reRender();
 await f.incoming(message('rejected-auth'));assert.equal(f.chat.notice.id,'rejected-auth');
});

test('server-dated contact deadlines expire during failed overview refreshes',async t=>{
 const f=await fixture(t,undefined,{now:Date.parse('2026-10-30T15:00:00Z')});
 const serverNow=f.now()-3600000;
 const valid={...contact,presence_expires_at:new Date(serverNow+60000).toISOString()};
 f.input.response=async()=>({...f.state,presence_checked_at:new Date(serverNow).toISOString(),contacts:[valid],threads:[{...thread(),contact:valid}]});
 await act(async()=>f.chat.refresh());assert.equal(f.chat.contacts[0].state,'online','local clock one hour ahead must not mark contact offline');
 f.input.response=async()=>{throw Object.assign(new Error('Temporary failure'),{status:503});};
 await act(async()=>f.chat.refresh());assert.equal(f.chat.contacts[0].state,'online');
 await f.advance(59999);assert.equal(f.chat.contacts[0].state,'online','last confirmed contact remains online before its server deadline');
 await f.advance(2);
 assert.equal(f.chat.contacts[0].state,'offline');assert.equal(f.chat.threads[0].contact.state,'offline');
});
