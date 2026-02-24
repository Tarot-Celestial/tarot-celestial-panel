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
    // no era JSON (404 HTML, etc.)
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

  const totalSum = useMemo(() => {
    return (invoices || []).reduce((a, x) => a + Number(x.total || 0), 0);
  }, [invoices]);

  useEffect(() => {
    (async () => {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return (window.location.href = "/login");

      const meRes = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const me = await safeJson(meRes);
      if (!me?.ok) return (window.location.href = "/login");

      if (me.role !== "admin") {
        window.location.href =
          me.role === "central" ? "/panel-central" : "/panel-tarotista";
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

      const r = await fetch("/api/sync/calls", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      const j = await safeJson(r);

      if (!j?._ok || !j?.ok) {
        throw new Error(
          j?.error ||
            `HTTP ${j?._status}. Respuesta: ${j?._raw || "(vacía)"}`
        );
      }

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
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ month }),
      });

      const j = await safeJson(r);

      if (!j?._ok || !j?.ok) {
        throw new Error(
          j?.error ||
            `HTTP ${j?._status}. Respuesta: ${j?._raw || "(vacía)"}`
        );
      }

      const count = j?.result?.invoices ?? "?";
      setGenMsg(`✅ Facturas generadas para ${month}. Total facturas: ${count}`);

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

    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return (window.location.href = "/login");

      const r = await fetch(
        `/api/admin/invoices/list?month=${encodeURIComponent(month)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const j = await safeJson(r);

      if (!j?._ok || !j?.ok) {
        throw new Error(
          j?.error ||
            `HTTP ${j?._status}. Respuesta: ${j?._raw || "(vacía)"}`
        );
      }

      setInvoices(j.invoices || []);
      setListMsg(`✅ Cargadas ${j.invoices?.length ?? 0} facturas (${month}).`);
    } catch (e: any) {
      setListMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setListLoading(false);
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
            Control total: sincronización, generación de facturas y revisión rápida del mes.
          </div>
        </div>

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
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            Ejemplo: <b>2026-02</b>
          </div>
        </div>

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
            {syncMsg || "Pulsa para importar/actualizar llamadas del CSV (manual)."}
          </div>
        </div>

        <div
          style={{
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 14,
            padding: 14,
            maxWidth: 900,
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

            <div style={{ fontSize: 12, opacity: 0.85 }}>
              {genMsg || listMsg || "Genera y revisa rápidamente los totales."}
            </div>
          </div>

          {invoices?.length > 0 && (
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              Total sumado: <b>{totalSum.toFixed(2)}€</b>
            </div>
          )}

          {invoices?.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", opacity: 0.8 }}>
                    <th style={{ padding: "8px 6px" }}>Trabajador</th>
                    <th style={{ padding: "8px 6px" }}>Rol</th>
                    <th style={{ padding: "8px 6px" }}>Mes</th>
                    <th style={{ padding: "8px 6px" }}>Estado</th>
                    <th style={{ padding: "8px 6px" }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((x: any) => (
                    <tr key={x.invoice_id} style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                      <td style={{ padding: "8px 6px" }}>
                        <b>{x.display_name}</b>
                      </td>
                      <td style={{ padding: "8px 6px", opacity: 0.9 }}>{x.role}</td>
                      <td style={{ padding: "8px 6px", opacity: 0.9 }}>{x.month_key}</td>
                      <td style={{ padding: "8px 6px", opacity: 0.9 }}>{x.status}</td>
                      <td style={{ padding: "8px 6px" }}>
                        <b>{Number(x.total || 0).toFixed(2)}€</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {invoices?.length === 0 && (
            <div style={{ fontSize: 13, opacity: 0.75 }}>
              Sin datos cargados todavía. Pulsa <b>Ver resumen</b>.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
