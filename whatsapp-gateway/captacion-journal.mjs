import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const OPERATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PHONE_RE = /^[1-9]\d{7,14}$/;
const RANK = { sending: 0, unknown: 1, accepted: 2, failed: 3, delivered: 4, read: 5 };

export function gatewayError(code, status = 500) {
  return Object.assign(new Error(code), { code, status });
}

function operationKey(value) {
  if (typeof value !== "string" || !OPERATION_ID_RE.test(value)) throw gatewayError("INVALID_OPERATION_ID", 400);
  return value.toLowerCase();
}

/** A receipt never includes the client's phone, name, or the request fingerprint. */
export function publicReceipt(record, instanceId, duplicate = false) {
  return {
    ok: true,
    operationId: record.operationId,
    status: record.status === "sending" && record.instanceId !== instanceId ? "unknown" : record.status,
    duplicate,
    messageId: record.messageId,
    chatId: record.chatId,
    sender: record.sender,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * A claim is fsynced BEFORE invoking WhatsApp. It is outside the session/auth
 * directories, so logout, a lost HTTP response, and a restart cannot re-send it.
 * Corrupt/incomplete files fail closed: they are never treated as missing.
 */
export class CaptacionJournal {
  constructor(directory, { filesystem = fs, now = () => new Date(), instanceId = crypto.randomUUID() } = {}) {
    this.directory = path.resolve(directory);
    this.fs = filesystem;
    this.now = now;
    this.instanceId = instanceId;
    this.byMessage = new Map();
    try {
      this.fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      for (const filename of this.fs.readdirSync(this.directory)) {
        if (!filename.endsWith(".json")) continue;
        const id = filename.slice(0, -5);
        if (!OPERATION_ID_RE.test(id)) continue;
        // An interrupted claim is retained and blocks that operation on lookup.
        // It must not disable unrelated chat/QR sessions on the whole gateway.
        try { this.#index(this.#read(id)); } catch {}
      }
    } catch {
      throw gatewayError("JOURNAL_UNAVAILABLE");
    }
  }

  #filename(id) { return path.join(this.directory, `${operationKey(id)}.json`); }

  #read(id) {
    try {
      const record = JSON.parse(this.fs.readFileSync(this.#filename(id), "utf8"));
      if (record.version !== 1 || record.operationId !== operationKey(id)
          || !SESSION_ID_RE.test(record.sessionId) || !PHONE_RE.test(record.sender)
          || !/^[a-f0-9]{64}$/.test(record.fingerprint) || !Object.hasOwn(RANK, record.status)
          || typeof record.messageId !== "string" || !record.messageId
          || typeof record.chatId !== "string" || !record.chatId
          || !Number.isFinite(Date.parse(record.createdAt)) || !Number.isFinite(Date.parse(record.updatedAt))
          || typeof record.instanceId !== "string") throw gatewayError("JOURNAL_UNAVAILABLE");
      return record;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw gatewayError("JOURNAL_UNAVAILABLE");
    }
  }

  #index(record) {
    if (record) this.byMessage.set(`${record.sessionId}:${record.sender}:${record.messageId}`, record.operationId);
  }

  #syncDirectory() {
    let fd;
    try {
      fd = this.fs.openSync(this.directory, "r");
      this.fs.fsyncSync(fd);
    } catch (error) {
      // Windows does not expose fsync on directory handles through Node. The
      // claim file itself is always fsynced on every supported platform.
      if (process.platform !== "win32" || !["EPERM", "EACCES", "EINVAL", "EISDIR", "EBADF"].includes(error?.code)) throw error;
    } finally {
      if (fd !== undefined) this.fs.closeSync(fd);
    }
  }

  #writeFile(filename, record) {
    const fd = this.fs.openSync(filename, "wx", 0o600);
    try {
      this.fs.writeFileSync(fd, `${JSON.stringify(record)}\n`, "utf8");
      this.fs.fsyncSync(fd);
    } finally { this.fs.closeSync(fd); }
  }

  lookup(sessionId, operationId, fingerprint) {
    const record = this.#read(operationId);
    if (!record) return null;
    if (record.sessionId !== sessionId || (fingerprint && fingerprint !== record.fingerprint)) {
      throw gatewayError("OPERATION_CONFLICT", 409);
    }
    return publicReceipt(record, this.instanceId, true);
  }

  claim({ sessionId, operationId, fingerprint, sender, chatId, messageId }) {
    operationId = operationKey(operationId);
    if (!SESSION_ID_RE.test(sessionId) || !PHONE_RE.test(sender) || !/^[a-f0-9]{64}$/.test(fingerprint)
        || typeof chatId !== "string" || !chatId || typeof messageId !== "string" || !messageId) {
      throw gatewayError("INVALID_CLAIM", 400);
    }
    const at = this.now().toISOString();
    const record = {
      version: 1, operationId, sessionId, fingerprint, sender, chatId, messageId,
      status: "sending", instanceId: this.instanceId, createdAt: at, updatedAt: at,
    };
    try {
      this.#writeFile(this.#filename(operationId), record);
      this.#syncDirectory();
      this.#index(record);
      return { claimed: true, receipt: publicReceipt(record, this.instanceId) };
    } catch (error) {
      if (error?.code === "EEXIST") return { claimed: false, receipt: this.lookup(sessionId, operationId, fingerprint) };
      throw gatewayError("JOURNAL_UNAVAILABLE");
    }
  }

  setStatus(operationId, status) {
    if (!Object.hasOwn(RANK, status)) throw gatewayError("INVALID_RECEIPT_STATUS", 400);
    const record = this.#read(operationId);
    if (!record) throw gatewayError("OPERATION_NOT_FOUND", 404);
    if (RANK[status] <= RANK[record.status]) return publicReceipt(record, this.instanceId);
    const next = { ...record, status, updatedAt: this.now().toISOString() };
    const temp = `${this.#filename(operationId)}.${crypto.randomUUID()}.tmp`;
    try {
      this.#writeFile(temp, next);
      this.fs.renameSync(temp, this.#filename(operationId));
      this.#syncDirectory();
      return publicReceipt(next, this.instanceId);
    } catch {
      // A failed update leaves the original claim in place; never release it.
      try { this.fs.unlinkSync(temp); } catch {}
      throw gatewayError("JOURNAL_UNAVAILABLE");
    }
  }

  updateProviderReceipt({ sessionId, sender, messageId, chatId, status }) {
    const operationId = this.byMessage.get(`${sessionId}:${sender}:${messageId}`);
    if (!operationId) return null;
    const record = this.#read(operationId);
    if (!record || record.chatId !== chatId) return null;
    return this.setStatus(operationId, status);
  }
}

export function statusFromWhatsApp(value) {
  return ({ 0: "failed", 1: "sending", 2: "accepted", 3: "delivered", 4: "read", 5: "read" })[value] || null;
}
