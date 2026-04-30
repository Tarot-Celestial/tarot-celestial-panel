"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

export type ChatThread = {
  id: string;
  title?: string | null;
  tarotist_display_name?: string | null;
  tarotist_worker_id?: string | null;
  last_message_text?: string | null;
  last_message_at?: string | null;
  unread_count?: number | null;
};

export type ChatMessage = {
  id: string;
  thread_id: string;
  sender_worker_id?: string | null;
  sender_display_name?: string | null;
  text?: string | null;
  created_at?: string | null;
};

export type ChatContextValue = {
  loading: boolean;
  message: string;
  threads: ChatThread[];
  messages: ChatMessage[];
  selectedThreadId: string;
  unreadTotal: number;
  setSelectedThreadId: (threadId: string) => void;
  loadThreads: (silent?: boolean) => Promise<void>;
  loadMessages: (threadId?: string, silent?: boolean) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  openThreadWithTarotist: (workerId: string) => Promise<string>;
  clearMessage: () => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

async function getAccessToken() {
  const sb = supabaseBrowser();
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || null;
}

async function safeJson(res: Response) {
  const txt = await res.text();
  if (!txt) return { _raw: "", _status: res.status, _ok: res.ok };
  try {
    const j = JSON.parse(txt);
    return { ...j, _raw: txt, _status: res.status, _ok: res.ok };
  } catch {
    return { _raw: txt.slice(0, 800), _status: res.status, _ok: res.ok };
  }
}

function normalizeThread(t: any): ChatThread {
  return {
    id: String(t.id),
    title: t.title != null ? String(t.title) : null,
    tarotist_display_name: t.tarotist_display_name != null ? String(t.tarotist_display_name) : null,
    tarotist_worker_id: t.tarotist_worker_id != null ? String(t.tarotist_worker_id) : null,
    last_message_text: t.last_message_text != null ? String(t.last_message_text) : null,
    last_message_at: t.last_message_at != null ? String(t.last_message_at) : null,
    unread_count: t.unread_count != null ? Number(t.unread_count) : null,
  };
}

function normalizeMessage(m: any, fallbackThreadId = ""): ChatMessage {
  return {
    id: String(m.id),
    thread_id: String(m.thread_id || fallbackThreadId),
    sender_worker_id: m.sender_worker_id != null ? String(m.sender_worker_id) : null,
    sender_display_name: m.sender_display_name != null ? String(m.sender_display_name) : null,
    text: m.text != null ? String(m.text) : m.body != null ? String(m.body) : "",
    created_at: m.created_at != null ? String(m.created_at) : null,
  };
}

function sortThreads(list: ChatThread[]) {
  return list.slice().sort((a, b) => {
    const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
    const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
    return bt - at;
  });
}

function sortMessages(list: ChatMessage[]) {
  return list.slice().sort((a, b) => {
    const at = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
    return at - bt;
  });
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedThreadId, setSelectedThreadIdState] = useState("");

  const mountedRef = useRef(false);
  const selectedThreadIdRef = useRef("");
  const threadsRef = useRef<ChatThread[]>([]);
  const refreshTimerRef = useRef<number | null>(null);

  const setSelectedThreadId = useCallback((threadId: string) => {
    const next = String(threadId || "");
    selectedThreadIdRef.current = next;
    setSelectedThreadIdState(next);
  }, []);

  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);

  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  const loadMessages = useCallback(
    async (threadId?: string, silent = false) => {
      const targetThreadId = String(threadId || selectedThreadIdRef.current || "");
      if (!targetThreadId) return;

      if (!silent) {
        setLoading(true);
        setMessage("");
      }

      try {
        const token = await getAccessToken();
        if (!token) throw new Error("NO_AUTH");

        const res = await fetch(`/api/central/chat/messages?thread_id=${encodeURIComponent(targetThreadId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = await safeJson(res);
        if (!json?._ok || !json?.ok) throw new Error(json?.error || `HTTP ${json?._status}`);

        const list: ChatMessage[] = (json.messages || json.rows || []).map((m: any) => normalizeMessage(m, targetThreadId));
        if (!mountedRef.current) return;
        setMessages(sortMessages(list));
      } catch (e: any) {
        if (!mountedRef.current) return;
        setMessages([]);
        if (!silent) setMessage(`❌ ${e?.message || "Error"}`);
      } finally {
        if (mountedRef.current && !silent) setLoading(false);
      }
    },
    []
  );

  const loadThreads = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
        setMessage("");
      }

      try {
        const token = await getAccessToken();
        if (!token) throw new Error("NO_AUTH");

        const res = await fetch("/api/central/chat/threads", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = await safeJson(res);
        if (!json?._ok || !json?.ok) throw new Error(json?.error || `HTTP ${json?._status}`);

        const list = sortThreads((json.threads || json.rows || []).map((t: any) => normalizeThread(t)));
        if (!mountedRef.current) return;

        setThreads(list);

        const current = selectedThreadIdRef.current;
        const stillExists = !!current && list.some((t) => String(t.id) === String(current));
        const nextThreadId = stillExists ? current : list[0]?.id || "";

        if (nextThreadId !== current) {
          setSelectedThreadId(nextThreadId);
          if (nextThreadId) void loadMessages(nextThreadId, true);
          else setMessages([]);
        }

        if (!silent) {
          setMessage(list.length ? `✅ Chats cargados (${list.length})` : "⚠️ No hay chats todavía");
          window.setTimeout(() => mountedRef.current && setMessage(""), 1200);
        }
      } catch (e: any) {
        if (!mountedRef.current) return;
        setThreads([]);
        if (!silent) setMessage(`❌ ${e?.message || "Error"}`);
      } finally {
        if (mountedRef.current && !silent) setLoading(false);
      }
    },
    [loadMessages, setSelectedThreadId]
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const clean = String(text || "").trim();
      const threadId = selectedThreadIdRef.current;
      if (!clean || !threadId) return;

      const tmpId = `tmp-${Date.now()}`;
      const optimistic: ChatMessage = {
        id: tmpId,
        thread_id: threadId,
        text: clean,
        created_at: new Date().toISOString(),
        sender_worker_id: "me",
        sender_display_name: "Yo",
      };

      setMessages((prev) => [...(prev || []), optimistic]);

      try {
        const token = await getAccessToken();
        if (!token) throw new Error("NO_AUTH");

        const res = await fetch("/api/central/chat/send", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ thread_id: threadId, text: clean }),
        });

        const json = await safeJson(res);
        if (!json?._ok || !json?.ok) throw new Error(json?.error || `HTTP ${json?._status}`);

        const saved = json.message || json.item || null;
        if (saved?.id) {
          const normalized = normalizeMessage(saved, threadId);
          setMessages((prev) => (prev || []).map((m) => (m.id === tmpId ? normalized : m)));
        } else {
          void loadMessages(threadId, true);
        }

        void loadThreads(true);
      } catch (e: any) {
        setMessages((prev) => (prev || []).filter((m) => m.id !== tmpId));
        throw e;
      }
    },
    [loadMessages, loadThreads]
  );

  const openThreadWithTarotist = useCallback(
    async (workerId: string) => {
      const tarotistWorkerId = String(workerId || "").trim();
      if (!tarotistWorkerId) throw new Error("Selecciona una tarotista.");

      const token = await getAccessToken();
      if (!token) throw new Error("NO_AUTH");

      const res = await fetch("/api/central/chat/open", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tarotist_worker_id: tarotistWorkerId }),
      });
      const json = await safeJson(res);
      if (!json?._ok || !json?.ok) throw new Error(json?.error || `HTTP ${json?._status}`);

      const threadId = String(json.thread?.id || json.thread_id || "");
      if (!threadId) throw new Error("NO_THREAD_ID");

      await loadThreads(true);
      setSelectedThreadId(threadId);
      await loadMessages(threadId, true);
      return threadId;
    },
    [loadMessages, loadThreads, setSelectedThreadId]
  );

  useEffect(() => {
    mountedRef.current = true;
    const sb = supabaseBrowser();

    const channel = sb
      .channel("central-chat-global")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => {
        const row: any = payload.new;
        const msg = normalizeMessage(row);

        if (String(msg.thread_id) === String(selectedThreadIdRef.current)) {
          setMessages((prev) => {
            const exists = (prev || []).some((x) => String(x.id) === String(msg.id));
            if (exists) return prev;
            return sortMessages([...(prev || []), msg]);
          });
        }

        void loadThreads(true);
      })
      .subscribe();

    refreshTimerRef.current = window.setInterval(() => void loadThreads(true), 30_000);

    return () => {
      mountedRef.current = false;
      if (refreshTimerRef.current) window.clearInterval(refreshTimerRef.current);
      sb.removeChannel(channel);
    };
  }, [loadThreads]);

  useEffect(() => {
    if (!selectedThreadId) {
      setMessages([]);
      return;
    }
    void loadMessages(selectedThreadId, false);
  }, [loadMessages, selectedThreadId]);

  const unreadTotal = useMemo(
    () => (threads || []).reduce((sum, t) => sum + Math.max(0, Number(t.unread_count || 0)), 0),
    [threads]
  );

  const value = useMemo<ChatContextValue>(
    () => ({
      loading,
      message,
      threads,
      messages,
      selectedThreadId,
      unreadTotal,
      setSelectedThreadId,
      loadThreads,
      loadMessages,
      sendMessage,
      openThreadWithTarotist,
      clearMessage: () => setMessage(""),
    }),
    [
      loading,
      message,
      threads,
      messages,
      selectedThreadId,
      unreadTotal,
      setSelectedThreadId,
      loadThreads,
      loadMessages,
      sendMessage,
      openThreadWithTarotist,
    ]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat debe usarse dentro de <ChatProvider />");
  return ctx;
}
