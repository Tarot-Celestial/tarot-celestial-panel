const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
const {act,create}=require('react-test-renderer');
function load(file,mocks,globals={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:n=>n in mocks?mocks[n]:n.endsWith('.module.css')?{default:{}}:require(n),...globals});return exports;}
test('API rejects unauthorized reads/writes and derives actor from the admin session',async()=>{
 let allowed=false,captured;
 const route=load('src/app/api/admin/client-balances/route.ts',{'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},'@/lib/admin/require-admin':{requireAdmin:async()=>allowed?{ok:true,me:{user_id:'trusted-admin'},admin:{rpc:async(n,p)=>{captured=p;return {data:{},error:null}}}}:{ok:false}}},{URL});
 assert.equal((await route.GET({url:'https://example.test/api?id=x'})).status,403);
 assert.equal((await route.POST({})).status,403);allowed=true;
 const payload={cliente_id:'00000000-0000-4000-8000-000000000001',operation_id:'00000000-0000-4000-8000-000000000002',level:3,delta:1,reason:'Corrección',actor_user_id:'untrusted'};
 assert.equal((await route.POST({json:async()=>payload})).status,200);assert.equal(captured.p_actor_user_id,'trusted-admin');
 assert.equal((await route.POST({json:async()=>({...payload,delta:0})})).status,400);
});
test('UI displays real balances and retries uncertain saves with the same operation id',async()=>{
 const client={id:'one',nombre:'Ana',apellido:'Prueba',telefono:'123',email:'test@example.test'};
 const detail={ok:true,cliente:client,wallet:{coins:87,minutes_total:19,minutes_free:7,minutes_normal:12,effective_rank:'oro'},spins:[1,2,3,4,5].map(level=>({level,count:level,available:level===5?0:level})),history:[]};
 const posts=[];let fail=true;
 const component=load('src/components/admin/ClientBalancesPanel.tsx',{'@/lib/supabase-browser':{supabaseBrowser:()=>({auth:{getSession:async()=>({data:{session:{access_token:'session'}}})}})}},{window:{setInterval:()=>1,clearInterval(){},addEventListener(){},removeEventListener(){}},document:{hidden:false},crypto:{randomUUID:()=> 'operation-one'},fetch:async(url,init)=>{
  if(init.method==='POST'){posts.push(JSON.parse(init.body));if(fail)throw Error('connection lost');return {ok:true,status:200,json:async()=>({ok:true})};}
  return {ok:true,status:200,json:async()=>url.includes('?q=')?{ok:true,clients:[client]}:detail};
 }}).default;
 let view;await act(async()=>{view=create(React.createElement(component))});
 const flush=async(fn)=>act(async()=>{fn();await new Promise(resolve=>setImmediate(resolve))});
 const text=node=>typeof node==='string'?node:(node?.children||[]).map(text).join('');
 await flush(()=>view.root.findAllByType('input')[0].props.onChange({target:{value:'Ana'}}));
 await flush(()=>view.root.findAllByType('form')[0].props.onSubmit({preventDefault(){}}));
 await flush(()=>view.root.findAllByType('button').find(b=>text(b).includes('Ana Prueba')).props.onClick());
 assert.ok(text(view.toJSON()).includes('87'));assert.ok(text(view.toJSON()).includes('19'));
 await flush(()=>view.root.findByProps({'aria-label':'Ajustar giros'}).findByType('textarea').props.onChange({target:{value:'Reposición solicitada'}}));
 await flush(()=>view.root.findByProps({'aria-label':'Ajustar giros'}).props.onSubmit({preventDefault(){}}));
 assert.equal(view.root.findByProps({'aria-label':'Ajustar giros'}).findByType('fieldset').props.disabled,true);
 fail=false;await flush(()=>view.root.findByProps({'aria-label':'Ajustar giros'}).props.onSubmit({preventDefault(){}}));
 assert.equal(posts.length,2);assert.equal(posts[0].operation_id,posts[1].operation_id);assert.equal(view.root.findByProps({'aria-label':'Ajustar giros'}).findByType('fieldset').props.disabled,false);assert.ok(text(view.toJSON()).includes('Ajuste guardado'));
 act(()=>view.unmount());
});


