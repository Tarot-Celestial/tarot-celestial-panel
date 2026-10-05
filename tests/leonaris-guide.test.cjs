const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const exportsGuide={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/leo-guide.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:exportsGuide});
const g=exportsGuide;
const summary={level_1_spins:0,level_2_spins:2,level_3_spins:0,level_4_spins:1,level_5_spins:3,diamond_access:false,next_spin_2:'two',next_spin_4:'special',next_spin_5:'diamond',catalogue:[{nivel:2},{nivel:4},{nivel:5}]};
test('each roulette keeps its own spins; blocked Diamond never becomes playable',()=>{
 const rows=g.leoSpins(summary);assert.equal(rows.length,5);assert.equal(rows[1].amount,2);assert.equal(rows[1].playable,true);assert.equal(rows[3].amount,1);assert.equal(rows[4].amount,3);assert.equal(rows[4].playable,false);
 assert.equal(rows[1].action.path,'/cliente/ruleta?nivel=2');assert.equal(rows[1].action.anchor,'roulette-2');
 for(const row of rows)assert.ok(g.validLeoAction(row.action));
});
test('a missing catalogue or pending spin id cannot be advertised as playable',()=>{
 assert.equal(g.leoSpins({...summary,catalogue:[]})[1].playable,false);
 assert.equal(g.leoSpins({...summary,next_spin_2:null})[1].playable,false);
 assert.equal(g.leoSpins({...summary,diamond_access:true})[4].playable,true);
});
test('unavailable data is not presented as a confirmed zero balance',()=>{
 const empty=g.emptyLeoSnapshot();assert.match(g.leoHelp(empty,'/cliente/ruleta','roulette').message,/no puedo confirmar/);
 assert.match(g.leoHelp(empty,'/cliente/dashboard','balance').message,/No he podido confirmar/);
 assert.match(g.leoHelp(empty,'/cliente/rangos','rank').message,/no puedo confirmar/);
 assert.match(g.leoHelp(empty,'/cliente/rangos','daily').message,/No he podido confirmar/);
 assert.doesNotMatch(g.leoHelp(empty,'/cliente/oraculo','oracle').message,/0 tiradas/);
});
test('rank guidance uses current thresholds, rolling spend and explains manual overrides',()=>{
 const state=g.emptyLeoSnapshot();state.ranks={window_days:30,state:{effective:'diamante',total:86,has_override:true},ranks:[['bronce',.01],['plata',100],['oro',500],['diamante',1000]].map(([key,min_spend])=>({key,label:key,min_spend,benefits:[]}))};
 const help=g.leoHelp(state,'/cliente/rangos','context');assert.match(help.message,/14,00/);assert.match(help.message,/30 días/);assert.match(help.message,/asignación especial/);assert.equal(help.actions[1].anchor,'rank-plata');
});
test('daily bonus guidance distinguishes an already claimed reward',()=>{
 const state=g.emptyLeoSnapshot();state.bonuses=[{id:'x',name:'Bono',claimed_today:true}];assert.match(g.leoHelp(state,'/cliente/rangos','daily').title,/ya está utilizado/);
 state.bonuses[0].claimed_today=false;assert.match(g.leoHelp(state,'/cliente/rangos','daily').title,/disponible/);
});
test('all sections have contextual guidance and only internal safe journeys are accepted',()=>{
 for(const section of g.LEO_SECTIONS){assert.equal(g.leoSection(section.path).key,section.key);const help=g.leoHelp(g.emptyLeoSnapshot(),section.path,'context');assert.ok(help.message);for(const action of help.actions)assert.ok(g.validLeoAction(action),action.id);}
 for(const invalid of ['https://other.test','//other.test','javascript:alert(1)','/cliente/logout','/cliente/ruleta\\evil','/api/admin'])assert.equal(g.safeLeoPath(invalid),false);
 assert.equal(g.validLeoAction({path:'/cliente/ruleta',anchor:'body',label:'x',explanation:'x'}),false);
});
test('questions resolve common Spanish help intents, with honest fallback for unrelated questions',()=>{
 for(const [question,intent] of [['¿Qué giro tengo?','roulette'],['¿Dónde está mi premio?','prizes'],['¿Cómo subo de rango?','rank'],['Mis minutos','balance'],['Quiero ver tarotistas','/cliente/tarotistas'],['¿Tengo bono diario?','daily'],['¿Qué tiempo hará mañana?','unknown']])assert.equal(g.leoQuestion(question),intent);
});
test('ritual navigation requires explicit access, not any mention of post-ritual follow-up',()=>{
 const state=g.emptyLeoSnapshot();state.ranks={state:{effective:'plata'},ranks:[{key:'plata',benefits:['Seguimiento energético post rituales']}]};
 assert.ok(!g.leoHelp(state,'/cliente/dashboard','sections').actions.some(a=>a.id==='ritual'));
 state.ranks.ranks[0].benefits=['Acceso a Mi ritual'];assert.ok(g.leoHelp(state,'/cliente/dashboard','sections').actions.some(a=>a.id==='ritual'));
});
test('an uncertain previous spin takes priority and recovery keeps its exact level',()=>{
 const state=g.emptyLeoSnapshot();state.roulette=summary;state.pending={level:2};const help=g.leoHelp(state,'/cliente/ruleta','roulette');assert.match(help.message,/sin gastar otro giro/);assert.equal(help.actions.length,1);assert.equal(help.actions[0].anchor,'recovery');assert.equal(help.actions[0].level,2);assert.ok(g.validLeoAction(help.actions[0]));
});
test('no prize history or active rewards produces an explicit empty state instead of missing-target links',()=>{
 const state=g.emptyLeoSnapshot();state.roulette={...summary,history:[],entitlements:[]};const help=g.leoHelp(state,'/cliente/ruleta','prizes');assert.match(help.message,/Todavía no aparecen/);assert.ok(!help.actions.some(a=>a.anchor==='history'||a.anchor==='prizes'));
});
