const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
function load(file, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code, {exports, Buffer, Date, Map, Set, URL, require: n => n in mocks ? mocks[n] : n === 'server-only' ? {} : require(n)});
  return exports;
}
class FacebookError extends Error { constructor(code, message, status = 503) {super(message); this.code = code; this.status = status;} }
const now = new Date(Date.now() - 60000).toISOString();
const postId = '123_456';
function fixture(graph, initial = {}) {
  const calls = [], writes = [], activities = new Map(), rows = new Map(), removed = new Set();
  let cursor = structuredClone(initial), held = false, admin = true, latestError;
  const db = {from(table) {
    assert.equal(table, 'workers'); const filters = [];
    const query = {select() {return query;}, eq(k,v) {filters.push([k,v]);return query;}, limit() {
      assert.deepEqual(filters, [['user_id', 'admin-user'], ['role','admin'], ['is_active',true]]);
      return Promise.resolve({data: admin ? [{id:'worker'}] : [], error:null});
    }}; return query;
  }, async rpc(name, args) {
    assert.equal(name, 'tc_facebook_ingest_threads');
    writes.push(...args.p_rows);
    for (const row of args.p_rows) {
      const key = row.kind + ':' + row.remote_id, old = rows.get(key);
      if (!old?.is_deleted) rows.set(key, {...old,...row});
    }
    return {error:null};
  }};
  const mod = load('src/lib/server/facebook-inbox.ts', {
    '@/lib/supabase-admin': {supabaseAdmin: () => db},
    './facebook-graph': {FacebookError, facebookConnection: () => ({accountId:'123', username:'Page', token:'FIXTURE'}), verifyFacebookAccount: async () => 'Page',
      facebookId: value => typeof value === 'string' && /^[\w:.-]+$/.test(value),
      facebookDate: value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null,
      facebookGraph: async (account, p, params, body) => {calls.push({p,params,body});return graph(p, params);}},
    './facebook-webhook': load('src/lib/server/facebook-webhook.ts'),
    './social-inbox-activity': {
      recordSocialActivity: async (provider, accountId, events) => {assert.equal(provider,'facebook'); assert.equal(accountId,'123'); for (const event of events) if (!activities.has(event.kind+':'+event.remoteId) && !removed.has(event.kind+':'+event.remoteId)) activities.set(event.kind+':'+event.remoteId,event);},
      removeSocialActivity: async (provider, accountId, kind, ids) => ids.forEach(id => {activities.delete(kind+':'+id);removed.add(kind+':'+id);}),
      acquireSocialSync: async (provider, accountId, options) => {assert.equal(provider,'facebook');assert.equal(accountId,'123');if (held) return null;held=true;return {token:'lease', cursor:structuredClone(cursor)};},
      finishSocialSync: async (provider, accountId, token, next, error) => {assert.equal(token,'lease');cursor=structuredClone(next);held=false;latestError=error;},
    },
  });
  return {mod,calls,writes,activities,rows, get cursor() {return cursor;}, get held() {return held;}, get error() {return latestError;}, setHeld(value) {held=value;}, setAdmin(value) {admin=value;}};
}
const source = {id:postId,from:{id:'123'},permalink_url:'https://facebook.com/page/posts/456'};
const comment = (id = '456_789') => ({id,message:'Customer comment',created_time:now});

test('targeted import verifies Page ownership, preserves unknown authors and audits canonical tracked post', async () => {
  const f = fixture((p,params) => {
    if (p === '456') return source;
    assert.equal(p,postId+'/comments'); assert.equal(params.filter,'stream'); assert.equal(params.limit,'50'); return {data:[comment()]};
  }, {conversations:'messenger-cursor',posts:'feed-cursor'});
  const result = await f.mod.facebookSyncPost('admin-user',{postId:' 456 ',cursor:'ignored-client-cursor',accountId:'foreign'});
  assert.equal(result.ok,true);assert.equal(result.postId,postId);assert.equal(result.processed,1);assert.equal(result.complete,true);
  const row = f.rows.get('comment:789');assert.equal(row.name,'Contacto de Facebook');assert.equal(row.recipient_id,null);assert.equal(row.account_id,'123');
  assert.equal(f.activities.size,1);assert.equal(f.activities.get('comment:789').threadRemoteId,'789');
  assert.equal(f.cursor.trackedPosts[0].registeredBy,'admin-user');assert.ok(f.cursor.trackedPosts[0].registeredAt);assert.equal(f.cursor.trackedPosts[0].id,postId);
  assert.equal(f.cursor.posts,'feed-cursor');assert.equal(f.cursor.conversations,'messenger-cursor');assert.equal(f.held,false);
});

