const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let db;
const sql = async (text, params = []) => (await db.query(text, params)).rows;
async function asRole(role, user, action) {
  await db.exec(`set role ${role}`);
  await sql("select set_config('request.jwt.claim.sub',$1,false)", [user ? id(user) : '']);
  try { return await action(); } finally { await db.exec('reset role'); }
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private;
    grant usage on schema public,auth,private to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    create table workers(id uuid primary key,user_id uuid,auth_user_id uuid,role text,is_active boolean);
    create table crm_clientes(id uuid primary key,auth_user_id uuid unique,nombre text,telefono text,puntos integer default 0);
    create table crm_etiquetas(id uuid primary key,nombre text);
    create table crm_cliente_etiquetas(id uuid primary key,cliente_id uuid references crm_clientes(id),etiqueta_id uuid references crm_etiquetas(id));
    grant all on all tables in schema public to anon,authenticated,service_role;
    -- Live workers policy dependency, including the definer used to avoid worker recursion.
    create function private.current_worker_role() returns text language sql stable security definer set search_path=pg_catalog as $$
      select w.role from public.workers w
      where w.user_id=(select auth.uid()) or w.auth_user_id=(select auth.uid())
      order by case when w.user_id=(select auth.uid()) then 0 else 1 end limit 1
    $$;
    create function public."current_role"() returns text language sql stable set search_path=pg_catalog as $$
      select private.current_worker_role()
    $$;
    alter table workers enable row level security;
    create policy workers_select_self on workers for select to authenticated using (
      user_id=(select auth.uid()) or auth_user_id=(select auth.uid())
      or (select public."current_role"())='admin'
      or ((select public."current_role"())='central' and role in('central','tarotista'))
    );
    -- Minimal representatives of the installed bypassing legacy RPCs.
    create function crm_register_call_atomic_v3(p_payload jsonb) returns jsonb language sql security definer as $$select '{}'::jsonb$$;
    create function crm_register_call_atomic_v4(p_payload jsonb) returns jsonb language sql security definer as $$select '{}'::jsonb$$;
    insert into workers values
      ('${id(101)}','${id(1)}',null,'admin',true),
      ('${id(102)}','${id(2)}',null,'central',true),
      ('${id(103)}','${id(3)}',null,'central',false),
      ('${id(104)}','${id(4)}',null,'tarotista',true),
      ('${id(105)}',null,'${id(5)}','admin',true);
    insert into crm_clientes(id,auth_user_id,nombre,telefono) values
      ('${id(201)}','${id(21)}','Client A','1001'),
      ('${id(202)}','${id(22)}','Client B','1002'),
      ('${id(203)}',null,'Unlinked','1003');
    insert into crm_etiquetas values('${id(301)}','cliente instagram'),('${id(302)}','internal label');
    insert into crm_cliente_etiquetas values
      ('${id(401)}','${id(201)}','${id(301)}'),
      ('${id(402)}','${id(202)}','${id(302)}');
    create view tc_test_crm_view with(security_invoker=true) as select id,telefono from crm_clientes;
    grant select on tc_test_crm_view to anon,authenticated,service_role;
  `);
  const dir = path.join(__dirname, '../supabase/migrations');
  const migration = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(name => name.endsWith('_crm_public_registration_access.sql'))), 'utf8');
  await db.exec(migration);
  await db.exec(migration);
});
after(async () => db.close());

for (const table of ['crm_clientes','crm_cliente_etiquetas','crm_etiquetas']) {
  test(`anonymous cannot select, insert, update or delete ${table}`, async () => {
    for (const query of [`select * from ${table}`, `insert into ${table}(id) values('${id(999)}')`, `update ${table} set id=id`, `delete from ${table}`]) {
      await asRole('anon', null, () => assert.rejects(sql(query), /permission denied/));
    }
  });
}

test('a signed-in customer sees only the CRM row bound to verified auth_user_id and own tag relation', async () => {
  await asRole('authenticated', 21, async () => {
    assert.deepEqual((await sql('select id from crm_clientes')).map(x=>x.id), [id(201)]);
    assert.deepEqual((await sql('select cliente_id from crm_cliente_etiquetas')).map(x=>x.cliente_id), [id(201)]);
    assert.deepEqual(await sql('select * from crm_etiquetas'), []);
    assert.deepEqual(await sql('select * from crm_clientes where id=$1', [id(202)]), []);
  });
});

test('new unlinked accounts and forged metadata do not expose CRM records', async () => {
  await asRole('authenticated', 23, async () => {
    await sql("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({user_metadata:{crm_client_id:id(201),crm_phone:'1001',role:'admin'}})]);
    assert.deepEqual(await sql('select * from crm_clientes'), []);
    assert.deepEqual(await sql('select * from crm_cliente_etiquetas'), []);
    assert.deepEqual(await sql('select * from crm_etiquetas'), []);
  });
});

for (const user of [1,2]) {
  test(`active staff ${user} can read CRM and tag updates without recursive RLS`, async () => {
    await asRole('authenticated', user, async () => {
      assert.equal((await sql('select * from crm_clientes')).length, 3);
      assert.equal((await sql('select * from crm_cliente_etiquetas')).length, 2);
      assert.equal((await sql('select * from crm_etiquetas')).length, 2);
      // Realtime authorization depends on the same SELECT policies.
      assert.equal((await sql('select * from crm_clientes where id=$1',[id(201)])).length, 1);
    });
  });
}

for (const user of [3,4,5]) {
  test(`inactive staff, tarotist or legacy-only worker binding ${user} cannot enumerate CRM`, async () => {
    await asRole('authenticated', user, async () => {
      assert.deepEqual(await sql('select * from crm_clientes'), []);
      assert.deepEqual(await sql('select * from crm_cliente_etiquetas'), []);
      assert.deepEqual(await sql('select * from crm_etiquetas'), []);
    });
  });
}

test('customers cannot rebind identity, mint balances, overwrite profile or add/delete CRM records via REST', async () => {
  await asRole('authenticated', 21, async () => {
    for(const query of [
      `update crm_clientes set auth_user_id='${id(21)}' where id='${id(203)}'`,
      `update crm_clientes set auth_user_id='${id(22)}' where id='${id(201)}'`,
      `update crm_clientes set puntos=9999 where id='${id(201)}'`,
      `update crm_clientes set telefono='1002' where id='${id(201)}'`,
      `insert into crm_clientes(id,auth_user_id) values('${id(999)}','${id(21)}')`,
      `delete from crm_clientes where id='${id(201)}'`,
      `insert into crm_cliente_etiquetas(id,cliente_id,etiqueta_id) values('${id(999)}','${id(201)}','${id(302)}')`,
      `update crm_cliente_etiquetas set cliente_id='${id(201)}'`,
      `delete from crm_cliente_etiquetas`,
      `insert into crm_etiquetas(id,nombre) values('${id(999)}','fake')`,
      `update crm_etiquetas set nombre='fake'`,
      `delete from crm_etiquetas`,
    ]) await assert.rejects(sql(query), /permission denied/);
  });
});

test('staff browser writes also remain behind authorized server routes', async () => {
  await asRole('authenticated',1,()=>assert.rejects(sql('update crm_clientes set puntos=9999'), /permission denied/));
});

test('security invoker CRM views preserve the same customer isolation', async () => {
  await asRole('authenticated', 21, async () => {
    assert.deepEqual((await sql('select id from tc_test_crm_view')).map(x=>x.id),[id(201)]);
  });
  await asRole('anon',null,()=>assert.rejects(sql('select * from tc_test_crm_view'),/permission denied/));
});

test('service routes retain registration, profile edit and label writes after enabling RLS', async () => {
  await asRole('service_role',null,async () => {
    await sql('insert into crm_clientes(id,auth_user_id,nombre) values($1,$2,$3)',[id(209),id(29),'Registered']);
    await sql('update crm_clientes set nombre=$1 where id=$2',['Updated profile',id(209)]);
    await sql('insert into crm_etiquetas(id,nombre) values($1,$2)',[id(309),'Service tag']);
    await sql('insert into crm_cliente_etiquetas values($1,$2,$3)',[id(409),id(209),id(309)]);
    assert.equal((await sql('select nombre from crm_clientes where id=$1',[id(209)]))[0].nombre,'Updated profile');
    await sql('delete from crm_cliente_etiquetas where id=$1',[id(409)]);
    await sql('delete from crm_clientes where id=$1',[id(209)]);
    await sql('delete from crm_etiquetas where id=$1',[id(309)]);
  });
});

test('unsafe legacy call RPCs are no longer public but service compatibility is retained', async () => {
  for(const fn of ['crm_register_call_atomic_v3','crm_register_call_atomic_v4']) {
    for(const role of ['anon','authenticated']) {
      await asRole(role,21,()=>assert.rejects(sql(`select ${fn}('{}'::jsonb)`), /permission denied/));
    }
    await asRole('service_role',null,async()=>assert.deepEqual((await sql(`select ${fn}('{}'::jsonb) value`))[0].value,{}));
  }
});
