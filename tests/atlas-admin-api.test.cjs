const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { randomUUID } = require('node:crypto');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture(options = {}) {
  const h = { tables: {
    workers:[{id:id(101),user_id:id(1),role:'admin',display_name:'Admin',is_active:true}],
    crm_clientes:[{id:id(201),auth_user_id:id(301)}],
    atlas_admin_proposals:[],atlas_admin_messages:[],atlas_admin_memories:[],atlas_admin_jobs:[],
  },queries:[],rpcCalls:[],passwordWrites:[],answerCalls:[],authCalls:[],toolCalls:[],modelCalls:[],claim:true,authExists:true,answerError:null };
  const answer=async(_ctx,question,history)=>{h.answerCalls.push({question,history});if(h.answerError)throw h.answerError;return {text:'Datos consultados',cards:[]};};
  const db = { auth:{getUser:async token=>{h.authCalls.push(token);return {data:{user:token==='valid'?{id:id(1)}:null},error:null};},admin:{
    getUserById:async authId=>({data:{user:h.authExists?{id:authId}:null},error:null}),
    updateUserById:async(authId,body)=>{h.passwordWrites.push({authId,body});return {data:{user:{id:authId}},error:null};},
  }},rpc:async(name,args)=>{
    h.rpcCalls.push({name,args});const proposal=h.tables.atlas_admin_proposals.find(row=>row.id===args.p_proposal);
    if(name==='tc_atlas_claim')return {data:{claimed:h.claim},error:null};
    if(name==='tc_atlas_finish'){if(proposal){proposal.status=args.p_error?'failed':'completed';proposal.result=args.p_result;}return {data:{completed:true},error:null};}
    if(name==='tc_atlas_execute_action'){const replayed=proposal.status==='completed';proposal.status='completed';proposal.result={applied:true};return {data:{result:proposal.result,replayed},error:null};}
    return {data:{},error:null};
  },from(table){
    const filters=[];let limit=Infinity,order=null,mode='select',values=null,single=false,fields='*';
    const info={table,filters};h.queries.push(info);
    const matches=row=>filters.every(filter=>filter.kind==='in'?filter.value.includes(row[filter.key]):row[filter.key]===filter.value);
    const chain={select(value){fields=value;info.fields=value;return this;},eq(key,value){filters.push({key,value});return this;},in(key,value){filters.push({key,value,kind:'in'});return this;},
      order(key,options={}){order={key,ascending:options.ascending!==false};return this;},limit(value){limit=value;return this;},
      insert(value){mode='insert';values=value;info.operation=mode;info.values=value;return this;},update(value){mode='update';values=value;info.operation=mode;info.values=value;return this;},
      maybeSingle(){single=true;return this;},single(){single=true;return this;},
      then(resolve,reject){return Promise.resolve().then(()=>{
        const rows=h.tables[table]||(h.tables[table]=[]);let found=rows.filter(matches);
        if(mode==='insert'){
          const inputs=Array.isArray(values)?values:[values];found=[];
          for(const input of inputs){if(table==='atlas_admin_messages'&&input.request_id&&rows.some(row=>row.worker_id===input.worker_id&&row.role===input.role&&row.request_id===input.request_id))return {data:null,error:{code:'23505'}};
            const row={id:randomUUID(),created_at:new Date().toISOString(),...input};rows.push(row);found.push(row);}
        }
        if(mode==='update')found.forEach(row=>Object.assign(row,values));
        if(order)found=found.slice().sort((a,b)=>String(a[order.key]).localeCompare(String(b[order.key]))*(order.ascending?1:-1));
        found=found.slice(0,limit).map(row=>fields==='*'?{...row}:Object.fromEntries(fields.split(',').map(key=>[key,row[key]])));
        if(single&&found.length>1)return {data:null,error:{code:'PGRST116'}};
        return {data:single?(found[0]||null):found,error:null};
      }).then(resolve,reject);},
    };return chain;
  }};
  const cache={};function load(file){file=file.replaceAll('\\','/');if(cache[file])return cache[file];const exports={};cache[file]=exports;
    const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(code,{exports,Date,Map,Set,URL,console:{error(){}},process:{env:options.realChat?{OPENAI_API_KEY:'fake-test-key',ATLAS_ASSISTANT_MODEL:'fixture-model'}:{}},AbortSignal,fetch:async(url,init)=>{h.modelCalls.push({url,...init});return {ok:false};},require(name){
      if(name==='next/server')return {NextResponse:{json:(body,options)=>new Response(JSON.stringify(body),options)}};
      if(name==='@/lib/admin/require-admin')return {getServiceClient:()=>db};
      if(name==='@/lib/server/atlas-chat')return options.realChat?load('src/lib/server/atlas-chat.ts'):{atlasAnswer:answer,atlasAiConfigured:()=>false};
      if(options.realChat&&(name==='@/lib/server/atlas-tools'||name==='./atlas-tools'))return {...load('src/lib/server/atlas-tools.ts'),atlasRunTool:async(_ctx,name,args)=>{h.toolCalls.push({name,args});return h.toolReply?h.toolReply(name,args):{text:'Dime el nombre, teléfono o correo de la clienta.',cards:[]};}};
      if(name==='@/lib/server/atlas-operations'||name==='./atlas-operations')return {AtlasOperationsError:class extends Error{},overview:async()=>({revenue:{today:301,goal:300},acquisition:{count:10,goal:10}}),candidates:async()=>[],prepareDispatch:async()=>({})};
      if(name==='./client-promotions')return {effectivePromotionStatus:row=>row.status};
      if(name.startsWith('@/'))return load(`src/${name.slice(2)}.ts`);
      if(name.startsWith('.'))return load(path.relative(path.join(__dirname,'..'),path.resolve(path.dirname(path.join(__dirname,'..',file)),`${name}.ts`)));
      return require(name);
    }});return exports;
  }
  h.route=load('src/app/api/admin/atlas/route.ts');h.access=load('src/lib/server/atlas-access.ts');
  h.req=(body,token='valid')=>new Request('https://example.test/api/admin/atlas',{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  h.proposal=(overrides={})=>{const row={id:id(401),worker_id:id(101),kind:'change_password',title:'Cambiar contraseña de Cliente',status:'pending',payload:{client_id:id(201),auth_user_id:id(301)},...overrides};h.tables.atlas_admin_proposals.push(row);return row;};
  h.message=(overrides={})=>{const row={id:randomUUID(),worker_id:id(101),request_id:id(501),role:'user',content:'Cómo vamos hoy',result:{status:'processing'},created_at:new Date().toISOString(),...overrides};h.tables.atlas_admin_messages.push(row);return row;};return h;
}
test('Atlas verifies the bearer session and authorizes only active admins, never browser identity overrides',async()=>{
  const h=fixture();assert.equal((await h.route.GET(h.req(null,'forged.jwt.payload'))).status,401);assert.deepEqual(h.authCalls,['forged.jwt.payload']);
  h.tables.workers[0].role='central';assert.equal((await h.route.GET(h.req())).status,403);
  h.tables.workers[0].role='admin';h.tables.workers[0].is_active=false;assert.equal((await h.route.GET(h.req())).status,403);
  h.tables.workers[0].is_active=true;const response=await h.route.GET(h.req());assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
  const result=await response.json();assert.equal(result.overview.revenue.goal,300);assert.equal(result.overview.acquisition.goal,10);
  assert.ok(h.queries.filter(q=>q.table==='atlas_admin_memories').every(q=>q.filters.some(f=>f.key==='worker_id'&&f.value===id(101))));
});
test('another admin cannot execute or cancel a proposal or delete a private memory by supplying its ID',async()=>{
  const h=fixture();h.proposal({worker_id:id(999)});
  let response=await h.route.POST(h.req({action:'execute',proposalId:id(401),password:'TemporarySecret!',worker_id:id(999)}));
  assert.equal(response.status,404);assert.equal(h.passwordWrites.length,0);assert.equal(h.rpcCalls.length,0);
  response=await h.route.POST(h.req({action:'cancel_proposal',proposalId:id(401)}));assert.equal(response.status,409);assert.equal(h.tables.atlas_admin_proposals[0].status,'pending');
  h.tables.atlas_admin_memories.push({id:id(700),worker_id:id(999),active:true});await h.route.POST(h.req({action:'delete_memory',id:id(700)}));assert.equal(h.tables.atlas_admin_memories[0].active,true);
});
test('password change validates the current linked client account, rejects staff and shared Auth accounts',async()=>{
  for(const scenario of ['changed_link','staff','shared','missing_auth']){
    const h=fixture();h.proposal();
    if(scenario==='changed_link')h.tables.crm_clientes[0].auth_user_id=id(302);
    if(scenario==='staff')h.tables.workers.push({id:id(102),user_id:id(301),role:'central',is_active:true});
    if(scenario==='shared')h.tables.crm_clientes.push({id:id(202),auth_user_id:id(301)});
    if(scenario==='missing_auth')h.authExists=false;
    assert.equal((await h.route.POST(h.req({action:'execute',proposalId:id(401),password:'TemporarySecret!'}))).status,409,scenario);
    assert.equal(h.passwordWrites.length,0,scenario);assert.equal(h.rpcCalls.length,0,scenario);
  }
});
test('protected password is only sent to Auth; stored messages, RPC audit and proposal receipt exclude it, and replay changes nothing',async()=>{
  const h=fixture();h.proposal();const secret='TemporarySecret!';
  const body={action:'execute',proposalId:id(401),password:secret};assert.equal((await h.route.POST(h.req(body))).status,200);
  assert.equal(h.passwordWrites.length,1);assert.equal(h.passwordWrites[0].authId,id(301));assert.equal(h.passwordWrites[0].body.password,secret);
  assert.ok(!JSON.stringify(h.tables).includes(secret));assert.ok(!JSON.stringify(h.rpcCalls).includes(secret));assert.equal(h.answerCalls.length,0);
  assert.equal((await h.route.POST(h.req(body))).status,200);assert.equal(h.passwordWrites.length,1);
  const busy=fixture();busy.proposal();busy.claim=false;assert.equal((await busy.route.POST(busy.req(body))).status,409);assert.equal(busy.passwordWrites.length,0);
});
test('chat request IDs prevent duplicate work while processing and replay completed replies',async()=>{
  const h=fixture(),body={action:'chat',message:'Cómo vamos hoy',requestId:id(501)};h.message();
  assert.equal((await h.route.POST(h.req(body))).status,409);assert.equal(h.answerCalls.length,0);
  h.tables.atlas_admin_messages[0].result.status='failed';assert.equal((await h.route.POST(h.req(body))).status,200);assert.equal(h.answerCalls.length,1);
  assert.equal((await h.route.POST(h.req(body))).status,200);assert.equal(h.answerCalls.length,1);
});
test('a completed chat request cannot be reused with different content',async()=>{
  const h=fixture(),body={action:'chat',message:'Cómo vamos hoy',requestId:id(501)};
  assert.equal((await h.route.POST(h.req(body))).status,200);
  assert.equal((await h.route.POST(h.req({...body,message:'Activa otra promoción'}))).status,409);
  assert.equal(h.answerCalls.length,1);
});
test('a completed reply outside the history window replays without preparing a second operation',async()=>{
  const h=fixture(),body={action:'chat',message:'Cómo vamos hoy',requestId:id(501)};
  h.message({result:{status:'completed'},created_at:'2026-10-01T10:00:00Z'});
  h.message({role:'assistant',result:{text:'Respuesta anterior',cards:[]},content:'Respuesta anterior',created_at:'2026-10-01T10:00:01Z'});
  for(let i=0;i<70;i++)h.message({request_id:id(800+i),created_at:new Date(Date.now()-i).toISOString()});
  const response=await h.route.POST(h.req(body));assert.equal(response.status,200);assert.equal((await response.json()).message.text,'Respuesta anterior');assert.equal(h.answerCalls.length,0);
});
test('password-flow follow-up text cannot enter persistent chat or reach the conversational model',async()=>{
  const h=fixture({realChat:true}),secret='SecretOnlyTypedInFollowup!';h.message({role:'assistant',content:'Selecciona la clienta',result:{text:'Selecciona la clienta',context:{tool:'prepare_password',args:{query:''}}}});
  await h.route.POST(h.req({action:'chat',message:secret,requestId:id(502)}));
  assert.ok(!JSON.stringify(h.tables.atlas_admin_messages).includes(secret),'password follow-up was persisted');
  assert.ok(!JSON.stringify(h.modelCalls).includes(secret),'password follow-up was sent to conversational model');
});
test('a request to remember a password cannot persist it as a memory/chat context or reach the model',async()=>{
  const h=fixture({realChat:true}),secret='DoNotRememberThis!';
  await h.route.POST(h.req({action:'chat',message:`Atlas recuerda que mi contraseña es ${secret}`,requestId:id(503)}));
  assert.ok(!JSON.stringify(h.tables).includes(secret));assert.ok(!JSON.stringify(h.modelCalls).includes(secret));
  assert.ok(h.toolCalls.every(call=>call.name==='prepare_password'));
});
test('a pending change-password form keeps subsequent bare secrets out of chat persistence and the model',async()=>{
  const h=fixture({realChat:true});
  h.toolReply=name=>{
    if(name!=='prepare_password')return {text:'Datos consultados',cards:[]};
    const row=h.tables.atlas_admin_proposals[0]||h.proposal();
    return {text:'Introduce la nueva contraseña en el campo protegido.',cards:[],proposal:{id:row.id,kind:row.kind,title:row.title,status:row.status,requiresPassword:true}};
  };
  const prepared=await h.route.POST(h.req({action:'chat',message:`Cambia la contraseña de cliente ${id(201)}`,requestId:id(504)}));
  assert.equal(prepared.status,200);const preparation=await prepared.json();
  assert.equal(preparation.message.proposal.kind,'change_password');
  assert.equal(preparation.message.sensitiveFollowup,true,'a password proposal must retain sensitive follow-up context');
  const preparedCalls=h.toolCalls.length;
  const secret='BareSecretAfterProtectedForm!';
  const response=await h.route.POST(h.req({action:'chat',message:secret,requestId:id(505)}));
  assert.equal(response.status,200);
  assert.ok(!JSON.stringify(h.tables).includes(secret),'bare password after proposal was persisted');
  assert.equal(h.modelCalls.length,0,'password follow-up reached the model');
  assert.equal(h.toolCalls.length,preparedCalls,'a bare password after the form must not be used as a client search');
  assert.equal(h.passwordWrites.length,0,'chat text must never directly change the password');
});
test('password clarification context cannot redirect a secret-looking remember command into a memory',async()=>{
  const h=fixture({realChat:true}),secret='OnlyForProtectedField!';
  h.message({role:'assistant',created_at:'2026-10-01T10:00:00Z',content:'Selecciona la clienta',result:{text:'Selecciona la clienta',context:{tool:'prepare_password',args:{}}}});
  const response=await h.route.POST(h.req({action:'chat',message:`recuerda que ${secret}`,requestId:id(506)}));
  assert.equal(response.status,200);
  assert.ok(h.toolCalls.every(call=>call.name==='prepare_password'),'sensitive follow-up was routed to a different action');
  assert.equal(h.tables.atlas_admin_memories.length,0);
  assert.ok(!JSON.stringify(h.tables).includes(secret),'secret was retained in chat, context or proposals');
  assert.equal(h.modelCalls.length,0);
});
test('a completed sensitive chat request replays after the password context has been closed',async()=>{
  const h=fixture({realChat:true}),secret='OriginalSensitiveFollowup!';
  h.message({role:'assistant',created_at:'2026-10-01T10:00:00Z',content:'Selecciona la clienta',result:{text:'Selecciona la clienta',context:{tool:'prepare_password',args:{}}}});
  const body={action:'chat',message:secret,requestId:id(507)};
  const response=await h.route.POST(h.req(body));assert.equal(response.status,200);const first=(await response.json()).message;
  h.message({request_id:id(508),role:'assistant',created_at:new Date(Date.now()+2000).toISOString(),content:'He cerrado la preparación. ¿En qué más te ayudo?',result:{text:'He cerrado la preparación. ¿En qué más te ayudo?',cards:[]}});
  const priorCalls=h.toolCalls.length;
  const replay=await h.route.POST(h.req(body));assert.equal(replay.status,200,'retry must preserve the original redaction mode');
  assert.equal((await replay.json()).message.id,first.id);assert.equal(h.toolCalls.length,priorCalls);
  assert.ok(!JSON.stringify(h.tables).includes(secret));assert.equal(h.modelCalls.length,0);
});
