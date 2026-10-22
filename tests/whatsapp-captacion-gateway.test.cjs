const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const modules = Promise.all([
  import(pathToFileURL(path.join(root, "whatsapp-gateway/captacion-journal.mjs"))),
  import(pathToFileURL(path.join(root, "whatsapp-gateway/captacion-sender.mjs"))),
]);
const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function fixture(t, options = {}) {
  const [journalModule, senderModule] = await modules;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tc-wa-outbox-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const journal = new journalModule.CaptacionJournal(directory, options.journalOptions);
  const calls = [];
  const session = {
    id: "celestial", state: "connected", me: { phone: "17870000000" },
    sock: {
      onWhatsApp: async (phone) => [{ exists: true, jid: `${phone}@s.whatsapp.net` }],
      sendMessage: async (jid, content, sendOptions) => {
        calls.push({ jid, content, options: sendOptions });
        return { key: { id: sendOptions.messageId, remoteJid: jid, fromMe: true }, message: {} };
      },
    },
  };
  const command = { operationId: crypto.randomUUID(), phone: "+17871111111", name: "Clienta Ejemplo", expectedSender: "+17870000000" };
  const send = senderModule.createCaptacionSender({ journal, imageLoader: () => image, ...options.senderOptions });
  return { journal, session, command, calls, directory, send, ...journalModule, ...senderModule };
}

test("sends the fixed approved image and exactly the panel's canonical personalized caption", async (t) => {
  const f = await fixture(t);
  const source = fs.readFileSync(path.join(root, "src/lib/captacion-whatsapp.ts"), "utf8");
  const exports = {};
  vm.runInNewContext(ts.transpile(source, { module: ts.ModuleKind.CommonJS }), { exports, require: () => ({}) });
  const result = await f.send(f.session, f.command);
  assert.equal(result.status, "accepted");
  assert.equal(result.duplicate, false);
  assert.equal(result.sender, "17870000000");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].content.image, image);
  assert.equal(f.calls[0].content.caption, exports.buildCaptacionMessage({ id: "fixture", cliente: { nombre: f.command.name } }));
  assert.equal(f.calls[0].options.messageId, result.messageId);
  assert.match(result.messageId, /^3EB0[A-F0-9]{18}$/);
  assert.equal(f.readCaptacionImage().subarray(0, 8).equals(image), true);
});

test("concurrent double clicks and subsequent retries invoke WhatsApp exactly once", async (t) => {
  const f = await fixture(t);
  const results = await Promise.all([f.send(f.session, f.command), f.send(f.session, f.command)]);
  assert.equal(f.calls.length, 1);
  assert.equal(results.filter((r) => r.duplicate).length, 1);
  assert.equal((await f.send(f.session, f.command)).duplicate, true);
  assert.equal(f.calls.length, 1);
});

test("operation deduplication survives restart, unlink, and account disconnection", async (t) => {
  const f = await fixture(t);
  const original = await f.send(f.session, f.command);
  const restarted = new f.CaptacionJournal(f.directory);
  f.session.state = "idle";
  f.session.sock = null;
  f.session.me = null;
  const send = f.createCaptacionSender({ journal: restarted, imageLoader: () => { throw Error("should not load"); } });
  const result = await send(f.session, f.command);
  assert.equal(result.status, "accepted");
  assert.equal(result.messageId, original.messageId);
  assert.equal(f.calls.length, 1);
});

test("changing recipient, name, sender, or session cannot reuse a claimed operation", async (t) => {
  const f = await fixture(t);
  await f.send(f.session, f.command);
  for (const change of [{ phone: "+17872222222" }, { name: "Otro destino" }, { expectedSender: "+17873333333" }]) {
    await assert.rejects(f.send(f.session, { ...f.command, ...change }), { code: "OPERATION_CONFLICT", status: 409 });
  }
  assert.throws(() => f.journal.lookup("otro", f.command.operationId), { code: "OPERATION_CONFLICT" });
  assert.equal(f.calls.length, 1);
});

test("sender mismatch, disconnect, invalid command, and unknown recipient do not claim or send", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.send(f.session, { ...f.command, expectedSender: "+17874444444" }), { code: "SENDER_CHANGED" });
  for (const change of [{ phone: "7871111111" }, { operationId: "../../bad" }, { text: "arbitrary" }, { mediaUrl: "https://other.test" }, { name: "Bad\nname" }]) {
    await assert.rejects(f.send(f.session, { ...f.command, ...change }), (error) => error.status === 400);
  }
  f.session.sock.onWhatsApp = async () => [{ exists: false }];
  await assert.rejects(f.send(f.session, f.command), { code: "NOT_ON_WHATSAPP" });
  f.session.state = "idle";
  await assert.rejects(f.send(f.session, f.command), { code: "NOT_CONNECTED" });
  assert.equal(f.journal.lookup(f.session.id, f.command.operationId), null);
  assert.equal(f.calls.length, 0);
});

test("account change during recipient lookup prevents the send", async (t) => {
  const f = await fixture(t);
  f.session.sock.onWhatsApp = async (phone) => {
    f.session.me.phone = "17874444444";
    return [{ exists: true, jid: `${phone}@s.whatsapp.net` }];
  };
  await assert.rejects(f.send(f.session, f.command), { code: "SENDER_CHANGED" });
  assert.equal(f.journal.lookup(f.session.id, f.command.operationId), null);
  assert.equal(f.calls.length, 0);
});

