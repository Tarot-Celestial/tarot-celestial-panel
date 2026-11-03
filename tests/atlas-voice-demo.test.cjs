const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function fixture(options={}){
 const h={auth:[],queries:[],provider:[],role:options.role||'admin',active:options.active!==false};
 const db={auth:{getUser:async token=>{h.auth.push(token);return token==='valid'?{data:{user:{id:'user-demo'}},error:null}:{data:{user:null},error:{}};}},from(table){h.queries.push(table);assert.equal(table,'workers');const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:{id:'worker-demo',user_id:'user-demo',role:h.role,is_active:h.active},error:null};}};return q;}};
 const cache={};
 function load(file){if(cache[file])return cache[file];const exports={};cache[file]=exports;vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Map,Set,URL,AbortSignal,process:{env:options.key===false?{}:{GEMINI_API_KEY:'secret-never-return'}},fetch:async(url,init)=>{h.provider.push({url,...init});if(options.throw)throw new Error('secret-never-return upstream');return {ok:!options.status,status:options.status||200,json:async()=>({name:'auth_tokens/fixture-only'})};},require(name){if(name==='next/server')return{NextResponse:{json:(b,o)=>new Response(JSON.stringify(b),o)}};if(name==='@/lib/admin/require-admin')return{getServiceClient:()=>db};if(name.startsWith('@/'))return load('src/'+name.slice(2)+'.ts');throw new Error(name);}});return exports;}
 h.demo=load('src/lib/atlas-voice-demo.ts');h.route=load('src/app/api/admin/atlas/voice/route.ts');h.req=(body,token='valid',origin)=>new Request('https://panel.test/api/admin/atlas/voice',{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json',...(origin?{origin}:{})},body:body?JSON.stringify(body):undefined});return h;
}
const body={mode:'fictional',freeTierConfirmed:true,teachings:[]};
test('voice requires a verified active admin; only workers are queried',async()=>{
 const h=fixture();assert.equal((await h.route.GET(h.req(null,'forged'))).status,401);h.role='central';assert.equal((await h.route.GET(h.req())).status,403);h.role='admin';h.active=false;assert.equal((await h.route.POST(h.req(body))).status,403);assert.equal(h.provider.length,0);assert.ok(h.queries.every(t=>t==='workers'));
});
test('configuration is private and never exposes the stored secret or calls Google',async()=>{
 const h=fixture(),r=await h.route.GET(h.req());assert.equal(r.headers.get('cache-control'),'private, no-store');const data=await r.json();assert.equal(data.configured,true);assert.ok(!JSON.stringify(data).includes('secret'));assert.equal(h.provider.length,0);
});
test('no configured key, no consent or an external origin cannot open a provider session',async()=>{
 for(const [options,b,origin,expected]of [[{key:false},body,null,503],[{}, {...body,mode:'real'},null,400],[{}, {...body,freeTierConfirmed:false},null,400],[{},body,'https://foreign.test',403],[{}, {...body,teachings:['x'.repeat(401)]},null,400]]){
 const h=fixture(options);assert.equal((await h.route.POST(h.req(b,'valid',origin))).status,expected);assert.equal(h.provider.length,0);
 }
});
test('token is one-use, short-lived and locks model, instructions and tools despite browser overrides',async()=>{
 const h=fixture(),r=await h.route.POST(h.req({...body,model:'evil',tools:[{name:'charge'}],workerId:'someone-else'}));assert.equal(r.status,200);const out=await r.json();assert.equal(out.token,'auth_tokens/fixture-only');assert.ok(!JSON.stringify(out).includes('secret-never-return'));const sent=JSON.parse(h.provider[0].body);assert.equal(sent.uses,1);assert.ok(Date.parse(sent.expireTime)-Date.now()<=320000);assert.ok(Date.parse(sent.newSessionExpireTime)-Date.now()<=60000);assert.equal(sent.fieldMask,undefined);assert.equal(sent.bidiGenerateContentSetup.model,'models/gemini-3.8-live');assert.equal(sent.bidiGenerateContentSetup.tools[0].functionDeclarations.length,2);assert.match(sent.bidiGenerateContentSetup.systemInstruction.parts[0].text,/FICTICIOS/);
 assert.equal((await h.route.POST(h.req(body))).status,429);assert.equal(h.provider.length,1);
});
test('provider rejection and transport errors are redacted and never fall back to a paid provider',async()=>{
 for(const options of [{status:429},{status:403},{throw:true}]){const h=fixture(options),r=await h.route.POST(h.req(body));assert.ok(r.status>=400);assert.ok(!(await r.text()).includes('secret-never-return'));assert.equal(h.provider.length,1);}
});
test('fixture search exposes ambiguity and rejects real identifiers or unknown tools',()=>{
 const {VoiceDemo}=fixture().demo,d=new VoiceDemo();assert.equal(d.run('a','consultar_demo',{query:'maria'}).clients.length,2);assert.ok(d.run('b','preparar_demo',{kind:'llamada',clientId:'19393394347'}).error);assert.ok(d.run('c','send_payment',{}).error);
});
test('reservation requires exact fictional staff and a future zoned time',()=>{
 const {VoiceDemo}=fixture().demo,d=new VoiceDemo(),args={kind:'reserva',clientId:'demo-alba',staffId:'demo-josefa'};
 assert.ok(d.run('a','preparar_demo',{...args,when:'2030-01-01T10:00'}).error);assert.ok(d.run('b','preparar_demo',{...args,when:'2000-01-01T10:00Z'}).error);
 assert.equal(d.run('c','preparar_demo',{...args,when:'2030-01-01T10:00:00+01:00'}).status,'pending_confirmation');assert.equal(d.reservations.length,0);d.resolve('c',true);d.resolve('c',true);assert.equal(d.reservations.length,1);
});
test('payment always asks for the account and generates no live payment URL',()=>{
 const {VoiceDemo}=fixture().demo,d=new VoiceDemo(),args={kind:'cobro',clientId:'demo-alba',amount:35};
 assert.ok(d.run('a','preparar_demo',args).error);const r=d.run('b','preparar_demo',{...args,paymentAccount:'leonaris'});assert.equal(r.status,'pending_confirmation');assert.match(r.proposal.detail,/Leonaris/);assert.ok(!JSON.stringify(r).includes('https:'));assert.equal(d.resolve('b',true).realActions,0);
});
test('minute correction is reviewed, applies once, cancels safely and cannot reuse an operation ID',()=>{
 const {VoiceDemo}=fixture().demo,d=new VoiceDemo(),args={kind:'corregir_minutos',clientId:'demo-alba',minutes:30};
 d.run('a','preparar_demo',args);assert.equal(d.balances['demo-alba'],20);assert.ok(d.run('b','preparar_demo',args).error);
 d.resolve('a',false);assert.equal(d.balances['demo-alba'],20);
 const r=d.run('c','preparar_demo',args);assert.equal(r.status,'pending_confirmation');d.resolve('c',true);d.resolve('c',true);d.run('c','preparar_demo',args);assert.equal(d.balances['demo-alba'],30);assert.equal(d.lastMinutes,30);assert.ok(d.run('c','preparar_demo',{...args,minutes:20}).error);
});
test('ending a session cancels pending proposals without performing them',()=>{
 const {VoiceDemo}=fixture().demo,d=new VoiceDemo();d.run('a','preparar_demo',{kind:'mensaje',staffId:'demo-josefa',message:'Mensaje de prueba'});d.cancelPending();assert.equal(d.resolve('a',true).status,'cancelled');
});
