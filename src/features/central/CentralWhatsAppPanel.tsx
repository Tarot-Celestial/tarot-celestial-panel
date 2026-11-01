"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Clock3,
  LogOut,
  MessageCirclePlus,
  QrCode,
  RefreshCw,
  Search,
  Send,
  Smartphone,
  TriangleAlert,
  X,
} from "lucide-react";
import styles from "./CentralWhatsAppPanel.module.css";

type GatewayState = "idle" | "connecting" | "qr" | "connected";

type StatusPayload = {
  ok: boolean;
  error?: string;
  state?: GatewayState;
  reason?: string | null;
  qr?: string | null;
  me?: { id: string; name: string | null; phone: string | null } | null;
  historyProgress?: number | null;
  rev?: string;
};

type Chat = {
  id: string;
  phone: string | null;
  isGroup: boolean;
  name: string | null;
  lastTs: number;
  lastText: string;
  lastFromMe: boolean;
  unread: number;
};

type Message = {
  id: string;
  chatJid: string;
  fromMe: boolean;
  ts: number;
  text: string;
  kind: string;
  senderName: string | null;
  status: number | null;
  edited?: boolean;
};

const STATUS_POLL_MS = 3000;

function formatPhone(phone: string | null | undefined) {
  if (!phone) return "";
  if (phone.startsWith("34") && phone.length === 11) return `+34 ${phone.slice(2, 5)} ${phone.slice(5, 8)} ${phone.slice(8)}`;
  return `+${phone}`;
}

function chatTitle(chat: Pick<Chat, "name" | "phone" | "id">) {
  return chat.name || formatPhone(chat.phone) || "Contacto de WhatsApp";
}

function initials(value: string) {
  if (value.trim().startsWith("+")) return "#";
  const clean = value.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ0-9 ]/g, "").trim();
  if (!clean) return "#";
  const parts = clean.split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

function listTime(ts: number) {
  if (!ts) return "";
  const date = new Date(ts * 1000);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Ayer";
  return date.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
}

function dayLabel(ts: number) {
  const date = new Date(ts * 1000);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return "Hoy";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Ayer";
  return date.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
}

function friendlyError(code: string | undefined) {
  switch (code) {
    case "GATEWAY_NOT_CONFIGURED":
      return "El servicio de WhatsApp aún no está configurado (faltan WHATSAPP_GATEWAY_URL y WHATSAPP_GATEWAY_SECRET).";
    case "GATEWAY_UNREACHABLE":
    case "GATEWAY_TIMEOUT":
      return "No se puede contactar con el servicio de WhatsApp. Comprueba que el gateway está encendido.";
    case "UNAUTHORIZED":
      return "El secreto del gateway no coincide con el del panel.";
    case "NOT_CONNECTED":
      return "WhatsApp se ha desconectado. Vuelve a vincularlo.";
    case "NOT_ON_WHATSAPP":
      return "Ese número no tiene WhatsApp.";
    case "INVALID_PHONE":
      return "Revisa el número: incluye el prefijo del país (por ejemplo 34 para España).";
    case "FORBIDDEN":
      return "Tu usuario no tiene permiso para usar WhatsApp en el panel.";
    case "NO_AUTH":
      return "Tu sesión ha caducado. Vuelve a entrar en el panel.";
    default:
      return code ? `No se pudo completar la acción (${code}).` : "No se pudo completar la acción.";
  }
}

function reasonText(reason: string | null | undefined) {
  switch (reason) {
    case "logged_out":
      return "La sesión de WhatsApp se cerró. Genera un QR para vincular otro número.";
    case "qr_expired":
      return "El QR caducó sin escanearse. Genera uno nuevo cuando tengas el móvil a mano.";
    case "replaced":
      return "Esta sesión se abrió en otro sitio y se ha desconectado aquí.";
    case "forbidden":
      return "WhatsApp ha rechazado la conexión de este número.";
    case "error":
      return "Hubo un problema al conectar. Inténtalo de nuevo.";
    default:
      return "Vincula un WhatsApp escaneando un código QR desde el móvil.";
  }
}

