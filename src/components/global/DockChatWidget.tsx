"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { MessageSquare, RefreshCw, Send, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

type ChatThread = {
  id: string;
  tarotist_worker_id?: string | null;
  tarotist_display_name?: string | null;
  last_message_preview?: string | null;
  last_message_text?: string | null;
  last_message_at?: string | null;
  created_at?: string | null;
  tarotist?: { display_name?: string | null; team?: string | null } | null;
};

type ChatMessage = {
  id: string;
  thread_id: string;
  sender_worker_id?: string | null;
  sender_display_name?: string | null;
  text?: string | null;
  body?: string | null;
  created_at?: string | null;
};

type RoleMode = "admin" | "central" | "tarotista" | "unknown";

type Props = {
  open: boolean;
  onClose: () => void;
  onUnreadChange?: (count: number) => void;
};

async function getToken() {
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || "";
}

function fmtTime(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

function threadTitle(thread: ChatThread, mode: RoleMode) {
  if (mode === "tarotista") return "Central / Administración";
  return (
    thread.tarotist_display_name ||
    thread.tarotist?.display_name ||
    (thread.tarotist_worker_id ? `Tarotista ${String(thread.tarotist_worker_id).slice(0, 6)}` : "Chat")
  );
}

function messageText(message: ChatMessage) {
  return String(message.text ?? message.body ?? "");
}

const shellStyle: CSSProperties = {
  position: "fixed",
  right: 16,
  bottom: 88,
  zIndex: 170,
  width: "min(440px, calc(100vw - 24px))",
  maxHeight: "min(720px, calc(100vh - 112px))",
  borderRadius: 24,
  border: "1px solid rgba(255,255,255,.14)",
  background: "rgba(12,12,18,.96)",
  boxShadow: "0 30px 90px rgba(0,0,0,.48)",
  backdropFilter: "blur(18px)",
  overflow: "hidden",
  color: "#fff",
};

const btnStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,.14)",
  background: "rgba(255,255,255,.06)",
  color: "#fff",
  borderRadius: 14,
  padding: "10px 12px",
  fontWeight: 800,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
};

const inputStyle: CSSProperties = {
  width: "100%",
  border: "1px solid rgba(255,255,255,.12)",
  background: "rgba(255,255,255,.06)",
  color: "#fff",
  borderRadius: 14,
  padding: "12px 13px",
  outline: "none",
};

