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

function parseNumES(v: any) {
  // soporta "12,34" o "12.34"
  const s = String(v ?? "").trim().replace(",", ".");
  const n = Number(s);
  return isFinite(n) ? n : 0;
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

type TabKey = "facturas" | "editor" | "sync" | "checklists";

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
  // CHECKLIST ADMIN UI
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

  async function apiGet(url: string) {
    const token = await getTokenOrLogin();
    if (!token) return null;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const j = await safeJson(r);
    if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}. ${j?._raw || "(vacía)"}`);
    return j;
  }

  async function apiPost(url: string, body: any) {
    const token = await getTokenOrLogin();
    if (!token) return null;
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await safeJson(r);
    if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}. ${j?._raw || "(vacía)"}`);
    return j;
  }

  async function syncNow() {
    if (syncLoading) return;
    setSyncLoading(true);
    setSyncMsg("");
    try {
      await apiPost("/api/sync/calls", {});
      setSyncMsg("✅ Sincronización OK.");
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
      const j = await apiPost("/api/invoices/generate", { month });
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
      const j = await apiGet(`/api/admin/invoices/list?month=${encodeURIComponent(month)}`);
      setInvoices(j?.invoices || []);
      if (!silent) setListMsg(`✅ Cargadas ${j?.invoices?.length ?? 0} facturas (${month}).`);
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
      const j = await apiGet(`/api/admin/invoices/edit?invoice_id=${encodeURIComponent(invoice_id)}`);
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
    return await apiPost("/api/admin/invoices/edit", payload);
  }

  async function addLine() {
    if (!selId) return;
    try {
      const amt = parseNumES(newAmount);
      await postEdit({
        action: "add_line",
        invoice_id: selId,
        kind: newKind,
        label: newLabel,
        amount: amt,
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
  // CHECKLIST: API calls
  // ---------------------------
  async function loadChecklistAdmin() {
    if (ckLoading) return;
    setCkLoading(true);
    setCkMsg("");
    try {
      const j = await apiGet(`/api/admin/checklists/items?template_key=${encodeURIComponent(ckTemplateKey)}`);
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

      const label = String(item?.label || "").trim();
      const sort = Number(item?.sort ?? 0);

      if (!label) throw new Error("Falta texto");
      if (!isFinite(sort)) throw new Error("Sort inválido");

      // ✅ IMPORTANTE:
      // - crear => NO mandar id
      // - editar => mandar id
      const payload: any = {
        template_key: ckTemplateKey,
        label,
        sort,
      };
      if (item?.id) payload.id = item.id;

      await apiPost("/api/admin/checklists/items", payload);

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

      // ✅ Mandamos template_key + action + id (más compatible)
      await apiPost("/api/admin/checklists/items", {
        action: "delete_item",
        template_key: ckTemplateKey,
        id,
      });

      setCkMsg("✅ Item borrado.");
      await loadChecklistAdmin();
    } catch (e: any) {
      setCkMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  async function addChecklistItem() {
    const label = ckNewLabel.trim();
    const sort = parseNumES(ckNewSort);
    if (!label) return setCkMsg("⚠️ Escribe un texto para el item.");
    if (!isFinite(sort)) return setCkMsg("⚠️ Sort inválido.");

    await saveChecklistItem({ label, sort });
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
                <div className="tc-sub">Sincronización · Facturas · Edición · Aceptación · Checklists</div>
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

        <div style={{ fontWeight: 900, whiteSpace: "nowrap" }}>{eur(parseNumES(amount))}</div>
      </div>

      <div className="tc-row" style={{ justifyContent: "space-between", marginTop: 10, flexWrap: "wrap" }}>
        <input className="tc-input" value={label} onChange={(e) => setLabel(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
        <input className="tc-input" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 160 }} />

        <div className="tc-row">
          <button className="tc-btn tc-btn-ok" onClick={() => onSave(label, parseNumES(amount))}>
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
