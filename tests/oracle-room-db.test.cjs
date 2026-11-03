// Embedded PostgreSQL only: fictional IDs and balances, no remote services.
const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..');
const owner='00000000-0000-4000-8000-000000000001', draw='00000000-0000-4000-8000-000000000002', other='00000000-0000-4000-8000-000000000003';
test('atomic question pairs, replay, rollback, ownership and reserved-draw recovery',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`
 create role anon; create role authenticated; create role service_role;
 create table cliente_oraculo_diario(id uuid primary key,cliente_id uuid,fecha date,tema text,included_question_used_at timestamptz);
 create table cliente_oraculo_mensajes(id uuid default gen_random_uuid(),cliente_id uuid,draw_id text,fecha date,tema text,role text,contenido text,question_source text,message_order bigint,created_at timestamptz);
 create table cliente_oracle_question_movements(cliente_id uuid,amount int,movement_type text,reference text unique,draw_id text,notes text);
 create table cliente_oracle_credit_movements(cliente_id uuid,amount int,movement_type text,reference text unique,draw_type text,notes text);
 create table cliente_oracle_draw_sessions(id uuid default gen_random_uuid(),cliente_id uuid,draw_key text unique,draw_type text,shuffle_id text,question text,context text,required_cards int,status text,credit_reserved bool,updated_at timestamptz default now());
 create function get_cliente_oracle_balance(p_cliente_id uuid) returns integer language sql as $$select coalesce(sum(amount),0)::int from cliente_oracle_credit_movements where cliente_id=p_cliente_id$$;
 `);
 await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/oracle-existing-rpcs.sql'),'utf8'));
 const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261103075623_oracle_room_atomic_questions.sql'),'utf8');
 await db.exec(migration); await db.exec(migration); // Repeatable deployment.
 await db.query('insert into cliente_oraculo_diario values($1,$2,current_date,\'amor\',null)',[draw,owner]);
 const call=(q,a='Orientación simbólica.')=>db.query('select tc_oracle_answer_question($1,$2,$3,$4) as result',[owner,draw,q,a]);
 const first=(await call('¿Qué puedo hacer hoy?')).rows[0].result;
 assert.equal(first.source,'included');assert.equal(first.replayed,false);
 assert.equal((await db.query('select count(*)::int as n from cliente_oraculo_mensajes')).rows[0].n,2);
 const replay=(await call('¿Qué puedo hacer hoy?','Una respuesta distinta que no se debe guardar')).rows[0].result;
 assert.equal(replay.replayed,true);assert.equal(replay.answer,'Orientación simbólica.');
 await assert.rejects(call('Otra pregunta'),/NO_ORACLE_QUESTIONS/);
 await assert.rejects(db.query('select tc_oracle_answer_question($1,$2,$3,$4)',[other,draw,'Ajena','Respuesta']),/DRAW_NOT_FOUND/);
 await db.query("insert into cliente_oracle_question_movements(cliente_id,amount,reference) values($1,2,'fixture-grant')",[owner]);
 await db.exec("alter table cliente_oraculo_mensajes add constraint simulate_save_failure check(contenido <> 'SIMULATED_FAILURE')");
 await assert.rejects(call('Debe volver atrás','SIMULATED_FAILURE'),/simulate_save_failure/);
 assert.equal((await db.query('select get_cliente_oracle_question_balance($1) as n',[owner])).rows[0].n,2);
 assert.equal((await db.query('select count(*)::int as n from cliente_oraculo_mensajes')).rows[0].n,2);
 await db.query('update cliente_oraculo_diario set included_question_used_at=null where id=$1',[draw]);
 await assert.rejects(call('También falla la incluida','SIMULATED_FAILURE'),/simulate_save_failure/);
 assert.equal((await db.query('select included_question_used_at from cliente_oraculo_diario')).rows[0].included_question_used_at,null);
 await call('Incluida recuperada');
 assert.equal((await call('Ahora una extra')).rows[0].result.source,'extra');
 await call('Ahora una extra');
 assert.equal((await db.query('select get_cliente_oracle_question_balance($1) as n',[owner])).rows[0].n,1);
 assert.equal((await db.query('select count(*)::int as n from cliente_oraculo_mensajes')).rows[0].n,6);
 const privileges=(await db.query("select has_function_privilege('anon','tc_oracle_answer_question(uuid,text,text,text)','execute') as anon,has_function_privilege('authenticated','tc_oracle_answer_question(uuid,text,text,text)','execute') as authenticated,has_function_privilege('service_role','tc_oracle_answer_question(uuid,text,text,text)','execute') as server")).rows[0];
 assert.deepEqual(privileges,{anon:false,authenticated:false,server:true});
 await db.query("insert into cliente_oracle_credit_movements(cliente_id,amount,reference) values($1,3,'fixture-credit')",[owner]);
 const reserve=key=>db.query("select reserve_cliente_oracle_draw_v2($1,$2,'clarity','shuffle','Pregunta','',3,'test') as result",[owner,key]);
 const start=(await reserve('first')).rows[0].result, resume=(await reserve('second')).rows[0].result;
 assert.equal(start.balance,2);assert.equal(resume.balance,2);assert.equal(resume.resumed,true);assert.equal(start.session.id,resume.session.id);
 assert.equal((await db.query('select count(*)::int as n from cliente_oracle_draw_sessions')).rows[0].n,1);
 } finally {await db.close();}
});
