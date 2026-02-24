"use client";

import { useEffect, useMemo, useState } from "react";
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

export default function Admin() {
  const [ok, setOk] = useState(false);

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

  const totalSum = useMemo(() => {
    return (invoices || []).reduce((a, x) => a + Number(x.total || 0), 0);
  }, [invoices]);

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

  async function syncNow() {
    if (syncLoading) return;
    setSyncLoading(true);
    setSyncMsg("");
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return (window.location.href = "/login");

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
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return (window.location.href = "/login");

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
    } catch (e: any) {
      setGenMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setGenLoading(false);
    }
  }

  async function listInvoices() {
    if (listLoading) return;
    setListLoading(true);
    setListMsg("");
    setInvoices([]);
    setSelId("");
    setSelInvoice(null);
    setSelLines([]);
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return (window.location.href = "/login");

      const r = await fetch(`/api/admin/invoices/list?month=${encodeURIComponent(month)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}. ${j?._raw || "(vacía)"}`);

      setInvoices(j.invoices || []);
      setListMsg(`✅ Cargadas ${j.invoices?.length ?? 0} facturas (${month}).`);
    } catch (e: any) {
      setListMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setListLoading(false);
    }
  }

  async function loadInvoice(invoice_id: string) {
    if (!invoice_id) return;
    setSelLoading(true);
    setSelMsg("");
    setSelId(invoice_id);
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return (window.location.href = "/login");

      const r = await fetch(`/api/admin/invoices/edit?invoice_id=${encodeURIComponent(invoice_id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}. ${j?._raw || "(vacía)"}`);

      setSelInvoice(j.invoice);
      setSelWorker(j.worker);
      setSelLines(j.lines || []);
    } catch (e: any) {
      setSelMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setSelLoading(false);
    }
  }

  async function postEdit(payload: any) {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return (window.location.href = "/login");

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
      await listInvoices();
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
      await listInvoices();
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
      await listInvoices();
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
      await listInvoices();
      setSelMsg("✅ Estado actualizado.");
    } catch (e: any) {
      setSelMsg(`❌ ${e?.message || "Error"}`);
    }
  }

  if (!ok) return <div style={{ padding: 40 }}>Cargando…</div>;

  return (
    <>
      <AppHeader />

      <div style={{ padding: 24, display: "grid", gap: 14 }}>
        <div>
          <h2 style={{ margin: "0 0 8px" }}>Panel Admin</h2>
          <div style={{ opacity: 0.75, fontSize: 12 }}>
            Sincronización, generación de facturas y edición manual de líneas.
          </div>
        </div>

        {/* MES */}
        <div
          style={{
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 14,
            padding: 14,
            maxWidth: 720,
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.8 }}>Mes (YYYY-MM):</div>
          <input
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            placeholder="2026-02"
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.06)",
              color: "white",
              width: 140,
              outline: "none",
            }}
          />
        </div>

        {/* SYNC */}
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 14,
            padding: 14,
            maxWidth: 720,
          }}
        >
          <button
            onClick={syncNow}
            disabled={syncLoading}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(215,181,109,0.45)",
              background: "rgba(215,181,109,0.18)",
              color: "white",
              cursor: "pointer",
              minWidth: 170,
            }}
          >
            {syncLoading ? "Sincronizando…" : "Sincronizar ahora"}
          </button>

          <div style={{ fontSize: 12, opacity: 0.85 }}>
            {syncMsg || "Pulsa para importar/actualizar llamadas del CSV."}
          </div>
        </div>

        {/* FACTURAS */}
        <div
          style={{
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 14,
            padding: 14,
            maxWidth: 980,
            display: "grid",
            gap: 10,
          }}
        >
          <div style={{ fontWeight: 800 }}>🧾 Facturas</div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button
              onClick={generateInvoices}
              disabled={genLoading}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(120,255,190,0.30)",
                background: "rgba(120,255,190,0.10)",
                color: "white",
                cursor: "pointer",
                minWidth: 180,
              }}
            >
              {genLoading ? "Generando…" : "Generar facturas del mes"}
            </button>

            <button
              onClick={listInvoices}
              disabled={listLoading}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(255,255,255,0.06)",
                color: "white",
                cursor: "pointer",
                minWidth: 150,
              }}
            >
              {listLoading ? "Cargando…" : "Ver resumen"}
            </button>

            <div style={{ fontSize: 12, opacity: 0.85 }}>{genMsg || listMsg || " "}</div>
          </div>

          {invoices?.length > 0 && (
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              Total sumado: <b>{totalSum.toFixed(2)}€</b> · Click en una fila para editar.
            </div>
          )}

          {/* tabla + editor */}
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 14 }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", opacity: 0.8 }}>
                    <th style={{ padding: "8px 6px" }}>Trabajador</th>
                    <th style={{ padding: "8px 6px" }}>Rol</th>
                    <th style={{ padding: "8px 6px" }}>Estado</th>
                    <th style={{ padding: "8px 6px" }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(invoices || []).map((x: any) => (
                    <tr
                      key={x.invoice_id}
                      onClick={() => loadInvoice(x.invoice_id)}
                      style={{
                        borderTop: "1px solid rgba(255,255,255,0.08)",
                        cursor: "pointer",
                        background: selId === x.invoice_id ? "rgba(255,255,255,0.06)" : "transparent",
                      }}
                    >
                      <td style={{ padding: "8px 6px" }}>
                        <b>{x.display_name}</b>
                      </td>
                      <td style={{ padding: "8px 6px", opacity: 0.9 }}>{x.role}</td>
                      <td style={{ padding: "8px 6px", opacity: 0.9 }}>{x.status}</td>
                      <td style={{ padding: "8px 6px" }}>
                        <b>{Number(x.total || 0).toFixed(2)}€</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {invoices?.length === 0 && (
                <div style={{ fontSize: 13, opacity: 0.75, marginTop: 8 }}>
                  Pulsa <b>Ver resumen</b>.
                </div>
              )}
            </div>

            <div
              style={{
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 14,
                padding: 12,
                minHeight: 200,
              }}
            >
              <div style={{ fontWeight: 800, marginBottom: 8 }}>✏️ Editor</div>

              {!selId ? (
                <div style={{ fontSize: 13, opacity: 0.75 }}>Selecciona una factura de la lista.</div>
              ) : selLoading ? (
                <div style={{ fontSize: 13, opacity: 0.75 }}>Cargando factura…</div>
              ) : (
                <>
                  <div style={{ fontSize: 13, marginBottom: 8 }}>
                    <b>{selWorker?.display_name}</b> · {selWorker?.role} · Mes <b>{selInvoice?.month_key}</b>
                    <br />
                    Total: <b>{Number(selInvoice?.total || 0).toFixed(2)}€</b> · Estado:{" "}
                    <b>{selInvoice?.status}</b>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                    <button
                      onClick={() => setStatus("draft")}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.15)",
                        background: "rgba(255,255,255,0.06)",
                        color: "white",
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      Poner Draft
                    </button>
                    <button
                      onClick={() => setStatus("final")}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid rgba(120,255,190,0.30)",
                        background: "rgba(120,255,190,0.10)",
                        color: "white",
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      Finalizar
                    </button>
                  </div>

                  <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
                    {(selLines || []).map((l: any) => (
                      <LineEditor
                        key={l.id}
                        line={l}
                        onSave={(label, amount) => updateLine(l.id, label, amount)}
                        onDelete={() => deleteLine(l.id)}
                      />
                    ))}
                  </div>

                  <div style={{ marginTop: 12, borderTop: "1px solid rgba(255,255,255,0.10)", paddingTop: 10 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>➕ Añadir línea</div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <select
                        value={newKind}
                        onChange={(e) => setNewKind(e.target.value)}
                        style={{
                          padding: "9px 10px",
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.15)",
                          background: "rgba(255,255,255,0.06)",
                          color: "white",
                        }}
                      >
                        <option value="adjustment">adjustment</option>
                        <option value="incident">incident</option>
                        <option value="bonus_ranking">bonus_ranking</option>
                        <option value="bonus_captadas">bonus_captadas</option>
                        <option value="minutes">minutes</option>
                        <option value="salary_base">salary_base</option>
                      </select>

                      <input
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        placeholder="Concepto"
                        style={{
                          padding: "9px 10px",
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.15)",
                          background: "rgba(255,255,255,0.06)",
                          color: "white",
                          width: 170,
                          outline: "none",
                        }}
                      />

                      <input
                        value={newAmount}
                        onChange={(e) => setNewAmount(e.target.value)}
                        placeholder="0"
                        style={{
                          padding: "9px 10px",
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.15)",
                          background: "rgba(255,255,255,0.06)",
                          color: "white",
                          width: 90,
                          outline: "none",
                        }}
                      />

                      <button
                        onClick={addLine}
                        style={{
                          padding: "9px 10px",
                          borderRadius: 10,
                          border: "1px solid rgba(215,181,109,0.45)",
                          background: "rgba(215,181,109,0.18)",
                          color: "white",
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                      >
                        Añadir
                      </button>
                    </div>

                    <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
                      {selMsg || "Edita importes y guarda. El total se recalcula solo."}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
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

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 90px 90px",
        gap: 8,
        alignItems: "center",
      }}
    >
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        style={{
          padding: "9px 10px",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.15)",
          background: "rgba(255,255,255,0.06)",
          color: "white",
          outline: "none",
        }}
      />
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        style={{
          padding: "9px 10px",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.15)",
          background: "rgba(255,255,255,0.06)",
          color: "white",
          outline: "none",
        }}
      />
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button
          onClick={() => onSave(label, Number(String(amount).replace(",", ".")) || 0)}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid rgba(120,255,190,0.30)",
            background: "rgba(120,255,190,0.10)",
            color: "white",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          Guardar
        </button>
        <button
          onClick={onDelete}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid rgba(255,80,80,0.30)",
            background: "rgba(255,80,80,0.10)",
            color: "white",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          X
        </button>
      </div>
    </div>
  );
}
