const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');
function evaluate(file, imports = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{exports,require:name=>name in imports?imports[name]:require(name),console,Date,Intl,AbortController,Event,...globals});return exports;
}
const shared = evaluate('src/lib/central-atlas.ts');
const event = {id:'event-one',worker_id:'worker-isa',payment_id:'payment-one',client_id:'client-one',xp:2,amount:20,currency:'EUR',created_at:new Date().toISOString()};
const job = {id:'job-one',worker_id:'worker-isa',title:'Revisar seguimientos',description:'Gestiona los pendientes asignados.',kind:'recovery',client_ids:['client-one'],clients:[{id:'client-one',name:'Clienta de prueba'}],lead_ids:[],status:'pending',created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
function fixture(options={}) {
  const events=new Map(),timers=new Map(),calls=[],received=[];
  let latest,tree,authCallback,sequence=0,failure=false,block=null,claim=options.claim!==false,celebrations=options.celebrations!==false;
  let response={ok:true,worker_id:'worker-isa',jobs:[job],events:[event]},session={access_token:'token',user:{id:'user-isa'}};
  const document={hidden:!!options.hidden,querySelector(){return options.modal?{}:null;},addEventListener(name,fn){events.set('document:'+name,fn);},removeEventListener(name){events.delete('document:'+name);}};
  const window={addEventListener(name,fn){events.set(name,fn);},removeEventListener(name){events.delete(name);},setTimeout(fn,delay){timers.set(++sequence,{fn,delay});return sequence;},clearTimeout(id){timers.delete(id);},setInterval(fn,delay){timers.set(++sequence,{fn,delay,interval:true});return sequence;},clearInterval(id){timers.delete(id);}};
  const auth={getSession:async()=>({data:{session}}),onAuthStateChange(fn){authCallback=fn;return {data:{subscription:{unsubscribe(){}}}};}};
  const fetch=async(url,init)=>{
    calls.push({url,...init});const body=init.body?JSON.parse(init.body):null;
    const data=body?.action==='claim_celebration'?{ok:true,event:claim?event:null}:JSON.parse(JSON.stringify(response));
    if(body?.action==='claim_celebration')claim=false;
    const failed=failure,waiting=block;if(waiting)await waiting;
    return {ok:!failed,json:async()=>failed?{ok:false,error:'Fuente no disponible'}:data};
  };
  const {useAtlasTasks}=evaluate('src/features/central/assistant/useAtlasTasks.ts',{'@/lib/supabase-browser':{supabaseBrowser:()=>({auth})}},{window,document,fetch});
  function Component(){latest=useAtlasTasks({enabled:true,workerId:'worker-isa',celebrations,onPurchase:value=>received.push(value)});return null;}
  const act=async fn=>renderer.act(async()=>{fn();await new Promise(resolve=>setImmediate(resolve));});
  return {calls,received,timers,events,get state(){return latest;},
    async mount(){await act(()=>{tree=renderer.create(React.createElement(Component));});},async unmount(){await act(()=>tree.unmount());},
    async tick(){await act(()=>{for(const timer of [...timers.values()])if(timer.interval)timer.fn();});},
    async emit(name){await act(()=>events.get(name)?.(new Event(name)));},async settle(){await act(()=>{});},
    async signOut(){await act(()=>{session=null;authCallback('SIGNED_OUT',null);});},
    async update(body){await act(()=>{void latest.update(body);});},async rerender(value){celebrations=value;await act(()=>tree.update(React.createElement(Component)));},
    fail(value){failure=value;},block(value){block=value;},response(value){response=value;},visible(){document.hidden=false;},
  };
}
test('existing XP event is claimed before displaying a celebration, and duplicate server receipts never replay it',async()=>{
  const f=fixture();await f.mount();assert.equal(f.received.length,1);assert.equal(f.received[0].xp,2);
  assert.equal(f.calls[1].method,'POST');assert.deepEqual(JSON.parse(f.calls[1].body),{action:'claim_celebration',event_id:'event-one'});
  await f.tick();assert.equal(f.received.length,1);assert.match(shared.purchaseCelebrationMessage(event),/\+2 XP registrados/);
  await f.unmount();assert.equal(f.timers.size,0);assert.equal(f.events.size,0);
  const otherTab=fixture({claim:false});await otherTab.mount();assert.equal(otherTab.received.length,0);await otherTab.unmount();
});
test('hidden panels, modal workflows and disabled proactive celebrations do not consume a receipt',async()=>{
  for(const options of [{hidden:true},{modal:true},{celebrations:false}]){
    const f=fixture(options);await f.mount();assert.equal(f.calls.filter(call=>call.method==='POST').length,0);assert.equal(f.received.length,0);await f.unmount();
  }
  const f=fixture({celebrations:false});await f.mount();await f.rerender(true);await f.tick();assert.equal(f.received.length,1);await f.unmount();
});
test('failed refresh clears task data with an explicit error and online reload restores it',async()=>{
  const f=fixture();await f.mount();assert.equal(f.state.jobs.length,1);f.fail(true);await f.tick();assert.equal(f.state.jobs.length,0);assert.match(f.state.error,/Fuente no disponible/);
  f.fail(false);await f.emit('online');assert.equal(f.state.jobs.length,1);assert.equal(f.state.error,'');
  await f.emit('offline');assert.equal(f.state.jobs.length,0);assert.match(f.state.error,/Sin conexión/);await f.unmount();
});
test('sign out invalidates in-flight data so another worker cannot see old jobs or purchases',async()=>{
  const f=fixture({celebrations:false});await f.mount();let release;f.block(new Promise(resolve=>{release=resolve;}));await f.tick();
  await f.signOut();release();await f.settle();assert.equal(f.state.jobs.length,0);assert.equal(f.received.length,0);await f.unmount();
});
test('a mismatched worker response fails closed before consuming a purchase event',async()=>{
  const f=fixture({celebrations:false});await f.mount();f.response({ok:true,worker_id:'worker-maria',jobs:[job],events:[event]});await f.rerender(true);await f.tick();
  assert.equal(f.state.jobs.length,0);assert.match(f.state.error,/central de la sesión cambió/);assert.equal(f.calls.filter(call=>call.method==='POST').length,0);await f.unmount();
});
test('contact-result form retains the request identity on retry and has no option to assert a completed purchase',async()=>{
  let tree,accept=false,ids=0;const requests=[];
  const Inbox=evaluate('src/features/central/assistant/AtlasTaskInbox.tsx',{
    '@/lib/central-atlas':shared,'./CentralCompanion.module.css':{default:new Proxy({},{get:(_target,key)=>key})},
    'lucide-react':new Proxy({},{get:(_target,key)=>props=>React.createElement('span',{...props,'data-icon':key})}),
  },{crypto:{randomUUID:()=>`request-${++ids}`}}).default;
  const act=async fn=>renderer.act(async()=>{fn();await new Promise(resolve=>setImmediate(resolve));});
  await act(()=>{tree=renderer.create(React.createElement(Inbox,{jobs:[job],loading:false,saving:false,error:'',truncated:false,refresh(){},onNavigate(){},update:async body=>{requests.push(body);return accept;}}));});
  try {
    const button=tree.root.findAllByType('button').find(node=>node.children.includes('Registrar resultado'));
    await act(()=>button.props.onClick());assert.ok(!tree.root.findAllByType('option').some(node=>node.props.value==='purchase'));
    await act(()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}}));accept=true;
    await act(()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}}));
    assert.equal(requests.length,2);assert.equal(requests[0].request_id,requests[1].request_id);assert.equal(requests[0].client_id,'client-one');
  } finally { await act(()=>tree.unmount()); }
});