test('inactive or non-admin identity, malformed input and unverified ownership cannot import', async () => {
  for (const owner of [null,{}, {id:'other-page'}]) {
    const f=fixture(() => ({...source,from:owner}));
    await assert.rejects(f.mod.facebookSyncPost('admin-user',{postId}),error=>error.code==='POST_OWNER_UNVERIFIED');
    assert.equal(f.writes.length,0);assert.equal(f.held,false);assert.equal(f.cursor.trackedPosts,undefined);
  }
  const f=fixture(()=>{throw Error('No Graph permitted');}); f.setAdmin(false);
  await assert.rejects(f.mod.facebookSyncPost('admin-user',{postId}),error=>error.code==='FORBIDDEN');
  for(const invalid of ['https://facebook.com/456','123/456','123_456?fields=token','',null]) await assert.rejects(f.mod.facebookSyncPost('admin-user',{postId:invalid}),error=>error.code==='INVALID_POST');
  assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);
});

test('shared active lease prevents import even with force and never overwrites the cursor', async () => {
  const f=fixture(()=>source,{posts:'must-keep'});f.setHeld(true);
  await assert.rejects(f.mod.facebookSyncPost('admin-user',{postId}),error=>error.code==='SYNC_BUSY');
  assert.equal(f.calls.length,1);assert.equal(f.writes.length,0);assert.equal(f.cursor.posts,'must-keep');assert.equal(f.held,true);
});

test('tracked ad absent from Page feed continues history while fetching its newest comments', async () => {
  let newest=0;
  const f=fixture((p,params)=>{
    if(p===postId)return source;
    if(p==='123/posts'||p==='123/conversations')return {data:[]};
    assert.equal(p,postId+'/comments');
    if(params.after==='page2')return {data:[comment('456_790')]};
    newest++;return {data:[comment()],paging:{next:'https://ignored.example/secret',cursors:{after:'page2'}}};
  });
  const imported=await f.mod.facebookSyncPost('admin-user',{postId});assert.equal(imported.continuationQueued,true);assert.equal(f.cursor.trackedPosts[0].after,'page2');
  await f.mod.ensureFacebookFresh();
  assert.equal(newest,2);assert.equal(f.rows.size,2);assert.equal(f.activities.size,2);assert.equal(f.cursor.trackedPosts[0].complete,true);assert.equal(f.cursor.trackedPosts[0].after,null);
  assert.ok(f.calls.some(call=>call.params.after==='page2'));assert.ok(f.calls.every(call=>!call.p.includes('https:')));
});

test('import retries and numeric bare/composite webhook IDs share one thread and activity without resetting read state', async () => {
  const f=fixture(p=>p===postId?source:{data:[comment()]});
  await f.mod.facebookSyncPost('admin-user',{postId}); f.activities.get('comment:789').readMarker='preserve';
  const event=id=>({object:'page',entry:[{id:'123',time:Math.floor(Date.now()/1000),changes:[{field:'feed',value:{item:'comment',verb:'add',comment_id:id,post_id:postId,message:'Customer comment',created_time:Math.floor(Date.parse(now)/1000),from:{id:'999',name:'Customer'}}}]}]});
  await f.mod.processFacebookWebhook(event('789'));await f.mod.processFacebookWebhook(event('456_789'));
  await f.mod.facebookSyncPost('admin-user',{postId});
  assert.equal(f.rows.size,1);assert.equal(f.activities.size,1);assert.equal(f.activities.get('comment:789').readMarker,'preserve');assert.equal(f.cursor.trackedPosts.length,1);
});

test('bare webhook remove without post_id retires the imported composite comment and historical retry cannot resurrect it', async () => {
  const f=fixture(p=>p===postId?source:{data:[comment()]});
  await f.mod.facebookSyncPost('admin-user',{postId});
  await f.mod.processFacebookWebhook({object:'page',entry:[{id:'123',time:Math.floor(Date.now()/1000),changes:[{field:'feed',value:{item:'comment',verb:'remove',comment_id:'789'}}]}]});
  assert.equal(f.rows.size,1);assert.equal(f.rows.get('comment:789').is_deleted,true);assert.equal(f.activities.size,0);
  await f.mod.facebookSyncPost('admin-user',{postId});
  assert.equal(f.rows.size,1);assert.equal(f.rows.get('comment:789').is_deleted,true);assert.equal(f.activities.size,0);
});

