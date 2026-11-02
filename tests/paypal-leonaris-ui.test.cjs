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
