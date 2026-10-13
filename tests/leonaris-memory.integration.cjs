const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const migrationDir = path.join(__dirname, '../supabase/migrations');
const migration = fs.readdirSync(migrationDir).sort().reverse().map(name => path.join(migrationDir, name)).find(file => file.endsWith('.sql') && fs.readFileSync(file, 'utf8').includes('create or replace function public.tc_leonaris_memory('));
const clientA = '11111111-1111-4111-8111-111111111111';
const clientB = '22222222-2222-4222-8222-222222222222';

test('Leonaris SQL keeps private memory bounded, isolated, retry-safe and erasable', async t => {
  assert.ok(migration, 'migration exists');
  const db = new PGlite();
  const sql = fs.readFileSync(migration, 'utf8');
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create table public.crm_clientes(id uuid primary key); insert into public.crm_clientes values ('${clientA}'),('${clientB}');
    create table public.tc_client_leo_profiles(client_id uuid primary key references public.crm_clientes(id), hidden boolean not null default false, muted boolean not null default false, visit_counts jsonb default '{}',interest_scores jsonb default '{}',interaction_counts jsonb default '{}',last_path text,last_seen_at timestamptz,updated_at timestamptz default now());
    grant select,update on public.tc_client_leo_profiles to service_role;
    insert into public.tc_client_leo_profiles(client_id,hidden,muted,visit_counts,interest_scores,interaction_counts,last_path,last_seen_at) values ('${clientA}',true,true,'{"oracle":5}','{"oracle":2}','{"oracle":1}','/cliente/oraculo',now()),('${clientB}',false,false,'{"ritual":3}','{}','{}','/cliente/ritual',now());`);
  await db.exec(sql);
  const op = async (client, operation, payload = {}) => (await db.query('select public.tc_leonaris_memory($1::uuid,$2::text,$3::jsonb) as result', [client, operation, JSON.stringify(payload)])).rows[0].result;
  const complete = async (client, id = randomUUID(), question = '¿Cómo veo mi saldo?') => {
    const claim = await op(client, 'claim', { requestId: id, question });
    assert.equal(claim.status, 'claimed');
    const answer = { id, title: 'Tu saldo', message: 'Puedes verlo en Inicio.', mode: 'guided', actions: [] };
    const done = await op(client, 'complete', { requestId: id, claimToken: claim.claimToken, answer });
    assert.equal(done.status, 'ok');
    return { id, claimToken: claim.claimToken, answer };
  };
  try {
    await t.test('migration is repeatable and preserves client notes', async () => {
      const note = await op(clientA, 'remember', { content: 'Me gusta el Oráculo.' });
      await db.exec(sql);
      assert.equal((await op(clientA, 'read')).memories[0].id, note.memory.id);
    });
    await t.test('anonymous and authenticated roles have no table or RPC access', async () => {
      for (const role of ['anon', 'authenticated']) {
        await db.exec(`set role ${role}`);
        await assert.rejects(db.query('select * from public.tc_client_leo_memories'), /permission denied/);
        await assert.rejects(op(clientA, 'read'), /permission denied/);
        await db.exec('reset role');
      }
      const security = (await db.query("select prosecdef,proconfig from pg_proc where proname='tc_leonaris_memory'")).rows[0];
      assert.equal(security.prosecdef, false);
      assert.ok(security.proconfig.includes('search_path=""'));
      await db.exec('set role service_role');
      assert.equal((await op(clientA, 'read')).status, 'ok');
      await db.exec('reset role');
    });
    await t.test('notes cannot leak across clients and are deduplicated with a cap of 20', async () => {
      const note = await op(clientA, 'remember', { content: 'Me gusta el Oráculo.' });
      assert.equal((await op(clientA, 'read')).memories.length, 1);
      assert.equal((await op(clientB, 'read')).memories.length, 0);
      await op(clientB, 'forget', { memoryId: note.memory.id });
      assert.equal((await op(clientA, 'read')).memories.length, 1);
      for (let i = 1; i < 20; i++) assert.equal((await op(clientA, 'remember', { content: `Nota ${i}` })).status, 'ok');
      assert.equal((await op(clientA, 'remember', { content: 'Nota extra' })).code, 'memory_limit');
      assert.equal((await op(clientA, 'remember', { content: 'x'.repeat(401) })).code, 'invalid_memory');
      await op(clientA, 'forget', { memoryId: note.memory.id });
      assert.equal((await op(clientA, 'read')).memories.length, 19);
    });
    await t.test('signals support ranks and ritual, deduplicate per section and honor opt-out inside the same RPC', async () => {
      await db.exec('set role service_role');
      const ritual = { signal: 'visit', context: 'ritual', pathname: '/cliente/ritual' };
      assert.equal((await op(clientA, 'signal', ritual)).recorded, true);
      assert.equal((await op(clientA, 'signal', ritual)).recorded, false);
      assert.equal((await op(clientA, 'signal', { ...ritual, signal: 'interaction' })).recorded, true);
      assert.equal((await op(clientA, 'signal', { signal: 'visit', context: 'ranks', pathname: '/cliente/rangos' })).recorded, true);
      assert.equal((await op(clientA, 'signal', { ...ritual, pathname: '/cliente/perfil' })).code, 'invalid_signal');
      const before = (await db.query('select * from public.tc_client_leo_profiles where client_id=$1', [clientA])).rows[0];
      assert.equal(before.visit_counts.ritual, 1); assert.equal(before.interaction_counts.ritual, 1); assert.equal(before.interest_scores.ritual, 3);
      assert.equal(before.visit_counts.oracle, 5); assert.equal(before.hidden, true); assert.equal(before.muted, true);
      await op(clientA, 'preferences', { memoryEnabled: false });
      assert.equal((await op(clientA, 'signal', { signal: 'visit', context: 'raffle', pathname: '/cliente/sorteo' })).recorded, false);
      assert.deepEqual((await db.query('select * from public.tc_client_leo_profiles where client_id=$1', [clientA])).rows[0], before);
      await op(clientA, 'preferences', { memoryEnabled: true });
      await db.query("update public.tc_client_leo_companion_state set signal_seen_at=jsonb_set(signal_seen_at,array['visit:ritual'],to_jsonb((now()-interval '31 seconds')::text)) where client_id=$1", [clientA]);
      assert.equal((await op(clientA, 'signal', ritual)).recorded, true);
      await db.exec('reset role');
    });
    await t.test('request IDs deduplicate by client, reject changed prompts, and require the current claim token', async () => {
      const id = randomUUID();
      const claim = await op(clientA, 'claim', { requestId: id, question: 'Hola' });
      assert.equal((await op(clientA, 'claim', { requestId: id, question: 'Hola' })).status, 'in_progress');
      assert.equal((await op(clientA, 'claim', { requestId: id, question: 'Otro mensaje' })).code, 'request_conflict');
      const answer = { id, title: 'Hola', message: 'Te acompaño.', mode: 'guided', actions: [] };
      assert.equal((await op(clientA, 'complete', { requestId: id, answer })).code, 'stale_claim');
      assert.equal((await op(clientB, 'complete', { requestId: id, claimToken: claim.claimToken, answer })).code, 'stale_claim');
      await op(clientA, 'complete', { requestId: id, claimToken: claim.claimToken, answer });
      assert.deepEqual((await op(clientA, 'claim', { requestId: id, question: 'Hola' })).answer, answer);
      assert.equal((await op(clientA, 'read')).history.length, 2);
      assert.equal((await op(clientB, 'read')).history.length, 0);
    });
    await t.test('helpful feedback is idempotent, mutable and only accepts completed owned answers', async () => {
      const chat = await complete(clientA);
      await op(clientA, 'feedback', { requestId: chat.id, helpful: true });
      await op(clientA, 'feedback', { requestId: chat.id, helpful: true });
      assert.equal((await op(clientA, 'read')).helpful, 1);
      await op(clientA, 'feedback', { requestId: chat.id, helpful: false });
      const state = await op(clientA, 'read'); assert.equal(state.helpful, 0); assert.equal(state.unhelpful, 1);
      assert.equal((await op(clientB, 'feedback', { requestId: chat.id, helpful: true })).code, 'invalid_feedback');
    });
    await t.test('failed work never enters history or feedback learning; a retry needs a fresh claim token', async () => {
      const id = randomUUID(), before = await op(clientA, 'read');
      const first = await op(clientA, 'claim', { requestId: id, question: 'Ayuda' });
      await op(clientA, 'fail', { requestId: id, claimToken: first.claimToken });
      assert.equal((await op(clientA, 'feedback', { requestId: id, helpful: true })).code, 'invalid_feedback');
      const next = await op(clientA, 'claim', { requestId: id, question: 'Ayuda' });
      assert.notEqual(next.claimToken, first.claimToken);
      assert.equal((await op(clientA, 'fail', { requestId: id, claimToken: first.claimToken })).code, 'stale_claim');
      assert.equal((await op(clientA, 'read')).history.length, before.history.length);
    });
    await t.test('rate limiting is atomic and scoped to each client', async () => {
      await op(clientA, 'reset');
      await db.query('delete from public.tc_client_leo_chat_requests where client_id=$1', [clientA]);
      for (let i = 0; i < 8; i++) assert.equal((await op(clientA, 'claim', { requestId: randomUUID(), question: `Mensaje ${i}` })).status, 'claimed');
      assert.equal((await op(clientA, 'claim', { requestId: randomUUID(), question: 'Más' })).status, 'rate_limited');
      await op(clientA, 'reset');
      assert.equal((await op(clientA, 'claim', { requestId: randomUUID(), question: 'Tras borrar' })).status, 'rate_limited');
      assert.equal((await op(clientB, 'claim', { requestId: randomUUID(), question: 'Mi consulta' })).status, 'claimed');
    });
    await t.test('turn history returns the latest 12 chronologically and old records are bounded to 60 / 30 days', async () => {
      await op(clientA, 'reset');
      await db.query('delete from public.tc_client_leo_chat_requests where client_id=$1', [clientA]);
      for (let i = 0; i < 7; i++) await complete(clientA, randomUUID(), `Consulta ${i}`);
      const history = (await op(clientA, 'read')).history;
      assert.equal(history.length, 12); assert.equal(history[0].content, 'Consulta 1'); assert.equal(history[10].content, 'Consulta 6');
      await db.query("update public.tc_client_leo_chat_requests set created_at=now()-interval '31 days' where client_id=$1", [clientA]);
      assert.equal((await op(clientA, 'read')).history.length, 0);
      for (let i = 0; i < 65; i++) await db.query("insert into public.tc_client_leo_chat_requests(client_id,request_id,question_hash,memory_retained,status,created_at,started_at) values($1,$2,'x',false,'failed',now()-interval '2 days',now()-interval '2 days')", [clientA, randomUUID()]);
      await op(clientA, 'read');
      assert.equal(Number((await db.query('select count(*) as n from public.tc_client_leo_chat_requests where client_id=$1', [clientA])).rows[0].n), 60);
    });
    await t.test('memory-off removes history and skips new conversation storage, then expires retry cache', async () => {
      await op(clientA, 'reset');
      await db.query('delete from public.tc_client_leo_chat_requests where client_id=$1', [clientA]);
      await op(clientA, 'remember', { content: 'Nota voluntaria' });
      await complete(clientA);
      await op(clientA, 'preferences', { memoryEnabled: false, style: 'concise' });
      const state = await op(clientA, 'read'); assert.equal(state.history.length, 0); assert.equal(state.memories.length, 0); assert.equal(state.style, 'concise');
      assert.equal((await op(clientA, 'remember', { content: 'Otra' })).code, 'memory_disabled');
      const chat = await complete(clientA);
      await db.query("update public.tc_client_leo_chat_requests set reply_expires_at=now()-interval '1 minute' where client_id=$1", [clientA]);
      await op(clientA, 'read');
      assert.equal((await op(clientA, 'claim', { requestId: chat.id, question: '¿Cómo veo mi saldo?' })).answer, null);
      await op(clientA, 'preferences', { memoryEnabled: true });
      assert.equal((await op(clientA, 'read')).memories.length, 1); assert.equal((await op(clientA, 'read')).history.length, 0);
    });
    await t.test('opt-out then opt-in during an in-flight answer cannot resurrect erased chat content', async () => {
      await db.query('delete from public.tc_client_leo_chat_requests where client_id=$1', [clientA]);
      const id = randomUUID(), claim = await op(clientA, 'claim', { requestId: id, question: 'Mensaje en vuelo' });
      await op(clientA, 'preferences', { memoryEnabled: false });
      await op(clientA, 'preferences', { memoryEnabled: true });
      const result = await op(clientA, 'complete', { requestId: id, claimToken: claim.claimToken, answer: { id, title: 'Hola', message: 'Respuesta tardía', mode: 'guided', actions: [] } });
      assert.equal(result.status, 'ok');
      assert.equal((await op(clientA, 'read')).history.length, 0);
      const row = (await db.query('select question,memory_retained from public.tc_client_leo_chat_requests where client_id=$1 and request_id=$2', [clientA, id])).rows[0];
      assert.equal(row.question, null); assert.equal(row.memory_retained, false);
    });
    await t.test('forgetting everything revokes pending completion and stale tokens cannot restore memory', async () => {
      const id = randomUUID(), claim = await op(clientA, 'claim', { requestId: id, question: 'Olvida este mensaje' });
      await op(clientA, 'reset');
      const result = await op(clientA, 'complete', { requestId: id, claimToken: claim.claimToken, answer: { id, title: 'Hola', message: 'Ya borrada', mode: 'guided', actions: [] } });
      assert.equal(result.code, 'stale_claim'); assert.equal((await op(clientA, 'read')).history.length, 0);
    });
    await t.test('reset erases notes/history/feedback without touching another client or preferences', async () => {
      await op(clientB, 'remember', { content: 'Solo B' });
      await op(clientA, 'reset');
      const a = await op(clientA, 'read'), b = await op(clientB, 'read');
      assert.equal(a.memories.length, 0); assert.equal(a.history.length, 0); assert.equal(a.helpful, 0); assert.equal(a.unhelpful, 0); assert.equal(a.style, 'concise');
      assert.equal(Number((await db.query("select count(*) as n from public.tc_client_leo_chat_requests where client_id=$1 and (question is not null or answer is not null or question_hash<>'' or feedback is not null)", [clientA])).rows[0].n), 0);
      assert.equal(b.memories[0].content, 'Solo B');
      const profileA = (await db.query('select * from public.tc_client_leo_profiles where client_id=$1', [clientA])).rows[0];
      assert.deepEqual(profileA.visit_counts, {}); assert.deepEqual(profileA.interest_scores, {}); assert.deepEqual(profileA.interaction_counts, {});
      assert.equal(profileA.last_path, null); assert.equal(profileA.last_seen_at, null); assert.equal(profileA.hidden, true); assert.equal(profileA.muted, true);
      assert.deepEqual((await db.query('select signal_seen_at from public.tc_client_leo_companion_state where client_id=$1', [clientA])).rows[0].signal_seen_at, {});
      assert.deepEqual((await db.query('select visit_counts from public.tc_client_leo_profiles where client_id=$1', [clientB])).rows[0].visit_counts, { ritual: 3 });
    });
  } finally { await db.close(); }
});
