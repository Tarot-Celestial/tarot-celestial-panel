"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

type CategoryKey =
  | "movement"
  | "business"
  | "origin"
  | "destination"
  | "payment_method"
  | "type"
  | "operation_mode";

type AccountingOption = {
  id: string;
  category: CategoryKey;
  label: string;
  metadata?: { direction?: "income" | "expense" } | null;
};

const CATEGORY_LABELS: Record<CategoryKey, string> = {
  movement: "Movimiento",
  business: "Negocio",
  origin: "Origen del dinero",
  destination: "Destino del dinero",
  payment_method: "Por dónde se paga",
  type: "Tipo",
  operation_mode: "Funcionamiento",
};

const FALLBACK_OPTIONS: AccountingOption[] = [
  { id: "fallback-movement-expense", category: "movement", label: "Gasto", metadata: { direction: "expense" } },
  { id: "fallback-movement-income", category: "movement", label: "Ingreso", metadata: { direction: "income" } },
  { id: "fallback-business-flowly", category: "business", label: "Flowly" },
  { id: "fallback-business-celestial", category: "business", label: "Celestial" },
  { id: "fallback-business-leonaris", category: "business", label: "Leonaris" },
  { id: "fallback-origin", category: "origin", label: "Sin especificar" },
  { id: "fallback-destination", category: "destination", label: "Sin especificar" },
  { id: "fallback-payment-transfer", category: "payment_method", label: "Transferencia" },
  { id: "fallback-payment-card", category: "payment_method", label: "Tarjeta" },
  { id: "fallback-payment-bizum", category: "payment_method", label: "Bizum" },
  { id: "fallback-mode", category: "operation_mode", label: "General" },
  { id: "fallback-type-recarga", category: "type", label: "recarga" },
  { id: "fallback-type-facebook", category: "type", label: "facebook" },
  { id: "fallback-type-tarotista", category: "type", label: "pago tarotista" },
  { id: "fallback-type-deuda", category: "type", label: "deuda" },
  { id: "fallback-type-centrales", category: "type", label: "pago centrales" },
  { id: "fallback-type-premium", category: "type", label: "pago premium numbers" },
  { id: "fallback-type-hubspot", category: "type", label: "pago hubspot" },
  { id: "fallback-type-bizum", category: "type", label: "Bizum" },
  { id: "fallback-type-paypal", category: "type", label: "Paypal" },
  { id: "fallback-type-square", category: "type", label: "Square" },
];

function eur(n: any) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function safeMonthDate(month: string) {
  return `${month}-01`;
}

