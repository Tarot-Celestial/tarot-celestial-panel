// Almacén ligero de chats y mensajes para una sesión de WhatsApp.
// Baileys v7 ya no trae "makeInMemoryStore", así que guardamos aquí lo que
// necesita el panel (bandeja de chats + últimos mensajes de cada chat) y lo
// persistimos en disco para que sobreviva a reinicios del servicio.

import fs from "node:fs";
import path from "node:path";

const PN_SUFFIX = "@s.whatsapp.net";
const LID_SUFFIX = "@lid";

export function isPn(jid) {
  return typeof jid === "string" && jid.endsWith(PN_SUFFIX);
}

export function isLid(jid) {
  return typeof jid === "string" && jid.endsWith(LID_SUFFIX);
}

export function isGroup(jid) {
  return typeof jid === "string" && jid.endsWith("@g.us");
}

/** Quita el sufijo de dispositivo (":12") de un JID de usuario. */
export function normalizeJid(jid) {
  if (typeof jid !== "string" || !jid.includes("@")) return jid || "";
  const [user, server] = jid.split("@");
  return `${user.split(":")[0]}@${server}`;
}

export function phoneFromJid(jid) {
  return isPn(jid) ? jid.split("@")[0] : null;
}

export class ChatStore {
  constructor({ file, maxPerChat = 300, maxChats = 1500, includeGroups = false } = {}) {
    this.file = file;
    this.maxPerChat = maxPerChat;
    this.maxChats = maxChats;
    this.includeGroups = includeGroups;
    this.saveTimer = null;
    this.clear(false);
  }

  clear(save = true) {
    this.chats = new Map();
    this.messages = new Map();
    this.lidToPn = new Map();
    this.names = new Map();
    this.rev = (this.rev || 0) + 1;
    if (save) this.scheduleSave(0);
  }

  touch() {
    this.rev += 1;
    this.scheduleSave();
  }

  /** Permite este JID en la bandeja (descarta estados, newsletters, difusiones y, opcionalmente, grupos). */
  accepts(jid) {
    if (!jid || typeof jid !== "string") return false;
    if (jid === "status@broadcast" || jid.endsWith("@broadcast") || jid.endsWith("@newsletter")) return false;
    if (isGroup(jid)) return this.includeGroups;
    return isPn(jid) || isLid(jid);
  }

  canonical(jid) {
    const normalized = normalizeJid(jid);
    return this.lidToPn.get(normalized) || normalized;
  }

  /** Registra que un LID corresponde a un número y fusiona los dos chats si existían por separado. */
  addMapping(lid, pn) {
    const l = normalizeJid(lid);
    const p = normalizeJid(pn);
    if (!isLid(l) || !isPn(p) || this.lidToPn.get(l) === p) return;
    this.lidToPn.set(l, p);

    const lidChat = this.chats.get(l);
    if (lidChat) {
      const pnChat = this.chats.get(p);
      const merged = {
        ...lidChat,
        ...(pnChat || {}),
        id: p,
        phone: phoneFromJid(p),
        name: pnChat?.name || lidChat.name || null,
        unread: (pnChat?.unread || 0) + (lidChat.unread || 0),
      };
      const lastSource = !pnChat || (lidChat.lastTs || 0) > (pnChat.lastTs || 0) ? lidChat : pnChat;
      merged.lastTs = lastSource.lastTs;
      merged.lastText = lastSource.lastText;
      merged.lastFromMe = lastSource.lastFromMe;
      this.chats.delete(l);
      this.chats.set(p, merged);

      const all = [...(this.messages.get(p) || []), ...(this.messages.get(l) || [])];
      const byId = new Map(all.map((m) => [m.id, m]));
      this.messages.delete(l);
      this.messages.set(p, [...byId.values()].sort((a, b) => a.ts - b.ts).slice(-this.maxPerChat));
    }
    if (this.names.has(l) && !this.names.has(p)) this.names.set(p, this.names.get(l));
    this.touch();
  }

  setContact(contact) {
    if (!contact) return;
    const id = normalizeJid(contact.id || "");
    const lid = normalizeJid(contact.lid || (isLid(id) ? id : ""));
    const pn = normalizeJid(contact.phoneNumber || (isPn(id) ? id : ""));
    if (lid && pn) this.addMapping(lid, pn);

    const name = contact.name || contact.verifiedName || contact.notify || null;
    if (!name) return;
    const key = this.canonical(id || pn || lid);
    if (!key) return;
    // Un nombre guardado en la agenda (name) manda sobre el que se pone la persona (notify).
    const savedName = Boolean(contact.name);
    const current = this.names.get(key);
    if (current && current.saved && !savedName) return;
    this.names.set(key, { name, saved: savedName });
    const chat = this.chats.get(key);
    if (chat && chat.name !== name) {
      chat.name = name;
      this.touch();
    }
  }

  displayName(jid, fallback = null) {
    return this.names.get(jid)?.name || fallback || null;
  }

  ensureChat(rawJid, extra = {}) {
    const id = this.canonical(rawJid);
    if (!this.accepts(id)) return null;
    let chat = this.chats.get(id);
    if (!chat) {
      chat = {
        id,
        phone: phoneFromJid(id),
        isGroup: isGroup(id),
        name: this.displayName(id),
        lastTs: 0,
        lastText: "",
        lastFromMe: false,
        unread: 0,
      };
      this.chats.set(id, chat);
    }
    if (extra.name && (!chat.name || chat.isGroup)) chat.name = extra.name;
    if (typeof extra.unread === "number" && extra.unread >= 0) chat.unread = extra.unread;
    if (extra.lastTs && extra.lastTs > (chat.lastTs || 0) && !chat.lastText) chat.lastTs = extra.lastTs;
    return chat;
  }

