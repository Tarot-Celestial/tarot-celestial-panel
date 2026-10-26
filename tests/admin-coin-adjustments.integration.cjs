const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
const scalar=async(sql,params=[])=>(await db.query(sql,params)).rows[0].v;
const adjust=(op,client,amount=50,reason='Ajuste de prueba',actor=1)=>scalar('select tc_admin_adjust_coins($1,$2,$3,$4,$5) v',[id(op),id(client),id(actor+100),amount,reason]);
const snapshot=client=>scalar(`select jsonb_build_object('coins',c.puntos,'free',c.minutos_free_pendientes,'normal',c.minutos_normales_pendientes,'rank',c.rango_actual,
 'ledger',(select count(*) from cliente_puntos_historial where cliente_id=c.id),
 'notes',(select count(*) from crm_client_notes where cliente_id=c.id::text),
 'notifications',(select count(*) from cliente_notificaciones where cliente_id=c.id),
 'audit',(select count(*) from tc_admin_coin_adjustments where cliente_id=c.id),
 'purchases',(select count(*) from crm_cliente_pagos where cliente_id=c.id),
 'spins',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'level',nivel,'state',estado) order by id),'[]'::jsonb) from cliente_ruleta_giros where cliente_id=c.id)) v
 from crm_clientes c where id=$1`,[id(client)]);
