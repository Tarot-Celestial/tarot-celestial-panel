"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import AppHeader from "@/components/AppHeader";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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

type TabKey = "facturas" | "editor" | "sync";

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

  // ✅ para polling “en directo”
  const pollRef = useRef<any>(null);
  const lastMonthRef = useRef<string>("");

  const totalSum = useMemo(() => {
    return (invoices || []).reduce((a, x) => a + Number(x.total || 0), 0);
  }, [invoices]);

  // ✅ restaurar mes guardado
  useEffect(() => {
    try {
      const saved = localStorage.getItem("tc_month_admin");
      if (saved) setMonth(saved);
    } catch {}
  }, []);

  // ✅ guardar mes
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

  // ✅ AUTO-CARGA al entrar y cuando cambie el mes
  useEffect(() => {
    if (!ok) return;
    listInvoices(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, month]);

  // ✅ Polling suave para ver aceptación “en directo”
  useEffect(() => {
    if (!ok) return;

    // si cambias de mes, limpia
    if (lastMonthRef.current !== month) {
      lastMonthRef.current = month;
    }

    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(() => {
      // refresco silencioso cada 8s cuando estás en facturas/editor
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
                <div className="tc-sub">Sincronización · Facturas · Edición · Aceptación</div>
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
