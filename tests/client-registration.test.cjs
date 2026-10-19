const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const { randomUUID } = require('node:crypto');
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {exports,require:name => Object.hasOwn(mocks,name)?mocks[name]:require(name),process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://test.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'test',SUPABASE_SERVICE_ROLE_KEY:'test-only'}}, Request,Response,URL,URLSearchParams,console,...globals});
  return exports;
}
const response = { json:(body, init)=>Response.json(body,init) };

test('CRM authorization ignores editable metadata and never mutates or looks up another account', async () => {
  let query;
  const db={from:table=>{assert.equal(table,'crm_clientes');return {select:()=>({eq:(field,value)=>{query={field,value};return {limit:async()=>({data:[],error:null})}}})}}};
  const mod=load('src/lib/server/auth-cliente.ts',{'@supabase/supabase-js':{createClient:(_,key)=>key==='test-only'?db:{auth:{getUser:async()=>({data:{user:{id:'attacker',email:'attacker@example.test',user_metadata:{crm_phone:'victim-phone',crm_email:'victim@example.test',crm_cliente_id:'victim'}}}})}}},'@/lib/server/cliente-auth-password':{normalizePhoneDigits:x=>String(x||'').replace(/\D/g,'')}});
  const gate=await mod.clientFromRequest(new Request('https://local/api',{headers:{authorization:'Bearer verified-by-auth'}}));
  assert.equal(gate.cliente,null); assert.deepEqual(query,{field:'auth_user_id',value:'attacker'});
});

test('an invalid Auth token never reaches CRM', async () => {
  const mod=load('src/lib/server/auth-cliente.ts',{'@supabase/supabase-js':{createClient:()=>({auth:{getUser:async()=>({error:{status:401},data:{}})}})},'@/lib/server/cliente-auth-password':{normalizePhoneDigits:x=>x}});
  const gate=await mod.clientFromRequest(new Request('https://local/api',{headers:{authorization:'Bearer forged'}}));assert.equal(gate.uid,null);assert.equal(gate.admin,null);
});

test('password creation without verified ownership cannot reset an existing customer', async () => {
  const mod=load('src/app/api/cliente/auth/password/create/route.ts',{'next/server':{NextResponse:response},'@/lib/server/auth-cliente':{clientFromRequest:async()=>({uid:null,cliente:null})}});
  const result=await mod.POST(new Request('https://local/api',{method:'POST',body:JSON.stringify({phone:'34600000000',password:'new-password',password_confirm:'new-password'})}));assert.equal(result.status,401);
});

test('authenticated password changes target only the verified uid, never a supplied phone', async () => {
  let changed;
  const admin = { auth: { admin: {
    updateUserById: async (uid, payload) => { changed = { uid, payload }; return { error: null }; },
  } } };
  const mod=load('src/app/api/cliente/auth/password/create/route.ts',{'next/server':{NextResponse:response},'@/lib/server/auth-cliente':{clientFromRequest:async()=>({uid:'owner',cliente:{id:'own'},admin})}});
  const result=await mod.POST(new Request('https://local/api',{method:'POST',body:JSON.stringify({phone:'victim-phone',auth_user_id:'victim',password:'good-password',password_confirm:'good-password'})}));assert.equal(result.status,200);assert.equal(changed.uid,'owner');
});

test('Instagram entry preserves Oracle through login and recovery without open redirects', () => {
  const entry=load('src/lib/client-entry.ts');
  assert.equal(entry.clientLoginHref('oraculo','?source=instagram'),'/cliente/login?next=oraculo&source=instagram');
  assert.equal(entry.clientDestination('?next=oraculo&source=instagram'),'/cliente/oraculo');
  assert.equal(entry.clientRecoveryHref('?next=oraculo'),'/cliente/recuperar?next=oraculo');
  for(const next of ['https://evil.test','//evil.test','../../admin','/admin']) assert.equal(entry.clientDestination('?next='+encodeURIComponent(next)),'/cliente/dashboard');
});

