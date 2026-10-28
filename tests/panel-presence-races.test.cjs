const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), React = require('react');
const { act, create } = require('react-test-renderer');

// Simulated accounts, sessions and responses only; never contacts Supabase/AMI.
const INITIAL_NOW = Date.parse('2026-10-28T19:00:00Z');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const flush = fn => act(async () => { fn?.(); await new Promise(resolve => setImmediate(resolve)); });
const response = (body, status=200) => ({ ok: status<400, status, json: async () => body });
function state(at, { online=true, worker='worker-a', session='session-a', ...extra }={}) {
  return { ok:true, state_updated:true, worker:{id:worker}, online, status:online?'working':'offline',
    session_id:online?session:null, server_now:new Date(at).toISOString(),
    session_started_at:new Date(INITIAL_NOW).toISOString(), last_manual_activity_at:new Date(at).toISOString(),
    expires_at:new Date(at+600000).toISOString(), ...extra };
}
async function setup(t) {
  let now=INITIAL_NOW, snapshot, view, nextTimer=0;
  const authListeners=new Set(), requests=[], timers=new Map(), listeners=new Map();
  const fixture={ session:{access_token:'fixture-a',user:{id:'user-a'}}, read:async()=>response(state(now)), post:async()=>response(state(now)) };
  const listen=(kind,fn)=>{ if(!listeners.has(kind)) listeners.set(kind,new Set()); listeners.get(kind).add(fn); };
  const unlisten=(kind,fn)=>listeners.get(kind)?.delete(fn);
  const browser={ setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id;}, clearTimeout:id=>timers.delete(id),
    setInterval:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id;},clearInterval:id=>timers.delete(id),
    addEventListener:listen,removeEventListener:unlisten };
  const client={ auth:{getSession:async()=>({data:{session:fixture.session}}),onAuthStateChange(fn){authListeners.add(fn);return {data:{subscription:{unsubscribe(){authListeners.delete(fn);}}}};}},
    channel(){const chain={on(){return chain;},subscribe(){return chain;}};return chain;},removeChannel(){},
    from(){const query={select(){return query;},eq(){return query;},then(resolve){resolve({count:0,error:null});}};return query;} };
  class FixtureDate extends Date { constructor(...args){super(...(args.length?args:[now]));} static now(){return now;} }
  const source=fs.readFileSync(path.join(__dirname,'../src/providers/OpsProvider.tsx'),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports={};
  vm.runInNewContext(code,{exports,require(name){if(name==='@/lib/supabase-browser')return {supabaseBrowser:()=>client};if(name==='next/navigation')return {usePathname:()=>'/admin'};if(name==='@/lib/attendance/panel-session')return {isPanelPath:()=>true,PANEL_HEARTBEAT_MS:30000};return require(name);},
    Date:FixtureDate,Error,Map,Set,Promise,AbortController,AbortSignal,console,process:{env:{}},window:browser,
    document:{visibilityState:'visible',addEventListener:listen,removeEventListener:unlisten},localStorage:{setItem(){},getItem(){return null;}},
    setTimeout:browser.setTimeout,clearTimeout:browser.clearTimeout,
    fetch:async(url,init={})=>{const body=init.body?JSON.parse(init.body):null;requests.push({url,init,body});return init.method==='POST'?fixture.post(body,init):fixture.read(url,init);},
  });
  function Probe(){snapshot=exports.useOps();return null;}
  await act(async()=>{view=create(React.createElement(exports.OpsProvider,null,React.createElement(Probe)));});
  t.after(()=>act(()=>view.unmount()));
  return { fixture,requests,timers,get ops(){return snapshot;},get now(){return now;},advance(ms){now+=ms;},
    async auth(event,session){fixture.session=session;await flush(()=>{for(const fn of authListeners)fn(event,session);});},
    async connect(){await act(async()=>{await snapshot.changeAttendance('online');});},
    async disconnect(){await act(async()=>{await snapshot.changeAttendance('offline');});},
  };
}

