const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');

const account = { accountId: '38731579339820579', username: 'tarotcelestialof', token: 'NOT_A_REAL_TOKEN' };
const ownAlias = '17841411111111111', ownSecondAlias = '17841422222222222';
const customer = '14567890123456789', otherCustomer = '14567890987654321';
const own = { id: ownAlias, username: 'tarotcelestialof' }, person = { id: customer, username: 'synthetic_customer' };
class InstagramError extends Error {
  constructor(code, message, status = 503) { super(message); this.code = code; this.status = status; }
}
const graphId = value => typeof value === 'string' && /^[A-Za-z0-9_:.=-]{1,500}$/.test(value);
const replyWindowOpen = (date, hours) => Number.isFinite(Date.parse(date)) && Date.parse(date) <= Date.now() + 60000 && Date.now() - Date.parse(date) < hours * 3600000;
function load(file, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Date, Set, require(name) {
    if (name === 'server-only') return {};
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === './instagram-graph') return { InstagramError, graphId, replyWindowOpen };
    throw new Error(`Unexpected import: ${name}`);
  } });
  return exports;
}
const identity = () => load('src/lib/server/instagram-message-identity.ts').resolveMessageIdentity;

test('alternate own account id listed first is not selected as the recipient', () => {
  const result = identity()(account, [{ ...own, username: '  @TAROTCELESTIALOF  ' }, person], []);
  assert.equal(result.recipientId, customer);
  assert.equal(result.ownIds.has(account.accountId), true);
  assert.equal(result.ownIds.has(ownAlias), true);
  assert.equal(result.isOwnActor({ id: ownAlias }), true);
  assert.equal(result.isOwnActor(person), false);
});

test('participant order does not change recipient or own identity', () => {
  for (const participants of [[own, person], [person, own]]) {
    const result = identity()(account, participants, []);
    assert.equal(result.recipientId, customer);
    assert.equal(result.isOwnActor({ id: account.accountId }), true);
    assert.equal(result.isOwnActor({ id: ownAlias }), true);
  }
});

test('own aliases are learned from from/to actors before classifying messages lacking usernames', () => {
  const messages = [
    { from: { id: ownAlias }, to: { data: [person] } },
    { from: { ...own, username: '@TarotCelestialOf' }, to: { data: [person] } },
    { from: person, to: { data: [{ id: ownSecondAlias, username: 'tarotcelestialof' }] } },
    { from: { id: ownSecondAlias }, to: { data: [person] } },
  ];
  for (const order of [messages, [...messages].reverse()]) {
    const result = identity()(account, [], order);
    assert.equal(result.recipientId, customer);
    assert.equal(result.isOwnActor(messages[0].from), true);
    assert.equal(result.isOwnActor(messages[3].from), true);
    assert.equal(result.ownIds.has(ownSecondAlias), true);
  }
});

test('outgoing-only messages remain outgoing and cannot count as inbound activity', () => {
  const messages = [{ from: { id: ownAlias }, to: { data: [person] } }, { from: own, to: { data: [person] } }];
  const result = identity()(account, [own, person], messages);
  assert.equal(result.recipientId, customer);
  assert.equal(messages.filter(message => !result.isOwnActor(message.from)).length, 0);
});

test('only self or missing remote actors never provide a send recipient', () => {
  for (const participants of [[], [own], [{ id: account.accountId }], [own, { id: account.accountId }]]) {
    assert.equal(identity()(account, participants, []).recipientId, null);
  }
  assert.equal(identity()(account, [person], []).recipientId, null, 'A customer alone does not prove this is our conversation');
});

test('malformed or missing ids cannot become recipients even with a display username', () => {
  for (const bad of [null, undefined, '', '../messages', 'bad/id', 'bad id', { id: 'nested' }, 1234, NaN]) {
    const result = identity()(account, [own, { id: bad, username: 'synthetic_customer' }], []);
    assert.equal(result.recipientId, null, `Rejected malformed id ${String(bad)}`);
  }
  assert.equal(identity()(account, [own, { username: 'synthetic_customer' }], []).recipientId, null);
});

test('several distinct non-self identities produce an ambiguous recipient instead of picking one', () => {
  assert.equal(identity()(account, [own, person, { id: otherCustomer, username: 'other_customer' }], []).recipientId, null);
  assert.equal(identity()(account, [own, person], [{ from: { id: otherCustomer }, to: { data: [own] } }]).recipientId, null);
});

