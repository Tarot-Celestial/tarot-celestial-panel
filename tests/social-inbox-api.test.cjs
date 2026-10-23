const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function load(file,mocks={},globals={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Buffer,Date,Set,URL,process:{env:{}},...globals,require:n=>n==='server-only'?{}:n in mocks?mocks[n]:require(n)});return exports;}
class InstagramError extends Error{constructor(code,message,status=503){super(message);this.code=code;this.status=status;}}
class FacebookError extends Error{constructor(code){super(code);this.code=code;}}
test('summary returns verified worker identity and independent provider failure without exposing payload',async()=>{
 const background=[],connection={select:()=>connection,eq:()=>connection,maybeSingle:async()=>({data:{account_id:'ig-account'}})};
 const mod=load('src/app/api/central/social-attention/route.ts',{'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},'@vercel/functions':{waitUntil:p=>background.push(p)},'@/lib/server/instagram-graph':{InstagramError,instagramIdentity:async()=>({userId:'user',worker:{id:'worker'},db:{from:()=>connection}})},'@/lib/server/instagram-sync':{ensureInstagramFresh:async()=>{}},'@/lib/server/facebook-graph':{FacebookError,facebookConnection:()=>({accountId:'fb-account'})},'@/lib/server/facebook-inbox':{ensureFacebookFresh:async()=>{}},'@/lib/server/social-connections':{SOCIAL_CONNECTIONS_TABLE:'connections'},'@/lib/server/social-inbox-activity':{socialAttention:async(provider,account)=>{if(provider==='facebook')throw Error('PRIVATE PROVIDER DATA');return {count:3,messages:1,comments:2,revision:'r1',account_id:account};}}});
 const response=await mod.GET(new Request('https://local.test/api/central/social-attention'));
 assert.equal(response.body.user_id,'user');assert.equal(response.body.worker_id,'worker');assert.equal(response.body.instagram.count,3);assert.equal(response.body.facebook.available,false);assert.equal(response.body.facebook.count,null);assert.ok(!JSON.stringify(response).includes('PRIVATE'));assert.equal(background.length,1);await Promise.all(background);
});
test('social summary does not query or schedule work before verified auth',async()=>{
 let called=false;const mod=load('src/app/api/central/social-attention/route.ts',{'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},'@vercel/functions':{waitUntil:()=>{called=true;}},'@/lib/server/instagram-graph':{InstagramError,instagramIdentity:async()=>{throw new InstagramError('NO_AUTH','Login',401)}},'@/lib/server/instagram-sync':{},'@/lib/server/facebook-graph':{},'@/lib/server/facebook-inbox':{},'@/lib/server/social-connections':{},'@/lib/server/social-inbox-activity':{}});
 const result=await mod.GET(new Request('https://local.test'));assert.equal(result.status,401);assert.equal(called,false);
});
test('subscription preserves current app fields, never another app fields, then verifies',async()=>{
 const calls=[],account={accountId:'account',token:'PRIVATE'},state={fields:['mentions']};
 const mod=load('src/lib/server/instagram-subscriptions.ts',{'./instagram-graph':{InstagramError,instagramConnection:async()=>account,instagramGraph:async(a,p,params,body)=>{calls.push({p,body});if(body){state.fields=body.subscribed_fields.split(',');return {success:true};}return {data:[{id:'this-app',subscribed_fields:state.fields},{id:'other-app',subscribed_fields:['other_private_field']}]};}}},{process:{env:{INSTAGRAM_APP_ID:'this-app'}}});
 const result=await mod.subscribeInstagram();assert.equal(result.ready,true);assert.equal(calls.length,3);const body=calls[1].body;assert.equal(body.subscribed_fields,'mentions,comments,messages');assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.ok(!body.subscribed_fields.includes('other_private'));
});
test('HTTP success without required subscription verification cannot claim ready',async()=>{
 const mod=load('src/lib/server/instagram-subscriptions.ts',{'./instagram-graph':{InstagramError,instagramConnection:async()=>({accountId:'a'}),instagramGraph:async(a,p,q,body)=>body?{success:true}:{data:[]}}});
 await assert.rejects(mod.subscribeInstagram(),error=>error.code==='SUBSCRIPTION_UNCONFIRMED');
});
test('central cannot subscribe; read accepts only threadId/through and uses verified actor',async()=>{
 let subscribed=0,read;const mod=load('src/app/api/central/instagram/route.ts',{'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},'@vercel/functions':{waitUntil:()=>{}},'@/lib/server/instagram-graph':{InstagramError,instagramIdentity:async()=>({userId:'verified-user',worker:{role:'central'}})},'@/lib/server/instagram-inbox':{instagramRead:async(user,body)=>{read={user,body};return {ok:true,unread:2};}},'@/lib/server/instagram-diagnostics':{},'@/lib/server/instagram-sync':{},'@/lib/server/instagram-subscriptions':{subscribeInstagram:async()=>{subscribed++;}}});
 assert.equal((await mod.POST(new Request('https://local.test/?action=subscribe',{method:'POST'}))).status,403);assert.equal(subscribed,0);
 const response=await mod.POST(new Request('https://local.test/?action=read',{method:'POST',body:JSON.stringify({threadId:'thread',through:'2026-10-23T00:00:00Z'})}));assert.equal(response.body.unread,2);assert.equal(read.user,'verified-user');
});
