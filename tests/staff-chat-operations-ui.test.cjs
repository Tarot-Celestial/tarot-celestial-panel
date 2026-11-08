const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const text=node=>typeof node==='string'?node:(node?.children||[]).map(text).join('');
const flush=fn=>act(async()=>{fn();await new Promise(r=>setImmediate(r));});
const compiled=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/components/chat/StaffChatOperations.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
class ChatRequestError extends Error{constructor(code,status){super(code);this.code=code;this.status=status;}}
const record={id:id(50),first_name:'Michell',blocks:[{code:'FREE',minutes:10},{code:'CLIENTE',minutes:20}],total:30,revision:1,occurred_at:'2026-11-08T12:00:00Z',appeal:null};
async function fixture(t,options={}){
 const posts=[],events=[];let ids=0;
 const data={pauses:[],is_tarotist:true,can_manage:false,latest_consultation:record,pending_appeals:[],...options.data};
 const api={post:async()=>({ok:true})};const exports={};
 vm.runInNewContext(compiled,{exports,require:name=>name==='@/lib/staff-chat-client'?{chatRequest:async(url,init={})=>{if(init.method==='POST'){const p=JSON.parse(init.body);posts.push(p);return api.post(p);}return data;},ChatRequestError}:name==='@/lib/staff-chat-operations'?{pauseLabel:kind=>({bathroom:'en el baño',lunch:'almorzando',break:'en descanso'}[kind]),operationErrorMessage:code=>code}:name.endsWith('.module.css')?{default:{}}:require(name),AbortController,Event,crypto:{randomUUID:()=>id(++ids+100)},window:{setInterval:()=>1,clearInterval(){},dispatchEvent:event=>events.push(event.type)},document:{hidden:false}});
 let view;const props={threadId:id(10),me:{id:id(2),role:'tarotista',display_name:'Nora'},hasConsultationMessage:false,...options.props};
 await act(async()=>{view=create(React.createElement(exports.default,props));});t.after(()=>act(()=>view.unmount()));
 const btn=label=>view.root.findAllByType('button').find(b=>text(b)===label);
 return {view,props,api,data,posts,events,btn,exports};
}
test('tarotista has bathroom and permission requests; latest call shows only compact codes and first name',async t=>{
 const f=await fixture(t);assert.ok(f.btn('Voy al baño'));assert.ok(f.btn('Pedir almuerzo'));assert.ok(text(f.view.toJSON()).includes('10 free20 clienteMichell'));assert.ok(f.btn('Revisar minutos o código'));
 await flush(()=>f.btn('Pedir almuerzo').props.onClick());assert.equal(f.posts[0].action,'request_lunch');assert.equal(f.posts[0].expected_worker_id,id(2));assert.deepEqual(f.events,['staff-chat-operations-changed']);
});
test('uncertain result retains operation UUID and double clicking cannot duplicate request',async t=>{
 const f=await fixture(t);f.api.post=async()=>{throw new ChatRequestError('NETWORK_ERROR',0);};
 await flush(()=>{f.btn('Voy al baño').props.onClick();f.btn('Voy al baño').props.onClick();});assert.equal(f.posts.length,1);assert.equal(f.btn('Pedir almuerzo').props.disabled,true);
 f.api.post=async()=>({ok:true});await flush(()=>f.btn('Comprobar solicitud').props.onClick());assert.deepEqual(f.posts[0],f.posts[1]);assert.equal(f.btn('Comprobar solicitud'),undefined);
});
test('fallback call card is hidden when a consultation message already appears in the loaded feed',async t=>{
 const f=await fixture(t,{props:{hasConsultationMessage:true}});assert.equal(f.view.root.findAllByProps({'aria-label':'Última consulta registrada'}).length,0);
});
test('central can accept pending lunch while tarotista sees return for active pause',async t=>{
 const pause={id:id(30),thread_id:id(10),worker_id:id(2),worker_name:'Nora',kind:'lunch',status:'pending',revision:2};
 const f=await fixture(t,{props:{me:{id:id(1),role:'central',display_name:'Central'}},data:{is_tarotist:false,can_manage:true,pauses:[pause]}});
 assert.ok(f.btn('Aceptar'));await flush(()=>f.btn('Aceptar').props.onClick());assert.equal(f.posts[0].action,'approve_break');assert.equal(f.posts[0].revision,2);
 const g=await fixture(t,{data:{pauses:[{...pause,status:'active'}]}});assert.ok(g.btn('He regresado'));assert.equal(g.btn('Voy al baño'),undefined);await flush(()=>g.btn('He regresado').props.onClick());assert.equal(g.posts[0].action,'return');
});
test('appeal sends exact current revision and reason rather than rewriting call or balance',async t=>{
 const f=await fixture(t);await flush(()=>f.btn('Revisar minutos o código').props.onClick());await flush(()=>f.view.root.findByType('textarea').props.onChange({target:{value:'Fueron 15 cliente'}}));
 await flush(()=>f.view.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(f.posts[0].action,'appeal');assert.equal(f.posts[0].target_id,record.id);assert.equal(f.posts[0].revision,1);assert.equal(f.posts[0].reason,'Fueron 15 cliente');assert.equal(f.posts[0].minutes,undefined);
});
test('pending appeal survives source deletion and central can resolve it without changing source',async t=>{
 const appeal={id:id(80),call_id:id(81),revision:0,call_revision:0,status:'pending',reason:'Código equivocado'};
 const f=await fixture(t,{props:{me:{id:id(1),role:'central',display_name:'Central'}},data:{is_tarotist:false,can_manage:true,latest_consultation:null,pending_appeals:[{...record,id:id(81),first_name:'Clienta',blocks:[],deleted:true,appeal}]}});
 assert.ok(text(f.view.toJSON()).includes('El registro fue retirado'));await flush(()=>f.btn('Responder a la revisión').props.onClick());await flush(()=>f.view.root.findByType('textarea').props.onChange({target:{value:'Se anuló en Rendimiento'}}));await flush(()=>f.view.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(f.posts[0].action,'resolve_appeal');assert.equal(f.posts[0].target_id,id(80));
});
