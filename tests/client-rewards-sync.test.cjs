const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),{act,create}=require('react-test-renderer');
const flush=fn=>act(async()=>{fn?.();await new Promise(resolve=>setImmediate(resolve));});
function load(file,imports={},globals={}) {
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:n=>n in imports?imports[n]:require(n),Error,AbortSignal,console,...globals});
 return exports;
}
const reward=cost=>({id:'reward-10',nombre:'10 minutos',puntos_coste:cost,minutos_otorgados:10,activo:true});
const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join('');

test('an open rewards catalogue refreshes on focus and visible polling without the dashboard API',async()=>{
 const listeners=new Map();let interval,state,view,cost=500,fail=false,requests=0;
 const document={hidden:false,addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
 const window={setInterval:f=>{interval=f;return 1;},clearInterval:()=>{interval=null;},addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
 const {useClientRewards}=load('src/hooks/useClientRewards.ts',{}, {window,document,fetch:async(url,init)=>{requests++;assert.match(url,/^\/api\/cliente\/recompensas\?fresh=/);assert.equal(init.cache,'no-store');if(fail)throw new Error('offline');return {ok:true,json:async()=>({ok:true,recompensas:[reward(cost)]})};}});
 function Fixture(){state=useClientRewards();return React.createElement('span',null,state.rewards[0]?.puntos_coste);}
 await flush(()=>{view=create(React.createElement(Fixture));});
 try {
  assert.equal(text(view.toJSON()),'500');
  fail=true;await flush(()=>listeners.get('focus')());assert.ok(state.error);
  fail=false;cost=800;await flush(()=>listeners.get('online')());
  assert.equal(text(view.toJSON()),'800');assert.equal(state.error,'');
  document.hidden=true;const before=requests;await flush(()=>interval());assert.equal(requests,before);
  document.hidden=false;cost=900;await flush(()=>interval());assert.equal(text(view.toJSON()),'900');
 } finally {await flush(()=>view.unmount());}
 assert.equal(listeners.size,0);assert.equal(interval,null);
});

test('confirmation submits the displayed quote and closes without success when the server rejects an old price',async()=>{
 const Component=load('src/components/cliente/CanjePuntos.tsx',{'./RouletteRewardArt':{default:()=>null}}).default;
 const quotes=[];let view;
 const props={puntos:2000,loading:false,onRedeem:async(...args)=>{quotes.push(args);throw new Error('CATALOGO_ACTUALIZADO');}};
 await flush(()=>{view=create(React.createElement(Component,{...props,recompensas:[reward(500)]}));});
 try {
  await flush(()=>view.root.findAllByType('button').find(x=>text(x)==='Canjear').props.onClick());
  await flush(()=>view.update(React.createElement(Component,{...props,recompensas:[reward(800)]})));
  await flush(()=>view.root.findAllByType('button').find(x=>text(x)==='Confirmar canje').props.onClick());
  assert.deepEqual(quotes,[['reward-10',500,10]]);
  assert.equal(view.root.findAllByProps({role:'dialog'}).length,0);
  assert.match(text(view.toJSON()),/800 Coins/);
  assert.doesNotMatch(text(view.toJSON()),/RECOMPENSA DESBLOQUEADA/);
 } finally {await flush(()=>view.unmount());}
});
