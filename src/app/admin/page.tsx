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

  const [staffSelectedWorkerId, setStaffSelectedWorkerId] = useState("");

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
      const workerIdToUse = scheduleWorkerId || staffSelectedWorkerId;
      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/admin/staff/schedules", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_schedule",
          worker_id: workerIdToUse,
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

  const mergedStaffWorkers = useMemo(() => {
    const map = new Map<string, any>();

    for (const w of staffWorkers || []) {
      const id = String(w.id || w.worker_id || "");
      if (!id) continue;
      map.set(id, {
        id,
        worker_id: id,
        display_name: w.display_name || "—",
        role: w.role || "",
        team: w.team || "",
        email: w.email || "",
        is_active: w.is_active !== false,
        _source: "staff",
      });
    }

    for (const r of statsRows || []) {
      const id = String(r.worker_id || "");
      if (!id) continue;
      const prev = map.get(id) || {};
      map.set(id, {
        id,
        worker_id: id,
        display_name: prev.display_name || r.display_name || "—",
        role: prev.role || "tarotista",
        team: prev.team || r.team || "",
        email: prev.email || "",
        is_active: prev.is_active ?? true,
        _source: prev._source || "stats",
      });
    }

    for (const inv of invoices || []) {
      const id = String(inv.worker_id || "");
      if (!id) continue;
      const prev = map.get(id) || {};
      map.set(id, {
        id,
        worker_id: id,
        display_name: prev.display_name || inv.display_name || "—",
        role: prev.role || inv.role || "",
        team: prev.team || "",
        email: prev.email || "",
        is_active: prev.is_active ?? true,
        _source: prev._source || "invoice",
      });
    }

    for (const o of attOnline || []) {
      const id = String(o.worker_id || "");
      if (!id) continue;
      const prev = map.get(id) || {};
      map.set(id, {
        id,
        worker_id: id,
        display_name: prev.display_name || o.display_name || "—",
        role: prev.role || o.role || "",
        team: prev.team || o.team || "",
        email: prev.email || "",
        is_active: prev.is_active ?? true,
        _source: prev._source || "attendance",
      });
    }

    for (const e of expectedNow || []) {
      const id = String(e.worker_id || e.worker?.id || "");
      if (!id) continue;
      const prev = map.get(id) || {};
      map.set(id, {
        id,
        worker_id: id,
        display_name: prev.display_name || e.worker?.display_name || e.display_name || "—",
        role: prev.role || e.worker?.role || e.role || "",
        team: prev.team || e.worker?.team || e.team || "",
        email: prev.email || "",
        is_active: prev.is_active ?? true,
        _source: prev._source || "expected",
      });
    }

    return Array.from(map.values()).sort((a, b) =>
      String(a.display_name || "").localeCompare(String(b.display_name || ""))
    );
  }, [staffWorkers, statsRows, invoices, attOnline, expectedNow]);

  const filteredWorkers = useMemo(() => {
    const q = staffQ.trim().toLowerCase();
    const rows = mergedStaffWorkers || [];
    if (!q) return rows;
    return rows.filter((w: any) => {
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
  }, [mergedStaffWorkers, staffQ]);

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

  useEffect(() => {
    if (!staffSelectedWorkerId && mergedStaffWorkers.length > 0) {
      setStaffSelectedWorkerId(String(mergedStaffWorkers[0].id));
    }
  }, [mergedStaffWorkers, staffSelectedWorkerId]);

  useEffect(() => {
    if (!scheduleWorkerId && staffSelectedWorkerId) {
      setScheduleWorkerId(staffSelectedWorkerId);
    }
  }, [staffSelectedWorkerId, scheduleWorkerId]);

  const selectedStaffWorker = useMemo(() => {
    return (mergedStaffWorkers || []).find((w: any) => String(w.id) === String(staffSelectedWorkerId)) || null;
  }, [mergedStaffWorkers, staffSelectedWorkerId]);

  const selectedStaffSchedules = useMemo(() => {
    if (!staffSelectedWorkerId) return [];
    return schedulesByWorker.get(String(staffSelectedWorkerId)) || [];
  }, [schedulesByWorker, staffSelectedWorkerId]);

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
                <div className="tc-sub">Sincronización · Facturas · Estadísticas · Contabilidad · Edición · Asistencia · Checklists</div>
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

                  <div className="tc
}
