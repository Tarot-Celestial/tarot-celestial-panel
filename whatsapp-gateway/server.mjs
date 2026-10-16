// Gateway de WhatsApp Web para el panel de centrales de Tarot Celestial.
//
// El panel (Next.js en Vercel) es serverless y no puede mantener abierta una
// sesión de WhatsApp Web. Este servicio sí: corre siempre encendido, guarda la
// sesión en disco y expone una pequeña API HTTP protegida con un secreto que
// solo conoce el backend del panel.
//
// Aviso: usa WhatsApp Web de forma no oficial (Baileys). WhatsApp puede
// bloquear números que lo usen, sobre todo con envíos masivos o automáticos.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import QRCode from "qrcode";
import pino from "pino";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  getContentType,
  makeCacheableSignalKeyStore,
  normalizeMessageContent,
  useMultiFileAuthState,
} from "baileys";
import { ChatStore, isGroup, isLid, isPn, normalizeJid, phoneFromJid } from "./store.mjs";

const PORT = Number(process.env.PORT || 8787);
const SECRET = String(process.env.WA_GATEWAY_SECRET || "").trim();
const DATA_DIR = path.resolve(process.env.WA_DATA_DIR || "./data");
const INCLUDE_GROUPS = /^(1|true|yes|si)$/i.test(String(process.env.WA_INCLUDE_GROUPS || ""));
const SEND_READ_RECEIPTS = !/^(0|false|no)$/i.test(String(process.env.WA_SEND_READ_RECEIPTS || "true"));
const MAX_MESSAGES_PER_CHAT = Math.max(50, Number(process.env.WA_MAX_MESSAGES_PER_CHAT || 300));
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

if (!SECRET || SECRET.length < 24) {
  console.error("Falta WA_GATEWAY_SECRET (mínimo 24 caracteres). Genera uno con: openssl rand -hex 32");
  process.exit(1);
}

const logger = pino({ level: process.env.WA_LOG_LEVEL || "warn" });
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

let cachedVersion = null;
async function waVersion() {
  if (cachedVersion && Date.now() - cachedVersion.at < 6 * 60 * 60 * 1000) return cachedVersion.version;
  try {
    const { version } = await fetchLatestBaileysVersion();
    cachedVersion = { version, at: Date.now() };
    return version;
  } catch {
    return undefined; // Baileys usa su versión por defecto.
  }
}

function toNumber(value) {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "object" && typeof value.toNumber === "function") return value.toNumber();
  return Number(value) || 0;
}

/** Convierte un mensaje de Baileys en texto legible para la bandeja. */
function describeContent(content) {
  const type = getContentType(content);
  if (!type) return null;
  const m = content[type] || {};
  switch (type) {
    case "conversation":
      return { kind: "text", text: String(content.conversation || "") };
    case "extendedTextMessage":
      return { kind: "text", text: String(m.text || "") };
    case "imageMessage":
      return { kind: "image", text: m.caption ? `📷 ${m.caption}` : "📷 Foto" };
    case "videoMessage":
      return { kind: "video", text: m.caption ? `🎬 ${m.caption}` : m.gifPlayback ? "🎬 GIF" : "🎬 Vídeo" };
    case "ptvMessage":
      return { kind: "video", text: "🎬 Videonota" };
    case "audioMessage":
      return { kind: "audio", text: m.ptt ? "🎤 Nota de voz" : "🎵 Audio" };
    case "documentMessage":
      return { kind: "document", text: `📄 ${m.fileName || m.title || "Documento"}${m.caption ? ` · ${m.caption}` : ""}` };
    case "stickerMessage":
      return { kind: "sticker", text: "🌟 Sticker" };
    case "locationMessage":
    case "liveLocationMessage":
      return { kind: "location", text: `📍 Ubicación${m.name ? `: ${m.name}` : ""}` };
    case "contactMessage":
      return { kind: "contact", text: `👤 Contacto: ${m.displayName || ""}`.trim() };
    case "contactsArrayMessage":
      return { kind: "contact", text: "👥 Contactos" };
    case "pollCreationMessage":
    case "pollCreationMessageV2":
    case "pollCreationMessageV3":
      return { kind: "poll", text: `📊 Encuesta: ${m.name || ""}`.trim() };
    case "buttonsResponseMessage":
      return { kind: "text", text: String(m.selectedDisplayText || "") };
    case "listResponseMessage":
      return { kind: "text", text: String(m.title || "") };
    case "templateButtonReplyMessage":
      return { kind: "text", text: String(m.selectedDisplayText || "") };
    case "eventMessage":
      return { kind: "text", text: `📅 Evento: ${m.name || ""}`.trim() };
    default:
      return null; // reacciones, claves de grupo, protocolos, etc.
  }
}

