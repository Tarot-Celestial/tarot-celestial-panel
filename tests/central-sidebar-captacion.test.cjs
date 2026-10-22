const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript');
const React=require('react'),renderer=require('react-test-renderer'),{act}=renderer;
const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/features/central/CentralSidebar.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
function fixture(hiddenKeys=[]){
  const exports={},navigation=[],listeners=new Map();let preferencesWrites=0;
  vm.runInNewContext(source,{exports,window:{addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key)},require(name){
    if(name==='react'||name==='react/jsx-runtime')return require(name);
    if(name==='lucide-react')return {ChevronDown:'svg'};
    if(name.endsWith('.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
    if(name.includes('NavigationVisibilityMenu'))return {__esModule:true,default:()=>null,useHiddenNavigation:()=>({hiddenKeys,toggleHidden:()=>preferencesWrites++,resetHidden:()=>preferencesWrites++})};
    throw Error(name);
  }});
  let tree;
  const render=(count,activeTab='central',stale=false)=>act(()=>{
    const props={activeTab,onTabChange:tab=>navigation.push(tab),items:[{key:'central',label:'Resumen',icon:'svg'},{key:'captacion',label:'Captación',icon:'svg',badge:count,badgeStale:stale,kicker:count?'Nuevos · atender ahora':undefined},{key:'notificaciones',label:'Notificaciones',icon:'svg',badge:2}]};
    if(tree)tree.update(React.createElement(exports.default,props));else tree=renderer.create(React.createElement(exports.default,props));
  });
  return {render,get tree(){return tree;},navigation,get preferencesWrites(){return preferencesWrites;},button:key=>tree.root.findAllByType('button').find(x=>x.props['data-companion-nav']===key),close:()=>act(()=>tree.unmount())};
}
test('pending acquisition stays red with the exact count in another tab and in its active tab',()=>{
  const f=fixture();try{
    f.render(5);let button=f.button('captacion');assert.match(button.props.className,/captacionUrgent/);assert.equal(button.props['data-captacion-pending'],5);assert.match(button.props['aria-label'],/5 contactos nuevos pendientes/);
    act(()=>button.props.onClick());assert.deepEqual(f.navigation,['captacion']);
    f.render(123,'captacion');button=f.button('captacion');assert.match(button.props.className,/navButtonActive/);assert.match(button.props.className,/captacionUrgent/);assert.equal(button.findAllByType('span').some(x=>x.children.includes('123')),true);
    f.render(0);assert.doesNotMatch(f.button('captacion').props.className,/captacionUrgent/);assert.equal(f.button('captacion').props['data-captacion-pending'],undefined);assert.match(f.button('notificaciones').props.className,/alertButton/);
  }finally{f.close();}
});
test('an urgent entry remains reachable even if hidden, then restores the saved preference without modifying it',()=>{
  const f=fixture(['captacion']);try{
    f.render(0);assert.equal(f.button('captacion'),undefined);
    f.render(3);assert.ok(f.button('captacion'));assert.equal(f.preferencesWrites,0);
    f.render(0);assert.equal(f.button('captacion'),undefined);assert.equal(f.preferencesWrites,0);
  }finally{f.close();}
});
test('a connection failure labels the retained count as stale instead of presenting it as current',()=>{
  const f=fixture();try{
    f.render(4,'central',true);assert.match(f.button('captacion').props['aria-label'],/pendiente de actualizar/);assert.match(f.button('captacion').props.title,/Último recuento confirmado/);
    f.render(4,'central',false);assert.doesNotMatch(f.button('captacion').props['aria-label'],/pendiente de actualizar/);
  }finally{f.close();}
});
