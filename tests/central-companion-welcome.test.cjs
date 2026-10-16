const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),renderer=require('react-test-renderer');
function transpile(file){return ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;}
const guide={};vm.runInNewContext(transpile('lib/central-assistant.ts'),{exports:guide,Intl,Date});
function fixture(){
  const calls=[],storage=new Map(),timers=new Map(),document={hidden:false,activeElement:null,addEventListener(){},removeEventListener(){}};
  let serial=0,hook,tree;
  class Element{constructor(tagName){this.tagName=tagName;}}
  const api={},window={addEventListener(){},removeEventListener(){}};
  const add=(fn,ms)=>{timers.set(++serial,{fn,ms});return serial;};
  vm.runInNewContext(transpile('features/central/assistant/useCompanionInitiative.ts'),{exports:api,require:n=>n==='react'?React:guide,document,window,HTMLElement:Element,Date,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},setTimeout:add,setInterval:add,clearTimeout:id=>timers.delete(id),clearInterval:id=>timers.delete(id)});
  function Harness(props){hook=api.useCompanionInitiative({ready:true,open:false,busy:false,mini:false,tab:'central',pet:'ambar',name:'Isa',workerId:'worker-one',preferences:{proactive:true,humor:true,sound:false},bubble:'',say:text=>calls.push(text),...props});return null;}
  return {calls,storage,document,Element,mount:p=>renderer.act(()=>{tree=renderer.create(React.createElement(Harness,p));}),update:p=>renderer.act(()=>tree.update(React.createElement(Harness,p))),tick:ms=>renderer.act(()=>[...timers.values()].filter(t=>t.ms===ms).forEach(t=>t.fn())),hush:()=>renderer.act(()=>hook.hush()),stop:()=>renderer.act(()=>tree.unmount())};
}
test('all three identities are valid; malformed profiles fall back safely',()=>{
  for(const pet of ['sol','draco','ambar'])assert.equal(guide.normalizePetId(pet),pet);
  for(const input of [null,{},'__proto__','admin'])assert.equal(guide.normalizePetId(input),'draco');
  assert.match(guide.companionWelcome('ambar','Isa Saldana',false),/Hola, Isa\. Soy Ámbar/);
  assert.doesNotMatch(guide.companionWelcome('sol','',true),/undefined|null/);
});
test('welcome uses worker identity and does not repeat after rerender or same-day remount',()=>{
  const f=fixture();f.mount();f.tick(1800);assert.equal(f.calls.length,1);assert.match(f.calls[0],/Ámbar/);
  f.update({tab:'captacion'});f.tick(10000);assert.equal(f.calls.length,1);f.stop();
  f.mount();f.tick(1800);assert.equal(f.calls.length,1);f.stop();
});
test('a second worker receives their own name and mascot, never the previous greeting',()=>{
  const f=fixture();f.mount();f.tick(1800);
  f.update({workerId:'worker-two',pet:'sol',name:'Maria'});f.tick(1800);
  assert.equal(f.calls.length,2);assert.match(f.calls[1],/Hola, Maria\. Soy Sol/);f.stop();
});
test('welcome waits while typing, in a hidden tab or during an urgent reservation',()=>{
  const f=fixture();f.document.activeElement=new f.Element('INPUT');f.mount();f.tick(1800);assert.equal(f.calls.length,0);
  f.document.activeElement=null;f.document.hidden=true;f.tick(10000);assert.equal(f.calls.length,0);
  f.document.hidden=false;f.update({urgent:true});f.tick(10000);assert.equal(f.calls.length,0);
  f.update({urgent:false});f.tick(10000);assert.equal(f.calls.length,1);f.stop();
});
test('disabled initiative and snooze suppress welcome without recording a false delivery',()=>{
  const f=fixture();f.mount({preferences:{proactive:false,sound:false}});f.tick(1800);assert.equal(f.storage.size,0);
  f.update({preferences:{proactive:true,sound:false}});f.hush();f.tick(10000);assert.equal(f.storage.size,0);assert.deepEqual(f.calls,['']);f.stop();
});
