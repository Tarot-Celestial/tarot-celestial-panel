const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadGraph(deps={}, env={}) {
  const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/server/instagram-graph.ts'),'utf8'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};vm.runInNewContext(code,{exports,URL,Date,AbortSignal,process:{env:{}},require:n=>deps[n],...env});
  return exports;
}

function fixture() {
  const row = { accountId:'35', username:'tarotcelestialof', token:'fixture', verifiedAccountIds:['17'],
    expiresAt:'2099-01-01', connectedAt:'2026-09-24T01:00:00Z', ownerId:null };
  const media = {id:'80',username:row.username,permalink:'https://www.instagram.com/p/example/',like_count:0,comments_count:2};
  const received = [];
  const routes = {
    me:{id:'35',user_id:'17',username:row.username,account_type:'Business'},
    '35/content_publishing_limit':{data:[{quota_usage:0,config:{quota_total:50}}]},
    '35/permissions':{data:[]}, '35/media':{id:'70'}, '35/media_publish':{id:'80'},
    70:{status_code:'PUBLISHED'}, 80:media, '80/insights':{data:[{name:'reach',values:[{value:0}]}]},
  };
  class GraphError extends Error { constructor(code) { super(code); this.code=code; } }
  const graph = { sameConnectionTime:loadGraph().sameConnectionTime, InstagramError:GraphError, instagramConnection:async()=>({...row}), instagramGraph:async(account,p,params,body)=>{
    received.push({p,params,body});
    const item=routes[p];
    if (item instanceof Error) throw item;
    if (typeof item === 'function') return item(params,body);
    if (item === undefined) throw new Error('Unexpected fixture path');
    return item;
  }};
  const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/server/office-instagram-graph.ts'),'utf8'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};
  vm.runInNewContext(code,{exports,URL,Date,require:n=>n==='server-only'?{}:graph});
  return { api:exports,row,media,routes,received,GraphError };
}

test('preflight checks actual identity and quota, separates reported and inferred permissions',async()=>{
  const h=fixture();
  let result=await h.api.officeInstagramConnection();
  assert.equal(result.can_publish,true);assert.equal(result.permission_source,'quota');assert.equal(result.owner_id,null);assert.equal(result.account_id,'35');
  assert.equal(result.reported_permissions.length,0);assert.equal(JSON.stringify(result).includes('fixture'),false);
  h.routes['35/permissions']={data:result.permissions.map(permission=>({permission,status:'granted'}))};
  result=await h.api.officeInstagramConnection();assert.equal(result.permission_source,'reported');
  h.routes['35/permissions']={data:[{permission:'instagram_business_content_publish',status:'declined'}]};
  assert.equal((await h.api.officeInstagramConnection()).can_publish,false);
  h.routes['35/content_publishing_limit']={data:[]};
  assert.equal((await h.api.officeInstagramConnection()).can_publish,false);
  h.routes['35/content_publishing_limit']={data:[{quota_usage:50,config:{quota_total:50}}]};h.routes['35/permissions']={data:[]};
  assert.equal((await h.api.officeInstagramConnection()).can_publish,false);
  assert.ok(h.received.every(c=>!c.body));
});
test('alias must be verified from live identity, invalid auth and unrelated username block operations',async()=>{
  const h=fixture();
  h.routes['35/content_publishing_limit']=new h.GraphError('META_OBJECT_UNAVAILABLE');
  h.routes['17/content_publishing_limit']={data:[{quota_usage:3}]};h.routes['17/permissions']=new h.GraphError('META_REJECTED');
  const status=await h.api.officeInstagramConnection();
  assert.deepEqual([status.can_publish,status.account_id,status.persisted_account_id],[true,'17','35']);
  await assert.rejects(h.api.sendOfficeContainer('999','70'),e=>e.code==='WRONG_ACCOUNT');
  await assert.rejects(h.api.sendOfficeContainer('17','70',{persisted_account_id:'35',connected_at:'different'}),e=>e.code==='CONNECTION_CHANGED');
  h.routes['17/media_publish']={id:'80'};
  assert.equal(await h.api.sendOfficeContainer('17','70',{persisted_account_id:'35',connected_at:'2026-09-24T03:00:00+02:00'}),'80');
  h.received.length=0;
  h.routes.me={id:'998',username:'tarotcelestialof'};assert.equal((await h.api.officeInstagramConnection()).can_publish,false);
  h.routes.me={id:'35',username:'otra'};await assert.rejects(h.api.createOfficeContainer('35','https://img.test/x','cap','alt','image/jpeg'));
  assert.equal(h.received.some(c=>c.body),false);
});
test('creation preserves alt and caption, send posts once and ambiguous outcomes never auto-retry',async()=>{
  const h=fixture(); const url='https://media.test/approved.jpg';
  assert.equal(await h.api.createOfficeContainer('35',url,'cap','alt','image/jpeg'),'70');
  assert.equal(h.received.at(-1).body.alt_text,'alt');
  await h.api.createOfficeContainer('35','https://media.test/x.mp4','cap','ignored','video/mp4');
  assert.equal(h.received.at(-1).body.media_type,'REELS');assert.equal(h.received.at(-1).body.alt_text,undefined);
  await assert.rejects(h.api.createOfficeContainer('35',url,'cap','alt','image/png'),e=>e.code==='FORMAT');
  h.routes['35/media_publish']=new h.GraphError('SEND_UNCERTAIN');
  await assert.rejects(h.api.sendOfficeContainer('35','70'),e=>e.uncertain);
  assert.equal(h.received.filter(c=>c.p==='35/media_publish').length,1);
  h.routes['35/media_publish']={};await assert.rejects(h.api.sendOfficeContainer('35','70'),e=>e.uncertain);
});
test('reconciliation uses a published container, unique exact caption, time and current owner',async()=>{
  const h=fixture(); const since='2026-11-22T19:12:00Z';const wanted='¿Qué piensas?';
  const original={id:'80',caption:wanted.normalize('NFD'),timestamp:'2026-11-22T19:15:00Z'};
  h.routes['35/media']=({after})=>after?{data:[original]}:{data:[{...original,id:'77',timestamp:'2026-11-21T00:00:00Z'}],paging:{next:'https://elsewhere.test/secret',cursors:{after:'cursor'}}};
  const result=await h.api.findOfficeReceipt('35','70',wanted,since);
  assert.equal(result.id,'80');assert.equal(result.metrics.likes,0);assert.equal(result.metrics.reach,0);assert.equal(result.permalink,h.media.permalink);
  assert.equal(h.received.some(c=>c.p.includes('elsewhere')),false);
  h.routes['35/media']={data:[original,{...original,id:'81'}]};
  assert.equal(await h.api.findOfficeReceipt('35','70',wanted,since),null);
  assert.equal((await h.api.findRecentExactPost('35',wanted,since)).id,'80');
  h.routes['70']={status_code:'IN_PROGRESS'};assert.equal(await h.api.findOfficeReceipt('35','70',wanted,since),null);
  h.routes['35/media']={data:[],paging:{next:'x',cursors:{after:'repeating'}}};
  await assert.rejects(h.api.findRecentExactPost('35',wanted,since),e=>e.code==='INCOMPLETE_HISTORY');
  h.routes['80/insights']=new h.GraphError('META_PERMISSION');
  assert.equal((await h.api.readOfficeReceipt('35','80')).metrics.reach,null);
  h.routes['80']={...h.media,username:'otra'};
  await assert.rejects(h.api.readOfficeReceipt('35','80'),e=>e.code==='WRONG_MEDIA');
});