test('phone login returns the same generic error for missing accounts and bad passwords, without exposing email', async () => {
  for (const found of [false, true]) {
    const mod=load('src/app/api/cliente/auth/password/login/route.ts',{
      'next/server':{NextResponse:response},
      '@supabase/supabase-js':{createClient:()=>({auth:{signInWithPassword:async()=>({error:{message:'bad password'},data:{session:null}})}})},
      '@/lib/server/cliente-auth-password':{
        normalizePhoneDigits:x=>x,findClienteByPhoneForAuth:async()=>found?{auth_user_id:'owner'}:null,
        adminSupabase:()=>({auth:{admin:{getUserById:async()=>({data:{user:{id:'owner',email:'private@example.test'}}})}}}),
      },
    });
    const result=await mod.POST(new Request('https://local/api',{method:'POST',body:JSON.stringify({phone:'34600000000',password:'wrong-password'})}));
    assert.equal(result.status,401);assert.deepEqual(await result.json(),{ok:false,error:'INVALID_LOGIN_CREDENTIALS'});
  }
});

test('successful phone login discloses only session credentials after Auth proves the linked identity', async () => {
  let credentials;
  const mod=load('src/app/api/cliente/auth/password/login/route.ts',{
    'next/server':{NextResponse:response},
    '@supabase/supabase-js':{createClient:()=>({auth:{signInWithPassword:async(input)=>{credentials=input;return {error:null,data:{user:{id:'owner'},session:{access_token:'test-access',refresh_token:'test-refresh'}}}}}})},
    '@/lib/server/cliente-auth-password':{normalizePhoneDigits:x=>x,findClienteByPhoneForAuth:async()=>({auth_user_id:'owner'}),adminSupabase:()=>({auth:{admin:{getUserById:async()=>({data:{user:{id:'owner',email:'private@example.test'}}})}}})},
  });
  const result=await mod.POST(new Request('https://local/api',{method:'POST',body:JSON.stringify({phone:'34600000000',password:'right-password'})}));
  assert.equal(result.status,200);assert.equal(credentials.email,'private@example.test');assert.equal((await result.json()).alias_email,undefined);
});

test('registration validates canonical international numbers and treats source only as attribution', () => {
  const mod=load('src/lib/server/cliente-registration.ts',{'@/lib/server/cliente-auth-password':{},'@/lib/server/cliente-whatsapp-auth':{},'@/lib/countries':{COUNTRY_OPTIONS:[{code:'AR',dialCode:'+54',label:'Argentina'}]}});
  const body={name:'Ana',surname:'Luz',email:' ANA@example.test ',phone:'541155555555',country:'AR',source:'instagram',auth_user_id:'victim',role:'admin'};
  const valid=mod.registrationProfile(body);assert.equal(valid.email,'ana@example.test');assert.equal(valid.country,'Argentina');assert.equal(valid.source,'instagram');assert.equal(valid.auth_user_id,undefined);
  for(const patch of [{name:'<img>'},{email:'cliente-123@auth.tarotcelestial.local'},{phone:'34600000000'},{phone:'54xx'}]) assert.throws(()=>mod.registrationProfile({...body,...patch}));
});

test('registration recovers only its own Auth attempt and never changes a previously existing password', async () => {
  const id=randomUUID(), leaseData={ok:true,profile:{email:'ana@example.test',name:'Ana'}};
  let creates=0, writes=0;
  const admin={rpc:async()=>({data:leaseData,error:null}),auth:{admin:{createUser:async()=>{creates++;return {data:{user:null},error:{message:'already exists'}}}}},from:()=>{writes++;throw Error('must not write')}};
  const mod=load('src/lib/server/cliente-registration.ts',{'@/lib/server/cliente-auth-password':{adminSupabase:()=>admin,findAuthUserByAliasEmail:async()=>({id:'old-owner',email:'ana@example.test',app_metadata:{registration_id:'another-attempt'}})},'@/lib/server/cliente-whatsapp-auth':{},'@/lib/countries':{COUNTRY_OPTIONS:[]}});
  await assert.rejects(mod.completeRegistration({challenge_id:id,code:'123456',password:'good-password',password_confirm:'good-password'}),/REGISTRATION_ACCOUNT_EXISTS/);assert.equal(creates,1);assert.equal(writes,0);
});

