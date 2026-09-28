const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(relative) {
  const file=path.join(__dirname,'..',relative);
  const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const exports={}; vm.runInNewContext(compiled,{exports}); return exports;
}
const {resolvePanelRank,panelThemeVariables}=load('src/lib/panel-theme.ts');
const {configuredXpProgress}=load('src/lib/xp-levels.ts');

test('uses server tier keys independently of localized labels or numeric level',()=>{
  const progress=configuredXpProgress(200,[
    {level:1,xp_to_next:200,tier_key:'bronze'},
    {level:2,xp_to_next:500,tier_key:'silver'},
    {level:3,xp_to_next:null,tier_key:'gold'},
  ],[{key:'bronze',name:'Inicio'},{key:'silver',name:'Plata personalizada'},{key:'gold',name:'Oro'}]);
  assert.equal(progress.level,2);
  assert.equal(resolvePanelRank(progress.tier.key),'silver');
  assert.equal(panelThemeVariables(progress.tier.key)['--rank-accent'],'#e0e8f4');
});
test('supports actual client and tarotista rank codes without changing their labels',()=>{
  for(const [value,expected] of [['plata','silver'],['oro','gold'],['Élite','elite'],['B','silver'],['S','diamond'],['diamante','diamond']]) assert.equal(resolvePanelRank(value),expected);
});
test('missing, unknown and display labels cannot silently give a gold rank',()=>{
  for(const value of [null,undefined,'','new_custom_tier','Nivel 5 · Plata']) assert.equal(resolvePanelRank(value),'celestial');
});
test('a rank change produces a new palette with no persisted account state',()=>{
  const silver=panelThemeVariables('silver');
  const gold=panelThemeVariables('gold');
  assert.notEqual(silver['--rank-accent'],gold['--rank-accent']);
  assert.equal(panelThemeVariables(null)['--rank-accent'],'#c9c1ee');
});
