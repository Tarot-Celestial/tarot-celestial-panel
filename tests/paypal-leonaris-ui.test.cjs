// Real React pages/modal/CRM with simulated HTTP only. No provider SDK, payment or real customer data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), renderer = require('react-test-renderer');
const { act } = renderer;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node ? text(node.children) : '';
const noop = () => {};
const reply = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
function storage() {
  const data = new Map();
  return { get length() { return data.size; }, key: index => [...data.keys()][index],
    getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
}
function harness(fetch) {
  const h = { events: [], intervals: [], localStorage: storage(), sessionStorage: storage(), imports: {} };
  const window = {
    location: { search: `?ref=${id(90)}`, origin: 'https://fixture.invalid', reload: () => assert.fail('Unexpected navigation') },
    crypto: { randomUUID: () => id(99) }, sessionStorage: h.sessionStorage,
    addEventListener: noop, removeEventListener: noop, dispatchEvent: event => h.events.push(event.type), scrollTo: noop,
    setInterval: fn => { h.intervals.push(fn); return h.intervals.length; }, clearInterval: noop,
    setTimeout: () => 1, clearTimeout: noop,
    open: () => assert.fail('Receipt checks must not open WhatsApp or a payment'),
  };
  const document = { body: {}, visibilityState: 'visible', addEventListener: noop, removeEventListener: noop,
    createElement: () => assert.fail('Receipt checks must not initialize the PayPal SDK') };
  h.load = file => {
    const exports = {};
    vm.runInNewContext(compile(file), { exports, fetch, console, window, document, Date, Intl, URL, URLSearchParams,
      localStorage: h.localStorage, sessionStorage: h.sessionStorage, crypto: window.crypto,
      setTimeout: () => 1, clearTimeout: noop, Event: class { constructor(type) { this.type = type; } },
      CustomEvent: class { constructor(type) { this.type = type; } },
      require: name => {
        if (name in h.imports) return h.imports[name];
        if (name === 'react') return React;
        if (name === 'react/jsx-runtime') return require(name);
        if (name === 'react-dom') return { createPortal: child => child };
        if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
        if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
        if (name === '@/lib/countries') return { getCountryByLabelOrCode: () => ({}), buildInternationalPhone: (_, phone) => phone };
        if (name === '@/lib/purchase-presentation') return h.load('src/lib/purchase-presentation.ts');
        throw Error(`Unexpected import ${name}`);
      },
    });
    return exports;
  };
  return h;
}
async function render(h, file, props) {
  let tree;
  await act(async () => { tree = renderer.create(React.createElement(h.load(file).default, props)); });
  return tree;
}
const button = (tree, label) => tree.root.findAllByType('button').find(node => text(node).trim() === label);
const status = tree => text(tree.root.findByProps({ role: 'status' }));
const centralSession = { amount: 22, currency: 'EUR', description: 'Consulta simulada', status: 'completed', remote_status: 'COMPLETED', can_pay: false, checkout_kind: 'crm_collection' };


for(const account of ['legacy','leonaris'])test('Modal '+account+' loads its own account and keeps packs/manual summary visible',async()=>{
 const requests=[];const packs=[{id:'pack_20',nombre:'20 minutos',amount:22,total_minutes:20,package_level:1},{id:'pack_40',nombre:'40 minutos',amount:29,total_minutes:40,package_level:2},{id:'pack_80',nombre:'80 minutos',amount:49,total_minutes:80,package_level:3}];
 const h=harness(async(url,init)=>{requests.push({url,init});return reply({ok:true,packs,latest:null,history:[],environment:'sandbox',message:'OAuth comprobado'});});
 const tree=await render(h,'src/components/crm/PayPalCrmPaymentModal.tsx',{account,open:true,cliente:{id:id(2),nombre:'Clienta simulada'},getToken:async()=> 'fixture',onClose:noop});
 assert.ok(requests[0].url.endsWith('account='+account));const body=text(tree.toJSON());assert.match(body,/Nivel 1/);assert.match(body,/Nivel 2/);assert.match(body,/Nivel 3/);assert.match(body,/Resumen del cobro/);
 if(account==='leonaris'){assert.match(body,/Cobro Leonaris/);assert.match(body,/leonarisignis@gmail.com/);assert.match(tree.root.findByProps({role:'dialog'}).props.className,/leonaris/);}else assert.match(body,/cuenta habitual/);
 await act(async()=>button(tree,'Importe manual').props.onClick());assert.match(text(tree.toJSON()),/Importe a cobrar/);
 await act(async()=>button(tree,'Comprobar conexión PayPal').props.onClick());assert.equal(JSON.parse(requests.at(-1).init.body).account,account);
 await act(async()=>tree.unmount());
});
test('Customer checkout brand is supplied by the server account and refunded receipts do not claim success',async()=>{
 const h=harness(async()=>reply({...centralSession,paypal_account:'client_business_v1',remote_status:'CAPTURE_REFUNDED'}));
 const tree=await render(h,'src/app/pago-tarjeta/page.tsx');assert.match(text(tree.toJSON()),/TAROT LEONARIS/);assert.match(text(tree.toJSON()),/pago ha sido reembolsado/);assert.doesNotMatch(text(tree.toJSON()),/Pago confirmado|Tus minutos y beneficios ya/);await act(async()=>tree.unmount());
});

test('Choosing a new link preserves the old one until generation and reports automatic replacement',async()=>{const requests=[];const latest={id:id(10),amount:22,currency:'EUR',status:'pending',remote_status:'CREATED',checkout_url:'https://fixture.invalid/old',payment_id:'OLD',pack_id:'pack_20'};const h=harness(async(url,init)=>{requests.push({url,init});if(init?.method==='POST')return reply({ok:true,url:'https://fixture.invalid/new',attempt_id:id(99),amount:22,currency:'EUR',status:'pending',replaced_count:1});return reply({ok:true,packs:[{id:'pack_20',nombre:'20 minutos',amount:22,total_minutes:20,package_level:1}],latest,history:[latest],environment:'sandbox'});});const tree=await render(h,'src/components/crm/PayPalCrmPaymentModal.tsx',{account:'leonaris',open:true,cliente:{id:id(2),nombre:'Prueba'},getToken:async()=> 'fixture',onClose:noop});await act(async()=>button(tree,'Crear otro enlace · Cambiar tarifa').props.onClick());assert.equal(requests.filter(r=>r.init?.method==='POST').length,0);assert.match(text(tree.toJSON()),/se desactiva automáticamente/);await act(async()=>button(tree,'Crear pago con tarjeta y abrir WhatsApp').props.onClick());const posts=requests.filter(r=>r.init?.method==='POST');assert.equal(posts.length,1);assert.equal(JSON.parse(posts[0].init.body).account,'leonaris');assert.notEqual(JSON.parse(posts[0].init.body).request_id,latest.id);assert.match(text(tree.toJSON()),/fixture.invalid\/new/);await act(async()=>tree.unmount());});

test('A blocked creation opens both-account management with passive check and explicit cancellation, then a fresh request can be chosen',async()=>{
 const requests=[];let blocked=true;const old={id:id(10),amount:1,currency:'EUR',status:'pending',remote_status:'CREATING',paypal_account:'legacy',created_at:'2026-10-07T03:26:28Z',pack_name:'Antiguo',cancellation_blocked:false};
 const h=harness(async(url,init)=>{requests.push({url,init});if(url.includes('pending_all=1'))return reply({ok:true,pending:[old]});if(init?.method==='POST'){const body=JSON.parse(init.body);if(body.action==='inspect')return reply({ok:true,attempt:old});if(body.action==='cancel'){blocked=false;return reply({ok:true,attempt:{...old,status:'cancelled',remote_status:'CANCELLED_BY_STAFF'}});}if(blocked)return {ok:false,status:409,json:async()=>({ok:false,error:'El intento anterior necesita revisión'})};return reply({ok:true,url:'https://fixture.invalid/new',attempt_id:id(99),amount:22,currency:'EUR',status:'pending'});}return reply({ok:true,packs:[{id:'pack_20',nombre:'20 minutos',amount:22,total_minutes:20,package_level:1}],latest:null,history:[],environment:'sandbox'});});
 const tree=await render(h,'src/components/crm/PayPalCrmPaymentModal.tsx',{account:'leonaris',open:true,cliente:{id:id(2),nombre:'Simulada'},getToken:async()=> 'fixture',onClose:noop});
 assert.ok(button(tree,'Gestionar enlaces anteriores'));await act(async()=>button(tree,'Importe manual').props.onClick());await act(async()=>tree.root.findByProps({inputMode:'decimal'}).props.onChange({target:{value:'20'}}));await act(async()=>button(tree,'Crear pago con tarjeta y abrir WhatsApp').props.onClick());assert.match(text(tree.toJSON()),/Cuenta habitual/);assert.match(text(tree.toJSON()),/Creación incompleta/);assert.ok(button(tree,'Cancelar y preparar otro enlace'));
 await act(async()=>button(tree,'Comprobar estado').props.onClick());assert.deepEqual(JSON.parse(requests.at(-1).init.body),{action:'inspect',attempt_id:id(10),account:'legacy'});
 await act(async()=>button(tree,'Cancelar y preparar otro enlace').props.onClick());assert.deepEqual(JSON.parse(requests.at(-1).init.body),{action:'cancel',attempt_id:id(10),account:'legacy'});assert.match(text(tree.toJSON()),/Enlace anterior cancelado/);assert.equal(tree.root.findByProps({inputMode:'decimal'}).props.value,'20');assert.equal(requests.filter(r=>r.init?.method==='POST'&&!JSON.parse(r.init.body).action).length,1);
 await act(async()=>button(tree,'Elegir importe para nuevo enlace').props.onClick());await act(async()=>button(tree,'Crear pago con tarjeta y abrir WhatsApp').props.onClick());assert.match(text(tree.toJSON()),/fixture.invalid\/new/);await act(async()=>tree.unmount());
});
test('Pending manager keeps in-flight payments non-cancellable and offers an explicit return to the form',async()=>{const h=harness(async url=>url.includes('pending_all=1')?reply({ok:true,pending:[{id:id(10),amount:20,status:'pending',remote_status:'CAPTURE_PENDING',cancellation_blocked:true,created_at:'2026-10-07T03:00:00Z',paypal_account:'legacy'}]}):reply({ok:true,packs:[],history:[],environment:'sandbox'}));const tree=await render(h,'src/components/crm/PayPalCrmPaymentModal.tsx',{open:true,cliente:{id:id(2)},getToken:async()=> 'fixture',onClose:noop});await act(async()=>button(tree,'Gestionar enlaces anteriores').props.onClick());assert.equal(button(tree,'Cancelar y preparar otro enlace').props.disabled,true);assert.ok(button(tree,'Comprobar estado'));assert.ok(button(tree,'Elegir importe para nuevo enlace'));await act(async()=>tree.unmount());});

test('An expired incomplete attempt is not reused when opening the form',async()=>{const requests=[];const old={id:id(10),amount:22,currency:'EUR',status:'pending',remote_status:'CREATING',created_at:new Date(Date.now()-6*60*60*1000).toISOString(),pack_id:'pack_20'};const h=harness(async(url,init)=>{requests.push({url,init});if(init?.method==='POST')return reply({ok:true,url:'https://fixture.invalid/new',attempt_id:id(99),amount:22,currency:'EUR',status:'pending'});return reply({ok:true,packs:[{id:'pack_20',nombre:'20 minutos',amount:22,total_minutes:20,package_level:1}],latest:old,history:[old],environment:'sandbox'});});const tree=await render(h,'src/components/crm/PayPalCrmPaymentModal.tsx',{open:true,cliente:{id:id(2)},getToken:async()=> 'fixture',onClose:noop});await act(async()=>button(tree,'Crear pago con tarjeta y abrir WhatsApp').props.onClick());assert.notEqual(JSON.parse(requests.find(r=>r.init?.method==='POST').init.body).request_id,old.id);await act(async()=>tree.unmount());});