function Ticks({ status }: { status: number | null }) {
  if (status === null || status === undefined) return null;
  if (status <= 1) return <Clock3 size={13} aria-label="Enviando" />;
  if (status === 2) return <Check size={14} aria-label="Enviado" />;
  return <CheckCheck size={14} className={status >= 4 ? styles.read : undefined} aria-label={status >= 4 ? "Leído" : "Entregado"} />;
}

export default function CentralWhatsAppPanel() {
  const sb = useMemo(() => supabaseBrowser(), []);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"start" | "logout" | "send" | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newText, setNewText] = useState("");

  const mountedRef = useRef(false);
  const lastRevRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const autoStartRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  selectedRef.current = selectedId;

  const api = useCallback(
    async (path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}) => {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("NO_AUTH");
      const response = await fetch(`/api/central/whatsapp?action=${path}`, {
        method: init.method || "GET",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
      const json = await response.json().catch(() => ({ ok: false, error: `HTTP_${response.status}` }));
      if (!response.ok || !json?.ok) throw new Error(json?.error || `HTTP_${response.status}`);
      return json;
    },
    [sb]
  );

  const loadChats = useCallback(async () => {
    const json = await api("chats");
    if (mountedRef.current) setChats(Array.isArray(json.chats) ? json.chats : []);
  }, [api]);

  const loadMessages = useCallback(
    async (chatId: string, showLoading = false) => {
      if (showLoading) setMessagesLoading(true);
      try {
        const json = await api(`messages&jid=${encodeURIComponent(chatId)}&limit=150`);
        if (mountedRef.current && selectedRef.current === chatId) setMessages(Array.isArray(json.messages) ? json.messages : []);
      } finally {
        if (mountedRef.current && showLoading) setMessagesLoading(false);
      }
    },
    [api]
  );

  const markRead = useCallback(
    async (chatId: string) => {
      setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, unread: 0 } : c)));
      try {
        await api(`read&jid=${encodeURIComponent(chatId)}`, { method: "POST" });
      } catch {
        // No es grave: el contador se corregirá en el siguiente refresco.
      }
    },
    [api]
  );

  const start = useCallback(async () => {
    setBusy("start");
    setError(null);
    try {
      const json = await api("start", { method: "POST" });
      if (mountedRef.current) setStatus(json);
    } catch (e: any) {
      if (mountedRef.current) setError(friendlyError(e?.message));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [api]);

  const pollStatus = useCallback(async () => {
    try {
      const json: StatusPayload = await api("status");
      if (!mountedRef.current) return;
      setStatus(json);
      setError(null);

      // La primera vez que se abre el apartado sin sesión, mostramos el QR directamente.
      if (json.state === "idle" && !json.reason && !autoStartRef.current) {
        autoStartRef.current = true;
        void start();
      }

      if (json.state === "connected" && json.rev && json.rev !== lastRevRef.current) {
        lastRevRef.current = json.rev;
        await loadChats();
        const current = selectedRef.current;
        if (current) await loadMessages(current);
      }
      if (json.state !== "connected") lastRevRef.current = null;
    } catch (e: any) {
      if (!mountedRef.current) return;
      const code = String(e?.message || "");
      setStatus((prev) => (code === "GATEWAY_NOT_CONFIGURED" ? { ok: false, error: code } : prev));
      setError(friendlyError(code));
    }
  }, [api, loadChats, loadMessages, start]);

  useEffect(() => {
    mountedRef.current = true;
    void pollStatus();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void pollStatus();
    }, STATUS_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void pollStatus();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pollStatus]);

  // Al abrir un chat: cargar mensajes y marcarlo como leído.
  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    stickToBottomRef.current = true;
    setMessages([]);
    void loadMessages(selectedId, true).catch((e) => setError(friendlyError(e?.message)));
    const chat = chats.find((c) => c.id === selectedId);
    if (chat?.unread) void markRead(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Si llega un mensaje nuevo al chat abierto, se marca como leído.
  useEffect(() => {
    if (!selectedId || document.visibilityState !== "visible") return;
    const chat = chats.find((c) => c.id === selectedId);
    if (chat?.unread) void markRead(selectedId);
  }, [chats, markRead, selectedId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const logout = useCallback(async () => {
    const ok = window.confirm(
      "¿Cerrar la sesión de WhatsApp en el panel?\n\nSe desvinculará este número y aparecerá un QR nuevo para conectar otro."
    );
    if (!ok) return;
    setBusy("logout");
    setError(null);
    try {
      const json = await api("logout", { method: "POST", body: { restart: true } });
      if (!mountedRef.current) return;
      setStatus(json);
      setChats([]);
      setSelectedId(null);
      setMessages([]);
      lastRevRef.current = null;
    } catch (e: any) {
      if (mountedRef.current) setError(friendlyError(e?.message));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [api]);

  const sendDraft = useCallback(async () => {
    const text = draft.trim();
    const chatId = selectedRef.current;
    if (!text || !chatId || busy === "send") return;
    setBusy("send");
    setError(null);
    const tempId = `tmp-${Date.now()}`;
    stickToBottomRef.current = true;
    setMessages((prev) => [
      ...prev,
      { id: tempId, chatJid: chatId, fromMe: true, ts: Math.floor(Date.now() / 1000), text, kind: "text", senderName: null, status: 1 },
    ]);
    setDraft("");
    try {
      await api("send", { method: "POST", body: { jid: chatId, text } });
      await Promise.all([loadMessages(chatId), loadChats()]);
    } catch (e: any) {
      if (!mountedRef.current) return;
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setDraft(text);
      setError(friendlyError(e?.message));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [api, busy, draft, loadChats, loadMessages]);

  const onComposerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendDraft();
    }
  };

  const startNewChat = async (event: FormEvent) => {
    event.preventDefault();
    const phone = newPhone.replace(/\D/g, "");
    const text = newText.trim();
    if (!phone || !text) return;
    setBusy("send");
    setError(null);
    try {
      const json = await api("send", { method: "POST", body: { phone, text } });
      await loadChats();
      if (!mountedRef.current) return;
      setNewChatOpen(false);
      setNewPhone("");
      setNewText("");
      if (json.chatId) setSelectedId(json.chatId);
    } catch (e: any) {
      if (mountedRef.current) setError(friendlyError(e?.message));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const filteredChats = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chats;
    const digits = q.replace(/\D/g, "");
    return chats.filter(
      (c) =>
        (c.name || "").toLowerCase().includes(q) ||
        (digits && (c.phone || "").includes(digits)) ||
        (c.lastText || "").toLowerCase().includes(q)
    );
  }, [chats, query]);

  const selectedChat = chats.find((c) => c.id === selectedId) || null;
  const totalUnread = chats.reduce((sum, c) => sum + (c.unread || 0), 0);
  const state = status?.state;
  const notConfigured = status?.error === "GATEWAY_NOT_CONFIGURED";

  const badge = notConfigured
    ? { cls: styles.off, label: "Sin configurar" }
    : state === "connected"
      ? { cls: styles.on, label: "Conectado" }
      : state === "qr"
        ? { cls: styles.wait, label: "Esperando QR" }
        : state === "connecting"
          ? { cls: styles.wait, label: "Conectando…" }
          : status
            ? { cls: styles.off, label: "Desconectado" }
            : { cls: styles.wait, label: "Comprobando…" };

  return (
    <section className={styles.wrap} aria-label="WhatsApp">
      <header className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>
            <Smartphone size={14} /> WhatsApp Web
          </div>
          <h2>WhatsApp</h2>
          <p>
            {state === "connected" && status?.me
              ? `Conectado como ${status.me.name || "WhatsApp"}${status.me.phone ? ` · ${formatPhone(status.me.phone)}` : ""}`
              : "Atiende y responde a las clientas desde el panel."}
          </p>
        </div>
        <div className={styles.toolbar}>
          <span className={`${styles.badge} ${badge.cls}`}>
            <i /> {badge.label}
            {state === "connected" && totalUnread > 0 ? <b>{totalUnread}</b> : null}
          </span>
          {(state === "connected" || state === "qr" || state === "connecting") && (
            <button type="button" className={styles.ghostButton} onClick={logout} disabled={busy !== null}>
              <LogOut size={16} />
              {busy === "logout" ? "Cerrando…" : state === "connected" ? "Cerrar sesión" : "Reiniciar QR"}
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className={styles.error} role="alert">
          <TriangleAlert size={16} /> <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Cerrar aviso">
            <X size={14} />
          </button>
        </div>
      )}

      {notConfigured && (
        <div className={styles.card}>
          <h3>Falta conectar el servicio de WhatsApp</h3>
          <p>
            Este apartado necesita el gateway de WhatsApp (carpeta <code>whatsapp-gateway</code> del proyecto) desplegado en un servidor
            siempre encendido, y estas variables en Vercel:
          </p>
          <pre>{`WHATSAPP_GATEWAY_URL=https://tu-gateway.ejemplo.com\nWHATSAPP_GATEWAY_SECRET=el-mismo-secreto-del-gateway`}</pre>
        </div>
      )}

      {!notConfigured && state !== "connected" && (
        <div className={styles.linkCard}>
          <div className={styles.qrBox}>
            {state === "qr" && status?.qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={status.qr} alt="Código QR para vincular WhatsApp" width={280} height={280} />
            ) : state === "connecting" || busy === "start" || !status ? (
              <div className={styles.qrPlaceholder}>
                <RefreshCw size={30} className={styles.spin} />
                <span>{state === "connecting" ? "Conectando con WhatsApp…" : "Generando QR…"}</span>
              </div>
            ) : (
              <div className={styles.qrPlaceholder}>
                <QrCode size={46} />
                <span>{reasonText(status?.reason)}</span>
              </div>
            )}
          </div>
          <div className={styles.steps}>
            <h3>Vincula el WhatsApp que quieras usar</h3>
            <ol>
              <li>Abre WhatsApp en el móvil del número que vas a usar.</li>
              <li>
                Pulsa <strong>Ajustes</strong> (iPhone) o <strong>⋮</strong> (Android) → <strong>Dispositivos vinculados</strong>.
              </li>
              <li>
                Pulsa <strong>Vincular un dispositivo</strong> y escanea este código.
              </li>
            </ol>
            <p className={styles.hint}>
              El código se renueva solo cada pocos segundos. Para cambiar de número más adelante, pulsa <strong>Cerrar sesión</strong> y
              escanea el nuevo QR con el otro móvil.
            </p>
            {state !== "qr" && state !== "connecting" && (
              <button type="button" className={styles.primaryButton} onClick={start} disabled={busy !== null || !status}>
                <QrCode size={17} /> {busy === "start" ? "Generando…" : "Mostrar QR"}
              </button>
            )}
          </div>
        </div>
      )}

      {state === "connected" && (
        <div className={`${styles.inbox} ${selectedId ? styles.hasSelection : ""}`}>
          <aside className={styles.chatList}>
            <div className={styles.listTools}>
              <label className={styles.search}>
                <Search size={15} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar chat o número" />
              </label>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setNewChatOpen((v) => !v)}
                title="Nuevo chat"
                aria-label="Nuevo chat"
              >
                <MessageCirclePlus size={18} />
              </button>
            </div>

            {newChatOpen && (
              <form className={styles.newChat} onSubmit={startNewChat}>
                <input
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="Número con prefijo, ej. 34600123456"
                  inputMode="tel"
                  autoFocus
                />
                <textarea value={newText} onChange={(e) => setNewText(e.target.value)} placeholder="Primer mensaje" rows={2} />
                <button type="submit" className={styles.primaryButton} disabled={busy !== null || !newPhone.trim() || !newText.trim()}>
                  <Send size={15} /> Enviar
                </button>
              </form>
            )}

            {status?.historyProgress != null && status.historyProgress < 100 && chats.length === 0 && (
              <div className={styles.empty}>Cargando chats recientes… {Math.round(status.historyProgress)}%</div>
            )}
            {chats.length === 0 && (status?.historyProgress == null || status.historyProgress >= 100) && (
              <div className={styles.empty}>Aún no hay chats. Los mensajes nuevos aparecerán aquí al instante.</div>
            )}

            <ul>
              {filteredChats.map((chat) => {
                const title = chatTitle(chat);
                return (
                  <li key={chat.id}>
                    <button
                      type="button"
                      className={`${styles.chatItem} ${chat.id === selectedId ? styles.active : ""}`}
                      onClick={() => setSelectedId(chat.id)}
                    >
                      <span className={styles.avatar}>{initials(title)}</span>
                      <span className={styles.chatMeta}>
                        <span className={styles.chatTop}>
                          <strong>{title}</strong>
                          <time className={chat.unread ? styles.unreadTime : undefined}>{listTime(chat.lastTs)}</time>
                        </span>
                        <span className={styles.chatBottom}>
                          <span className={styles.preview}>
                            {chat.lastFromMe ? "Tú: " : ""}
                            {chat.lastText}
                          </span>
                          {chat.unread > 0 && <b className={styles.unread}>{chat.unread}</b>}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          <div className={styles.conversation}>
            {!selectedChat ? (
              <div className={styles.placeholder}>
                <Smartphone size={42} />
                <p>Elige un chat para leer los mensajes y responder.</p>
              </div>
            ) : (
              <>
                <div className={styles.convHeader}>
                  <button type="button" className={styles.backButton} onClick={() => setSelectedId(null)} aria-label="Volver a los chats">
                    <ArrowLeft size={18} />
                  </button>
                  <span className={styles.avatar}>{initials(chatTitle(selectedChat))}</span>
                  <div>
                    <strong>{chatTitle(selectedChat)}</strong>
                    {selectedChat.phone && selectedChat.name && <span>{formatPhone(selectedChat.phone)}</span>}
                  </div>
                </div>

                <div
                  className={styles.messages}
                  ref={scrollRef}
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                  }}
                >
                  {messagesLoading && messages.length === 0 && <div className={styles.empty}>Cargando mensajes…</div>}
                  {messages.map((msg, index) => {
                    const prev = messages[index - 1];
                    const showDay = !prev || new Date(prev.ts * 1000).toDateString() !== new Date(msg.ts * 1000).toDateString();
                    return (
                      <div key={msg.id}>
                        {showDay && <div className={styles.day}>{dayLabel(msg.ts)}</div>}
                        <div className={`${styles.bubble} ${msg.fromMe ? styles.mine : styles.theirs} ${msg.kind === "revoked" ? styles.revoked : ""}`}>
                          {selectedChat.isGroup && !msg.fromMe && msg.senderName && <em>{msg.senderName}</em>}
                          <p>{msg.text}</p>
                          <span className={styles.bubbleMeta}>
                            {msg.edited && "editado · "}
                            {new Date(msg.ts * 1000).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                            {msg.fromMe && <Ticks status={msg.status} />}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <form
                  className={styles.composer}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void sendDraft();
                  }}
                >
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onComposerKey}
                    placeholder="Escribe un mensaje"
                    rows={1}
                    maxLength={4096}
                  />
                  <button type="submit" className={styles.sendButton} disabled={!draft.trim() || busy === "send"} aria-label="Enviar">
                    <Send size={18} />
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
