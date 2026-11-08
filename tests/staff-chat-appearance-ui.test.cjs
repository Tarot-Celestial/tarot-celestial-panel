const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),{act,create}=require('react-test-renderer');
const flush=async fn=>act(async()=>{fn?.();for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const result=(worker,wallpaper='forest',revision=1)=>({profile:{worker_id:worker,avatar_kind:'character',character:'owl',photo_url:null,revision},profiles:{},preference:{wallpaper,background_url:'https://private.invalid/'+worker,revision}});
function harness(){
 const requests=[],listeners=new Map();let latest,view,props={worker:'a',thread:'ta'};
 const deps={'react':React,'react/jsx-runtime':require('react/jsx-runtime'),'lucide-react':{},'@/lib/staff-chat-client':{chatRequest:(url,init)=>{const request={url,init,...deferred()};requests.push(request);return request.promise;},ChatRequestError:class extends Error{}},'./StaffDirectChatPanel.module.css':{default:{}}};
 const document={visibilityState:'visible',addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name)=>listeners.delete(name)};
 function load(file){const exports={};const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;vm.runInNewContext(code,{exports,require:n=>deps[n],AbortController,window:{setInterval:()=>1,clearInterval(){}},document});return exports;}
 deps['@/lib/staff-chat-appearance']=load('src/lib/staff-chat-appearance.ts');
 const {useStaffChatAppearance}=load('src/components/chat/StaffChatAppearance.tsx');
 const Probe=({worker,thread})=>{latest=useStaffChatAppearance(worker,thread);return React.createElement('span',{},latest.appearance.profile.worker_id+':'+latest.appearance.preference.wallpaper);};
 return{requests,listeners,get latest(){return latest;},async mount(){await flush(()=>{view=create(React.createElement(Probe,props));});},async change(next){props={...props,...next};await flush(()=>view.update(React.createElement(Probe,props)));},async dispose(){await flush(()=>view.unmount());}};
}
test('appearance GET resolving after a save cannot restore the previous wallpaper or avatar',async()=>{
 const h=harness();await h.mount();try{
  const old=h.requests[0];await flush(()=>h.latest.setAppearance(result('a','sand',2)));assert.equal(old.init.signal.aborted,true);
  await flush(()=>old.resolve(result('a','forest',1)));assert.equal(h.latest.appearance.preference.wallpaper,'sand');assert.equal(h.latest.appearance.profile.revision,2);
 }finally{await h.dispose();}
});
test('switching worker or thread immediately clears personal images and rejects old late responses',async()=>{
 const h=harness();await h.mount();try{
  await flush(()=>h.requests[0].resolve(result('a')));assert.equal(h.latest.appearance.preference.background_url,'https://private.invalid/a');
  await h.change({thread:'tb'});assert.equal(h.latest.appearance.preference.background_url,null);
  const stale=h.requests.at(-1);await h.change({worker:'b',thread:'tb'});assert.equal(stale.init.signal.aborted,true);
  await flush(()=>stale.resolve(result('a','forest')));assert.equal(h.latest.appearance.profile.worker_id,'b');assert.equal(h.latest.appearance.preference.background_url,null);
  await flush(()=>h.latest.setAppearance(result('a','sand',5)));assert.equal(h.latest.appearance.profile.worker_id,'b');
  await flush(()=>h.requests.at(-1).resolve(result('b','midnight')));assert.equal(h.latest.appearance.preference.wallpaper,'midnight');
 }finally{await h.dispose();}
});
test('returning to the visible tab renews private appearance URLs',async()=>{
 const h=harness();await h.mount();try{
  await flush(()=>h.requests[0].resolve(result('a')));await flush(()=>h.listeners.get('visibilitychange')());
  assert.equal(h.requests.length,2);await flush(()=>h.requests[1].resolve(result('a','sand',2)));assert.equal(h.latest.appearance.preference.wallpaper,'sand');
 }finally{await h.dispose();}
});
