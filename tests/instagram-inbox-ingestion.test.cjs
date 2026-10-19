const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

class InstagramError extends Error {
  constructor(code, message, status = 503) { super(message); this.code = code; this.status = status; }
}

const post = { id: 'post-1', permalink: 'https://www.instagram.com/p/example/', timestamp: '2026-10-19T12:00:00Z', comments_count: 1 };
const comment = { id: 'comment-1', text: '❤️❤️', timestamp: '2026-10-19T18:30:00+0000', from: { id: 'person-1', username: 'test_commenter' } };

function harness(responses) {
  const calls = [], writes = [];
  const account = { accountId: 'account-1', username: 'tarotcelestialof', token: 'NOT_A_REAL_TOKEN' };
  const db = { from(table) {
    assert.equal(table, 'tc_instagram_threads');
    return { upsert(rows, options) {
      writes.push({ rows, options });
      return { select: async () => ({ data: rows.map((row, index) => ({ ...row, id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` })), error: null }) };
    } };
  } };
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/server/instagram-inbox.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, Date, require(name) {
    if (name === 'server-only') return {};
    if (name === '@/lib/supabase-admin') return { supabaseAdmin: () => db };
    if (name === './instagram-graph') return {
      InstagramError,
      instagramConnection: async () => account,
      instagramGraph: async (requestedAccount, resource, params) => {
        assert.equal(requestedAccount, account); calls.push({ resource, params });
        assert.ok(Object.hasOwn(responses, resource), `Unexpected Meta resource: ${resource}`);
        const result = responses[resource];
        if (result instanceof Error) throw result;
        return result;
      },
    };
    throw new Error(`Unexpected import: ${name}`);
  } });
  return { calls, writes, inbox: cursor => exports.instagramInbox('comment', cursor || null) };
}

test('real inbox ingestion persists and presents emoji-only comments with author, date and publication link', async () => {
  const h = harness({ 'account-1/media': { data: [post] }, 'post-1/comments': { data: [comment] } });
  const result = await h.inbox();
  assert.equal(result.threads.length, 1); assert.equal(h.writes.length, 1);
  const saved = h.writes[0].rows[0], shown = result.threads[0];
  assert.equal(saved.account_id, 'account-1'); assert.equal(saved.remote_id, 'comment-1'); assert.equal(saved.recipient_id, 'person-1');
  assert.equal(saved.preview, '❤️❤️'); assert.equal(saved.remote_created_at, '2026-10-19T18:30:00.000Z');
  assert.equal(shown.preview, '❤️❤️'); assert.equal(shown.username, 'test_commenter'); assert.equal(shown.name, 'test_commenter');
  assert.equal(shown.permalink, post.permalink); assert.equal(shown.updatedAt, saved.remote_created_at); assert.equal(shown.kind, 'comment');
  assert.equal(h.writes[0].options.onConflict, 'account_id,kind,remote_id');
  assert.ok(h.calls[0].params.fields.split(',').includes('comments_count'));
  assert.equal(result.partialHint, null);
});

test('a positive comments_count with empty comments reports the discrepancy without inventing records or a cause', async () => {
  const h = harness({ 'account-1/media': { data: [post] }, 'post-1/comments': { data: [] } });
  const result = await h.inbox();
  assert.equal(result.threads.length, 0); assert.equal(h.writes.length, 0);
  assert.equal(result.partialHint, 'Instagram indica comentarios en algunas publicaciones, pero no los ha devuelto. Administración debe revisar la conexión de Meta.');
  assert.equal(result.connection.ready, true);
});

test('zero or unavailable comment counts with empty data remain a valid empty result', async () => {
  for (const comments_count of [0, undefined]) {
    const h = harness({ 'account-1/media': { data: [{ ...post, comments_count }] }, 'post-1/comments': { data: [] } });
    const result = await h.inbox();
    assert.equal(result.threads.length, 0); assert.equal(result.partialHint, null); assert.equal(h.writes.length, 0);
  }
});

test('missing or malformed media data rejects safely instead of returning a fake empty inbox', async () => {
  for (const response of [{}, { data: null }, { data: {} }, { data: 'PRIVATE_REMOTE_CONTENT' }]) {
    const h = harness({ 'account-1/media': response });
    await assert.rejects(h.inbox(), error => error.code === 'META_INVALID_RESPONSE' && !error.message.includes('PRIVATE_REMOTE_CONTENT'));
    assert.equal(h.calls.length, 1); assert.equal(h.writes.length, 0);
  }
});

test('missing or malformed comment data rejects safely instead of claiming there are no comments', async () => {
  for (const response of [{}, { data: null }, { data: {} }, { data: 'PRIVATE_REMOTE_CONTENT' }]) {
    const h = harness({ 'account-1/media': { data: [post] }, 'post-1/comments': response });
    await assert.rejects(h.inbox(), error => error.code === 'META_INVALID_RESPONSE' && !error.message.includes('PRIVATE_REMOTE_CONTENT'));
    assert.equal(h.writes.length, 0);
  }
});

test('genuine empty media pages preserve the continuation cursor and do not fabricate comments', async () => {
  const h = harness({ 'account-1/media': { data: [], paging: { next: 'https://graph.instagram.com/next', cursors: { after: 'next-page' } } } });
  const result = await h.inbox('prior-page');
  assert.equal(result.threads.length, 0); assert.equal(result.nextCursor, 'next-page'); assert.equal(result.partialHint, null);
  assert.equal(h.calls[0].params.after, 'prior-page'); assert.equal(h.writes.length, 0);
});

test('a missing-comment warning survives other publication pagination hints while valid comments remain usable', async () => {
  const h = harness({
    'account-1/media': { data: [post, { ...post, id: 'post-2', comments_count: 51 }] },
    'post-1/comments': { data: [] },
    'post-2/comments': { data: [comment], paging: { next: 'https://graph.instagram.com/next' } },
  });
  const result = await h.inbox();
  assert.equal(result.threads.length, 1); assert.ok(result.partialHint.includes('Instagram indica comentarios'));
});
