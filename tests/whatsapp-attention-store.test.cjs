const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const { pathToFileURL } = require('node:url');
const load = () => import(pathToFileURL(path.join(__dirname, '../whatsapp-gateway/store.mjs')).href);
const chatId = '17875550123@s.whatsapp.net', otherId = '17875550124@s.whatsapp.net';
const ts = Date.parse('2026-10-22T19:00:00Z') / 1000;
const msg = (id, patch = {}) => ({ id, chatJid: chatId, fromMe: false, ts, text: 'PRIVATE-MESSAGE-BODY', kind: 'text', pushName: 'Fixture', ...patch });

test('attention reads total unread messages and latest inbound ID without bodies or store mutations', async () => {
  const { ChatStore } = await load(), store = new ChatStore();
  store.addMessage(msg('one'), { countUnread: true }); store.addMessage(msg('two', { ts: ts + 2 }), { countUnread: true });
  store.addMessage(msg('three', { chatJid: otherId }), { countUnread: true });
  const before = JSON.stringify(store.toJSON()), rev = store.rev;
  const summary = store.attentionSummary();
  assert.equal(summary.unread_total, 3); assert.equal(summary.unread_chats, 2);
  assert.equal(summary.items.find(item => item.id === chatId).last_incoming_id, 'two');
  assert.equal(summary.items.find(item => item.id === chatId).last_incoming_at, '2026-10-22T19:00:02.000Z');
  assert.equal(store.rev, rev); assert.equal(JSON.stringify(store.toJSON()), before);
  assert.doesNotMatch(JSON.stringify(summary), /PRIVATE|lastText|senderName|phone|text|qr|token/);
  assert.deepEqual(Object.keys(summary.items[0]).sort(), ['id', 'last_incoming_at', 'last_incoming_id', 'name', 'unread']);
});

test('duplicate notifications, history and outgoing messages do not inflate unread or invent inbound IDs', async () => {
  const { ChatStore } = await load(), store = new ChatStore();
  store.addMessage(msg('live'), { countUnread: true }); store.addMessage(msg('live'), { countUnread: true });
  store.addMessage(msg('historical', { ts: ts - 100 }), { countUnread: false, resetOnOwn: false });
  store.addMessage(msg('outgoing', { fromMe: true, ts: ts + 2 }), { countUnread: false, resetOnOwn: false });
  const summary = store.attentionSummary();
  assert.equal(summary.unread_total, 1); assert.equal(summary.items[0].last_incoming_id, 'live');
  store.addMessage(msg('sent-response', { fromMe: true, ts: ts + 3 }), { resetOnOwn: true });
  assert.deepEqual(store.attentionSummary(), { unread_total: 0, unread_chats: 0, items: [] });
});

test('history unread without stored messages stays visible and has a null arrival ID', async () => {
  const { ChatStore } = await load(), store = new ChatStore();
  store.ensureChat(chatId, { unread: 5 });
  assert.equal(store.listChats().length, 1);
  assert.deepEqual(store.attentionSummary(), { unread_total: 5, unread_chats: 1, items: [{ id: chatId, name: null, unread: 5, last_incoming_id: null, last_incoming_at: null }] });
  store.markRead(chatId);
  assert.deepEqual(store.attentionSummary(), { unread_total: 0, unread_chats: 0, items: [] });
});

test('two arrivals separated by reading remain distinguishable when their unread counts are equal', async () => {
  const { ChatStore } = await load(), store = new ChatStore();
  store.addMessage(msg('first'), { countUnread: true }); const first = store.attentionSummary();
  store.markRead(chatId); store.addMessage(msg('second', { ts: ts + 1 }), { countUnread: true }); const second = store.attentionSummary();
  assert.equal(first.unread_total, second.unread_total); assert.notEqual(first.items[0].last_incoming_id, second.items[0].last_incoming_id);
});

test('summary survives store persistence and leaves linked LID/phone identity canonical', async () => {
  const { ChatStore } = await load(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-attention-fixture-'));
  const file = path.join(dir, 'store.json'); let store;
  try {
    store = new ChatStore({ file }); store.addMessage(msg('lid-message', { chatJid: '120000000000@lid', altJid: chatId }), { countUnread: true });
    store.saveNow(); const reloaded = new ChatStore({ file }); reloaded.load();
    assert.deepEqual(reloaded.attentionSummary(), store.attentionSummary()); assert.equal(reloaded.attentionSummary().items[0].id, chatId);
  } finally { clearTimeout(store?.saveTimer); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('large summaries retain every unread conversation within bridge payload limits', async () => {
  const { ChatStore } = await load(), store = new ChatStore();
  for (let i = 0; i < 1500; i++) store.ensureChat(`1787555${String(i).padStart(4, '0')}@s.whatsapp.net`, { name: '✨'.repeat(80), unread: 1 });
  const summary = store.attentionSummary();
  assert.equal(summary.unread_total, 1500); assert.equal(summary.items.length, 1500);
  assert.ok(summary.items.every(item => item.name === null)); assert.ok(Buffer.byteLength(JSON.stringify(summary)) < 448 * 1024);
});

test('invalid counts fail instead of converting uncertainty into zero unread', async () => {
  const { ChatStore } = await load();
  for (const unread of [1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, -1]) {
    const store = new ChatStore(); store.ensureChat(chatId, { lastTs: ts }); store.chats.get(chatId).unread = unread;
    assert.throws(() => store.attentionSummary(), /INVALID_UNREAD_COUNT/);
  }
});