class WaSession {
  constructor(id) {
    this.id = id;
    this.dir = path.join(SESSIONS_DIR, id);
    this.authDir = path.join(this.dir, "auth");
    this.store = new ChatStore({
      file: path.join(this.dir, "store.json"),
      maxPerChat: MAX_MESSAGES_PER_CHAT,
      includeGroups: INCLUDE_GROUPS,
    });
    this.store.load();
    this.sock = null;
    this.state = "idle"; // idle | connecting | qr | connected
    this.reason = null; // qr_expired | logged_out | replaced | forbidden | error
    this.qr = null;
    this.me = null;
    this.retry = 0;
    this.stateRev = 0;
    this.starting = null;
    this.retryTimer = null;
    this.sentCache = new Map();
    this.historyProgress = null;
  }

  hasCreds() {
    return fs.existsSync(path.join(this.authDir, "creds.json"));
  }

  setState(state, extra = {}) {
    this.state = state;
    if ("reason" in extra) this.reason = extra.reason;
    if ("qr" in extra) this.qr = extra.qr;
    this.stateRev += 1;
  }

  status() {
    return {
      ok: true,
      session: this.id,
      state: this.state,
      reason: this.reason,
      qr: this.state === "qr" ? this.qr : null,
      me: this.state === "connected" ? this.me : null,
      historyProgress: this.historyProgress,
      rev: `${this.stateRev}.${this.store.rev}`,
    };
  }

  async start() {
    if (this.starting) return this.starting;
    if (this.sock && this.state !== "idle") return;
    this.starting = this.#open()
      .catch((error) => {
        this.#fail(error);
        throw error;
      })
      .finally(() => {
        this.starting = null;
      });
    return this.starting;
  }

