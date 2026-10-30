const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from([0,0,0,13]),Buffer.from('IHDR'),Buffer.alloc(8)]);
function harness(options={}){
 const objects=new Map(),calls=[],rows=[],messages=[];
 const workers=[{id:id(1),role:'central',is_active:!options.inactive,user_id:id(101),display_name:'Fixture'},{id:id(2),role:'tarotista',is_active:true,user_id:id(102)}];
 const threads=[{id:id(10),central_worker_id:id(1),tarotist_worker_id:id(2)},{id:id(11),central_worker_id:id(3),tarotist_worker_id:id(4)}];
 const tables={workers,chat_threads:threads,staff_chat_attachments:rows,chat_messages:messages,chat_thread_reads:[]};
 class Query{
  constructor(name){this.name=name;this.filters=[];this.action='select';}
  select(){return this;}eq(k,v){this.filters.push(r=>r[k]===v);return this;}
  in(k,v){this.filters.push(r=>v.includes(r[k]));return this;}
  or(v){const terms=v.split(',').map(x=>x.split('.eq.'));this.filters.push(r=>terms.some(([k,value])=>r[k]===value));return this;}
  limit(){return this;}order(){return this;}insert(value){this.action='insert';this.value=value;return this;}
  update(value){this.action='update';this.value=value;return this;}
  async run(single=false){
   let found=tables[this.name].filter(r=>this.filters.every(f=>f(r)));
   if(this.action==='insert'){if(tables[this.name].some(r=>r.id===this.value.id))return {data:null,error:{code:'23505'}};
    const r={...this.value};tables[this.name].push(r);found=[r];}
   if(this.action==='update')for(const r of found)Object.assign(r,this.value);
   return {data:single?found[0]||null:found,error:null};
  }
  maybeSingle(){return this.run(true);}single(){return this.run(true);}then(resolve,reject){return this.run().then(resolve,reject);}
 }
 const storage={
  exists:async p=>({data:objects.has(p),error:null}),
  createSignedUploadUrl:async(p,o)=>{calls.push({type:'upload',p,o});return {data:{token:'fixture-token',signedUrl:'https://storage.test/upload'},error:null};},
  info:async p=>objects.has(p)?{data:{size:objects.get(p).bytes.length,contentType:objects.get(p).mime},error:null}:{data:null,error:{message:'missing'}},
  download:async p=>({data:new Blob([objects.get(p).bytes]),error:null}),
  createSignedUrl:async(p,ttl)=>{calls.push({type:'read',p,ttl});return {data:{signedUrl:'https://storage.test/private-fixture'},error:null};},
 };
 const db={from:name=>new Query(name),auth:{getUser:async token=>token==='valid'?{data:{user:{id:id(101)}},error:null}:{data:{user:null},error:{message:'bad signature'}}},
  storage:{from:bucket=>{assert.equal(bucket,'staff-chat-private');return storage;}},
  rpc:async(name,args)=>{calls.push({type:'rpc',name,args});
   if(options.rpcError)return {data:null,error:{message:options.rpcError}};
   const prior=messages.find(m=>m.client_message_id===args.p_client_message_id);
   if(prior)return {data:{message:prior,duplicate:true},error:null};
   const m={id:id(999),thread_id:args.p_thread_id,sender_worker_id:args.p_worker_id,body:args.p_body,created_at:'2026-10-30T10:00:00Z',client_message_id:args.p_client_message_id};
   messages.push(m);rows.find(r=>r.id===args.p_attachment_id).message_id=m.id;return {data:{message:m,duplicate:false},error:null};
  }};
 const deps={
  '@/lib/supabase-admin':{supabaseAdmin:()=>db},
  '@/lib/server/panel-attendance':{requireActivePanelSession:async()=>options.offline?{ok:false,status:423,error:'PANEL_CONNECTION_REQUIRED'}:{ok:true}},
  'next/server':{NextResponse:{json:(data,init={})=>new Response(JSON.stringify(data),{...init,headers:init.headers})}},
 };
 function load(file){const exports={};const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../'+file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,require:n=>{if(!deps[n])throw Error(n);return deps[n];},Buffer,Uint8Array,Date,crypto,URL,Map});return exports;}
 deps['@/lib/server/staff-chat']=load('src/lib/server/staff-chat.ts');
 deps['@/lib/server/staff-chat-media']=load('src/lib/server/staff-chat-media.ts');
 const upload=load('src/app/api/chat/media/upload/route.ts'),read=load('src/app/api/chat/media/read/route.ts'),send=load('src/app/api/chat/messages/route.ts');
 const input={thread_id:id(10),client_upload_id:id(20),kind:'image',mime_type:'image/png',file_name:'test.png',size_bytes:png.length};
 const req=(body,token='valid',url='/api/chat/media/upload')=>new Request('https://panel.test'+url,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token},...(body?{body:JSON.stringify(body)}:{})});
 async function ready(){const r=await upload.POST(req(input));assert.equal(r.status,200);const value=await r.json();objects.set(value.path,{bytes:png,mime:'image/png'});return value;}
 return {db,objects,calls,rows,messages,input,req,upload,read,send,ready,helper:deps['@/lib/server/staff-chat-media']};
}
test('media reservations validate MIME, kind and exact per-kind size limits',()=>{
 const h=harness(),f=h.helper.mediaInput;
 for(const mime of ['image/jpeg','image/png','image/webp'])assert.equal(f({...h.input,mime_type:mime,size_bytes:10485760}).size,10485760);
 for(const mime of ['audio/webm;codecs=opus','audio/ogg','audio/mp4','audio/mpeg'])assert.equal(f({...h.input,kind:'audio',mime_type:mime,size_bytes:15728640}).size,15728640);
 for(const bad of [{mime_type:'image/svg+xml'},{mime_type:'text/html'},{kind:'audio'},{size_bytes:0},{size_bytes:10485761},{size_bytes:'24'},{client_upload_id:'../other'}])assert.throws(()=>f({...h.input,...bad}),/INVALID_/);
 assert.equal(f({...h.input,file_name:'../../file\u0000.png'}).fileName,'.._.._file_.png');
});
test('actual upload/read endpoints reject anonymous, invalid and inactive accounts',async()=>{
 for(const token of ['', 'forged']){const h=harness();assert.equal((await h.upload.POST(h.req(h.input,token))).status,401);assert.equal((await h.read.GET(h.req(null,token,'/api/chat/media/read?attachment_id='+id(20)))).status,401);assert.equal(h.calls.length,0);}
 const h=harness({inactive:true});assert.equal((await h.upload.POST(h.req(h.input))).status,403);assert.equal(h.rows.length,0);
});
test('upload and send require connection; thread ownership is checked before signing',async()=>{
 const h=harness({offline:true});assert.equal((await h.upload.POST(h.req(h.input))).status,423);assert.equal(h.rows.length,0);
 const g=harness();g.db.from('chat_threads');assert.equal((await g.upload.POST(g.req({...g.input,thread_id:id(99)}))).status,404);assert.equal(g.calls.length,0);
 assert.equal((await g.upload.POST(g.req({...g.input,thread_id:id(11)}))).status,403);assert.equal(g.rows.length,0);
});
test('a pending send from a different account is rejected before reservation or message mutation',async()=>{
 const h=harness({offline:true});
 for(const [handler,body] of [[h.upload.POST,{...h.input,expected_worker_id:id(2)}],[h.send.POST,{thread_id:id(10),text:'Old account draft',client_message_id:'pending-old',expected_worker_id:id(2)}]]){
  const response=await handler(h.req(body));assert.equal(response.status,409);assert.equal((await response.json()).error,'IDENTITY_CHANGED');
 }
 assert.equal(h.rows.length,0);assert.equal(h.messages.length,0);assert.equal(h.calls.length,0);
 const correct=harness();assert.equal((await correct.upload.POST(correct.req({...correct.input,expected_worker_id:id(1)}))).status,200);
});
test('upload retry keeps the object and token is never issued with upsert',async()=>{
 const h=harness(),one=await h.upload.POST(h.req(h.input));assert.equal(one.status,200);
 const two=await h.upload.POST(h.req(h.input));assert.equal(two.status,200);assert.equal(h.rows.length,1);
 assert.equal(h.calls.filter(c=>c.type==='upload').every(c=>c.o.upsert===false),true);
 const response=await two.json();h.objects.set(response.path,{bytes:png,mime:'image/png'});
 const three=await (await h.upload.POST(h.req(h.input))).json();assert.equal(three.already_uploaded,true);assert.equal(three.token,undefined);
 assert.equal((await h.upload.POST(h.req({...h.input,size_bytes:25}))).status,409);
});
test('actual content and byte size are verified before delivery; another sender cannot attach',async()=>{
 const h=harness(),up=await h.ready(),body={thread_id:id(10),client_message_id:'media-1',attachment_id:up.attachment_id,text:''};
 h.objects.set(up.path,{bytes:Buffer.alloc(png.length,60),mime:'image/png'});
 let r=await h.send.POST(h.req(body));assert.equal(r.status,400);assert.equal((await r.json()).error,'INVALID_MEDIA_CONTENT');assert.equal(h.messages.length,0);
 h.objects.set(up.path,{bytes:png,mime:'text/html'});assert.equal((await h.send.POST(h.req(body))).status,400);
 h.objects.set(up.path,{bytes:png,mime:'image/png'});h.rows[0].sender_worker_id=id(2);assert.equal((await h.send.POST(h.req(body))).status,403);
});
test('successful attachment has one message across retries; only linked validated media receives a short-lived URL',async()=>{
 const h=harness(),up=await h.ready(),body={thread_id:id(10),client_message_id:'media-1',attachment_id:up.attachment_id,text:''};
 const url='/api/chat/media/read?attachment_id='+up.attachment_id;
 assert.equal((await h.read.GET(h.req(null,'valid',url))).status,404);
 const r=await h.send.POST(h.req(body));assert.equal(r.status,201);const message=(await r.json()).message;
 assert.equal(message.text,'📷 Imagen');assert.equal(message.attachment.id,up.attachment_id);assert.equal(message.attachment.object_path,undefined);
 assert.equal((await h.send.POST(h.req(body))).status,200);assert.equal(h.messages.length,1);
 const read=await h.read.GET(h.req(null,'valid',url));assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'private, no-store');
 assert.equal((await read.json()).expires_in,60);assert.equal(h.calls.find(c=>c.type==='read').ttl,60);
 const page=await (await h.send.GET(h.req(null,'valid','/api/chat/messages?thread_id='+id(10)))).json();assert.equal(page.messages[0].attachment.id,up.attachment_id);
 h.rows[0].thread_id=id(11);
 assert.equal((await h.read.GET(h.req(null,'valid',url))).status,403);
 assert.equal(h.calls.filter(c=>c.type==='read').length,1);
});
test('format validation accepts supported audio containers and rejects video or spoofed bytes',()=>{
 const valid=harness().helper.validMediaBytes;
 for(const [mime,bytes] of [
  ['image/jpeg',Buffer.from([255,216,255,224,0])],['image/png',png],['image/webp',Buffer.from('RIFF1234WEBPVP8 ')],
  ['audio/ogg',Buffer.from('OggS00OpusHead')],['audio/webm',Buffer.concat([Buffer.from([26,69,223,163]),Buffer.from('webmA_OPUS')])],
  ['audio/mp4',Buffer.from('1234ftypM4A 1234soun')],['audio/mpeg',Buffer.from([255,251,144,0,0])]
 ])assert.equal(valid(bytes,mime),true,mime);
 assert.equal(valid(Buffer.from('<svg/>'),'image/png'),false);
 assert.equal(valid(Buffer.from('1234ftypM4A 1234sounvide'),'audio/mp4'),false);
 assert.equal(valid(Buffer.from('ID3fake'),'audio/mpeg'),false);
});
test('unexpected storage/database details are sanitized',async()=>{
 const h=harness({rpcError:'private internal token details'});const up=await h.ready();
 const r=await h.send.POST(h.req({thread_id:id(10),client_message_id:'media-1',attachment_id:up.attachment_id}));
 assert.equal(r.status,500);assert.equal((await r.json()).error,'CHAT_ERROR');
});