test('reading a connection never rotates a token; authorized refresh uses a compare-and-swap on the bound credential',async()=>{
  const stored={account_id:'35',username:'tarotcelestialof',access_token_ciphertext:'ciphertext-fixture',
    token_expires_at:new Date(Date.now()+3600000).toISOString(),connected_at:'2026-09-24',connected_by:null,metadata:{}};
  let rotations=0, wins=true;const guards=[];
  const database={from:()=>{let writing=false;const chain={
    select:()=>chain,update:()=>{writing=true;return chain;},eq:(key,value)=>{if(writing)guards.push([key,value]);return chain;},
    maybeSingle:async()=>({data:writing?(wins?{account_id:'35'}:null):stored,error:null}),
  };return chain;}};
  const deps={'server-only':{},'@/lib/supabase-admin':{supabaseAdmin:()=>database},'@/lib/server/social-connections':{
    SOCIAL_CONNECTIONS_TABLE:'connections',decryptSecret:()=> 'current',encryptSecret:()=> 'encrypted-rotated',
    refreshInstagramToken:async()=>{rotations++;return {token:'rotated',expiresAt:'2099-01-01'};},
  }};
  const exports=loadGraph(deps);
  assert.equal((await exports.instagramConnection()).token,'current');
  await assert.rejects(exports.instagramConnection('99'),e=>e.code==='WRONG_ACCOUNT');
  assert.equal(rotations,0);
  assert.equal((await exports.instagramConnection('35')).token,'rotated');
  assert.deepEqual(guards,[['provider','instagram'],['account_id','35'],['access_token_ciphertext','ciphertext-fixture']]);
  wins=false;
  await assert.rejects(exports.instagramConnection('35'),e=>e.code==='CONNECTION_CHANGED');
});

test('the Graph transport sends one POST with only creation_id and a server-side authorization header',async()=>{
  const wire=[];
  const graph=loadGraph({}, {fetch:async(url,opts)=>{wire.push({url,opts});return {ok:true,status:200,json:async()=>({id:'80'})};}});
  await graph.instagramGraph({accountId:'35',token:'fixture'},'35/media_publish',{}, {creation_id:'70'});
  assert.equal(wire.length,1);assert.equal(wire[0].url.toString(),'https://graph.instagram.com/v24.0/35/media_publish');
  assert.equal(wire[0].opts.method,'POST');assert.equal(wire[0].opts.headers.Authorization,'Bearer fixture');
  assert.deepEqual(JSON.parse(wire[0].opts.body),{creation_id:'70'});
});

test('two ordered old pages end a time-bounded scan; pinned or unordered pages never hide a newer match',async()=>{
  const h=fixture(), since='2026-11-22T00:00:00Z';
  const old=(day,id)=>({timestamp:'2026-10-'+day+'T00:00:00Z',caption:'anterior',id:String(id)});
  let count=0;
  h.routes['35/media']=params=>{count++;assert.ok(params.until);return {data:[1,2,3,4].map(id=>old(String(25-count),id)),
    paging:{next:'ignored',cursors:{after:String(count)}}};};
  assert.equal(await h.api.findRecentExactPost('35','buscado',since),null);assert.equal(count,2);
  count=0;h.routes['35/media']=()=>{count++;
    return count===3?{data:[{timestamp:'2026-11-22T19:00:00Z',caption:'buscado',id:'80'}]}:
      {data:[old('11',1),old('12',2),old('10',3),old('09',4)],paging:{next:'ignored',cursors:{after:String(count)}}};};
  assert.equal((await h.api.findRecentExactPost('35','buscado',since)).id,'80');assert.equal(count,3);
});
