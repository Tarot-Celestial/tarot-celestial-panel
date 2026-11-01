const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript');
const React=require('react'),renderer=require('react-test-renderer'),{act}=renderer;
const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/features/central/CentralSidebar.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
function fixture(hiddenKeys=[],extraItems=[]){
  const exports={},navigation=[],listeners=new Map();let preferencesWrites=0;
  let unreadTotal=0;
  vm.runInNewContext(source,{exports,window:{addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key)},require(name){
    if(name==='react'||name==='react/jsx-runtime')return require(name);
    if(name==='lucide-react')return {ChevronDown:'svg'};
    if(name==='@/providers/StaffChatProvider')return {useStaffChat:()=>({unreadTotal})};
    if(name.endsWith('.css'))return {__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
    if(name.includes('NavigationVisibilityMenu'))return {__esModule:true,default:()=>null,useHiddenNavigation:()=>({hiddenKeys,toggleHidden:()=>preferencesWrites++,resetHidden:()=>preferencesWrites++})};
    throw Error(name);
  }});
  let tree;
  const render=(count,activeTab='central',stale=false,whatsapp=0,instagram=0,facebook=0)=>act(()=>{
    const props={activeTab,onTabChange:tab=>navigation.push(tab),items:[{key:'central',label:'Resumen',icon:'svg'},{key:'captacion',label:'Captación',icon:'svg',badge:count,badgeStale:stale,kicker:count?'Nuevos · atender ahora':undefined},{key:'whatsapp',label:'WhatsApp',icon:'svg',badge:whatsapp,badgeStale:stale},{key:'instagram',label:'Instagram',icon:'svg',badge:instagram,badgeStale:stale},{key:'facebook',label:'Facebook',icon:'svg',badge:facebook,badgeStale:stale},{key:'notificaciones',label:'Notificaciones',icon:'svg',badge:2},...extraItems]};
    if(tree)tree.update(React.createElement(exports.default,props));else tree=renderer.create(React.createElement(exports.default,props));
  });
  return {render,setUnreadTotal:count=>unreadTotal=count,get tree(){return tree;},navigation,get preferencesWrites(){return preferencesWrites;},button:key=>tree.root.findAllByType('button').find(x=>x.props['data-companion-nav']===key),close:()=>act(()=>tree.unmount())};
}