function displayError(error: string) {
  if (error === "OPTION_ALREADY_EXISTS") return "Ya existe una opción con ese nombre.";
  if (error === "LABEL_REQUIRED") return "Escribe un nombre para la opción.";
  if (error === "LABEL_TOO_LONG") return "El nombre es demasiado largo.";
  if (error === "INVALID_DIRECTION") return "Selecciona si el movimiento suma como ingreso o gasto.";
  return error || "No se pudo completar la operación.";
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
  const [options, setOptions] = useState<AccountingOption[]>(FALLBACK_OPTIONS);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsMessage, setOptionsMessage] = useState("");

  const [movement, setMovement] = useState("Gasto");
  const [business, setBusiness] = useState("Flowly");
  const [origin, setOrigin] = useState("Sin especificar");
  const [destination, setDestination] = useState("Sin especificar");
  const [paymentMethod, setPaymentMethod] = useState("Transferencia");
  const [movementType, setMovementType] = useState("recarga");
  const [operationMode, setOperationMode] = useState("General");
  const [amount, setAmount] = useState("");
  const [entryDate, setEntryDate] = useState(safeMonthDate(month));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const [modalCategory, setModalCategory] = useState<CategoryKey | null>(null);
  const [modalMode, setModalMode] = useState<"add" | "manage">("add");
  const [newLabel, setNewLabel] = useState("");
  const [newDirection, setNewDirection] = useState<"income" | "expense">("expense");
  const [editingId, setEditingId] = useState("");
  const [editingLabel, setEditingLabel] = useState("");
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState("");

  const groupedOptions = useMemo(() => {
    const grouped = {} as Record<CategoryKey, AccountingOption[]>;
    (Object.keys(CATEGORY_LABELS) as CategoryKey[]).forEach((key) => {
      grouped[key] = options.filter((option) => option.category === key);
    });
    return grouped;
  }, [options]);

  const selectedMovementOption = groupedOptions.movement.find((option) => option.label === movement);
  const entryType: "income" | "expense" =
    selectedMovementOption?.metadata?.direction ||
    (movement.toLowerCase().includes("ingres") ? "income" : "expense");

  const currentBreakdown = entryType === "expense" ? breakdown?.expense || [] : breakdown?.income || [];
  const breakdownMax = Math.max(...currentBreakdown.map((x: any) => Number(x.amount || 0)), 1);

  const monthMax = useMemo(() => {
    const maxIncome = Math.max(...(months || []).map((x: any) => Number(x.income || 0)), 0);
    const maxExpense = Math.max(...(months || []).map((x: any) => Number(x.expense || 0)), 0);
    const maxNetAbs = Math.max(...(months || []).map((x: any) => Math.abs(Number(x.net || 0))), 0);
    return Math.max(maxIncome, maxExpense, maxNetAbs, 1);
  }, [months]);

  useEffect(() => {
    setEntryDate(safeMonthDate(month));
  }, [month]);

  useEffect(() => {
    void loadOptions();
  }, []);

  async function authHeaders() {
    const { data } = await supabaseBrowser().auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("NO_AUTH");
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  async function loadOptions() {
    setOptionsLoading(true);
    setOptionsMessage("");
    try {
      const headers = await authHeaders();
      const response = await fetch("/api/admin/accounting/options", { headers, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "OPTIONS_LOAD_ERROR");
      setOptions(Array.isArray(data.options) && data.options.length ? data.options : FALLBACK_OPTIONS);
    } catch (error: any) {
      setOptions(FALLBACK_OPTIONS);
      setOptionsMessage(
        error?.message === "NO_AUTH"
          ? "No se pudo comprobar la sesión."
          : "Usando opciones básicas hasta que se aplique la configuración de Supabase."
      );
    } finally {
      setOptionsLoading(false);
    }
  }

  function openAdd(category: CategoryKey) {
    setModalCategory(category);
    setModalMode("add");
    setNewLabel("");
    setNewDirection("expense");
    setEditingId("");
    setModalError("");
  }

  function openManage(category: CategoryKey) {
    setModalCategory(category);
    setModalMode("manage");
    setNewLabel("");
    setEditingId("");
    setModalError("");
  }

  function closeModal() {
    if (modalBusy) return;
    setModalCategory(null);
    setEditingId("");
    setModalError("");
  }

  async function addOption() {
    if (!modalCategory || modalBusy) return;
    setModalBusy(true);
    setModalError("");
    try {
      const headers = await authHeaders();
      const response = await fetch("/api/admin/accounting/options", {
        method: "POST",
        headers,
        body: JSON.stringify({
          category: modalCategory,
          label: newLabel,
          direction: modalCategory === "movement" ? newDirection : undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "OPTION_CREATE_ERROR");
      setOptions((current) => [...current.filter((item) => !item.id.startsWith("fallback-")), data.option]);
      selectValue(modalCategory, data.option.label);
      setNewLabel("");
      setModalMode("manage");
    } catch (error: any) {
      setModalError(displayError(error?.message));
    } finally {
      setModalBusy(false);
    }
  }

  async function renameOption(id: string) {
    if (!editingLabel.trim() || modalBusy) return;
    setModalBusy(true);
    setModalError("");
    try {
      const headers = await authHeaders();
      const response = await fetch("/api/admin/accounting/options", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ id, label: editingLabel }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "OPTION_UPDATE_ERROR");
      setOptions((current) => current.map((item) => (item.id === id ? data.option : item)));
      setEditingId("");
      setEditingLabel("");
    } catch (error: any) {
      setModalError(displayError(error?.message));
    } finally {
      setModalBusy(false);
    }
  }

  async function removeOption(option: AccountingOption) {
    if (modalBusy) return;
    if (!window.confirm(`¿Eliminar “${option.label}” de las opciones futuras? Los movimientos antiguos conservarán este valor.`)) return;
    setModalBusy(true);
    setModalError("");
    try {
      const headers = await authHeaders();
      const response = await fetch("/api/admin/accounting/options", {
        method: "DELETE",
        headers,
        body: JSON.stringify({ id: option.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "OPTION_DELETE_ERROR");
      setOptions((current) => current.filter((item) => item.id !== option.id));
      ensureSelectedValueAfterDelete(option);
    } catch (error: any) {
      setModalError(displayError(error?.message));
    } finally {
      setModalBusy(false);
    }
  }

  function ensureSelectedValueAfterDelete(option: AccountingOption) {
    const remaining = groupedOptions[option.category].filter((item) => item.id !== option.id);
    const replacement = remaining[0]?.label || "";
    const selected = selectedValue(option.category);
    if (selected === option.label) selectValue(option.category, replacement);
  }

  function selectedValue(category: CategoryKey) {
    if (category === "movement") return movement;
    if (category === "business") return business;
    if (category === "origin") return origin;
    if (category === "destination") return destination;
    if (category === "payment_method") return paymentMethod;
    if (category === "type") return movementType;
    return operationMode;
  }

  function selectValue(category: CategoryKey, value: string) {
    if (category === "movement") setMovement(value);
    else if (category === "business") setBusiness(value);
    else if (category === "origin") setOrigin(value);
    else if (category === "destination") setDestination(value);
    else if (category === "payment_method") setPaymentMethod(value);
    else if (category === "type") setMovementType(value);
    else setOperationMode(value);
  }

  async function submit() {
    if (saving) return;
    setSaving(true);
    try {
      await onCreate({
        month_key: month,
        entry_date: entryDate,
        movement,
        entry_type: entryType,
        business,
        origin,
        destination,
        payment_method: paymentMethod,
        movement_type: movementType,
        concept: movementType,
        operation_mode: operationMode,
        amount_eur: Number(String(amount).replace(",", ".")),
        note,
      });
      setAmount("");
      setNote("");
      setEntryDate(safeMonthDate(month));
    } finally {
      setSaving(false);
    }
  }

  const configurableFields: Array<{ category: CategoryKey; value: string }> = [
    { category: "movement", value: movement },
    { category: "business", value: business },
    { category: "origin", value: origin },
    { category: "destination", value: destination },
    { category: "payment_method", value: paymentMethod },
    { category: "type", value: movementType },
    { category: "operation_mode", value: operationMode },
  ];

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
            Añade movimientos y administra las opciones desde cada desplegable
          </div>
          {optionsMessage && <div className="tc-sub" style={{ marginTop: 8 }}>{optionsMessage}</div>}
          <div className="tc-hr" />

          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
              {configurableFields.map(({ category, value }) => (
                <ConfigurableSelect
                  key={category}
                  label={CATEGORY_LABELS[category]}
                  value={value}
                  options={groupedOptions[category] || []}
                  disabled={optionsLoading}
                  onChange={(next) => {
                    if (next === "__add__") openAdd(category);
                    else selectValue(category, next);
                  }}
                  onManage={() => openManage(category)}
                />
              ))}

              <div>
                <div className="tc-sub">Importe €</div>
                <input
                  className="tc-input"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  style={{ width: "100%", marginTop: 6 }}
                  placeholder="0,00"
                  inputMode="decimal"
                />
              </div>

              <div>
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
              <button className="tc-btn tc-btn-gold" onClick={submit} disabled={saving || optionsLoading}>
                {saving ? "Guardando…" : "Guardar movimiento"}
              </button>
            </div>
          </div>
        </div>

        <div className="tc-card">
          <div className="tc-title">📊 Desglose del mes por tipo</div>
          <div className="tc-sub" style={{ marginTop: 6 }}>
            {entryType === "expense" ? "Gastos" : "Ingresos"} agrupados por tipo
          </div>
          <div className="tc-hr" />
          <div style={{ display: "grid", gap: 10 }}>
            {currentBreakdown.length === 0 ? (
              <div className="tc-sub">No hay datos para este mes.</div>
            ) : (
              currentBreakdown.map((row: any) => {
                const rowAmount = Number(row.amount || 0);
                const width = Math.max(6, Math.round((rowAmount / breakdownMax) * 100));
                return (
                  <div key={row.concept}>
                    <div className="tc-row" style={{ justifyContent: "space-between", gap: 10 }}>
                      <div style={{ fontWeight: 900 }}>{row.concept}</div>
                      <div>{eur(rowAmount)}</div>
                    </div>
                    <div style={{ height: 12, marginTop: 6, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
                      <div style={{ height: "100%", width: `${width}%`, background: entryType === "expense" ? "linear-gradient(90deg, rgba(255,80,80,0.95), rgba(215,181,109,0.95))" : "linear-gradient(90deg, rgba(120,255,190,0.95), rgba(181,156,255,0.95))" }} />
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
        <div className="tc-sub" style={{ marginTop: 6 }}>Ingresos, gastos y balance neto</div>
        <div className="tc-hr" />
        <div style={{ display: "grid", gap: 14 }}>
          {(months || []).map((m: any) => {
            const income = Number(m.income || 0);
            const expense = Number(m.expense || 0);
            const net = Number(m.net || 0);
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
                  <BarRow label="Ingresos" width={Math.max(4, Math.round((income / monthMax) * 100))} positive />
                  <BarRow label="Gastos" width={Math.max(4, Math.round((expense / monthMax) * 100))} />
                  <BarRow label="Neto" width={Math.max(4, Math.round((Math.abs(net) / monthMax) * 100))} positive={net >= 0} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="tc-card">
        <div className="tc-title">🧾 Movimientos del mes</div>
        <div className="tc-sub" style={{ marginTop: 6 }}>Las opciones eliminadas se conservan en los registros antiguos</div>
        <div className="tc-hr" />
        <div style={{ overflowX: "auto" }}>
          <table className="tc-table">
            <thead>
              <tr>
                <th>Fecha</th><th>Movimiento</th><th>Negocio</th><th>Origen</th><th>Destino</th><th>Medio</th><th>Tipo</th><th>Funcionamiento</th><th>Nota</th><th>Importe</th><th></th>
              </tr>
            </thead>
            <tbody>
              {(entries || []).map((row: any) => {
                const historicalType = row.movement_type || row.concept || "—";
                const historicalMovement = row.movement || (row.entry_type === "income" || String(row.kind || "").toLowerCase() === "ingresos" ? "Ingreso" : "Gasto");
                const isExpense = historicalMovement.toLowerCase().includes("gasto") || row.entry_type === "expense";
                return (
                  <tr key={row.id}>
                    <td>{row.entry_date || String(row.created_at || "").slice(0, 10) || "—"}</td>
                    <td><span className="tc-chip" style={{ padding: "4px 10px" }}>{historicalMovement}</span></td>
                    <td>{row.business || "—"}</td>
                    <td>{row.origin || "—"}</td>
                    <td>{row.destination || "—"}</td>
                    <td>{row.payment_method || "—"}</td>
                    <td><b>{historicalType}</b></td>
                    <td>{row.operation_mode || "—"}</td>
                    <td className="tc-muted">{row.note || "—"}</td>
                    <td style={{ fontWeight: 900 }}>{isExpense ? "-" : "+"}{eur(row.amount_eur ?? row.amount ?? 0)}</td>
                    <td><button className="tc-btn tc-btn-danger" onClick={() => onDelete(row.id)}>Borrar</button></td>
                  </tr>
                );
              })}
              {(!entries || entries.length === 0) && <tr><td colSpan={11} className="tc-muted">No hay movimientos en este mes.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {modalCategory && (
        <OptionModal
          category={modalCategory}
          mode={modalMode}
          options={groupedOptions[modalCategory] || []}
          newLabel={newLabel}
          newDirection={newDirection}
          editingId={editingId}
          editingLabel={editingLabel}
          busy={modalBusy}
          error={modalError}
          onClose={closeModal}
          onModeChange={setModalMode}
          onNewLabelChange={setNewLabel}
          onNewDirectionChange={setNewDirection}
          onAdd={addOption}
          onStartEdit={(option) => { setEditingId(option.id); setEditingLabel(option.label); setModalError(""); }}
          onEditingLabelChange={setEditingLabel}
          onCancelEdit={() => { setEditingId(""); setEditingLabel(""); }}
          onSaveEdit={renameOption}
          onDelete={removeOption}
        />
      )}
    </div>
  );
}

function ConfigurableSelect({ label, value, options, disabled, onChange, onManage }: {
  label: string;
  value: string;
  options: AccountingOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
  onManage: () => void;
}) {
  return (
    <div>
      <div className="tc-row" style={{ justifyContent: "space-between", gap: 8 }}>
        <div className="tc-sub">{label}</div>
        <button type="button" className="tc-btn" style={{ padding: "3px 8px", minHeight: 0 }} onClick={onManage} title={`Administrar ${label}`}>⚙️</button>
      </div>
      <select className="tc-select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={{ width: "100%", marginTop: 6 }}>
        {options.map((option) => <option key={option.id} value={option.label}>{option.label}</option>)}
        <option value="__add__">➕ Añadir nueva opción</option>
      </select>
    </div>
  );
}

function OptionModal({ category, mode, options, newLabel, newDirection, editingId, editingLabel, busy, error, onClose, onModeChange, onNewLabelChange, onNewDirectionChange, onAdd, onStartEdit, onEditingLabelChange, onCancelEdit, onSaveEdit, onDelete }: {
  category: CategoryKey;
  mode: "add" | "manage";
  options: AccountingOption[];
  newLabel: string;
  newDirection: "income" | "expense";
  editingId: string;
  editingLabel: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onModeChange: (mode: "add" | "manage") => void;
  onNewLabelChange: (value: string) => void;
  onNewDirectionChange: (value: "income" | "expense") => void;
  onAdd: () => void;
  onStartEdit: (option: AccountingOption) => void;
  onEditingLabelChange: (value: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string) => void;
  onDelete: (option: AccountingOption) => void;
}) {
  return (
    <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.72)", display: "grid", placeItems: "center", padding: 18 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tc-card" style={{ width: "min(620px, 100%)", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 30px 100px rgba(0,0,0,0.55)" }}>
        <div className="tc-row" style={{ justifyContent: "space-between", gap: 12 }}>
          <div>
            <div className="tc-title">⚙️ {CATEGORY_LABELS[category]}</div>
            <div className="tc-sub" style={{ marginTop: 5 }}>Las modificaciones se guardan en Supabase para todos los usuarios autorizados.</div>
          </div>
          <button className="tc-btn" onClick={onClose} disabled={busy}>✕</button>
        </div>
        <div className="tc-hr" />
        <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className={`tc-btn ${mode === "add" ? "tc-btn-gold" : ""}`} onClick={() => onModeChange("add")}>➕ Añadir</button>
          <button className={`tc-btn ${mode === "manage" ? "tc-btn-gold" : ""}`} onClick={() => onModeChange("manage")}>Administrar opciones</button>
        </div>

        {error && <div style={{ marginTop: 12, padding: 10, borderRadius: 10, border: "1px solid rgba(255,80,80,0.35)", background: "rgba(255,80,80,0.10)" }}>{error}</div>}

        {mode === "add" ? (
          <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
            <div>
              <div className="tc-sub">Nombre de la nueva opción</div>
              <input className="tc-input" value={newLabel} onChange={(e) => onNewLabelChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onAdd(); }} autoFocus maxLength={80} style={{ width: "100%", marginTop: 6 }} placeholder={`Nueva opción de ${CATEGORY_LABELS[category].toLowerCase()}`} />
            </div>
            {category === "movement" && (
              <div>
                <div className="tc-sub">Cómo afecta a la contabilidad</div>
                <select className="tc-select" value={newDirection} onChange={(e) => onNewDirectionChange(e.target.value as "income" | "expense")} style={{ width: "100%", marginTop: 6 }}>
                  <option value="expense">Resta como gasto</option>
                  <option value="income">Suma como ingreso</option>
                </select>
              </div>
            )}
            <div className="tc-row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button className="tc-btn" onClick={onClose} disabled={busy}>Cancelar</button>
              <button className="tc-btn tc-btn-gold" onClick={onAdd} disabled={busy || !newLabel.trim()}>{busy ? "Guardando…" : "Guardar opción"}</button>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
            {options.map((option) => (
              <div key={option.id} style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, padding: 10, background: "rgba(255,255,255,0.03)" }}>
                {editingId === option.id ? (
                  <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <input className="tc-input" value={editingLabel} onChange={(e) => onEditingLabelChange(e.target.value)} style={{ flex: 1, minWidth: 180 }} autoFocus maxLength={80} />
                    <button className="tc-btn tc-btn-ok" onClick={() => onSaveEdit(option.id)} disabled={busy || !editingLabel.trim()}>Guardar</button>
                    <button className="tc-btn" onClick={onCancelEdit} disabled={busy}>Cancelar</button>
                  </div>
                ) : (
                  <div className="tc-row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div>
                      <b>{option.label}</b>
                      {category === "movement" && <div className="tc-sub" style={{ marginTop: 3 }}>{option.metadata?.direction === "income" ? "Suma como ingreso" : "Resta como gasto"}</div>}
                    </div>
                    <div className="tc-row" style={{ gap: 8 }}>
                      <button className="tc-btn" onClick={() => onStartEdit(option)} disabled={busy}>Editar</button>
                      <button className="tc-btn tc-btn-danger" onClick={() => onDelete(option)} disabled={busy || options.length <= 1}>Eliminar</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {options.length === 0 && <div className="tc-sub">No hay opciones activas.</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function KpiBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return <div style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 14, padding: 12, background: highlight ? "rgba(120,255,190,0.10)" : "rgba(255,255,255,0.03)" }}><div className="tc-sub">{label}</div><div style={{ fontWeight: 900, fontSize: 20, marginTop: 6 }}>{value}</div></div>;
}

function BarRow({ label, width, positive }: { label: string; width: number; positive?: boolean }) {
  return (
    <div className="tc-row" style={{ gap: 10, alignItems: "center", flexWrap: "nowrap" }}>
      <div style={{ width: 70 }} className="tc-sub">{label}</div>
      <div style={{ flex: 1, height: 12, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ height: "100%", width: `${width}%`, background: positive ? "linear-gradient(90deg, rgba(120,255,190,0.95), rgba(181,156,255,0.95))" : "linear-gradient(90deg, rgba(255,80,80,0.95), rgba(215,181,109,0.95))" }} />
      </div>
    </div>
  );
}