test("fsync failure before send leaves a blocking claim and never invokes WhatsApp", async (t) => {
  const f = await fixture(t);
  const disk = Object.create(fs);
  disk.fsyncSync = () => { throw Object.assign(Error("disk failure"), { code: "EIO" }); };
  const journal = new f.CaptacionJournal(f.directory, { filesystem: disk });
  const send = f.createCaptacionSender({ journal, imageLoader: () => image });
  await assert.rejects(send(f.session, f.command), { code: "JOURNAL_UNAVAILABLE" });
  assert.equal(f.calls.length, 0);
  const restarted = new f.CaptacionJournal(f.directory);
  assert.equal(restarted.lookup(f.session.id, f.command.operationId).status, "unknown");
  const retry = f.createCaptacionSender({ journal: restarted, imageLoader: () => image });
  assert.equal((await retry(f.session, f.command)).status, "unknown");
  assert.equal(f.calls.length, 0);
});

test("corrupt journal cannot be treated as a new operation", async (t) => {
  const f = await fixture(t);
  fs.writeFileSync(path.join(f.directory, `${f.command.operationId}.json`), "{truncated");
  await assert.rejects(f.send(f.session, f.command), { code: "JOURNAL_UNAVAILABLE" });
  const restarted = new f.CaptacionJournal(f.directory);
  assert.throws(() => restarted.lookup(f.session.id, f.command.operationId), { code: "JOURNAL_UNAVAILABLE" });
  assert.equal(f.calls.length, 0);
});

test("provider throws after invocation: unknown blocks all retries, including after restart", async (t) => {
  const f = await fixture(t);
  let sends = 0;
  f.session.sock.sendMessage = async () => { sends++; throw Error("connection lost after relay"); };
  assert.equal((await f.send(f.session, f.command)).status, "unknown");
  const restarted = new f.CaptacionJournal(f.directory);
  const retry = f.createCaptacionSender({ journal: restarted, imageLoader: () => image });
  assert.equal((await retry(f.session, f.command)).status, "unknown");
  assert.equal(sends, 1);
});

test("timeout returns unknown and a late server acknowledgement updates the durable receipt", async (t) => {
  const f = await fixture(t, { senderOptions: { timeoutMs: 5 } });
  let finish;
  let sends = 0;
  f.session.sock.sendMessage = (jid, _content, options) => {
    sends++;
    return new Promise((resolve) => { finish = () => resolve({ key: { id: options.messageId, remoteJid: jid } }); });
  };
  assert.equal((await f.send(f.session, f.command)).status, "unknown");
  assert.equal((await f.send(f.session, f.command)).status, "unknown");
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.journal.lookup(f.session.id, f.command.operationId).status, "accepted");
  assert.equal(sends, 1);
});

test("delivery/read receipts are scoped to the sender and recipient and never regress", async (t) => {
  const f = await fixture(t);
  const accepted = await f.send(f.session, f.command);
  const args = { sessionId: f.session.id, sender: accepted.sender, messageId: accepted.messageId, chatId: accepted.chatId };
  assert.equal(f.journal.updateProviderReceipt({ ...args, sender: "17874444444", status: "read" }), null);
  assert.equal(f.journal.updateProviderReceipt({ ...args, chatId: "17872222222@s.whatsapp.net", status: "read" }), null);
  assert.equal(f.journal.updateProviderReceipt({ ...args, status: "delivered" }).status, "delivered");
  assert.equal(f.journal.updateProviderReceipt({ ...args, status: "accepted" }).status, "delivered");
  assert.equal(f.journal.updateProviderReceipt({ ...args, status: "read" }).status, "read");
  assert.equal(f.journal.updateProviderReceipt({ ...args, status: "failed" }).status, "read");
  const restarted = new f.CaptacionJournal(f.directory);
  assert.equal(restarted.lookup(f.session.id, f.command.operationId).status, "read");
  assert.deepEqual([0, 1, 2, 3, 4, 5, 99].map(f.statusFromWhatsApp), ["failed", "sending", "accepted", "delivered", "read", "read", null]);
});

test("delivery receipt can precede sendMessage completion without being overwritten", async (t) => {
  const f = await fixture(t);
  f.session.sock.sendMessage = async (jid, _content, options) => {
    f.journal.updateProviderReceipt({ sessionId: f.session.id, sender: f.session.me.phone,
      messageId: options.messageId, chatId: jid, status: "delivered" });
    return { key: { id: options.messageId, remoteJid: jid } };
  };
  assert.equal((await f.send(f.session, f.command)).status, "delivered");
});

test("missing image or provider lookup failure never creates a claim", async (t) => {
  const f = await fixture(t, { senderOptions: { imageLoader: () => { throw Object.assign(Error(), { code: "IMAGE_UNAVAILABLE" }); } } });
  await assert.rejects(f.send(f.session, f.command), { code: "IMAGE_UNAVAILABLE" });
  const send = f.createCaptacionSender({ journal: f.journal, imageLoader: () => image });
  f.session.sock.onWhatsApp = async () => { throw Error("temporary network failure"); };
  await assert.rejects(send(f.session, f.command), { code: "RECIPIENT_LOOKUP_FAILED" });
  assert.equal(f.journal.lookup(f.session.id, f.command.operationId), null);
  assert.equal(f.calls.length, 0);
});

test("failed receipt update after invocation remains blocked and is reported as unknown", async (t) => {
  const f = await fixture(t);
  const setStatus = f.journal.setStatus.bind(f.journal);
  f.journal.setStatus = () => { throw Error("disk full"); };
  assert.equal((await f.send(f.session, f.command)).status, "unknown");
  assert.equal((await f.send(f.session, f.command)).duplicate, true);
  assert.equal(f.calls.length, 1);
  f.journal.setStatus = setStatus;
});
