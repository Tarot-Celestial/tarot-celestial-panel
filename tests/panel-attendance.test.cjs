const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function load(file,mocks={},env={}){const exports={};const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(source,{exports,require:n=>mocks[n]||require(n),Date,Set,process:{env},URL,Request,Response});return exports;}
const helper=load('src/lib/attendance/panel-session.ts');
test('all three staff panels and subroutes are gated; login, client and similar prefixes remain outside',()=>{
  for(const p of ['/admin','/admin/cerebro','/admin/companions','/panel-central','/panel-central/more','/panel-tarotista','/panel-tarotista/more'])assert.equal(helper.isPanelPath(p),true);
  for(const p of ['/login','/cliente','/panel-tarotistas','/administrator',null])assert.equal(helper.isPanelPath(p),false);
  assert.equal(helper.PANEL_IDLE_TIMEOUT_MS,600000);
});
test('confirmed call requires own server extension, Up and a bridged leg',()=>{
  const now=Date.parse('2026-10-28T23:00:00Z');
  const channel=(ext,state,bridge,seconds=900)=>`Output: PJSIP/${ext}-0001!from-internal!123!1!${state}!Dial!PJSIP/other!123!!3!${seconds}!${bridge}!unique`;
  assert.equal(helper.confirmedCallStart(channel('1001','Up','PJSIP/trunk-0002'),['1001'],now),'2026-10-28T22:45:00.000Z');
  assert.equal(helper.confirmedCallStart(channel('1001','Ringing','PJSIP/trunk-0002'),['1001'],now),null);
  assert.equal(helper.confirmedCallStart(channel('1001','Up','<none>'),['1001'],now),null);
  assert.equal(helper.confirmedCallStart(channel('1001','Up','PJSIP/trunk-0002'),['100'],now),null);
  assert.equal(helper.confirmedCallStart(channel('1001','Up','PJSIP/trunk-0002',-1),['1001'],now),null);
});
test('Asterisk 18/20/22 duration and bridge ID use the verified fourteen-field layout',()=>{
  const now=Date.parse('2026-10-28T23:00:00Z');
  const row=(extension,state,bridge,duration='900')=>[`PJSIP/${extension}-0001`,'from-internal','123','1',state,'Dial','PJSIP/1001','123','','','3',duration,bridge,'unique'].join('!');
  assert.equal(helper.confirmedCallStart(row('1001','Up','bridge-fixture'),['1001'],now),'2026-10-28T22:45:00.000Z');
  assert.equal(helper.confirmedCallStart(row('1001','Up',''),['1001'],now),null);
  assert.equal(helper.confirmedCallStart(row('1001','Ringing','bridge-fixture'),['1001'],now),null);
  assert.equal(helper.confirmedCallStart(row('1002','Up','bridge-fixture'),['1001'],now),null);
  assert.equal(helper.confirmedCallStart(row('1001','Up','bridge-fixture','-'),['1001'],now),null);
});
test('legacy aliases map to explicit transitions, and heartbeat remains heartbeat',()=>{
  assert.equal(helper.attendanceAction('heartbeat',{call_active:true}),'heartbeat');
  assert.equal(helper.attendanceAction('break_start'),'break');
  assert.equal(helper.attendanceAction('break_end'),'connect');
  assert.equal(helper.attendanceAction('logout'),'disconnect');
  assert.equal(helper.attendanceAction('online',{action:'break',phase:'start'}),'break');
  assert.equal(helper.attendanceAction('unknown'),null);
  assert.equal(helper.attendanceAction('consultation_start'),'consultation_start');
  assert.equal(helper.attendanceAction('consultation_end'),'consultation_end');
});
test('attendance identity is verified with getUser and a worker resolved by user_id',async()=>{
  const calls=[];const db={auth:{getUser:async(token)=>{calls.push(['getUser',token]);return {data:{user:{id:'auth-user'}}}}},from:()=>({select(){return this},eq(key,value){calls.push([key,value]);return this},maybeSingle:async()=>({data:{id:'worker',role:'central',is_active:true}})})};
  const api=load('src/lib/server/panel-attendance.ts',{'@supabase/supabase-js':{createClient:()=>db},'@/lib/server/asterisk-ami':{},'@/lib/attendance/panel-session':helper});
  const gate=await api.verifiedAttendanceWorker(new Request('https://panel.test/api/attendance/me',{headers:{Authorization:'Bearer fixture-token'}}));
  assert.equal(gate.ok,true);assert.deepEqual(calls,[['getUser','fixture-token'],['user_id','auth-user']]);
});
test('call checks run only near expiry, coalesce tabs and ignore client call claims',async()=>{
  const id='00000000-0000-0000-0000-000000000001',worker={id:'worker',role:'central',display_name:'Fixture',is_active:true};
  let amiCalls=0,expires=new Date(Date.now()+600000).toISOString();const rpc=[];
  const db={from:table=>({select(){return this},eq(){return this},is(){return this},maybeSingle:async()=>({data:{id,expires_at:expires}}),then(resolve){resolve({data:table==='pbx_extensions'?[{extension:'1001'}]:[]})}}),rpc:async(name,args)=>{rpc.push(args);return {data:{ok:true,session_id:id,status:'working'}}}};
  const api=load('src/lib/server/panel-attendance.ts',{'@supabase/supabase-js':{},'@/lib/server/asterisk-ami':{amiCommand:async()=>{amiCalls++;return {ok:true,raw:'PJSIP/1001-0001!from-internal!123!1!Up!Dial!PJSIP/trunk!123!!3!900!PJSIP/trunk-0002!unique'}}},'@/lib/attendance/panel-session':helper},{ASTERISK_AMI_HOST:'fixture-host',ASTERISK_AMI_SECRET:'fixture-secret'});
  await api.panelAttendanceEvent(db,worker,'heartbeat',{session_id:id,activity_at:new Date().toISOString(),call_active:true,call_started_at:'2020-01-01T00:00:00Z'});
  assert.equal(amiCalls,0);assert.equal(rpc.at(-1).p_call_started_at,null);
  await api.panelAttendanceEvent(db,worker,'status');assert.equal(amiCalls,0);
  expires=new Date(Date.now()+60000).toISOString();
  await api.panelAttendanceEvent(db,worker,'heartbeat',{session_id:'00000000-0000-0000-0000-000000000002'});
  assert.equal(amiCalls,0);
  const values=await Promise.all([api.panelAttendanceEvent(db,worker,'status'),api.panelAttendanceEvent(db,worker,'heartbeat',{session_id:id})]);
  assert.equal(amiCalls,1);assert.ok(rpc.at(-1).p_call_started_at);assert.equal(values[0].call_protection_available,true);
});
test('unavailable call evidence preserves normal state handling and reports unavailability',async()=>{
  const id='00000000-0000-0000-0000-000000000001';let calls=0;
  const db={from:()=>({select(){return this},eq(){return this},is(){return this},maybeSingle:async()=>({data:{id,expires_at:new Date(Date.now()+60000).toISOString()}}),then(resolve){resolve({data:[{extension:'1001'}]})}}),rpc:async(name,args)=>{calls++;assert.equal(args.p_call_started_at,null);return {data:{ok:true,session_id:id,status:'working'}}}};
  const api=load('src/lib/server/panel-attendance.ts',{'@supabase/supabase-js':{},'@/lib/server/asterisk-ami':{amiCommand:async()=>{throw new Error('Fixture unavailable')}},'@/lib/attendance/panel-session':helper},{ASTERISK_AMI_HOST:'fixture-host',ASTERISK_AMI_SECRET:'fixture-secret'});
  const state=await api.panelAttendanceEvent(db,{id:'worker',role:'central',display_name:null,is_active:true},'status');
  assert.equal(calls,1);assert.equal(state.ok,true);assert.equal(state.call_protection_available,false);
});