test('navigation keeps distinct icon colours and named sections without legacy chip styling',()=>{
  const f=fixture();try{
    f.render(0);
    const nav=f.tree.root.findByType('nav');
    assert.equal(nav.props['aria-label'],'Navegación de Central');
    const sections=nav.findAllByType('section');
    assert.deepEqual(sections.map(section=>section.findByType('h2').children.join('')),['MI TURNO','CLIENTAS Y SEGUIMIENTO']);
    for(const section of sections)assert.equal(section.props['aria-labelledby'],section.findByType('h2').props.id);
    const colours=['central','captacion','whatsapp','instagram','facebook'].map(key=>{
      const button=f.button(key),icon=button.findByType('svg');
      assert.equal(icon.props.size,21);
      assert.equal(icon.parent.props['aria-hidden'],'true');
      assert.doesNotMatch(icon.parent.props.className,/tc-chip/);
      assert.doesNotMatch(button.props.className,/tc-sidebtn/);
      assert.doesNotMatch(button.props.style['--nav-rgb'],/var\(/);
      return button.props.style['--nav-rgb'];
    });
    assert.equal(new Set(colours).size,colours.length);
  }finally{f.close();}
});

test('team submenu exposes its expanded state, selects children and uses current shared unread totals',()=>{
  const f=fixture([],[{key:'equipo',label:'Equipo',icon:'svg',children:[{key:'chat',label:'Chat',kicker:'Conversaciones del equipo'}]}]);
  try{
    f.setUnreadTotal(7);f.render(0);
    const toggle=()=>f.tree.root.findAllByType('button').find(button=>button.props['aria-controls']);
    const submenu=()=>f.tree.root.findByProps({id:toggle().props['aria-controls']});
    assert.equal(toggle().props['aria-expanded'],false);
    assert.equal(submenu().props.hidden,true);
    assert.match(f.button('equipo').props['aria-label'],/7 mensajes del equipo sin leer/);
    assert.equal(f.button('chat').findByType('em').children.join(''),'7');
    act(()=>toggle().props.onClick());
    assert.equal(toggle().props['aria-expanded'],true);assert.equal(submenu().props.hidden,false);
    act(()=>f.button('chat').props.onClick());assert.deepEqual(f.navigation,['chat']);
    f.render(0,'chat');assert.equal(f.button('chat').props['aria-current'],'page');assert.equal(f.button('equipo').props['aria-current'],undefined);
    f.setUnreadTotal(0);f.render(0,'chat');
    assert.equal(f.button('chat').findAllByType('em').length,0);assert.doesNotMatch(f.button('equipo').props.className,/captacionUrgent/);
    act(()=>toggle().props.onClick());assert.equal(toggle().props['aria-expanded'],false);assert.equal(submenu().props.hidden,true);
  }finally{f.close();}
});
test('pending acquisition stays red with the exact count in another tab and in its active tab',()=>{
  const f=fixture();try{
    f.render(5);let button=f.button('captacion');assert.match(button.props.className,/captacionUrgent/);assert.equal(button.props['data-captacion-pending'],5);assert.match(button.props['aria-label'],/5 contactos nuevos pendientes/);
    act(()=>button.props.onClick());assert.deepEqual(f.navigation,['captacion']);
    f.render(123,'captacion');button=f.button('captacion');assert.match(button.props.className,/navButtonActive/);assert.match(button.props.className,/captacionUrgent/);assert.equal(button.findAllByType('span').some(x=>x.children.includes('123')),true);
    f.render(0);assert.doesNotMatch(f.button('captacion').props.className,/captacionUrgent/);assert.equal(f.button('captacion').props['data-captacion-pending'],undefined);assert.match(f.button('notificaciones').props.className,/alertButton/);
  }finally{f.close();}
});
test('WhatsApp shows the exact unread message count independently of Captacion, keeps hidden urgent access and clears after reading',()=>{
  const f=fixture(['whatsapp']);try{
    f.render(5);assert.equal(f.button('whatsapp'),undefined);
    f.render(5,'central',false,124);let button=f.button('whatsapp');assert.match(button.props.className,/captacionUrgent/);assert.equal(button.props['data-whatsapp-unread'],124);assert.match(button.props['aria-label'],/124 mensajes sin leer/);assert.equal(button.findAllByType('span').some(x=>x.children.includes('124')),true);assert.equal(f.button('captacion').props['data-captacion-pending'],5);
    act(()=>button.props.onClick());assert.deepEqual(f.navigation,['whatsapp']);
    f.render(5,'whatsapp',true,124);button=f.button('whatsapp');assert.match(button.props.className,/navButtonActive/);assert.match(button.props['aria-label'],/pendiente de actualizar/);assert.match(button.props.title,/Último recuento confirmado/);
    f.render(5,'whatsapp',false,0);assert.equal(f.button('whatsapp'),undefined);assert.equal(f.preferencesWrites,0);assert.equal(f.button('captacion').props['data-captacion-pending'],5);
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

test('Instagram and Facebook are separate, ordered entries with independent red pending totals',()=>{
  const f=fixture(['instagram','facebook']);try{
    f.render(5,'central',false,2,7,11);
    for(const [key,count] of [['instagram',7],['facebook',11]]){
      const button=f.button(key);assert.equal(button.props['data-social-unread'],count);assert.match(button.props.className,/captacionUrgent/);
      assert.match(button.props['aria-label'],new RegExp(`${count} mensajes y comentarios pendientes de revisar`));
    }
    const keys=f.tree.root.findAllByType('button').map(button=>button.props['data-companion-nav']).filter(Boolean);
    assert.equal(keys.indexOf('facebook'),keys.indexOf('instagram')+1);
    act(()=>f.button('facebook').props.onClick());assert.deepEqual(f.navigation,['facebook']);
    f.render(5,'facebook',true,2,7,11);assert.match(f.button('facebook').props.title,/Último recuento confirmado/);
    f.render(5,'central',false,2,7,0);assert.equal(f.button('facebook'),undefined);assert.equal(f.button('instagram').props['data-social-unread'],7);assert.equal(f.preferencesWrites,0);
  }finally{f.close();}
});
