"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { supabaseBrowser } from "@/lib/supabase-browser";

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
  return x.toLocaleString("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });
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

type TabKey = "facturas" | "editor" | "asistencia" | "checklists" | "sync";

function ackLabel(v: any) {
  const s = String(v || "pending");
  if (s === "accepted") return "✅ Aceptada";
  if (s === "rejected") return "❌ Rechazada";
  return "⏳ Pendiente";
}

function ackStyle(v: any) {
  const s = String(v || "pending");
  if (s === "accepted") return { background: "rgba(120,255,190,0.10)", border: "1px solid rgba(120,255,190,0.25)" };
  if (s === "rejected") return { background: "rgba(255,80,80,0.10)", border: "1px solid rgba(255,80,80,0.25)" };
  return { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)" };
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

  // editor
  const [selId, setSelId] = useState<string>("");
  const [selLoading, setSelLoading] = useState(false);
  const [selMsg, setSelMsg] = useState<string>("");
  const [selInvoice, setSelInvoice] = useState<any>(null);
  const [selWorker, setSelWorker] = useState<any>(null);
  const [selLines, setSelLines] = useState<any[]>([]);
  const [newLabel, setNewLabel] = useState("Ajuste");
  const [newAmount, setNewAmount] = useState<string>("0");
  const [newKind, setNewKind] = useState("adjustment");

  // polling
  const pollRef = useRef<any>(null);
  const lastMonthRef = useRef<string>("");

  const totalSum = useMemo(() => {
    return (invoices || []).reduce((a, x) => a + Number(x.total || 0), 0);
  }, [invoices]);

  // ---------------------------
  // ✅ ASISTENCIA (online/expected/incidencias)
  // ---------------------------
  const [attLoading, setAttLoading] = useState(false);
  const [attMsg, setAttMsg] = useState("");
  const [attOnline, setAttOnline] = useState<any[]>([]);
  const [attExpected, setAttExpected] = useState<any[]>([]);
  const [attIncidents, setAttIncidents] = useState<any[]>([]);
  const [attNote, setAttNote] = useState<string>("");

  // ---------------------------
  // ✅ CHECKLIST ADMIN UI
  // ---------------------------
  const [ckTemplateKey, setCkTemplateKey] = useState<"tarotista" | "central">("tarotista");
  const [ckLoading, setCkLoading] = useState(false);
  const [ckMsg, setCkMsg] = useState("");
  const [ckTemplate, setCkTemplate] = useState<any>(null);
  const [ckItems, setCkItems] = useState<any[]>([]);
  const [ckQ, setCkQ] = useState("");

  const [ckNewLabel, setCkNewLabel] = useState("");
  const [ckNewSort, setCkNewSort] = useState<string>("10");

  // restore month
  useEffect(() => {
    try {
      const saved = localStorage.getItem("tc_month_admin");
      if (saved) setMonth(saved);
    } catch {}
  }, []);

  // save month
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

  async function updateLine(line_id: string, label: string, amount: number) {
    if (!selId) return;
    try {
      await postEdit({ action: "update_line", invoice_id: selId, line_id, label, amount });
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

  // auto load invoices
  useEffect(() => {
    if (!ok) return;
    listInvoices(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, month]);

  // polling
  useEffect(() => {
    if (!ok) return;

    if (lastMonthRef.current !== month) {
      lastMonthRef.current = month;
    }

    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(() => {
      if (tab === "facturas" || tab === "editor") {
        listInvoices(true);
        if (tab === "editor" && selId) loadInvoice(selId);
      }
    }, 8000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, tab, month, selId]);

  // ---------------------------
  // ✅ ASISTENCIA: API calls
  // ---------------------------
  async function loadAttendance() {
    if (attLoading) return;
    setAttLoading(true);
    setAttMsg("");
    try {
      const token = await getTokenOrLogin();
      if (!token) return;

      const [r1, r2] = await Promise.all([
        fetch("/api/admin/attendance/now", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/admin/attendance/expected-now", { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      const j1 = await safeJson(r1);
      const j2 = await safeJson(r2);

      if (!j1?._ok || !j1?.ok) throw new Error(j1?.error || `HTTP ${j1?._status}`);
      if (!j2?._ok || !j2?.ok) throw new Error(j2?.error || `HTTP ${j2?._status}`);

      setAttOnline(j1.online || []);
      setAttExpected(j2.expected || []);

      // incidencias del mes (attendance) => usamos month actual del admin para verlas
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

  useEffect(() => {
    if (!ok) return;
    if (tab === "asistencia") loadAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, tab, month]);

  // ---------------------------
  // ✅ CHECKLIST: API calls (igual que tenías)
  // ---------------------------
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

  // ---------------------------
  // helpers UI asistencia
  // ---------------------------
  const onlineSet = useMemo(() => {
    const s = new Set<string>();
    for (const o of attOnline || []) s.add(String(o.worker_id));
    return s;
  }, [attOnline]);

  const expectedNow = useMemo(() => {
    return (attExpected || []).map((x: any) => {
      const wid = String(x.worker_id);
      return {
        ...x,
        is_online: onlineSet.has(wid),
      };
    });
  }, [attExpected, onlineSet]);

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
                <div className="tc-sub">Sincronización · Facturas · Edición · Asistencia · Checklists</div>
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
                        onSave={(label, amount) => updateLine(l.id, label, amount)}
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

          {/* ✅ ASISTENCIA */}
          {tab === "asistencia" && (
            <div className="tc-card">
              <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div className="tc-title">🟢 Asistencia (en vivo)</div>
                  <div className="tc-sub" style={{ marginTop: 6 }}>
                    Retraso: <b>1€</b> si entra ≥ <b>5 min</b> tarde · Falta: <b>12€</b> si no conecta en todo el turno.
                    {attMsg ? ` · ${attMsg}` : ""}
                  </div>
                </div>

                <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button className="tc-btn tc-btn-gold" onClick={loadAttendance} disabled={attLoading}>
                    {attLoading ? "Cargando…" : "Actualizar"}
                  </button>
                  <button className="tc-btn tc-btn-danger" onClick={runAttendanceEngine}>
                    Ejecutar motor (crear incidencias)
                  </button>
                </div>
              </div>

              <div className="tc-hr" />

              <div className="tc-grid-2">
                <div className="tc-card" style={{ boxShadow: "none" }}>
                  <div className="tc-title" style={{ fontSize: 14 }}>🟢 Conectados ahora</div>
                  <div className="tc-hr" />
                  {(attOnline || []).length === 0 ? (
                    <div className="tc-sub">Nadie conectado (o aún no hay heartbeats).</div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      {(attOnline || []).map((o: any) => (
                        <div key={o.worker_id} className="tc-row" style={{ justifyContent: "space-between" }}>
                          <div>
                            <b>{o.display_name}</b>{" "}
                            <span className="tc-muted">({o.role}{o.team ? ` · ${o.team}` : ""})</span>
                            {o.path ? <div className="tc-sub">Ruta: {o.path}</div> : null}
                          </div>
                          <div className="tc-sub">
                            {o.last_seen_at ? new Date(o.last_seen_at).toLocaleTimeString("es-ES") : "—"}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="tc-card" style={{ boxShadow: "none" }}>
                  <div className="tc-title" style={{ fontSize: 14 }}>🕒 Deberían estar conectados ahora</div>
                  <div className="tc-hr" />
                  {(expectedNow || []).length === 0 ? (
                    <div className="tc-sub">No hay horarios activos ahora mismo.</div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      {(expectedNow || []).map((x: any) => (
                        <div
                          key={`${x.schedule_id}-${x.worker_id}`}
                          style={{
                            border: "1px solid rgba(255,255,255,0.10)",
                            borderRadius: 14,
                            padding: 10,
                            background: x.is_online ? "rgba(120,255,190,0.08)" : "rgba(255,80,80,0.06)",
                          }}
                        >
                          <div className="tc-row" style={{ justifyContent: "space-between" }}>
                            <div>
                              <b>{x.worker?.display_name || x.worker_id}</b>{" "}
                              <span className="tc-muted">({x.worker?.role || "—"})</span>
                              <div className="tc-sub" style={{ marginTop: 4 }}>
                                {x.start_time}–{x.end_time} · {x.timezone}
                              </div>
                            </div>
                            <div style={{ fontWeight: 900 }}>
                              {x.is_online ? "🟢 OK" : "🔴 NO"}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="tc-hr" />

              <div className="tc-title" style={{ fontSize: 14 }}>⚠️ Incidencias de asistencia (mes {month})</div>
              <div className="tc-sub" style={{ marginTop: 6 }}>
                Nota para justificar/no justificar:
              </div>
              <input
                className="tc-input"
                value={attNote}
                onChange={(e) => setAttNote(e.target.value)}
                placeholder="Ej: justificó con captura / aviso previo…"
                style={{ width: "100%", marginTop: 6 }}
              />

              <div className="tc-hr" />

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
                            {i.display_name ? `${i.display_name} · ` : ""}{i.reason || "Incidencia"}
                          </div>
                          <div className="tc-sub" style={{ marginTop: 4 }}>
                            {i.meta?.type ? `Tipo: ${i.meta.type}` : ""}{" "}
                            {i.meta?.date ? `· Fecha: ${i.meta.date}` : ""}{" "}
                            {i.created_at ? `· Creada: ${new Date(i.created_at).toLocaleString("es-ES")}` : ""}
                          </div>
                          {i.evidence_note ? (
                            <div className="tc-sub" style={{ marginTop: 4 }}>
                              Nota: <b>{i.evidence_note}</b>
                            </div>
                          ) : null}
                        </div>

                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontWeight: 900, fontSize: 18 }}>-{eur(i.amount)}</div>
                          <div className="tc-sub">Estado: <b>{String(i.status || "unjustified")}</b></div>
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
          )}

          {/* ✅ CHECKLISTS (igual que lo tenías) */}
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
}

function LineEditor({
  line,
  onSave,
  onDelete,
}: {
  line: any;
  onSave: (label: string, amount: number) => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState<string>(line.label || "");
  const [amount, setAmount] = useState<string>(String(line.amount ?? "0"));

  const meta = line?.meta || {};
  const hasBreakdown = meta && meta.minutes != null && meta.rate != null;

  const minutes = Number(meta.minutes || 0);
  const rate = Number(meta.rate || 0);
  const calc = minutes * rate;

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
              {numES(rate, 2)}€ x {numES(minutes, 0)} min = <b>{eur(calc)}</b> · Código <b>{String(meta.code || "").toUpperCase()}</b>
            </div>
          )}
        </div>

        <div style={{ fontWeight: 900, whiteSpace: "nowrap" }}>{eur(amount)}</div>
      </div>

      <div className="tc-row" style={{ justifyContent: "space-between", marginTop: 10, flexWrap: "wrap" }}>
        <input className="tc-input" value={label} onChange={(e) => setLabel(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
        <input className="tc-input" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 160 }} />

        <div className="tc-row">
          <button className="tc-btn tc-btn-ok" onClick={() => onSave(label, Number(String(amount).replace(",", ".")) || 0)}>
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