test('tarotista server gate requires an open session just like central and admin',async()=>{
  let state={ok:true,status:'offline',session_id:null};
  const db={from:()=>({select(){return this},eq(){return this},is(){return this},maybeSingle:async()=>({data:null})}),rpc:async()=>({data:state})};
  const api=load('src/lib/server/panel-attendance.ts',{'@supabase/supabase-js':{},'@/lib/server/asterisk-ami':{},'@/lib/attendance/panel-session':helper});
  for(const role of ['admin','central','tarotista']) {
    const denied=await api.requireActivePanelSession(db,{id:'worker',role});
    assert.equal(denied.status,423);assert.equal(denied.error,'PANEL_CONNECTION_REQUIRED');
  }
  state={ok:true,status:'working',session_id:'verified-session'};
  assert.equal((await api.requireActivePanelSession(db,{id:'worker',role:'tarotista'})).ok,true);
});

test('manual consultation does not query AMI, set PBX evidence or accept a client-controlled duration',async()=>{
  const session='00000000-0000-0000-0000-000000000001',worker={id:'taro',role:'tarotista',display_name:null,is_active:true};
  let amiCalls=0;const calls=[];
  const db={from:()=>({select(){return this},eq(){return this},is(){return this},maybeSingle:async()=>({data:{id:session,expires_at:new Date(Date.now()+60000).toISOString(),consultation_until:new Date(Date.now()+60000).toISOString()}})}),
    rpc:async(name,args)=>{calls.push(args);return {data:{ok:true,status:'working',session_id:session}}}};
  const api=load('src/lib/server/panel-attendance.ts',{'@supabase/supabase-js':{},'@/lib/server/asterisk-ami':{amiCommand:async()=>{amiCalls++;throw Error('unexpected')}} ,'@/lib/attendance/panel-session':helper},{ASTERISK_AMI_HOST:'fixture',ASTERISK_AMI_SECRET:'fixture'});
  await api.panelAttendanceEvent(db,worker,'consultation_start',{session_id:session,duration_minutes:999,consultation_until:'2099-01-01',call_active:true,call_started_at:'2020-01-01'});
  await api.panelAttendanceEvent(db,worker,'heartbeat',{session_id:session});
  assert.equal(amiCalls,0);
  for(const args of calls) { assert.equal(args.p_call_started_at,null);assert.equal(args.p_duration_minutes,undefined);assert.equal(args.p_consultation_until,undefined); }
});

