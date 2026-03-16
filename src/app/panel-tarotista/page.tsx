"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

type TabKey =
  | "resumen"
  | "clientes"
  | "bonos"
  | "ranking"
  | "equipos"
  | "facturas"
  | "checklist"
  | "chat";

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthFromUrl() {
  try {
    const u = new URL(window.location.href);
    return u.searchParams.get("month") || monthKeyNow();
  } catch {
    return monthKeyNow();
  }
}

function setMonthInUrl(m: string) {
  try {
    const u = new URL(window.location.href);
    u.searchParams.set("month", m);
    window.history.pushState({}, "", u.toString());
  } catch {}
}

function eur(n: any) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function pct(n: any) {
  const x = Number(n) || 0;
  return `${x.toFixed(2)}%`;
}

function n2(n: any) {
  const x = Number(n) || 0;
  return x.toFixed(2);
}

function capTier(captadas: number) {
  if (captadas >= 30) return { rate: 2.0, label: "2,00€ / captada (30+)", nextAt: null as any };
  if (captadas >= 20) return { rate: 1.5, label: "1,50€ / captada (20+)", nextAt: 30 };
  if (captadas >= 10) return { rate: 1.0, label: "1,00€ / captada (10+)", nextAt: 20 };
  return { rate: 0.5, label: "0,50€ / captada (0-9)", nextAt: 10 };
}

