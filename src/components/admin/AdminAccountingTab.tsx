"use client";

import { useMemo, useState } from "react";

const EXPENSE_CONCEPTS = [
  "recarga",
  "facebook",
  "pago tarotista",
  "deuda",
  "pago centrales",
  "pago premium numbers",
  "pago hubspot",
] as const;

const INCOME_CONCEPTS = [
  "Bizum",
  "Paypal",
  "Square",
] as const;

function eur(n: any) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function numES(n: any, digits = 2) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function safeMonthDate(month: string) {
  return `${month}-01`;
}

export default function AdminAccountingTab({
  month,
  loading,
  msg,
  totals,
  entries,
  months,
  breakdown,
  onRefresh,
  onCreate,
  onDelete,
}: {
  month: string;
  loading: boolean;
  msg: string;
  totals: any;
  entries: any[];
  months: any[];
  breakdown: any;
  onRefresh: () => void;
  onCreate: (payload: any) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [entryType, setEntryType] = useState<"expense" | "income">("expense");
  const [concept, setConcept] = useState<string>(EXPENSE_CONCEPTS[0]);
  const [amount, setAmount] = useState<string>("");
  const [entryDate, setEntryDate] = useState<string>(safeMonthDate(month));
  const [note, setNote] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const concepts = useMemo(
    () => (entryType === "expense" ? [...EXPENSE_CONCEPTS] : [...INCOME_CONCEPTS]),
    [entryType]
  );

  const monthMax = useMemo(() => {
    const maxIncome = Math.max(...(months || []).map((x: any) => Number(x.income || 0)), 0);
    const maxExpense = Math.max(...(months || []).map((x: any) => Number(x.expense || 0)), 0);
    const maxNetAbs = Math.max(...(months || []).map((x: any) => Math.abs(Number(x.net || 0))), 0);
    return Math.max(maxIncome, maxExpense, maxNetAbs, 1);
  }, [months]);

  const currentBreakdown = entryType === "expense" ? breakdown?.expense || [] : breakdown?.income || [];
  const breakdownMax = Math.max(...currentBreakdown.map((x: any) => Number(x.amount || 0)), 1);

  async function submit() {
    if (saving) return;
    setSaving(true);
    try {
      await onCreate({
        month_key: month,
        entry_date: entryDate,
        entry_type: entryType,
        concept,
        amount_eur: Number(String(amount).replace(",", ".")),
        note,
      });

      setAmount("");
      setNote("");
      setEntryDate(safeMonthDate(month));
      setConcept(entryType === "expense" ? EXPENSE_CONCEPTS[0] : INCOME_CONCEPTS[0]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="tc-card">
        <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div className="tc-title">💼 Contabilidad</div>
            <div className="tc-sub" style={{ marginTop: 6 }}>
              Ingresos y gastos manuales por mes {msg ? `· ${msg}` : ""}
            </div>
          </div>

          <button className="tc-btn tc-btn-gold" onClick={onRefresh} disabled={loading}>
            {loading ? "Cargando…" : "Actualizar"}
          </button>
        </div>

        <div className="tc-hr" />

        <div className="tc-grid-3">
          <KpiBox label="Ingresos mes" value={eur(totals?.income || 0)} />
          <KpiBox label="Gastos mes" value={eur(totals?.expense || 0)} />
          <KpiBox label="Balance neto" value={eur(totals?.net || 0)} highlight={Number(totals?.net || 0) >= 0} />
        </div>
      </div>

      <div className="tc-grid-2">
        <div className="tc-card">
          <div className="tc-title">➕ Nuevo movimiento</div>
          <div className="tc-sub" style={{ marginTop: 6 }}>
            Añade ingresos o gastos manualmente
          </div>

          <div className="tc-hr" />

          <div style={{ display: "grid", gap: 12 }}>
            <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button
                className={`tc-btn ${entryType === "expense" ? "tc-btn-danger" : ""}`}
                onClick={() => {
                  setEntryType("expense");
                  setConcept(EXPENSE_CONCEPTS[0]);
                }}
              >
                Gasto
              </button>
              <button
                className={`tc-btn ${entryType === "income" ? "tc-btn-ok" : ""}`}
                onClick={() => {
                  setEntryType("income");
                  setConcept(INCOME_CONCEPTS[0]);
                }}
              >
                Ingreso
              </button>
            </div>

            <div className="tc-row" style={{ gap: 10, flexWrap: "wrap" }}>
              <div style={{ minWidth: 220 }}>
                <div className="tc-sub">Concepto</div>
                <select
                  className="tc-select"
                  value={concept}
                  onChange={(e) => setConcept(e.target.value)}
                  style={{ width: "100%", marginTop: 6 }}
                >
                  {concepts.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ minWidth: 140 }}>
                <div className="tc-sub">Importe €</div>
                <input
                  className="tc-input"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  style={{ width: "100%", marginTop: 6 }}
                  placeholder="0,00"
                />
              </div>

              <div style={{ minWidth: 160 }}>
                <div className="tc-sub">Fecha</div>
                <input
                  className="tc-input"
                  type="date"
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                  style={{ width: "100%", marginTop: 6 }}
                />
              </div>
            </div>

            <div>
              <div className="tc-sub">Nota</div>
              <input
                className="tc-input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                style={{ width: "100%", marginTop: 6 }}
                placeholder="Opcional"
              />
            </div>

            <div className="tc-row" style={{ justifyContent: "flex-end" }}>
              <button className="tc-btn tc-btn-gold" onClick={submit} disabled={saving}>
                {saving ? "Guardando…" : "Guardar movimiento"}
              </button>
            </div>
          </div>
        </div>

        <div className="tc-card">
          <div className="tc-title">📊 Desglose del mes por concepto</div>
          <div className="tc-sub" style={{ marginTop: 6 }}>
            {entryType === "expense" ? "Gastos" : "Ingresos"} agrupados por concepto
          </div>

          <div className="tc-hr" />

          <div style={{ display: "grid", gap: 10 }}>
            {currentBreakdown.length === 0 ? (
              <div className="tc-sub">No hay datos para este mes.</div>
            ) : (
              currentBreakdown.map((row: any) => {
                const amount = Number(row.amount || 0);
                const width = Math.max(6, Math.round((amount / breakdownMax) * 100));
                return (
                  <div key={row.concept}>
                    <div className="tc-row" style={{ justifyContent: "space-between", gap: 10 }}>
                      <div style={{ fontWeight: 900 }}>{row.concept}</div>
                      <div>{eur(amount)}</div>
                    </div>
                    <div
                      style={{
                        height: 12,
                        marginTop: 6,
                        borderRadius: 999,
                        background: "rgba(255,255,255,0.08)",
                        overflow: "hidden",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${width}%`,
                          background:
                            entryType === "expense"
                              ? "linear-gradient(90deg, rgba(255,80,80,0.95), rgba(215,181,109,0.95))"
                              : "linear-gradient(90deg, rgba(120,255,190,0.95), rgba(181,156,255,0.95))",
                        }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div className="tc-card">
        <div className="tc-title">📈 Evolución por meses</div>
        <div className="tc-sub" style={{ marginTop: 6 }}>
          Ingresos, gastos y balance neto
        </div>

        <div className="tc-hr" />

        <div style={{ display: "grid", gap: 14 }}>
          {(months || []).map((m: any) => {
            const income = Number(m.income || 0);
            const expense = Number(m.expense || 0);
            const net = Number(m.net || 0);

            const incomeW = Math.max(4, Math.round((income / monthMax) * 100));
            const expenseW = Math.max(4, Math.round((expense / monthMax) * 100));
            const netW = Math.max(4, Math.round((Math.abs(net) / monthMax) * 100));

            return (
              <div key={m.month_key}>
                <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 900 }}>{m.month_key}</div>
                  <div className="tc-row" style={{ gap: 12, flexWrap: "wrap" }}>
                    <span className="tc-sub">Ingresos: <b>{eur(income)}</b></span>
                    <span className="tc-sub">Gastos: <b>{eur(expense)}</b></span>
                    <span className="tc-sub">Neto: <b>{eur(net)}</b></span>
                  </div>
                </div>

                <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                  <BarRow label="Ingresos" width={incomeW} positive />
                  <BarRow label="Gastos" width={expenseW} />
                  <BarRow label="Neto" width={netW} positive={net >= 0} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="tc-card">
        <div className="tc-title">🧾 Movimientos del mes</div>
        <div className="tc-sub" style={{ marginTop: 6 }}>
          Ordenados del más reciente al más antiguo
        </div>

        <div className="tc-hr" />

        <div style={{ overflowX: "auto" }}>
          <table className="tc-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Concepto</th>
                <th>Nota</th>
                <th>Importe</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(entries || []).map((row: any) => (
                <tr key={row.id}>
                  <td>{row.entry_date}</td>
                  <td>
                    <span className="tc-chip" style={{ padding: "4px 10px" }}>
                      {row.entry_type === "expense" ? "Gasto" : "Ingreso"}
                    </span>
                  </td>
                  <td><b>{row.concept}</b></td>
                  <td className="tc-muted">{row.note || "—"}</td>
                  <td style={{ fontWeight: 900 }}>
                    {row.entry_type === "expense" ? "-" : "+"}{eur(row.amount_eur || 0)}
                  </td>
                  <td>
                    <button className="tc-btn tc-btn-danger" onClick={() => onDelete(row.id)}>
                      Borrar
                    </button>
                  </td>
                </tr>
              ))}
              {(!entries || entries.length === 0) && (
                <tr>
                  <td colSpan={6} className="tc-muted">
                    No hay movimientos en este mes.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KpiBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 14,
        padding: 12,
        background: highlight ? "rgba(120,255,190,0.10)" : "rgba(255,255,255,0.03)",
      }}
    >
      <div className="tc-sub">{label}</div>
      <div style={{ fontWeight: 900, fontSize: 20, marginTop: 6 }}>{value}</div>
    </div>
  );
}

function BarRow({ label, width, positive }: { label: string; width: number; positive?: boolean }) {
  return (
    <div className="tc-row" style={{ gap: 10, alignItems: "center", flexWrap: "nowrap" }}>
      <div style={{ width: 70 }} className="tc-sub">{label}</div>
      <div
        style={{
          flex: 1,
          height: 12,
          borderRadius: 999,
          background: "rgba(255,255,255,0.08)",
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${width}%`,
            background: positive
              ? "linear-gradient(90deg, rgba(120,255,190,0.95), rgba(181,156,255,0.95))"
              : "linear-gradient(90deg, rgba(255,80,80,0.95), rgba(215,181,109,0.95))",
          }}
        />
      </div>
    </div>
  );
}

  );
}