test('attendance routes send tarotista status and heartbeat through the session RPC; manual mode is tarotista-only',async()=>{
  let role='tarotista',actionResult={ok:true,status:'offline',session_id:null},actions=[];
  const mocks={
    'next/server':{NextResponse:{json:(body,options={})=>new Response(JSON.stringify(body),{status:options.status||200})}},
    '@supabase/supabase-js':{createClient:()=>{throw Error('legacy path must not execute')}},
    '@/lib/server/worker-cache':{},
    '@/lib/server/panel-attendance':{verifiedAttendanceWorker:async()=>({ok:true,db:{},worker:{id:'worker',role},uid:'uid'}),panelAttendanceEvent:async(db,worker,action,body)=>{actions.push([action,body]);return actionResult;}},
    '@/lib/attendance/panel-session':helper,
  };
  const request=(event_type)=>new Request('https://fixture/api/attendance/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event_type,session_id:'old-session'})});
  const me=load('src/app/api/attendance/me/route.ts',mocks);
  const ping=load('src/app/api/attendance/ping/route.ts',mocks);
  const events=load('src/app/api/attendance/event/route.ts',mocks);
  assert.equal((await (await me.GET(new Request('https://fixture'))).json()).session_id,null);
  assert.equal((await (await ping.POST(request('heartbeat'))).json()).session_id,null);
  await events.POST(request('bathroom_start'));await events.POST(request('consultation_start'));
  assert.deepEqual(actions.map(([action])=>action),['status','heartbeat','bathroom','consultation_start']);
  assert.equal(actions[1][1].session_id,'old-session');
  role='central';assert.equal((await events.POST(request('consultation_start'))).status,403);
  assert.equal(actions.length,4);
});
