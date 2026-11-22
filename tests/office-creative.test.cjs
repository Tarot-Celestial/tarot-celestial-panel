const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const task = { id: 'task', revision: 1, objective: 'Tres preguntas para tu consulta', expected_delivery: 'Texto e imagen para Instagram', time_zone: 'Europe/Madrid' };
const creative = { headline: 'Tres preguntas para tu consulta', lines: ['¿Qué puedo observar?', '¿Qué necesito hoy?', '¿Qué paso puedo dar?'],
  caption: 'Tómate un momento para escuchar lo que necesitas. Guarda estas preguntas para tu próxima consulta.', alt: 'Sobre un cielo violeta hay tres preguntas y el logo de Tarot Celestial.' };
function fixture(config = {}) {
  const calls = [], cache = new Map();
  const tables = { central_assistant_knowledge: [], office_promotion_scopes: [], tc_client_promotions: [], tc_client_promotion_packages: [], ...config.tables };
  const db = {
    async rpc(name, args) {
      assert.equal(name, 'office_promotion_scope_live');
      return { data: config.scopeLive?.(args) ?? true, error: null };
    },
    from(table) {
      assert(Object.hasOwn(tables,table), 'Unexpected source ' + table);
      let rows = [...tables[table]], single = false;
      return { select() { return this; }, eq(key,val) { rows=rows.filter(row=>row[key]===val);return this; },
        not(key,op,val) { rows=rows.filter(row=>row[key]!==val);return this; },
        in(key,arr) { rows=rows.filter(row=>arr.includes(row[key]));return this; },
        order(key,{ascending}) { rows.sort((a,b)=>(a[key]>b[key]?1:a[key]<b[key]?-1:0)*(ascending?1:-1));return this; },
        limit(n) { rows=rows.slice(0,n);return this; }, maybeSingle() {single=true;return this;},
        then(resolve) { resolve({data:single ? rows[0]??null : rows,error:null}); } };
    },
  };
  async function fetch(url, init) {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const req = JSON.parse(init.body); calls.push(req);
    if (config.failure) throw new Error('connection reset');
    if (config.status) return new Response(JSON.stringify({error:{code:config.code}}),{status:config.status});
    const value = req.text.format.name === 'office_brief' ? {brief:'Pide tres preguntas para acompañar una consulta.'} : config.copy || creative;
    return Response.json({ id:'resp-fixture', status:'completed', usage:{input_tokens:250,output_tokens:75},
      output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}] });
  }
  function load(file) {
    const full=path.resolve(__dirname,'..',file.endsWith('.ts') ? file : file+'.ts');
    if(cache.has(full))return cache.get(full);
    const exports={};cache.set(full,exports);
    const code=ts.transpileModule(fs.readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
    vm.runInNewContext(code,{exports,fetch,Response,AbortSignal,Buffer,Date,Intl,process:{cwd:()=>path.join(__dirname,'..'),env:{OPENAI_API_KEY:config.key===false?'':'test-local',OFFICE_TEXT_MODEL:config.model||'unknown'}},require(name){
      if(name==='server-only')return {};
      if(name.startsWith('@/'))return load('src/'+name.slice(2));
      if(name.startsWith('.'))return load(path.join(path.dirname(full),name));
      return require(name);
    }});
    return exports;
  }
  const provider=load('src/lib/server/office-creative');
  const step=(i,details=task,brief,revision)=>provider.officeCreativeStep({db,run:{step:i,task_revision:details.revision,outputs:{'0':brief},source_snapshot:brief?.source_snapshot},task:details,revision});
  return {step,calls,tables,db,validate:provider.validateOfficeSources};
}
const expected = status => error => error.status === status;

