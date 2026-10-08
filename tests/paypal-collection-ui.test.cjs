const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),vm=require('vm'),ts=require('typescript');
const React=require('react'),renderer=require('react-test-renderer');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('Real call modal exposes two choices and never fetches confirmed payment candidates',async()=>{
 const requests=[],exports={};
 const code=ts.transpileModule(read('src/components/crm/RegistrarLlamadaModal.tsx'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,document:{body:{}},crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000099'},
  fetch:async url=>{requests.push(url);return {ok:true,json:async()=>({ok:true,balance:{minutos_free_pendientes:0,minutos_normales_pendientes:0},capture_xp:null})};},
  require:n=>n==='react'?React:n==='react-dom'?{createPortal:content=>content}:n==='react/jsx-runtime'?require(n):
    n.endsWith('.css')?{default:new Proxy({},{get:(_,key)=>key})}:
    n==='@/lib/activity-codes'?{CALL_CODE_OPTIONS:[{value:'FREE',label:'Free'}]}:
    n==='@/lib/tc-toast'?{tcToast:()=>{}}:(()=>{throw Error(n)})()});
 let tree;
 await renderer.act(async()=>{tree=renderer.create(React.createElement(exports.default,{open:true,cliente:{id:'00000000-0000-4000-8000-000000000002',nombre:'Prueba'},tarotistas:[],getToken:async()=>'test',onClose:()=>{}}));});
 const text=node=>typeof node==='string'?node:node.children?.map(text).join('')||'';
 const buttons=tree.root.findAllByType('button').map(text);
 assert.deepEqual(buttons,['Cerrar','Registrar una compra nueva','Usar saldo pendiente · sin nueva compra','Siguiente']);
 assert.equal(requests.some(url=>url.includes('mode=payments')),false);
 assert.equal(JSON.stringify(tree.toJSON()).includes('Pago PayPal ya confirmado'),false);
 await renderer.act(async()=>tree.unmount());
});
