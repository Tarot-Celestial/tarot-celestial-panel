// src/app/panel-central/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { supabaseBrowser } from "@/lib/supabase-browser";
import CRMClientesPanel from "@/components/crm/CRMClientesPanel";
import ReservasPanel from "@/components/reservas/ReservasPanel";
import HabitualesPanel from "@/components/habituales/HabitualesPanel";
import RendimientoPanel from "@/components/rendimiento/RendimientoPanel";
import CaptacionPanel from "@/components/captacion/CaptacionPanel";
import ReservasGlobalWatcher from "@/components/reservas/ReservasGlobalWatcher";
import PaymentMotivationWatcher from "@/components/motivation/PaymentMotivationWatcher";
import { BarChart3, CalendarDays, CheckSquare, Headphones, Megaphone, MessageSquare, Phone, ShieldCheck, Star, Users } from "lucide-react";

const sb = supabaseBrowser();

const TABS = [
  "equipo",
  "crm",
  "chat",
  "reservas",
  "diario",
  "captacion",
  "incidencias",
  "checklist",
  "llamadas",
  "rendimiento",
  "habituales",
] as const;

type TabKey = typeof TABS[number];

const CENTRAL_NAV: {
  key: TabKey;
  label: string;
  icon: any;
  kicker?: string;
}[] = [
  { key: "equipo", label: "Equipo", icon: Users },
  { key: "crm", label: "CRM", icon: Users },
  { key: "chat", label: "Chat", icon: MessageSquare },
  { key: "reservas", label: "Reservas", icon: CalendarDays },
  { key: "diario", label: "Diario", icon: BarChart3 },
  { key: "captacion", label: "Captación", icon: Megaphone },
  { key: "incidencias", label: "Incidencias", icon: ShieldCheck },
  { key: "checklist", label: "Checklist", icon: CheckSquare },
  { key: "llamadas", label: "Llamadas", icon: Phone },
  { key: "rendimiento", label: "Rendimiento", icon: BarChart3 },
  { key: "habituales", label: "Habituales", icon: Star },
];

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
  const searchParams = useSearchParams();
  const [ok, setOk] = useState(false);
  const [tab, setTab] = useState<TabKey>("equipo");

  useEffect(() => {
    const requestedTab = String(searchParams?.get("tab") || "").trim().toLowerCase();
    if (!requestedTab) return;
    const allowedTabs = new Set<TabKey>(TABS);
    if (allowedTabs.has(requestedTab as TabKey)) {
      setTab(requestedTab as TabKey);
    }
  }, [searchParams]);
  const [crmCloseNotif, setCrmCloseNotif] = useState<any>(null);
  const [crmDismissedIds, setCrmDismissedIds] = useState<string[]>([]);
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
  const chatChannelRef = useRef<any>(null);

  // ✅ NUEVO: abrir chat directamente con tarotista
  const [newChatWorkerId, setNewChatWorkerId] = useState<string>("");
  const [newChatMsg, setNewChatMsg] = useState<string>("");

  useEffect(() => {
    const openCaptacion = () => setTab("captacion");
    window.addEventListener("tc-open-captacion", openCaptacion as EventListener);
    return () => window.removeEventListener("tc-open-captacion", openCaptacion as EventListener);
  }, []);

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

  useEffect(() => {
    if (!ok) return;

    loadLatestCrmCloseNotif(true);

    const channel = sb
      .channel("crm-close-notifs-central")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "crm_call_close_notifications",
        },
        (payload) => {
          const n: any = payload.new;
          if (!crmDismissedIds.includes(String(n?.id || ""))) {
            setCrmCloseNotif(n);
          }
        }
      )
      .subscribe();

    const timer = setInterval(() => {
      loadLatestCrmCloseNotif(true);
    }, 10000);

    return () => {
      clearInterval(timer);
      sb.removeChannel(channel);
    };
  }, [ok, crmDismissedIds]);



  async function loadLatestCrmCloseNotif(silent = false) {
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      const r = await fetch("/api/central/crm/call-close-notifications/latest", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) return;
      const notif = j.notification || null;
      if (!notif?.id) return;
      if (crmDismissedIds.includes(String(notif.id))) return;
      setCrmCloseNotif(notif);
    } catch {}
  }


  async function markCrmCloseNotifRead(id: string) {
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token || !id) return;

      await fetch("/api/central/crm/call-close-notifications/mark-read", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id }),
      });
    } catch {}
  }

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
  }, [ok, crmDismissedIds]);

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

      // ✅ default selector "nuevo chat"
      if (!newChatWorkerId && list.length) setNewChatWorkerId(String(list[0].id));
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

      // si el seleccionado ya no existe, pillamos el primero
      if (selectedThreadId) {
        const stillExists = list.some((t) => String(t.id) === String(selectedThreadId));
        if (!stillExists) setSelectedThreadId(list[0]?.id || "");
      } else {
        if (list.length) setSelectedThreadId(list[0].id);
      }

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
        text: m.text != null ? String(m.text) : (m.body != null ? String(m.body) : ""),
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
          text: saved.text != null ? String(saved.text) : (saved.body != null ? String(saved.body) : text),
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

  // ✅ NUEVO: abrir chat con una tarotista (crea thread si no existe)
  async function openChatWithTarotist() {
    setNewChatMsg("");
    try {
      if (!newChatWorkerId) {
        setNewChatMsg("⚠️ Selecciona una tarotista.");
        return;
      }

      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("NO_AUTH");

      const res = await fetch("/api/central/chat/open", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tarotist_worker_id: newChatWorkerId }),
      });
      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      const tid = String(j.thread?.id || j.thread_id || "");
      if (!tid) throw new Error("NO_THREAD_ID");

      // refresca threads y selecciona el creado
      await loadChatThreads(true);
      setSelectedThreadId(tid);
      await loadChatMessages(tid, true);

      setNewChatMsg("✅ Chat abierto");
      setTimeout(() => setNewChatMsg(""), 1200);
    } catch (e: any) {
      setNewChatMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  // realtime chat_messages (INSERT) para el thread seleccionado
  useEffect(() => {
    if (!ok) return;

    if (chatChannelRef.current) {
      sb.removeChannel(chatChannelRef.current);
      chatChannelRef.current = null;
    }

    if (!selectedThreadId) return;

    const ch = sb
      .channel(`central-chat-${selectedThreadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `thread_id=eq.${selectedThreadId}` },
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
              text: m.text != null ? String(m.text) : (m.body != null ? String(m.body) : ""),
              created_at: m.created_at != null ? String(m.created_at) : null,
            };

            return [...(prev || []), msg];
          });

          loadChatThreads(true);
          setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
        }
      )
      .subscribe();

    chatChannelRef.current = ch;

    return () => {
      if (chatChannelRef.current) {
        sb.removeChannel(chatChannelRef.current);
        chatChannelRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, selectedThreadId]);

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

  // al entrar a chat, carga threads; al seleccionar thread, carga mensajes
  useEffect(() => {
    if (!ok) return;
    if (tab !== "chat") return;
    loadChatThreads(false);
    // ✅ por si no están cargadas tarotistas (para selector "nuevo chat")
    if (!tarotists?.length) loadTarotists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, tab]);

  useEffect(() => {
    if (!ok) return;
    if (tab !== "chat") return;
    if (!selectedThreadId) return;
    loadChatMessages(selectedThreadId, false);
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


  useEffect(() => {
    function onOpenFromCaptacion(e: any) {
      const id = String(e?.detail?.id || "").trim();
      if (!id) return;
      setTab("crm" as any);
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("crm-open-cliente", { detail: { id } }));
      }, 250);
    }

    window.addEventListener("captacion-open-cliente", onOpenFromCaptacion);
    return () => window.removeEventListener("captacion-open-cliente", onOpenFromCaptacion);
  }, []);

  function openReservaFromPopup(reserva: any) {
    setTab("reservas" as any);
    window.setTimeout(() => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("reservas-open-item", {
            detail: { id: String(reserva?.id || "") },
          })
        );
      }
    }, 250);
  }

  if (!ok) return <div style={{ padding: 40 }}>Cargando…</div>;

  return (
    <>
      <ReservasGlobalWatcher enabled={true} onGoToReserva={openReservaFromPopup} />
      <PaymentMotivationWatcher mode="central" />
      <AppHeader />

      <div className="tc-shell">
        <aside className="tc-sidebar">
          <div className="tc-sidebar-card">
            <div className="tc-sidebar-title">Navegación centrales</div>
            <div className="tc-sidebar-nav">
              {CENTRAL_NAV.map((item) => {
                const Icon = item.icon;
                const active = tab === item.key;
                return (
                  <button
                    key={item.key}
                    className={`tc-sidebtn ${active ? "tc-sidebtn-active" : ""}`}
                    onClick={() => setTab(item.key as TabKey)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                      <div className="tc-chip" style={{ width: 38, height: 38, display: "grid", placeItems: "center", padding: 0 }}>
                        <Icon size={16} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div className="tc-sidebtn-main">{item.label}</div>
                        <div className="tc-sidebtn-kicker">{item.kicker}</div>
                      </div>
                    </div>
                    <span className="tc-sidebtn-dot" />
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <main className="tc-main">
          <section className="tc-hero">
            <div className="tc-hero-top">
              <div>
                <div className="tc-hero-title">🎧 Central — Tarot Celestial</div>
                <div className="tc-hero-sub">Centro operativo premium para llamadas, reservas, chat, checklist y rendimiento del equipo en tiempo real.</div>
              </div>

              <div className="tc-row" style={{ flexWrap: "wrap", gap: 8 }}>
                <span className="tc-chip" style={{ ...attStyle(attOnline, attStatus), padding: "6px 10px", borderRadius: 999, fontSize: 12 }} title={attStatus}>
                  {attLabel(attOnline, attStatus)}
                </span>
                <span className="tc-chip">Mes</span>
                <input
                  className="tc-input"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  placeholder="2026-02"
                  style={{ width: 120 }}
                />
                <button className="tc-btn tc-btn-gold" onClick={refreshRanking}>Actualizar</button>
              </div>
            </div>

            <div className="tc-hero-kpis">
              <div className="tc-kpi-panel tc-kpi-panel-main">
                <div className="tc-kpi-label">Estado central</div>
                <div className="tc-kpi-value" style={{ fontSize: 24 }}>{attLabel(attOnline, attStatus)}</div>
                <div className="tc-kpi-note">Acceso rápido a tu estado operativo y al mes activo</div>
              </div>
              <div className="tc-kpi-panel">
                <div className="tc-kpi-label">Chats</div>
                <div className="tc-kpi-value">{String(threads.length || 0)}</div>
                <div className="tc-kpi-note">Conversaciones cargadas</div>
              </div>
              <div className="tc-kpi-panel">
                <div className="tc-kpi-label">Reservas</div>
                <div className="tc-kpi-value">{String(tab === "reservas" ? "Live" : "Activas")}</div>
                <div className="tc-kpi-note">Seguimiento operativo en tiempo real</div>
              </div>
              <div className="tc-kpi-panel">
                <div className="tc-kpi-label">Módulo activo</div>
                <div className="tc-kpi-value" style={{ fontSize: 20 }}>{String(tab).toUpperCase()}</div>
                <div className="tc-kpi-note">Vista lateral tipo software premium</div>
              </div>
            </div>
          </section>

          <div className="tc-main-content">
{tab === "chat" && (
            <div className="tc-card">
              <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div className="tc-title">💬 Chat (Tarotistas ↔ Centrales)</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Centrales ven todos los chats · Realtime: nuevos mensajes al instante
                    {chatMsg ? ` · ${chatMsg}` : ""}
                  </div>
                </div>

                <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button className="tc-btn tc-btn-gold" onClick={() => loadChatThreads(false)} disabled={chatLoading}>
                    {chatLoading ? "Cargando…" : "Recargar chats"}
                  </button>
                </div>
              </div>

              {/* ✅ NUEVO: abrir chat con tarotista aunque no exista */}
              <div className="tc-hr" />
              <div
                style={{
                  border: "1px solid rgba(255,255,255,0.10)",
                  borderRadius: 14,
                  padding: 12,
                  background: "rgba(255,255,255,0.02)",
                  display: "grid",
                  gap: 10,
                }}
              >
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 900 }}>🟢 Iniciar conversación</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Elige una tarotista y pulsa “Abrir chat”. (Crea el hilo si no existe.)
                      {newChatMsg ? ` · ${newChatMsg}` : ""}
                    </div>
                  </div>

                  <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <select
                      className="tc-select"
                      value={newChatWorkerId}
                      onChange={(e) => setNewChatWorkerId(e.target.value)}
                      style={{ minWidth: 320, maxWidth: "100%" }}
                    >
                      {(tarotists || []).map((t: any) => (
                        <option key={t.id} value={t.id}>
                          {t.display_name} {t.team_key ? `(${t.team_key})` : ""}
                        </option>
                      ))}
                      {(!tarotists || tarotists.length === 0) && <option value="">(Cargando tarotistas…)</option>}
                    </select>

                    <button className="tc-btn tc-btn-ok" onClick={openChatWithTarotist} disabled={!newChatWorkerId}>
                      🟢 Abrir chat
                    </button>

                    <button className="tc-btn" onClick={loadTarotists} disabled={tarotistsLoading}>
                      {tarotistsLoading ? "…" : "Recargar lista"}
                    </button>
                  </div>
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
                            <div style={{ fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {title}
                            </div>
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

          {tab === "crm" && <CRMClientesPanel mode="central" showImportButton={false} />}
          {tab === "captacion" && (
            <CaptacionPanel
              onOpenClient={(clienteId) => {
                setTab("crm" as any);
                window.setTimeout(() => {
                  window.dispatchEvent(new CustomEvent("crm-open-cliente", { detail: { id: String(clienteId) } }));
                }, 250);
              }}
            />
          )}
          {tab === "rendimiento" && <RendimientoPanel mode="central" />}
          {tab === "reservas" && <ReservasPanel mode="central" />}
          {tab === "habituales" && <HabitualesPanel mode="central" />}

          {/* ✅ OUTBOUND LLAMADAS */}
          {tab === "llamadas" && (
            <div className="tc-card">
              <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div className="tc-title">📞 Llamadas del día</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Al marcar <b>Done</b> desaparece al instante · Realtime activado
                    {obMsg ? ` · ${obMsg}` : ""}
                  </div>
                </div>

                <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <span className="tc-chip">Día</span>
                  <input
                    className="tc-input"
                    value={obDate}
                    onChange={(e) => setObDate(e.target.value)}
                    style={{ width: 140 }}
                    placeholder="YYYY-MM-DD"
                  />
                  <button className="tc-btn tc-btn-gold" onClick={() => loadOutboundPending(false)} disabled={obLoading}>
                    {obLoading ? "Cargando…" : "Actualizar"}
                  </button>
                </div>
              </div>

              <div className="tc-hr" />

              <div style={{ display: "grid", gap: 12 }}>
                {(obBatches || []).map((b: any) => {
                  const sender = b.sender || {};
                  const items = (b.outbound_batch_items || []).slice().sort((a: any, c: any) => (a.position ?? 0) - (c.position ?? 0));
                  if (!items.length) return null;

                  return (
                    <div
                      key={b.id}
                      style={{
                        border: "1px solid rgba(255,255,255,0.10)",
                        borderRadius: 14,
                        padding: 12,
                        background: "rgba(255,255,255,0.03)",
                      }}
                    >
                      <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontWeight: 900 }}>
                            {sender.display_name || "Tarotista"}{" "}
                            <span className="tc-chip" style={{ marginLeft: 8 }}>
                              {sender.team || sender.team_key || "—"}
                            </span>
                          </div>
                          {b.note ? <div className="tc-sub" style={{ marginTop: 6 }}>{b.note}</div> : null}
                        </div>
                        <div className="tc-chip">{items.length} pendientes</div>
                      </div>

                      <div className="tc-hr" style={{ margin: "12px 0" }} />

                      <div style={{ display: "grid", gap: 10 }}>
                        {items.map((it: any) => (
                          <div
                            key={it.id}
                            style={{
                              border: "1px solid rgba(255,255,255,0.10)",
                              borderRadius: 14,
                              padding: 12,
                              background: "rgba(255,255,255,0.02)",
                            }}
                          >
                            <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                              <div style={{ minWidth: 260 }}>
                                <div style={{ fontWeight: 900 }}>
                                  {it.customer_name || "—"}{" "}
                                  <span className="tc-chip" style={{ marginLeft: 8 }}>
                                    {statusLabel(String(it.current_status || "pending"))}
                                  </span>
                                </div>
                                {it.phone ? <div className="tc-sub" style={{ marginTop: 6 }}>📱 {it.phone}</div> : null}
                                {it.last_note ? <div className="tc-sub" style={{ marginTop: 6 }}>📝 {it.last_note}</div> : null}
                              </div>

                              <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                                {OUTBOUND_ACTIONS.map((a) => (
                                  <button
                                    key={a.key}
                                    className={`tc-btn ${a.key === "done" ? "tc-btn-ok" : ""}`}
                                    onClick={() => outboundLog(String(it.id), a.key)}
                                  >
                                    {a.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {(!obBatches || obBatches.length === 0) && <div className="tc-sub">No hay listas para este día.</div>}
              </div>
            </div>
          )}

          {/* ✅ PRESENCIAS */}
          {tab === "equipo" && (
            <div className="tc-card">
              <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div className="tc-title">🟢 Presencias Tarotistas</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Solo se muestran conectadas / descanso / baño · Auto-refresh cada 20s
                    {presMsg ? ` · ${presMsg}` : ""}
                  </div>
                </div>

                <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <input
                    className="tc-input"
                    value={presQ}
                    onChange={(e) => setPresQ(e.target.value)}
                    placeholder="Buscar tarotista…"
                    style={{ width: 240, maxWidth: "100%" }}
                  />
                  <button className="tc-btn tc-btn-gold" onClick={() => loadPresences(false)} disabled={presLoading}>
                    {presLoading ? "Cargando…" : "Actualizar presencias"}
                  </button>
                </div>
              </div>

              <div className="tc-hr" />

              <div style={{ display: "grid", gap: 10 }}>
                {(presencesFiltered || []).map((r) => (
                  <div
                    key={r.worker_id}
                    style={{
                      border: "1px solid rgba(255,255,255,0.10)",
                      borderRadius: 14,
                      padding: 12,
                      background: "rgba(255,255,255,0.03)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ minWidth: 240 }}>
                      <div style={{ fontWeight: 900 }}>
                        {r.display_name}{" "}
                        {r.team_key ? <span className="tc-chip" style={{ marginLeft: 8 }}>{r.team_key}</span> : null}
                      </div>
                      <div className="tc-sub" style={{ marginTop: 6 }}>
                        Última señal:{" "}
                        <b>
                          {r.last_seen_seconds == null
                            ? "—"
                            : r.last_seen_seconds < 60
                            ? `hace ${r.last_seen_seconds}s`
                            : `hace ${Math.round(r.last_seen_seconds / 60)}m`}
                        </b>
                      </div>
                    </div>

                    <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                      <span
                        className="tc-chip"
                        style={{
                          ...attStyle(r.online, r.status),
                          padding: "6px 10px",
                          borderRadius: 999,
                          fontSize: 12,
                        }}
                        title={r.status}
                      >
                        {attLabel(r.online, r.status)}
                      </span>
                    </div>
                  </div>
                ))}

                {(!presencesFiltered || presencesFiltered.length === 0) && <div className="tc-sub">No hay tarotistas conectadas ahora mismo.</div>}
              </div>
            </div>
          )}

          {/* ✅ DEBERÍAN */}
          {tab === "equipo" && (
            <div className="tc-card">
              <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div className="tc-title">⏰ Deberían estar conectadas ahora</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Según horarios activos (incluye turnos nocturnos)
                    {expMsg ? ` · ${expMsg}` : ""}
                  </div>
                </div>

                <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <input
                    className="tc-input"
                    value={expQ}
                    onChange={(e) => setExpQ(e.target.value)}
                    placeholder="Buscar…"
                    style={{ width: 240, maxWidth: "100%" }}
                  />
                  <button className="tc-btn tc-btn-gold" onClick={() => loadExpected(false)} disabled={expLoading}>
                    {expLoading ? "Cargando…" : "Actualizar"}
                  </button>
                </div>
              </div>

              <div className="tc-hr" />

              <div style={{ display: "grid", gap: 10 }}>
                {(expectedFiltered || []).map((r) => (
                  <div
                    key={`${r.worker_id}-${r.schedule_id || "x"}`}
                    style={{
                      border: "1px solid rgba(255,255,255,0.10)",
                      borderRadius: 14,
                      padding: 12,
                      background: "rgba(255,255,255,0.03)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ minWidth: 240 }}>
                      <div style={{ fontWeight: 900 }}>{r.display_name}</div>
                      <div className="tc-sub" style={{ marginTop: 6 }}>
                        Turno: <b>{r.start_time || "—"}</b> → <b>{r.end_time || "—"}</b>
                      </div>
                    </div>

                    {typeof r.online === "boolean" ? (
                      <span
                        className="tc-chip"
                        style={{
                          ...attStyle(!!r.online, String(r.status || (r.online ? "working" : "offline"))),
                          padding: "6px 10px",
                          borderRadius: 999,
                          fontSize: 12,
                        }}
                      >
                        {attLabel(!!r.online, String(r.status || (r.online ? "working" : "offline")))}
                      </span>
                    ) : (
                      <span className="tc-chip">En turno</span>
                    )}
                  </div>
                ))}

                {(!expectedFiltered || expectedFiltered.length === 0) && <div className="tc-sub">No hay nadie en turno ahora mismo.</div>}
              </div>
            </div>
          )}

          {/* Competición */}
          {tab === "equipo" && (
            <div className="tc-card">
              <div className="tc-title">🔥💧 Competición por equipos</div>
              <div className="tc-sub" style={{ marginTop: 6 }}>
                Ganador: <b>{winner}</b> · Bono central ganadora: <b>{eur(40)}</b>
                {rankMsg ? ` · ${rankMsg}` : ""}
              </div>

              <div className="tc-hr" />

              <div className="tc-grid-2">
                <TeamBar
                  title="🔥 Fuego (Yami)"
                  score={Number(fuego?.score || 0)}
                  pct={Math.round((Number(fuego?.score || 0) / Math.max(Number(fuego?.score || 0), Number(agua?.score || 0), 1)) * 100)}
                  aCliente={pctAny(fuego?.avg_cliente ?? 0)}
                  aRepite={pctAny(fuego?.avg_repite ?? 0)}
                  isWinner={winner === "fuego"}
                />
                <TeamBar
                  title="💧 Agua (Maria)"
                  score={Number(agua?.score || 0)}
                  pct={Math.round((Number(agua?.score || 0) / Math.max(Number(fuego?.score || 0), Number(agua?.score || 0), 1)) * 100)}
                  aCliente={pctAny(agua?.avg_cliente ?? 0)}
                  aRepite={pctAny(agua?.avg_repite ?? 0)}
                  isWinner={winner === "agua"}
                />
              </div>

              <div className="tc-hr" />
              <div className="tc-sub">Siguiente: “Mejoras de equipo” automático (consejos según %cliente y %repite).</div>
            </div>
          )}

          {/* Checklist */}
          {tab === "checklist" && (
            <div className="tc-card">
              <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div className="tc-title">✅ Checklist Tarotistas (turno actual)</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Turno: <b>{clShiftKey || "—"}</b> · Completadas:{" "}
                    <b>
                      {clProgress.completed}/{clProgress.total}
                    </b>{" "}
                    · En progreso: <b>{clProgress.inProg}</b> · Sin empezar: <b>{clProgress.notStarted}</b>
                  </div>
                </div>

                <div className="tc-row" style={{ flexWrap: "wrap" }}>
                  <button className="tc-btn tc-btn-gold" onClick={loadChecklist} disabled={clLoading}>
                    {clLoading ? "Cargando…" : "Actualizar checklist"}
                  </button>
                </div>
              </div>

              <div className="tc-sub" style={{ marginTop: 10 }}>
                {clMsg || " "}
              </div>

              <div className="tc-hr" />

              <div className="tc-row" style={{ flexWrap: "wrap", gap: 10 }}>
                <input
                  className="tc-input"
                  value={clQ}
                  onChange={(e) => setClQ(e.target.value)}
                  placeholder="Buscar tarotista…"
                  style={{ width: 280, maxWidth: "100%" }}
                />
                <div className="tc-chip">
                  Nota: este checklist se <b>resetea solo</b> con el turno (shift_key).
                </div>
              </div>

              <div className="tc-hr" />

              <div style={{ display: "grid", gap: 10 }}>
                {(clRowsFiltered || []).map((r: any) => (
                  <div
                    key={r.worker_id}
                    style={{
                      border: "1px solid rgba(255,255,255,0.10)",
                      borderRadius: 14,
                      padding: 12,
                      background:
                        r.status === "completed"
                          ? "rgba(120,255,190,0.10)"
                          : r.status === "in_progress"
                          ? "rgba(215,181,109,0.08)"
                          : "rgba(255,255,255,0.03)",
                    }}
                  >
                    <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontWeight: 900 }}>{r.display_name}</div>
                        <div className="tc-sub" style={{ marginTop: 6 }}>
                          Estado:{" "}
                          <b>
                            {r.status === "completed" ? "Completado ✅" : r.status === "in_progress" ? "En progreso ⏳" : "Sin empezar ⬜"}
                          </b>
                          {r.completed_at ? ` · ${new Date(r.completed_at).toLocaleString("es-ES")}` : ""}
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span
                          className="tc-chip"
                          style={{
                            borderColor:
                              r.status === "completed"
                                ? "rgba(120,255,190,0.35)"
                                : r.status === "in_progress"
                                ? "rgba(215,181,109,0.35)"
                                : "rgba(255,255,255,0.14)",
                          }}
                        >
                          {r.status === "completed" ? "OK" : r.status === "in_progress" ? "Casi" : "Pendiente"}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}

                {(!clRowsFiltered || clRowsFiltered.length === 0) && (
                  <div className="tc-sub">No hay tarotistas para este checklist. (Si eres central, solo verás tu equipo.)</div>
                )}
              </div>
            </div>
          )}

          {/* Incidencias */}
          {tab === "incidencias" && (
            <div className="tc-card">
              <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div className="tc-title">⚠️ Incidencias</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Descuenta en la factura del mes seleccionado.
                  </div>
                </div>

                <div className="tc-row" style={{ flexWrap: "wrap" }}>
                  <button className="tc-btn tc-btn-gold" onClick={loadTarotists} disabled={tarotistsLoading}>
                    {tarotistsLoading ? "Cargando…" : "Recargar tarotistas"}
                  </button>
                </div>
              </div>

              <div className="tc-sub" style={{ marginTop: 10 }}>
                {tarotistsMsg || " "}
                {incMsg ? ` · ${incMsg}` : ""}
              </div>

              <div className="tc-hr" />

              <div className="tc-row" style={{ flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                <input
                  className="tc-input"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar tarotista…"
                  style={{ width: 260, maxWidth: "100%" }}
                />

                <select
                  className="tc-select"
                  value={incWorkerId}
                  onChange={(e) => setIncWorkerId(e.target.value)}
                  style={{ minWidth: 360, width: 520, maxWidth: "100%" }}
                >
                  {(tarotistsFiltered || []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.display_name} {t.team_key ? `(${t.team_key})` : ""}
                    </option>
                  ))}
                  {(!tarotistsFiltered || tarotistsFiltered.length === 0) && <option value="">(Sin resultados)</option>}
                </select>

                <input
                  className="tc-input"
                  value={incAmount}
                  onChange={(e) => setIncAmount(e.target.value)}
                  style={{ width: 140 }}
                  placeholder="Importe"
                />

                <input
                  className="tc-input"
                  value={incReason}
                  onChange={(e) => setIncReason(e.target.value)}
                  style={{ width: 360, maxWidth: "100%" }}
                  placeholder="Motivo"
                />

                <button className="tc-btn tc-btn-danger" onClick={crearIncidencia} disabled={incLoading || !incWorkerId}>
                  {incLoading ? "Guardando…" : "Guardar incidencia"}
                </button>
              </div>

              <div className="tc-hr" />

              <div className="tc-sub">
                Seleccionada: <b>{selectedTarotist?.display_name || "—"}</b>{" "}
                {selectedTarotist?.team_key ? (
                  <>
                    · Equipo <b>{selectedTarotist.team_key}</b>
                  </>
                ) : null}
              </div>

              <div className="tc-sub" style={{ marginTop: 8 }}>
                Nota: para que se refleje en facturas, en Admin vuelves a generar facturas del mes.
              </div>
            </div>
          )}

          {/* Ranking */}
          {tab === "ranking" && (
            <div className="tc-card">
              <div className="tc-title">🏆 Top 3 del mes</div>
              <div className="tc-sub" style={{ marginTop: 6 }}>
                Captadas / %Cliente / %Repite {rankMsg ? `· ${rankMsg}` : ""}
              </div>

              <div className="tc-hr" />

              <div className="tc-grid-3">
                <TopCard title="Captadas" items={topCaptadas.map((x: any) => `${x.display_name} (${Number(x.captadas_total || 0)})`)} />
                <TopCard title="Cliente" items={topCliente.map((x: any) => `${x.display_name} (${pctAny(x.pct_cliente).toFixed(2)}%)`)} />
                <TopCard title="Repite" items={topRepite.map((x: any) => `${x.display_name} (${pctAny(x.pct_repite).toFixed(2)}%)`)} />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>

      {crmCloseNotif && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            className="tc-card"
            style={{
              width: "100%",
              maxWidth: 440,
              boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
            }}
          >
            <div className="tc-title">📞 Llamada finalizada</div>
            <div className="tc-sub" style={{ marginTop: 10 }}>
              <b>{crmCloseNotif.tarotista_nombre || "Una tarotista"}</b> ha terminado la llamada
            </div>
            <div className="tc-sub" style={{ marginTop: 6 }}>
              Le han sobrado en total <b>{crmCloseNotif.minutos_sobrantes_total || 0}</b> minutos
            </div>

            <div className="tc-row" style={{ marginTop: 16, justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button
                className="tc-btn"
                onClick={async () => {
                  const notifId = String(crmCloseNotif?.id || "");
                  if (notifId) setCrmDismissedIds((prev) => (prev.includes(notifId) ? prev : [...prev, notifId]));
                  await markCrmCloseNotifRead(notifId);
                  setCrmCloseNotif(null);
                }}
              >
                Cerrar
              </button>
              <button
                className="tc-btn tc-btn-gold"
                onClick={() => {
                  setTab("crm" as any);
                  setTimeout(() => {
                    window.dispatchEvent(
                      new CustomEvent("crm-open-cliente", {
                        detail: { id: crmCloseNotif.cliente_id },
                      })
                    );
                  }, 250);
                  setCrmCloseNotif(null);
                }}
              >
                Revisar
              </button>
            </div>
          </div>
        </div>
      )}

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