  /**
   * Añade (o actualiza) un mensaje ya normalizado:
   * { id, chatJid, altJid?, fromMe, ts, text, kind, pushName?, status? }
   */
  addMessage(msg, { countUnread = false, resetOnOwn = false } = {}) {
    if (!msg?.id || !msg.chatJid) return null;
    if (msg.altJid) {
      if (isLid(msg.chatJid) && isPn(msg.altJid)) this.addMapping(msg.chatJid, msg.altJid);
      if (isPn(msg.chatJid) && isLid(msg.altJid)) this.addMapping(msg.altJid, msg.chatJid);
    }
    const chat = this.ensureChat(msg.chatJid);
    if (!chat) return null;

    if (!msg.fromMe && msg.pushName && !chat.isGroup) {
      this.setContact({ id: chat.id, notify: msg.pushName });
    }

    const list = this.messages.get(chat.id) || [];
    const existing = list.find((m) => m.id === msg.id);
    if (existing) {
      Object.assign(existing, { ...msg, chatJid: chat.id, status: Math.max(existing.status ?? 0, msg.status ?? 0) });
    } else {
      list.push({
        id: msg.id,
        chatJid: chat.id,
        fromMe: Boolean(msg.fromMe),
        ts: Number(msg.ts) || Math.floor(Date.now() / 1000),
        text: msg.text || "",
        kind: msg.kind || "text",
        senderName: msg.fromMe ? null : msg.pushName || null,
        status: msg.status ?? null,
      });
      list.sort((a, b) => a.ts - b.ts);
      if (list.length > this.maxPerChat) list.splice(0, list.length - this.maxPerChat);
      if (countUnread && !msg.fromMe) chat.unread = (chat.unread || 0) + 1;
      // Si respondemos desde el móvil o desde el panel, el chat se considera leído.
      if (msg.fromMe && resetOnOwn) chat.unread = 0;
    }
    this.messages.set(chat.id, list);

    const last = list[list.length - 1];
    if (last && last.ts >= (chat.lastTs || 0)) {
      chat.lastTs = last.ts;
      chat.lastText = last.text;
      chat.lastFromMe = last.fromMe;
    }
    this.pruneChats();
    this.touch();
    return chat.id;
  }

  /** Cambia el texto de un mensaje existente (ediciones y mensajes eliminados). */
  patchMessage(rawJid, id, patch) {
    const chatId = this.canonical(rawJid);
    const list = this.messages.get(chatId);
    const msg = list?.find((m) => m.id === id);
    if (!msg) return;
    Object.assign(msg, patch);
    const chat = this.chats.get(chatId);
    if (chat && list[list.length - 1] === msg) chat.lastText = msg.text;
    this.touch();
  }

  updateStatus(rawJid, id, status) {
    if (typeof status !== "number") return;
    const list = this.messages.get(this.canonical(rawJid));
    const msg = list?.find((m) => m.id === id);
    if (msg && (msg.status ?? -1) < status) {
      msg.status = status;
      this.touch();
    }
  }

  markRead(rawJid) {
    const chat = this.chats.get(this.canonical(rawJid));
    if (chat && chat.unread) {
      chat.unread = 0;
      this.touch();
    }
    return chat || null;
  }

  removeChat(rawJid) {
    const id = this.canonical(rawJid);
    if (this.chats.delete(id)) {
      this.messages.delete(id);
      this.touch();
    }
  }

  pruneChats() {
    if (this.chats.size <= this.maxChats) return;
    const sorted = [...this.chats.values()].sort((a, b) => (a.lastTs || 0) - (b.lastTs || 0));
    for (const chat of sorted.slice(0, this.chats.size - this.maxChats)) {
      this.chats.delete(chat.id);
      this.messages.delete(chat.id);
    }
  }

  listChats() {
    return [...this.chats.values()]
      .filter((c) => c.lastTs || c.lastText)
      .sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0))
      .map((c) => ({ ...c, name: c.name || this.displayName(c.id) }));
  }

  getMessages(rawJid, limit = 100) {
    const id = this.canonical(rawJid);
    const list = this.messages.get(id) || [];
    return list.slice(-Math.max(1, Math.min(limit, this.maxPerChat)));
  }

  toJSON() {
    return {
      v: 1,
      chats: [...this.chats.values()],
      messages: Object.fromEntries(this.messages),
      lidToPn: Object.fromEntries(this.lidToPn),
      names: Object.fromEntries(this.names),
    };
  }

  load() {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      this.chats = new Map((data.chats || []).map((c) => [c.id, c]));
      this.messages = new Map(Object.entries(data.messages || {}));
      this.lidToPn = new Map(Object.entries(data.lidToPn || {}));
      this.names = new Map(Object.entries(data.names || {}));
      this.rev += 1;
    } catch (error) {
      console.error("[store] No se pudo leer", this.file, error?.message || error);
    }
  }

  scheduleSave(delay = 1500) {
    if (!this.file) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, delay);
  }

  saveNow() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.toJSON()));
      fs.renameSync(tmp, this.file);
    } catch (error) {
      console.error("[store] No se pudo guardar", this.file, error?.message || error);
    }
  }
}
