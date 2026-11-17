const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const React=require('react');
const renderer=require('react-test-renderer');
const cache=new Map();
function load(file){
 file=path.resolve(__dirname,'..',file);
 if(cache.has(file))return cache.get(file);
 const out={};cache.set(file,out);
 const source=fs.readFileSync(file,'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const customRequire=(name)=>{
  if(name.endsWith('.module.css'))return new Proxy({},{get:(_,key)=>key==='__esModule'?false:String(key)});
  if(name==='@/lib/supabase-browser')return {supabaseBrowser(){throw new Error('No network access in monthly UI tests');}};
  if(name.startsWith('@/')||name.startsWith('.')){
   const base=name.startsWith('@/')?path.resolve(__dirname,'../src',name.slice(2)):path.resolve(path.dirname(file),name);
   const resolved=['', '.ts','.tsx'].map(ext=>base+ext).find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
   if(!resolved)throw new Error('Missing source '+name);
   return load(resolved);
  }
  return require(name);
 };
 vm.runInNewContext(code,{exports:out,require:customRequire,Date,Math,Intl,Number,Object,String,Error,Map,Set,JSON,Array,Promise,RegExp,URL,Headers,Blob,AbortController,DOMException,atob,crypto:require('node:crypto').webcrypto,console,setTimeout,clearTimeout},{filename:file});
 return out;
}
const model=load('src/features/accounting/monthly-model.ts');
const domain=load('src/lib/accounting.ts');
const id=n=>`50000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const row=(n,kind,amount,date='2026-11-03',extra={})=>({id:id(n),kind,account:'celestial',to_account:null,currency:'EUR',amount_cents:amount,occurred_on:date,category_id:null,method_id:null,description:'Movimiento sintético',reference:'',recipient:null,created_at:`${date}T12:00:00Z`,created_by:id(100),voided_at:null,void_reason:null,voided_by:null,...extra});
const base=[row(1,'opening_balance',10000,'2026-10-01'),row(2,'vault_deposit',2000,'2026-10-02'),row(3,'income',5000),row(4,'expense',1000),row(5,'transfer',3000,'2026-11-04',{to_account:'leonaris'}),row(6,'vault_deposit',1000,'2026-11-05'),row(7,'vault_withdrawal',500,'2026-11-06'),row(8,'vault_payout',400,'2026-11-07',{recipient:'Ricky'})];
const today='2026-11-13';
test('empty snapshot stays empty, no sample money is inserted',()=>{const r=model.monthlySummary([],'2026-11','EUR','all',today);assert.equal(r.available,0);assert.equal(r.vault,0);assert.equal(r.income,0);assert.equal(r.count,0);});
test('month bounds include leap years and reject malformed months',()=>{assert.equal(model.monthBounds('2024-02').to,'2024-02-29');assert.throws(()=>model.monthBounds('2026-13'));assert.throws(()=>model.monthBounds('2026-00'));assert.equal(model.monthBounds(model.shiftMonth('2000-01',-1)).from,'1999-12-01');});
test('opening cash is not revenue; prior vault carries forward',()=>{const r=model.monthlySummary(base,'2026-11','EUR','all',today);assert.equal(r.opening,8000);assert.equal(r.openingVault,2000);assert.equal(r.income,5000);assert.equal(r.expense,1000);assert.equal(r.net,4000);});
test('transfers project into each account and do not inflate combined cash',()=>{const c=model.monthlySummary(base,'2026-11','EUR','celestial',today),l=model.monthlySummary(base,'2026-11','EUR','leonaris',today),all=model.monthlySummary(base,'2026-11','EUR','all',today);assert.equal(c.available,8500);assert.equal(l.available,3000);assert.equal(all.available,11500);assert.equal(c.transferOut,3000);assert.equal(l.transferIn,3000);assert.equal(l.income,0);});
test('vault movements and payout do not become operating income/expense',()=>{const r=model.monthlySummary(base,'2026-11','EUR','all',today);assert.equal(r.vault,2100);assert.equal(r.vaultIn,1000);assert.equal(r.vaultOut,900);assert.equal(r.payouts.Ricky,400);assert.equal(r.net,4000);});
test('historical month ignores later transactions',()=>{const r=model.monthlySummary(base,'2026-10','EUR','all',today);assert.equal(r.available,8000);assert.equal(r.vault,2000);assert.equal(r.income,0);});
test('no movements in next month still carries balances',()=>{const r=model.monthlySummary(base,'2026-12','EUR','all','2026-12-05');assert.equal(r.count,0);assert.equal(r.opening,11500);assert.equal(r.available,11500);assert.equal(r.vault,2100);});
test('future entries, voided rows and other currencies cannot contaminate totals',()=>{const rows=[...base,row(9,'income',99999,'2026-11-14'),row(10,'income',99999,'2026-11-01',{voided_at:'2026-11-02T00:00:00Z'}),row(11,'income',99999,'2026-11-01',{currency:'USD'})];const r=model.monthlySummary(rows,'2026-11','EUR','all',today);assert.equal(r.income,5000);assert.equal(r.available,11500);assert.equal(model.monthlySummary(rows,'2026-11','USD','all',today).income,99999);});
test('local origin/destination/date filters select correct vault movements',()=>{const f={...model.EMPTY_MONTHLY_FILTERS,origin:'celestial:vault',destination:'Ricky',date:'2026-11-07'};const r=model.monthlyRows(base,'2026-11','EUR',f,today);assert.equal(r.length,1);assert.equal(r[0].kind,'vault_payout');assert.equal(model.monthlySummary(base,'2026-11','EUR','all',today).vault,2100);});
test('voided rows are visible only on demand and never sum',()=>{const rows=[row(1,'income',100,'2026-11-01',{voided_at:'2026-11-02T00:00:00Z'})];assert.equal(model.monthlyRows(rows,'2026-11','EUR',model.EMPTY_MONTHLY_FILTERS,today).length,0);const selected=model.monthlyRows(rows,'2026-11','EUR',{...model.EMPTY_MONTHLY_FILTERS,includeVoided:true},today);assert.equal(selected.length,1);assert.equal(model.filteredTotals(selected).income,0);assert.equal(model.filteredTotals(selected).count,0);});
test('vault history includes opening stock and reverses only display order',()=>{const rows=model.vaultHistory(base,'2026-11','EUR','celestial',today);assert.equal(rows.length,3);assert.equal(rows[0].balance,2100);assert.equal(rows[2].balance,3000);});
test('history contains a maximum of twelve real months, empty is empty',()=>{assert.equal(model.historyMonths([],'2026-11','EUR').length,0);const r=model.historyMonths([row(1,'income',1,'2024-01-01')],'2026-11','EUR');assert.equal(r.length,12);assert.equal(r[0],'2025-12');assert.equal(r[11],'2026-11');});
test('zero comparison base never fabricates an infinite percentage',()=>{assert.equal(model.percentageChange(100,0),null);assert.equal(model.percentageChange(0,0),null);assert.equal(model.percentageChange(110,100),10);});
test('unsafe totals fail instead of losing precision',()=>assert.throws(()=>model.safeAdd(Number.MAX_SAFE_INTEGER,1)));
test('source arrays are not mutated by projection, filtering or chart history',()=>{const frozen=Object.freeze(base.map(e=>Object.freeze({...e})));const before=JSON.stringify(frozen);model.monthlySummary(frozen,'2026-11','EUR','all',today);model.monthlyRows(frozen,'2026-11','EUR',model.EMPTY_MONTHLY_FILTERS,today);model.vaultHistory(frozen,'2026-11','EUR','celestial',today);assert.equal(JSON.stringify(frozen),before);});
test('CSV text fields retain formula injection protection',()=>{const {csvCell}=load('src/features/accounting/accounting-client.ts');assert.equal(csvCell('=1+1'),'"\'=1+1"');assert.equal(csvCell('normal'),'"normal"');});
const snapshot={entries:[],categories:[{id:id(50),name:'Consulta',kind:'income',active:true,created_at:''}],methods:[{id:id(51),name:'PayPal',active:true,created_at:''}]};
test('SSR renders the requested sections and exactly two business accounts without real balances',()=>{
 const Workspace=load('src/features/accounting/AccountingWorkspace.tsx').default;
 const html=require('react-dom/server').renderToStaticMarkup(React.createElement(Workspace,{snapshot,updatedAt:'',refreshing:false,locking:false,message:null,error:null,onRefresh:async()=>{},onLock:async()=>{},onSaveEntry:async()=>{},onVoidEntry:async()=>{},onSaveOption:async()=>{}}));
 for(const text of ['Contabilidad mensual','Estadísticas financieras','Nuevo movimiento','Movimientos del mes','Caja extra · Celestial','Caja extra · Leonaris'])assert.ok(html.includes(text),text);
 assert.equal((html.match(/aria-label="Cuenta Tarot /g)||[]).length,2);
 assert.ok(!/7517|7660|7\.517|7\.660/.test(html));assert.ok(!html.includes('Cuenta Flowly'));
});
test('inline save failures preserve the exact request ID for retry; double submit cannot write twice',async()=>{
 const Form=load('src/features/accounting/MonthlyEntryForm.tsx').default;
 let attempts=[],release;
 const onSave=(payload)=>{attempts.push(payload);return new Promise((resolve,reject)=>{release=attempts.length===1?()=>reject(new Error('Respuesta incierta')):resolve;});};
 let tree;await renderer.act(async()=>{tree=renderer.create(React.createElement(Form,{snapshot,currency:'EUR',onSave,onOptions(){}}));});
 const root=tree.root;
 const selects=()=>root.findAllByType('select');
 await renderer.act(async()=>{selects()[2].props.onChange({target:{value:id(51)}});selects()[3].props.onChange({target:{value:id(50)}});root.findAllByType('input').find(i=>i.props.placeholder==='0,00').props.onChange({target:{value:'12,50'}});root.findAllByType('input').find(i=>i.props.minLength===3).props.onChange({target:{value:'Consulta sintética'}});});
 let p;await renderer.act(async()=>{p=root.findByType('form').props.onSubmit({preventDefault(){}});});
 await renderer.act(async()=>{root.findByType('form').props.onSubmit({preventDefault(){}});});
 assert.equal(attempts.length,1);assert.equal(attempts[0].amount_cents,1250);
 await renderer.act(async()=>{release();await p;});
 assert.ok(root.findByType('fieldset').props.disabled);
 await renderer.act(async()=>{p=root.findByType('form').props.onSubmit({preventDefault(){}});});
 assert.equal(attempts.length,2);assert.equal(attempts[0].id,attempts[1].id);
 await renderer.act(async()=>{release();await p;});assert.equal(root.findByType('fieldset').props.disabled,false);tree.unmount();
});
test('a rejected vault withdrawal can be corrected without reloading or retaining the rejected request ID',async()=>{
 const Form=load('src/features/accounting/MonthlyEntryForm.tsx').default;
 const {AccountingRequestError}=load('src/features/accounting/accounting-client.ts');
 const attempts=[];
 const onSave=async payload=>{attempts.push(payload);if(attempts.length===1)throw new AccountingRequestError('Fondos insuficientes',409,'INSUFFICIENT_VAULT');};
 let tree;await renderer.act(async()=>{tree=renderer.create(React.createElement(Form,{snapshot,currency:'EUR',onSave,onOptions(){}}));});
 const root=tree.root;
 const amount=()=>root.findAllByType('input').find(input=>input.props.placeholder==='0,00');
 const concept=()=>root.findAllByType('input').find(input=>input.props.minLength===3);
 await renderer.act(async()=>{root.findAllByType('select')[0].props.onChange({target:{value:'vault_withdrawal'}});amount().props.onChange({target:{value:'100'}});concept().props.onChange({target:{value:'Retirada de bóveda'}});});
 await renderer.act(async()=>{await root.findByType('form').props.onSubmit({preventDefault(){}});});
 assert.equal(root.findByType('fieldset').props.disabled,false);
 assert.equal(amount().props.value,'100');assert.equal(concept().props.value,'Retirada de bóveda');
 assert.match(root.findByProps({role:'alert'}).children.join(''),/Corrige los datos/);
 await renderer.act(async()=>{amount().props.onChange({target:{value:'10'}});});
 await renderer.act(async()=>{await root.findByType('form').props.onSubmit({preventDefault(){}});});
 assert.equal(attempts.length,2);assert.notEqual(attempts[0].id,attempts[1].id);
 assert.equal(attempts[1].amount_cents,1000);assert.equal(attempts[1].kind,'vault_withdrawal');
 assert.equal(amount().props.value,'');assert.ok(root.findByProps({role:'status'}));
 await renderer.act(async()=>{tree.unmount();});
});

test('known server validation rejections unlock fields while uncertain and conflicting saves retain their exact payload',async()=>{
 const Form=load('src/features/accounting/MonthlyEntryForm.tsx').default;
 const {AccountingRequestError}=load('src/features/accounting/accounting-client.ts');
 for(const [status,code,editable] of [[400,'INVALID_INPUT',true],[400,'FUTURE_DATE',true],[409,'OPENING_DATE',true],[409,'OPENING_EXISTS',true],[409,'INSUFFICIENT_AVAILABLE',true],[409,'OPTION_UNAVAILABLE',true],[503,'ACCOUNTING_UNAVAILABLE',false],[504,undefined,false],[409,'OPERATION_CONFLICT',false],[409,'CONFLICT',false],[500,'INVALID_INPUT',false]]){
  const attempts=[];
  const onSave=async payload=>{attempts.push(payload);throw new AccountingRequestError('Rechazo de prueba',status,code);};
  let tree;await renderer.act(async()=>{tree=renderer.create(React.createElement(Form,{snapshot,currency:'EUR',onSave,onOptions(){}}));});
  const root=tree.root;
  await renderer.act(async()=>{const selects=root.findAllByType('select');selects[2].props.onChange({target:{value:id(51)}});selects[3].props.onChange({target:{value:id(50)}});root.findAllByType('input').find(input=>input.props.placeholder==='0,00').props.onChange({target:{value:'12,50'}});root.findAllByType('input').find(input=>input.props.minLength===3).props.onChange({target:{value:'Consulta sintética'}});});
  await renderer.act(async()=>{await root.findByType('form').props.onSubmit({preventDefault(){}});});
  assert.equal(root.findByType('fieldset').props.disabled,!editable,`${status} ${code}`);
  if(!editable){
   await renderer.act(async()=>{await root.findByType('form').props.onSubmit({preventDefault(){}});});
   assert.strictEqual(attempts[1],attempts[0],`${status} ${code}: preserve payload and ID`);
  }
  await renderer.act(async()=>{tree.unmount();});
 }
});
module.exports={load,snapshot};
