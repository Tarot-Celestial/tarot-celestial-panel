// Uses a new isolated headless browser, fictional auth, fake microphone and mocked Gemini WebSocket.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const pw=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base='http://127.0.0.1:3034',out=path.resolve(__dirname,'../outputs/atlas-gemini-voice');
const qa=path.resolve(__dirname,'../src/app/atlas-voice-qa/page.tsx');fs.mkdirSync(path.dirname(qa),{recursive:true});fs.writeFileSync(qa,"export {default} from '@/app/admin/atlas/voz/page';\n");fs.mkdirSync(out,{recursive:true});
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
 await page.goto(base+'/atlas-voice-qa',{waitUntil:'networkidle',timeout:90000});await page.getByText('Listo para practicar',{exact:true}).waitFor();
 const start=page.getByRole('button',{name:'Hablar con Atlas',exact:true});assert.equal(await start.isDisabled(),true);assert.equal(await page.evaluate(()=>window.qaMicCalls),0);checks.push('no microphone before consent and click');
 await page.getByLabel('Una enseñanza, sin datos personales').fill('Haz una pregunta cada vez.');await page.getByRole('button',{name:'Guardar enseñanza',exact:true}).click();
 await page.reload({waitUntil:'networkidle'});await page.getByText('Haz una pregunta cada vez.',{exact:true}).waitFor();checks.push('explicit teaching persists locally');
 await page.getByRole('checkbox').check();await start.click();await page.getByText('Hola, soy Atlas. Esta es una prueba ficticia.',{exact:true}).waitFor();
 await page.waitForFunction(()=>window.qaStreams.length===1);await page.waitForTimeout(500);assert.ok(messages.some(m=>m.setup));assert.ok(messages.some(m=>m.realtimeInput?.audio));checks.push('ephemeral socket setup, transcription, fake microphone PCM and audio playback');
 await page.getByRole('button',{name:'Pausar micrófono',exact:true}).click();assert.equal(await page.evaluate(()=>window.qaStreams[0].getAudioTracks()[0].enabled),false);assert.ok(messages.some(m=>m.realtimeInput?.audioStreamEnd));await page.getByRole('button',{name:'Reactivar micrófono',exact:true}).click();assert.equal(await page.evaluate(()=>window.qaStreams[0].getAudioTracks()[0].enabled),true);checks.push('mute and resume control capture');
 socket.send(JSON.stringify({toolCall:{functionCalls:[{id:'call-1',name:'preparar_demo',args:{kind:'corregir_minutos',clientId:'demo-alba',minutes:30}}]}}));
 await page.getByRole('button',{name:'Confirmar simulación',exact:true}).waitFor();assert.equal(await page.getByText('Simulación completada',{exact:true}).count(),0);await page.getByRole('button',{name:'Confirmar simulación',exact:true}).click();await page.getByText('Simulación completada',{exact:true}).waitFor();checks.push('proposal requires explicit confirmation and returns ten fictional minutes');
 socket.send(JSON.stringify({toolCall:{functionCalls:[{id:'call-1',name:'preparar_demo',args:{kind:'corregir_minutos',clientId:'demo-alba',minutes:30}}]}}));await page.waitForTimeout(100);assert.equal(await page.getByRole('button',{name:'Confirmar simulación',exact:true}).count(),0);checks.push('replayed tool cannot duplicate operation');
 await page.screenshot({path:path.join(out,'voice-desktop.png'),fullPage:true});
 await page.getByRole('button',{name:'Terminar',exact:true}).click();assert.equal(await page.evaluate(()=>window.qaStreams[0].getTracks().every(t=>t.readyState==='ended')),true);checks.push('end stops all microphone tracks');
 const storage=await page.evaluate(()=>JSON.stringify(localStorage));assert.ok(!storage.includes('Hola, soy Atlas'));assert.ok(!storage.includes('auth_tokens/fixture'));checks.push('audio, transcript and ephemeral credentials are not persisted');
 await page.evaluate(()=>window.qaDeny=true);await start.click();await page.getByText(/El micrófono no tiene permiso/).waitFor();checks.push('permission denial is actionable and does not create another token');
 assert.equal(api.filter(m=>m==='POST').length,1);
 await page.evaluate(()=>window.qaDeny=false);await start.click();await page.getByRole('button',{name:'Terminar',exact:true}).waitFor();await page.waitForFunction(()=>window.qaStreams.length===2);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal(await page.evaluate(()=>window.qaStreams[1].getTracks().every(t=>t.readyState==='ended')),true);checks.push('hiding the tab stops microphone even during connection');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'voice-mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);checks.push('mobile layout fits without horizontal overflow');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'browser-checks.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));
 }catch(e){console.log((await page.locator('body').innerText()).slice(0,5000));console.log(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes('voice')).map(k=>[k,localStorage.getItem(k)])));await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});throw e;}finally{await browser.close();fs.unlinkSync(qa);}
})().catch(e=>{console.error(e);process.exitCode=1;});