function inboxHarness({ participants = [own, person], messages = [], storedRecipient = ownAlias, detailErrors = {}, detailOverrides = {} } = {}) {
  const calls = [], writes = [], updates = [], rpcCalls = [];
  let row = { id: '00000000-0000-4000-8000-000000000001', account_id: account.accountId, kind: 'message', remote_id: 'conversation-1', recipient_id: storedRecipient, name: 'Old cached name', username: 'old_cached', preview: 'Abrir conversación', remote_updated_at: new Date().toISOString(), last_reply_at: null, private_reply_sent: false };
  const db = {
    from(table) {
      let patch;
      const query = {
        select: () => query, eq: () => query, in: () => query,
        update: value => { patch = value; updates.push(value); row = { ...row, ...value }; return query; },
        maybeSingle: async () => ({ data: table === 'tc_instagram_threads' ? row : null, error: null }),
        limit: async () => ({ data: [], error: null }),
        then: (resolve, reject) => Promise.resolve({ data: patch ? [row] : [], error: null }).then(resolve, reject),
        upsert(rows, options) {
          assert.equal(table, 'tc_instagram_threads'); writes.push({ rows, options });
          row = { ...row, ...rows[0] };
          return { select: async () => ({ data: [row], error: null }) };
        },
      };
      return query;
    },
    rpc: async name => { rpcCalls.push(name); assert.ok(['tc_instagram_claim_send', 'tc_instagram_finish_send'].includes(name)); return { data: {}, error: null }; },
  };
  const helper = load('src/lib/server/instagram-message-identity.ts');
  const mod = load('src/lib/server/instagram-inbox.ts', {
    '@/lib/supabase-admin': { supabaseAdmin: () => db },
    './instagram-message-identity': helper,
    './social-inbox-activity':{recordSocialActivity:async()=>{},socialSyncState:async()=>({cursor:{}}),socialThreadUnread:async()=>new Map()},
    './instagram-sync':{persistInstagramThreads:async()=>[],ownInstagramActor:(a,p)=>p?.id===a.accountId},
    './instagram-graph': {
      InstagramError, graphId, replyWindowOpen, instagramConnection: async () => account,
      instagramGraph: async (selected, resource, params, body) => {
        assert.equal(selected, account); calls.push({ resource, params, body });
        if (resource === `${account.accountId}/conversations`) return { data: [{ id: 'conversation-1', updated_time: new Date().toISOString(), participants: { data: participants } }] };
        if (resource === 'conversation-1') return { messages: { data: messages.map(message => ({ id: message.id })) } };
        if (Object.hasOwn(detailErrors, resource)) throw detailErrors[resource];
        if (Object.hasOwn(detailOverrides, resource)) return detailOverrides[resource];
        const detail = messages.find(message => message.id === resource);
        if (detail) return detail;
        if (resource === `${account.accountId}/messages` && body) return { message_id: 'message-synthetic-1' };
        throw new Error(`Unexpected Meta resource ${resource}`);
      },
    },
  });
  return { mod, calls, writes, updates, rpcCalls, id: row.id, currentRow: () => row };
}

test('outgoing-only live messages do not open the reply window despite a stale cached recipient', async () => {
  const h = inboxHarness({ storedRecipient: otherCustomer, messages: [
    { id: 'outbound-1', from: { id: ownAlias }, to: { data: [person] }, message: 'Synthetic outgoing', created_time: new Date().toISOString() },
    { id: 'outbound-2', from: own, to: { data: [person] }, message: 'Synthetic outgoing alias proof', created_time: new Date().toISOString() },
  ] });
  const result = await h.mod.instagramMessages(h.id);
  assert.equal(result.messages[0].fromMe, true);
  assert.equal(result.canReply, false);
  await assert.rejects(h.mod.instagramSend('synthetic-worker', { threadId: h.id, text: 'Do not send', replyMode: 'private', requestId: '00000000-0000-4000-8000-000000000003' }), error => error.code === 'REPLY_WINDOW_CLOSED');
  assert.equal(h.calls.filter(call => call.body).length, 0);
});

test('send destination is resolved from fresh Meta actors, never from a stale stored recipient', async () => {
  const h = inboxHarness({ storedRecipient: otherCustomer, messages: [{ id: 'inbound-2', from: person, to: { data: [own] }, created_time: new Date().toISOString() }] });
  await h.mod.instagramSend('synthetic-worker', { threadId: h.id, text: 'Synthetic test reply', replyMode: 'private', requestId: '00000000-0000-4000-8000-000000000004' });
  assert.equal(h.calls.find(call => call.body).body.recipient.id, customer);
});

test('stale cached recipient cannot permit sending when fresh actors are absent or ambiguous', async () => {
  for (const participants of [[], [own, person, { id: otherCustomer }]]) {
    const messages = participants.length ? [
      { id: 'group-inbound-1', from: person, to: { data: [own] }, created_time: new Date().toISOString() },
      { id: 'group-inbound-2', from: { id: otherCustomer }, to: { data: [own] }, created_time: new Date().toISOString() },
    ] : [];
    const h = inboxHarness({ participants, storedRecipient: customer, messages });
    const result = await h.mod.instagramMessages(h.id); assert.equal(result.canReply, false);
    await assert.rejects(h.mod.instagramSend('synthetic-worker', { threadId: h.id, text: 'Do not send', replyMode: 'private', requestId: '00000000-0000-4000-8000-000000000005' }), error => error.code === 'RECIPIENT_UNVERIFIED');
    assert.equal(h.calls.filter(call => call.body).length, 0);
  }
});