test('Atlas and Marketing call the configured server provider once per step with only the latest approved Office sources', async()=>{
  const f=fixture({tables:{central_assistant_knowledge:[
    {id:'old',topic:'Oficina Celestial · Marketing',version:1,approved_by:'a',content:'Anterior'},
    {id:'new',topic:'Oficina Celestial · Marketing',version:2,approved_by:'a',content:'Usa nuestra voz de marca.'},
    {id:'pending',topic:'Oficina Celestial · Marketing',version:3,approved_by:null,content:'Pendiente'},
    {id:'private',topic:'Procedimiento privado de Central',version:1,approved_by:'a',content:'Fuera de ámbito'},
  ]}});
  const atlas=await f.step(0);
  assert.equal(atlas.output.source_snapshot.promotion_id,null);
  assert.ok(atlas.output.sources.some(s=>s.id==='new' && s.version==='2'));
  assert.equal(f.calls[0].model,'gpt-5.4-mini');
  assert.ok(!/Pendiente|Anterior|Fuera de ámbito/.test(f.calls[0].input));
  const rev={review_note:'Haz el cierre más cálido.',body:'Texto de la primera versión.'};
  const result=await f.step(1,task,atlas.output,rev);
  assert.equal(result.output.questions.length,3);assert.equal(result.usage.input_tokens,250);
  assert.ok(result.usage.estimated_cost_usd>0 && result.usage.estimated_cost_usd<.1);
  assert.equal(result.usage.response_id,'resp-fixture');
  assert.match(f.calls[1].input,/cierre más cálido/);
  assert.equal(f.calls[1].store,false);assert.equal(f.calls.length,2);
  f.tables.central_assistant_knowledge.push({id:'changed',topic:'Oficina Celestial · Marketing',version:4,approved_by:'a',content:'Nueva regla'});
  await assert.rejects(f.validate(f.db,task,atlas.output),expected('waiting_input'));
});

test('missing currency, missing market, expired approval and distinct currencies are handled before provider costs',async()=>{
  let enabled=true;
  const promo={...task,objective:'Oferta para España en EUR',expected_delivery:'Cartel de Instagram'};
  const f=fixture({scopeLive:()=>enabled,copy:{...creative,headline:'Un espacio para escucharte'},tables:{
    office_promotion_scopes:[{promotion_id:'p',market:'españa',currency:'EUR',channel:'instagram',enabled:true,source_fingerprint:'v1'}],
    tc_client_promotions:[{id:'p',name:'Luna',status:'active',active_until_disabled:true,updated_at:'2026-11-01'}],
    tc_client_promotion_packages:[{id:'pack',promotion_id:'p',currency:'EUR',price:18,paid_minutes:20,free_minutes:7,is_active:true,name:'Plata',updated_at:'2026-11-01'},
      {id:'usd',promotion_id:'p',currency:'USD',price:40,paid_minutes:20,free_minutes:1,is_active:true,name:'Plata'}],
  }});
  for(const objective of ['Oferta España','Oferta en EUR','Oferta España USD','Oferta España EUR y USD']){
    await assert.rejects(f.step(0,{...promo,objective}),expected('waiting_input'));
  }
  assert.equal(f.calls.length,0);
  const atlas=await f.step(0,promo);
  assert.equal(atlas.output.source_snapshot.offer.package_id,'pack');
  const copy=await f.step(1,promo,atlas.output);
  assert.match(copy.output.caption,/18 EUR · 20 min \+ 7 min de regalo/);assert.equal(copy.output.lines.length,2);
  assert.doesNotMatch(copy.output.caption,/USD/);
  enabled=false;
  await assert.rejects(f.validate(f.db,promo,atlas.output),expected('waiting_input'));
  await assert.rejects(f.step(0,promo),expected('waiting_input'));
  enabled=true;f.tables.office_promotion_scopes[0].source_fingerprint='v2';
  await assert.rejects(f.validate(f.db,promo,atlas.output),expected('waiting_input'));
});

test('no fabricated content or retries on missing key, quota exhaustion, transport uncertainty or the request-size limit',async()=>{
  const missing=fixture({key:false});await assert.rejects(missing.step(0),expected('waiting_connection'));assert.equal(missing.calls.length,0);
  const quota=fixture({status:429,code:'insufficient_quota'});await assert.rejects(quota.step(0),e=>e.status==='waiting_connection'&&/saldo/.test(e.message));assert.equal(quota.calls.length,1);
  const ambiguous=fixture({failure:true});await assert.rejects(ambiguous.step(0),expected('needs_reconciliation'));assert.equal(ambiguous.calls.length,1);
  const tooLong=fixture();await assert.rejects(tooLong.step(0,{...task,objective:'ñ'.repeat(30000)}),expected('limit_reached'));assert.equal(tooLong.calls.length,0);
  const wrongCopy=fixture({copy:{...creative,lines:['¿Qué necesitas?']}});const atlas=await wrongCopy.step(0);
  await assert.rejects(wrongCopy.step(1,task,atlas.output),e=>e.status==='failed'&&e.usage?.response_id==='resp-fixture');
});