export default function DockChatWidget({ open, onClose, onUnreadChange }: Props) {
  const [mode, setMode] = useState<RoleMode>("unknown");
  const [meId, setMeId] = useState("");
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [composer, setComposer] = useState("");
  const [loading, setLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");
  const [lastSeenStamp, setLastSeenStamp] = useState("");
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const selectedThread = useMemo(
    () => threads.find((thread) => String(thread.id) === String(selectedThreadId)) || null,
    [threads, selectedThreadId]
  );

  const filteredThreads = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((thread) => {
      const text = [threadTitle(thread, mode), thread.last_message_preview, thread.last_message_text, thread.tarotist?.team]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return text.includes(q);
    });
  }, [threads, search, mode]);

  const newestStamp = useMemo(() => {
    const stamps = threads
      .map((thread) => thread.last_message_at || thread.created_at || "")
      .filter(Boolean)
      .sort();
    return stamps[stamps.length - 1] || "";
  }, [threads]);

  useEffect(() => {
    if (open && newestStamp) setLastSeenStamp(newestStamp);
  }, [open, newestStamp]);

  useEffect(() => {
    const unread = !open && newestStamp && lastSeenStamp && newestStamp !== lastSeenStamp ? 1 : 0;
    onUnreadChange?.(unread);
  }, [open, newestStamp, lastSeenStamp, onUnreadChange]);

  const loadThreads = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const token = await getToken();
      if (!token) throw new Error("No hay sesión activa");

      const res = await fetch(`/api/chat/threads?t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "No se pudo cargar el chat");

      const nextMode: RoleMode = json.mode === "tarotista" ? "tarotista" : json.mode === "staff" ? "central" : "unknown";
      setMode(nextMode);
      if (json?.me?.id) setMeId(String(json.me.id));

      const nextThreads: ChatThread[] = json.thread
        ? [json.thread]
        : Array.isArray(json.threads)
        ? json.threads
        : [];

      setThreads(nextThreads);
      setSelectedThreadId((prev) => {
        if (prev && nextThreads.some((thread) => String(thread.id) === String(prev))) return prev;
        return String(nextThreads[0]?.id || "");
      });
      setMsg("");
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error cargando chat"}`);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (threadId = selectedThreadId, silent = false) => {
    if (!threadId) {
      setMessages([]);
      return;
    }
    try {
      if (!silent) setMessagesLoading(true);
      const token = await getToken();
      if (!token) throw new Error("No hay sesión activa");
      const res = await fetch(`/api/chat/messages?thread_id=${encodeURIComponent(threadId)}&t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "No se pudieron cargar mensajes");
      setMessages(Array.isArray(json.messages) ? json.messages : []);
      window.setTimeout(() => {
        const box = messagesRef.current;
        if (box) box.scrollTop = box.scrollHeight;
      }, 80);
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error cargando mensajes"}`);
    } finally {
      if (!silent) setMessagesLoading(false);
    }
  }, [selectedThreadId]);

  async function sendMessage() {
    const text = composer.trim();
    if (!text || sending) return;
    try {
      setSending(true);
      const token = await getToken();
      if (!token) throw new Error("No hay sesión activa");

      const res = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: selectedThreadId || undefined, text }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "No se pudo enviar");

      setComposer("");
      if (json.thread_id && !selectedThreadId) setSelectedThreadId(String(json.thread_id));
      if (json.message) setMessages((prev) => [...prev, json.message]);
      await loadThreads(true);
      window.setTimeout(() => {
        const box = messagesRef.current;
        if (box) box.scrollTop = box.scrollHeight;
      }, 80);
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error enviando"}`);
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    void loadThreads(true);
    const interval = window.setInterval(() => void loadThreads(true), 9000);
    return () => window.clearInterval(interval);
  }, [loadThreads]);

  useEffect(() => {
    if (!selectedThreadId) return;
    void loadMessages(selectedThreadId, false);

    const channel = sb
      .channel(`dock-chat-${selectedThreadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `thread_id=eq.${selectedThreadId}` },
        (payload) => {
          const row: any = payload.new || {};
          setMessages((prev) => {
            if (prev.some((m) => String(m.id) === String(row.id))) return prev;
            return [
              ...prev,
              {
                id: String(row.id),
                thread_id: String(row.thread_id),
                sender_worker_id: row.sender_worker_id ? String(row.sender_worker_id) : null,
                sender_display_name: row.sender_display_name ? String(row.sender_display_name) : null,
                text: row.body ? String(row.body) : "",
                created_at: row.created_at ? String(row.created_at) : null,
              },
            ];
          });
          void loadThreads(true);
          window.setTimeout(() => {
            const box = messagesRef.current;
            if (box) box.scrollTop = box.scrollHeight;
          }, 80);
        }
      )
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
  }, [selectedThreadId, loadMessages, loadThreads]);

  useEffect(() => {
    if (!open) return;
    void loadThreads(true);
    if (selectedThreadId) void loadMessages(selectedThreadId, true);
  }, [open, selectedThreadId, loadThreads, loadMessages]);

  if (!open) return null;

  return (
    <div style={shellStyle} aria-label="Chat interno">
      <div style={{ padding: 14, borderBottom: "1px solid rgba(255,255,255,.10)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900, fontSize: 16 }}>
            <MessageSquare size={17} /> Chat interno
          </div>
          <div style={{ color: "rgba(255,255,255,.62)", fontSize: 12, marginTop: 3 }}>
            {mode === "tarotista" ? "Tarotista ↔ central" : "Admin/central ↔ tarotistas"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={btnStyle} onClick={() => loadThreads(false)} disabled={loading} title="Recargar chat">
            <RefreshCw size={15} />
          </button>
          <button type="button" style={btnStyle} onClick={onClose} title="Cerrar chat">
            <X size={15} />
          </button>
        </div>
      </div>

      {msg ? <div style={{ padding: "10px 14px", color: "#ffd5d5", fontSize: 13 }}>{msg}</div> : null}

      {mode !== "tarotista" ? (
        <div style={{ padding: 12, borderBottom: "1px solid rgba(255,255,255,.08)", display: "grid", gap: 10 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar tarotista o chat…" style={inputStyle} />
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
            {filteredThreads.length ? filteredThreads.map((thread) => {
              const active = String(thread.id) === String(selectedThreadId);
              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => setSelectedThreadId(String(thread.id))}
                  style={{
                    flex: "0 0 190px",
                    textAlign: "left",
                    border: active ? "1px solid rgba(215,181,109,.55)" : "1px solid rgba(255,255,255,.10)",
                    background: active ? "rgba(215,181,109,.14)" : "rgba(255,255,255,.04)",
                    color: "#fff",
                    borderRadius: 16,
                    padding: 10,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{threadTitle(thread, mode)}</div>
                  <div style={{ color: "rgba(255,255,255,.62)", fontSize: 12, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {thread.last_message_preview || thread.last_message_text || "Sin mensajes"}
                  </div>
                </button>
              );
            }) : <div style={{ color: "rgba(255,255,255,.65)", fontSize: 13 }}>No hay chats todavía.</div>}
          </div>
        </div>
      ) : null}

      <div style={{ padding: 14 }}>
        <div style={{ marginBottom: 10, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {selectedThread ? threadTitle(selectedThread, mode) : mode === "tarotista" ? "Central / Administración" : "Selecciona un chat"}
            </div>
            <div style={{ color: "rgba(255,255,255,.58)", fontSize: 12, marginTop: 3 }}>
              {selectedThread?.last_message_at ? `Último: ${fmtTime(selectedThread.last_message_at)}` : messagesLoading ? "Cargando…" : "Chat en tiempo real"}
            </div>
          </div>
        </div>

        <div
          ref={messagesRef}
          style={{
            height: mode === "tarotista" ? 360 : 300,
            overflowY: "auto",
            display: "grid",
            alignContent: "start",
            gap: 8,
            padding: 10,
            borderRadius: 18,
            border: "1px solid rgba(255,255,255,.08)",
            background: "rgba(255,255,255,.025)",
          }}
        >
          {messages.length ? messages.map((message) => {
            const own = meId && String(message.sender_worker_id || "") === String(meId);
            return (
              <div key={message.id} style={{ display: "grid", justifyItems: own ? "end" : "start" }}>
                <div style={{ maxWidth: "82%", borderRadius: 16, padding: "9px 11px", background: own ? "rgba(215,181,109,.20)" : "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.08)" }}>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,.58)", marginBottom: 4 }}>
                    {message.sender_display_name || (own ? "Tú" : "Chat")} · {fmtTime(message.created_at)}
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.35, whiteSpace: "pre-wrap" }}>{messageText(message)}</div>
                </div>
              </div>
            );
          }) : <div style={{ color: "rgba(255,255,255,.62)", fontSize: 13 }}>{messagesLoading ? "Cargando mensajes…" : "No hay mensajes todavía."}</div>}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage();
          }}
          style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8, marginTop: 10 }}
        >
          <input
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            placeholder={selectedThreadId || mode === "tarotista" ? "Escribe un mensaje…" : "Selecciona un chat…"}
            style={inputStyle}
            disabled={sending || (!selectedThreadId && mode !== "tarotista")}
          />
          <button type="submit" style={{ ...btnStyle, background: "linear-gradient(180deg,#f0d68d,#d7b56d)", color: "#201709" }} disabled={sending || !composer.trim()}>
            <Send size={15} />
          </button>
        </form>
      </div>
    </div>
  );
}
