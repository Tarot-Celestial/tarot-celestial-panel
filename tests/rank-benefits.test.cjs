const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');
const { act } = renderer;
function load(file,mocks={},globals={}) {
 const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../',file),'utf8'),{
   compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},
 }).outputText;
 const exports={};
 vm.runInNewContext(code,{exports,require:name=>{
   if(Object.hasOwn(mocks,name)) return mocks[name];
   if(name.endsWith('.module.css')) return {default:new Proxy({},{get:(_,key)=>String(key)}),__esModule:true};
   if(name.startsWith('.')) {
     const target=path.join(path.dirname(file),name)+'.tsx';
     if(fs.existsSync(path.join(__dirname,'../',target)))return load(target,mocks,globals);
   }
   return require(name);
 },console,Request,Response,URL,setTimeout,clearTimeout,...globals});
 return exports;
}
const config=load('src/lib/rank-benefit-config.ts');
const sb={auth:{getSession:async()=>({data:{session:{access_token:'test-only'}}})}};
test('rejects malformed config, decimal/negative Coins and wrong permission types',()=>{
 const base={rank_key:'diamante',purchase_coins:500,ritual_access:true,revision:0};
 for(const bad of [{purchase_coins:-1},{purchase_coins:1.5},{purchase_coins:'750'},{ritual_access:'true'},{revision:-1},{rank_key:'../admin'}]) {
   assert.throws(()=>config.validateRankBenefitEdit({...base,...bad}));
 }
 assert.equal(config.validateRankBenefitEdit(base).purchase_coins,500);
});
test('F: Admin retains edits on failed save, shows error, then shows success only after acknowledgement',async()=>{
 let fail=true,posted;
 const row={rank_key:'diamante',label:'Diamante',sort_order:4,purchase_coins:500,ritual_access:true,revision:0};
 const Panel=load('src/components/admin/RankBenefitsPhaseOne.tsx',{
   '@/lib/supabase-browser':{supabaseBrowser:()=>sb}, '@/lib/rank-benefit-config':config,
   '@/components/benefits/CrystalEmblem':()=>null,
 },{fetch:async(_,options)=>{
   if(options.method==='GET') return {ok:true,json:async()=>({ok:true,ranks:[row]})};
   posted=JSON.parse(options.body);
   return fail ? {ok:false,json:async()=>({ok:false,error:'Supabase unavailable'})}
    : {ok:true,json:async()=>({ok:true,saved:{...row,...posted,revision:1}})};
 }}).default;
 let view;await act(async()=>{view=renderer.create(React.createElement(Panel))});
 const input=()=>view.root.findByProps({type:'number'});
 await act(async()=>input().props.onChange({target:{value:'750'}}));
 await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
 assert.equal(input().props.value,'750');assert.equal(posted.purchase_coins,750);
 assert.match(JSON.stringify(view.toJSON()),/Supabase unavailable/);
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/Guardado correctamente/);
 fail=false;await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
 assert.match(JSON.stringify(view.toJSON()),/Guardado correctamente/);
 act(()=>view.unmount());
});
test('C/D/E: client navigation renders Mi ritual only when permission is true, regardless of rank',()=>{
 for(const [rank,ritualAccess] of [['diamante',false],['bronce',true],['oro',false]]) {
   const Layout=load('src/components/cliente/ClienteLayout.tsx',{
     'next/link':({children,...p})=>React.createElement('a',p,children),
     'next/image':()=>null,'next/navigation':{usePathname:()=>'/cliente/dashboard',useRouter:()=>({})},
     '@/hooks/useClientPanelRank':{useClientPanelState:()=>({rank,ritualAccess})},
     '@/components/ui/PanelTheme':({children})=>React.createElement('div',null,children),'@/lib/supabase-browser':{supabaseClienteBrowser:()=>sb},
     '@/lib/leo-celestial-events':{announceLeoCelestial:()=>{}},'./LeoCelestialGuide':()=>null,
   }).default;
   // SSR does not run unrelated polling effects; it tests actual navigation output.
   const html=require('react-dom/server').renderToStaticMarkup(React.createElement(Layout,{title:'Panel'},'Content'));
   assert.equal(html.includes('href="/cliente/ritual"'),ritualAccess);
 }
});
test('Admin endpoint rejects non-admins and propagates database failure without success',async()=>{
 let allowed=false,calls=0;
 const routes=load('src/app/api/admin/rank-benefits/phase-one/route.ts',{
   '@/lib/admin/require-admin':{requireAdmin:async()=>allowed?{ok:true,admin:{rpc:async()=>{calls++;return {data:null,error:{message:'DB failure'}}}}}:{ok:false,error:'FORBIDDEN'}},
   '@/lib/rank-benefit-config':config,
 });
 const request=()=>new Request('http://local.test/api/admin/rank-benefits/phase-one',{method:'POST',body:JSON.stringify({rank_key:'diamante',purchase_coins:750,ritual_access:true,revision:0})});
 assert.equal((await routes.POST(request())).status,403);assert.equal(calls,0);
 allowed=true;const response=await routes.POST(request());assert.equal(response.status,500);
 const body=await response.json();assert.equal(body.ok,false);assert.equal(body.error,'DB failure');
});
test('direct ritual API access without permission returns no ritual and never queries ritual rows',async()=>{
 let checkedClient;
 const routes=load('src/app/api/cliente/ritual/route.ts',{
   '@/lib/server/auth-cliente':{clientFromRequest:async()=>({uid:'auth-user',cliente:{id:'own-client'},admin:{from(){throw new Error('Must not read ritual rows')}}})},
   '@/lib/server/rank-benefits':{clientRankBenefits:async(_,id)=>{checkedClient=id;return {rank_key:'diamante',purchase_coins:750,ritual_access:false}}},
   '@/lib/rituals':{computeRitual:()=>{throw new Error('Must not expose ritual data')}},
 });
 const response=await routes.GET(new Request('http://local.test/api/cliente/ritual?cliente_id=someone-else'));
 const body=await response.json();assert.equal(checkedClient,'own-client');
 assert.equal(body.ritual_access,false);assert.equal(body.ritual,null);assert.deepEqual(body.history,[]);
});
