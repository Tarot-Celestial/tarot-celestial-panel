const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto');
const {File}=require('node:buffer');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from([0,0,0,13]),Buffer.from('IHDR'),Buffer.alloc(8)]);
function harness(options={}){
 const objects=new Map(),calls=[];
 const tables={workers:[{id:id(1),role:'central',is_active:!options.inactive,user_id:id(101),display_name:'Central fixture'},{id:id(2),role:'tarotista',is_active:true},{id:id(3),role:'central',is_active:true}],chat_threads:[{id:id(10),central_worker_id:id(1),tarotist_worker_id:id(2)},{id:id(11),central_worker_id:id(3),tarotist_worker_id:id(2)}],staff_chat_profiles:[],staff_chat_preferences:[]};
 class Query{
  constructor(name){this.name=name;this.filters=[];this.action='select';}
  select(){return this;}eq(k,v){this.filters.push(r=>r[k]===v);return this;}in(k,v){this.filters.push(r=>v.includes(r[k]));return this;}limit(){return this;}
  or(value){const terms=value.split(',').map(x=>x.split('.eq.'));this.filters.push(row=>terms.some(([k,v])=>row[k]===v));return this;}
  insert(value){this.action='insert';this.value=value;return this;}update(value){this.action='update';this.value=value;return this;}
  async run(single=false){
   let found=tables[this.name].filter(r=>this.filters.every(f=>f(r)));
   if(this.action==='insert'){
    if(tables[this.name].some(r=>r.worker_id===this.value.worker_id&&r.thread_id===this.value.thread_id))return{data:null,error:{code:'23505'}};
    const row={...this.value};tables[this.name].push(row);found=[row];
   }
   if(this.action==='update'){if(options.conflict)return{data:null,error:null};for(const row of found)Object.assign(row,this.value);}
   if(this.action!=='select'&&options.commitTimeout)return{data:null,error:{message:'upstream timeout after commit'}};
   return{data:single?found[0]?{...found[0]}:null:found.map(r=>({...r})),error:null};
  }
  maybeSingle(){return this.run(true);}single(){return this.run(true);}then(resolve,reject){return this.run().then(resolve,reject);}
 }
 const storage={upload:async(p,bytes,opts)=>{calls.push({type:'upload',p,opts});objects.set(p,bytes);return{error:null};},remove:async paths=>{calls.push({type:'remove',paths});paths.forEach(p=>objects.delete(p));return{error:null};},createSignedUrl:async(p,ttl)=>{calls.push({type:'sign',p,ttl});return{data:{signedUrl:'https://storage.invalid/'+p},error:null};}};
 const db={from:n=>new Query(n),auth:{getUser:async token=>token==='valid'?{data:{user:{id:id(101)}},error:null}:{data:{user:null},error:{message:'bad'}}},storage:{from:bucket=>{assert.equal(bucket,'staff-chat-appearance');return storage;}}};
 const deps={'@/lib/supabase-admin':{supabaseAdmin:()=>db},'@/lib/server/admin-access':{hasAdminAccess:async()=>!!options.admin},'@/lib/server/panel-attendance':{requireActivePanelSession:async()=>options.offline?{ok:false,status:423,error:'PANEL_CONNECTION_REQUIRED'}:{ok:true}},'next/server':{NextResponse:{json:(data,init={})=>new Response(JSON.stringify(data),init)}}};
 function load(file){const exports={};const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{exports,require:name=>{if(!deps[name])throw Error(name);return deps[name];},File,Buffer,Uint8Array,Date,crypto,URL,Map,Set,Error});return exports;}
 deps['@/lib/server/staff-chat']=load('src/lib/server/staff-chat.ts');
 deps['@/lib/server/staff-chat-media']=load('src/lib/server/staff-chat-media.ts');
 deps['@/lib/staff-chat-appearance']=load('src/lib/staff-chat-appearance.ts');
 deps['@/lib/server/staff-chat-appearance']=load('src/lib/server/staff-chat-appearance.ts');
 const route=load('src/app/api/chat/preferences/route.ts');
 const req=(body,method='PATCH',token='valid',query='')=>new Request('https://panel.invalid/api/chat/preferences'+query,{method,headers:{authorization:'Bearer '+token},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});
 const body={scope:'profile',avatar_kind:'character',character:'owl',revision:0,expected_worker_id:id(1)};
 const form=(overrides={})=>{const f=new FormData();for(const [k,v] of Object.entries({scope:'profile',revision:'0',expected_worker_id:id(1),file:new File([png],'fixture.png',{type:'image/png'}),...overrides}))f.set(k,v);return f;};
 return{route,req,body,form,calls,tables,objects,helper:deps['@/lib/server/staff-chat-appearance']};
}
test('appearance endpoints require an active authenticated worker; updates require a connected panel',async()=>{
 for(const token of ['', 'forged']){const h=harness();assert.equal((await h.route.GET(h.req(null,'GET',token))).status,401);assert.equal((await h.route.PATCH(h.req(h.body,'PATCH',token))).status,401);assert.equal(h.tables.staff_chat_profiles.length,0);}
 const inactive=harness({inactive:true});assert.equal((await inactive.route.GET(inactive.req(null,'GET'))).status,403);
 const offline=harness({offline:true});assert.equal((await offline.route.PATCH(offline.req(offline.body))).status,423);assert.equal(offline.tables.staff_chat_profiles.length,0);
});
test('profile updates remain owned by the actor even when an extra worker id is supplied',async()=>{
 const h=harness();const response=await h.route.PATCH(h.req({...h.body,worker_id:id(2)}));assert.equal(response.status,200);assert.equal(h.tables.staff_chat_profiles[0].worker_id,id(1));
 assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.equal((await h.route.PATCH(h.req({...h.body,revision:1,expected_worker_id:id(2)}))).status,409);
});
test('background read and write authorize thread access and cannot alter another worker preference',async()=>{
 const h=harness();const body={scope:'background',wallpaper:'forest',revision:0,thread_id:id(11)};
 assert.equal((await h.route.PATCH(h.req(body))).status,403);assert.equal((await h.route.GET(h.req(null,'GET','valid','?thread_id='+id(11)))).status,403);
 assert.equal(h.tables.staff_chat_preferences.length,0);
 assert.equal((await h.route.PATCH(h.req({...body,thread_id:id(10),worker_id:id(2)}))).status,200);assert.equal(h.tables.staff_chat_preferences[0].worker_id,id(1));
});
test('photo files reject SVG, false MIME bytes and oversized data before storing anything',async()=>{
 for(const file of [new File(['<svg/>'],'avatar.svg',{type:'image/svg+xml'}),new File(['<script/>'],'avatar.png',{type:'image/png'}),new File([new Uint8Array(2097153)],'large.png',{type:'image/png'})]){
  const h=harness();assert.equal((await h.route.POST(h.req(h.form({file}),'POST'))).status,400);assert.equal(h.calls.length,0);
 }
 const h=harness();for(const bad of [{avatar_kind:'photo',photo_path:'other/private.png'},{scope:'background',wallpaper:'https://evil.invalid/track'},{revision:-1}])assert.equal((await h.route.PATCH(h.req({...h.body,...bad}))).status,400);
});
test('uploaded photo uses private generated actor path, then replacing it cleans only that object',async()=>{
 const h=harness();const result=await h.route.POST(h.req(h.form(),'POST'));assert.equal(result.status,200);
 const row=h.tables.staff_chat_profiles[0],old=row.photo_path;assert.ok(old.startsWith(id(1)+'/profile/'));assert.ok(old.endsWith('.png'));assert.equal(h.calls[0].opts.upsert,false);
 assert.equal((await result.json()).profile.avatar_kind,'photo');assert.ok(h.calls.some(c=>c.type==='sign'&&c.ttl===300));
 assert.equal((await h.route.PATCH(h.req({...h.body,revision:1}))).status,200);assert.equal(h.objects.size,0);assert.equal(h.tables.staff_chat_profiles[0].character,'owl');
 assert.deepEqual(Array.from(h.calls.find(c=>c.type==='remove').paths),[old]);
});
test('stale revisions cannot overwrite newer preferences and discard an uncommitted upload',async()=>{
 const h=harness();await h.route.PATCH(h.req(h.body));
 assert.equal((await h.route.PATCH(h.req({...h.body,character:'cat'}))).status,409);assert.equal(h.tables.staff_chat_profiles[0].character,'owl');
 assert.equal((await h.route.POST(h.req(h.form(),'POST'))).status,409);assert.equal(h.objects.size,0);assert.equal(h.tables.staff_chat_profiles[0].character,'owl');
});
test('concurrent compare-and-set failure preserves the previous private asset',async()=>{
 const h=harness({conflict:true});h.tables.staff_chat_profiles.push({worker_id:id(1),avatar_kind:'photo',photo_path:id(1)+'/profile/old.png',revision:1});h.objects.set(id(1)+'/profile/old.png',png);
 assert.equal((await h.route.POST(h.req(h.form({revision:'1'}),'POST'))).status,409);assert.equal(h.objects.size,1);assert.ok(h.objects.has(id(1)+'/profile/old.png'));
});
test('read only exposes eligible staff profile fields and the current actor background',async()=>{
 const h=harness();h.tables.staff_chat_profiles.push({worker_id:id(2),avatar_kind:'character',character:'cat',revision:1},{worker_id:id(3),avatar_kind:'photo',photo_path:'private-central.png',revision:1});
 h.tables.staff_chat_preferences.push({worker_id:id(2),thread_id:id(10),wallpaper:'custom',background_path:'other-private.png',revision:1});
 const response=await h.route.GET(h.req(null,'GET','valid','?thread_id='+id(10)));assert.equal(response.status,200);const data=await response.json();
 assert.equal(data.profiles[id(2)].character,'cat');assert.equal(data.profiles[id(3)],undefined);assert.equal(data.preference.background_url,null);assert.equal(h.calls.length,0);
});
test('uncertain database reply after commit preserves the new private asset for reconciliation',async()=>{
 const h=harness({commitTimeout:true});assert.equal((await h.route.POST(h.req(h.form(),'POST'))).status,500);
 assert.equal(h.tables.staff_chat_profiles.length,1);assert.equal(h.objects.size,1);assert.ok(h.objects.has(h.tables.staff_chat_profiles[0].photo_path));
 const result=await h.route.GET(h.req(null,'GET'));assert.equal(result.status,200);assert.equal((await result.json()).profile.avatar_kind,'photo');
});
