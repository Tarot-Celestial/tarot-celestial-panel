// Local fixtures only. No network, real contacts, storage upload or WhatsApp sends.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const supabaseUrl='https://fixture.supabase.co';
function load(file,mocks={}) {
 const exports={};
 const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:n=>{if(n in mocks)return mocks[n];throw Error('Unexpected import '+n);},URL,Request,Response,Headers,File,FormData,Uint8Array,TextDecoder,crypto,process:{env:{NEXT_PUBLIC_SUPABASE_URL:supabaseUrl}}});
 return exports;
}
const lib=load('src/lib/whatsapp-campaign-drafts.ts'),bodyLib=load('src/lib/server/whatsapp-draft-body.ts');
const contact=(phone='+34600111222',name='Ana')=>({id:id(10),phone,name,consent_status:'pending',consent_note:''});
const slots=()=>{const value=lib.blankWhatsAppDraftSlots();value[0].contacts=[contact()];value[0].message='Hola {{nombre}}, descubre la lectura.';return value;};
function harness() {
 const h={gate:true,userId:id(1),workerUserId:id(1),active:true,calls:[],uploads:[],error:null,throwNext:false,version:0,savedSlots:lib.blankWhatsAppDraftSlots(),ledger:new Map(),resolution:null};
 const admin={async rpc(name,payload){
  h.calls.push({name,payload});
  if(h.error)return {data:null,error:h.error};
  if(name==='tc_admin_whatsapp_draft_get')return {data:{version:h.version,updated_at:h.version?'2026-10-26T12:00:00Z':null,slots:h.savedSlots}};
  if(name==='tc_admin_whatsapp_draft_resolve')return {data:h.resolution||payload.p_phones.map(phone=>({phone,match:'unique',name:'Ana Pérez'}))};
  if(name!=='tc_admin_whatsapp_draft_save')throw Error('Unexpected mutation');
  const prior=h.ledger.get(payload.p_request_id);
  if(prior) return JSON.stringify(prior.payload)===JSON.stringify(payload)?{data:prior.data}:{error:{message:'OPERATION_CONFLICT'}};
  if(payload.p_expected_version!==h.version)return {error:{message:'VERSION_CONFLICT'}};
  h.version++;h.savedSlots=payload.p_document.slots;
  const data={version:h.version,updated_at:'2026-10-26T12:00:00Z',slots:h.savedSlots};
  h.ledger.set(payload.p_request_id,{payload,data});
  if(h.throwNext){h.throwNext=false;throw Error('Lost response after save');}
  return {data};
 },storage:{from(bucket){return {async upload(object,bytes,options){h.uploads.push({bucket,object,bytes,options});return {error:h.error};},getPublicUrl(object){return {data:{publicUrl:`${supabaseUrl}/storage/v1/object/public/${bucket}/${object}`}};}};}}};
 const auth={requireAdmin:async()=>h.gate?{ok:true,authUserId:h.userId,me:{user_id:h.workerUserId,is_active:h.active,role:'admin'},admin}:{ok:false,error:'FORBIDDEN'}};
 const mocks={'next/server':{NextResponse:{json:(data,options)=>({body:data,...options})}},'@/lib/admin/require-admin':auth,'@/lib/whatsapp-campaign-drafts':lib,'@/lib/server/whatsapp-draft-body':bodyLib};
 h.route=load('src/app/api/admin/whatsapp-campaign-drafts/route.ts',mocks);
 h.imageRoute=load('src/app/api/admin/whatsapp-campaign-drafts/image/route.ts',mocks);
 h.payload={action:'save',request_id:id(20),expected_version:0,slots:slots()};
 h.post=(data=h.payload)=>h.route.POST(new Request('https://panel.test/api/admin/whatsapp-campaign-drafts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)}));
 h.get=()=>h.route.GET(new Request('https://panel.test/api/admin/whatsapp-campaign-drafts'));
 h.image=async(bytes,type='image/png')=>{const form=new FormData();form.set('file',new File([bytes],'image.png',{type}));return h.imageRoute.POST(new Request('https://panel.test/api/admin/whatsapp-campaign-drafts/image',{method:'POST',body:form}));};
 return h;
}

test('Phones require an explicit country prefix; formatted equivalents dedupe across both lists',()=>{
 assert.equal(lib.normalizeWhatsAppDraftPhone('0034 (600) 111-222'),'+34600111222');
 for(const phone of ['600111222','+0 600111222','+34600111222 ext3','+123','+1234567890123456'])assert.throws(()=>lib.normalizeWhatsAppDraftPhone(phone));
 const data=slots();data[1].contacts=[{...contact('0034 600111222'),id:id(11)}];
 assert.throws(()=>lib.normalizeWhatsAppDraftSlots(data),/repetido/);
 data[1].contacts=[];data[0].sender_phone='+34600111222';data[1].sender_phone='0034600111222';
 assert.throws(()=>lib.normalizeWhatsAppDraftSlots(data),/remitente diferente/);
});
test('Import is pending regardless of name and preserves empty names without inventing a person',()=>{
 const result=lib.parseWhatsAppContactLines('+34600111222;Ana\n+34600111223\n');
 assert.equal(result.errors.length,0);assert.equal(result.contacts.length,2);
 assert.equal(result.contacts[1].name,'');assert.equal(result.contacts[0].consent_status,'pending');assert.equal(result.contacts[0].consent_note,'');
 assert.equal(lib.renderWhatsAppDraftMessage('Hola {{nombre}}. {{nombre}}',''),'Hola [Falta nombre]. [Falta nombre]');
 assert.equal(lib.renderWhatsAppDraftMessage('Hola {{nombre}}','$&'),'Hola $&');
 assert.equal(lib.parseWhatsAppContactLines('+34600111222;Ana\n0034600111222;Otra').errors.length,1);
 assert.equal(lib.parseWhatsAppContactLines('600111222;Ana').errors[0].line,1);
});
test('Draft validation distinguishes consent evidence, marker names, caps and empty draft content',()=>{
 assert.equal(lib.normalizeWhatsAppDraftSlots(lib.blankWhatsAppDraftSlots()).length,2);
 let data=slots();data[0].contacts[0].consent_status='confirmed';assert.throws(()=>lib.normalizeWhatsAppDraftSlots(data),/consentimiento/);
 data[0].contacts[0].consent_note='Formulario WhatsApp 26/10/2026';assert.equal(lib.normalizeWhatsAppDraftSlots(data)[0].contacts[0].consent_status,'confirmed');
 data[0].message='Hola {{telefono}}';assert.throws(()=>lib.normalizeWhatsAppDraftSlots(data),/marcador/);
 data=slots();data[0].contacts=Array.from({length:301},(_,i)=>({...contact('+346'+String(i).padStart(8,'0')),id:id(i+100)}));assert.throws(()=>lib.normalizeWhatsAppDraftSlots(data),/300/);
 data=slots();data[0].contacts[0].name='';assert.equal(lib.normalizeWhatsAppDraftSlots(data)[0].contacts[0].name,'');
});
test('Image links are limited to HTTPS own public storage or real site image paths',()=>{
 const options={supabaseUrl};
 for(const url of [`${supabaseUrl}/storage/v1/object/public/admin-whatsapp-campaign-images/a.png`,'https://clientestarotcelestial.es/images/captacion/example.webp']){const data=slots();data[0].image_url=url;assert.equal(lib.normalizeWhatsAppDraftSlots(data,options)[0].image_url,url);}
 for(const url of ['https://evil.test/image.png',`${supabaseUrl}/storage/v1/object/public/a.svg`,'http://clientestarotcelestial.es/images/a.png','https://clientestarotcelestial.es/redirect?to=https://evil.test/a.png','https://user:pass@clientestarotcelestial.es/images/a.png','https://clientestarotcelestial.es/images/../api/a.png',`${supabaseUrl}.evil.test/storage/v1/object/public/a.png`]){const data=slots();data[0].image_url=url;assert.throws(()=>lib.normalizeWhatsAppDraftSlots(data,options));}
});
test('All draft APIs deny unauthorized, inactive or stale fallback identities before RPC or upload',async()=>{
 for(const change of [{gate:false},{active:false},{active:null},{workerUserId:id(9)}]){
  const h=harness();Object.assign(h,change);
  assert.equal((await h.get()).status,403);assert.equal((await h.post()).status,403);assert.equal((await h.image(new Uint8Array([1]))).status,403);
  assert.equal(h.calls.length,0);assert.equal(h.uploads.length,0);
 }
});
test('GET empty draft is read only, actor-scoped and explicitly cannot send or claim official connection',async()=>{
 const h=harness(),r=await h.get();assert.equal(r.status,200);assert.equal(r.body.draft.version,0);assert.equal(r.body.draft.slots.length,2);
 assert.equal(r.body.capabilities.send,false);assert.equal(r.body.capabilities.official_connection,false);assert.equal(h.calls[0].payload.p_actor_user_id,h.userId);
 assert.equal(h.ledger.size,0);assert.match(r.headers['Cache-Control'],/private.*no-store/);
});
test('Save ignores forged actor and never calls a messaging function; replay after lost response writes once',async()=>{
 const h=harness();h.throwNext=true;h.payload.actor_user_id=id(90);h.payload.send=true;
 const first=await h.post();assert.equal(first.status,503);assert.equal(first.body.code,'SAVE_UNCONFIRMED');assert.equal(first.body.uncertain,true);
 const retry=await h.post();assert.equal(retry.status,200);assert.equal(retry.body.draft.version,1);assert.equal(h.ledger.size,1);
 assert.equal(h.calls[0].payload.p_actor_user_id,h.userId);assert.equal(h.calls[0].payload.p_document.slots[0].contacts[0].phone,'+34600111222');
 assert.ok(h.calls.every(call=>call.name==='tc_admin_whatsapp_draft_save'));assert.equal(h.uploads.length,0);
 const conflict=await h.post({...h.payload,slots:lib.blankWhatsAppDraftSlots()});assert.equal(conflict.status,409);assert.equal(conflict.body.code,'OPERATION_CONFLICT');
 assert.equal((await h.post({...h.payload,request_id:id(21)})).body.code,'VERSION_CONFLICT');
});
test('Unknown actions, malformed JSON, oversized stream and invalid contacts fail before mutation',async()=>{
 const h=harness();
 for(const action of ['send','activate','schedule','delete'])assert.equal((await h.post({...h.payload,action})).status,400);
 assert.equal((await h.post({...h.payload,request_id:'bad'})).status,400);
 assert.equal((await h.route.POST(new Request('https://panel.test',{method:'POST',body:'{bad'}))).status,400);
 const tooLarge=await h.route.POST(new Request('https://panel.test',{method:'POST',body:'x'.repeat(650001)}));assert.equal(tooLarge.status,413);
 assert.equal(h.calls.length,0);
});
test('Resolve only requested exact normalized phones, reports ambiguity and does not infer consent',async()=>{
 const h=harness();h.resolution=[{phone:'+34600111222',match:'unique',name:'Ana'},{phone:'+34600111223',match:'ambiguous',name:'Must not expose'},{phone:'+34600111224',match:'blocked',name:'Must not expose'}];
 const r=await h.post({action:'resolve',phones:['0034 600111222','+34600111223','+34600111224']});assert.equal(r.status,200);
 assert.equal(r.body.contacts[0].name,'Ana');assert.equal(r.body.contacts[1].name,'');assert.equal(r.body.contacts[2].name,'');assert.ok(!('consent_status' in r.body.contacts[0]));
 assert.equal(h.calls[0].payload.p_phones[0],'+34600111222');assert.equal(h.calls[0].payload.p_actor_user_id,h.userId);
 h.resolution=[{phone:'+34699999999',match:'unique',name:'Unrequested'}];assert.equal((await h.post({action:'resolve',phones:['+34600111222']})).status,503);
});
test('Known RPC conflicts/setup errors are bounded; arbitrary details are never exposed',async()=>{
 for(const [error,status,code] of [[{message:'FORBIDDEN'},403,'FORBIDDEN'],[{message:'VERSION_CONFLICT'},409,'VERSION_CONFLICT'],[{message:'INVALID_DOCUMENT'},400,'INVALID_DRAFT'],[{message:'CONSENT_NOTE_REQUIRED'},400,'INVALID_DRAFT'],[{code:'PGRST202',message:'missing private schema'},503,'SETUP_REQUIRED'],[{message:'database password secret'},503,'SAVE_UNCONFIRMED']]){
  const h=harness();h.error=error;const r=await h.post();assert.equal(r.status,status);assert.equal(r.body.code,code);assert.doesNotMatch(JSON.stringify(r.body),/password|private schema/);
 }
});
test('Image upload checks magic bytes, size and actor namespace before own-bucket write',async()=>{
 const h=harness();
 assert.equal((await h.image(new TextEncoder().encode('<svg>evil</svg>'),'image/png')).status,400);
 assert.equal((await h.image(new Uint8Array([1,2,3]),'image/svg+xml')).status,400);
 assert.equal((await h.image(new Uint8Array(3*1024*1024+1),'image/jpeg')).status,400);
 assert.equal(h.uploads.length,0);
 const r=await h.image(new Uint8Array([137,80,78,71,13,10,26,10,0]));assert.equal(r.status,200);assert.equal(h.uploads.length,1);
 assert.equal(h.uploads[0].bucket,'admin-whatsapp-campaign-images');assert.ok(h.uploads[0].object.startsWith(h.userId+'/'));assert.equal(h.uploads[0].options.upsert,false);
 assert.match(r.body.image_url,/\/storage\/v1\/object\/public\/admin-whatsapp-campaign-images\//);assert.equal(h.ledger.size,0);
});
test('Image body cap cannot be bypassed by absent or false Content-Length',async()=>{
 const h=harness();const req=new Request('https://panel.test/image',{method:'POST',headers:{'content-length':'1','content-type':'multipart/form-data; boundary=test'},body:'x'.repeat(3*1024*1024+64*1024+1)});
 const r=await h.imageRoute.POST(req);assert.equal(r.status,413);assert.equal(h.uploads.length,0);
});