test('SQL registration is atomic, duplicate-safe, rate-limited and inaccessible to browser roles', async t => {
  const db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.workers(id uuid default gen_random_uuid(),user_id uuid);
    create table public.crm_clientes(id uuid primary key default gen_random_uuid(),nombre text not null,apellido text,telefono text not null,telefono_normalizado text not null,email text,pais text,auth_user_id uuid unique,origen text,lead_source text,lead_status text,lead_created_at timestamptz);
    create table public.crm_etiquetas(id uuid primary key default gen_random_uuid(),nombre text not null,color text,activa boolean default true,created_at timestamptz default now());
    create table public.crm_cliente_etiquetas(id uuid primary key default gen_random_uuid(),cliente_id uuid,etiqueta_id uuid,unique(cliente_id,etiqueta_id));
    grant all on all tables in schema public to service_role;`);
  const migration=fs.readdirSync(path.join(__dirname,'../supabase/migrations')).find(name=>name.endsWith('_client_verified_registration.sql'));
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',migration),'utf8'));
  const hash='a'.repeat(64);
  const profile=(suffix='1')=>({name:'Ana',surname:'Luz',email:`ana${suffix}@example.test`,phone:`54115555555${suffix}`,country:'Argentina',source:'instagram'});
  const start=async(id,p,ip=randomUUID())=>(await db.query('select public.tc_client_registration_start($1,$2,$3,$4) result',[id,p,hash,ip])).rows[0].result;
  const claim=async(id,lease,codeHash=hash)=>(await db.query('select public.tc_client_registration_claim($1,$2,$3) result',[id,codeHash,lease])).rows[0].result;
  const finish=async(id,lease,user)=>(await db.query('select public.tc_client_registration_complete($1,$2,$3) result',[id,lease,user])).rows[0].result;
  try {
    await t.test('new verified Instagram registration creates exactly one CRM and tag, without XP/purchase side effects',async()=>{
      const id=randomUUID(),lease=randomUUID(),user=randomUUID();assert.equal((await start(id,profile())).ok,true);assert.equal((await claim(id,lease)).ok,true);
      await db.query('update public.tc_client_registration_challenges set auth_user_id=$2 where id=$1',[id,user]);
      const result=await finish(id,lease,user);assert.equal(result.ok,true);assert.equal((await finish(id,lease,user)).cliente_id,result.cliente_id);
      assert.equal((await claim(id,randomUUID())).completed,true);
      assert.equal((await db.query('select count(*)::int n from public.crm_clientes')).rows[0].n,1);
      assert.equal((await db.query('select nombre from public.crm_etiquetas')).rows[0].nombre,'cliente instagram');
      assert.equal((await db.query('select count(*)::int n from public.crm_cliente_etiquetas')).rows[0].n,1);
    });
    await t.test('existing CRM telephone/email cannot be claimed and original Auth stays intact',async()=>{
      await db.exec("update public.tc_client_registration_challenges set created_at=now()-interval '2 minutes' where state='completed'");
      const before=(await db.query('select auth_user_id from public.crm_clientes')).rows[0].auth_user_id;
      assert.equal((await start(randomUUID(),{...profile('2'),phone:profile().phone})).error,'REGISTRATION_ACCOUNT_EXISTS');
      assert.equal((await start(randomUUID(),{...profile('2'),email:profile().email})).error,'REGISTRATION_ACCOUNT_EXISTS');
      assert.equal((await db.query('select auth_user_id from public.crm_clientes')).rows[0].auth_user_id,before);
    });
    await t.test('five wrong codes lock the challenge, correct later guesses do not bypass',async()=>{
      const id=randomUUID();await start(id,profile('2'));
      for(let i=0;i<5;i++) assert.equal((await claim(id,randomUUID(),'b'.repeat(64))).error,'CODIGO_INVALIDO');
      assert.equal((await claim(id,randomUUID())).error,'OTP_EXPIRED');
    });
    await t.test('in-flight attempt cannot run twice and another Auth id cannot complete it',async()=>{
      const id=randomUUID(),lease=randomUUID();await start(id,profile('3'));await claim(id,lease);
      assert.equal((await claim(id,randomUUID())).error,'REGISTRATION_IN_PROGRESS');
      assert.equal((await finish(id,lease,randomUUID())).ok,false);
    });
    await t.test('two verified challenges for the same phone produce one CRM record',async()=>{
      const a=randomUUID(),b=randomUUID(),la=randomUUID(),lb=randomUUID(),ua=randomUUID(),ub=randomUUID();
      await start(a,profile('4'));await start(b,{...profile('5'),phone:profile('4').phone});
      await claim(a,la);await claim(b,lb);
      await db.query('update public.tc_client_registration_challenges set auth_user_id=$2 where id=$1',[a,ua]);await db.query('update public.tc_client_registration_challenges set auth_user_id=$2 where id=$1',[b,ub]);
      assert.equal((await finish(a,la,ua)).ok,true);assert.equal((await finish(b,lb,ub)).error,'REGISTRATION_ACCOUNT_EXISTS');
    });
    await t.test('email throttling prevents repeated verification sends',async()=>{
      const p=profile('6');assert.equal((await start(randomUUID(),p)).ok,true);assert.equal((await start(randomUUID(),p)).error,'REGISTRATION_RATE_LIMIT');
    });
    await t.test('anon and authenticated cannot read challenges or execute registration RPCs',async()=>{
      for(const role of ['anon','authenticated']) {
        await db.exec(`set role ${role}`);
        await assert.rejects(db.query('select * from public.tc_client_registration_challenges'),/permission denied/);
        await assert.rejects(db.query('select public.tc_client_registration_claim($1,$2,$3)',[randomUUID(),hash,randomUUID()]),/permission denied/);
        await db.exec('reset role');
      }
    });
    await t.test('service_role can run the security-invoker start RPC without auth.users grants',async()=>{
      await db.exec('set role service_role');assert.equal((await start(randomUUID(),profile('7'))).ok,true);await db.exec('reset role');
    });
  } finally { await db.close(); }
});

test('Instagram registration UI verifies the email and enters the Oracle after creating a new account', async () => {
  const React=require('react'), renderer=require('react-test-renderer');const {act}=renderer;
  const entry=load('src/lib/client-entry.ts');
  let destination, signedIn, payloads=[];
  const country={code:'ES',dialCode:'+34',label:'España'};
  const styles=new Proxy({},{get:(_,key)=>String(key)});
  const Login=load('src/app/cliente/login/page.tsx',{
    'next/navigation':{useRouter:()=>({replace:path=>{destination=path},push:path=>{destination=path}})},
    '@/lib/client-entry':entry,
    '@/components/cliente/ClientAuthShell':{default:({children})=>React.createElement('section',null,children),__esModule:true},
    '@/components/cliente/ClientAuthShell.module.css':{default:styles,__esModule:true},
    '@/lib/supabase-browser':{supabaseClienteBrowser:()=>({auth:{getSession:async()=>({data:{session:null}}),signInWithPassword:async data=>{signedIn=data;return {error:null}}}})},
    '@/lib/countries':{COUNTRY_OPTIONS:[country],DEFAULT_COUNTRY_CODE:'ES',getCountryByCode:()=>country,guessDefaultCountry:()=>country,normalizeLocalPhone:x=>x,buildInternationalPhone:(_,value)=>'+34'+value},
    '@/lib/client-auth-ui':{countryFlag:()=>'',friendlyAuthError:error=>error.message,localPhoneMaxLength:()=>9,validateLocalPhone:(_,phone)=>phone.length===9?'':'invalid'},
  },{window:{location:{search:'?next=oraculo&source=instagram'}},fetch:async(url,options)=>{
    payloads.push({url,body:JSON.parse(options.body)});
    return {ok:true,json:async()=>url.endsWith('/start')?{ok:true,challenge_id:'test-challenge'}:{ok:true,alias_email:'ana@example.test'}};
  }}).default;
  let view;
  await act(async()=>{view=renderer.create(React.createElement(Login))});
  assert.match(JSON.stringify(view.toJSON()),/REGISTRARSE/);
  for(const [id,value] of [['client-phone','600000000'],['register-name','Ana'],['register-email','ana@example.test'],['client-new-password','good-password'],['client-confirm-password','good-password']]) {
    await act(async()=>view.root.findAllByType('input').find(input=>input.props.id===id).props.onChange({target:{value}}));
  }
  await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(payloads[0].body.source,'instagram');assert.equal(payloads[0].body.phone,'34600000000');assert.equal(payloads[0].body.password,undefined);
  assert.equal(view.root.findByProps({id:'register-email'}).props.disabled,true);
  await act(async()=>view.root.findByProps({id:'register-code'}).props.onChange({target:{value:'123456'}}));
  await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(payloads[1].body.code,'123456');assert.equal(signedIn.email,'ana@example.test');assert.equal(destination,'/cliente/oraculo');
  act(()=>view.unmount());
});