test('conversation retrieval follows IDs then details and fetches at most the latest twenty messages', async () => {
  const messages = Array.from({ length: 25 }, (_, index) => ({ id: `inbound-${index}`, from: person, to: { data: [own] }, message: `Synthetic ${index}`, created_time: new Date(Date.now() - index * 1000).toISOString() }));
  const h = inboxHarness({ messages });
  const result = await h.mod.instagramMessages(h.id);
  assert.equal(h.calls[0].resource, 'conversation-1');assert.equal(h.calls[0].params.fields, 'messages');
  const detailCalls = h.calls.filter(call => call.resource.startsWith('inbound-'));
  assert.equal(detailCalls.length, 20);assert.equal(result.messages.length, 20);assert.equal(result.canReply, true);
  assert.deepEqual(detailCalls.map(call => call.resource), messages.slice(0, 20).map(message => message.id));
  for (const call of detailCalls) assert.equal(call.params.fields, 'id,created_time,from,to,message');
});

test('a removed recent message preserves readable messages but blocks sends with incomplete history', async () => {
  for (const code of ['META_OBJECT_UNAVAILABLE', 'META_MESSAGE_UNAVAILABLE']) {
    const h = inboxHarness({ messages: [
      { id: 'available-1', from: person, to: { data: [own] }, message: 'Readable synthetic inbound', created_time: new Date().toISOString() },
      { id: 'removed-1' },
    ], detailErrors: { 'removed-1': new InstagramError(code, 'Unavailable synthetic message') } });
    const result = await h.mod.instagramMessages(h.id);
    assert.equal(result.messages.length, 1);assert.equal(result.messages[0].text, 'Readable synthetic inbound');
    assert.equal(result.canReply, false);assert.match(result.replyHint, /parte del historial/);
    await assert.rejects(h.mod.instagramSend('synthetic-worker', { threadId: h.id, text: 'Do not send', replyMode: 'private', requestId: '00000000-0000-4000-8000-000000000006' }), error => error.code === 'INCOMPLETE_HISTORY');
    assert.equal(h.calls.filter(call => call.body).length, 0);
  }
});

test('permission failures in message details remain visible instead of being treated as deleted content', async () => {
  const h = inboxHarness({ messages: [{ id: 'private-1' }], detailErrors: { 'private-1': new InstagramError('META_PERMISSION', 'Synthetic permission missing') } });
  await assert.rejects(h.mod.instagramMessages(h.id), error => error.code === 'META_PERMISSION');
});

test('HTTP 200 malformed message details mark history incomplete and cannot authorize a send beside valid inbound data', async () => {
  const valid = { id: 'malformed-1', from: person, to: { data: [own] }, created_time: new Date().toISOString() };
  const cases = [
    ['empty object', {}],
    ['id only', { id: valid.id }],
    ['different id', { ...valid, id: 'different-message' }],
    ['missing timestamp', { ...valid, created_time: undefined }],
    ['invalid timestamp', { ...valid, created_time: 'not-a-date' }],
    ['missing sender', { ...valid, from: undefined }],
    ['numeric sender id', { ...valid, from: { id: 12345 } }],
    ['malformed sender id', { ...valid, from: { id: 'wrong/id' } }],
    ['missing recipients', { ...valid, to: undefined }],
    ['non-array recipients', { ...valid, to: { data: own } }],
    ['empty recipients', { ...valid, to: { data: [] } }],
    ['malformed recipient id', { ...valid, to: { data: [own, { id: 'wrong/id' }] } }],
  ];
  for (const [label, malformed] of cases) {
    const h = inboxHarness({ messages: [
      { id: 'valid-inbound-1', from: person, to: { data: [own] }, message: 'Readable valid inbound', created_time: new Date().toISOString() },
      { id: valid.id },
    ], detailOverrides: { [valid.id]: malformed } });
    const result = await h.mod.instagramMessages(h.id);
    assert.equal(result.messages.length, 1, label);
    assert.equal(result.messages[0].id, 'valid-inbound-1', label);
    assert.equal(result.canReply, false, label);
    assert.equal(result.canPrivateReply, false, label);
    assert.match(result.replyHint, /parte del historial/, label);
    await assert.rejects(h.mod.instagramSend('synthetic-worker', { threadId: h.id, text: 'Do not send', replyMode: 'private', requestId: '00000000-0000-4000-8000-000000000007' }), error => error.code === 'INCOMPLETE_HISTORY', label);
    assert.equal(h.calls.filter(call => call.body).length, 0, label);
    assert.equal(h.rpcCalls.length, 0, label);
  }
});

test('an attachment without message text remains readable when identity and timestamp metadata are valid', async () => {
  const h = inboxHarness({ messages: [{ id: 'attachment-1', from: person, to: { data: [own] }, created_time: new Date().toISOString() }] });
  const result = await h.mod.instagramMessages(h.id);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].id, 'attachment-1');
  assert.equal(result.messages[0].text, '[Contenido adjunto: consúltalo en Instagram]');
  assert.equal(result.messages[0].fromMe, false);
  assert.equal(result.canReply, true);
  assert.equal(result.replyHint, null);
});
