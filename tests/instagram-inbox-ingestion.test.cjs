const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
function load(file,mocks={},globals={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Buffer,Date,Map,Set,process:{env:{}},...globals,require:n=>n==='server-only'?{}:n in mocks?mocks[n]:require(n)});return exports;}
class InstagramError extends Error{constructor(code,message,status=503){super(message);this.code=code;this.status=status;}}
const account={accountId:'account',username:'tarotcelestialof',token:'PRIVATE'},when='2026-10-22T12:00:00Z';
const comment={id:'c1',text:'❤️❤️',timestamp:when,from:{id:'person',username:'client'}};
function harness(responses={},initial={}){
 const h={calls:[],writes:[],activity:[],cursor:initial,lease:true,errors:[]};
 const identity=load('src/lib/server/instagram-message-identity.ts');
 const graph={InstagramError,graphId:v=>typeof v==='string'&&!!v,instagramConnection:async()=>account,instagramGraph:async(a,p,q)=>{h.calls.push({p,q});const value=responses[p];if(value instanceof Error)throw value;return typeof value==='function'?value(q):value || {data:[]};}};
 const social={acquireSocialSync:async()=>h.lease?{token:'lease',cursor:h.cursor}:null,finishSocialSync:async(p,a,t,c,e)=>{h.cursor=c;h.errors.push(e)},recordSocialActivity:async(p,a,items)=>h.activity.push(...items)};
 const db={rpc:async(name,args)=>{assert.equal(name,'tc_instagram_upsert_threads');h.writes.push(...args.p_rows);return {data:args.p_rows.map(row=>({id:'row',...row}))};}};
 h.mod=load('src/lib/server/instagram-sync.ts',{'@/lib/supabase-admin':{supabaseAdmin:()=>db},'./instagram-graph':graph,'./instagram-message-identity':identity,'./social-inbox-activity':social,'./instagram-webhook':load('src/lib/server/instagram-webhook.ts')});return h;
}
test('sync stores real emoji comments and unread event; own comments are not counted',async()=>{const h=harness({'account/media':{data:[{id:'p1',comments_count:2,permalink:'https://www.instagram.com/p/test/'}]},'p1/comments':{data:[comment,{...comment,id:'own',from:{id:'own-alias',username:account.username}}]}});await h.mod.ensureInstagramFresh();assert.equal(h.writes.length,1);assert.equal(h.writes[0].preview,'❤️❤️');assert.equal(h.writes[0].remote_created_at,'2026-10-22T12:00:00.000Z');assert.equal(h.activity.length,1);assert.equal(h.activity[0].remoteId,'c1');});
test('account lease prevents every central polling Meta independently',async()=>{const h=harness();h.lease=false;await h.mod.ensureInstagramFresh();assert.equal(h.calls.length,0);});
test('older media and >50 comments have durable continuation instead of 8-post limit',async()=>{const h=harness({'account/media':q=>q.after?{data:[{id:'old'}]}:{data:[{id:'new'}],paging:{next:'PRIVATE-URL',cursors:{after:'older-page'}}},'new/comments':q=>q.after?{data:[{...comment,id:'c2'}]}:{data:[comment],paging:{next:'PRIVATE-URL',cursors:{after:'comment-page-2'}}},'old/comments':{data:[{...comment,id:'old-comment'}]}});await h.mod.ensureInstagramFresh();assert.equal(h.cursor.media,'older-page');assert.ok(h.cursor.pendingPosts.some(p=>p.after==='comment-page-2'));await h.mod.ensureInstagramFresh();assert.ok(h.activity.some(e=>e.remoteId==='c2'));assert.ok(h.activity.some(e=>e.remoteId==='old-comment'));assert.ok(h.calls.every(call=>!call.p.includes('PRIVATE-URL')));});
test('failed comments page retains retry cursor and reports safe error without losing saved threads',async()=>{const h=harness({'account/media':{data:[{id:'p1'}]},'p1/comments':new InstagramError('META_PERMISSION','PRIVATE ERROR')});await h.mod.ensureInstagramFresh();assert.equal(h.cursor.commentError,'META_PERMISSION');assert.equal(h.cursor.pendingPosts[0].id,'p1');assert.ok(!JSON.stringify(h.cursor).includes('PRIVATE ERROR'));});
test('malformed lists and positive count without content are visible sync issues',async()=>{let h=harness({'account/media':{data:'PRIVATE'}});await h.mod.ensureInstagramFresh();assert.equal(h.cursor.commentError,'META_INVALID_RESPONSE');h=harness({'account/media':{data:[{id:'p1',comments_count:1}]},'p1/comments':{data:[]}});await h.mod.ensureInstagramFresh();assert.equal(h.cursor.commentError,'COMMENTS_NOT_RETURNED');assert.equal(h.activity.length,0);});
test('messages prove customer identity from Meta and activity uses customer, not own alias',async()=>{const person={id:'222',username:'client'},own={id:'111',username:account.username};const h=harness({'account/conversations':{data:[{id:'conv',updated_time:when,participants:{data:[own,person]}}]},conv:{messages:{data:[{id:'m1'},{id:'m2'}]}},m1:{id:'m1',from:person,to:{data:[own]},created_time:when},m2:{id:'m2',from:own,to:{data:[person]},created_time:when}});await h.mod.ensureInstagramFresh();assert.equal(h.writes[0].recipient_id,'222');assert.equal(h.writes[0].conversation_id,'conv');assert.equal(h.activity.length,1);assert.equal(h.activity[0].threadRemoteId,'222');});
test('webhook persists inbound threads without Graph and excludes echo/self/other account',async()=>{const h=harness();const timestamp=Date.now()-1000;const incoming={sender:{id:'person'},recipient:{id:'account'},timestamp,message:{mid:'m1',text:'hello'}};const body={object:'instagram',entry:[{id:'account',time:timestamp/1000,messaging:[incoming,{...incoming,message:{mid:'echo',is_echo:true}},{...incoming,sender:{id:'account'},message:{mid:'own'}}],changes:[{field:'comments',value:comment},{field:'comments',value:{...comment,id:'own-comment',from:{username:account.username}}}]},{id:'foreign',messaging:[incoming]}]};await h.mod.processInstagramWebhook(body,account);assert.equal(h.calls.length,0);assert.equal(h.writes.length,2);assert.equal(h.activity.length,2);assert.ok(h.writes.some(row=>row.remote_id==='peer:person'));});
test('cached inbox reads every saved post without calling Graph and uses server unread',async()=>{const chain={};for(const key of['select','eq','is','order','limit','or'])chain[key]=()=>chain;chain.then=resolve=>Promise.resolve({data:[{id:'00000000-0000-4000-8000-000000000001',kind:'comment',remote_id:'old-comment',name:'Client',preview:'old post, new comment',remote_updated_at:when}]}).then(resolve);const mod=load('src/lib/server/instagram-inbox.ts',{'@/lib/supabase-admin':{supabaseAdmin:()=>({from:()=>chain})},'./instagram-graph':{instagramConnection:async()=>account,InstagramError},'./instagram-message-identity':{},'./instagram-sync':{},'./social-inbox-activity':{socialThreadUnread:async()=>new Map([['old-comment',2]]),socialSyncState:async()=>({cursor:{}})}});const result=await mod.instagramInbox('comment',null);assert.equal(result.threads.length,1);assert.equal(result.threads[0].unread,2);assert.equal(result.threads[0].preview,'old post, new comment');});

