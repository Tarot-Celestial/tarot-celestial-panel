"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { supabaseBrowser } from "@/lib/supabase-browser";
import AdminAccountingTab from "@/components/admin/AdminAccountingTab";

const sb = supabaseBrowser();

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function eur(n: any) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function numES(n: any, digits = 2) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function minsToHhmm(mins: any) {
  const m = Math.max(0, Math.round(Number(mins) || 0));
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function roundMoney(n: any) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function dayName(day: any) {
  const d = Number(day);
  if (d === 0) return "Domingo";
  if (d === 1) return "Lunes";
  if (d === 2) return "Martes";
  if (d === 3) return "Miércoles";
  if (d === 4) return "Jueves";
  if (d === 5) return "Viernes";
  if (d === 6) return "Sábado";
  return "—";
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

type TabKey =
  | "facturas"
  | "editor"
  | "estadisticas"
  | "contabilidad"
  | "asistencia"
  | "checklists"
  | "crm"
  | "sync";

function ackLabel(v: any) {
  const s = String(v || "pending");
  if (s === "accepted") return "✅ Aceptada";
  if (s === "rejected") return "❌ Rechazada";
  if (s === "review") return "🟡 Revisión";
  return "⏳ Pendiente";
}

function ackStyle(v: any) {
  const s = String(v || "pending");
  if (s === "accepted") {
    return {
      background: "rgba(120,255,190,0.10)",
      border: "1px solid rgba(120,255,190,0.25)",
    };
  }
  if (s === "rejected") {
    return {
      background: "rgba(255,80,80,0.10)",
      border: "1px solid rgba(255,80,80,0.25)",
    };
  }
  if (s === "review") {
    return {
      background: "rgba(215,181,109,0.10)",
      border: "1px solid rgba(215,181,109,0.25)",
    };
  }
  return {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.15)",
  };
}

export default function Admin() {
  const [ok, setOk] = useState(false);
  const [tab, setTab] = useState<TabKey>("facturas");

  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string>("");

  const [month, setMonth] = useState<string>(monthKeyNow());

  const [genLoading, setGenLoading] = useState(false);
  const [genMsg, setGenMsg] = useState<string>("");

  const [listLoading, setListLoading] = useState(false);
  const [listMsg, setListMsg] = useState<string>("");
  const [invoices, setInvoices] = useState<any[]>([]);

  const [selId, setSelId] = useState<string>("");
  const [selLoading, setSelLoading] = useState(false);
  const [selMsg, setSelMsg] = useState<string>("");
  const [selInvoice, setSelInvoice] = useState<any>(null);
  const [selWorker, setSelWorker] = useState<any>(null);
  const [selLines, setSelLines] = useState<any[]>([]);
  const [newLabel, setNewLabel] = useState("Ajuste");
  const [newAmount, setNewAmount] = useState<string>("0");
  const [newKind, setNewKind] = useState("adjustment");

  const [statsLoading, setStatsLoading] = useState(false);
  const [statsMsg, setStatsMsg] = useState("");
  const [statsTotals, setStatsTotals] = useState<any>(null);
  const [statsRows, setStatsRows] = useState<any[]>([]);
  const [statsTop, setStatsTop] = useState<any>({ captadas: [], cliente: [], repite: [] });
  const [statsTeams, setStatsTeams] = useState<any>({ fuego: null, agua: null, winner: "empate" });

  const pollRef = useRef<any>(null);
  const lastMonthRef = useRef<string>("");

  const totalSum = useMemo(() => {
    return (invoices || []).reduce((a, x) => a + Number(x.total || 0), 0);
  }, [invoices]);

  const [attLoading, setAttLoading] = useState(false);
  const [attMsg, setAttMsg] = useState("");
  const [attOnline, setAttOnline] = useState<any[]>([]);
  const [attExpected, setAttExpected] = useState<any[]>([]);
  const [attIncidents, setAttIncidents] = useState<any[]>([]);
  const [attNote, setAttNote] = useState<string>("");

  const [stLoading, setStLoading] = useState(false);
  const [stMsg, setStMsg] = useState("");
  const [stRows, setStRows] = useState<any[]>([]);
  const [stWorkerId, setStWorkerId] = useState<string>("");
  const [stGroup, setStGroup] = useState<"day" | "week" | "month">("day");
  const [stFrom, setStFrom] = useState<string>("");
  const [stTo, setStTo] = useState<string>("");

  const [ckTemplateKey, setCkTemplateKey] = useState<"tarotista" | "central">("tarotista");
  const [ckLoading, setCkLoading] = useState(false);
  const [ckMsg, setCkMsg] = useState("");
  const [ckTemplate, setCkTemplate] = useState<any>(null);
  const [ckItems, setCkItems] = useState<any[]>([]);
  const [ckQ, setCkQ] = useState("");

  const [ckNewLabel, setCkNewLabel] = useState("");
  const [ckNewSort, setCkNewSort] = useState<string>("10");

  const [accLoading, setAccLoading] = useState(false);
  const [accMsg, setAccMsg] = useState("");
  const [accTotals, setAccTotals] = useState<any>({ income: 0, expense: 0, net: 0 });
  const [accEntries, setAccEntries] = useState<any[]>([]);
  const [accMonths, setAccMonths] = useState<any[]>([]);
  const [accBreakdown, setAccBreakdown] = useState<any>({ income: [], expense: [] });

  // Staff / horarios
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffMsg, setStaffMsg] = useState("");
  const [staffWorkers, setStaffWorkers] = useState<any[]>([]);
  const [staffSchedules, setStaffSchedules] = useState<any[]>([]);
  const [staffQ, setStaffQ] = useState("");

  const [newWorkerName, setNewWorkerName] = useState("");
  const [newWorkerRole, setNewWorkerRole] = useState<"tarotista" | "central" | "admin">("tarotista");
  const [newWorkerTeam, setNewWorkerTeam] = useState("");
  const [newWorkerEmail, setNewWorkerEmail] = useState("");

  const [scheduleWorkerId, setScheduleWorkerId] = useState("");
  const [scheduleDay, setScheduleDay] = useState("1");
  const [scheduleStart, setScheduleStart] = useState("10:00:00");
  const [scheduleEnd, setScheduleEnd] = useState("18:00:00");
  const [scheduleTimezone, setScheduleTimezone] = useState("Europe/Madrid");

  const [editingWorkerId, setEditingWorkerId] = useState("");
  const [editingWorkerName, setEditingWorkerName] = useState("");
  const [editingWorkerRole, setEditingWorkerRole] = useState<"tarotista" | "central" | "admin">("tarotista");
  const [editingWorkerTeam, setEditingWorkerTeam] = useState("");
  const [editingWorkerEmail, setEditingWorkerEmail] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("tc_month_admin");
      if (saved) setMonth(saved);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("tc_month_admin", month);
    } catch {}
  }, [month]);

  useEffect(() => {
    (async () => {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return (window.location.href = "/login");

      const meRes = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
      const me = await safeJson(meRes);
      if (!me?.ok) return (window.location.href = "/login");

      if (me.role !== "admin") {
        window.location.href = me.role === "central" ? "/panel-central" : "/panel-tarotista";
        return;
      }

      setOk(true);
    })();
  }, []);

  async function getTokenOrLogin() {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/login";
      return "";
    }
    return token;
  }

  async function loadAccounting(silent = false) {
    if (accLoading && !silent) return;
    if (!silent) {
      setAccLoading(true);
      setAccMsg("");
    }

    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch(`/api/admin/accounting?month=${encodeURIComponent(month)}&months_back=12`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setAccTotals(j.totals || { income: 0, expense: 0, net: 0 });
      setAccEntries(j.entries || []);
      setAccMonths(j.months || []);
      setAccBreakdown(j.breakdown || { income: [], expense: [] });

      if (!silent) setAccMsg("✅ Contabilidad cargada.");
    } catch (e: any) {
      if (!silent) setAccMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      if (!silent) setAccLoading(false);
    }
  }

  async function createAccountingEntry(payload: any) {
    const token = await getTokenOrLogin();
    if (!token) return;

    const r = await fetch("/api/admin/accounting", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const j = await safeJson(r);
    if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

    await loadAccounting(true);
    setAccMsg("✅ Movimiento guardado.");
  }

  async function deleteAccountingEntry(id: string) {
    if (!confirm("¿Borrar este movimiento?")) return;

    const token = await getTokenOrLogin();
    if (!token) return;

    const r = await fetch("/api/admin/accounting/delete", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });

    const j = await safeJson(r);
    if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

    await loadAccounting(true);
    setAccMsg("✅ Movimiento borrado.");
  }

  async function syncNow() {
    if (syncLoading) return;
    setSyncLoading(true);
    setSyncMsg("");
    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/sync/calls", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const j = await safeJson(r);

      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}. ${j?._raw || "(vacía)"}`);
      setSyncMsg(`✅ Sincronización OK. Upserted: ${j.upserted ?? 0}`);
    } catch (e: any) {
      setSyncMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setSyncLoading(false);
    }
  }

  async function generateInvoices() {
    if (genLoading) return;
    setGenLoading(true);
    setGenMsg("");
    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/invoices/generate", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ month }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}. ${j?._raw || "(vacía)"}`);

      const count = j?.result?.invoices ?? "?";
      setGenMsg(`✅ Facturas generadas para ${month}. Total: ${count}`);
      await listInvoices();
      setTab("facturas");
    } catch (e: any) {
      setGenMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setGenLoading(false);
    }
  }

  async function listInvoices(silent = false) {
    if (listLoading && !silent) return;
    if (!silent) {
      setListLoading(true);
      setListMsg("");
    }

    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch(`/api/admin/invoices/list?month=${encodeURIComponent(month)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}. ${j?._raw || "(vacía)"}`);

      setInvoices(j.invoices || []);
      if (!silent) setListMsg(`✅ Cargadas ${j.invoices?.length ?? 0} facturas (${month}).`);
    } catch (e: any) {
      if (!silent) setListMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      if (!silent) setListLoading(false);
    }
  }

  async function loadInvoice(invoice_id: string) {
    if (!invoice_id) return;
    setSelLoading(true);
    setSelMsg("");
    setSelId(invoice_id);
    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch(`/api/admin/invoices/edit?invoice_id=${encodeURIComponent(invoice_id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}. ${j?._raw || "(vacía)"}`);

      setSelInvoice(j.invoice);
      setSelWorker(j.worker);
      setSelLines(j.lines || []);
      setTab("editor");
    } catch (e: any) {
      setSelMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setSelLoading(false);
    }
  }

  async function postEdit(payload: any) {
    const token = await getTokenOrLogin();
    if (!token) return null;

    const r = await fetch("/api/admin/invoices/edit", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const j = await safeJson(r);
    if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}. ${j?._raw || "(vacía)"}`);
    return j;
  }

  async function addLine() {
    if (!selId) return;
    try {
      const amt = Number(String(newAmount).replace(",", "."));
      await postEdit({
        action: "add_line",
        invoice_id: selId,
        kind: newKind,
        label: newLabel,
        amount: isFinite(amt) ? amt : 0,
        meta: {},
      });
      await loadInvoice(selId);
      await listInvoices(true);
      setSelMsg("✅ Línea añadida.");
    } catch (e: any) {
      setSelMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function updateLine(line_id: string, payload: { label: string; amount?: number; meta?: any }) {
    if (!selId) return;
    try {
      await postEdit({
        action: "update_line",
        invoice_id: selId,
        line_id,
        label: payload.label,
        amount: payload.amount,
        meta: payload.meta,
      });
      await loadInvoice(selId);
      await listInvoices(true);
      setSelMsg("✅ Guardado.");
    } catch (e: any) {
      setSelMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function deleteLine(line_id: string) {
    if (!selId) return;
    if (!confirm("¿Borrar esta línea?")) return;
    try {
      await postEdit({ action: "delete_line", invoice_id: selId, line_id });
      await loadInvoice(selId);
      await listInvoices(true);
      setSelMsg("✅ Línea borrada.");
    } catch (e: any) {
      setSelMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function setStatus(status: string) {
    if (!selId) return;
    try {
      await postEdit({ action: "set_status", invoice_id: selId, status });
      await loadInvoice(selId);
      await listInvoices(true);
      setSelMsg("✅ Estado actualizado.");
    } catch (e: any) {
      setSelMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function loadAdminStats(silent = false) {
    if (statsLoading && !silent) return;
    if (!silent) {
      setStatsLoading(true);
      setStatsMsg("");
    }

    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const [statsRes, rankRes, invRes] = await Promise.all([
        fetch(`/api/stats/monthly?month=${encodeURIComponent(month)}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/rankings/monthly?month=${encodeURIComponent(month)}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/admin/invoices/list?month=${encodeURIComponent(month)}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      const statsJ = await safeJson(statsRes);
      const rankJ = await safeJson(rankRes);
      const invJ = await safeJson(invRes);

      if (!statsJ?._ok || !statsJ?.ok) throw new Error(statsJ?.error || `HTTP ${statsJ?._status}`);
      if (!rankJ?._ok || !rankJ?.ok) throw new Error(rankJ?.error || `HTTP ${rankJ?._status}`);
      if (!invJ?._ok || !invJ?.ok) throw new Error(invJ?.error || `HTTP ${invJ?._status}`);

      setStatsTotals(statsJ.totals || null);
      setStatsRows(statsJ.rows || []);
      setStatsTop(rankJ.top || { captadas: [], cliente: [], repite: [] });
      setStatsTeams(rankJ.teams || { fuego: null, agua: null, winner: "empate" });
      setInvoices(invJ.invoices || []);

      if (!silent) setStatsMsg("✅ Estadísticas cargadas.");
    } catch (e: any) {
      if (!silent) setStatsMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      if (!silent) setStatsLoading(false);
    }
  }

  async function loadAttendance() {
    if (attLoading) return;
    setAttLoading(true);
    setAttMsg("");
    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const [r1, r2] = await Promise.all([
        fetch("/api/admin/attendance/online-now", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/admin/attendance/expected-now", { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      const j1 = await safeJson(r1);
      const j2 = await safeJson(r2);

      if (!j1?._ok || !j1?.ok) throw new Error(j1?.error || `HTTP ${j1?._status}`);
      if (!j2?._ok || !j2?.ok) throw new Error(j2?.error || `HTTP ${j2?._status}`);

      setAttOnline(j1.rows || j1.online || []);
      setAttExpected(j2.expected || j2.rows || []);

      const incRes = await fetch(`/api/admin/incidents/list?month=${encodeURIComponent(month)}&kind=attendance`, {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => null);

      if (incRes) {
        const incJ = await safeJson(incRes);
        if (incJ?._ok && incJ?.ok) setAttIncidents(incJ.incidents || []);
        else setAttIncidents([]);
      } else {
        setAttIncidents([]);
      }

      setAttMsg("✅ Asistencia actualizada.");
    } catch (e: any) {
      setAttMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setAttLoading(false);
    }
  }

  async function runAttendanceEngine() {
    try {
      setAttMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/admin/attendance/run", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setAttMsg(`✅ Motor ejecutado. Retrasos: ${j.created?.late ?? 0} · Faltas: ${j.created?.absence ?? 0}`);
      await loadAttendance();
    } catch (e: any) {
      setAttMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function decideIncident(incident_id: string, status: "justified" | "unjustified") {
    try {
      setAttMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/admin/incidents/decide", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ incident_id, status, note: attNote }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setAttMsg(status === "justified" ? "✅ Marcada como JUSTIFICADA." : "✅ Marcada como NO justificada.");
      setAttNote("");
      await loadAttendance();
    } catch (e: any) {
      setAttMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function loadStats(silent = false) {
    if (stLoading && !silent) return;
    if (!silent) {
      setStLoading(true);
      setStMsg("");
    }
    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const qp = new URLSearchParams();
      if (stWorkerId.trim()) qp.set("worker_id", stWorkerId.trim());
      qp.set("group", stGroup);
      if (stFrom.trim()) qp.set("from", stFrom.trim());
      if (stTo.trim()) qp.set("to", stTo.trim());

      const r = await fetch(`/api/admin/attendance/stats?${qp.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setStRows(j.rows || []);
      if (!silent) setStMsg(`✅ Stats cargadas: ${(j.rows || []).length}`);
      if (!silent) setTimeout(() => setStMsg(""), 1200);
    } catch (e: any) {
      setStRows([]);
      if (!silent) setStMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      if (!silent) setStLoading(false);
    }
  }

  async function loadStaff(silent = false) {
    if (staffLoading && !silent) return;
    if (!silent) {
      setStaffLoading(true);
      setStaffMsg("");
    }
    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/admin/staff", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setStaffWorkers(j.workers || []);
      setStaffSchedules(j.schedules || []);
      if (!silent) setStaffMsg("✅ Plantilla y horarios cargados.");
    } catch (e: any) {
      if (!silent) setStaffMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      if (!silent) setStaffLoading(false);
    }
  }

  async function createWorker() {
    try {
      setStaffMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/admin/staff/manage", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_worker",
          display_name: newWorkerName,
          role: newWorkerRole,
          team: newWorkerTeam,
          email: newWorkerEmail,
        }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setNewWorkerName("");
      setNewWorkerRole("tarotista");
      setNewWorkerTeam("");
      setNewWorkerEmail("");
      await loadStaff(true);
      setStaffMsg("✅ Trabajador creado.");
    } catch (e: any) {
      setStaffMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function updateWorker() {
    if (!editingWorkerId) return;
    try {
      setStaffMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/admin/staff/manage", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_worker",
          worker_id: editingWorkerId,
          display_name: editingWorkerName,
          role: editingWorkerRole,
          team: editingWorkerTeam,
          email: editingWorkerEmail,
        }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      await loadStaff(true);
      setStaffMsg("✅ Trabajador actualizado.");
      setEditingWorkerId("");
      setEditingWorkerName("");
      setEditingWorkerRole("tarotista");
      setEditingWorkerTeam("");
      setEditingWorkerEmail("");
    } catch (e: any) {
      setStaffMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  function startEditWorker(worker: any) {
    setEditingWorkerId(String(worker.id || ""));
    setEditingWorkerName(String(worker.display_name || ""));
    setEditingWorkerRole((worker.role || "tarotista") as any);
    setEditingWorkerTeam(String(worker.team || ""));
    setEditingWorkerEmail(String(worker.email || ""));
  }

  function cancelEditWorker() {
    setEditingWorkerId("");
    setEditingWorkerName("");
    setEditingWorkerRole("tarotista");
    setEditingWorkerTeam("");
    setEditingWorkerEmail("");
  }

  function prepareScheduleForWorker(worker: any) {
    setScheduleWorkerId(String(worker.id || ""));
  }

  async function toggleWorker(worker: any, enable: boolean) {
    try {
      setStaffMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/admin/staff/manage", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: enable ? "enable_worker" : "disable_worker",
          worker_id: worker.id,
        }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      await loadStaff(true);
      setStaffMsg(enable ? "✅ Trabajador activado." : "✅ Trabajador desactivado.");
    } catch (e: any) {
      setStaffMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function createSchedule() {
    try {
      setStaffMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/admin/staff/schedules", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_schedule",
          worker_id: scheduleWorkerId,
          day_of_week: Number(scheduleDay),
          start_time: scheduleStart,
          end_time: scheduleEnd,
          timezone: scheduleTimezone,
          is_active: true,
        }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      await loadStaff(true);
      setStaffMsg("✅ Horario creado.");
    } catch (e: any) {
      setStaffMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function updateSchedule(schedule_id: string, patch: any) {
    try {
      setStaffMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/admin/staff/schedules", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_schedule",
          schedule_id,
          ...patch,
        }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      await loadStaff(true);
      setStaffMsg("✅ Horario actualizado.");
    } catch (e: any) {
      setStaffMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function deleteSchedule(schedule_id: string) {
    if (!confirm("¿Borrar este horario?")) return;
    try {
      setStaffMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/admin/staff/schedules", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete_schedule",
          schedule_id,
        }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      await loadStaff(true);
      setStaffMsg("✅ Horario borrado.");
    } catch (e: any) {
      setStaffMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  useEffect(() => {
    if (!ok) return;
    listInvoices(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, month]);

  useEffect(() => {
    if (!ok) return;

    if (lastMonthRef.current !== month) {
      lastMonthRef.current = month;
    }

    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(() => {
      if (tab === "facturas") {
        listInvoices(true);
      }
      if (tab === "estadisticas") {
        loadAdminStats(true);
      }
      if (tab === "contabilidad") {
        loadAccounting(true);
      }
    }, 8000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, tab, month, selId]);

  useEffect(() => {
    if (!ok) return;
    if (tab === "asistencia") {
      loadAttendance();
      loadStaff();

      if (!stFrom && !stTo) {
        const d = new Date();
        const to = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const d2 = new Date(d.getTime() - 6 * 86400000);
        const from = `${d2.getFullYear()}-${String(d2.getMonth() + 1).padStart(2, "0")}-${String(d2.getDate()).padStart(2, "0")}`;
        setStFrom(from);
        setStTo(to);
      }
    }
    if (tab === "estadisticas") {
      loadAdminStats(false);
    }
    if (tab === "contabilidad") {
      loadAccounting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, tab, month]);

  async function loadChecklistAdmin() {
    if (ckLoading) return;
    setCkLoading(true);
    setCkMsg("");
    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch(`/api/admin/checklists/items?template_key=${encodeURIComponent(ckTemplateKey)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}. ${j?._raw || "(vacía)"}`);

      setCkTemplate(j.template || null);
      setCkItems(j.items || []);
      setCkMsg(`✅ Cargados ${(j.items || []).length} items (${ckTemplateKey})`);
    } catch (e: any) {
      setCkTemplate(null);
      setCkItems([]);
      setCkMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setCkLoading(false);
    }
  }

  async function saveChecklistItem(item: any) {
    try {
      setCkMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;

      const payload = {
        template_key: ckTemplateKey,
        id: item?.id || "",
        label: String(item?.label || "").trim(),
        sort: Number(item?.sort ?? 0),
      };

      const r = await fetch("/api/admin/checklists/items", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setCkMsg(payload.id ? "✅ Item guardado." : "✅ Item creado.");
      await loadChecklistAdmin();
    } catch (e: any) {
      setCkMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function deleteChecklistItem(id: string) {
    if (!confirm("¿Borrar este item del checklist?")) return;
    try {
      setCkMsg("");
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/admin/checklists/items", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_item", id }),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setCkMsg("✅ Item borrado.");
      await loadChecklistAdmin();
    } catch (e: any) {
      setCkMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function addChecklistItem() {
    const label = ckNewLabel.trim();
    const sort = Number(String(ckNewSort).replace(",", "."));
    if (!label) return setCkMsg("⚠️ Escribe un texto para el item.");
    if (!isFinite(sort)) return setCkMsg("⚠️ Sort inválido.");

    await saveChecklistItem({ id: "", label, sort });
    setCkNewLabel("");
    setCkNewSort(String(sort + 10));
  }

  useEffect(() => {
    if (!ok) return;
    if (tab === "checklists") loadChecklistAdmin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, tab, ckTemplateKey]);

  const ckFiltered = useMemo(() => {
    const qq = ckQ.trim().toLowerCase();
    if (!qq) return ckItems || [];
    return (ckItems || []).filter((x: any) => String(x.label || "").toLowerCase().includes(qq));
  }, [ckItems, ckQ]);

  const expectedNow = useMemo(() => {
    return (attExpected || []).map((x: any) => ({
      ...x,
      is_online: typeof x.online === "boolean" ? !!x.online : !!x.is_online,
      status: String(x.status || "working"),
    }));
  }, [attExpected]);

  const workersFromInvoices = useMemo(() => {
    const map = new Map<string, any>();
    for (const inv of invoices || []) {
      const wid = String(inv.worker_id || inv.id || inv.worker?.id || "");
      if (!wid) continue;
      if (!map.has(wid)) {
        map.set(wid, {
          worker_id: wid,
          display_name: inv.display_name || "—",
          role: inv.role || "",
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => String(a.display_name).localeCompare(String(b.display_name)));
  }, [invoices]);

  const statsInvoiceMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const inv of invoices || []) {
      map.set(String(inv.worker_id), inv);
    }
    return map;
  }, [invoices]);

  const statsMergedRows = useMemo(() => {
    return (statsRows || []).map((r: any) => {
      const inv = statsInvoiceMap.get(String(r.worker_id));
      return {
        ...r,
        invoice_total: Number(inv?.total || 0),
        invoice_status: inv?.status || "",
        worker_ack: inv?.worker_ack || null,
        worker_ack_note: inv?.worker_ack_note || null,
      };
    });
  }, [statsRows, statsInvoiceMap]);

  const statsComputed = useMemo(() => {
    const invoiceTotal = (invoices || []).reduce((a, x) => a + Number(x.total || 0), 0);
    const accepted = (invoices || []).filter((x: any) => String(x.worker_ack || "") === "accepted").length;
    const rejected = (invoices || []).filter((x: any) => String(x.worker_ack || "") === "rejected").length;
    const review = (invoices || []).filter((x: any) => String(x.worker_ack || "") === "review").length;
    const pending = (invoices || []).filter((x: any) => !x.worker_ack || String(x.worker_ack) === "pending").length;

    const workers = statsRows.length || 0;
    const minutes = Number(statsTotals?.minutes_total || 0);
    const calls = Number(statsTotals?.calls_total || 0);
    const captadas = Number(statsTotals?.captadas_total || 0);

    return {
      invoice_total: invoiceTotal,
      accepted,
      rejected,
      review,
      pending,
      workers,
      captadas_per_worker: workers ? captadas / workers : 0,
      calls_per_worker: workers ? calls / workers : 0,
      minutes_per_worker: workers ? minutes / workers : 0,
      captadas_per_100_min: minutes ? (captadas / minutes) * 100 : 0,
      factura_media: workers ? invoiceTotal / workers : 0,
    };
  }, [invoices, statsRows, statsTotals]);

  const attSummary = useMemo(() => {
    const online = (attOnline || []).length;
    const expected = (expectedNow || []).length;
    const missing = (expectedNow || []).filter((x: any) => !x.is_online).length;
    const breakCount = (attOnline || []).filter((x: any) => String(x.status || "") === "break").length;
    const bathroomCount = (attOnline || []).filter((x: any) => String(x.status || "") === "bathroom").length;
    return {
      online,
      expected,
      missing,
      breakCount,
      bathroomCount,
      incidents: (attIncidents || []).length,
    };
  }, [attOnline, expectedNow, attIncidents]);

  const topWorkersByMinutes = useMemo(() => {
    return [...(statsMergedRows || [])]
      .sort((a: any, b: any) => {
        const bm = Number(b.minutes_total || 0);
        const am = Number(a.minutes_total || 0);
        if (bm !== am) return bm - am;
        return String(a.display_name || "").localeCompare(String(b.display_name || ""));
      })
      .slice(0, 5);
  }, [statsMergedRows]);

  const filteredWorkers = useMemo(() => {
    const q = staffQ.trim().toLowerCase();
    if (!q) return staffWorkers || [];
    return (staffWorkers || []).filter((w: any) => {
      const text = [
        w.display_name || "",
        w.role || "",
        w.team || "",
        w.email || "",
      ]
        .join(" ")
        .toLowerCase();
      return text.includes(q);
    });
  }, [staffWorkers, staffQ]);

  const staffOperationalWorkers = useMemo(() => {
    return (filteredWorkers || []).filter((w: any) => String(w.role || "") !== "admin");
  }, [filteredWorkers]);

  const schedulesByWorker = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const s of staffSchedules || []) {
      const wid = String(s.worker_id || "");
      if (!map.has(wid)) map.set(wid, []);
      map.get(wid)!.push(s);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const da = Number(a.day_of_week || 0);
        const db = Number(b.day_of_week || 0);
        if (da !== db) return da - db;
        return String(a.start_time || "").localeCompare(String(b.start_time || ""));
      });
    }
    return map;
  }, [staffSchedules]);

    if (!ok) return <div style={{ padding: 40 }}>Cargando…</div>;

  return (
    <>
      <AppHeader />

      <div className="tc-wrap">
        <div className="tc-container">
          <div className="tc-card">
            <div className="tc-row" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="tc-title" style={{ fontSize: 18 }}>👑 Admin — Tarot Celestial</div>
                <div className="tc-sub">Sincronización · Facturas · Estadísticas · Contabilidad · Edición · Asistencia · Checklists · CRM</div>
              </div>

              <div className="tc-row">
                <span className="tc-chip">Mes</span>
                <input
                  className="tc-input"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  placeholder="2026-02"
                  style={{ width: 120 }}
                />
                <button className="tc-btn tc-btn-purple" onClick={() => listInvoices()} disabled={listLoading}>
                  {listLoading ? "Cargando…" : "Cargar"}
                </button>
              </div>
            </div>

            <div style={{ marginTop: 12 }} className="tc-tabs">
              <button className={`tc-tab ${tab === "facturas" ? "tc-tab-active" : ""}`} onClick={() => setTab("facturas")}>
                🧾 Facturas
              </button>
              <button className={`tc-tab ${tab === "editor" ? "tc-tab-active" : ""}`} onClick={() => setTab("editor")}>
                ✏️ Editor
              </button>
              <button className={`tc-tab ${tab === "estadisticas" ? "tc-tab-active" : ""}`} onClick={() => setTab("estadisticas")}>
                📈 Estadísticas
              </button>
              <button className={`tc-tab ${tab === "contabilidad" ? "tc-tab-active" : ""}`} onClick={() => setTab("contabilidad")}>
                💼 Contabilidad
              </button>
              <button className={`tc-tab ${tab === "asistencia" ? "tc-tab-active" : ""}`} onClick={() => setTab("asistencia")}>
                🟢 Asistencia
              </button>
              <button className={`tc-tab ${tab === "checklists" ? "tc-tab-active" : ""}`} onClick={() => setTab("checklists")}>
                ✅ Checklists
              </button>
              <button className={`tc-tab ${tab === "crm" ? "tc-tab-active" : ""}`} onClick={() => setTab("crm")}>
                👥 CRM
              </button>
              <button className={`tc-tab ${tab === "sync" ? "tc-tab-active" : ""}`} onClick={() => setTab("sync")}>
                🔄 Sync
              </button>
            </div>
          </div>

          {tab === "facturas" && (
            <div className="tc-card">
              <div className="tc-row" style={{ justifyContent: "space-between" }}>
                <div>
                  <div className="tc-title">🧾 Facturas del mes</div>
                  <div className="tc-sub">Genera y revisa. Click para editar. (Se actualiza “en directo”)</div>
                </div>

                <div className="tc-row">
                  <button className="tc-btn tc-btn-ok" onClick={generateInvoices} disabled={genLoading}>
                    {genLoading ? "Generando…" : "Generar facturas"}
                  </button>
                  <button className="tc-btn tc-btn-gold" onClick={() => listInvoices()} disabled={listLoading}>
                    {listLoading ? "Cargando…" : "Ver resumen"}
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 10 }} className="tc-sub">{genMsg || listMsg || " "}</div>

              <div className="tc-hr" />

              <div className="tc-sub">
                Total sumado: <b>{eur(totalSum)}</b> · Click en una fila para editar
              </div>

              <div style={{ overflowX: "auto", marginTop: 8 }}>
                <table className="tc-table">
                  <thead>
                    <tr>
                      <th>Trabajador</th>
                      <th>Rol</th>
                      <th>Estado</th>
                      <th>Aceptación</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(invoices || []).map((x: any) => (
                      <tr
                        key={x.invoice_id}
                        className="tc-click"
                        onClick={() => loadInvoice(x.invoice_id)}
                        style={{ background: selId === x.invoice_id ? "rgba(181,156,255,0.10)" : "transparent" }}
                      >
                        <td><b>{x.display_name}</b></td>
                        <td className="tc-muted">{x.role}</td>
                        <td className="tc-muted">{x.status}</td>
                        <td>
                          <span
                            className="tc-chip"
                            style={{
                              ...ackStyle(x.worker_ack),
                              padding: "6px 10px",
                              borderRadius: 999,
                              fontSize: 12,
                            }}
                            title={x.worker_ack_note || ""}
                          >
                            {ackLabel(x.worker_ack)}
                          </span>
                        </td>
                        <td><b>{eur(x.total || 0)}</b></td>
                      </tr>
                    ))}
                    {(!invoices || invoices.length === 0) && (
                      <tr>
                        <td colSpan={5} className="tc-muted">No hay facturas cargadas. Pulsa “Ver resumen”.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="tc-sub" style={{ marginTop: 10, opacity: 0.8 }}>
                Tip: si una tarotista rechaza, verás el motivo al pasar el ratón por “Aceptación”.
              </div>
            </div>
          )}

          {tab === "editor" && (
            <div className="tc-card">
              <div className="tc-row" style={{ justifyContent: "space-between" }}>
                <div>
                  <div className="tc-title">✏️ Editor de factura</div>
                  <div className="tc-sub">Líneas con desglose automático (minutos x tarifa)</div>
                </div>

                {selId && (
                  <div className="tc-row">
                    <button className="tc-btn tc-btn-gold" onClick={() => loadInvoice(selId)}>Recargar</button>
                    <button className="tc-btn" onClick={() => setStatus("draft")}>Draft</button>
                    <button className="tc-btn tc-btn-ok" onClick={() => setStatus("final")}>Finalizar</button>
                  </div>
                )}
              </div>

              {!selId ? (
                <div className="tc-sub" style={{ marginTop: 10 }}>Selecciona una factura desde <b>Facturas</b>.</div>
              ) : selLoading ? (
                <div className="tc-sub" style={{ marginTop: 10 }}>Cargando…</div>
              ) : (
                <>
                  <div style={{ marginTop: 10 }} className="tc-sub">
                    <b>{selWorker?.display_name}</b> · {selWorker?.role} · Mes <b>{selInvoice?.month_key}</b>
                    <br />
                    Total: <b>{eur(selInvoice?.total || 0)}</b> · Estado: <b>{selInvoice?.status}</b>
                    <br />
                    Aceptación:{" "}
                    <span className="tc-chip" style={{ ...ackStyle(selInvoice?.worker_ack), padding: "4px 10px" }}>
                      {ackLabel(selInvoice?.worker_ack)}
                    </span>
                    {selInvoice?.worker_ack_note ? (
                      <>
                        {" "}· Nota: <b>{selInvoice.worker_ack_note}</b>
                      </>
                    ) : null}
                  </div>

                  <div className="tc-hr" />

                  <div style={{ display: "grid", gap: 10 }}>
                    {(selLines || []).map((l: any) => (
                      <LineEditor
                        key={l.id}
                        line={l}
                        onSave={(payload) => updateLine(l.id, payload)}
                        onDelete={() => deleteLine(l.id)}
                      />
                    ))}
                  </div>

                  <div className="tc-hr" />

                  <div className="tc-title" style={{ fontSize: 14 }}>➕ Añadir línea</div>

                  <div className="tc-row" style={{ marginTop: 8, flexWrap: "wrap" }}>
                    <select className="tc-select" value={newKind} onChange={(e) => setNewKind(e.target.value)}>
                      <option value="adjustment">adjustment</option>
                      <option value="incident">incident</option>
                      <option value="bonus_ranking">bonus_ranking</option>
                      <option value="bonus_captadas">bonus_captadas</option>
                      <option value="minutes_free">minutes_free</option>
                      <option value="minutes_rueda">minutes_rueda</option>
                      <option value="minutes_cliente">minutes_cliente</option>
                      <option value="minutes_repite">minutes_repite</option>
                      <option value="salary_base">salary_base</option>
                    </select>

                    <input className="tc-input" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} style={{ width: 240 }} />
                    <input className="tc-input" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} style={{ width: 140 }} />

                    <button className="tc-btn tc-btn-gold" onClick={addLine}>Añadir</button>
                  </div>

                  <div style={{ marginTop: 10 }} className="tc-sub">{selMsg || " "}</div>
                </>
              )}
            </div>
          )}

          {tab === "estadisticas" && (
            <div style={{ display: "grid", gap: 16 }}>
              <div className="tc-card">
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div className="tc-title">📈 Estadísticas del mes</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Vista global clara de producción, facturación y estado de facturas
                      {statsMsg ? ` · ${statsMsg}` : ""}
                    </div>
                  </div>

                  <button className="tc-btn tc-btn-gold" onClick={() => loadAdminStats(false)} disabled={statsLoading}>
                    {statsLoading ? "Cargando…" : "Actualizar estadísticas"}
                  </button>
                </div>

                <div className="tc-hr" />

                <div className="tc-title" style={{ fontSize: 14 }}>Resumen general</div>
                <div className="tc-grid-4" style={{ marginTop: 12 }}>
                  <KpiBox label="Tarotistas con datos" value={String(statsComputed.workers)} />
                  <KpiBox label="Minutos totales" value={numES(statsTotals?.minutes_total || 0, 0)} />
                  <KpiBox label="Llamadas totales" value={numES(statsTotals?.calls_total || 0, 0)} />
                  <KpiBox label="Captadas totales" value={numES(statsTotals?.captadas_total || 0, 0)} />
                </div>

                <div className="tc-hr" />

                <div className="tc-title" style={{ fontSize: 14 }}>Dinero y productividad</div>
                <div className="tc-grid-4" style={{ marginTop: 12 }}>
                  <KpiBox label="Pago por minutos" value={eur(statsTotals?.pay_minutes || 0)} />
                  <KpiBox label="Bonus captadas" value={eur(statsTotals?.bonus_captadas || 0)} />
                  <KpiBox label="Facturación total" value={eur(statsComputed.invoice_total || 0)} highlight />
                  <KpiBox label="Factura media" value={eur(statsComputed.factura_media || 0)} />
                  <KpiBox label="Minutos por tarotista" value={numES(statsComputed.minutes_per_worker || 0, 0)} />
                  <KpiBox label="Llamadas por tarotista" value={numES(statsComputed.calls_per_worker || 0, 2)} />
                  <KpiBox label="Captadas por tarotista" value={numES(statsComputed.captadas_per_worker || 0, 2)} />
                  <KpiBox label="Captadas / 100 min" value={numES(statsComputed.captadas_per_100_min || 0, 2)} />
                </div>

                <div className="tc-hr" />

                <div className="tc-title" style={{ fontSize: 14 }}>Calidad y facturas</div>
                <div className="tc-grid-4" style={{ marginTop: 12 }}>
                  <KpiBox label="% Cliente medio" value={`${numES(statsTotals?.avg_pct_cliente || 0, 2)}%`} />
                  <KpiBox label="% Repite medio" value={`${numES(statsTotals?.avg_pct_repite || 0, 2)}%`} />
                  <KpiBox label="Facturas aceptadas" value={String(statsComputed.accepted)} />
                  <KpiBox label="Facturas pendientes" value={String(statsComputed.pending)} />
                </div>
              </div>

              <div className="tc-grid-3">
                <TopStatsCard
                  title="🏆 Top captadas"
                  items={(statsTop?.captadas || []).map((x: any) => `${x.display_name} (${x.captadas_total})`)}
                />
                <TopStatsCard
                  title="👑 Top % cliente"
                  items={(statsTop?.cliente || []).map((x: any) => `${x.display_name} (${numES(x.pct_cliente || 0, 2)}%)`)}
                />
                <TopStatsCard
                  title="🔁 Top % repite"
                  items={(statsTop?.repite || []).map((x: any) => `${x.display_name} (${numES(x.pct_repite || 0, 2)}%)`)}
                />
              </div>

              <div className="tc-grid-2">
                <div className="tc-card">
                  <div className="tc-title" style={{ fontSize: 14 }}>🔥💧 Equipos</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Comparativa clara entre fuego y agua
                  </div>
                  <div className="tc-hr" />
                  <div className="tc-kpis">
                    <KpiMini label="Fuego score" value={numES(statsTeams?.fuego?.score || 0, 2)} />
                    <KpiMini label="Fuego miembros" value={String(statsTeams?.fuego?.members || 0)} />
                    <KpiMini label="Agua score" value={numES(statsTeams?.agua?.score || 0, 2)} />
                    <KpiMini label="Agua miembros" value={String(statsTeams?.agua?.members || 0)} />
                    <KpiMini label="Ganador" value={String(statsTeams?.winner || "empate")} />
                    <KpiMini label="Revisión" value={String(statsComputed.review)} />
                  </div>
                </div>

                <div className="tc-card">
                  <div className="tc-title" style={{ fontSize: 14 }}>⏱️ Top por minutos</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Las 5 tarotistas con más producción del mes
                  </div>
                  <div className="tc-hr" />
                  <div style={{ display: "grid", gap: 10 }}>
                    {(topWorkersByMinutes || []).map((r: any, i: number) => (
                      <div
                        key={r.worker_id}
                        style={{
                          border: "1px solid rgba(255,255,255,0.10)",
                          borderRadius: 14,
                          padding: 10,
                          background: "rgba(255,255,255,0.03)",
                        }}
                      >
                        <div className="tc-row" style={{ justifyContent: "space-between", gap: 10 }}>
                          <div>
                            <div style={{ fontWeight: 900 }}>
                              {i + 1}. {r.display_name}
                            </div>
                            <div className="tc-sub" style={{ marginTop: 4 }}>
                              Equipo: <b>{r.team || "—"}</b> · Captadas: <b>{numES(r.captadas_total || 0, 0)}</b>
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontWeight: 900 }}>{numES(r.minutes_total || 0, 0)} min</div>
                            <div className="tc-sub">{eur(r.invoice_total || 0)}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {(!topWorkersByMinutes || topWorkersByMinutes.length === 0) && (
                      <div className="tc-sub">Sin datos.</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="tc-card">
                <div className="tc-title">📋 Rendimiento por tarotista</div>
                <div className="tc-sub" style={{ marginTop: 6 }}>
                  Tabla completa con producción, calidad, dinero y aceptación de factura
                </div>

                <div className="tc-hr" />

                <div style={{ overflowX: "auto" }}>
                  <table className="tc-table">
                    <thead>
                      <tr>
                        <th>Tarotista</th>
                        <th>Equipo</th>
                        <th>Minutos</th>
                        <th>Llamadas</th>
                        <th>Captadas</th>
                        <th>% Cliente</th>
                        <th>% Repite</th>
                        <th>Pago minutos</th>
                        <th>Bonus captadas</th>
                        <th>Factura</th>
                        <th>Aceptación</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(statsMergedRows || []).map((r: any) => (
                        <tr key={r.worker_id}>
                          <td><b>{r.display_name}</b></td>
                          <td className="tc-muted">{r.team || "—"}</td>
                          <td>{numES(r.minutes_total || 0, 0)}</td>
                          <td>{numES(r.calls_total || 0, 0)}</td>
                          <td><b>{numES(r.captadas_total || 0, 0)}</b></td>
                          <td>{numES(r.pct_cliente || 0, 2)}%</td>
                          <td>{numES(r.pct_repite || 0, 2)}%</td>
                          <td>{eur(r.pay_minutes || 0)}</td>
                          <td>{eur(r.bonus_captadas || 0)}</td>
                          <td><b>{eur(r.invoice_total || 0)}</b></td>
                          <td>
                            <span
                              className="tc-chip"
                              style={{
                                ...ackStyle(r.worker_ack),
                                padding: "6px 10px",
                                borderRadius: 999,
                                fontSize: 12,
                              }}
                              title={r.worker_ack_note || ""}
                            >
                              {ackLabel(r.worker_ack)}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {(!statsMergedRows || statsMergedRows.length === 0) && (
                        <tr>
                          <td colSpan={11} className="tc-muted">No hay estadísticas para este mes.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab === "contabilidad" && (
            <AdminAccountingTab
              month={month}
              loading={accLoading}
              msg={accMsg}
              totals={accTotals}
              entries={accEntries}
              months={accMonths}
              breakdown={accBreakdown}
              onRefresh={() => loadAccounting(false)}
              onCreate={createAccountingEntry}
              onDelete={deleteAccountingEntry}
            />
          )}

          {tab === "asistencia" && (
            <div style={{ display: "grid", gap: 16 }}>
              <div className="tc-card">
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div className="tc-title">🟢 Asistencia (en vivo)</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Vista operativa del turno actual y del control horario
                      {attMsg ? ` · ${attMsg}` : ""}
                    </div>
                  </div>

                  <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <button className="tc-btn tc-btn-gold" onClick={loadAttendance} disabled={attLoading}>
                      {attLoading ? "Cargando…" : "Actualizar"}
                    </button>
                    <button className="tc-btn tc-btn-danger" onClick={runAttendanceEngine}>
                      Ejecutar motor
                    </button>
                  </div>
                </div>

                <div className="tc-hr" />

                <div className="tc-grid-4">
                  <KpiBox label="Conectados ahora" value={String(attSummary.online)} />
                  <KpiBox label="Deberían estar" value={String(attSummary.expected)} />
                  <KpiBox label="Faltando ahora" value={String(attSummary.missing)} />
                  <KpiBox label="Incidencias del mes" value={String(attSummary.incidents)} />
                  <KpiBox label="En descanso" value={String(attSummary.breakCount)} />
                  <KpiBox label="En baño" value={String(attSummary.bathroomCount)} />
                  <KpiBox label="Penalización retraso" value="1,00 €" />
                  <KpiBox label="Penalización falta" value="12,00 €" />
                </div>
              </div>

              <div className="tc-grid-2">
                <div className="tc-card">
                  <div className="tc-title" style={{ fontSize: 14 }}>🟢 Conectados ahora</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Estado real según control horario
                  </div>
                  <div className="tc-hr" />

                  {(attOnline || []).length === 0 ? (
                    <div className="tc-sub">Nadie conectado ahora mismo.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {(attOnline || []).map((o: any) => (
                        <div
                          key={o.worker_id}
                          style={{
                            border: "1px solid rgba(255,255,255,0.10)",
                            borderRadius: 14,
                            padding: 12,
                            background: "rgba(120,255,190,0.06)",
                          }}
                        >
                          <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                            <div>
                              <div style={{ fontWeight: 900 }}>{o.display_name}</div>
                              <div className="tc-sub" style={{ marginTop: 4 }}>
                                {o.role}
                                {o.team ? ` · ${o.team}` : ""}
                                {o.status ? <> · Estado: <b>{o.status}</b></> : null}
                              </div>
                            </div>
                            <div className="tc-sub">
                              Último evento: <b>{o.last_event_at ? new Date(o.last_event_at).toLocaleTimeString("es-ES") : "—"}</b>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="tc-card">
                  <div className="tc-title" style={{ fontSize: 14 }}>🕒 Deberían estar conectados</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Comparativa entre horario activo y presencia real
                  </div>
                  <div className="tc-hr" />

                  {(expectedNow || []).length === 0 ? (
                    <div className="tc-sub">No hay horarios activos ahora mismo.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {(expectedNow || []).map((x: any) => (
                        <div
                          key={`${x.schedule_id}-${x.worker_id}`}
                          style={{
                            border: "1px solid rgba(255,255,255,0.10)",
                            borderRadius: 14,
                            padding: 12,
                            background: x.is_online ? "rgba(120,255,190,0.08)" : "rgba(255,80,80,0.06)",
                          }}
                        >
                          <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                            <div>
                              <div style={{ fontWeight: 900 }}>
                                {x.worker?.display_name || x.display_name || x.worker_id}
                              </div>
                              <div className="tc-sub" style={{ marginTop: 4 }}>
                                {x.worker?.role || x.role || "—"} · {x.start_time}–{x.end_time} · {x.timezone}
                              </div>
                              <div className="tc-sub" style={{ marginTop: 4 }}>
                                Estado actual: <b>{x.status || "working"}</b>
                              </div>
                            </div>
                            <div
                              className="tc-chip"
                              style={{
                                padding: "6px 10px",
                                borderRadius: 999,
                                ...(x.is_online
                                  ? {
                                      background: "rgba(120,255,190,0.10)",
                                      border: "1px solid rgba(120,255,190,0.25)",
                                    }
                                  : {
                                      background: "rgba(255,80,80,0.10)",
                                      border: "1px solid rgba(255,80,80,0.25)",
                                    }),
                              }}
                            >
                              {x.is_online ? "🟢 OK" : "🔴 NO"}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="tc-card">
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div className="tc-title" style={{ fontSize: 14 }}>👥 Gestión de plantilla y horarios</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Tabla operativa para editar tarotistas, dar de baja y tocar horarios.
                      {staffMsg ? ` · ${staffMsg}` : ""}
                    </div>
                  </div>

                  <button className="tc-btn tc-btn-gold" onClick={() => loadStaff(false)} disabled={staffLoading}>
                    {staffLoading ? "Cargando…" : "Recargar plantilla"}
                  </button>
                </div>

                <div className="tc-hr" />

                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <input
                    className="tc-input"
                    value={staffQ}
                    onChange={(e) => setStaffQ(e.target.value)}
                    placeholder="Buscar tarotista o central…"
                    style={{ width: 320, maxWidth: "100%" }}
                  />

                  <div className="tc-sub">
                    Total visibles: <b>{staffOperationalWorkers.length}</b>
                  </div>
                </div>

                <div className="tc-hr" />

                <div style={{ overflowX: "auto" }}>
                  <table className="tc-table">
                    <thead>
                      <tr>
                        <th>Nombre</th>
                        <th>Rol</th>
                        <th>Equipo</th>
                        <th>Email</th>
                        <th>Estado</th>
                        <th>Horarios</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(staffOperationalWorkers || []).map((w: any) => {
                        const schedules = schedulesByWorker.get(String(w.id)) || [];
                        return (
                          <tr key={w.id}>
                            <td><b>{w.display_name || "—"}</b></td>
                            <td>{w.role || "—"}</td>
                            <td>{w.team || "—"}</td>
                            <td>{w.email || "—"}</td>
                            <td>
                              <span className="tc-chip" style={{ padding: "4px 10px" }}>
                                {w.is_active ? "Activo" : "Inactivo"}
                              </span>
                            </td>
                            <td>
                              {schedules.length === 0 ? (
                                <span className="tc-muted">Sin horarios</span>
                              ) : (
                                <div style={{ display: "grid", gap: 4 }}>
                                  {schedules.slice(0, 3).map((s: any) => (
                                    <span key={s.id} className="tc-sub">
                                      {dayName(s.day_of_week)} · {s.start_time}–{s.end_time}
                                    </span>
                                  ))}
                                  {schedules.length > 3 ? (
                                    <span className="tc-sub">+ {schedules.length - 3} más</span>
                                  ) : null}
                                </div>
                              )}
                            </td>
                            <td>
                              <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                                <button
                                  className="tc-btn"
                                  onClick={() => startEditWorker(w)}
                                >
                                  Editar
                                </button>
                                <button
                                  className="tc-btn tc-btn-gold"
                                  onClick={() => prepareScheduleForWorker(w)}
                                >
                                  Cambiar horario
                                </button>
                                {w.is_active ? (
                                  <button className="tc-btn tc-btn-danger" onClick={() => toggleWorker(w, false)}>
                                    Dar de baja
                                  </button>
                                ) : (
                                  <button className="tc-btn tc-btn-ok" onClick={() => toggleWorker(w, true)}>
                                    Activar
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {(!staffOperationalWorkers || staffOperationalWorkers.length === 0) && (
                        <tr>
                          <td colSpan={7} className="tc-muted">
                            No hay trabajadores que coincidan.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {editingWorkerId ? (
                  <>
                    <div className="tc-hr" />
                    <div
                      style={{
                        border: "1px solid rgba(255,255,255,0.10)",
                        borderRadius: 14,
                        padding: 12,
                        background: "rgba(255,255,255,0.03)",
                      }}
                    >
                      <div className="tc-title" style={{ fontSize: 14 }}>✏️ Editar trabajador</div>
                      <div className="tc-hr" />
                      <div className="tc-grid-4">
                        <div>
                          <div className="tc-sub">Nombre</div>
                          <input
                            className="tc-input"
                            value={editingWorkerName}
                            onChange={(e) => setEditingWorkerName(e.target.value)}
                            style={{ width: "100%", marginTop: 6 }}
                          />
                        </div>
                        <div>
                          <div className="tc-sub">Rol</div>
                          <select
                            className="tc-select"
                            value={editingWorkerRole}
                            onChange={(e) => setEditingWorkerRole(e.target.value as any)}
                            style={{ width: "100%", marginTop: 6 }}
                          >
                            <option value="tarotista">tarotista</option>
                            <option value="central">central</option>
                            <option value="admin">admin</option>
                          </select>
                        </div>
                        <div>
                          <div className="tc-sub">Equipo</div>
                          <input
                            className="tc-input"
                            value={editingWorkerTeam}
                            onChange={(e) => setEditingWorkerTeam(e.target.value)}
                            style={{ width: "100%", marginTop: 6 }}
                          />
                        </div>
                        <div>
                          <div className="tc-sub">Email</div>
                          <input
                            className="tc-input"
                            value={editingWorkerEmail}
                            onChange={(e) => setEditingWorkerEmail(e.target.value)}
                            style={{ width: "100%", marginTop: 6 }}
                          />
                        </div>
                      </div>

                      <div className="tc-row" style={{ justifyContent: "flex-end", marginTop: 12, gap: 8 }}>
                        <button className="tc-btn" onClick={cancelEditWorker}>
                          Cancelar
                        </button>
                        <button className="tc-btn tc-btn-ok" onClick={updateWorker}>
                          Guardar cambios
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}

                <div className="tc-hr" />

                <div className="tc-grid-2">
                  <div
                    style={{
                      border: "1px solid rgba(255,255,255,0.10)",
                      borderRadius: 14,
                      padding: 12,
                      background: "rgba(255,255,255,0.03)",
                    }}
                  >
                    <div className="tc-title" style={{ fontSize: 14 }}>➕ Añadir trabajador</div>
                    <div className="tc-hr" />
                    <div style={{ display: "grid", gap: 10 }}>
                      <input
                        className="tc-input"
                        value={newWorkerName}
                        onChange={(e) => setNewWorkerName(e.target.value)}
                        placeholder="Nombre"
                      />
                      <select className="tc-select" value={newWorkerRole} onChange={(e) => setNewWorkerRole(e.target.value as any)}>
                        <option value="tarotista">tarotista</option>
                        <option value="central">central</option>
                        <option value="admin">admin</option>
                      </select>
                      <input
                        className="tc-input"
                        value={newWorkerTeam}
                        onChange={(e) => setNewWorkerTeam(e.target.value)}
                        placeholder="Equipo (opcional)"
                      />
                      <input
                        className="tc-input"
                        value={newWorkerEmail}
                        onChange={(e) => setNewWorkerEmail(e.target.value)}
                        placeholder="Email (opcional)"
                      />
                      <div className="tc-row" style={{ justifyContent: "flex-end" }}>
                        <button className="tc-btn tc-btn-ok" onClick={createWorker}>
                          Crear trabajador
                        </button>
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      border: "1px solid rgba(255,255,255,0.10)",
                      borderRadius: 14,
                      padding: 12,
                      background: "rgba(255,255,255,0.03)",
                    }}
                  >
                    <div className="tc-title" style={{ fontSize: 14 }}>🕒 Añadir o cambiar horario</div>
                    <div className="tc-hr" />
                    <div style={{ display: "grid", gap: 10 }}>
                      <select className="tc-select" value={scheduleWorkerId} onChange={(e) => setScheduleWorkerId(e.target.value)}>
                        <option value="">Selecciona trabajador</option>
                        {(staffOperationalWorkers || []).map((w: any) => (
                          <option key={w.id} value={w.id}>
                            {w.display_name} ({w.role})
                          </option>
                        ))}
                      </select>

                      <select className="tc-select" value={scheduleDay} onChange={(e) => setScheduleDay(e.target.value)}>
                        <option value="0">Domingo</option>
                        <option value="1">Lunes</option>
                        <option value="2">Martes</option>
                        <option value="3">Miércoles</option>
                        <option value="4">Jueves</option>
                        <option value="5">Viernes</option>
                        <option value="6">Sábado</option>
                      </select>

                      <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <input className="tc-input" value={scheduleStart} onChange={(e) => setScheduleStart(e.target.value)} placeholder="10:00:00" style={{ width: 160 }} />
                        <input className="tc-input" value={scheduleEnd} onChange={(e) => setScheduleEnd(e.target.value)} placeholder="18:00:00" style={{ width: 160 }} />
                      </div>

                      <input
                        className="tc-input"
                        value={scheduleTimezone}
                        onChange={(e) => setScheduleTimezone(e.target.value)}
                        placeholder="Europe/Madrid"
                      />

                      <div className="tc-row" style={{ justifyContent: "flex-end" }}>
                        <button className="tc-btn tc-btn-ok" onClick={createSchedule}>
                          Crear horario
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="tc-hr" />

                <div style={{ display: "grid", gap: 12 }}>
                  {(staffOperationalWorkers || []).map((w: any) => {
                    const schedules = schedulesByWorker.get(String(w.id)) || [];
                    return (
                      <div
                        key={w.id}
                        style={{
                          border: "1px solid rgba(255,255,255,0.10)",
                          borderRadius: 14,
                          padding: 12,
                          background: scheduleWorkerId === String(w.id) ? "rgba(181,156,255,0.07)" : "rgba(255,255,255,0.03)",
                        }}
                      >
                        <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                          <div>
                            <div style={{ fontWeight: 900 }}>{w.display_name}</div>
                            <div className="tc-sub" style={{ marginTop: 4 }}>
                              {w.role} · {w.team || "sin equipo"} · {w.email || "sin email"}
                            </div>
                            <div className="tc-sub" style={{ marginTop: 4 }}>
                              Estado: <b>{w.is_active ? "Activo" : "Inactivo"}</b>
                            </div>
                          </div>

                          <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                            <button className="tc-btn" onClick={() => startEditWorker(w)}>
                              Editar ficha
                            </button>
                            <button className="tc-btn tc-btn-gold" onClick={() => prepareScheduleForWorker(w)}>
                              {scheduleWorkerId === String(w.id) ? "Horario seleccionado" : "Cambiar horario"}
                            </button>
                            {w.is_active ? (
                              <button className="tc-btn tc-btn-danger" onClick={() => toggleWorker(w, false)}>
                                Dar de baja
                              </button>
                            ) : (
                              <button className="tc-btn tc-btn-ok" onClick={() => toggleWorker(w, true)}>
                                Activar
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="tc-hr" />

                        {schedules.length === 0 ? (
                          <div className="tc-sub">Sin horarios asignados.</div>
                        ) : (
                          <div style={{ display: "grid", gap: 8 }}>
                            {schedules.map((s: any) => (
                              <ScheduleRow
                                key={s.id}
                                schedule={s}
                                onSave={(patch) => updateSchedule(s.id, patch)}
                                onDelete={() => deleteSchedule(s.id)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {(!staffOperationalWorkers || staffOperationalWorkers.length === 0) && (
                    <div className="tc-sub">No hay trabajadores que coincidan.</div>
                  )}
                </div>
              </div>

              <div className="tc-card">
                <div className="tc-title" style={{ fontSize: 14 }}>⚠️ Incidencias de asistencia</div>
                <div className="tc-sub" style={{ marginTop: 6 }}>
                  Mes {month}. Aquí justificas o marcas como no justificadas.
                </div>

                <div className="tc-hr" />

                <div className="tc-grid-2" style={{ marginBottom: 14 }}>
                  <div>
                    <div className="tc-sub">Nota para la decisión</div>
                    <input
                      className="tc-input"
                      value={attNote}
                      onChange={(e) => setAttNote(e.target.value)}
                      placeholder="Ej: justificó con captura / aviso previo…"
                      style={{ width: "100%", marginTop: 6 }}
                    />
                  </div>
                  <div
                    style={{
                      border: "1px solid rgba(255,255,255,0.10)",
                      borderRadius: 14,
                      padding: 12,
                      background: "rgba(255,255,255,0.03)",
                      alignSelf: "end",
                    }}
                  >
                    <div className="tc-sub">Resumen rápido</div>
                    <div style={{ fontWeight: 900, fontSize: 18, marginTop: 6 }}>
                      {(attIncidents || []).length} incidencia(s)
                    </div>
                  </div>
                </div>

                {(attIncidents || []).length === 0 ? (
                  <div className="tc-sub">No hay incidencias de asistencia en este mes.</div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {(attIncidents || []).map((i: any) => (
                      <div
                        key={i.id}
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
                              {i.display_name ? `${i.display_name} · ` : ""}
                              {i.reason || "Incidencia"}
                            </div>
                            <div className="tc-sub" style={{ marginTop: 4 }}>
                              {i.meta?.type ? `Tipo: ${i.meta.type}` : ""}
                              {i.meta?.date ? ` · Fecha: ${i.meta.date}` : ""}
                              {i.created_at ? ` · Creada: ${new Date(i.created_at).toLocaleString("es-ES")}` : ""}
                            </div>
                            {i.evidence_note ? (
                              <div className="tc-sub" style={{ marginTop: 4 }}>
                                Nota actual: <b>{i.evidence_note}</b>
                              </div>
                            ) : null}
                          </div>

                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontWeight: 900, fontSize: 18 }}>-{eur(i.amount)}</div>
                            <div className="tc-sub">
                              Estado: <b>{String(i.status || "unjustified")}</b>
                            </div>
                          </div>
                        </div>

                        <div className="tc-row" style={{ marginTop: 10, justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                          <button className="tc-btn tc-btn-ok" onClick={() => decideIncident(i.id, "justified")}>
                            Marcar JUSTIFICADA
                          </button>
                          <button className="tc-btn tc-btn-danger" onClick={() => decideIncident(i.id, "unjustified")}>
                            Marcar NO justificada
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="tc-card">
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div className="tc-title" style={{ fontSize: 14 }}>📊 Estadísticas horarias</div>
                    <div className="tc-sub" style={{ marginTop: 6 }}>
                      Worked = trabajo real · Break y baño separados · Expected = horario planificado
                      {stMsg ? ` · ${stMsg}` : ""}
                    </div>
                  </div>

                  <button className="tc-btn tc-btn-gold" onClick={() => loadStats(false)} disabled={stLoading}>
                    {stLoading ? "Cargando…" : "Cargar stats"}
                  </button>
                </div>

                <div className="tc-hr" />

                <div className="tc-grid-4">
                  <div>
                    <div className="tc-sub">Worker</div>
                    <input
                      className="tc-input"
                      value={stWorkerId}
                      onChange={(e) => setStWorkerId(e.target.value)}
                      placeholder="worker_id (opcional)"
                      style={{ width: "100%", marginTop: 6 }}
                    />
                  </div>

                  <div>
                    <div className="tc-sub">Agrupar</div>
                    <select
                      className="tc-select"
                      value={stGroup}
                      onChange={(e) => setStGroup(e.target.value as any)}
                      style={{ width: "100%", marginTop: 6 }}
                    >
                      <option value="day">día</option>
                      <option value="week">semana</option>
                      <option value="month">mes</option>
                    </select>
                  </div>

                  <div>
                    <div className="tc-sub">Desde</div>
                    <input
                      className="tc-input"
                      value={stFrom}
                      onChange={(e) => setStFrom(e.target.value)}
                      placeholder="YYYY-MM-DD"
                      style={{ width: "100%", marginTop: 6 }}
                    />
                  </div>

                  <div>
                    <div className="tc-sub">Hasta</div>
                    <input
                      className="tc-input"
                      value={stTo}
                      onChange={(e) => setStTo(e.target.value)}
                      placeholder="YYYY-MM-DD"
                      style={{ width: "100%", marginTop: 6 }}
                    />
                  </div>
                </div>

                <div className="tc-sub" style={{ marginTop: 10, opacity: 0.85 }}>
                  Tip: si quieres un desplegable global de workers, hacemos luego endpoint `/api/admin/workers/list`.
                </div>

                <div className="tc-hr" />

                <div style={{ overflowX: "auto" }}>
                  <table className="tc-table">
                    <thead>
                      <tr>
                        <th>Periodo</th>
                        <th>Trabajador</th>
                        <th>Rol</th>
                        <th>Worked</th>
                        <th>Break</th>
                        <th>Baño</th>
                        <th>Expected</th>
                        <th>Diff</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(stRows || []).map((r: any, idx: number) => {
                        const diff = Number(r.diff_minutes || 0);
                        const diffLabel = minsToHhmm(Math.abs(diff));
                        return (
                          <tr key={`${r.worker_id}-${r.group_key}-${idx}`}>
                            <td><b>{r.group_key}</b></td>
                            <td>{r.display_name || r.worker_id}</td>
                            <td className="tc-muted">{r.role || "—"}</td>
                            <td><b>{minsToHhmm(r.worked_minutes)}</b></td>
                            <td>{minsToHhmm(r.break_minutes)}</td>
                            <td>{minsToHhmm(r.bathroom_minutes)}</td>
                            <td>{minsToHhmm(r.expected_minutes)}</td>
                            <td style={{ fontWeight: 900 }}>
                              {diff >= 0 ? `+${diffLabel}` : `-${diffLabel}`}
                            </td>
                          </tr>
                        );
                      })}
                      {(!stRows || stRows.length === 0) && (
                        <tr>
                          <td colSpan={8} className="tc-muted">
                            Sin datos. Revisa el rango y el endpoint `/api/admin/attendance/stats`.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="tc-sub" style={{ marginTop: 10, opacity: 0.85 }}>
                  Nota: si quieres “Horas hechas” incluyendo descanso y baño, suma worked + break + baño.
                </div>
              </div>
            </div>
          )}

          {tab === "checklists" && (
            <div className="tc-card">
              <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div className="tc-title">✅ Checklists (plantillas)</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Aquí defines qué items aparecen en el checklist de <b>tarotista</b> o <b>central</b>.
                    {ckMsg ? ` · ${ckMsg}` : ""}
                  </div>
                </div>

                <div className="tc-row" style={{ flexWrap: "wrap", gap: 8 }}>
                  <select
                    className="tc-select"
                    value={ckTemplateKey}
                    onChange={(e) => setCkTemplateKey(e.target.value as any)}
                    style={{ minWidth: 220 }}
                  >
                    <option value="tarotista">tarotista</option>
                    <option value="central">central</option>
                  </select>

                  <button className="tc-btn tc-btn-gold" onClick={loadChecklistAdmin} disabled={ckLoading}>
                    {ckLoading ? "Cargando…" : "Recargar"}
                  </button>
                </div>
              </div>

              <div className="tc-hr" />

              <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <input
                  className="tc-input"
                  value={ckQ}
                  onChange={(e) => setCkQ(e.target.value)}
                  placeholder="Buscar item…"
                  style={{ width: 320, maxWidth: "100%" }}
                />

                <div className="tc-sub" style={{ opacity: 0.9 }}>
                  Plantilla: <b>{ckTemplate?.title || "—"}</b> · Items: <b>{(ckItems || []).length}</b>
                </div>
              </div>

              <div className="tc-hr" />

              <div className="tc-title" style={{ fontSize: 14 }}>➕ Añadir item</div>
              <div className="tc-row" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
                <input
                  className="tc-input"
                  value={ckNewLabel}
                  onChange={(e) => setCkNewLabel(e.target.value)}
                  placeholder="Texto del item…"
                  style={{ width: 420, maxWidth: "100%" }}
                />
                <input
                  className="tc-input"
                  value={ckNewSort}
                  onChange={(e) => setCkNewSort(e.target.value)}
                  placeholder="Sort"
                  style={{ width: 120 }}
                />
                <button className="tc-btn tc-btn-ok" onClick={addChecklistItem} disabled={ckLoading}>
                  Añadir
                </button>
              </div>

              <div className="tc-hr" />

              <div style={{ display: "grid", gap: 10 }}>
                {(ckFiltered || []).map((it: any) => (
                  <ChecklistRow
                    key={it.id}
                    item={it}
                    onSave={(next) => saveChecklistItem(next)}
                    onDelete={() => deleteChecklistItem(String(it.id))}
                  />
                ))}

                {(!ckFiltered || ckFiltered.length === 0) && (
                  <div className="tc-sub">No hay items (o no coinciden con la búsqueda).</div>
                )}
              </div>

              <div className="tc-hr" />

              <div className="tc-sub" style={{ opacity: 0.85 }}>
                Nota: al borrar un item, también se eliminan los “checks” ya marcados en turnos anteriores para ese item.
              </div>
            </div>
          )}

          {tab === "crm" && (
            <div className="tc-card">
              <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div className="tc-title">👥 CRM</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Buscador y ficha de clientes del call center
                  </div>
                </div>
              </div>

              <div className="tc-hr" />

              <div
                style={{
                  border: "1px solid rgba(255,255,255,0.10)",
                  borderRadius: 14,
                  padding: 16,
                  background: "rgba(255,255,255,0.03)",
                }}
              >
                <div style={{ fontWeight: 900 }}>Módulo CRM listo para conectar</div>
                <div className="tc-sub" style={{ marginTop: 8 }}>
                  En el siguiente paso pondremos aquí el buscador de cliente por teléfono o nombre.
                </div>
              </div>
            </div>
          )}

          {tab === "sync" && (
            <div className="tc-card">
              <div className="tc-row" style={{ justifyContent: "space-between" }}>
                <div>
                  <div className="tc-title">🔄 Sincronización</div>
                  <div className="tc-sub">Importa/actualiza llamadas desde Google Sheets</div>
                </div>

                <button className="tc-btn tc-btn-gold" onClick={syncNow} disabled={syncLoading}>
                  {syncLoading ? "Sincronizando…" : "Sincronizar ahora"}
                </button>
              </div>

              <div style={{ marginTop: 10 }} className="tc-sub">
                {syncMsg || "Haz sync antes de generar facturas para que cuadren minutos/captadas."}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
function KpiBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
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
      <div style={{ fontWeight: 900, fontSize: 20, marginTop: 6 }}>{value}</div>
    </div>
  );
}

function KpiMini({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 12,
        padding: 10,
        background: "rgba(255,255,255,0.03)",
      }}
    >
      <div className="tc-sub">{label}</div>
      <div style={{ fontWeight: 900, fontSize: 18, marginTop: 6 }}>{value}</div>
    </div>
  );
}

function TopStatsCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="tc-card" style={{ boxShadow: "none", padding: 14 }}>
      <div className="tc-title" style={{ fontSize: 14 }}>{title}</div>
      <div className="tc-hr" />
      <div style={{ display: "grid", gap: 8 }}>
        {(items || []).slice(0, 3).map((t, i) => (
          <div key={i} className="tc-row" style={{ justifyContent: "space-between" }}>
            <span>{i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"} {t}</span>
          </div>
        ))}
        {(!items || items.length === 0) && <div className="tc-sub">Sin datos</div>}
      </div>
    </div>
  );
}

function LineEditor({
  line,
  onSave,
  onDelete,
}: {
  line: any;
  onSave: (payload: { label: string; amount?: number; meta?: any }) => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState<string>(line.label || "");
  const [amount, setAmount] = useState<string>(String(line.amount ?? "0"));

  const meta = line?.meta || {};
  const hasBreakdown = meta && meta.minutes != null && meta.rate != null;

  const [minutes, setMinutes] = useState<string>(String(meta.minutes ?? ""));
  const [rate, setRate] = useState<string>(String(meta.rate ?? ""));

  useEffect(() => {
    setLabel(String(line.label || ""));
    setAmount(String(line.amount ?? "0"));
    setMinutes(String(line?.meta?.minutes ?? ""));
    setRate(String(line?.meta?.rate ?? ""));
  }, [line]);

  const parsedMinutes = Number(String(minutes).replace(",", "."));
  const parsedRate = Number(String(rate).replace(",", "."));
  const calcAmount = roundMoney((isFinite(parsedMinutes) ? parsedMinutes : 0) * (isFinite(parsedRate) ? parsedRate : 0));

  const displayAmount = hasBreakdown ? calcAmount : Number(String(amount).replace(",", ".")) || 0;
  const code = String(meta.code || "").toUpperCase();

  function saveLine() {
    if (hasBreakdown) {
      const nextMeta = {
        ...meta,
        minutes: isFinite(parsedMinutes) ? parsedMinutes : 0,
        rate: isFinite(parsedRate) ? parsedRate : 0,
      };

      onSave({
        label,
        meta: nextMeta,
      });
      return;
    }

    onSave({
      label,
      amount: Number(String(amount).replace(",", ".")) || 0,
      meta,
    });
  }

  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 14,
        padding: 12,
        background: "rgba(255,255,255,0.03)",
      }}
    >
      <div className="tc-row" style={{ justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 220 }}>
          <div style={{ fontWeight: 900 }}>{label}</div>
          {hasBreakdown && (
            <div className="tc-sub" style={{ marginTop: 6 }}>
              {numES(isFinite(parsedRate) ? parsedRate : 0, 2)}€ x {numES(isFinite(parsedMinutes) ? parsedMinutes : 0, 0)} min = <b>{eur(calcAmount)}</b>
              {code ? <> · Código <b>{code}</b></> : null}
            </div>
          )}
        </div>

        <div style={{ fontWeight: 900, whiteSpace: "nowrap" }}>{eur(displayAmount)}</div>
      </div>

      <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
        <input className="tc-input" value={label} onChange={(e) => setLabel(e.target.value)} style={{ width: "100%" }} />

        {hasBreakdown ? (
          <div className="tc-row" style={{ justifyContent: "space-between", marginTop: 0, flexWrap: "wrap" }}>
            <div style={{ minWidth: 160 }}>
              <div className="tc-sub">Minutos</div>
              <input
                className="tc-input"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                style={{ width: 160, marginTop: 6 }}
              />
            </div>

            <div style={{ minWidth: 160 }}>
              <div className="tc-sub">Tarifa €/min</div>
              <input
                className="tc-input"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                style={{ width: 160, marginTop: 6 }}
              />
            </div>

            <div style={{ minWidth: 180 }}>
              <div className="tc-sub">Importe recalculado</div>
              <div className="tc-chip" style={{ marginTop: 6 }}>
                <b>{eur(calcAmount)}</b>
              </div>
            </div>

            <div className="tc-row" style={{ alignItems: "flex-end" }}>
              <button className="tc-btn tc-btn-ok" onClick={saveLine}>
                Guardar
              </button>
              <button className="tc-btn tc-btn-danger" onClick={onDelete}>
                Borrar
              </button>
            </div>
          </div>
        ) : (
          <div className="tc-row" style={{ justifyContent: "space-between", marginTop: 0, flexWrap: "wrap" }}>
            <input className="tc-input" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 160 }} />

            <div className="tc-row">
              <button className="tc-btn tc-btn-ok" onClick={saveLine}>
                Guardar
              </button>
              <button className="tc-btn tc-btn-danger" onClick={onDelete}>
                Borrar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ScheduleRow({
  schedule,
  onSave,
  onDelete,
}: {
  schedule: any;
  onSave: (patch: any) => void;
  onDelete: () => void;
}) {
  const [day, setDay] = useState(String(schedule.day_of_week ?? 1));
  const [start, setStart] = useState(String(schedule.start_time || ""));
  const [end, setEnd] = useState(String(schedule.end_time || ""));
  const [timezone, setTimezone] = useState(String(schedule.timezone || "Europe/Madrid"));
  const [active, setActive] = useState(!!schedule.is_active);

  useEffect(() => {
    setDay(String(schedule.day_of_week ?? 1));
    setStart(String(schedule.start_time || ""));
    setEnd(String(schedule.end_time || ""));
    setTimezone(String(schedule.timezone || "Europe/Madrid"));
    setActive(!!schedule.is_active);
  }, [schedule]);

  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 12,
        padding: 10,
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 220 }}>
          <div style={{ fontWeight: 900 }}>{dayName(day)}</div>
          <div className="tc-sub" style={{ marginTop: 4 }}>
            {start} → {end} · {timezone}
          </div>
        </div>

        <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <select className="tc-select" value={day} onChange={(e) => setDay(e.target.value)} style={{ width: 130 }}>
            <option value="0">Domingo</option>
            <option value="1">Lunes</option>
            <option value="2">Martes</option>
            <option value="3">Miércoles</option>
            <option value="4">Jueves</option>
            <option value="5">Viernes</option>
            <option value="6">Sábado</option>
          </select>

          <input className="tc-input" value={start} onChange={(e) => setStart(e.target.value)} style={{ width: 120 }} />
          <input className="tc-input" value={end} onChange={(e) => setEnd(e.target.value)} style={{ width: 120 }} />
          <input className="tc-input" value={timezone} onChange={(e) => setTimezone(e.target.value)} style={{ width: 160 }} />

          <label className="tc-sub" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Activo
          </label>

          <button
            className="tc-btn tc-btn-ok"
            onClick={() =>
              onSave({
                day_of_week: Number(day),
                start_time: start,
                end_time: end,
                timezone,
                is_active: active,
              })
            }
          >
            Guardar
          </button>

          <button className="tc-btn tc-btn-danger" onClick={onDelete}>
            Borrar
          </button>
        </div>
      </div>
    </div>
  );
}

function ChecklistRow({
  item,
  onSave,
  onDelete,
}: {
  item: any;
  onSave: (next: any) => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState<string>(String(item.label || ""));
  const [sort, setSort] = useState<string>(String(item.sort ?? 0));
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    setLabel(String(item.label || ""));
    setSort(String(item.sort ?? 0));
  }, [item?.id]);

  function save() {
    setMsg("");
    const s = Number(String(sort).replace(",", "."));
    if (!String(label).trim()) return setMsg("⚠️ Falta texto");
    if (!isFinite(s)) return setMsg("⚠️ Sort inválido");
    onSave({ ...item, label: String(label).trim(), sort: s });
    setMsg("✅ Guardando…");
    setTimeout(() => setMsg(""), 1200);
  }

  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 14,
        padding: 12,
        background: "rgba(255,255,255,0.03)",
      }}
    >
      <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="tc-sub">Texto</div>
          <input className="tc-input" value={label} onChange={(e) => setLabel(e.target.value)} style={{ width: "100%", marginTop: 6 }} />
        </div>

        <div style={{ width: 140 }}>
          <div className="tc-sub">Sort</div>
          <input className="tc-input" value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: "100%", marginTop: 6 }} />
        </div>

        <div className="tc-row" style={{ gap: 8, alignItems: "flex-end" }}>
          <button className="tc-btn tc-btn-ok" onClick={save}>Guardar</button>
          <button className="tc-btn tc-btn-danger" onClick={onDelete}>Borrar</button>
        </div>
      </div>

      {msg ? <div className="tc-sub" style={{ marginTop: 8, opacity: 0.85 }}>{msg}</div> : null}
    </div>
  );
}