test('a delayed status failure cannot erase a newer successful connection',async t=>{
  const f=await setup(t), old=deferred();f.fixture.read=()=>old.promise;
  let pending;await flush(()=>{pending=f.ops.refreshAttendance();});
  f.advance(1000);await f.connect();assert.equal(f.ops.attendance.online,true);
  await act(async()=>{old.resolve(response({ok:false,error:'temporary-failure'},503));await pending;});
  assert.equal(f.ops.attendance.online,true);assert.equal(f.ops.attendance.error,null);
});

test('a delayed status network rejection cannot erase a newer successful connection',async t=>{
  const f=await setup(t),old=deferred();f.fixture.read=()=>old.promise;
  let pending;await flush(()=>{pending=f.ops.refreshAttendance();});
  f.advance(1000);await f.connect();
  await act(async()=>{old.reject(Error('simulated offline'));await pending;});
  assert.equal(f.ops.attendance.online,true);assert.equal(f.ops.attendance.sessionId,'session-a');
});

test('a successful old GET cannot reopen a session after disconnect',async t=>{
  const f=await setup(t);await f.connect();const old=deferred(),before=state(f.now);f.fixture.read=()=>old.promise;
  let pending;await flush(()=>{pending=f.ops.refreshAttendance();});f.advance(1000);
  f.fixture.post=async()=>response(state(f.now,{online:false}));await f.disconnect();
  await act(async()=>{old.resolve(response(before));await pending;});
  assert.equal(f.ops.attendance.online,false);assert.equal(f.ops.attendance.sessionId,null);
});

test('a heartbeat already in flight cannot reopen a confirmed disconnect',async t=>{
  const f=await setup(t);await f.connect();const old=deferred(),before=state(f.now);
  f.fixture.post=async body=>body.event_type==='heartbeat'?old.promise:response(state(f.now,{online:false}));
  let pending;await flush(()=>{pending=f.ops.keepAttendanceActive().catch(()=>{});});f.advance(1000);await f.disconnect();
  await act(async()=>{old.resolve(response(before));await pending;});
  assert.equal(f.ops.attendance.online,false);assert.equal(f.ops.attendance.sessionId,null);
});

test('ignoring an older GET also preserves the clock used for manual activity',async t=>{
  const f=await setup(t),old=deferred(),before=state(f.now);f.fixture.read=()=>old.promise;
  let pending;await flush(()=>{pending=f.ops.refreshAttendance();});f.advance(300000);await f.connect();
  await act(async()=>{old.resolve(response(before));await pending;});
  await act(async()=>{await f.ops.keepAttendanceActive();});
  const heartbeat=f.requests.findLast(r=>r.body?.event_type==='heartbeat');
  assert.equal(Date.parse(heartbeat.body.activity_at),f.now);
});

test('changing authenticated user locks immediately and rejects an old worker response',async t=>{
  const f=await setup(t);await f.connect();const old=deferred();f.fixture.read=()=>old.promise;
  let pending;await flush(()=>{pending=f.ops.refreshAttendance();});
  f.advance(1000);await f.auth('SIGNED_IN',{access_token:'fixture-b',user:{id:'user-b'}});
  assert.equal(f.ops.attendance.online,false);assert.equal(f.ops.attendance.sessionId,null);
  await act(async()=>{old.resolve(response(state(f.now,{worker:'worker-a'})));await pending;});
  assert.notEqual(f.ops.attendance.workerId,'worker-a');assert.equal(f.ops.attendance.sessionId,null);
});

test('sign-out immediately removes working presence even before navigation',async t=>{
  const f=await setup(t);await f.connect();await f.auth('SIGNED_OUT',null);
  assert.equal(f.ops.attendance.online,false);assert.equal(f.ops.attendance.workerId,null);assert.equal(f.ops.attendance.sessionId,null);
});