test('failure retains tracked post and history cursor for retry and releases lease', async () => {
  let fail=true;
  const f=fixture((p,params)=>{if(p===postId)return source;if(params.after==='page2'&&fail)throw new FacebookError('META_TEMPORARY','Try later');return {data:[comment()],...(params.after?{}:{paging:{next:'next',cursors:{after:'page2'}}})};}, {trackedPosts:[{id:postId,registeredBy:'first-admin',registeredAt:now,after:'page2'}]});
  await assert.rejects(f.mod.facebookSyncPost('admin-user',{postId}),error=>error.code==='META_TEMPORARY');
  assert.equal(f.cursor.trackedPosts[0].after,'page2');assert.equal(f.cursor.trackedPosts[0].registeredBy,'first-admin');assert.equal(f.cursor.trackedPosts[0].error,'META_TEMPORARY');assert.equal(f.error,'META_TEMPORARY');assert.equal(f.held,false);
  fail=false;await f.mod.facebookSyncPost('admin-user',{postId});assert.equal(f.cursor.trackedPosts[0].complete,true);assert.equal(f.error,null);
});

test('unsafe or repeating Meta cursors retain ingested comments but cannot silently claim completion', async () => {
  for(const after of ['https://evil.test/?token=abc',null]){
    const f=fixture(p=>p===postId?source:{data:[comment()],paging:{next:'next',cursors:{after}}});
    await assert.rejects(f.mod.facebookSyncPost('admin-user',{postId}),error=>error.code==='META_INVALID_CURSOR');
    assert.equal(f.rows.size,1);assert.equal(f.held,false);assert.equal(f.cursor.trackedPosts[0].complete,false);
  }
  const f=fixture(p=>p===postId?source:{data:[comment()],paging:{next:'next',cursors:{after:'page2'}}},{trackedPosts:[{id:postId,registeredBy:'admin-user',registeredAt:now,after:'page2'}]});
  await assert.rejects(f.mod.facebookSyncPost('admin-user',{postId}),error=>error.code==='META_INVALID_CURSOR');
  assert.equal(f.cursor.trackedPosts[0].after,'page2');assert.equal(f.held,false);
});

test('bounded tracked list rejects new posts and allows an existing post to continue', async () => {
  const initial={trackedPosts:Array.from({length:20},(_,i)=>({id:'123_'+(1000+i),registeredBy:'admin-user',registeredAt:now}))};
  const f=fixture(p=>p===postId?source:{data:[]},initial);
  await assert.rejects(f.mod.facebookSyncPost('admin-user',{postId}),error=>error.code==='TRACKED_POST_LIMIT');
  assert.equal(f.cursor.trackedPosts.length,20);assert.equal(f.held,false);assert.equal(f.writes.length,0);
  const existing=fixture(p=>p==='123_1000'?{...source,id:p}:{data:[]},initial);
  assert.equal((await existing.mod.facebookSyncPost('admin-user',{postId:'123_1000'})).ok,true);assert.equal(existing.cursor.trackedPosts.length,20);
});

test('HTTP sync-post denies Central role, uses verified actor for admin, and requires authentication', async () => {
  let role='central',actor='admin-user',invoked=[];
  const route=load('src/app/api/central/facebook/route.ts',{
    'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},'@vercel/functions':{waitUntil:()=>{}},
    '@/lib/server/facebook-graph':{FacebookError,facebookIdentity:async()=>{if(!actor)throw new FacebookError('NO_AUTH','Login',401);return{userId:actor,worker:{role}};}},
    '@/lib/server/facebook-inbox':{facebookSyncPost:async(user,input)=>{invoked.push({user,input});return{ok:true};}},'@/lib/server/facebook-diagnostics':{},
  });
  const req=()=>new Request('https://local.test/?action=sync-post',{method:'POST',body:JSON.stringify({postId,userId:'fabricated'})});
  assert.equal((await route.POST(req())).status,403);assert.equal(invoked.length,0);
  role='admin';assert.equal((await route.POST(req())).status,200);assert.equal(invoked[0].user,'admin-user');
  actor=null;assert.equal((await route.POST(req())).status,401);assert.equal(invoked.length,1);
});
