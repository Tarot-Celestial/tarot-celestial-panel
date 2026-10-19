const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function harness(options={}){const calls=[],cache={},network=[];function load(file){if(cache[file])return cache[file];const exports={};cache[file]=exports;const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{exports,process:{env:options.env||{}},console,Date,JSON,AbortSignal,fetch:async(...args)=>{network.push(args);throw Error('Unexpected model request');},require:name=>{if(name==='@/lib/atlas')return load('src/lib/atlas.ts');if(name==='./atlas-access')return{};if(name==='./atlas-tools')return{atlasRunTool:async(ctx,name,args)=>{calls.push({name,args});return options.reply?options.reply(name,args):{text:'Revisa la propuesta.',cards:[],proposal:{id:'test',kind:name==='prepare_password'?'change_password':'test',status:'pending'}}}};throw Error(name);}});return exports;}return{...load('src/lib/server/atlas-chat.ts'),calls,network};}
test('Spanish real commands route to narrow tools preserving requested numbers',()=>{
 const h=harness();let i=h.atlasIntent('Atlas agrega un giro de nivel 1 a Ana López');assert.equal(i.tool,'prepare_reward');assert.equal(i.args.amount,1);assert.equal(i.args.level,1);assert.equal(i.args.query,'Ana López');
 i=h.atlasIntent('Atlas agrégale 50 coins a Ana López');assert.equal(i.args.amount,50);assert.equal(i.args.reward,'coins');
 assert.equal(h.atlasIntent('Atlas ayúdame activando una promo en el panel clientes').tool,'promotions');
 assert.equal(h.atlasIntent('Atlas cambia la contraseña de esta clienta').tool,'prepare_password');
 assert.equal(h.atlasIntent('Atlas comprueba la última compra de Ana').tool,'last_purchase');
 assert.equal(h.atlasIntent('Atlas dime el último registro de llamada de Ana').tool,'last_call');
 assert.equal(h.atlasIntent('Atlas envía 10 contactos para recuperar').tool,'prepare_dispatch');
 assert.equal(h.atlasIntent('Atlas dime qué patrones ves que generan más producción').tool,'patterns');
});
test('clarifications retain target and reward until amount and level are supplied',()=>{
 const h=harness();let i=h.atlasIntent('Agrega coins a Ana');i=h.atlasIntent('25',i);assert.equal(i.args.query,'Ana');assert.equal(i.args.amount,25);
 i=h.atlasIntent('Agrega 2 giros a Ana');i=h.atlasIntent('nivel 3',i);assert.equal(i.args.query,'Ana');assert.equal(i.args.level,3);
 const p=h.atlasIntent('Promo Locura',{tool:'promotions',args:{}});assert.equal(p.tool,'prepare_promotion');assert.equal(p.args.query,'Promo Locura');
});
test('password commands and operational commands run without a model or arbitrary execution',async()=>{
 const h=harness();await h.atlasAnswer({},'Atlas cambia la contraseña de Ana',[]);assert.equal(h.calls[0].name,'prepare_password');
 const response=await h.atlasAnswer({},'Hola Atlas',[]);assert.equal(response.mode,'guided');assert.match(response.text,/configurar/);
});

test('dispatch preserves exact central names and only distributes jointly when requested',()=>{
 const h=harness();
 assert.equal(h.atlasIntent('Atlas envía 10 contactos para recuperar a Isa').args.worker,'Isa');
 assert.equal(h.atlasIntent('Atlas envía 10 contactos para recuperar a María').args.worker,'Maria');
 assert.equal(h.atlasIntent('Atlas envía 10 contactos para captar a Michael').args.worker,'Michael');
 assert.equal(h.atlasIntent('Atlas envía 10 contactos para recuperar a Isa y María').args.worker,'');
 assert.equal(h.atlasIntent('Atlas busca contactos para captar y envíale a los centrales').args.worker,'');
 const cta=h.atlasIntent('Atlas prepara 10 contactos para recuperar y repartir a las centrales. Explícame la prioridad.');assert.equal(cta.args.worker,'');assert.equal(cta.tool,'prepare_dispatch');
});

test('deactivation clarification preserves the requested operation and task CTA creates a task',()=>{
 const h=harness();const initial=h.atlasIntent('Atlas desactiva una promo');
 assert.equal(initial.tool,'promotions');assert.equal(initial.args.activate,false);
 const chosen=h.atlasIntent('Promo Locura',initial);assert.equal(chosen.tool,'prepare_promotion');assert.equal(chosen.args.activate,false);
 const button=h.atlasIntent('Desactiva la promoción 00000000-0000-4000-8000-000000000010');assert.equal(button.args.activate,false);
 assert.equal(h.atlasIntent('Atlas, prepara un encargo para mejorar la recuperación de esta semana').tool,'prepare_task');
 assert.equal(h.atlasIntent('Atlas, recuerda: avísame cuando haya bloqueos').tool,'prepare_memory');
});

test('password proposal keeps bare secret followups away from tools, memory and model',async()=>{
 const h=harness({env:{OPENAI_API_KEY:'fixture',ATLAS_ASSISTANT_MODEL:'fixture'}});
 const first=await h.atlasAnswer({},'Atlas cambia la contraseña de Ana',[]);assert.equal(first.sensitiveFollowup,true);
 const before=h.calls.length;
 const second=await h.atlasAnswer({},'SECRET_TEST_ONLY',[{role:'assistant',result:first}]);
 assert.equal(second.sensitiveFollowup,true);assert.match(second.text,/campo protegido/);assert.equal(h.calls.length,before);assert.equal(h.network.length,0);
 assert.ok(!JSON.stringify(second).includes('SECRET_TEST_ONLY'));
 const third=await h.atlasAnswer({},'recuerda que SECRET_TEST_ONLY',[{role:'assistant',result:second}]);
 assert.equal(third.sensitiveFollowup,true);assert.equal(h.calls.length,before);assert.equal(h.network.length,0);
 const cancelled=await h.atlasAnswer({},'otra cosa',[{role:'assistant',result:third}]);assert.equal(cancelled.sensitiveFollowup,undefined);
});

test('password target clarification still resolves a client without allowing memory or model calls',async()=>{
 const h=harness({reply:()=>({text:'Dime el nombre de la clienta.',cards:[]})});
 const first=await h.atlasAnswer({},'Atlas cambia la contraseña de esta clienta',[]);
 assert.equal(first.context.tool,'prepare_password');assert.equal(first.sensitiveFollowup,true);
 await h.atlasAnswer({},'Ana López',[{role:'assistant',result:first}]);
 assert.equal(h.calls.at(-1).name,'prepare_password');assert.equal(h.calls.at(-1).args.query,'Ana López');
 await h.atlasAnswer({},'recuerda que SECRET_TEST_ONLY',[{role:'assistant',result:first}]);
 assert.equal(h.calls.at(-1).name,'prepare_password');assert.equal(h.network.length,0);
});
