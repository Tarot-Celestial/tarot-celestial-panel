// Isolated local visual QA. Never attaches to a personal browser or sends production requests.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
let pw;try{pw=require('playwright');}catch{pw=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const base=process.env.TC_ATLAS_QA_URL||'http://127.0.0.1:3034';assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const out=path.resolve(__dirname,'../outputs/atlas-universal');fs.mkdirSync(out,{recursive:true});
const qaRoute=path.resolve(__dirname,'../src/app/atlas-visual-qa/page.tsx');
const createdRoute=!fs.existsSync(qaRoute);if(createdRoute){fs.mkdirSync(path.dirname(qaRoute),{recursive:true});fs.copyFileSync(path.join(__dirname,'fixtures/atlas-visual-qa.tsx'),qaRoute);}
(async()=>{const browser=await pw.chromium.launch({executablePath:process.env.TC_QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const checks=[],errors=[];
 async function page(options={}){const p=await browser.newPage(options);p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());return p;}
 try{
 const p=await page({viewport:{width:1366,height:850}});await p.goto(base+'/atlas-visual-qa',{waitUntil:'networkidle',timeout:60000});
 const button=p.getByRole('button',{name:'Abrir Atlas, tu asistente de administración'});await button.waitFor();
 await p.waitForFunction(()=>[...document.querySelectorAll('img[src="/companions/atlas-universal-v1.png"]')].length>0 && [...document.querySelectorAll('img[src="/companions/atlas-universal-v1.png"]')].every(i=>i.complete&&i.naturalWidth>0));checks.push('all Atlas portraits load');
 const a=await button.boundingBox();await button.focus();await button.press('ArrowLeft');const b=await button.boundingBox();assert.ok(b.x<a.x-5);checks.push('keyboard moves Atlas');
 await p.mouse.move(b.x+55,b.y+55);await p.mouse.down();await p.mouse.move(b.x-85,b.y-40,{steps:8});await p.mouse.up();assert.equal(await p.getByRole('dialog').count(),0);checks.push('dragging never opens the panel');
 const placed=await button.boundingBox();assert.ok(placed.x>=0&&placed.y>=0&&placed.x+placed.width<=1366);checks.push('drag is bounded to viewport');
 await p.getByRole('button',{name:'Pausar paseos de Atlas'}).click();await p.reload({waitUntil:'networkidle'});assert.equal(await p.getByRole('button',{name:'Reanudar paseos de Atlas'}).getAttribute('aria-pressed'),'true');
 const restored=await button.boundingBox();assert.ok(Math.abs(restored.x-placed.x)<2&&Math.abs(restored.y-placed.y)<2);checks.push('position and pause survive reload');
 await button.click();await p.getByRole('dialog',{name:'Atlas abierto'}).waitFor();await p.getByRole('button',{name:'Cerrar',exact:true}).click();checks.push('click opens and closes normally');
 await p.screenshot({path:path.join(out,'atlas-desktop.png'),fullPage:true});
 const mobile=await page({viewport:{width:390,height:844},reducedMotion:'reduce'});await mobile.goto(base+'/atlas-visual-qa',{waitUntil:'networkidle'});const mb=mobile.getByRole('button',{name:'Abrir Atlas, tu asistente de administración'});await mb.focus();await mb.press('End').catch(()=>{});await mb.press('Home');const m=await mb.boundingBox();assert.ok(m.x>=0&&m.x+m.width<=390&&m.y+m.height<=844);assert.equal(await mb.locator('img').evaluate(i=>getComputedStyle(i).animationName),'none');checks.push('mobile bounds and reduced motion');await mobile.screenshot({path:path.join(out,'atlas-mobile.png'),fullPage:true});
 const roaming=await page({viewport:{width:1366,height:850}});await roaming.addInitScript(()=>{const interval=window.setInterval.bind(window);window.setInterval=(fn,ms,...args)=>interval(fn,ms===45000?600:ms,...args);});await roaming.goto(base+'/atlas-visual-qa',{waitUntil:'domcontentloaded'});const rb=roaming.getByRole('button',{name:'Abrir Atlas, tu asistente de administración'});await rb.waitFor();const r0=await rb.boundingBox();await roaming.waitForTimeout(2400);const r1=await rb.boundingBox();assert.ok(Math.abs(r0.x-r1.x)+Math.abs(r0.y-r1.y)>10);checks.push('autonomous walks reach a panel landmark');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'browser-checks.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));
 }finally{await browser.close();if(createdRoute)fs.unlinkSync(qaRoute);}
})().catch(e=>{console.error(e);process.exitCode=1;});