async function client(n,coins=75){
 await db.query("insert into crm_clientes(id,nombre,puntos,minutos_free_pendientes,minutos_normales_pendientes,rango_actual) values($1,'Cliente de prueba',$2,17,31,'plata')",[id(n),coins]);
 await db.query("insert into crm_cliente_pagos(cliente_id,importe) values($1,22)",[id(n)]);
 await db.query("insert into cliente_ruleta_giros(id,cliente_id,nivel,estado) values($1,$2,2,'pending'),($3,$2,1,'used')",[id(n+100000),id(n),id(n+200000)]);
}
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table workers(id uuid primary key,user_id uuid unique,role text,is_active boolean,display_name text,email text);
 create table crm_clientes(id uuid primary key,nombre text not null,apellido text,puntos integer default 0,updated_at timestamptz not null default now(),minutos_free_pendientes numeric,minutos_normales_pendientes numeric,rango_actual text);
 create table cliente_puntos_historial(id uuid primary key default gen_random_uuid(),cliente_id uuid references crm_clientes(id),tipo text,puntos integer,descripcion text,created_at timestamp default now(),operation_id uuid,admin_worker_id uuid references workers(id) on delete set null,saldo_despues integer,meta jsonb);
 create unique index cliente_puntos_historial_operation_id_uidx on cliente_puntos_historial(operation_id) where operation_id is not null;
 create table crm_client_notes(id uuid primary key default gen_random_uuid(),cliente_id text not null,texto text not null,author_user_id uuid,author_name text,author_email text,created_at timestamptz not null default now(),is_pinned boolean default false,ruleta_spin_id uuid,event_type text,event_data jsonb);
 create table cliente_notificaciones(id uuid primary key default gen_random_uuid(),cliente_id uuid,tipo text,titulo text,mensaje text,leida boolean,meta jsonb,created_at timestamptz);
 create table cliente_ruleta_signal(cliente_id uuid primary key,updated_at timestamptz);
 create table cliente_ruleta_giros(id uuid primary key,cliente_id uuid,nivel smallint,estado text);
 create table crm_cliente_pagos(id uuid primary key default gen_random_uuid(),cliente_id uuid,importe numeric);
 grant usage on schema public to service_role;
 grant all on all tables in schema public to service_role;
 `);
 for(const [n,role,active] of [[1,'admin',true],[2,'admin',true],[3,'central',true],[4,'admin',false]])await db.query('insert into workers values($1,$2,$3,$4,$5,$6)',[id(n),id(n+100),role,active,'Equipo de prueba '+n,'fixture'+n+'@example.test']);
 // Exact, read-only live definitions. The canonical gift ledger, notification
 // and signal engine are executed, not replaced by test doubles.
 await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/admin-coin-production-dependencies.sql'),'utf8'));
 await db.exec(`create trigger trg_tc_state_signal_crm_clientes after update of puntos,minutos_free_pendientes,minutos_normales_pendientes,rango_actual on crm_clientes
 for each row when (old.puntos is distinct from new.puntos or old.minutos_free_pendientes is distinct from new.minutos_free_pendientes or old.minutos_normales_pendientes is distinct from new.minutos_normales_pendientes or old.rango_actual is distinct from new.rango_actual)
 execute function tc_emit_client_state_signal();
 revoke all on function admin_gift_client_coins(uuid,uuid,integer,text,uuid) from public,anon,authenticated;
 grant execute on function admin_gift_client_coins(uuid,uuid,integer,text,uuid) to service_role;`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261026011844_admin_coin_adjustments.sql'),'utf8'));
});
after(async()=>{await db?.close();});

test('manual Coins reuse canonical balance/ledger and atomically record admin, before/after, CRM note and refresh signal',async()=>{
 await client(10);const original=await snapshot(10);const r=await adjust(1000,10,125,'  Compensación acordada  ');
 assert.equal(r.replayed,false);assert.equal(r.before_balance,75);assert.equal(r.after_balance,200);assert.equal(r.amount,125);assert.equal(r.reason,'Compensación acordada');assert.equal(r.actor_user_id,id(101));assert.equal(r.actor_worker_id,id(1));
 const actual=await snapshot(10);assert.deepEqual(actual,{...original,coins:200,ledger:1,notes:1,notifications:1,audit:1});
 const ledger=await scalar('select to_jsonb(h) v from cliente_puntos_historial h where id=$1',[r.movement_id]);
 assert.equal(ledger.tipo,'regalo_admin');assert.equal(ledger.puntos,125);assert.equal(ledger.saldo_despues,200);assert.equal(ledger.admin_worker_id,id(1));assert.equal(ledger.operation_id,id(1000));
 const note=await scalar('select to_jsonb(n) v from crm_client_notes n where id=$1',[r.note_id]);
 assert.equal(note.author_user_id,id(101));assert.equal(note.event_type,'admin_coin_adjustment');assert.equal(note.event_data.before_balance,75);assert.equal(note.event_data.after_balance,200);assert.equal(note.event_data.movement_id,r.movement_id);assert.match(note.texto,/75 → 200/);
 assert.equal(await scalar('select count(*)::int v from cliente_ruleta_signal where cliente_id=$1',[id(10)]),1);
});
test('same operation/payload is replayed once even with surrounding reason spaces',async()=>{
 await client(11);const first=await adjust(1001,11,50,'  Ajuste confirmado  '),before=await snapshot(11);
 const replay=await adjust(1001,11,50,'Ajuste confirmado');assert.equal(replay.replayed,true);assert.equal(replay.movement_id,first.movement_id);assert.equal(replay.note_id,first.note_id);assert.deepEqual(await snapshot(11),before);
});
test('payload changes of amount, reason, target client or admin conflict without an extra grant',async()=>{
 await client(12);await client(13);await adjust(1002,12);const before=await snapshot(12),other=await snapshot(13);
 for(const args of [[1002,12,51],[1002,12,50,'Otro motivo'],[1002,13],[1002,12,50,'Ajuste de prueba',2]])await assert.rejects(adjust(...args),/OPERATION_CONFLICT/);
 assert.deepEqual(await snapshot(12),before);assert.deepEqual(await snapshot(13),other);
});
test('operation IDs already used by the existing gift route cannot be adopted or credited twice',async()=>{
 await client(14);await scalar('select admin_gift_client_coins($1,$2,50,$3,$4) v',[id(14),id(1),'Regalo anterior',id(1003)]);const before=await snapshot(14);
 await assert.rejects(adjust(1003,14,50,'Regalo anterior'),/OPERATION_CONFLICT/);assert.deepEqual(await snapshot(14),before);
 const current=await adjust(1004,14);const legacyReplay=await scalar('select admin_gift_client_coins($1,$2,50,$3,$4) v',[id(14),id(1),'Ajuste de prueba',id(1004)]);
 assert.equal(legacyReplay.duplicated,true);assert.equal(legacyReplay.movement_id,current.movement_id);assert.equal((await snapshot(14)).coins,175);
});
test('invalid/noninteger/special amounts fail at the database boundary before mutation',async()=>{
 await client(15);const before=await snapshot(15);
 for(const amount of [null,0,-1,1.5,'0.99',1000001,'NaN','Infinity','-Infinity'])await assert.rejects(adjust(1005,15,amount),/INVALID_AMOUNT/);
 assert.deepEqual(await snapshot(15),before);
});
test('reason length is strictly 3 to 500 after trimming',async()=>{
 await client(16);for(const reason of [null,'','   ','ab','x'.repeat(501)])await assert.rejects(adjust(1006,16,1,reason),/INVALID_REASON/);
 await adjust(1007,16,1,'abc');await adjust(1008,16,1,'x'.repeat(500));assert.equal((await snapshot(16)).coins,77);
});
test('only a current active admin auth user is allowed; worker IDs are not auth identities',async()=>{
 await client(17);const before=await snapshot(17);
 for(const actor of [3,4,999])await assert.rejects(adjust(1009,17,50,'Ajuste de prueba',actor),/FORBIDDEN/);
 await assert.rejects(scalar('select tc_admin_adjust_coins($1,$2,$3,50,$4) v',[id(1010),id(17),id(1),'Ajuste de prueba']),/FORBIDDEN/);
 assert.deepEqual(await snapshot(17),before);
});
test('admin revoked after success cannot use replay to bypass the current role check',async()=>{
 await client(18);await adjust(1011,18,50,'Ajuste de prueba',2);await db.query("update workers set is_active=false where id=$1",[id(2)]);
 await assert.rejects(adjust(1011,18,50,'Ajuste de prueba',2),/FORBIDDEN/);await db.query("update workers set is_active=true where id=$1",[id(2)]);assert.equal((await snapshot(18)).coins,125);
});
test('missing client and IDs cannot create audit or ledger records',async()=>{
 await assert.rejects(adjust(1012,99999),/CLIENT_NOT_FOUND/);
 await assert.rejects(scalar('select tc_admin_adjust_coins(null,$1,$2,50,$3) v',[id(10),id(101),'Ajuste de prueba']),/INVALID_ADJUSTMENT/);
 assert.equal(await scalar('select count(*)::int v from cliente_puntos_historial where operation_id=$1',[id(1012)]),0);
});
test('existing cap permits one million and rejects balance overflow without altering the original balance',async()=>{
 await client(19,0);await adjust(1013,19,1000000);assert.equal((await snapshot(19)).coins,1000000);
 await client(20,2147483647);const before=await snapshot(20);await assert.rejects(adjust(1014,20,1),/COIN_BALANCE_LIMIT/);assert.deepEqual(await snapshot(20),before);
 await client(21,null);const r=await adjust(1015,21,1);assert.equal(r.before_balance,0);assert.equal((await snapshot(21)).coins,1);
});
test('independent additions accumulate without overwriting earlier awards',async()=>{
 await client(22);const result=await Promise.all([adjust(1016,22,25),adjust(1017,22,40)]);
 assert.equal((await snapshot(22)).coins,140);assert.equal(result[0].before_balance,75);assert.equal(result[1].before_balance,100);
 // PGlite serializes its single connection; this asserts the delta contract,
 // while actual SQL row/advisory locks enforce it across database sessions.
});
test('CRM note failure rolls back canonical Coins, notification, signal, ledger and audit atomically',async()=>{
 await client(23);const before=await snapshot(23);
 await db.exec(`create function fail_coin_note_test() returns trigger language plpgsql as $$begin if new.cliente_id='${id(23)}' then raise exception 'TEST_NOTE_FAILURE';end if;return new;end$$;
 create trigger fail_coin_note_test before insert on crm_client_notes for each row execute function fail_coin_note_test();`);
 await assert.rejects(adjust(1018,23),/TEST_NOTE_FAILURE/);assert.deepEqual(await snapshot(23),before);
 assert.equal(await scalar('select count(*)::int v from cliente_ruleta_signal where cliente_id=$1',[id(23)]),0);
 await db.exec('drop trigger fail_coin_note_test on crm_client_notes;drop function fail_coin_note_test();');
 await adjust(1018,23);assert.equal((await snapshot(23)).coins,125);
});
test('wrapper is SECURITY INVOKER, audit has RLS, browser roles cannot call/write, and service role succeeds',async()=>{
 const security=await scalar(`select jsonb_build_object('definer',p.prosecdef,'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service',has_function_privilege('service_role',p.oid,'EXECUTE'),
 'rls',(select relrowsecurity from pg_class where oid='tc_admin_coin_adjustments'::regclass),
 'anon_insert',has_table_privilege('anon','tc_admin_coin_adjustments','INSERT'),'authenticated_read',has_table_privilege('authenticated','tc_admin_coin_adjustments','SELECT'),
 'service_delete',has_table_privilege('service_role','tc_admin_coin_adjustments','DELETE')) v from pg_proc p where oid='tc_admin_adjust_coins(uuid,uuid,uuid,numeric,text)'::regprocedure`);
 assert.deepEqual(security,{definer:false,anon:false,authenticated:false,service:true,rls:true,anon_insert:false,authenticated_read:false,service_delete:false});
 await client(24);await db.exec('set role service_role');try {const r=await adjust(1019,24);assert.equal(r.after_balance,125);}finally{await db.exec('reset role');}
});
