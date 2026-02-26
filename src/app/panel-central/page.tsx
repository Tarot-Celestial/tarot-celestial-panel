// src/app/panel-central/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

type TabKey = "equipo" | "llamadas" | "incidencias" | "ranking" | "checklist" | "chat";

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function dayKeyNow() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function eur(n: any) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function pctAny(v: any) {
  let x = Number(v) || 0;
  if (x > 0 && x <= 1) x = x * 100;
  return x;
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

// Attendance UI helpers
function attLabel(online: boolean, status: string) {
  if (!online) return "⚪ Offline";
  if (status === "break") return "🟡 Descanso";
  if (status === "bathroom") return "🟣 Baño";
  return "🟢 Online";
}
function attStyle(online: boolean, status: string) {
  if (!online) return { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)" };
  if (status === "break") return { background: "rgba(215,181,109,0.10)", border: "1px solid rgba(215,181,109,0.25)" };
  if (status === "bathroom") return { background: "rgba(181,156,255,0.10)", border: "1px solid rgba(181,156,255,0.25)" };
  return { background: "rgba(120,255,190,0.10)", border: "1px solid rgba(120,255,190,0.25)" };
}

function secondsAgo(ts: string | null) {
  if (!ts) return null;
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s;
}

function statusLabel(s: string) {
  switch (s) {
    case "pending":
      return "⏳ Pendiente";
    case "calling":
      return "📞 Llamando";
    case "answered":
      return "✅ Contestó";
    case "no_answer":
      return "🚫 No contesta";
    case "busy":
      return "📵 Ocupado";
    case "wrong_number":
      return "❌ Número mal";
    case "callback":
      return "🔁 Llamar luego";
    case "done":
      return "✅ Hecho";
    default:
      return s || "—";
  }
}

const OUTBOUND_ACTIONS: { key: string; label: string }[] = [
  { key: "no_answer", label: "🚫 No contesta" },
  { key: "busy", label: "📵 Ocupado" },
  { key: "callback", label: "🔁 Llamar luego" },
  { key: "answered", label: "✅ Contestó" },
  { key: "wrong_number", label: "❌ Número mal" },
  { key: "done", label: "✅ Done" },
];

type PresenceRow = {
  worker_id: string;
  display_name: string;
  team_key: string | null;
  online: boolean;
  status: string;
  last_event_at: string | null;
  last_seen_seconds: number | null;
};

type ExpectedRow = {
  worker_id: string;
  display_name: string;
  start_time?: string | null;
  end_time?: string | null;
  timezone?: string | null;
  schedule_id?: string | null;
  online?: boolean;
  status?: string | null;
};

// --- CHAT TYPES (flexibles para tu backend) ---
type ChatThread = {
  id: string;
  title?: string | null;
  tarotist_display_name?: string | null;
  tarotist_worker_id?: string | null;
  last_message_text?: string | null;
  last_message_at?: string | null;
  unread_count?: number | null;
};

type ChatMessage = {
  id: string;
  thread_id: string;
  sender_worker_id?: string | null;
  sender_display_name?: string | null;
  text?: string | null;
  created_at?: string | null;
};

export default function Central() {
  const [ok, setOk] = useState(false);
  const [tab, setTab] = useState<TabKey>("equipo");
  const [month, setMonth] = useState(monthKeyNow());

  const [rank, setRank] = useState<any>(null);
  const [rankMsg, setRankMsg] = useState("");

  const [tarotists, setTarotists] = useState<any[]>([]);
  const [tarotistsLoading, setTarotistsLoading] = useState(false);
  const [tarotistsMsg, setTarotistsMsg] = useState("");

  const [incWorkerId, setIncWorkerId] = useState("");
  const [incAmount, setIncAmount] = useState("5");
  const [incReason, setIncReason] = useState("No contesta llamada");
  const [incMsg, setIncMsg] = useState("");
  const [incLoading, setIncLoading] = useState(false);

  const [q, setQ] = useState("");

  // checklist tarotistas (turno actual)
  const [clLoading, setClLoading] = useState(false);
  const [clMsg, setClMsg] = useState("");
  const [clShiftKey, setClShiftKey] = useState<string>("");
  const [clRows, setClRows] = useState<any[]>([]);
  const [clQ, setClQ] = useState("");

  // ✅ attendance (online real) - Central (self)
  const [attLoading, setAttLoading] = useState(false);
  const [attMsg, setAttMsg] = useState("");
  const [attOnline, setAttOnline] = useState(false);
  const [attStatus, setAttStatus] = useState<string>("offline");
  const attBeatRef = useRef<any>(null);

  // ✅ presencias tarotistas
  const [presLoading, setPresLoading] = useState(false);
  const [presMsg, setPresMsg] = useState("");
  const [presences, setPresences] = useState<PresenceRow[]>([]);
  const [presQ, setPresQ] = useState("");

  // ✅ deberían estar conectadas
  const [expLoading, setExpLoading] = useState(false);
  const [expMsg, setExpMsg] = useState("");
  const [expected, setExpected] = useState<ExpectedRow[]>([]);
  const [expQ, setExpQ] = useState("");

  // ✅ outbound calls (central)
  const [obDate, setObDate] = useState(dayKeyNow());
  const [obLoading, setObLoading] = useState(false);
  const [obMsg, setObMsg] = useState("");
  const [obBatches, setObBatches] = useState<any[]>([]);
  const obChannelsRef = useRef<any[]>([]);

  const batchIdsKey = useMemo(() => {
    return (obBatches || []).map((b: any) => String(b?.id || "")).filter(Boolean).join(",");
  }, [obBatches]);

  // ✅ CHAT (central/admin ve todos)
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMsg, setChatMsg] = useState("");
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadQ, setThreadQ] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [msgText, setMsgText] = useState("");
  const msgEndRef = useRef<HTMLDivElement | null>(null);

  // 🔥 NUEVO: estado realtime + polling fallback (sin tocar tu arquitectura)
  const chatChannelRef = useRef<any>(null);
  const chatPollRef = useRef<any>(null);
  const [chatRealtimeOk, setChatRealtimeOk] = useState<boolean>(false);

  function cleanupChat() {
    if (chatChannelRef.current) {
      sb.removeChannel(chatChannelRef.current);
      chatChannelRef.current = null;
    }
    if (chatPollRef.current) {
      clearInterval(chatPollRef.current);
      chatPollRef.current = null;
    }
  }

  useEffect(() => {
    (async () => {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return (window.location.href = "/login");

      const me = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
      if (!me?.ok) return (window.location.href = "/login");

      if (me.role !== "central") {
        window.location.href = me.role === "admin" ? "/admin" : "/panel-tarotista";
        return;
      }

      setOk(true);
    })();
  }, []);

  async function loadAttendanceMe(silent = false) {
    if (attLoading && !silent) return;
    if (!silent) {
      setAttLoading(true);
      setAttMsg("");
    }
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const res = await fetch("/api/attendance/me", { headers: { Authorization: `Bearer ${token}` } });
      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setAttOnline(!!j.online);
      setAttStatus(String(j.status || (j.online ? "working" : "offline")));
      if (!silent) setAttMsg("");
    } catch (e: any) {
      if (!silent) setAttMsg(`❌ Estado: ${e?.message || "Error"}`);
      setAttOnline(false);
      setAttStatus("offline");
    } finally {
      if (!silent) setAttLoading(false);
    }
  }

  async function postAttendanceEvent(event_type: "online" | "offline" | "heartbeat", metaExtra: any = {}) {
    try {
      setAttMsg("");
      setAttLoading(true);

      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const res = await fetch("/api/attendance/event", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type,
          meta: { path: window.location.pathname, ...metaExtra },
        }),
      });

      const j = await safeJson(res);

      if (!j?._ok || !j?.ok) {
        const err = String(j?.error || `HTTP ${j?._status}`);
        if (err === "OUTSIDE_SHIFT") setAttMsg("⛔ Estás fuera de tu turno. No puedes conectarte ahora.");
        else setAttMsg(`❌ ${err}`);
        await loadAttendanceMe(true);
        return;
      }

      if (event_type === "online") {
        await fetch("/api/attendance/event", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            event_type: "heartbeat",
            meta: { path: window.location.pathname, immediate: true },
          }),
        }).catch(() => {});
      }

      await loadAttendanceMe(true);
      setAttMsg("✅ Listo");
      setTimeout(() => setAttMsg(""), 1000);
    } catch (e: any) {
      setAttMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setAttLoading(false);
    }
  }

  // ✅ Heartbeat SOLO si está online real
  useEffect(() => {
    if (!ok) return;

    if (attBeatRef.current) {
      clearInterval(attBeatRef.current);
      attBeatRef.current = null;
    }

    if (!attOnline) return;

    let stopped = false;

    const start = async () => {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const ping = async () => {
        if (stopped) return;
        await fetch("/api/attendance/event", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ event_type: "heartbeat", meta: { path: window.location.pathname } }),
        }).catch(() => {});
      };

      await ping();
      attBeatRef.current = setInterval(ping, 30_000);
    };

    start();

    return () => {
      stopped = true;
      if (attBeatRef.current) clearInterval(attBeatRef.current);
      attBeatRef.current = null;
    };
  }, [ok, attOnline]);

  useEffect(() => {
    if (!ok) return;
    const t = setInterval(() => loadAttendanceMe(true), 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok]);

  async function refreshRanking() {
    setRankMsg("");
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const rnkRes = await fetch(`/api/rankings/monthly?month=${encodeURIComponent(month)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const rnk = await safeJson(rnkRes);

      if (!rnk?._ok || rnk?.ok === false) {
        setRank(null);
        setRankMsg(`⚠️ Error cargando ranking: ${rnk?.error || `HTTP ${rnk?._status}`}`);
        return;
      }

      setRank(rnk);
    } catch (e: any) {
      setRankMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function loadTarotists() {
    setTarotistsLoading(true);
    setTarotistsMsg("");
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const res = await fetch("/api/central/tarotists", { headers: { Authorization: `Bearer ${token}` } });
      const j = await safeJson(res);

      if (!j?._ok || !j?.ok) {
        setTarotists([]);
        setTarotistsMsg(`❌ No se pudieron cargar tarotistas: ${j?.error || `HTTP ${j?._status}`}`);
        return;
      }

      const list = j.tarotists || [];
      setTarotists(list);
      setTarotistsMsg(list.length ? `✅ Cargadas ${list.length} tarotistas` : "⚠️ No hay tarotistas (¿workers.role='tarotista'?)");

      if (!incWorkerId && list.length) setIncWorkerId(list[0].id);
    } catch (e: any) {
      setTarotists([]);
      setTarotistsMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setTarotistsLoading(false);
    }
  }

  async function loadChecklist() {
    if (clLoading) return;
    setClLoading(true);
    setClMsg("");
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const res = await fetch("/api/central/checklists", { headers: { Authorization: `Bearer ${token}` } });
      const j = await safeJson(res);

      if (!j?._ok || !j?.ok) {
        setClRows([]);
        setClShiftKey("");
        setClMsg(`❌ No se pudo cargar checklist: ${j?.error || `HTTP ${j?._status}`}`);
        return;
      }

      setClShiftKey(String(j.shift_key || ""));
      setClRows(j.rows || []);
      setClMsg(`✅ Checklist cargado (${(j.rows || []).length} tarotistas)`);
    } catch (e: any) {
      setClRows([]);
      setClShiftKey("");
      setClMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setClLoading(false);
    }
  }

  async function loadPresences(silent = false) {
    if (presLoading && !silent) return;
    if (!silent) {
      setPresLoading(true);
      setPresMsg("");
    }

    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const res = await fetch("/api/central/attendance/online", { headers: { Authorization: `Bearer ${token}` } });
      const j = await safeJson(res);

      if (!j?._ok || !j?.ok) {
        setPresences([]);
        setPresMsg(`❌ No se pudo cargar presencias: ${j?.error || `HTTP ${j?._status}`}`);
        return;
      }

      const rows: PresenceRow[] = (j.rows || []).map((r: any) => {
        const last = r.last_event_at ? String(r.last_event_at) : null;
        return {
          worker_id: String(r.worker_id),
          display_name: String(r.display_name || "—"),
          team_key: r.team_key ? String(r.team_key) : null,
          online: !!r.online,
          status: String(r.status || (r.online ? "working" : "offline")),
          last_event_at: last,
          last_seen_seconds: secondsAgo(last),
        };
      });

      setPresences(rows);
      if (!silent) setPresMsg(`✅ Presencias actualizadas (${rows.length})`);
      if (!silent) setTimeout(() => setPresMsg(""), 1200);
    } catch (e: any) {
      setPresences([]);
      setPresMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      if (!silent) setPresLoading(false);
    }
  }

  async function loadExpected(silent = false) {
    if (expLoading && !silent) return;
    if (!silent) {
      setExpLoading(true);
      setExpMsg("");
    }

    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const res = await fetch("/api/central/attendance/expected", { headers: { Authorization: `Bearer ${token}` } });
      const j = await safeJson(res);

      if (!j?._ok || !j?.ok) {
        setExpected([]);
        setExpMsg(`❌ No se pudo cargar “deberían”: ${j?.error || `HTTP ${j?._status}`}`);
        return;
      }

      const rows: ExpectedRow[] = (j.rows || j.expected || []).map((r: any) => ({
        worker_id: String(r.worker_id || r.id || ""),
        display_name: String(r.display_name || r.name || "—"),
        start_time: r.start_time ? String(r.start_time) : null,
        end_time: r.end_time ? String(r.end_time) : null,
        timezone: r.timezone ? String(r.timezone) : null,
        schedule_id: r.schedule_id ? String(r.schedule_id) : null,
        online: r.online != null ? !!r.online : undefined,
        status: r.status != null ? String(r.status) : null,
      }));

      setExpected(rows);
      if (!silent) setExpMsg(`✅ Deberían: ${rows.length}`);
      if (!silent) setTimeout(() => setExpMsg(""), 1200);
    } catch (e: any) {
      setExpected([]);
      setExpMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      if (!silent) setExpLoading(false);
    }
  }

  async function loadOutboundPending(silent = false) {
    if (obLoading && !silent) return;
    if (!silent) {
      setObLoading(true);
      setObMsg("");
    }

    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const res = await fetch(`/api/central/outbound/pending?date=${encodeURIComponent(obDate)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setObBatches(j.batches || []);
      if (!silent) {
        setObMsg(`✅ Pendientes cargados (${(j.batches || []).length} envíos)`);
        setTimeout(() => setObMsg(""), 1200);
      }
    } catch (e: any) {
      if (!silent) setObMsg(`❌ ${e?.message || "Error"}`);
      setObBatches([]);
    } finally {
      if (!silent) setObLoading(false);
    }
  }

  async function outboundLog(item_id: string, status: string) {
    const noteInput = window.prompt("Observación (opcional). Cancelar = no guardar:", "");
    if (noteInput === null) return;
    const note = noteInput.trim() ? noteInput.trim() : null;

    const optimisticAt = new Date().toISOString();
    if (status === "done") {
      setObBatches((prev) =>
        (prev || []).map((b: any) => ({
          ...b,
          outbound_batch_items: (b.outbound_batch_items || []).filter((it: any) => String(it.id) !== String(item_id)),
        }))
      );
    } else {
      setObBatches((prev) =>
        (prev || []).map((b: any) => ({
          ...b,
          outbound_batch_items: (b.outbound_batch_items || []).map((it: any) =>
            String(it.id) === String(item_id)
              ? { ...it, current_status: status, last_note: note ?? it.last_note, last_call_at: optimisticAt }
              : it
          ),
        }))
      );
    }

    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("NO_AUTH");

      const url = "/api/central/outbound/log";
      const payload = { item_id, status, note };

      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = await safeJson(res);

      if (!j?._ok || !j?.ok) {
        throw new Error(`${j?.error || `HTTP ${j?._status}`} · POST ${url} · body=${JSON.stringify(payload)}`);
      }

      const updated = j.item;
      if (updated?.id) {
        setObBatches((prev) =>
          (prev || []).map((b: any) => {
            let items = b.outbound_batch_items || [];
            items = items.map((it: any) => (String(it.id) === String(updated.id) ? { ...it, ...updated } : it));
            items = items.filter((it: any) => String(it.current_status) !== "done");
            return { ...b, outbound_batch_items: items };
          })
        );
      }
    } catch (e: any) {
      alert(`Error: ${e?.message || "ERR"}`);
      loadOutboundPending(true);
    }
  }

  // ---------------- CHAT helpers ----------------
  async function loadChatThreads(silent = false) {
    if (!silent) {
      setChatLoading(true);
      setChatMsg("");
    }
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("NO_AUTH");

      const res = await fetch("/api/central/chat/threads", { headers: { Authorization: `Bearer ${token}` } });
      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      const list: ChatThread[] = (j.threads || j.rows || []).map((t: any) => ({
        id: String(t.id),
        title: t.title != null ? String(t.title) : null,
        tarotist_display_name: t.tarotist_display_name != null ? String(t.tarotist_display_name) : null,
        tarotist_worker_id: t.tarotist_worker_id != null ? String(t.tarotist_worker_id) : null,
        last_message_text: t.last_message_text != null ? String(t.last_message_text) : null,
        last_message_at: t.last_message_at != null ? String(t.last_message_at) : null,
        unread_count: t.unread_count != null ? Number(t.unread_count) : null,
      }));

      list.sort((a, b) => {
        const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return bt - at;
      });

      setThreads(list);
      if (!selectedThreadId && list.length) setSelectedThreadId(list[0].id);

      if (!silent) {
        setChatMsg(list.length ? `✅ Chats cargados (${list.length})` : "⚠️ No hay chats todavía");
        setTimeout(() => setChatMsg(""), 1200);
      }
    } catch (e: any) {
      setThreads([]);
      if (!silent) setChatMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      if (!silent) setChatLoading(false);
    }
  }

  async function loadChatMessages(threadId: string, silent = false) {
    if (!threadId) return;
    if (!silent) {
      setChatLoading(true);
      setChatMsg("");
    }
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("NO_AUTH");

      const res = await fetch(`/api/central/chat/messages?thread_id=${encodeURIComponent(threadId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      const list: ChatMessage[] = (j.messages || j.rows || []).map((m: any) => ({
        id: String(m.id),
        thread_id: String(m.thread_id || threadId),
        sender_worker_id: m.sender_worker_id != null ? String(m.sender_worker_id) : null,
        sender_display_name: m.sender_display_name != null ? String(m.sender_display_name) : null,
        text: m.text != null ? String(m.text) : "",
        created_at: m.created_at != null ? String(m.created_at) : null,
      }));

      list.sort((a, b) => {
        const at = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
        return at - bt;
      });

      setMessages(list);
      if (!silent) setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e: any) {
      setMessages([]);
      if (!silent) setChatMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      if (!silent) setChatLoading(false);
    }
  }

  async function sendChatMessage() {
    const text = msgText.trim();
    if (!text) return;
    if (!selectedThreadId) return;

    const tmpId = `tmp-${Date.now()}`;
    const optimistic: ChatMessage = {
      id: tmpId,
      thread_id: selectedThreadId,
      text,
      created_at: new Date().toISOString(),
      sender_worker_id: "me",
      sender_display_name: "Yo",
    };

    setMessages((prev) => [...(prev || []), optimistic]);
    setMsgText("");
    setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("NO_AUTH");

      const res = await fetch("/api/central/chat/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: selectedThreadId, text }),
      });

      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      const saved = j.message || j.item || null;
      if (saved?.id) {
        const normalized: ChatMessage = {
          id: String(saved.id),
          thread_id: String(saved.thread_id || selectedThreadId),
          sender_worker_id: saved.sender_worker_id != null ? String(saved.sender_worker_id) : null,
          sender_display_name: saved.sender_display_name != null ? String(saved.sender_display_name) : null,
          text: saved.text != null ? String(saved.text) : text,
          created_at: saved.created_at != null ? String(saved.created_at) : new Date().toISOString(),
        };
        setMessages((prev) => (prev || []).map((m) => (m.id === tmpId ? normalized : m)));
      } else {
        loadChatMessages(selectedThreadId, true);
      }

      loadChatThreads(true);
    } catch (e: any) {
      setMessages((prev) => (prev || []).filter((m) => m.id !== tmpId));
      alert(`Error: ${e?.message || "ERR"}`);
    }
  }

  async function trySubscribeChat(threadId: string) {
    cleanupChat();
    setChatRealtimeOk(false);

    if (!threadId) return;

    // Intento realtime
    try {
      const ch = sb
        .channel(`central-chat-${threadId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "chat_messages", filter: `thread_id=eq.${threadId}` },
          (payload) => {
            const m: any = payload.new;

            setMessages((prev) => {
              const exists = (prev || []).some((x: any) => String(x.id) === String(m.id));
              if (exists) return prev;

              const msg: ChatMessage = {
                id: String(m.id),
                thread_id: String(m.thread_id),
                sender_worker_id: m.sender_worker_id != null ? String(m.sender_worker_id) : null,
                sender_display_name: m.sender_display_name != null ? String(m.sender_display_name) : null,
                text: m.text != null ? String(m.text) : "",
                created_at: m.created_at != null ? String(m.created_at) : null,
              };

              return [...(prev || []), msg];
            });

            loadChatThreads(true);
            setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
          }
        )
        .subscribe((status: any) => {
          // Si se suscribe bien, marcamos ok y apagamos polling
          if (status === "SUBSCRIBED") {
            setChatRealtimeOk(true);
            if (chatPollRef.current) {
              clearInterval(chatPollRef.current);
              chatPollRef.current = null;
            }
          }
          // Si falla o se cierra, hacemos fallback a polling
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setChatRealtimeOk(false);
            if (!chatPollRef.current) {
              chatPollRef.current = setInterval(() => loadChatMessages(threadId, true), 5000);
            }
          }
        });

      chatChannelRef.current = ch;

      // Si en 2.5s no está subscribed, polling (evita quedarse muerto)
      setTimeout(() => {
        if (!chatRealtimeOk && !chatPollRef.current) {
          chatPollRef.current = setInterval(() => loadChatMessages(threadId, true), 5000);
        }
      }, 2500);
    } catch {
      // fallback directo
      if (!chatPollRef.current) {
        chatPollRef.current = setInterval(() => loadChatMessages(threadId, true), 5000);
      }
    }
  }

  // ---------------- INIT LOADS ----------------
  useEffect(() => {
    if (!ok) return;
    refreshRanking();
    loadTarotists();
    loadAttendanceMe(true);
    loadPresences(true);
    loadExpected(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok]);

  useEffect(() => {
    if (!ok) return;
    refreshRanking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  useEffect(() => {
    if (!ok) return;
    if (tab === "incidencias") loadTarotists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (!ok) return;
    if (tab === "checklist") loadChecklist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (!ok) return;
    const t = setInterval(() => loadPresences(true), 20_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok]);

  useEffect(() => {
    if (!ok) return;
    const t = setInterval(() => loadExpected(true), 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok]);

  useEffect(() => {
    if (!ok) return;
    if (tab === "llamadas") loadOutboundPending(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, ok, obDate]);

  // al entrar a chat, carga threads
  useEffect(() => {
    if (!ok) return;
    if (tab !== "chat") return;
    loadChatThreads(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, tab]);

  // al seleccionar thread en chat, carga mensajes + subscribe (realtime o polling)
  useEffect(() => {
    if (!ok) return;

    // si salimos de chat, limpia
    if (tab !== "chat") {
      cleanupChat();
      setChatRealtimeOk(false);
      return;
    }

    if (!selectedThreadId) {
      cleanupChat();
      setChatRealtimeOk(false);
      return;
    }

    loadChatMessages(selectedThreadId, false);
    trySubscribeChat(selectedThreadId);

    return () => {
      cleanupChat();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, tab, selectedThreadId]);

  // ✅ realtime central (UPDATE outbound_batch_items por batch_id)
  useEffect(() => {
    if (!ok) return;

    if (obChannelsRef.current?.length) {
      obChannelsRef.current.forEach((ch) => sb.removeChannel(ch));
      obChannelsRef.current = [];
    }

    const batchIds = (obBatches || []).map((b: any) => String(b.id)).filter(Boolean);
    if (!batchIds.length) return;

    const channels = batchIds.map((bid) =>
      sb
        .channel(`central-outbound-${bid}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "outbound_batch_items", filter: `batch_id=eq.${bid}` },
          (payload) => {
            const updated: any = payload.new;
            setObBatches((prev) =>
              (prev || []).map((b: any) => {
                if (String(b.id) !== bid) return b;
                let items = b.outbound_batch_items || [];
                items = items.map((it: any) => (String(it.id) === String(updated.id) ? { ...it, ...updated } : it));
                items = items.filter((it: any) => String(it.current_status) !== "done");
                return { ...b, outbound_batch_items: items };
              })
            );
          }
        )
        .subscribe()
    );

    obChannelsRef.current = channels;

    return () => {
      channels.forEach((ch) => sb.removeChannel(ch));
      obChannelsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, batchIdsKey]);

  const team = rank?.teams || {};
  const fuego = team?.fuego || {};
  const agua = team?.agua || {};
  const winner = team?.winner || "—";

  const topCaptadas = rank?.top?.captadas || [];
  const topCliente = rank?.top?.cliente || [];
  const topRepite = rank?.top?.repite || [];

  const tarotistsFiltered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return tarotists;
    return (tarotists || []).filter((t) => String(t.display_name || "").toLowerCase().includes(qq));
  }, [tarotists, q]);

  const selectedTarotist = useMemo(() => tarotists.find((t) => t.id === incWorkerId), [tarotists, incWorkerId]);

  const clRowsFiltered = useMemo(() => {
    const qq = clQ.trim().toLowerCase();
    const rows = clRows || [];
    if (!qq) return rows;
    return rows.filter((r) => String(r.display_name || "").toLowerCase().includes(qq));
  }, [clRows, clQ]);

  const clProgress = useMemo(() => {
    const rows = clRows || [];
    const total = rows.length;
    const completed = rows.filter((r) => r.status === "completed").length;
    const inProg = rows.filter((r) => r.status === "in_progress").length;
    const notStarted = rows.filter((r) => r.status === "not_started").length;
    return { total, completed, inProg, notStarted };
  }, [clRows]);

  const presencesFiltered = useMemo(() => {
    const qq = presQ.trim().toLowerCase();
    let rows = presences || [];
    rows = rows.filter((r) => !!r.online);
    if (qq) rows = rows.filter((r) => String(r.display_name || "").toLowerCase().includes(qq));
    return rows.slice().sort((a, b) => {
      const as = a.last_seen_seconds ?? 999999;
      const bs = b.last_seen_seconds ?? 999999;
      if (as !== bs) return as - bs;
      return String(a.display_name).localeCompare(String(b.display_name));
    });
  }, [presences, presQ]);

  const expectedFiltered = useMemo(() => {
    const qq = expQ.trim().toLowerCase();
    let rows = expected || [];
    if (qq) rows = rows.filter((r) => String(r.display_name || "").toLowerCase().includes(qq));
    return rows.slice().sort((a, b) => String(a.display_name).localeCompare(String(b.display_name)));
  }, [expected, expQ]);

  const threadsFiltered = useMemo(() => {
    const qq = threadQ.trim().toLowerCase();
    let rows = threads || [];
    if (!qq) return rows;
    return rows.filter((t) => {
      const name = String(t.tarotist_display_name || t.title || "");
      return name.toLowerCase().includes(qq);
    });
  }, [threads, threadQ]);

  async function crearIncidencia() {
    if (incLoading) return;
    setIncLoading(true);
    setIncMsg("");
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return (window.location.href = "/login");

      const res = await fetch("/api/central/incidents", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          worker_id: incWorkerId,
          amount: Number(String(incAmount).replace(",", ".")),
          reason: incReason,
          month_key: month,
        }),
      });

      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setIncMsg("✅ Incidencia creada. (Para reflejarlo en factura: generar facturas del mes.)");
    } catch (e: any) {
      setIncMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setIncLoading(false);
    }
  }

  if (!ok) return <div style={{ padding: 40 }}>Cargando…</div>;

  return (
    <>
      <AppHeader />

      <div className="tc-wrap">
        <div className="tc-container">
          <div className="tc-card">
            <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div className="tc-title" style={{ fontSize: 18 }}>
                  🎧 Panel Central
                </div>
                <div className="tc-sub">Competición · Checklist · Incidencias · Ranking · Presencias · Chat</div>
              </div>

              <div className="tc-row" style={{ flexWrap: "wrap", gap: 8 }}>
                <span
                  className="tc-chip"
                  style={{
                    ...attStyle(attOnline, attStatus),
                    padding: "6px 10px",
                    borderRadius: 999,
                    fontSize: 12,
                  }}
                  title={attStatus}
                >
                  {attLabel(attOnline, attStatus)}
                </span>

                <button
                  className="tc-btn tc-btn-ok"
                  onClick={() => postAttendanceEvent("online", { action: "check_in" })}
                  disabled={attLoading || attOnline}
                  title="Solo te conecta si estás en turno"
                >
                  🟢 Conectarme
                </button>
                <button
                  className="tc-btn tc-btn-danger"
                  onClick={() => postAttendanceEvent("offline", { action: "check_out" })}
                  disabled={attLoading || !attOnline}
                >
                  🔴 Desconectarme
                </button>

                <button
                  className="tc-btn"
                  onClick={() => postAttendanceEvent("online", { action: "break", phase: "start" })}
                  disabled={attLoading || !attOnline || attStatus === "break"}
                >
                  ⏸️ Descanso
                </button>
                <button
                  className="tc-btn"
                  onClick={() => postAttendanceEvent("online", { action: "break", phase: "end" })}
                  disabled={attLoading || !attOnline || attStatus !== "break"}
                >
                  ▶️ Volver
                </button>

                <button
                  className="tc-btn"
                  onClick={() => postAttendanceEvent("online", { action: "bathroom", phase: "start" })}
                  disabled={attLoading || !attOnline || attStatus === "bathroom"}
                >
                  🚻 Baño
                </button>
                <button
                  className="tc-btn"
                  onClick={() => postAttendanceEvent("online", { action: "bathroom", phase: "end" })}
                  disabled={attLoading || !attOnline || attStatus !== "bathroom"}
                >
                  ✅ Salí
                </button>

                <span className="tc-chip">Mes</span>
                <input
                  className="tc-input"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  placeholder="2026-02"
                  style={{ width: 120 }}
                />
                <button className="tc-btn tc-btn-gold" onClick={refreshRanking}>
                  Actualizar
                </button>
              </div>
            </div>

            {attMsg ? (
              <div className="tc-sub" style={{ marginTop: 10 }}>
                {attMsg}
              </div>
            ) : null}

            <div style={{ marginTop: 12 }} className="tc-tabs">
              <button className={`tc-tab ${tab === "equipo" ? "tc-tab-active" : ""}`} onClick={() => setTab("equipo")}>
                🔥💧 Equipo
              </button>
              <button className={`tc-tab ${tab === "llamadas" ? "tc-tab-active" : ""}`} onClick={() => setTab("llamadas")}>
                📞 Llamadas
              </button>
              <button className={`tc-tab ${tab === "chat" ? "tc-tab-active" : ""}`} onClick={() => setTab("chat")}>
                💬 Chat
              </button>
              <button className={`tc-tab ${tab === "checklist" ? "tc-tab-active" : ""}`} onClick={() => setTab("checklist")}>
                ✅ Checklist
              </button>
              <button className={`tc-tab ${tab === "incidencias" ? "tc-tab-active" : ""}`} onClick={() => setTab("incidencias")}>
                ⚠️ Incidencias
              </button>
              <button className={`tc-tab ${tab === "ranking" ? "tc-tab-active" : ""}`} onClick={() => setTab("ranking")}>
                🏆 Ranking
              </button>
            </div>
          </div>

          {/* ✅ CHAT */}
          {tab === "chat" && (
            <div className="tc-card">
              <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div className="tc-title">💬 Chat (Tarotistas ↔ Centrales)</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Centrales ven todos los chats ·{" "}
                    <b>{chatRealtimeOk ? "Realtime ✅" : "Polling ⏳"}</b>
                    {chatMsg ? ` · ${chatMsg}` : ""}
                  </div>
                </div>

                <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button className="tc-btn tc-btn-gold" onClick={() => loadChatThreads(false)} disabled={chatLoading}>
                    {chatLoading ? "Cargando…" : "Recargar chats"}
                  </button>
                </div>
              </div>

              <div className="tc-hr" />

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "320px 1fr",
                  gap: 12,
                  alignItems: "stretch",
                }}
              >
                {/* Left: threads */}
                <div
                  style={{
                    border: "1px solid rgba(255,255,255,0.10)",
                    borderRadius: 14,
                    background: "rgba(255,255,255,0.03)",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 520,
                  }}
                >
                  <div style={{ padding: 12 }}>
                    <input
                      className="tc-input"
                      value={threadQ}
                      onChange={(e) => setThreadQ(e.target.value)}
                      placeholder="Buscar chat…"
                      style={{ width: "100%" }}
                    />
                  </div>
                  <div className="tc-hr" style={{ margin: 0 }} />

                  <div style={{ padding: 8, display: "grid", gap: 8, overflow: "auto" }}>
                    {(threadsFiltered || []).map((t) => {
                      const active = String(t.id) === String(selectedThreadId);
                      const title = t.tarotist_display_name || t.title || `Chat ${t.id.slice(0, 6)}`;
                      const sub = t.last_message_text ? t.last_message_text : "—";
                      return (
                        <button
                          key={t.id}
                          onClick={() => setSelectedThreadId(t.id)}
                          className="tc-btn"
                          style={{
                            textAlign: "left",
                            padding: 10,
                            borderRadius: 12,
                            border: active ? "1px solid rgba(215,181,109,0.35)" : "1px solid rgba(255,255,255,0.10)",
                            background: active ? "rgba(215,181,109,0.10)" : "rgba(255,255,255,0.02)",
                          }}
                        >
                          <div className="tc-row" style={{ justifyContent: "space-between", gap: 10 }}>
                            <div style={{ fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
                            {t.unread_count ? <span className="tc-chip">{t.unread_count}</span> : null}
                          </div>
                          <div
                            className="tc-sub"
                            style={{
                              marginTop: 6,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {sub}
                          </div>
                        </button>
                      );
                    })}

                    {(!threadsFiltered || threadsFiltered.length === 0) && (
                      <div className="tc-sub" style={{ padding: 10 }}>
                        No hay chats todavía.
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: messages */}
                <div
                  style={{
                    border: "1px solid rgba(255,255,255,0.10)",
                    borderRadius: 14,
                    background: "rgba(255,255,255,0.03)",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 520,
                  }}
                >
                  <div style={{ padding: 12 }}>
                    <div style={{ fontWeight: 900 }}>
                      {selectedThreadId
                        ? threads.find((x) => String(x.id) === String(selectedThreadId))?.tarotist_display_name ||
                          threads.find((x) => String(x.id) === String(selectedThreadId))?.title ||
                          `Chat ${selectedThreadId.slice(0, 6)}`
                        : "Selecciona un chat"}
                    </div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      {selectedThreadId ? `Thread: ${selectedThreadId}` : "—"}
                    </div>
                  </div>

                  <div className="tc-hr" style={{ margin: 0 }} />

                  <div style={{ padding: 12, overflow: "auto", flex: 1, display: "grid", gap: 10 }}>
                    {(messages || []).map((m) => {
                      const who = m.sender_display_name || m.sender_worker_id || "—";
                      const when = m.created_at ? new Date(m.created_at).toLocaleString("es-ES") : "";
                      return (
                        <div
                          key={m.id}
                          style={{
                            border: "1px solid rgba(255,255,255,0.10)",
                            borderRadius: 14,
                            padding: 10,
                            background: "rgba(255,255,255,0.02)",
                          }}
                        >
                          <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                            <div style={{ fontWeight: 900 }}>{who}</div>
                            <div className="tc-sub">{when}</div>
                          </div>
                          <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{m.text || ""}</div>
                        </div>
                      );
                    })}
                    {(!messages || messages.length === 0) && <div className="tc-sub">No hay mensajes todavía en este chat.</div>}
                    <div ref={msgEndRef} />
                  </div>

                  <div className="tc-hr" style={{ margin: 0 }} />

                  <div style={{ padding: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      className="tc-input"
                      value={msgText}
                      onChange={(e) => setMsgText(e.target.value)}
                      placeholder={selectedThreadId ? "Escribe un mensaje…" : "Selecciona un chat…"}
                      style={{ flex: 1, minWidth: 240 }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          sendChatMessage();
                        }
                      }}
                      disabled={!selectedThreadId}
                    />
                    <button className="tc-btn tc-btn-gold" onClick={sendChatMessage} disabled={!selectedThreadId || !msgText.trim()}>
                      Enviar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ✅ OUTBOUND LLAMADAS */}
          {tab === "llamadas" && (
            <div className="tc-card">{/* ... TU CÓDIGO DE LLAMADAS SIN CAMBIOS ... */}</div>
          )}

          {/* ✅ PRESENCIAS */}
          {tab === "equipo" && (
            <div className="tc-card">{/* ... TU CÓDIGO DE EQUIPO/PRESENCIAS SIN CAMBIOS ... */}</div>
          )}

          {/* ✅ DEBERÍAN */}
          {tab === "equipo" && (
            <div className="tc-card">{/* ... TU CÓDIGO DE DEBERÍAN SIN CAMBIOS ... */}</div>
          )}

          {/* Competición */}
          {tab === "equipo" && (
            <div className="tc-card">{/* ... TU CÓDIGO DE COMPETICIÓN SIN CAMBIOS ... */}</div>
          )}

          {/* Checklist */}
          {tab === "checklist" && (
            <div className="tc-card">{/* ... TU CÓDIGO DE CHECKLIST SIN CAMBIOS ... */}</div>
          )}

          {/* Incidencias */}
          {tab === "incidencias" && (
            <div className="tc-card">{/* ... TU CÓDIGO DE INCIDENCIAS SIN CAMBIOS ... */}</div>
          )}

          {/* Ranking */}
          {tab === "ranking" && (
            <div className="tc-card">{/* ... TU CÓDIGO DE RANKING SIN CAMBIOS ... */}</div>
          )}
        </div>
      </div>
    </>
  );
}

function TeamBar({
  title,
  score,
  pct,
  aCliente,
  aRepite,
  isWinner,
}: {
  title: string;
  score: number;
  pct: number;
  aCliente: number;
  aRepite: number;
  isWinner: boolean;
}) {
  return (
    <div className="tc-card" style={{ boxShadow: "none", padding: 14 }}>
      <div className="tc-row" style={{ justifyContent: "space-between" }}>
        <div className="tc-title" style={{ fontSize: 14 }}>
          {title} {isWinner ? "👑" : ""}
        </div>
        <div style={{ fontWeight: 900 }}>{Number(score || 0).toFixed(2)}</div>
      </div>

      <div style={{ marginTop: 10, height: 12, borderRadius: 999, background: "rgba(255,255,255,0.10)", overflow: "hidden" }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: isWinner
              ? "linear-gradient(90deg, rgba(120,255,190,0.85), rgba(215,181,109,0.95))"
              : "linear-gradient(90deg, rgba(181,156,255,0.85), rgba(215,181,109,0.65))",
          }}
        />
      </div>

      <div className="tc-sub" style={{ marginTop: 10 }}>
        Media %Cliente: <b>{Number(aCliente || 0).toFixed(2)}%</b> · Media %Repite: <b>{Number(aRepite || 0).toFixed(2)}%</b>
      </div>
    </div>
  );
}

function TopCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="tc-card" style={{ boxShadow: "none", padding: 14 }}>
      <div className="tc-title" style={{ fontSize: 14 }}>
        🏆 {title}
      </div>
      <div className="tc-hr" />
      <div style={{ display: "grid", gap: 8 }}>
        {(items || []).slice(0, 3).map((t, i) => (
          <div key={i} className="tc-row" style={{ justifyContent: "space-between" }}>
            <span>
              {i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"} {t}
            </span>
          </div>
        ))}
        {(!items || items.length === 0) && <div className="tc-sub">Sin datos</div>}
      </div>
    </div>
  );
}