  async #open() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.setState("connecting", { qr: null });
    fs.mkdirSync(this.authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const version = await waVersion();
    const sock = makeWASocket({
      ...(version ? { version } : {}),
      logger,
      browser: Browsers.macOS("Chrome"),
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      // No marcamos "en línea" para que el móvil siga recibiendo notificaciones.
      markOnlineOnConnect: false,
      // Solo el historial reciente: suficiente para la bandeja y mucho más ligero.
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      getMessage: async (key) => this.sentCache.get(key.id),
    });
    this.sock = sock;
    const current = () => this.sock === sock;

    sock.ev.process(async (events) => {
      if (!current()) return;

      if (events["creds.update"]) await saveCreds();

      if (events["connection.update"]) {
        const { connection, lastDisconnect, qr } = events["connection.update"];
        if (qr) {
          const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320, errorCorrectionLevel: "M" });
          if (current()) this.setState("qr", { qr: dataUrl, reason: null });
        }
        if (connection === "open") {
          const id = normalizeJid(sock.user?.id || "");
          this.me = {
            id,
            name: sock.user?.name || sock.user?.verifiedName || null,
            phone: phoneFromJid(id),
          };
          this.retry = 0;
          this.setState("connected", { qr: null, reason: null });
        }
        if (connection === "close") {
          await this.#handleClose(lastDisconnect?.error, state.creds);
        }
      }

      if (events["lid-mapping.update"]) {
        const { lid, pn } = events["lid-mapping.update"];
        this.store.addMapping(lid, pn);
      }

      if (events["messaging-history.set"]) {
        const { chats = [], contacts = [], messages = [], lidPnMappings = [], progress } = events["messaging-history.set"];
        for (const map of lidPnMappings) this.store.addMapping(map.lid, map.pn);
        for (const contact of contacts) this.store.setContact(contact);
        for (const chat of chats) {
          this.store.ensureChat(chat.id, {
            name: chat.name || undefined,
            unread: typeof chat.unreadCount === "number" ? chat.unreadCount : undefined,
            lastTs: toNumber(chat.conversationTimestamp),
          });
        }
        for (const msg of messages) this.#ingest(msg, { countUnread: false, resetOnOwn: false });
        this.historyProgress = typeof progress === "number" ? progress : this.historyProgress;
        this.store.touch();
      }

      if (events["contacts.upsert"]) for (const c of events["contacts.upsert"]) this.store.setContact(c);
      if (events["contacts.update"]) for (const c of events["contacts.update"]) this.store.setContact(c);

      if (events["chats.upsert"]) {
        for (const chat of events["chats.upsert"]) this.store.ensureChat(chat.id, { name: chat.name || undefined });
        this.store.touch();
      }
      if (events["chats.update"]) {
        for (const chat of events["chats.update"]) {
          // Si se leen los mensajes desde el móvil, el contador baja a 0 también aquí.
          if (chat.id && chat.unreadCount === 0) this.store.markRead(chat.id);
        }
      }
      if (events["chats.delete"]) for (const id of events["chats.delete"]) this.store.removeChat(id);

      if (events["messages.upsert"]) {
        const { messages, type } = events["messages.upsert"];
        for (const msg of messages) {
          const fromMe = Boolean(msg.key?.fromMe);
          this.#ingest(msg, { countUnread: type === "notify" && !fromMe, resetOnOwn: fromMe });
        }
      }

      if (events["messages.update"]) {
        for (const { key, update } of events["messages.update"]) {
          if (!key?.remoteJid || !key.id) continue;
          if (typeof update?.status === "number") this.store.updateStatus(key.remoteJid, key.id, update.status);
        }
      }
    });
  }

  async #handleClose(error, creds) {
    const code = error?.output?.statusCode;
    this.sock = null;
    const registered = Boolean(creds?.me?.id);

    if (code === DisconnectReason.loggedOut) {
      // Se cerró la sesión desde el móvil (o desde el panel): borramos todo.
      this.#wipe();
      this.setState("idle", { qr: null, reason: "logged_out" });
      return;
    }
    if (code === DisconnectReason.restartRequired) {
      // Normal justo después de escanear el QR: hay que reabrir la conexión.
      return void this.start().catch((e) => this.#fail(e));
    }
    if (!registered) {
      // El QR caducó sin que nadie lo escanease.
      this.setState("idle", { qr: null, reason: "qr_expired" });
      return;
    }
    if (code === DisconnectReason.connectionReplaced) {
      this.setState("idle", { qr: null, reason: "replaced" });
      return;
    }
    if (code === DisconnectReason.forbidden) {
      this.setState("idle", { qr: null, reason: "forbidden" });
      return;
    }
    this.retry += 1;
    if (this.retry > 8) {
      this.setState("idle", { qr: null, reason: "error" });
      return;
    }
    const delay = Math.min(30_000, 1000 * 2 ** this.retry);
    this.setState("connecting", { qr: null });
    this.retryTimer = setTimeout(() => this.start().catch((e) => this.#fail(e)), delay);
  }

  #fail(error) {
    logger.error({ err: error, session: this.id }, "fallo al iniciar la sesión");
    this.sock = null;
    this.setState("idle", { qr: null, reason: "error" });
  }

  #ingest(msg, opts) {
    const key = msg?.key;
    if (!key?.remoteJid || !key.id) return;
    const content = normalizeMessageContent(msg.message);
    if (!content) return;

    if (content.protocolMessage) {
      const proto = content.protocolMessage;
      const target = proto.key?.id;
      if (!target) return;
      if (proto.editedMessage) {
        const edited = describeContent(normalizeMessageContent(proto.editedMessage));
        if (edited) this.store.patchMessage(key.remoteJid, target, { text: edited.text, edited: true });
      } else if (toNumber(proto.type) === 0) {
        this.store.patchMessage(key.remoteJid, target, { text: "🚫 Mensaje eliminado", kind: "revoked" });
      }
      return;
    }

    const described = describeContent(content);
    if (!described || (!described.text && described.kind === "text")) return;

    this.store.addMessage(
      {
        id: key.id,
        chatJid: normalizeJid(key.remoteJid),
        altJid: key.remoteJidAlt ? normalizeJid(key.remoteJidAlt) : null,
        fromMe: Boolean(key.fromMe),
        ts: toNumber(msg.messageTimestamp),
        text: described.text,
        kind: described.kind,
        pushName: msg.pushName || null,
        status: typeof msg.status === "number" ? msg.status : null,
      },
      opts
    );
  }

  #wipe() {
    try {
      fs.rmSync(this.authDir, { recursive: true, force: true });
    } catch {}
    this.store.clear();
    this.me = null;
    this.sentCache.clear();
    this.historyProgress = null;
  }

  /** Cierra la sesión de WhatsApp en este dispositivo y deja listo un QR nuevo si se pide. */
  async logout({ restart = true } = {}) {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const sock = this.sock;
    this.sock = null; // los eventos del socket viejo dejan de aplicarse
    if (sock) {
      try {
        await sock.logout();
      } catch {}
      try {
        await sock.end(undefined);
      } catch {}
    }
    this.#wipe();
    this.setState("idle", { qr: null, reason: "logged_out" });
    if (restart) await this.start();
  }

  async shutdown() {
    const sock = this.sock;
    this.sock = null;
    if (sock) {
      try {
        await sock.end(undefined);
      } catch {}
    }
    this.store.saveNow();
  }

  requireConnected() {
    if (this.state !== "connected" || !this.sock) {
      const err = new Error("WhatsApp no está conectado");
      err.status = 409;
      err.code = "NOT_CONNECTED";
      throw err;
    }
  }

  async resolveTarget({ jid, phone }) {
    if (jid) {
      const target = this.store.canonical(String(jid));
      if (!isPn(target) && !isLid(target) && !(INCLUDE_GROUPS && isGroup(target))) throw badRequest("INVALID_JID");
      return target;
    }
    const digits = String(phone || "").replace(/\D/g, "").replace(/^00/, "");
    if (digits.length < 8 || digits.length > 15) throw badRequest("INVALID_PHONE");
    const [res] = (await this.sock.onWhatsApp(digits)) || [];
    if (!res?.exists) {
      const err = new Error("Ese número no tiene WhatsApp");
      err.status = 404;
      err.code = "NOT_ON_WHATSAPP";
      throw err;
    }
    return normalizeJid(res.jid);
  }

  async send({ jid, phone, text }) {
    this.requireConnected();
    const body = String(text || "").trim();
    if (!body) throw badRequest("EMPTY_TEXT");
    if (body.length > 4096) throw badRequest("TEXT_TOO_LONG");
    const target = await this.resolveTarget({ jid, phone });
    const sent = await this.sock.sendMessage(target, { text: body });
    if (sent?.key?.id) {
      this.sentCache.set(sent.key.id, sent.message);
      if (this.sentCache.size > 500) this.sentCache.delete(this.sentCache.keys().next().value);
      this.#ingest(sent, { countUnread: false, resetOnOwn: true });
    }
    const chatId = this.store.canonical(target);
    this.store.markRead(chatId);
    return { ok: true, chatId, messageId: sent?.key?.id || null };
  }

  async markRead(jid) {
    const chatId = this.store.canonical(String(jid || ""));
    const pending = this.store
      .getMessages(chatId, 50)
      .filter((m) => !m.fromMe)
      .slice(-Math.max(1, this.store.chats.get(chatId)?.unread || 0));
    this.store.markRead(chatId);
    if (SEND_READ_RECEIPTS && this.sock && this.state === "connected" && pending.length && !isGroup(chatId)) {
      try {
        await this.sock.readMessages(pending.map((m) => ({ remoteJid: chatId, id: m.id, fromMe: false })));
      } catch (error) {
        logger.warn({ err: error }, "no se pudo enviar el doble check azul");
      }
    }
    return { ok: true, chatId };
  }
}

