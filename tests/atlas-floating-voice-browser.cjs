// Uses a new isolated headless browser, fictional auth, fake microphone and mocked Gemini WebSocket.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const pw=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base='http://127.0.0.1:3034',out=path.resolve(__dirname,'../outputs/atlas-floating-voice');
const qa=path.resolve(__dirname,'../src/app/atlas-floating-voice-qa/page.tsx');fs.mkdirSync(path.dirname(qa),{recursive:true});fs.copyFileSync(path.join(__dirname,'fixtures/atlas-floating-voice-qa.tsx'),qa);fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await pw.chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']});
 const checks=[],errors=[],messages=[],api=[];let socket;
 const page=await browser.newPage({viewport:{width:1366,height:950},permissions:['microphone']});page.setDefaultTimeout(20000);
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
   const now=Math.floor(Date.now()/1000),id='00000000-0000-4000-8000-000000000001';
   const token=btoa(JSON.stringify({alg:'HS256'}))+'.'+btoa(JSON.stringify({sub:id,exp:now+86400}))+'.fixture';
   localStorage.setItem('sb-example-auth-token',JSON.stringify({access_token:token,refresh_token:'fake',expires_at:now+86400,expires_in:86400,token_type:'bearer',user:{id,aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}}}));
   window.qaStreams=[];window.qaMicCalls=0;const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
   navigator.mediaDevices.getUserMedia=async options=>{window.qaMicCalls++;if(window.qaDeny)throw new DOMException('Denied','NotAllowedError');const stream=await get(options);window.qaStreams.push(stream);return stream;};
 });
 await page.route('**/*',async route=>{
   const u=new URL(route.request().url()),p=u.pathname;
   if(u.origin!==base)return route.abort();
   const json=b=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(b)});
   if(p==='/api/admin/atlas/voice'){api.push(route.request().method());if(route.request().method()==='POST')return json({token:'auth_tokens/fixture',model:'models/gemini-3.8-live',expiresAt:new Date(Date.now()+300000).toISOString(),maxSeconds:300,mode:'fictional'});return json({configured:true,workerId:'worker-demo',maxSeconds:300});}
   if(p.startsWith('/api/'))return json({ok:true,role:'admin',worker:{id:'worker-demo',role:'admin'},data:[],messages:[],status:'online'});
   return route.continue();
 });
 await page.routeWebSocket('**/*',ws=>{
   if(new URL(ws.url()).hostname==='127.0.0.1'){ws.connectToServer();return;}
   if(!ws.url().includes('generativelanguage.googleapis.com')){ws.close();return;}
   socket=ws;ws.onMessage(raw=>{const m=JSON.parse(String(raw));messages.push(m);if(m.setup){ws.send(JSON.stringify({setupComplete:{}}));ws.send(JSON.stringify({serverContent:{outputTranscription:{text:'Hola, soy Atlas. Esta es una prueba ficticia.'},modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:Buffer.alloc(2400).toString('base64')}}]},turnComplete:true}}));}});
 });
 try{
 await page.goto(base+'/atlas-floating-voice-qa',{waitUntil:'networkidle',timeout:90000});
 assert.equal(await page.evaluate(()=>window.qaMicCalls),0);assert.equal(api.length,0);checks.push('no voice API or microphone until the floating button is opened');
 const originalUrl=page.url(),character=page.getByRole('button',{name:'Abrir Atlas, tu asistente de administración',exact:true});
 await page.getByRole('button',{name:'Hablar con Atlas aquí',exact:true}).click();
 const bubble=page.getByRole('region',{name:'Voz de Atlas en el panel',exact:true}),start=page.getByRole('button',{name:'Activar micrófono',exact:true});
 await bubble.getByText('Listo para practicar',{exact:true}).waitFor();assert.equal(page.url(),originalUrl);assert.equal(await start.isDisabled(),true);assert.equal(await page.evaluate(()=>window.qaMicCalls),0);checks.push('voice opens beside Atlas without navigation or automatic recording');
 await page.getByRole('checkbox').check();await start.click();await page.getByText('Hola, soy Atlas. Esta es una prueba ficticia.',{exact:true}).waitFor();await page.waitForFunction(()=>window.qaStreams.length===1);await page.waitForTimeout(500);assert.ok(messages.some(m=>m.realtimeInput?.audio));checks.push('one conversation starts from the character');
 await page.getByRole('button',{name:'Minimizar conversación sin terminar',exact:true}).click();assert.equal(await bubble.count(),0);assert.equal(await page.evaluate(()=>window.qaStreams[0].getAudioTracks()[0].readyState),'live');
 await page.getByRole('button',{name:'CRM de prueba',exact:true}).click();await page.getByLabel('Trabajo en curso').fill('Una nota de ejemplo');await page.getByRole('button',{name:'Reservas de prueba',exact:true}).click();assert.equal(await page.evaluate(()=>window.qaStreams.length),1);assert.equal(await page.evaluate(()=>window.qaStreams[0].getAudioTracks()[0].enabled),true);assert.equal(api.filter(m=>m==='POST').length,1);checks.push('minimized voice continues through panel navigation and other work with no duplicate session');
 await page.getByRole('button',{name:'Pausar micrófono de Atlas',exact:true}).click();assert.equal(await page.evaluate(()=>window.qaStreams[0].getAudioTracks()[0].enabled),false);await page.getByRole('button',{name:'Reactivar micrófono de Atlas',exact:true}).click();assert.equal(await page.evaluate(()=>window.qaStreams[0].getAudioTracks()[0].enabled),true);checks.push('pause and resume remain reachable while minimized');
 const before=await character.boundingBox();await character.focus();await character.press('ArrowLeft');const after=await character.boundingBox();assert.ok(after.x<before.x-5);assert.equal(await page.evaluate(()=>window.qaStreams[0].active),true);checks.push('Atlas remains movable during a conversation');
 await page.getByRole('button',{name:'Hablar con Atlas aquí',exact:true}).click();await bubble.waitFor();
 const checkBounds=async()=>{const r=await bubble.boundingBox(),v=page.viewportSize();assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=v.width+1&&r.y+r.height<=v.height+1,JSON.stringify({r,v}));};
 await checkBounds();await page.screenshot({path:path.join(out,'floating-desktop.png'),fullPage:true});
 await page.getByRole('button',{name:'Minimizar conversación sin terminar',exact:true}).click();
 socket.send(JSON.stringify({toolCall:{functionCalls:[{id:'floating-call',name:'preparar_demo',args:{kind:'corregir_minutos',clientId:'demo-alba',minutes:30}}]}}));
 await page.getByRole('button',{name:'Confirmar simulación',exact:true}).waitFor();await checkBounds();assert.equal(await page.getByText('Simulación completada',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Confirmar simulación',exact:true}).click();await page.getByText('Simulación completada',{exact:true}).waitFor();checks.push('a pending fictional action opens the bubble for explicit review');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);await checkBounds();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await character.focus();for(let i=0;i<12;i++)await character.press('ArrowLeft');await checkBounds();
 await bubble.getByText('Tu guía para Atlas · 0/5',{exact:true}).click();await page.getByLabel('Una enseñanza, sin datos personales').fill('Habla despacio.');await checkBounds();assert.equal(await page.getByLabel('Una enseñanza, sin datos personales').evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+15)===el;}),true);await page.screenshot({path:path.join(out,'floating-mobile.png'),fullPage:true});checks.push('bubble remains inside mobile viewport after moving and expanding details');
 await page.getByRole('button',{name:'Cerrar conversación y micrófono',exact:true}).click();assert.equal(await bubble.count(),0);assert.equal(await page.evaluate(()=>window.qaStreams[0].getTracks().every(t=>t.readyState==='ended')),true);checks.push('close releases the microphone and returns focus to Atlas');
 await page.setViewportSize({width:1366,height:950});await page.getByRole('button',{name:'Hablar con Atlas aquí',exact:true}).click();await start.click();await page.waitForFunction(()=>window.qaStreams.length===2);await page.getByText('Hola, soy Atlas. Esta es una prueba ficticia.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Bloquear panel',exact:true}).click();await page.waitForFunction(()=>window.qaStreams[1].getTracks().every(t=>t.readyState==='ended'));checks.push('attendance lock closes the microphone');
 await page.getByRole('button',{name:'Desbloquear panel',exact:true}).click();await start.click();await page.waitForFunction(()=>window.qaStreams.length===3);await page.getByRole('button',{name:'Desmontar Atlas',exact:true}).click();await page.waitForFunction(()=>window.qaStreams[2].getTracks().every(t=>t.readyState==='ended'));checks.push('unmount closes microphone even during connection');
 const storage=await page.evaluate(()=>JSON.stringify(localStorage));assert.ok(!storage.includes('Hola, soy Atlas'));assert.ok(!storage.includes('auth_tokens/fixture'));checks.push('no transcription or ephemeral credential is saved');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'browser-checks.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));
 }catch(e){console.log((await page.locator('body').innerText()).slice(0,5000));await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});throw e;}finally{await browser.close();fs.unlinkSync(qa);}
})().catch(e=>{console.error(e);process.exitCode=1;});
