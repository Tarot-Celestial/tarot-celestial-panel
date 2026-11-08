const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
const {act,create}=require('react-test-renderer');
const flush=()=>act(async()=>{await new Promise(r=>setImmediate(r));});
const pending=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
async function fixture(t,response){
 const events=new Map(),timers=new Map(),opens=[];
 const input={actor:'actor-a',response,requests:0};
 const document={visibilityState:'visible',addEventListener:(n,f)=>events.set(n,f),removeEventListener:n=>events.delete(n)};
 const window={addEventListener:(n,f)=>events.set(n,f),removeEventListener:n=>events.delete(n),setInterval:f=>{timers.set(1,f);return 1;},clearInterval:n=>timers.delete(n)};
 const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/components/chat/StaffTeamStatusStrip.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const exports={};vm.runInNewContext(code,{exports,AbortController,document,window,require:n=>{
  if(n.endsWith('.module.css'))return {default:new Proxy({},{get:(_,k)=>k})};
  if(n==='lucide-react')return {BellRing:()=>null,Coffee:()=>null,DoorOpen:()=>null};
  if(n==='@/providers/StaffChatProvider')return {useStaffChat:()=>({me:input.actor?{id:input.actor}:null,threads:[{id:'own'}],requestOpen:id=>opens.push(id)})};
  if(n==='@/lib/staff-chat-client')return {chatRequest:()=>{input.requests++;return input.response();}};
  if(n==='@/lib/staff-chat-operations')return {pauseLabel:()=> 'en el baño'};
  return require(n);
 }});
 let view;await act(async()=>{view=create(React.createElement(exports.default));});await flush();
 t.after(()=>act(()=>view.unmount()));
 return {input,view,events,timers,opens,document,async render(){await act(async()=>view.update(React.createElement(exports.default)));await flush();}};
}
test('team header shows global absence but opens only an authorized conversation',async t=>{
 const f=await fixture(t,async()=>({pauses:[{id:'p1',thread_id:'own',worker_name:'Tarotista de prueba',kind:'bathroom'},{id:'p2',thread_id:'other',worker_name:'Otra tarotista',kind:'bathroom'}],pending:[]}));
 assert.equal(f.view.root.findAllByType('button').length,1);
 await act(async()=>f.view.root.findByType('button').props.onClick());assert.deepEqual(f.opens,['own']);
});
test('old account response cannot restore notices after identity change',async t=>{
 const old=pending(),next=pending();const f=await fixture(t,()=>old.promise);
 f.input.actor='actor-b';f.input.response=()=>next.promise;await f.render();
 await act(async()=>old.resolve({pauses:[{id:'a',thread_id:'own',worker_name:'Private old actor',kind:'bathroom'}],pending:[]}));
 assert.equal(f.view.toJSON(),null);
 await act(async()=>next.resolve({pauses:[],pending:[]}));assert.equal(f.view.toJSON(),null);
});
test('hidden panels suspend header polling and recover on visibility without attendance writes',async t=>{
 const f=await fixture(t,async()=>({pauses:[],pending:[]}));const count=f.input.requests;
 f.document.visibilityState='hidden';await act(async()=>f.timers.get(1)());assert.equal(f.input.requests,count);
 f.document.visibilityState='visible';await act(async()=>f.events.get('visibilitychange')());assert.equal(f.input.requests,count+1);
});