function badRequest(code) {
  const err = new Error(code);
  err.status = 400;
  err.code = code;
  return err;
}

const sessions = new Map();
function getSession(id) {
  if (!SESSION_ID_RE.test(id)) throw badRequest("INVALID_SESSION_ID");
  let session = sessions.get(id);
  if (!session) {
    session = new WaSession(id);
    sessions.set(id, session);
  }
  return session;
}

function authorized(req) {
  const header = String(req.headers.authorization || "");
  const provided = header.startsWith("Bearer ") ? header.slice(7) : String(req.headers["x-gateway-key"] || "");
  const a = Buffer.from(provided);
  const b = Buffer.from(SECRET);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(badRequest("BODY_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(badRequest("INVALID_JSON"));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, { ok: true, sessions: sessions.size });
    }
    if (!authorized(req)) return send(res, 401, { ok: false, error: "UNAUTHORIZED" });
    if (parts[0] !== "sessions" || !parts[1]) return send(res, 404, { ok: false, error: "NOT_FOUND" });

    const session = getSession(parts[1]);
    const action = parts.slice(2);
    const route = `${req.method} ${action[0] || ""}${action[2] ? `/:jid/${action[2]}` : action[1] ? "/:jid" : ""}`;

    switch (route) {
      case "GET status":
        return send(res, 200, session.status());
      case "POST start":
        await session.start();
        return send(res, 200, session.status());
      case "POST logout": {
        const body = await readBody(req);
        await session.logout({ restart: body.restart !== false });
        return send(res, 200, session.status());
      }
      case "GET chats":
        return send(res, 200, { ok: true, rev: session.status().rev, chats: session.store.listChats() });
      case "GET chats/:jid/messages": {
        const limit = Number(url.searchParams.get("limit") || 100);
        const chatId = session.store.canonical(action[1]);
        return send(res, 200, {
          ok: true,
          chat: session.store.chats.get(chatId) || null,
          messages: session.store.getMessages(chatId, limit),
        });
      }
      case "POST chats/:jid/read":
        return send(res, 200, await session.markRead(action[1]));
      case "POST send": {
        const body = await readBody(req);
        return send(res, 200, await session.send(body));
      }
      default:
        return send(res, 404, { ok: false, error: "NOT_FOUND" });
    }
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) logger.error({ err: error }, "error en la petición");
    return send(res, status, { ok: false, error: error?.code || error?.message || "INTERNAL_ERROR" });
  }
});

// Al arrancar, reabrimos las sesiones que ya estaban vinculadas.
for (const id of fs.readdirSync(SESSIONS_DIR)) {
  if (!SESSION_ID_RE.test(id)) continue;
  const session = getSession(id);
  if (session.hasCreds()) session.start().catch((e) => logger.error({ err: e, session: id }, "no se pudo reanudar"));
}

server.listen(PORT, () => {
  console.log(`WhatsApp gateway escuchando en :${PORT} (datos en ${DATA_DIR})`);
});

async function shutdown(signal) {
  console.log(`${signal} recibido, guardando sesiones…`);
  server.close();
  await Promise.allSettled([...sessions.values()].map((s) => s.shutdown()));
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
