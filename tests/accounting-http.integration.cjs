/** LOCAL full-stack HTTP verification; use when no sandboxed browser is available. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startAccountingQA } = require('./accounting-qa-server.cjs');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tarot-accounting-http-'));
const report = { verification: 'Real Next HTTP route handlers → synthetic Auth/PostgREST transport → real PostgreSQL/PGlite migrations', productionTouched:false,browserVerified:false,passed:[] };
let qa, cookie='';
function passed(name) { report.passed.push(name); console.log(`PASS ${name}`); }
async function main() {
  qa=await startAccountingQA();
  console.log(`LOCAL Next started ${qa.appOrigin}`);
  async function request(suffix='',method='GET',body,opts={}) {
    const response=await fetch(`${qa.appOrigin}/api/admin/contabilidad${suffix}`,{method,
      headers:{...(opts.noAuth?{}:{Authorization:`Bearer ${qa.token}`}),...(cookie&&!opts.noCookie?{Cookie:cookie}:{}),...(method!=='GET'?{Origin:opts.origin||qa.appOrigin,'Content-Type':'application/json'}:{}),...opts.headers},
      ...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(90000)});
    const data=await response.json();return {status:response.status,data,headers:response.headers};
  }
  let r=await request('/session');assert.equal(r.status,200);assert.deepEqual(r.data,{ok:true,configured:true,unlocked:false});
  assert.equal((await request('', 'GET',undefined,{noAuth:true})).status,401);
  assert.equal((await request()).status,423);
  assert.equal(qa.calls.filter(x=>x.name==='accounting_snapshot').length,0);
  passed('Configured private gate, no-auth401, locked423, no financial read before unlock');
  r=await request('/session','POST',{password:'Deliberately-wrong-local-password'});assert.equal(r.status,403);assert.equal(r.data.code,'INVALID_PASSWORD');
  assert.equal(r.headers.get('set-cookie'),null);
  passed('Wrong password denied without cookie');
  r=await request('/session','POST',{password:qa.password});assert.equal(r.status,200);assert.equal(r.data.unlocked,true);
  const setCookie=r.headers.get('set-cookie');assert(/HttpOnly/i.test(setCookie));assert(/SameSite=strict/i.test(setCookie));assert(/Path=\/api\/admin\/contabilidad/i.test(setCookie));
  cookie=setCookie.split(';')[0];
  assert.equal((await request('/session')).data.unlocked,true);
  r=await request();assert.equal(r.status,200);assert.deepEqual(r.data.entries,[]);
  assert.match(r.headers.get('cache-control'),/no-store/);
  const seed=r.data;
  for(const name of ['PayPal','Bizum','Transferencia externa'])assert(seed.methods.some(x=>x.name===name));
  for(const name of ['Centrales','Tarotistas','Recargas','Premium numbers','WellDone'])assert(seed.categories.some(x=>x.name===name));
  passed('Correct password opens HttpOnly Strict cookie and real empty ledger with requested option seeds');
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const payload=(kind,amount,description,extra={})=>({id:randomUUID(),kind,account:'celestial',to_account:kind==='transfer'?'leonaris':null,currency:'EUR',amount_cents:amount,occurred_on:today,
    category_id:['income','expense'].includes(kind)?seed.categories.find(x=>x.kind===kind).id:null,method_id:seed.methods.find(x=>x.name==='PayPal').id,description,reference:'LOCAL QA',recipient:null,...extra});
  const entries=[payload('opening_balance',100000,'QA saldo inicial'),payload('income',10000,'QA ingreso PayPal'),payload('expense',2000,'QA pago centrales'),payload('transfer',20000,'QA traspaso neutral'),payload('vault_deposit',10000,'QA ahorro bóveda'),payload('vault_withdrawal',1000,'QA retirada bóveda')];
  for(const entry of entries){r=await request('/movimientos','POST',entry);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.entry.id,entry.id);}
  let snapshot=(await request()).data;assert.equal(snapshot.entries.length,6);
  for(const row of entries)assert.equal(snapshot.entries.find(x=>x.id===row.id).amount_cents,row.amount_cents);
  const totals=rows=>{const accounts={celestial:{available:0,vault:0},leonaris:{available:0,vault:0}};let income=0,expense=0;for(const e of rows){if(e.voided_at||e.currency!=='EUR')continue;const a=accounts[e.account],n=e.amount_cents;if(e.kind==='opening_balance'||e.kind==='income')a.available+=n;if(e.kind==='income')income+=n;if(e.kind==='expense'){a.available-=n;expense+=n;}if(e.kind==='transfer'){a.available-=n;accounts[e.to_account].available+=n;}if(e.kind==='vault_deposit'){a.available-=n;a.vault+=n;}if(e.kind==='vault_withdrawal'){a.available+=n;a.vault-=n;}}return {accounts,income,expense,net:income-expense,available:accounts.celestial.available+accounts.leonaris.available,vault:accounts.celestial.vault+accounts.leonaris.vault};};
  assert.deepEqual(totals(snapshot.entries),{accounts:{celestial:{available:79000,vault:9000},leonaris:{available:20000,vault:0}},income:10000,expense:2000,net:8000,available:99000,vault:9000});
  passed('Six real database writes persist; available990/vault90/net80; Celestial790 and Leonaris200; transfer neutral');
  r=await request('/movimientos','POST',entries[1]);assert.equal(r.status,200);assert.equal(r.data.replayed,true);
  r=await request('/movimientos','POST',{...entries[1],amount_cents:20000});assert.equal(r.status,409);
  assert.equal((await request()).data.entries.length,6);
  passed('Network retry is idempotent; modified payload with same id rejected409');
  r=await request('/movimientos','POST',payload('vault_deposit',10000000,'QA overdraw rejected'));assert.equal(r.status,409);assert.equal(r.data.code,'INSUFFICIENT_AVAILABLE');
  assert.equal((await request()).data.entries.length,6);
  passed('Insufficient-funds vault allocation rejected atomically');
  for(const kind of ['income','expense','method']){
    r=await request('/opciones','POST',{kind,name:`QA custom ${kind}`,active:true});assert.equal(r.status,200,JSON.stringify(r.data));
    const id=r.data.option.id;assert(id);
    r=await request('/opciones','POST',{kind,id,name:`QA renamed ${kind}`,active:true});assert.equal(r.status,200);
    r=await request('/opciones','POST',{kind,id,name:`QA renamed ${kind}`,active:false});assert.equal(r.status,200);
  }
  snapshot=(await request()).data;for(const kind of ['income','expense','method'])assert((kind==='method'?snapshot.methods:snapshot.categories).some(x=>x.name===`QA renamed ${kind}`&&x.active===false));
  passed('Custom income/expense/payment options create, rename, archive and persist');
  r=await request('/movimientos/anular','POST',{id:entries[2].id,reason:'QA audited correction'});assert.equal(r.status,200);
  snapshot=(await request()).data;assert.equal(snapshot.entries.length,6);
  const voided=snapshot.entries.find(x=>x.id===entries[2].id);assert(voided.voided_at);assert.equal(voided.void_reason,'QA audited correction');assert.equal(voided.amount_cents,2000);
  assert.equal(totals(snapshot.entries).available,101000);assert.equal(totals(snapshot.entries).net,10000);
  passed('Annulment keeps immutable original/audit, available1010 and net100 after fresh HTTP reread');
  const noOrigin=await fetch(`${qa.appOrigin}/api/admin/contabilidad/movimientos`,{method:'POST',headers:{Authorization:`Bearer ${qa.token}`,Cookie:cookie,'Content-Type':'application/json'},body:'{}'});assert.equal(noOrigin.status,403);
  assert.equal((await request('/movimientos','POST',{}, {origin:'https://example.invalid'})).status,403);
  assert.equal((await request('/movimientos','POST',{}, {headers:{'Content-Type':'text/plain'}})).status,415);
  const anonRpc=await fetch(`${qa.dbOrigin}/rest/v1/rpc/accounting_snapshot`,{method:'POST',headers:{'Content-Type':'application/json',apikey:'synthetic-anon-key-local-qa-only'},body:JSON.stringify({p_actor:qa.user.id})});assert.equal(anonRpc.status,403);
  passed('Real route rejects missing/cross-origin403 and wrong content type415; fixture denies browser RPC access');
  const oldCookie=cookie;
  r=await request('/session','DELETE',{});assert.equal(r.status,200);assert.equal(r.data.unlocked,false);assert(/Max-Age=0/i.test(r.headers.get('set-cookie')));
  assert.equal((await request()).status,423);
  r=await request('/session','POST',{password:qa.password});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];
  assert.notEqual(cookie,oldCookie);assert.equal((await request('', 'GET',undefined,{headers:{Cookie:oldCookie}})).status,423);
  assert.equal((await request()).data.entries.length,6);
  passed('Lock revokes old private token; re-unlock issues new token without losing ledger');
  await qa.db.exec(`reset role; update public.test_admins set active=false; set role service_role;`);
  assert.equal((await request()).status,403);
  await qa.db.exec(`reset role; update public.test_admins set active=true; set role service_role;`);
  passed('Fresh admin revocation is enforced despite existing private cookie');
  await qa.db.exec(`reset role; delete from auth.sessions; set role service_role;`);
  assert.equal((await request()).status,423);
  passed('Revoking the underlying Auth session locks financial API immediately');
  const html=await fetch(`${qa.appOrigin}/admin/contabilidad`,{signal:AbortSignal.timeout(120000)});assert.equal(html.status,200);const rendered=await html.text();assert(rendered.includes('Verificando el acceso privado'));
  assert(!rendered.includes(qa.password));assert(!rendered.includes(process.env.ACCOUNTING_PASSWORD_HASH));
  passed('Next accounting page compiles/serves200; server-only secret absent from initial HTML');
  report.rpcCounts=Object.fromEntries([...new Set(qa.calls.map(x=>x.name))].map(name=>[name,qa.calls.filter(x=>x.name===name).length]));
  report.blockedExternalServerRequests=qa.blocked;
}
main().catch(error=>{report.failure=error.stack;console.error(error);process.exitCode=1;}).finally(async()=>{fs.writeFileSync(path.join(outputDir,'report.json'),JSON.stringify(report,null,2));console.log(`QA_REPORT ${path.join(outputDir,'report.json')}`);await qa?.close();process.exit(process.exitCode||0);});