test('reading a comment cannot mark that author private messages as read',async()=>{const keys=[],row={id:'00000000-0000-4000-8000-000000000001',kind:'comment',remote_id:'comment-id',recipient_id:'customer-peer'};const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:row})};const mod=load('src/lib/server/instagram-inbox.ts',{'@/lib/supabase-admin':{supabaseAdmin:()=>({from:()=>chain})},'./instagram-graph':{instagramConnection:async()=>account,InstagramError,graphId:()=>true},'./instagram-message-identity':{},'./instagram-sync':{},'./social-inbox-activity':{markSocialThreadRead:async(u,p,a,k,t)=>{keys.push(...k);return {ok:true,unread:0}}}});await mod.instagramRead('user',{threadId:row.id,through:when});assert.deepEqual(keys,['comment-id']);});

test('webhook alias ingestion retains canonical account and ignores an unconfigured foreign account',async()=>{const h=harness(),alias='17841451159294130',timestamp=Date.now()-1000;const body={object:'instagram',entry:[{id:alias,messaging:[{sender:{id:'222'},recipient:{id:alias},timestamp,message:{mid:'alias-message',text:'fixture'}}]}]};await h.mod.processInstagramWebhook(body,account);assert.equal(h.writes.length,0);await h.mod.processInstagramWebhook(body,{...account,verifiedAccountIds:[alias]});assert.equal(h.writes.length,1);assert.equal(h.writes[0].remote_id,'peer:222');assert.equal(h.activity[0].remoteId,'alias-message');assert.equal(h.calls.length,0);});

