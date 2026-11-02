const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
function load(file, overrides = {}, globals = {}) {
  const filename=path.resolve(__dirname,'..',file), exports={};
  const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{exports,console,Date,Request,Response,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture'}},...globals,require(name){
    if(name in overrides)return overrides[name];
    if(name==='next/server')return {NextResponse:Response};
    if(name.startsWith('@/'))return load('src/'+name.slice(2)+'.ts',overrides,globals);
    if(name.startsWith('.'))return load(path.relative(path.resolve(__dirname,'..'),path.resolve(path.dirname(filename),name+'.ts')),overrides,globals);
    return require(name);
  }});return exports;
}
const ids={worker:'10000000-0000-4000-8000-000000000001',client:'10000000-0000-4000-8000-000000000002',reader:'10000000-0000-4000-8000-000000000003',operation:'10000000-0000-4000-8000-000000000004'};
const now=Date.parse('2026-11-02T17:00:00Z');
function fixture(options={}) {
  let clock=now,writes=0;
  class Clock extends Date { constructor(value){super(arguments.length?value:clock)}static now(){return clock} }
  const rows={workers:[{id:ids.worker,user_id:'auth',role:options.role||'admin',is_active:true},{id:ids.reader,role:'tarotista',display_name:'Tarotista fixture',is_active:options.readerActive!==false}],crm_clientes:[{id:ids.client,nombre:'Cliente fixture',telefono_normalizado:'34900000000'}],reservas:[]};
  const db={auth:{getUser:async()=>({data:{user:{id:'auth'}},error:null})},from(table){
    let payload=null;const conditions=[];
    const query={select(){return this},eq(k,v){conditions.push([k,v]);return this},insert(value){payload=value;return this},maybeSingle(){return this},single(){return this},then(resolve,reject){
      let data=null,error=null;
      if(payload){
        if(options.fail)error={code:'XX000',message:'private diagnostic'};
        else if(rows.reservas.some(r=>r.id===payload.id))error={code:'23505'};
        else {data={...payload,numero_reserva:++writes,updated_at:new Date(clock).toISOString()};rows.reservas.push(data)}
      } else data=(rows[table]||[]).find(r=>conditions.every(([k,v])=>r[k]===v))||null;
      return Promise.resolve({data,error}).then(resolve,reject);
    }};return query;
  }};
  const api=load('src/app/api/crm/reservas/crear/route.ts',{'@supabase/supabase-js':{createClient:()=>db}},{Date:Clock,console:{error(){}}});
  const base={cliente_id:ids.client,tarotista_worker_id:ids.reader,fecha_reserva:'2026-11-02T18:00:00+01:00',operation_id:ids.operation};base.fecha_reserva='2026-11-02T19:00:00+01:00';
  return {rows,get writes(){return writes},advance(ms){clock+=ms},async create(extra={},auth=true){const res=await api.POST(new Request('https://fixture.invalid/api/crm/reservas/crear',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer fixture'}:{})},body:JSON.stringify({...base,...extra})}));return {status:res.status,body:await res.json()}}};
}
test('Admin and Central save one real-shaped reservation and receive a reference; both retries and concurrent submits are idempotent',async()=>{
  for(const role of ['admin','central']){
    const f=fixture({role});const results=await Promise.all([f.create(),f.create()]);
    assert.deepEqual(results.map(r=>r.status),[200,200]);assert.equal(f.writes,1);
    assert.equal(results[0].body.reserva.numero_reserva,1);
    assert.equal(results[0].body.reserva.fecha_reserva,'2026-11-02T18:00:00.000Z');
    assert.equal((await f.create()).body.repeated,true);assert.equal(f.writes,1);
  }
});
test('retry after scheduled time confirms the existing booking without another insert',async()=>{
  const f=fixture();await f.create();f.advance(7200000);
  assert.equal((await f.create()).status,200);assert.equal(f.writes,1);
});
test('a reused operation with different content cannot overwrite or create a booking',async()=>{
  const f=fixture();await f.create();assert.equal((await f.create({nota:'changed'})).status,409);assert.equal(f.writes,1);
});
test('expired time, missing reader, inactive reader, wrong role, no session and malformed IDs never create rows',async()=>{
  for(const [options,input,auth,status] of [[{}, {fecha_reserva:'2026-11-02T16:59:00Z'},true,400],[{}, {tarotista_worker_id:null},true,400],[{readerActive:false},{},true,400],[{role:'tarotista'},{},true,403],[{},{},false,401],[{},{operation_id:'bad'},true,400]]){
    const f=fixture(options);assert.equal((await f.create(input,auth)).status,status);assert.equal(f.writes,0);
  }
});
test('database failure is visible and does not announce a saved reservation',async()=>{
  const f=fixture({fail:true}),result=await f.create();assert.equal(result.status,500);assert.equal(result.body.ok,false);assert.ok(!JSON.stringify(result.body).includes('private diagnostic'));assert.equal(f.writes,0);
});
const helpers=load('src/lib/reservas.ts');
test('agenda shows today/new reservations while older pending reservations remain in overdue/history',()=>{
  const old={fecha_reserva:'2026-09-14T01:00:00',estado:'pendiente'},today={fecha_reserva:'2026-11-02T16:00:00',estado:'pendiente'},future={fecha_reserva:'2026-11-03T17:00:00',estado:'pendiente'};
  assert.equal(helpers.reservaInView(old,'agenda',now),false);assert.equal(helpers.reservaInView(old,'atrasadas',now),true);assert.equal(helpers.reservaInView(old,'historial',now),true);
  assert.equal(helpers.reservaInView(today,'hoy',now),true);assert.equal(helpers.reservaInView(future,'agenda',now),true);assert.equal(helpers.reservaInView(future,'proximas',now),true);
  assert.equal(helpers.reservaInView({...old,estado:'completada'},'atrasadas',now),false);
  assert.equal(helpers.reservaDay('2026-11-02T23:30:00Z'),'2026-11-03');
});
test('confirming and adding an operational note preserve the booking history and never complete the appointment',()=>{
  const row={fecha_reserva:'2026-11-03T17:00:00',estado:'pendiente',nota:'Original'};
  const confirmed=helpers.reservaChange(row,{action:'confirmar',motivo:'Por teléfono'},'Admin',new Date(now));
  assert.equal(confirmed.estado,'confirmada');assert.match(confirmed.nota,/Original/);assert.match(confirmed.nota,/Por teléfono/);
  const note=helpers.reservaChange({...row,estado:'confirmada'},{action:'nota',motivo:'Llamar al llegar'},'Central',new Date(now));
  assert.equal(note.estado,undefined);assert.match(note.nota,/Original/);assert.match(note.nota,/Llamar al llegar/);
  assert.throws(()=>helpers.reservaChange(row,{action:'nota',motivo:''},'Central'),/nota/);
});
