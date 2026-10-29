// LOCAL ONLY: API routes and provider SDK intercepted; synthetic accounts/cards.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
process.env.TC_PRICES_QA_OUTPUT ||= path.resolve(__dirname,'../../outputs/oracle-paypal-qa');
const fixtureFile=path.join(__dirname,'client-paypal-browser.cjs'),fixtureModule=new Module(fixtureFile);
fixtureModule.filename=fixtureFile;fixtureModule.paths=Module._nodeModulePaths(path.dirname(fixtureFile));
const fixtureSource=fs.readFileSync(fixtureFile,'utf8');
fixtureModule._compile(fixtureSource.slice(0,fixtureSource.lastIndexOf('\n(async () => {'))+'\nmodule.exports={checkoutFixture,playwright,rendered,shot,noOverflow,baseURL,origin,output,ids,errors,transactions,baseSession,ref,attemptId,cardPath};',fixtureFile);
const {checkoutFixture,playwright,rendered,shot,noOverflow,baseURL,origin,output,ids,errors,transactions,baseSession,ref,attemptId,cardPath}=fixtureModule.exports;
const checks=[],failures=[];
const packs=[{id:'oracle_2',name:'Pack Oráculo',price:1,credits:2,questions:0},{id:'destino_3',name:'Pack Destino',price:2,credits:3,questions:0},{id:'oracle_questions_3',name:'Preguntas al Oráculo',price:2,credits:0,questions:3}];
const oracleArticle=(page,pack)=>page.locator('#oraculo-packs article').filter({has:page.getByRole('heading',{name:pack.name,exact:true})});
const key=pack=>`tc-client-purchase-attempt:v1:${ids.A}:${pack.id}`;
function configure(f,pack){
  f.state.checkoutBody={ok:true,url:origin+cardPath,attempt_id:attemptId,amount:pack.price,currency:'EUR',status:'pending'};
  f.state.session={...baseSession,amount:pack.price,description:pack.name,purchase_kind:'oracle',purchase_summary:{purchaseKind:'oracle',packName:pack.name,totalMinutes:0,normalMinutes:0,freeMinutes:0,oracleCredits:pack.credits,oracleQuestions:pack.questions}};
  f.state.result={...f.state.session,status:'completed',remote_status:'COMPLETED',can_pay:false,can_cancel:false,credited:true};
}
async function check(name,fn){try{await fn();checks.push(name);console.log('PASS: '+name);}catch(error){failures.push({name,error:error.message,stack:error.stack});console.log('FAIL: '+name+': '+error.message);}}
async function questionsEntry(f){
  await f.context.route('**/api/cliente/oraculo',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,freeAvailable:false,freeDailyAvailable:false,credits:0,deckSize:22,questionState:{includedAvailable:false,includedUsed:true,extra:0,total:0},mensajes:[],latestDraw:{id:'draw-fixture',cardId:'star',cardName:'La Estrella',cardImage:'/images/portal/logo.webp',tema:'general',fecha:'2026-10-29',keyword:'Claridad',advice:'Lectura simulada',message:'Lectura simulada de prueba',isFree:true,revealedAt:'2026-10-29T00:00:00Z',selectedPosition:1}})}));
  await f.page.goto(baseURL+'/cliente/oraculo',{waitUntil:'domcontentloaded',timeout:120000});
  await f.page.getByRole('button',{name:'CONTINUAR HABLANDO CON EL ORÁCULO',exact:true}).waitFor();
}
(async () => {
 const browser=await playwright.chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
 try{
  for(const pack of packs)await check(`${pack.id}: EUR price, one checkout, correct Oracle receipt and confirmed balance event`,async()=>{
   const f=await checkoutFixture(browser,{name:pack.id});configure(f,pack);
   try{
    await f.start();await rendered(f.page);const article=oracleArticle(f.page,pack);
    assert.match(await article.innerText(),new RegExp(pack.price.toFixed(2).replace('.',',')+'\\s*€'));assert.ok(!(await article.innerText()).includes('$'));
    f.state.holdCheckout=true;await article.getByRole('button',{name:'COMPRAR',exact:true}).evaluate(button=>{button.click();button.click();});
    await article.getByRole('button',{name:'Conectando…',exact:true}).waitFor();assert.equal(f.calls.filter(x=>x.path==='checkout').length,1);
    assert.equal(f.calls[0].body.packId,pack.id);assert.deepEqual(Object.keys(f.calls[0].body).sort(),['attemptId','packId']);
    for(const button of await f.page.locator('#oraculo-packs').getByRole('button').all())assert.equal(await button.isDisabled(),true);
    await shot(f.page,pack.id+'-preparing');f.release();await f.page.waitForURL('**/pago-tarjeta?ref='+ref);
    await f.page.getByRole('button',{name:new RegExp('Pagar '+pack.price.toFixed(2).replace('.',','))}).waitFor();
    const summary=f.page.getByLabel('Oráculo de tu compra');await summary.waitFor();assert.match(await summary.innerText(),pack.questions?/3 preguntas adicionales/:new RegExp(pack.credits+' tiradas del Oráculo'));
    assert.doesNotMatch(await f.page.locator('main').innerText(),/0 minutos|minutos normales|minutos y beneficios/);
    await shot(f.page,pack.id+'-card');await f.page.getByRole('button',{name:/^Pagar /}).click();
    await f.page.getByRole('heading',{name:'Pago confirmado',exact:true}).waitFor();
    assert.equal(await f.page.getByRole('link',{name:'Volver a mi Oráculo',exact:true}).getAttribute('href'),'/cliente/oraculo');
    assert.equal(await f.page.evaluate(k=>localStorage.getItem(k),key(pack)),null);assert.equal(await f.page.evaluate(()=>window.__checkoutQA.balanceEvents),1);
    await shot(f.page,pack.id+'-receipt');
   }finally{await f.close();}
  });
  await check('Oracle ambiguous failure survives reload with the same attempt ID and offers a validated pending link',async()=>{
   const f=await checkoutFixture(browser,{name:'oracle-unknown'}),pack=packs[0];configure(f,pack);
   try{
    f.state.checkoutStatus=503;f.state.checkoutBody={ok:false,error:'Prueba: respuesta del pago pendiente.'};
    await f.start();await rendered(f.page);await oracleArticle(f.page,pack).getByRole('button',{name:'COMPRAR',exact:true}).click();await oracleArticle(f.page,pack).getByRole('alert').waitFor();const first=f.calls[0].body.attemptId;
    await f.page.reload();await rendered(f.page);f.state.checkoutStatus=409;f.state.checkoutBody={ok:false,error:'Tienes una compra pendiente.',url:origin+cardPath};
    await oracleArticle(f.page,pack).getByRole('button',{name:'COMPRAR',exact:true}).click();const link=oracleArticle(f.page,pack).getByRole('link',{name:'Revisar pago pendiente',exact:true});await link.waitFor();
    assert.equal(f.calls[1].body.attemptId,first);assert.equal(await link.getAttribute('href'),cardPath);assert.equal(new URL(f.page.url()).pathname,'/cliente/precios-ofertas');
    assert.equal(JSON.parse(await f.page.evaluate(k=>localStorage.getItem(k),key(pack))).attemptId,first);await shot(f.page,'oracle-unknown-retry');
   }finally{await f.close();}
  });
  await check('Oracle card received but uncredited stays pending and preserves its attempt until confirmed',async()=>{
   const f=await checkoutFixture(browser,{name:'oracle-uncredited'}),pack=packs[2];configure(f,pack);f.state.session={...f.state.session,status:'completed',remote_status:'COMPLETED',can_pay:false,can_cancel:false,credited:false};
   try{
    await f.start();await rendered(f.page);await f.page.evaluate(({k,attemptId,cardPath})=>localStorage.setItem(k,JSON.stringify({attemptId,url:cardPath})),{k:key(pack),attemptId,cardPath});await f.page.goto(baseURL+cardPath);
    await f.page.getByRole('button',{name:'Comprobar estado del pago',exact:true}).waitFor();assert.equal(await f.page.getByRole('heading',{name:'Pago confirmado',exact:true}).count(),0);
    assert.ok(await f.page.evaluate(k=>localStorage.getItem(k),key(pack)));assert.doesNotMatch(await f.page.locator('main').innerText(),/minutos y beneficios|0 minutos/);
    await f.page.getByRole('button',{name:'Comprobar estado del pago',exact:true}).click();await f.page.getByRole('heading',{name:'Pago confirmado',exact:true}).waitFor();assert.equal(await f.page.evaluate(k=>localStorage.getItem(k),key(pack)),null);
   }finally{await f.close();}
  });
  await check('Questions within an existing reading use the same PayPal route and retry ID without maintenance',async()=>{
   const f=await checkoutFixture(browser,{name:'questions-in-reading'}),pack=packs[2];configure(f,pack);
   try{
    f.state.checkoutStatus=503;f.state.checkoutBody={ok:false,error:'Prueba: respuesta incierta.'};await questionsEntry(f);
    const buy=()=>f.page.getByRole('button',{name:'CONTINUAR HABLANDO CON EL ORÁCULO',exact:true});
    await buy().click();await f.page.getByRole('alert').filter({hasText:'Prueba: respuesta incierta.'}).waitFor();const first=f.calls.find(x=>x.path==='checkout').body.attemptId;
    assert.equal(f.calls[0].body.packId,pack.id);assert.equal(await f.page.getByRole('dialog').count(),0);await shot(f.page,'questions-reading-retry');
    await f.page.reload();await buy().waitFor();configure(f,pack);f.state.checkoutStatus=200;await buy().click();await f.page.waitForURL('**/pago-tarjeta?ref='+ref);
    assert.equal(f.calls.filter(x=>x.path==='checkout')[1].body.attemptId,first);await f.page.getByLabel('Oráculo de tu compra').waitFor();
   }finally{await f.close();}
  });
  await check('Oracle checkout ignores a response from an account that was switched while the request was pending',async()=>{
   const f=await checkoutFixture(browser,{name:'oracle-account-switch'}),pack=packs[0];configure(f,pack);
   try{await f.start();await rendered(f.page);f.state.holdCheckout=true;await oracleArticle(f.page,pack).getByRole('button',{name:'COMPRAR',exact:true}).click();await oracleArticle(f.page,pack).getByRole('button',{name:'Conectando…',exact:true}).waitFor();await f.switchAccount();await f.page.getByRole('heading',{name:'10 minutos · cuenta B',exact:true}).waitFor();f.release();await f.page.waitForTimeout(200);assert.equal(new URL(f.page.url()).pathname,'/cliente/precios-ofertas');assert.equal(await f.page.evaluate(k=>localStorage.getItem(k),`tc-client-purchase-attempt:v1:${ids.B}:${pack.id}`),null);}finally{await f.close();}
  });
  await check('Oracle receipt remains readable on 320px and uses the legacy top-level purchase kind safely',async()=>{
   const f=await checkoutFixture(browser,{name:'oracle-mobile',viewport:{width:320,height:740},mobile:true}),pack=packs[1];configure(f,pack);delete f.state.session.purchase_summary.purchaseKind;
   try{await f.seedAndOpenCard();await f.page.getByLabel('Oráculo de tu compra').waitFor();await noOverflow(f.page,'Oracle mobile');await shot(f.page,'oracle-mobile-320');}finally{await f.close();}
  });
  await check('All provider calls were mocked and no unexpected transactions or browser errors occurred',async()=>{assert.deepEqual(transactions,[]);assert.deepEqual(errors,[]);});
 }finally{await browser.close();fs.writeFileSync(path.join(output,'oracle-report.json'),JSON.stringify({generatedAt:new Date().toISOString(),baseURL,checks,failures,errors,blockedUnexpectedTransactions:transactions,allProviderCallsMocked:true},null,2));}
 console.log(JSON.stringify({passed:checks.length,failed:failures.length,output}));if(failures.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
