"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

export default function AdminPaymentsTab({ month }: { month: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  async function getToken() {
    const { data } = await sb.auth.getSession();
    return data.session?.access_token;
  }

  async function load() {
    setLoading(true);

    const token = await getToken();

    const r = await fetch(`/api/admin/payments/list?month=${month}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const j = await r.json();
    setRows(j.rows || []);

    setLoading(false);
  }

  async function save(row: any) {
    const token = await getToken();

    await fetch(`/api/admin/payments/save`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        worker_id: row.is_manual ? null : row.worker_id,
        month_key: month,
        amount: row.amount,
      }),
    });

    await load();
  }

  async function markPaid(row: any) {
    const token = await getToken();

    await fetch(`/api/admin/payments/mark-paid`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        worker_id: row.is_manual ? null : row.worker_id,
        month_key: month,
        amount: row.amount,
      }),
    });

    await load();
  }

  // 🔥 NUEVO: añadir manual SIN trabajador
  async function addManual() {
    const concept = prompt("Concepto (ej: ajuste, bonus, error...)");
    const amount = Number(prompt("Importe (€)"));

    if (!amount) return;

    const token = await getToken();

    await fetch(`/api/admin/payments/create-manual`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        worker_id: null,
        month_key: month,
        amount,
        concept,
      }),
    });

    await load();
  }

  useEffect(() => {
    load();
  }, [month]);

  const total = rows.reduce((a, x) => a + Number(x.amount || 0), 0);
  const paid = rows.filter(x => x.is_paid).reduce((a, x) => a + Number(x.amount || 0), 0);

  return (
    <div className="tc-card">
      <div className="tc-title">💸 Pagos trabajadores</div>

      {/* 🔥 BOTÓN NUEVO */}
      <div style={{ marginTop: 10 }}>
        <button className="tc-btn" onClick={addManual}>
          + Añadir pago manual
        </button>
      </div>

      <div className="tc-grid-3" style={{ marginTop: 12 }}>
        <div>Total: <b>{total.toFixed(2)}€</b></div>
        <div>Pagado: <b>{paid.toFixed(2)}€</b></div>
        <div>Pendiente: <b>{(total - paid).toFixed(2)}€</b></div>
      </div>

      <div className="tc-hr" />

      {loading ? "Cargando..." : (
        <table className="tc-table">
          <thead>
            <tr>
              <th>Concepto / Trabajador</th>
              <th>Importe</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.worker_id}>
                <td>
                  <b>
                    {r.is_manual
                      ? r.display_name || "💰 Ajuste manual"
                      : r.display_name}
                  </b>
                </td>

                <td>
                  <input
                    type="number"
                    value={r.amount}
                    onChange={(e) => {
                      const newRows = [...rows];
                      newRows[i].amount = Number(e.target.value);
                      setRows(newRows);
                    }}
                    className="tc-input"
                    style={{ width: 100 }}
                  />
                </td>

                <td>
                  {r.is_paid ? "✅ Pagado" : "❌ Pendiente"}
                </td>

                <td style={{ display: "flex", gap: 6 }}>
                  <button className="tc-btn" onClick={() => save(r)}>
                    Guardar
                  </button>

                  {!r.is_paid && (
                    <button className="tc-btn tc-btn-ok" onClick={() => markPaid(r)}>
                      Pagar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