function progressToNext(captadas: number) {
  const t = capTier(captadas);
  if (!t.nextAt) return { pct: 100, text: "Tramo máximo alcanzado 🔥" };
  const prev = t.nextAt === 10 ? 0 : t.nextAt === 20 ? 10 : 20;
  const span = t.nextAt - prev;
  const cur = Math.min(Math.max(captadas - prev, 0), span);
  const p = Math.round((cur / span) * 100);
  const faltan = Math.max(t.nextAt - captadas, 0);
  return { pct: p, text: `Te faltan ${faltan} captadas para subir a ${t.nextAt}+` };
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

function bonusForPos(pos: number | null) {
  if (pos === 1) return 6;
  if (pos === 2) return 4;
  if (pos === 3) return 2;
  return 0;
}

function medalForPos(pos: number | null) {
  if (pos === 1) return "🥇";
  if (pos === 2) return "🥈";
  if (pos === 3) return "🥉";
  return "—";
}

function clampPct(n: number) {
  const x = Number(n) || 0;
  return Math.max(0, Math.min(100, x));
}

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

function getInvoiceVisibleStatus(invoice: any) {
  const ack = String(invoice?.worker_ack || "").trim().toLowerCase();
  if (ack === "accepted" || ack === "rejected" || ack === "review") return ack;
  return String(invoice?.status || "pending");
}

async function getTokenSafe(): Promise<string | null> {
  try {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token || null;
    return token;
  } catch {
    return null;
  }
}

async function getTokenWithRetry(ms = 350, tries = 3): Promise<string | null> {
  for (let i = 0; i < tries; i++) {
    const t = await getTokenSafe();
    if (t) return t;
    await new Promise((r) => setTimeout(r, ms));
  }
  return null;
}

type ChatThread = {
  id: string;
  title?: string | null;
  last_message_text?: string | null;
  last_message_at?: string | null;
};

type ChatMessage = {
  id: string;
  thread_id: string;
  sender_worker_id?: string | null;
  sender_display_name?: string | null;
  text?: string | null;
  created_at?: string | null;
};

export default function Tarotista() {
  const [ok, setOk] = useState(false);
  const [tab, setTab] = useState<TabKey>("resumen");

  const [month, setMonth] = useState(monthKeyNow());
  const [stats, setStats] = useState<any>(null);
  const [rank, setRank] = useState<any>(null);
  const [msg, setMsg] = useState<string>("");

  const [incidents, setIncidents] = useState<any[]>([]);
  const [invoice, setInvoice] = useState<any>(null);
  const [invoiceLines, setInvoiceLines] = useState<any[]>([]);
  const [ackNote, setAckNote] = useState<string>("");

  const [myWorkerId, setMyWorkerId] = useState<string>("");

  const [clLoading, setClLoading] = useState(false);
  const [clMsg, setClMsg] = useState("");
  const [clShiftKey, setClShiftKey] = useState<string>("");
  const [clRows, setClRows] = useState<any[]>([]);
  const [clQ, setClQ] = useState("");

  const [attLoading, setAttLoading] = useState(false);
  const [attMsg, setAttMsg] = useState("");
  const [attOnline, setAttOnline] = useState(false);
  const [attStatus, setAttStatus] = useState<string>("offline");
  const attBeatRef = useRef<any>(null);

  const [obDate, setObDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [obLoading, setObLoading] = useState(false);
  const [obMsg, setObMsg] = useState("");
  const [obBatch, setObBatch] = useState<any>(null);
  const [obItems, setObItems] = useState<any[]>([]);
  const obChannelRef = useRef<any>(null);
  const [obDraft, setObDraft] = useState<string>("");
  const [obSending, setObSending] = useState(false);

  const [chatLoading, setChatLoading] = useState(false);
  const [chatMsg, setChatMsg] = useState("");
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [msgText, setMsgText] = useState("");
  const msgEndRef = useRef<HTMLDivElement | null>(null);
  const chatChannelRef = useRef<any>(null);
  const popupChannelRef = useRef<any>(null);

  const [selectedThreadId, setSelectedThreadId] = useState<string>("");
  const [incomingPopup, setIncomingPopup] = useState<any>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupBusy, setPopupBusy] = useState(false);

  const incidenciasLive = useMemo(() => {
    return (incidents || []).reduce((a, x) => a + Number(x.amount || 0), 0);
  }, [incidents]);

  const s = stats?.stats || {};
  const captadas = Number(s?.captadas_total || 0);
  const tier = capTier(captadas);
  const prog = progressToNext(captadas);

  const payMinutes = Number(s?.pay_minutes || 0);
  const bonusCaptadas = Number(s?.bonus_captadas || 0);

  const bonusRanking = Number(s?.bonus_ranking || 0);
  const br = s?.bonus_ranking_breakdown || {};
  const brCaptadas = Number(br?.captadas || 0);
  const brCliente = Number(br?.cliente || 0);
  const brRepite = Number(br?.repite || 0);

  const bonusTotal = bonusCaptadas + bonusRanking;
  const totalPreview = payMinutes + bonusTotal - incidenciasLive;

  const topCaptadas = rank?.top?.captadas || [];
  const topCliente = rank?.top?.cliente || [];
  const topRepite = rank?.top?.repite || [];

  const posCaptadas: number | null = useMemo(() => {
    const i = (topCaptadas || []).findIndex((x: any) => String(x.worker_id) === String(myWorkerId));
    return i >= 0 ? i + 1 : null;
  }, [topCaptadas, myWorkerId]);

  const posCliente: number | null = useMemo(() => {
    const i = (topCliente || []).findIndex((x: any) => String(x.worker_id) === String(myWorkerId));
    return i >= 0 ? i + 1 : null;
  }, [topCliente, myWorkerId]);

  const posRepite: number | null = useMemo(() => {
    const i = (topRepite || []).findIndex((x: any) => String(x.worker_id) === String(myWorkerId));
    return i >= 0 ? i + 1 : null;
  }, [topRepite, myWorkerId]);

  const clFiltered = useMemo(() => {
    const qq = clQ.trim().toLowerCase();
    if (!qq) return clRows || [];
    return (clRows || []).filter((it: any) =>
      String(it.title || it.label || it.item_key || "").toLowerCase().includes(qq)
    );
  }, [clRows, clQ]);

  const clProgress = useMemo(() => {
    const rows = clRows || [];
    const total = rows.length;
    const completed = rows.filter((r: any) => !!r.done || r.status === "completed" || r.completed === true).length;
    const pct = total ? Math.round((completed / total) * 100) : 0;
    return { total, completed, pct };
  }, [clRows]);

  useEffect(() => {
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (!session) window.location.href = "/login";
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const onPop = () => setMonth(getMonthFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    (async () => {
      const token = await getTokenWithRetry(350, 3);
      if (!token) return (window.location.href = "/login");

      const me = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
      if (!me?.ok) return (window.location.href = "/login");

      if (me.role !== "tarotista") {
        window.location.href = me.role === "admin" ? "/admin" : "/panel-central";
        return;
      }

      const m = getMonthFromUrl();
      setMonth(m);
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
      const token = await getTokenSafe();
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

      const token = await getTokenSafe();
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

  async function loadChecklist() {
    if (clLoading) return;
    setClLoading(true);
    setClMsg("");
    try {
      const token = await getTokenSafe();
      if (!token) return;

      const res = await fetch("/api/checklists/my", { headers: { Authorization: `Bearer ${token}` } });
      const j = await safeJson(res);

      if (!j?._ok || !j?.ok) {
        setClShiftKey("");
        setClRows([]);
        setClMsg(`❌ Checklist: ${j?.error || `HTTP ${j?._status}`}`);
        return;
      }

      setClShiftKey(String(j.shift_key || ""));
      setClRows(j.items || j.rows || []);
      setClMsg(`✅ Checklist cargado (${(j.items || j.rows || []).length} items)`);
    } catch (e: any) {
      setClShiftKey("");
      setClRows([]);
      setClMsg(`❌ Checklist: ${e?.message || "Error"}`);
    } finally {
      setClLoading(false);
    }
  }

  async function toggleChecklistItem(item: any) {
    const item_key = String(item?.item_key || item?.key || item?.id || "");
    if (!item_key) return;

    try {
      setClMsg("");
      const token = await getTokenSafe();
      if (!token) return;

      const res = await fetch("/api/checklists/toggle", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ item_key }),
      });

      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      await loadChecklist();
    } catch (e: any) {
      setClMsg(`❌ No se pudo marcar: ${e?.message || "Error"}`);
    }
  }

  async function refresh(forMonth?: string) {
    try {
      setMsg("");
      const token = await getTokenSafe();
      if (!token) return;

      const m = forMonth || month;
      setMonth(m);

      const sRes = await fetch(`/api/stats/monthly?month=${encodeURIComponent(m)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const rRes = await fetch(`/api/rankings/monthly?month=${encodeURIComponent(m)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const incRes = await fetch(`/api/incidents/my?month=${encodeURIComponent(m)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const invRes = await fetch(`/api/invoices/my?month=${encodeURIComponent(m)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const sJ = await safeJson(sRes);
      const rnkJ = await safeJson(rRes);
      const incJ = await safeJson(incRes);
      const invJ = await safeJson(invRes);

      setStats(sJ);
      setRank(rnkJ);

      const wid = sJ?.worker?.id ? String(sJ.worker.id) : "";
      if (wid) setMyWorkerId(wid);

      if (incJ?._ok && incJ?.ok) setIncidents(incJ.incidents || []);
      else setIncidents([]);

      if (invJ?._ok && invJ?.ok) {
        setInvoice(invJ.invoice || null);
        setInvoiceLines(invJ.lines || []);
      } else {
        setInvoice(null);
        setInvoiceLines([]);
      }

      if ((sJ && sJ.ok === false) || (rnkJ && rnkJ.ok === false))
        setMsg("⚠️ Hay un error cargando datos (mira consola / endpoint).");
      if (incJ && incJ.ok === false) setMsg((p) => `${p ? p + " · " : ""}⚠️ Incidencias: ${incJ.error || "error"}`);
      if (invJ && invJ.ok === false) setMsg((p) => `${p ? p + " · " : ""}⚠️ Factura: ${invJ.error || "error"}`);
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function loadMyOutbound(silent = false) {
    if (obLoading && !silent) return;
    if (!silent) {
      setObLoading(true);
      setObMsg("");
    }

    try {
      const token = await getTokenSafe();
      if (!token) return;

      const res = await fetch(`/api/me/outbound?date=${encodeURIComponent(obDate)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setObBatch(j.batch || null);
      const items = (j.batch?.outbound_batch_items || [])
        .slice()
        .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
      setObItems(items);

      if (!silent) {
        setObMsg(j.batch ? `✅ Lista cargada (${items.length})` : "ℹ️ Hoy no has enviado lista.");
        setTimeout(() => setObMsg(""), 1200);
      }
    } catch (e: any) {
      if (!silent) setObMsg(`❌ ${e?.message || "Error"}`);
      setObBatch(null);
      setObItems([]);
    } finally {
      if (!silent) setObLoading(false);
    }
  }

  async function submitOutboundDraft() {
    if (obSending) return;
    setObSending(true);
    setObMsg("");
    try {
      const token = await getTokenSafe();
      if (!token) return;

      const names = obDraft
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!names.length) {
        setObMsg("⚠️ Escribe al menos un nombre (1 por línea).");
        return;
      }

      const items = names.map((customer_name, idx) => ({ customer_name, position: idx + 1, priority: 0 }));

      const res = await fetch("/api/tarot/outbound/submit", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ batch_date: obDate, items }),
      });
      const j = await safeJson(res);

      if (!j?._ok || !j?.ok) {
        if (j?.error === "BATCH_ALREADY_EXISTS") {
          setObMsg("⚠️ Ya enviaste lista hoy. Recargando…");
          await loadMyOutbound(true);
          return;
        }
        throw new Error(j?.error || `HTTP ${j?._status}`);
      }

      setObDraft("");
      setObMsg("✅ Lista enviada");
      await loadMyOutbound(true);
    } catch (e: any) {
      setObMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setObSending(false);
    }
  }

  async function loadMyChatThread(silent = false) {
    if (!silent) {
      setChatLoading(true);
      setChatMsg("");
    }
    try {
      const token = await getTokenSafe();
      if (!token) return;

      const res = await fetch("/api/tarot/chat/thread", { headers: { Authorization: `Bearer ${token}` } });
      const j = await safeJson(res);

      if (!j?._ok || !j?.ok) {
        setThread(null);
        setSelectedThreadId("");
        if (!silent) setChatMsg(`⚠️ Chat no disponible: ${j?.error || `HTTP ${j?._status}`}`);
        return;
      }

      const t = j.thread || j.row || j.data || null;
      if (!t?.id) {
        setThread(null);
        setSelectedThreadId("");
        if (!silent) setChatMsg("ℹ️ Aún no tienes chat abierto. Pulsa “Abrir chat”.");
        return;
      }

      const normalized: ChatThread = {
        id: String(t.id),
        title: t.title != null ? String(t.title) : null,
        last_message_text: t.last_message_text != null ? String(t.last_message_text) : null,
        last_message_at: t.last_message_at != null ? String(t.last_message_at) : null,
      };

      setThread(normalized);
      setSelectedThreadId(String(t.id));
      if (!silent) setChatMsg("✅ Chat cargado");
      if (!silent) setTimeout(() => setChatMsg(""), 900);
    } catch (e: any) {
      setThread(null);
      setSelectedThreadId("");
      if (!silent) setChatMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      if (!silent) setChatLoading(false);
    }
  }

  async function openMyChat() {
    setChatMsg("");
    setChatLoading(true);
    try {
      const token = await getTokenSafe();
      if (!token) return;

      const res = await fetch("/api/tarot/chat/open", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      const t = j.thread || j.row || j.data || null;
      if (!t?.id) throw new Error("NO_THREAD");

      setThread({ id: String(t.id), title: t.title != null ? String(t.title) : null });
      setSelectedThreadId(String(t.id));
      setChatMsg("✅ Chat abierto");
      setTimeout(() => setChatMsg(""), 900);
    } catch (e: any) {
      setChatMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setChatLoading(false);
    }
  }

  async function loadChatMessages(threadId: string, silent = false) {
    if (!threadId) return;
    if (!silent) {
      setChatLoading(true);
      setChatMsg("");
    }
    try {
      const token = await getTokenSafe();
      if (!token) return;

      const res = await fetch(`/api/tarot/chat/messages?thread_id=${encodeURIComponent(threadId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      const list: ChatMessage[] = (j.messages || j.rows || []).map((m: any) => ({
        id: String(m.id),
        thread_id: String(m.thread_id || threadId),
        sender_worker_id: m.sender_worker_id != null ? String(m.sender_worker_id) : null,
        sender_display_name: m.sender_display_name != null ? String(m.sender_display_name) : null,
        text: m.text != null ? String(m.text) : m.body != null ? String(m.body) : "",
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

    const tid = selectedThreadId || thread?.id || "";
    if (!tid) return;

    const tmpId = `tmp-${Date.now()}`;
    const optimistic: ChatMessage = {
      id: tmpId,
      thread_id: tid,
      text,
      created_at: new Date().toISOString(),
      sender_worker_id: "me",
      sender_display_name: "Yo",
    };
    setMessages((prev) => [...(prev || []), optimistic]);
    setMsgText("");
    setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    try {
      const token = await getTokenSafe();
      if (!token) throw new Error("NO_AUTH");

      const res = await fetch("/api/tarot/chat/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: tid, text }),
      });

      const j = await safeJson(res);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      const saved = j.message || j.item || null;
      if (saved?.id) {
        const normalized: ChatMessage = {
          id: String(saved.id),
          thread_id: String(saved.thread_id || tid),
          sender_worker_id: saved.sender_worker_id != null ? String(saved.sender_worker_id) : null,
          sender_display_name: saved.sender_display_name != null ? String(saved.sender_display_name) : null,
          text: saved.text != null ? String(saved.text) : saved.body != null ? String(saved.body) : text,
          created_at: saved.created_at != null ? String(saved.created_at) : new Date().toISOString(),
        };
        setMessages((prev) => (prev || []).map((m) => (m.id === tmpId ? normalized : m)));
      } else {
        loadChatMessages(tid, true);
      }
    } catch (e: any) {
      setMessages((prev) => (prev || []).filter((m) => m.id !== tmpId));
      alert(`Error: ${e?.message || "ERR"}`);
    }
  }

  useEffect(() => {
    if (!ok) return;

    if (chatChannelRef.current) {
      sb.removeChannel(chatChannelRef.current);
      chatChannelRef.current = null;
    }

    const threadId = (selectedThreadId || thread?.id) ? String(selectedThreadId || thread?.id) : "";
    if (!threadId) return;

    const ch = sb
      .channel(`tarot-chat-${threadId}`)
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
              text: m.text != null ? String(m.text) : m.body != null ? String(m.body) : "",
              created_at: m.created_at != null ? String(m.created_at) : null,
            };
            return [...(prev || []), msg];
          });

          setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
        }
      )
      .subscribe();

    chatChannelRef.current = ch;

    return () => {
      sb.removeChannel(ch);
      chatChannelRef.current = null;
    };
  }, [ok, thread?.id, selectedThreadId]);

  useEffect(() => {
    if (!ok) return;
    refresh();
    loadChecklist();
    loadAttendanceMe(true);
  }, [ok]);

  useEffect(() => {
    if (!ok) return;
    if (tab === "checklist") loadChecklist();
  }, [tab, ok]);

  useEffect(() => {
    if (!ok) return;
    if (tab === "clientes") loadMyOutbound(false);
  }, [tab, ok, obDate]);

  useEffect(() => {
    if (!ok) return;
    if (tab !== "chat") return;
    loadMyChatThread(false);
  }, [ok, tab]);

  useEffect(() => {
    if (!ok) return;
    if (tab !== "chat") return;
    const tid = selectedThreadId || thread?.id || "";
    if (!tid) return;
    loadChatMessages(tid, false);
  }, [ok, tab, thread?.id, selectedThreadId]);

  useEffect(() => {
    if (!ok) return;

    if (obChannelRef.current) {
      sb.removeChannel(obChannelRef.current);
      obChannelRef.current = null;
    }

    const bid = obBatch?.id ? String(obBatch.id) : "";
    if (!bid) return;

    const ch = sb
      .channel(`tarot-outbound-${bid}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "outbound_batch_items", filter: `batch_id=eq.${bid}` },
        (payload) => {
          const updated: any = payload.new;
          setObItems((prev) =>
            (prev || []).map((it: any) => (String(it.id) === String(updated.id) ? { ...it, ...updated } : it))
          );
        }
      )
      .subscribe();

    obChannelRef.current = ch;

    return () => {
      sb.removeChannel(ch);
      obChannelRef.current = null;
    };
  }, [ok, obBatch?.id]);

  useEffect(() => {
    if (!ok) return;

    if (attBeatRef.current) {
      clearInterval(attBeatRef.current);
      attBeatRef.current = null;
    }

    if (!attOnline) return;

    let stopped = false;

    const start = async () => {
      const token = await getTokenSafe();
      if (!token) return;

      const ping = async () => {
        if (stopped) return;

        const token2 = await getTokenSafe();
        if (!token2) return;

        await fetch("/api/attendance/event", {
          method: "POST",
          headers: { Authorization: `Bearer ${token2}`, "Content-Type": "application/json" },
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
    if (!ok || !myWorkerId) return;

    loadPendingCallPopup(myWorkerId);

    if (popupChannelRef.current) {
      sb.removeChannel(popupChannelRef.current);
      popupChannelRef.current = null;
    }

    const ch = sb
      .channel(`crm-call-popup-${myWorkerId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "crm_call_popups",
          filter: `tarotista_worker_id=eq.${myWorkerId}`,
        },
        (payload) => {
          const row: any = payload.new;
          if (!row || row.visible === false) return;
          setIncomingPopup(row);
          setPopupOpen(true);
        }
      )
      .subscribe();

    popupChannelRef.current = ch;

    return () => {
      sb.removeChannel(ch);
      popupChannelRef.current = null;
    };
  }, [ok, myWorkerId]);

  useEffect(() => {
    if (!ok) return;
    const t = setInterval(() => loadAttendanceMe(true), 60_000);
    return () => clearInterval(t);
  }, [ok]);

  async function loadPendingCallPopup(workerId?: string) {
    const wid = String(workerId || myWorkerId || "").trim();
    if (!wid) return;

    try {
      const { data, error } = await sb
        .from("crm_call_popups")
        .select("*")
        .eq("tarotista_worker_id", wid)
        .eq("visible", true)
        .eq("accepted", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setIncomingPopup(data);
        setPopupOpen(true);
      }
    } catch (e) {
      console.error("ERROR CARGANDO POPUP CRM", e);
    }
  }

  async function closeIncomingPopup(markAccepted = false) {
    const popupId = incomingPopup?.id;
    if (!popupId) {
      setPopupOpen(false);
      setIncomingPopup(null);
      return;
    }

    try {
      setPopupBusy(true);

      const patch: any = { visible: false };
      if (markAccepted) patch.accepted = true;

      const { error } = await sb
        .from("crm_call_popups")
        .update(patch)
        .eq("id", popupId);

      if (error) throw error;

      setPopupOpen(false);
      setIncomingPopup(null);
    } catch (e) {
      console.error("ERROR CERRANDO POPUP CRM", e);
    } finally {
      setPopupBusy(false);
    }
  }

  async function respondInvoice(action: "accepted" | "rejected") {
    try {
      setMsg("");
      const token = await getTokenSafe();
      if (!token) return;

      const r = await fetch("/api/invoices/respond", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: invoice?.id || "",
          month,
          status: action,
          workerNote: ackNote,
        }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setMsg(action === "accepted" ? "✅ Factura aceptada" : "✅ Factura rechazada");
      await refresh();
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  return (
    <>
      <AppHeader />

      {popupOpen && incomingPopup ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(8, 6, 16, 0.76)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            className="tc-card"
            style={{
              width: "100%",
              maxWidth: 560,
              border: "1px solid rgba(215,181,109,0.35)",
              boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
            }}
          >
            <div className="tc-title" style={{ fontSize: 20 }}>
              📞 Llamada entrante
            </div>
            <div className="tc-hr" />

            <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1.15 }}>
              {[incomingPopup?.nombre, incomingPopup?.apellido].filter(Boolean).join(" ") || "Cliente"}
            </div>

            <div className="tc-sub" style={{ marginTop: 12, fontSize: 16 }}>
              <b>{Number(incomingPopup?.minutos_free_pendientes || 0)}</b> minutos free · <b>{Number(incomingPopup?.minutos_normales_pendientes || 0)}</b> minutos cliente
            </div>

            <div className="tc-row" style={{ justifyContent: "flex-end", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
              <button className="tc-btn" onClick={() => closeIncomingPopup(false)} disabled={popupBusy}>
                {popupBusy ? "…" : "Cerrar"}
              </button>
              <button className="tc-btn tc-btn-ok" onClick={() => closeIncomingPopup(true)} disabled={popupBusy}>
                {popupBusy ? "…" : "Aceptar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {!ok ? (
        <div style={{ padding: 40 }}>Cargando…</div>
      ) : (
        <div className="tc-wrap">
          <div className="tc-container">
            <div className="tc-card">
              <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div className="tc-title" style={{ fontSize: 18 }}>
                    🔮 Panel Tarotista
                  </div>

                  <div
                    className="tc-sub"
                    style={{ marginTop: 6, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}
                  >
                    <span>
                      Mes: <b>{month}</b> {msg ? `· ${msg}` : ""}
                    </span>

                    <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                      <span className="tc-chip" style={{ padding: "4px 10px" }}>
                        Cambiar mes
                      </span>
                      <input
                        className="tc-input"
                        type="month"
                        value={month}
                        onChange={(e) => {
                          const m = e.target.value || monthKeyNow();
                          setMonth(m);
                          setMonthInUrl(m);
                          refresh(m);
                        }}
                        style={{ width: 160 }}
                        aria-label="Seleccionar mes"
                      />
                    </div>
                  </div>
                </div>

                <div className="tc-row" style={{ flexWrap: "wrap", gap: 8 }}>
                  <span
                    className="tc-chip"
                    style={{ ...attStyle(attOnline, attStatus), padding: "6px 10px", borderRadius: 999, fontSize: 12 }}
                    title={attStatus}
                  >
                    {attLabel(attOnline, attStatus)}
                  </span>

                  <button className="tc-btn tc-btn-gold" onClick={() => refresh()}>
                    Actualizar
                  </button>

                  <button
                    className="tc-btn tc-btn-ok"
                    onClick={() => postAttendanceEvent("online", { action: "check_in" })}
                    disabled={attLoading || attOnline}
                    title="Solo te conecta si estás en turno"
                  >
                    {attLoading && !attOnline ? "…" : "🟢 Conectarme"}
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
                </div>
              </div>

              {attMsg ? <div className="tc-sub" style={{ marginTop: 10 }}>{attMsg}</div> : null}

              <div style={{ marginTop: 12 }} className="tc-tabs">
                <button className={`tc-tab ${tab === "resumen" ? "tc-tab-active" : ""}`} onClick={() => setTab("resumen")}>
                  📊 Resumen
                </button>
                <button className={`tc-tab ${tab === "clientes" ? "tc-tab-active" : ""}`} onClick={() => setTab("clientes")}>
                  📤 Clientes
                </button>
                <button className={`tc-tab ${tab === "chat" ? "tc-tab-active" : ""}`} onClick={() => setTab("chat")}>
                  💬 Chat
                </button>
                <button className={`tc-tab ${tab === "bonos" ? "tc-tab-active" : ""}`} onClick={() => setTab("bonos")}>
                  💰 Bonos
                </button>
                <button className={`tc-tab ${tab === "ranking" ? "tc-tab-active" : ""}`} onClick={() => setTab("ranking")}>
                  🏆 Ranking
                </button>
                <button className={`tc-tab ${tab === "equipos" ? "tc-tab-active" : ""}`} onClick={() => setTab("equipos")}>
                  🔥💧 Equipos
                </button>
                <button className={`tc-tab ${tab === "checklist" ? "tc-tab-active" : ""}`} onClick={() => setTab("checklist")}>
                  ✅ Checklist
                </button>
                <button className={`tc-tab ${tab === "facturas" ? "tc-tab-active" : ""}`} onClick={() => setTab("facturas")}>
                  🧾 Factura
                </button>
              </div>
            </div>

            {tab === "chat" && (
              <div className="tc-card">
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div className="tc-title">💬 Chat con Central</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Mensajes en tiempo real {chatMsg ? `· ${chatMsg}` : ""}
                    </div>
                  </div>

                  <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <button className="tc-btn tc-btn-gold" onClick={() => loadMyChatThread(false)} disabled={chatLoading}>
                      {chatLoading ? "Cargando…" : "Recargar"}
                    </button>
                    {!thread?.id ? (
                      <button className="tc-btn tc-btn-ok" onClick={openMyChat} disabled={chatLoading}>
                        🟢 Abrir chat
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="tc-hr" />

                {!thread?.id ? (
                  <div className="tc-sub">
                    Aún no tienes chat abierto. Pulsa <b>“Abrir chat”</b>.
                    <div style={{ marginTop: 6, opacity: 0.85 }}>
                      (Si ya tienes endpoints con otro nombre, cambia estas rutas: <b>/api/tarot/chat/thread</b>,{" "}
                      <b>/api/tarot/chat/open</b>, <b>/api/tarot/chat/messages</b>, <b>/api/tarot/chat/send</b>)
                    </div>
                  </div>
                ) : (
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
                      <div style={{ fontWeight: 900 }}>{thread.title || "Chat con Central"}</div>
                      <div className="tc-sub" style={{ marginTop: 6 }}>
                        Thread: {selectedThreadId || thread.id}
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
                      {(!messages || messages.length === 0) && <div className="tc-sub">No hay mensajes todavía.</div>}
                      <div ref={msgEndRef} />
                    </div>

                    <div className="tc-hr" style={{ margin: 0 }} />

                    <div style={{ padding: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <input
                        className="tc-input"
                        value={msgText}
                        onChange={(e) => setMsgText(e.target.value)}
                        placeholder="Escribe un mensaje…"
                        style={{ flex: 1, minWidth: 240 }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            sendChatMessage();
                          }
                        }}
                      />
                      <button className="tc-btn tc-btn-gold" onClick={sendChatMessage} disabled={!msgText.trim()}>
                        Enviar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === "resumen" && (
              <div className="tc-grid-2">
                <div className="tc-card">
                  <div className="tc-title">📊 Mis estadísticas</div>
                  <div className="tc-hr" />
                  <div className="tc-kpis">
                    <Kpi label="Minutos totales" value={n2(s?.minutes_total || 0)} />
                    <Kpi label="Captadas" value={String(captadas)} />
                    <Kpi label="% Cliente" value={pct(s?.pct_cliente || 0)} />
                    <Kpi label="% Repite" value={pct(s?.pct_repite || 0)} />
                  </div>
                </div>

                <div className="tc-card">
                  <div className="tc-title">💶 Vista rápida de pago</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Esto es una vista motivacional. La factura oficial la ves en la pestaña “Factura”.
                  </div>
                  <div className="tc-hr" />

                  <div className="tc-kpis">
                    <Kpi label="Pago por minutos" value={eur(payMinutes)} />
                    <Kpi label="Bono captadas" value={eur(bonusCaptadas)} />
                    <Kpi label="Bono ranking (hoy)" value={eur(bonusRanking)} />
                    <Kpi label="Incidencias (en vivo)" value={`- ${eur(incidenciasLive)}`} />
                    <Kpi label="Total estimado" value={eur(totalPreview)} highlight />
                  </div>

                  <div className="tc-sub" style={{ marginTop: 10, opacity: 0.9 }}>
                    Bonos totales del mes: <b>{eur(bonusTotal)}</b>
                  </div>
                </div>

                <div className="tc-card" style={{ gridColumn: "1 / -1" }}>
                  <div className="tc-title">⚠️ Incidencias del mes (en vivo)</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Te aparecen aquí en cuanto la central las crea (no depende de regenerar factura).
                  </div>
                  <div className="tc-hr" />
                  {!incidents || incidents.length === 0 ? (
                    <div className="tc-sub">No tienes incidencias este mes.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {(incidents || []).slice(0, 8).map((i: any) => (
                        <div
                          key={i.id}
                          style={{
                            border: "1px solid rgba(255,255,255,0.10)",
                            borderRadius: 14,
                            padding: 12,
                            background: "rgba(255,80,80,0.06)",
                          }}
                        >
                          <div className="tc-row" style={{ justifyContent: "space-between" }}>
                            <div style={{ fontWeight: 900 }}>{i.title || i.reason || "Incidencia"}</div>
                            <div style={{ fontWeight: 900 }}>-{eur(i.amount)}</div>
                          </div>
                          {i.reason ? <div className="tc-sub" style={{ marginTop: 6 }}>{i.reason}</div> : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === "clientes" && (
              <div className="tc-card">
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div className="tc-title">📤 Clientes enviados</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Aquí ves el estado y el apunte del central en tiempo real
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
                    <button className="tc-btn tc-btn-gold" onClick={() => loadMyOutbound(false)} disabled={obLoading}>
                      {obLoading ? "Cargando…" : "Actualizar"}
                    </button>
                  </div>
                </div>

                <div className="tc-hr" />

                {!obBatch ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    <div className="tc-sub">No hay lista enviada para este día. Escribe nombres (1 por línea) y envía.</div>
                    <textarea
                      className="tc-input"
                      value={obDraft}
                      onChange={(e) => setObDraft(e.target.value)}
                      placeholder={"Ej:\nAna Pérez\nLuis Gómez\nMaría…"}
                      style={{ width: "100%", minHeight: 160, resize: "vertical" }}
                    />
                    <div className="tc-row" style={{ gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                      <button className="tc-btn tc-btn-ok" onClick={submitOutboundDraft} disabled={obSending}>
                        {obSending ? "Enviando…" : "📤 Enviar lista"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div className="tc-chip">
                        Estado: <b>{String(obBatch.status || "submitted")}</b>
                      </div>
                      {obBatch.note ? (
                        <div className="tc-sub">
                          Nota: <b>{obBatch.note}</b>
                        </div>
                      ) : null}
                    </div>

                    {(obItems || []).length === 0 ? (
                      <div className="tc-sub">La lista está vacía.</div>
                    ) : (
                      <div style={{ display: "grid", gap: 10 }}>
                        {(obItems || []).map((it: any) => (
                          <div
                            key={it.id}
                            style={{
                              border: "1px solid rgba(255,255,255,0.10)",
                              borderRadius: 14,
                              padding: 12,
                              background: "rgba(255,255,255,0.03)",
                            }}
                          >
                            <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                              <div style={{ minWidth: 240 }}>
                                <div style={{ fontWeight: 900 }}>{it.customer_name || "—"}</div>
                                {it.phone ? <div className="tc-sub" style={{ marginTop: 6 }}>📱 {it.phone}</div> : null}
                              </div>

                              <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                                <span className="tc-chip" style={{ border: "1px solid rgba(215,181,109,0.35)" }}>
                                  {String(it.current_status || "pending")}
                                </span>
                              </div>
                            </div>

                            {it.last_note ? (
                              <div className="tc-sub" style={{ marginTop: 10 }}>
                                📝 <b>Apunte central:</b> {it.last_note}
                              </div>
                            ) : (
                              <div className="tc-sub" style={{ marginTop: 10, opacity: 0.85 }}>
                                Aún sin apunte del central.
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {tab === "bonos" && (
              <div className="tc-grid-2">
                <div className="tc-card">
                  <div className="tc-title">💰 Bono captadas</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Tu tramo actual: <b>{tier.label}</b>
                  </div>

                  <div className="tc-hr" />

                  <div className="tc-row" style={{ justifyContent: "space-between" }}>
                    <div className="tc-sub">
                      Captadas: <b>{captadas}</b>
                    </div>
                    <div className="tc-chip">{prog.text}</div>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <div
                      style={{
                        height: 12,
                        borderRadius: 999,
                        background: "rgba(255,255,255,0.10)",
                        overflow: "hidden",
                        border: "1px solid rgba(255,255,255,0.10)",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${prog.pct}%`,
                          background: "linear-gradient(90deg, rgba(181,156,255,0.95), rgba(215,181,109,0.95))",
                        }}
                      />
                    </div>
                    <div className="tc-sub" style={{ marginTop: 8 }}>
                      Bono actual del mes: <b>{eur(bonusCaptadas)}</b>
                    </div>
                  </div>

                  <div className="tc-hr" />

                  <div className="tc-sub">
                    Tramos:
                    <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                      <div className="tc-row" style={{ justifyContent: "space-between" }}>
                        <span>0–9 captadas</span>
                        <b>0,50€</b>
                      </div>
                      <div className="tc-row" style={{ justifyContent: "space-between" }}>
                        <span>10–19 captadas</span>
                        <b>1,00€</b>
                      </div>
                      <div className="tc-row" style={{ justifyContent: "space-between" }}>
                        <span>20–29 captadas</span>
                        <b>1,50€</b>
                      </div>
                      <div className="tc-row" style={{ justifyContent: "space-between" }}>
                        <span>30+ captadas</span>
                        <b>2,00€</b>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="tc-card">
                  <div className="tc-title">🏆 Bono ranking (en vivo)</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Esto es lo que llevas ganado <b>hoy</b> por tu posición del mes. Si mañana bajas, también baja (y al revés).
                  </div>

                  <div className="tc-hr" />

                  <div
                    style={{
                      border: "1px solid rgba(255,255,255,0.10)",
                      borderRadius: 14,
                      padding: 12,
                      background: "rgba(181,156,255,0.08)",
                    }}
                  >
                    <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
                      <div>
                        <div className="tc-sub">Bono ranking acumulado (según posición actual)</div>
                        <div style={{ fontWeight: 900, fontSize: 26, marginTop: 6 }}>{eur(bonusRanking)}</div>
                      </div>

                      <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <span className="tc-chip" style={{ border: "1px solid rgba(215,181,109,0.35)" }}>
                          Captadas: <b>{eur(brCaptadas)}</b>
                        </span>
                        <span className="tc-chip" style={{ border: "1px solid rgba(215,181,109,0.35)" }}>
                          Cliente: <b>{eur(brCliente)}</b>
                        </span>
                        <span className="tc-chip" style={{ border: "1px solid rgba(215,181,109,0.35)" }}>
                          Repite: <b>{eur(brRepite)}</b>
                        </span>
                      </div>
                    </div>

                    <div className="tc-hr" style={{ margin: "12px 0" }} />

                    <div style={{ display: "grid", gap: 8 }}>
                      <RankLiveRow label="🏆 Captadas" pos={posCaptadas} amount={brCaptadas} />
                      <RankLiveRow label="👑 Cliente" pos={posCliente} amount={brCliente} />
                      <RankLiveRow label="🔁 Repite" pos={posRepite} amount={brRepite} />
                    </div>

                    <div className="tc-sub" style={{ marginTop: 10, opacity: 0.9 }}>
                      Premio: 🥇 6€ · 🥈 4€ · 🥉 2€ · fuera del top 3 = 0€
                    </div>
                  </div>

                  <div className="tc-hr" />

                  <div className="tc-sub">
                    Consejo: céntrate en <b>% Repite</b> y <b>% Cliente</b> para ganar los 6€ y además ayudar a tu equipo.
                  </div>
                </div>
              </div>
            )}

            {tab === "ranking" && (
              <div className="tc-card">
                <div className="tc-title">🏆 Top 3 del mes</div>
                <div className="tc-sub" style={{ marginTop: 6 }}>
                  (Si falta algo, revisamos el endpoint /api/rankings/monthly)
                </div>

                <div className="tc-hr" />

                <div className="tc-grid-3">
                  <TopCard title="Captadas" items={topCaptadas.map((x: any) => `${x.display_name} (${x.captadas_total})`)} />
                  <TopCard title="Cliente" items={topCliente.map((x: any) => `${x.display_name} (${Number(x.pct_cliente).toFixed(2)}%)`)} />
                  <TopCard title="Repite" items={topRepite.map((x: any) => `${x.display_name} (${Number(x.pct_repite).toFixed(2)}%)`)} />
                </div>
              </div>
            )}

            {tab === "equipos" && (
              <div className="tc-card">
                <div className="tc-title">🔥💧 Competición por equipos</div>
                <div className="tc-sub" style={{ marginTop: 6 }}>
                  Score = media %Cliente + media %Repite (por equipo). Ganador: central +40€.
                </div>

                <div className="tc-hr" />

                <div className="tc-grid-2">
                  <TeamCard
                    title="🔥 Fuego"
                    score={rank?.teams?.fuego?.score ?? 0}
                    avgCliente={rank?.teams?.fuego?.avg_cliente ?? 0}
                    avgRepite={rank?.teams?.fuego?.avg_repite ?? 0}
                  />
                  <TeamCard
                    title="💧 Agua"
                    score={rank?.teams?.agua?.score ?? 0}
                    avgCliente={rank?.teams?.agua?.avg_cliente ?? 0}
                    avgRepite={rank?.teams?.agua?.avg_repite ?? 0}
                  />
                </div>

                <div className="tc-hr" />

                <div className="tc-row" style={{ justifyContent: "space-between" }}>
                  <div className="tc-sub">Ganador actual:</div>
                  <div className="tc-chip">
                    <b>{rank?.teams?.winner || "—"}</b>
                  </div>
                </div>
              </div>
            )}

            {tab === "checklist" && (
              <div className="tc-card">
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div className="tc-title">✅ Checklist del turno</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Turno: <b>{clShiftKey || "—"}</b> · Completadas: <b>{clProgress.completed}/{clProgress.total}</b>
                      {clMsg ? ` · ${clMsg}` : ""}
                    </div>
                  </div>

                  <div className="tc-row" style={{ flexWrap: "wrap" }}>
                    <button className="tc-btn tc-btn-gold" onClick={loadChecklist} disabled={clLoading}>
                      {clLoading ? "Cargando…" : "Actualizar checklist"}
                    </button>
                  </div>
                </div>

                <div className="tc-hr" />

                <div style={{ display: "grid", gap: 10 }}>
                  <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <input
                      className="tc-input"
                      value={clQ}
                      onChange={(e) => setClQ(e.target.value)}
                      placeholder="Buscar en checklist…"
                      style={{ width: 320, maxWidth: "100%" }}
                    />

                    <div style={{ minWidth: 240, flex: 1 }}>
                      <div
                        style={{
                          height: 12,
                          borderRadius: 999,
                          background: "rgba(255,255,255,0.10)",
                          overflow: "hidden",
                          border: "1px solid rgba(255,255,255,0.10)",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${clampPct(clProgress.pct)}%`,
                            background: "linear-gradient(90deg, rgba(181,156,255,0.95), rgba(215,181,109,0.95))",
                          }}
                        />
                      </div>
                      <div className="tc-sub" style={{ marginTop: 6 }}>
                        Progreso: <b>{clProgress.pct}%</b>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 10, marginTop: 2 }}>
                    {(clFiltered || []).map((it: any) => {
                      const title = String(it.title || it.label || it.item_key || "Checklist item");
                      const done = !!it.done || it.status === "completed" || it.completed === true;
                      const desc = String(it.description || it.desc || "");
                      const doneAt = it.completed_at || it.done_at || it.updated_at || null;

                      return (
                        <div
                          key={String(it.item_key || it.key || it.id || title)}
                          style={{
                            border: "1px solid rgba(255,255,255,0.10)",
                            borderRadius: 14,
                            padding: 12,
                            background: done ? "rgba(120,255,190,0.10)" : "rgba(255,255,255,0.03)",
                          }}
                        >
                          <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                            <div style={{ minWidth: 240 }}>
                              <div style={{ fontWeight: 900, display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ opacity: done ? 1 : 0.9 }}>{done ? "✅" : "⬜"}</span>
                                <span>{title}</span>
                              </div>
                              {desc ? <div className="tc-sub" style={{ marginTop: 6 }}>{desc}</div> : null}
                              {done && doneAt ? (
                                <div className="tc-sub" style={{ marginTop: 6, opacity: 0.85 }}>
                                  Completado: <b>{new Date(doneAt).toLocaleString("es-ES")}</b>
                                </div>
                              ) : null}
                            </div>

                            <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                              <span className="tc-chip" style={{ border: "1px solid rgba(215,181,109,0.35)" }}>
                                {done ? "Completado" : "Pendiente"}
                              </span>

                              <button
                                className="tc-btn tc-btn-purple"
                                onClick={() => toggleChecklistItem(it)}
                                disabled={clLoading}
                                style={{ minWidth: 160 }}
                              >
                                {done ? "Marcar como pendiente" : "Marcar como hecho"}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {(!clFiltered || clFiltered.length === 0) && (
                      <div className="tc-sub">No hay items en tu checklist (o no coinciden con la búsqueda).</div>
                    )}
                  </div>

                  <div className="tc-hr" />

                  <div className="tc-sub">
                    Nota: el checklist se reinicia automáticamente con el <b>turno</b> (shift_key). Si cambia el turno, recarga.
                  </div>
                </div>
              </div>
            )}

            {tab === "facturas" && (
              <div className="tc-card">
                <div className="tc-row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <div className="tc-title">🧾 Mi factura</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Aquí está la factura oficial (líneas por códigos + bonos + incidencias).
                    </div>
                  </div>
                  <button className="tc-btn tc-btn-gold" onClick={() => refresh()}>
                    Recargar
                  </button>
                </div>

                <div className="tc-hr" />

                {!invoice ? (
                  <div className="tc-sub">Aún no hay factura generada para este mes. (La genera Admin)</div>
                ) : (
                  <>
                    <div className="tc-row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                      <div>
                        <div className="tc-sub">
                          Estado: <b>{getInvoiceVisibleStatus(invoice)}</b> · Aceptación: <b>{invoice.worker_ack || "pending"}</b>
                        </div>
                        <div style={{ fontWeight: 900, fontSize: 22, marginTop: 6 }}>{eur(invoice.total || 0)}</div>
                        {invoice.worker_ack_note ? (
                          <div className="tc-sub" style={{ marginTop: 6 }}>
                            Nota enviada: <b>{invoice.worker_ack_note}</b>
                          </div>
                        ) : null}
                      </div>

                      <div style={{ minWidth: 320, maxWidth: "100%" }}>
                        <div className="tc-sub">Nota (opcional, sobre todo si rechazas)</div>
                        <input
                          className="tc-input"
                          value={ackNote}
                          onChange={(e) => setAckNote(e.target.value)}
                          placeholder="Ej: Falta revisar una incidencia…"
                          style={{ width: "100%", marginTop: 6 }}
                        />

                        <div className="tc-row" style={{ marginTop: 10, justifyContent: "flex-end" }}>
                          <button className="tc-btn tc-btn-ok" onClick={() => respondInvoice("accepted")}>
                            Aceptar
                          </button>
                          <button className="tc-btn tc-btn-danger" onClick={() => respondInvoice("rejected")}>
                            Rechazar
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="tc-hr" />

                    <div className="tc-title" style={{ fontSize: 14 }}>
                      📌 Líneas
                    </div>

                    <div style={{ overflowX: "auto", marginTop: 8 }}>
                      <table className="tc-table">
                        <thead>
                          <tr>
                            <th>Concepto</th>
                            <th>Importe</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(invoiceLines || []).map((l: any) => {
                            const meta = l?.meta || {};
                            const hasBreakdown = meta && meta.minutes != null && meta.rate != null;
                            const minutes = Number(meta.minutes || 0);
                            const rate = Number(meta.rate || 0);
                            const calc = minutes * rate;

                            return (
                              <tr key={l.id}>
                                <td>
                                  <b>{l.label}</b>
                                  {hasBreakdown ? (
                                    <div className="tc-sub" style={{ marginTop: 6 }}>
                                      {String(meta.code || "").toUpperCase()} · {minutes} min × {eur(rate)} = <b>{eur(calc)}</b>
                                    </div>
                                  ) : null}
                                </td>
                                <td style={{ fontWeight: 900, whiteSpace: "nowrap" }}>{eur(l.amount)}</td>
                              </tr>
                            );
                          })}
                          {(!invoiceLines || invoiceLines.length === 0) && (
                            <tr>
                              <td colSpan={2} className="tc-muted">
                                No hay líneas (aún). Si esto pasa, regeneramos factura del mes en Admin.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="tc-hr" />

                    <div className="tc-title" style={{ fontSize: 14 }}>
                      ⚠️ Incidencias del mes
                    </div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Esto se actualiza en vivo (aunque la factura no se regenere).
                    </div>

                    <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                      {!incidents || incidents.length === 0 ? (
                        <div className="tc-sub">No tienes incidencias este mes.</div>
                      ) : (
                        (incidents || []).map((i: any) => (
                          <div
                            key={i.id}
                            style={{
                              border: "1px solid rgba(255,255,255,0.10)",
                              borderRadius: 14,
                              padding: 12,
                              background: "rgba(255,80,80,0.06)",
                            }}
                          >
                            <div className="tc-row" style={{ justifyContent: "space-between" }}>
                              <div style={{ fontWeight: 900 }}>{i.title || i.reason || "Incidencia"}</div>
                              <div style={{ fontWeight: 900 }}>-{eur(i.amount)}</div>
                            </div>
                            {i.reason ? <div className="tc-sub" style={{ marginTop: 6 }}>{i.reason}</div> : null}
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Kpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 14,
        padding: 12,
        background: highlight ? "rgba(215,181,109,0.10)" : "rgba(255,255,255,0.03)",
      }}
    >
      <div className="tc-sub">{label}</div>
      <div style={{ fontWeight: 900, fontSize: 18, marginTop: 6 }}>{value}</div>
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

function TeamCard({
  title,
  score,
  avgCliente,
  avgRepite,
}: {
  title: string;
  score: any;
  avgCliente: any;
  avgRepite: any;
}) {
  const s = Number(score || 0);
  return (
    <div className="tc-card" style={{ boxShadow: "none", padding: 14 }}>
      <div className="tc-title" style={{ fontSize: 14 }}>
        {title}
      </div>
      <div className="tc-hr" />
      <div className="tc-kpis">
        <div className="tc-row" style={{ justifyContent: "space-between" }}>
          <span className="tc-sub">Score</span>
          <b>{s.toFixed(2)}</b>
        </div>
        <div className="tc-row" style={{ justifyContent: "space-between" }}>
          <span className="tc-sub">Media % Cliente</span>
          <b>{Number(avgCliente || 0).toFixed(2)}%</b>
        </div>
        <div className="tc-row" style={{ justifyContent: "space-between" }}>
          <span className="tc-sub">Media % Repite</span>
          <b>{Number(avgRepite || 0).toFixed(2)}%</b>
        </div>
      </div>
    </div>
  );
}

function RankLiveRow({ label, pos, amount }: { label: string; pos: number | null; amount: number }) {
  const p = pos ?? null;
  const medal = medalForPos(p);
  const note = p ? `Posición actual: ${p}º` : "Fuera del Top 3";
  const expected = bonusForPos(p);

  return (
    <div
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
      <div>
        <div style={{ fontWeight: 900 }}>{label}</div>
        <div className="tc-sub" style={{ marginTop: 4 }}>
          {medal} {note} · Premio: <b>{eur(expected)}</b>
        </div>
      </div>
      <div style={{ fontWeight: 900, fontSize: 18 }}>{eur(amount)}</div>
    </div>
  );
}