test('unavailable conversation history rotates for retry without blocking other inbound messages',async()=>{
 const own={id:'account',username:account.username},person={id:'222',username:'client'};
 let recovered=false;
 const h=harness({'account/conversations':{data:['blocked','good'].map(id=>({id,updated_time:when,participants:{data:[own,person]}}))},
  blocked:()=>{if(!recovered)throw new InstagramError('META_OBJECT_UNAVAILABLE','private');return {messages:{data:[{id:'recovered-message'}]}};},
  good:{messages:{data:[{id:'good-message'}]}},
  'good-message':{id:'good-message',from:person,to:{data:[own]},created_time:when},
  'recovered-message':{id:'recovered-message',from:person,to:{data:[own]},created_time:when}});
 await h.mod.ensureInstagramFresh();
 assert.deepEqual(h.activity.map(e=>e.remoteId),['good-message']);
 assert.equal(h.cursor.pendingConversations.length,1);assert.equal(h.cursor.pendingConversations[0].conversation_id,'blocked');
 assert.equal(h.cursor.messageError,'MESSAGE_HISTORY_PARTIAL');assert.equal(h.errors[0],'MESSAGE_HISTORY_PARTIAL');
 recovered=true;await h.mod.ensureInstagramFresh();
 assert.deepEqual(h.activity.map(e=>e.remoteId),['good-message','recovered-message']);
 assert.equal(h.cursor.pendingConversations.length,0);assert.equal(h.cursor.messageError,null);
});

test('permission and network failures keep message retry order and remain visible',async()=>{
 for(const code of ['META_PERMISSION','META_UNAVAILABLE','TOKEN_EXPIRED']){
  const h=harness({'account/conversations':{data:[{id:'blocked',updated_time:when}]},blocked:new InstagramError(code,'private')});
  await h.mod.ensureInstagramFresh();assert.equal(h.cursor.messageError,code);assert.equal(h.cursor.pendingConversations[0].conversation_id,'blocked');assert.equal(h.activity.length,0);
 }
});

test('three unavailable histories do not prevent advancing to older customer conversations',async()=>{
 const own={id:'account',username:account.username},person={id:'222',username:'client'};
 const h=harness({'account/conversations':q=>q.after?{data:[{id:'older',updated_time:when,participants:{data:[own,person]}}]}:{data:['a','b','c'].map(id=>({id,updated_time:when})),paging:{next:'PRIVATE-URL',cursors:{after:'page-two'}}},
  a:new InstagramError('META_OBJECT_UNAVAILABLE','private'),b:new InstagramError('META_OBJECT_UNAVAILABLE','private'),c:new InstagramError('META_OBJECT_UNAVAILABLE','private'),
  older:{messages:{data:[{id:'older-message'}]}},'older-message':{id:'older-message',from:person,to:{data:[own]},created_time:when}});
 await h.mod.ensureInstagramFresh();assert.equal(h.cursor.pendingConversations.length,3);
 await h.mod.ensureInstagramFresh();
 assert.ok(h.calls.some(call=>call.q.after==='page-two'));
 assert.ok(h.activity.some(event=>event.remoteId==='older-message'));
 assert.equal(h.cursor.pendingConversations.length,3);
});
