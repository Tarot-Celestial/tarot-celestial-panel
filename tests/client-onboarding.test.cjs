const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
const {act,create}=require('react-test-renderer');
const exportsObject={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/components/cliente/OnboardingModal.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:exportsObject,require:name=>name.endsWith('.module.css')?new Proxy({},{get:(_,key)=>String(key)}):require(name)});
function mount(){
 const saved=[];let props={open:true,cliente:{id:'client-a',nombre:'Ana',apellido:'Test',email:'ana@example.test',fecha_nacimiento:null},saving:false,onSave:async payload=>{saved.push(payload)}};
 let view;act(()=>{view=create(React.createElement(exportsObject.default,props))});
 const text=node=>typeof node==='string'?node:(node?.children||[]).map(text).join('');
 return {saved,get root(){return view.root},expectStep(n){assert.equal(view.root.findAll(x=>x.props['aria-label']===`Paso ${n} de 3`).length,1)},click(label){act(()=>view.root.findAllByType('button').find(b=>text(b).includes(label)).props.onClick())},change(index,value){act(()=>view.root.findAllByType('input')[index].props.onChange({target:{value}}))},update(next){props={...props,...next};act(()=>view.update(React.createElement(exportsObject.default,props)))},refresh(extra={}){this.update({cliente:{...props.cliente,...extra}})},close(){act(()=>view.unmount())}};
}
test('wallet refreshes do not reset welcome steps or edited profile fields',async()=>{
 const h=mount();h.click('Editar');h.change(0,'Ana editada');h.refresh({puntos:50});assert.equal(h.root.findAllByType('input')[0].props.value,'Ana editada');h.click('Guardar y seguir');h.expectStep(2);
 for(let i=0;i<4;i++)h.refresh({puntos:i});h.expectStep(2);h.click('Editar');h.change(0,'nuevo@example.test');h.refresh();h.click('Guardar y seguir');h.expectStep(3);h.change(0,'1990-05-20');h.refresh({minutos_free_pendientes:10});h.expectStep(3);assert.equal(h.root.findByType('input').props.value,'1990-05-20');
 await act(async()=>{h.click('Completar mi perfil');await Promise.resolve()});assert.equal(h.saved.length,1);assert.equal(h.saved[0].nombre,'Ana editada');assert.equal(h.saved[0].email,'nuevo@example.test');assert.equal(h.saved[0].fecha_nacimiento,'1990-05-20');assert.equal(h.saved[0].onboarding_completado,true);h.close();
});
test('opening again or switching clients initializes the correct profile',()=>{const h=mount();h.click('Sí, continuar');h.update({open:false});h.refresh({nombre:'Actualizada'});h.update({open:true});h.expectStep(1);h.click('Sí, continuar');h.update({cliente:{id:'client-b',nombre:'Bea',email:'bea@example.test'}});h.expectStep(1);h.click('Editar');assert.equal(h.root.findAllByType('input')[0].props.value,'Bea');h.close()});
test('a profile arriving after opening initializes once and preserves progress',()=>{const h=mount();h.update({cliente:null});h.update({cliente:{id:'client-c',nombre:'Celia'}});h.expectStep(1);h.click('Sí, continuar');h.refresh();h.expectStep(2);h.close()});
test('save failure keeps the final step and values available for retry',async()=>{const h=mount();h.update({onSave:async()=>{throw Error('offline')}});h.click('Sí, continuar');h.click('Sí, continuar');h.change(0,'1995-01-01');await act(async()=>{h.click('Completar mi perfil');await Promise.resolve()});h.refresh();h.expectStep(3);assert.equal(h.root.findByType('input').props.value,'1995-01-01');assert.equal(h.root.findAll(x=>x.props.role==='alert').length,1);h.close()});
