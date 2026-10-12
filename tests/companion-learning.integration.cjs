const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// Local PostgreSQL integration coverage. This never connects to production.
const migration = fs.readFileSync(path.join(__dirname,
  '../supabase/migrations/20261012161528_companion_learning.sql'), 'utf8');
const table = 'public.central_assistant_learning_episodes';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let db;

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    create table public.workers(id uuid primary key, user_id uuid, role text, is_active boolean);
    insert into public.workers values
      ('${id(1)}', '${id(101)}', 'central', true),
      ('${id(2)}', '${id(102)}', 'central', true);
  `);
  return database;
}

async function insertEpisode(database, n, changes = {}) {
  const values = {
    id: id(n), worker_id: id(1), source_key: `recovery:${id(n)}`,
    source_id: id(n + 1000), client_id: id(n + 2000), strategy: 'recovery_recent',
    title: 'Revisar seguimiento de prueba', reason: 'Hay un seguimiento pendiente en la ficha.',
    expected_outcome: 'Observar si el seguimiento se completa.', ...changes,
  };
  const fields = Object.keys(values);
  return database.query(
    `insert into ${table} (${fields.join(',')}) values (${fields.map((_, i) => `$${i + 1}`).join(',')}) returning *`,
    Object.values(values),
  );
}

async function asRole(database, role, callback) {
  await database.exec(`set role ${role}`);
  try { return await callback(); } finally { await database.exec('reset role'); }
}

before(async () => {
  db = await createDatabase();
  await db.exec(migration);
});
after(async () => { await db?.close(); });

test('browser roles cannot read or change episodes even when the project grants defaults', async () => {
  await insertEpisode(db, 10);
  for (const role of ['anon', 'authenticated']) {
    await asRole(db, role, async () => {
      for (const sql of [
        `select * from ${table}`,
        `insert into ${table} select * from ${table}`,
        `update ${table} set state = 'observed'`,
        `delete from ${table}`,
      ]) {
        await assert.rejects(db.query(sql), error => error.code === '42501', `${role}: ${sql}`);
      }
    });
  }
  const { rows } = await db.query(`select state from ${table} where id = $1`, [id(10)]);
  assert.equal(rows[0].state, 'suggested');
  const rls = await db.query(`select relrowsecurity from pg_class where oid = '${table}'::regclass`);
  assert.equal(rls.rows[0].relrowsecurity, true);
});

test('service role performs the evidence lifecycle and no writable XP column exists', async () => {
  await asRole(db, 'service_role', async () => {
    await insertEpisode(db, 20);
    const started = await db.query(`update ${table}
      set state='trying', tried_at=now(), deadline_at=now()+interval '7 days', updated_at=now()
      where id=$1 and worker_id=$2 and state='suggested' returning id`, [id(20), id(1)]);
    assert.equal(started.rows.length, 1);
    const observed = await db.query(`update ${table}
      set state='observed', evidence='{"kind":"followup_completed","id":"fixture20"}',
          resolved_at=now(), updated_at=now()
      where id=$1 and worker_id=$2 and state='trying' returning state, evidence`, [id(20), id(1)]);
    assert.equal(observed.rows[0].state, 'observed');
    assert.equal(observed.rows[0].evidence.kind, 'followup_completed');
    await db.query(`update ${table} set feedback='helpful', feedback_note='La explicación fue útil',
      feedback_at=now() where id=$1`, [id(20)]);
    assert.equal((await db.query(`select count(*)::int as n from ${table} where id=$1`, [id(20)])).rows[0].n, 1);
  });
  const columns = await db.query(`select column_name from information_schema.columns
    where table_schema='public' and table_name='central_assistant_learning_episodes'`);
  assert.equal(columns.rows.some(row => /^(xp|level|points|score)$/.test(row.column_name)), false);
});

test('same source is recorded once per worker without suppressing another worker', async () => {
  await insertEpisode(db, 30, { source_key: 'followup:once' });
  await assert.rejects(insertEpisode(db, 31, { source_key: 'followup:once' }), error => error.code === '23505');
  const other = await insertEpisode(db, 32, { worker_id: id(2), source_key: 'followup:once' });
  assert.equal(other.rows[0].worker_id, id(2));
});

test('one observed event cannot reward two missions belonging to the same worker', async () => {
  const observed = {
    state: 'observed', resolved_at: '2026-10-12T10:00:00Z',
    evidence: JSON.stringify({ kind: 'call_observed', id: id(1300), detail: 'Una llamada de prueba' }),
  };
  await insertEpisode(db, 35, observed);
  await assert.rejects(insertEpisode(db, 36, observed), error => error.code === '23505');
  const other = await insertEpisode(db, 37, { ...observed, worker_id: id(2) });
  assert.equal(other.rows[0].worker_id, id(2));
  await insertEpisode(db, 38, { ...observed, state: 'invalidated' });
});

test('conditional state updates claim a suggestion only once and enforce worker scope', async () => {
  await insertEpisode(db, 40);
  const query = `update ${table} set state='trying', tried_at=now(), deadline_at=now()+interval '1 day'
    where id=$1 and worker_id=$2 and state='suggested' returning id`;
  assert.equal((await db.query(query, [id(40), id(2)])).rows.length, 0);
  const updates = await Promise.all([db.query(query, [id(40), id(1)]), db.query(query, [id(40), id(1)])]);
  assert.equal(updates.reduce((count, result) => count + result.rows.length, 0), 1);
});

test('required identities, foreign worker and bounded text reject malformed episodes', async () => {
  const cases = [
    [{ source_id: null }, '23502'], [{ worker_id: id(999999) }, '23503'],
    [{ source_key: '' }, '23514'], [{ source_key: 'x'.repeat(221) }, '23514'],
    [{ title: 'x'.repeat(181) }, '23514'], [{ title: '   ' }, '23514'],
    [{ reason: 'x'.repeat(1601) }, '23514'],
    [{ expected_outcome: 'x'.repeat(801) }, '23514'],
    [{ strategy: 'invented_success' }, '23514'], [{ state: 'level_up' }, '23514'],
    [{ baseline: '[]' }, '23514'], [{ baseline: 'null' }, '23514'],
    [{ evidence: '[]' }, '23514'], [{ evidence: 'null' }, '23514'],
    [{ feedback: 'amazing' }, '23514'], [{ feedback_note: 'x'.repeat(601) }, '23514'],
    [{ feedback: 'helpful' }, '23514'],
  ];
  for (const [index, [changes, code]] of cases.entries()) {
    await assert.rejects(insertEpisode(db, 100 + index, changes), error => error.code === code,
      `must reject ${Object.keys(changes).join(',')}`);
  }
});

test('an attempt needs a deadline and an observed result needs actual evidence', async () => {
  for (const [index, changes] of [
    { state: 'trying' },
    { state: 'trying', tried_at: '2026-10-12T10:00:00Z' },
    { state: 'trying', tried_at: '2026-10-12T10:00:00Z', deadline_at: '2026-10-12T09:00:00Z' },
    { state: 'observed', resolved_at: '2026-10-12T10:00:00Z' },
    { state: 'observed', resolved_at: '2026-10-12T10:00:00Z', evidence: '{}' },
    { state: 'observed', resolved_at: '2026-10-12T10:00:00Z', evidence: '{"kind":"completed"}' },
    { state: 'observed', resolved_at: '2026-10-12T10:00:00Z', evidence: '{"kind":"completed","id":""}' },
    { state: 'observed', evidence: '{"kind":"completed"}' },
    { state: 'no_result' },
  ].entries()) {
    await assert.rejects(insertEpisode(db, 200 + index, changes), error => error.code === '23514');
  }
  const unresolved = await insertEpisode(db, 210, { state: 'no_result', resolved_at: '2026-10-12T10:00:00Z' });
  assert.equal(unresolved.rows[0].evidence, null);
});

test('reinstall preserves episode evidence, dates, feedback and privacy', async () => {
  const beforeRows = (await db.query(`select * from ${table} order by id`)).rows;
  await db.exec(migration);
  await db.exec(migration);
  assert.deepEqual((await db.query(`select * from ${table} order by id`)).rows, beforeRows);
  assert.equal((await db.query(`select count(*)::int as n from pg_constraint
    where conrelid='${table}'::regclass and conname='companion_learning_source_unique'`)).rows[0].n, 1);
  await asRole(db, 'authenticated', async () => {
    await assert.rejects(db.query(`select * from ${table}`), error => error.code === '42501');
  });
});

test('partial installation adds missing columns and constraints while preserving existing rows', async () => {
  const partial = await createDatabase();
  try {
    await partial.exec(`create table ${table} (
      id uuid, worker_id uuid, source_key text, source_id uuid, strategy text,
      title text, reason text, expected_outcome text
    )`);
    await partial.query(`insert into ${table} values ($1,$2,'partial:kept',$3,'followup_due',
      'Conservar', 'Seguimiento pendiente', 'Completar seguimiento')`, [id(300), id(1), id(1300)]);
    await partial.exec(migration);
    await partial.exec(migration);
    const row = (await partial.query(`select * from ${table} where id=$1`, [id(300)])).rows[0];
    assert.equal(row.title, 'Conservar');
    assert.equal(row.state, 'suggested');
    assert.deepEqual(row.baseline, {});
    assert.equal(row.feedback, null);
    assert.ok(row.created_at);
    await assert.rejects(insertEpisode(partial, 301, { source_key: 'partial:kept' }), error => error.code === '23505');
    await asRole(partial, 'authenticated', async () => {
      await assert.rejects(partial.query(`select * from ${table}`), error => error.code === '42501');
    });
  } finally { await partial.close(); }
});

test('invalid legacy rows abort installation without deleting or inventing identities', async () => {
  const partial = await createDatabase();
  try {
    await partial.exec(`create table ${table} (id uuid, title text);
      insert into ${table} values ('${id(400)}', 'Conservar también este dato')`);
    await assert.rejects(partial.exec(migration), error => error.code === '23502');
    await partial.exec('rollback');
    assert.deepEqual((await partial.query(`select * from ${table}`)).rows,
      [{ id: id(400), title: 'Conservar también este dato' }]);
  } finally { await partial.close(); }
});

test('deleting a worker cleans their private learning records', async () => {
  await db.query('insert into public.workers(id) values($1)', [id(3)]);
  await insertEpisode(db, 500, { worker_id: id(3) });
  await db.query('delete from public.workers where id=$1', [id(3)]);
  assert.equal((await db.query(`select count(*)::int as n from ${table} where worker_id=$1`, [id(3)])).rows[0].n, 0);
});
