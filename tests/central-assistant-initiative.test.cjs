const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const exportsHook={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/features/central/assistant/useCompanionInitiative.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsHook,require:n=>n==='react'?require('react'):{ASSISTANT_SECTIONS:{central:{help:'Revisemos pendientes.'}}}});
test('contextual initiative proposes help without fabricating completed work',()=>{
 assert.match(exportsHook.invitation('mis-clientas','sol',0,true),/¿Buscamos/);
 assert.match(exportsHook.invitation('incidencias','draco',0,true),/comprueba/);
 assert.match(exportsHook.invitation('unknown','draco',0,false),/Estoy aquí/);
});
test('rotation varies invitations and respects humor opt out',()=>{
 const all=Array.from({length:4},(_,i)=>exportsHook.invitation('central','draco',i,true));assert.equal(new Set(all).size,4);
 for(let i=0;i<12;i++)assert.doesNotMatch(exportsHook.invitation('central','draco',i,false),/café|alas/);
 assert.ok(exportsHook.INITIATIVE_INTERVAL>=120000);
});
