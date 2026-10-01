"use client";

import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import {
  Archive,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Coins,
  FileText,
  Filter,
  Landmark,
  LoaderCircle,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Upload,
  WalletCards,
  X,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./FinanceControlCenter.module.css";

type Section = "summary" | "income" | "expense" | "pending" | "settings";
type EntryType = "income" | "expense" | "transfer";
type QuickMovementType = EntryType | "retained";
type ReceivableKind = "platform_hold" | "client_receivable" | "payable";
type OptionCategory = "movement" | "business" | "origin" | "destination" | "payment_method" | "type" | "operation_mode";
type CurrencyTotals = Record<string, number>;

type FinanceMovement = {
  id: string;
  source_id: string;
  source_system: string;
  entry_type: EntryType;
  operation_date: string;
  concept: string;
  description?: string | null;
  category: string;
  amount: number;
  gross_amount?: number;
  fee_amount?: number;
  net_amount?: number;
  currency: string;
  business: string;
  payment_method: string;
  provider?: string;
  status: string;
  settled_amount?: number | null;
  due_date?: string | null;
  due_month?: string | null;
  reference?: string | null;
  counterparty?: string | null;
  note?: string | null;
  origin?: string | null;
  destination?: string | null;
  document_path?: string | null;
  read_only?: boolean;
};

type Receivable = {
  id: string;
  kind: ReceivableKind;
  business: string;
  concept: string;
  description?: string | null;
  category: string;
  payment_method?: string | null;
  provider?: string | null;
  counterparty?: string | null;
  currency: string;
  original_amount: number;
  gross_amount?: number | null;
  fee_amount?: number | null;
  net_amount?: number | null;
  settled_amount: number;
  outstanding_amount: number;
  status: string;
  operation_date: string;
  expected_date?: string | null;
  expected_month?: string | null;
  source_payment_id?: string | null;
  reference?: string | null;
  note?: string | null;
};

type AccountingOption = {
  id: string;
  category: OptionCategory;
  label: string;
  metadata?: Record<string, any> | null;
  is_active: boolean;
  sort_order: number;
};

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Cobrado",
  settled: "Liquidado",
  pending: "Pendiente",
  partial: "Parcial",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
};

const RECEIVABLE_LABELS: Record<ReceivableKind, string> = {
  platform_hold: "Retenido por plataforma",
  client_receivable: "Cobro pendiente de cliente",
  payable: "Gasto pendiente de pagar",
};

function todayKey() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function monthStart() { return `${todayKey().slice(0, 7)}-01`; }
function monthEnd(month: string) {
  const [year, monthValue] = String(month || todayKey().slice(0, 7)).split("-").map(Number);
  const last = new Date(year, monthValue, 0);
  const fixed = new Date(last.getTime() - last.getTimezoneOffset() * 60000);
  return fixed.toISOString().slice(0, 10);
}
function money(value: number, currency = "EUR") {
  try { return (Number(value) || 0).toLocaleString("es-ES", { style: "currency", currency }); }
  catch { return `${(Number(value) || 0).toLocaleString("es-ES", { maximumFractionDigits: 2 })} ${currency}`; }
}
function totalsText(values?: CurrencyTotals) {
  const entries = Object.entries(values || {}).filter(([, value]) => Math.abs(Number(value || 0)) >= 0.005);
  if (!entries.length) return "0,00 €";
  return entries.map(([currency, value]) => money(value, currency)).join(" · ");
}
function statusLabel(value: string) { return STATUS_LABELS[String(value || "").toLowerCase()] || value || "—"; }
function comparisonLabel(current: CurrencyTotals, previous: CurrencyTotals) {
  const currencies = Array.from(new Set([...Object.keys(current || {}), ...Object.keys(previous || {})]));
  if (!currencies.length) return "Sin movimientos comparables";
  return currencies.map((currency) => {
    const now = Number(current?.[currency] || 0);
    const before = Number(previous?.[currency] || 0);
    const diff = now - before;
    if (Math.abs(before) < 0.005) return `${currency}: ${money(now, currency)} · sin base comparable`;
    const pct = (diff / Math.abs(before)) * 100;
    const sign = pct > 0 ? "+" : "";
    const diffText = `${diff >= 0 ? "+" : "−"}${money(Math.abs(diff), currency)}`;
    return `${currency}: ${diffText} · ${sign}${pct.toLocaleString("es-ES", { maximumFractionDigits: 1 })}%`;
  }).join(" · ");
}

async function authHeaders(json = true): Promise<Record<string, string>> {
  const { data } = await supabaseBrowser().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("NO_AUTH");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  if (json) {
    headers["Content-Type"] = "application/json";
  }

  return headers;
}

async function safeJson(response: Response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { error: text || `HTTP_${response.status}` }; }
}

export default function FinanceControlCenter() {
  const [section, setSection] = useState<Section>("summary");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayKey());
  const [filters, setFilters] = useState({ business: "all", category: "all", method: "all", status: "all", currency: "all" });
  const [query, setQuery] = useState("");
  const [data, setData] = useState<any>(null);
  const [options, setOptions] = useState<AccountingOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [movementOpen, setMovementOpen] = useState(false);
  const [editingMovement, setEditingMovement] = useState<FinanceMovement | null>(null);
  const [receivableOpen, setReceivableOpen] = useState(false);
  const [editingReceivable, setEditingReceivable] = useState<Receivable | null>(null);
  const [settlementTarget, setSettlementTarget] = useState<Receivable | null>(null);
  const [movementTypeFilter, setMovementTypeFilter] = useState<"all" | EntryType>("all");
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickError, setQuickError] = useState("");
  const [quickForm, setQuickForm] = useState({
    entry_type: "income" as QuickMovementType,
    entry_date: todayKey(),
    business: "",
    origin: "",
    destination: "",
    payment_method: "",
    category: "",
    amount: "",
    note: "",
    currency: "EUR",
    expected_month: "",
  });

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setMessage("");
    try {
      const headers = await authHeaders(false);
      const params = new URLSearchParams({ from, to, ...filters });
      const [financeResponse, optionsResponse] = await Promise.all([
        fetch(`/api/admin/finance?${params.toString()}`, { headers, cache: "no-store" }),
        fetch("/api/admin/accounting/options?include_archived=1", { headers, cache: "no-store" }),
      ]);
      const finance = await safeJson(financeResponse);
      const optionData = await safeJson(optionsResponse);
      if (!financeResponse.ok || !finance.ok) throw new Error(finance.error || "No se pudo cargar el centro económico");
      setData(finance);
      if (optionsResponse.ok && optionData.ok) setOptions(Array.isArray(optionData.options) ? optionData.options : []);
    } catch (error: any) {
      setMessage(error?.message || "No se pudo cargar la información económica.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filters, from, to]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const channel = supabaseBrowser().channel("admin-finance-center")
      .on("postgres_changes", { event: "*", schema: "public", table: "accounting_entries" }, () => void load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "accounting_receivables" }, () => void load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "accounting_settlements" }, () => void load(true))
      .subscribe();
    return () => { void supabaseBrowser().removeChannel(channel); };
  }, [load]);

  const filterOptions = data?.filter_options || {};
  const totals = data?.totals || {};
  const previous = data?.previous_totals || {};
  const receivables: Receivable[] = Array.isArray(data?.receivables) ? data.receivables : [];

  function optionLabels(category: OptionCategory) {
    return options.filter((item) => item.category === category && item.is_active).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)).map((item) => item.label);
  }

  const businessChoices = useMemo(() => Array.from(new Set([...(optionLabels("business") || []), ...((filterOptions.businesses || []) as string[])])).filter(Boolean), [options, filterOptions.businesses]);
  const methodChoices = useMemo(() => Array.from(new Set([...(optionLabels("payment_method") || []), ...((filterOptions.methods || []) as string[])])).filter(Boolean), [options, filterOptions.methods]);
  const categoryChoices = useMemo(() => Array.from(new Set([...(optionLabels("type") || []), ...((filterOptions.categories || []) as string[])])).filter(Boolean), [options, filterOptions.categories]);
  const originChoices = useMemo(() => Array.from(new Set(optionLabels("origin"))).filter(Boolean), [options]);
  const destinationChoices = useMemo(() => Array.from(new Set(optionLabels("destination"))).filter(Boolean), [options]);

  useEffect(() => {
    setQuickForm((current) => ({
      ...current,
      business: current.business || businessChoices[0] || "Flowly",
      payment_method: current.payment_method || methodChoices[0] || "",
      category: current.category || categoryChoices[0] || (current.entry_type === "income" ? "Venta" : "Gasto"),
      origin: current.origin || originChoices[0] || "",
      destination: current.destination || destinationChoices[0] || "",
    }));
  }, [businessChoices, methodChoices, categoryChoices, originChoices, destinationChoices]);

  const visibleMonth = from.slice(0, 7);
  const visibleMonthLabel = useMemo(() => {
    const [year, monthValue] = visibleMonth.split("-").map(Number);
    return new Date(year, monthValue - 1, 1).toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  }, [visibleMonth]);

  const movements: FinanceMovement[] = useMemo(() => {
    const rows = Array.isArray(data?.movements) ? data.movements : [];
    const normalized = query.trim().toLowerCase();
    return rows.filter((row: FinanceMovement) => {
      if (section === "income" && row.entry_type !== "income") return false;
      if (section === "expense" && row.entry_type !== "expense") return false;
      if (movementTypeFilter !== "all" && row.entry_type !== movementTypeFilter) return false;
      if (!normalized) return true;
      return [row.concept, row.description, row.category, row.business, row.payment_method, row.reference, row.counterparty, row.origin, row.destination]
        .filter(Boolean).join(" ").toLowerCase().includes(normalized);
    });
  }, [data?.movements, query, section, movementTypeFilter]);

  const movementSummary = useMemo(() => {
    const income: CurrencyTotals = {};
    const expense: CurrencyTotals = {};
    const transfer: CurrencyTotals = {};
    const add = (target: CurrencyTotals, currency: string, amount: number) => {
      target[currency] = Number(target[currency] || 0) + Number(amount || 0);
    };
    for (const row of movements) {
      const currency = String(row.currency || "EUR");
      if (row.entry_type === "income") add(income, currency, row.amount);
      if (row.entry_type === "expense") add(expense, currency, row.amount);
      if (row.entry_type === "transfer") add(transfer, currency, row.amount);
    }
    const balance: CurrencyTotals = { ...income };
    Object.entries(expense).forEach(([currency, amount]) => {
      balance[currency] = Number(balance[currency] || 0) - Number(amount || 0);
    });
    return { count: movements.length, income, expense, transfer, balance };
  }, [movements]);

  const businessBreakdown = useMemo(() => {
    const map = new Map<string, { business: string; count: number; income: CurrencyTotals; expense: CurrencyTotals; balance: CurrencyTotals }>();
    for (const row of movements) {
      const key = row.business || "Sin negocio";
      if (!map.has(key)) map.set(key, { business: key, count: 0, income: {}, expense: {}, balance: {} });
      const item = map.get(key)!;
      item.count += 1;
      const currency = String(row.currency || "EUR");
      if (row.entry_type === "income") {
        item.income[currency] = Number(item.income[currency] || 0) + Number(row.amount || 0);
        item.balance[currency] = Number(item.balance[currency] || 0) + Number(row.amount || 0);
      } else if (row.entry_type === "expense") {
        item.expense[currency] = Number(item.expense[currency] || 0) + Number(row.amount || 0);
        item.balance[currency] = Number(item.balance[currency] || 0) - Number(row.amount || 0);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count || a.business.localeCompare(b.business, "es"));
  }, [movements]);

  const setQuick = (key: keyof typeof quickForm, value: string) => setQuickForm((current) => ({ ...current, [key]: value }));

  const addQuickPaymentMethod = async () => {
    const label = window.prompt("Nombre del nuevo método o proveedor (por ejemplo: PayPal)");
    if (!label?.trim()) return;
    try {
      const headers = await authHeaders();
      const response = await fetch("/api/admin/accounting/options", {
        method: "POST",
        headers,
        body: JSON.stringify({ category: "payment_method", label: label.trim() }),
      });
      const json = await safeJson(response);
      if (!response.ok || !json.ok) throw new Error(json.error || "No se pudo añadir el método");
      const option = json.option as AccountingOption | undefined;
      if (option) setOptions((current) => [...current.filter((item) => item.id !== option.id), option]);
      setQuick("payment_method", option?.label || label.trim());
    } catch (error: any) {
      setQuickError(error?.message === "OPTION_ALREADY_EXISTS" ? "Ese método ya existe. Puedes seleccionarlo en el desplegable." : (error?.message || "No se pudo añadir el método."));
      await load(true);
    }
  };

  const saveQuickMovement = async () => {
    setQuickError("");
    const amount = Number(String(quickForm.amount || "0").replace(",", "."));
    if (!(amount > 0)) {
      setQuickError("Introduce un importe mayor que cero.");
      return;
    }
    setQuickSaving(true);
    try {
      const headers = await authHeaders();
      const isRetained = quickForm.entry_type === "retained";
      const response = await fetch("/api/admin/finance", {
        method: "POST",
        headers,
        body: JSON.stringify(isRetained ? {
          action: "receivable",
          kind: "platform_hold",
          operation_date: quickForm.entry_date,
          business: quickForm.business || businessChoices[0] || "Flowly",
          payment_method: quickForm.payment_method || null,
          provider: quickForm.payment_method || null,
          counterparty: quickForm.payment_method || null,
          category: quickForm.category || "Ingreso retenido",
          concept: quickForm.category || "Pago retenido",
          original_amount: amount,
          gross_amount: amount,
          currency: quickForm.currency || "EUR",
          expected_month: quickForm.expected_month || null,
          note: quickForm.note || null,
          idempotency_key: crypto.randomUUID(),
        } : {
          action: "movement",
          entry_type: quickForm.entry_type,
          entry_date: quickForm.entry_date,
          business: quickForm.business || businessChoices[0] || "Flowly",
          origin: quickForm.origin || null,
          destination: quickForm.destination || null,
          payment_method: quickForm.payment_method || null,
          category: quickForm.category || (quickForm.entry_type === "income" ? "Ingreso manual" : quickForm.entry_type === "expense" ? "Gasto manual" : "Traspaso"),
          amount,
          description: quickForm.note || null,
          currency: quickForm.currency || "EUR",
          status: "settled",
          idempotency_key: crypto.randomUUID(),
        }),
      });
      const json = await safeJson(response);
      if (!response.ok || !json.ok) throw new Error(json.error || "No se pudo registrar el movimiento");

      const savedDate = quickForm.entry_date || todayKey();
      const savedMonth = savedDate.slice(0, 7);
      const currentVisibleMonth = from.slice(0, 7);

      setQuickForm((current) => ({ ...current, amount: "", note: "", expected_month: "" }));

      if (isRetained) {
        setSection("pending");
        await load(true);
      } else if (savedMonth !== currentVisibleMonth) {
        setFrom(`${savedMonth}-01`);
        setTo(monthEnd(savedMonth));
      } else {
        await load(true);
      }
    } catch (error: any) {
      setQuickError(error?.message || "No se pudo guardar el movimiento.");
    } finally {
      setQuickSaving(false);
    }
  };

  const mainSummaryCards = [
    { icon: TrendingUp, label: "Ingresos del periodo", value: totalsText(totals.income), detail: comparisonLabel(totals.income || {}, previous.income || {}), tone: "positive" },
    { icon: TrendingDown, label: "Gastos del periodo", value: totalsText(totals.expense), detail: comparisonLabel(totals.expense || {}, previous.expense || {}), tone: "negative" },
    { icon: CircleDollarSign, label: "Resultado del periodo", value: totalsText(totals.result), detail: "Ingresos menos gastos", tone: "gold" },
    { icon: Clock3, label: "Dinero retenido", value: totalsText(totals.retained), detail: "Cobrado pero pendiente de liquidación", tone: "violet" },
    { icon: WalletCards, label: "Cobros pendientes", value: totalsText(totals.pendingCollections), detail: "Lo que aún debe el cliente", tone: "gold" },
    { icon: Banknote, label: "Gastos pendientes", value: totalsText(totals.pendingExpenses), detail: "Pagos todavía no realizados", tone: "negative" },
  ];

  return (
    <div className={styles.shell}>
      <nav className={styles.tabs} aria-label="Secciones económicas">
        {([
          ["summary", "Resumen y movimientos", Coins], ["income", "Solo ingresos", TrendingUp], ["expense", "Solo gastos", TrendingDown], ["pending", "Pendientes y retenidos", Clock3], ["settings", "Categorías y métodos", Settings2],
        ] as const).map(([key, label, Icon]) => <button key={key} className={section === key ? styles.tabActive : ""} onClick={() => setSection(key)}><Icon size={16} />{label}</button>)}
      </nav>

      {message ? <div className={styles.errorBox}>{message}</div> : null}

      {section === "pending" ? (
        <PendingSection rows={receivables} settlements={Array.isArray(data?.settlements) ? data.settlements : []} onNew={() => { setEditingReceivable(null); setReceivableOpen(true); }} onEdit={(row) => { setEditingReceivable(row); setReceivableOpen(true); }} onSettle={setSettlementTarget} onChanged={() => void load(true)} />
      ) : section === "settings" ? (
        <OptionsSection options={options} onChanged={() => void load(true)} />
      ) : (
        <>
          <section className={styles.simpleTopGrid}>
            <article className={styles.quickEntryCard}>
              <div className={styles.quickEntryHeader}>
                <div className={styles.quickEntryIcon}><Plus size={20} /></div>
                <div>
                  <h3>Nuevo movimiento</h3>
                  <p>Añade ingresos, gastos o traspasos de forma rápida y visual.</p>
                </div>
              </div>
              <div className={styles.quickEntryGrid}>
                <Field label="Movimiento">
                  <select value={quickForm.entry_type} onChange={(e) => setQuick("entry_type", e.target.value)}>
                    <option value="income">Ingreso</option>
                    <option value="expense">Gasto</option>
                    <option value="transfer">Traspaso</option>
                    <option value="retained">Pago retenido</option>
                  </select>
                </Field>
                <Field label="Fecha">
                  <input type="date" value={quickForm.entry_date} onChange={(e) => setQuick("entry_date", e.target.value)} />
                </Field>
                <Field label="Negocio">
                  <select value={quickForm.business} onChange={(e) => setQuick("business", e.target.value)}>
                    {businessChoices.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </Field>
                <Field label="Origen del dinero">
                  <input list="finance-origin-list" value={quickForm.origin} onChange={(e) => setQuick("origin", e.target.value)} />
                </Field>
                <Field label="Destino del dinero">
                  <input list="finance-destination-list" value={quickForm.destination} onChange={(e) => setQuick("destination", e.target.value)} />
                </Field>
                <Field label={quickForm.entry_type === "retained" ? "Plataforma que retiene" : "Por dónde se ingresa"}>
                  <select value={quickForm.payment_method} onChange={(e) => {
                    if (e.target.value === "__add_new_method__") void addQuickPaymentMethod();
                    else setQuick("payment_method", e.target.value);
                  }}>
                    <option value="">Seleccionar…</option>
                    {methodChoices.map((item) => <option key={item} value={item}>{item}</option>)}
                    <option value="__add_new_method__">＋ Añadir nuevo método…</option>
                  </select>
                </Field>
                <Field label="Tipo">
                  <input list="finance-category-list" value={quickForm.category} onChange={(e) => setQuick("category", e.target.value)} />
                </Field>
                <Field label="Importe">
                  <input inputMode="decimal" value={quickForm.amount} onChange={(e) => setQuick("amount", e.target.value)} placeholder="0,00 €" />
                </Field>
                {quickForm.entry_type === "retained" ? <Field label="Liberación prevista">
                  <input type="month" value={quickForm.expected_month} onChange={(e) => setQuick("expected_month", e.target.value)} />
                </Field> : null}
                <Field label="Observación">
                  <input value={quickForm.note} onChange={(e) => setQuick("note", e.target.value)} placeholder="Opcional" />
                </Field>
                <div className={styles.quickActionWrap}>
                  <button className={styles.primaryButton} onClick={() => void saveQuickMovement()} disabled={quickSaving}>
                    {quickSaving ? <LoaderCircle size={16} className={styles.spin} /> : <Plus size={16} />}
                    {quickSaving ? "Guardando" : "Añadir"}
                  </button>
                </div>
              </div>
              {quickError ? <div className={styles.errorBox}>{quickError}</div> : null}
              <datalist id="finance-origin-list">{originChoices.map((item) => <option key={item} value={item} />)}</datalist>
              <datalist id="finance-destination-list">{destinationChoices.map((item) => <option key={item} value={item} />)}</datalist>
              <datalist id="finance-category-list">{categoryChoices.map((item) => <option key={item} value={item} />)}</datalist>
            </article>

            <aside className={styles.periodCard}>
              <span className={styles.eyebrow}>Mes visible</span>
              <label className={styles.monthPicker}>
                <span>{visibleMonthLabel}</span>
                <input type="month" value={visibleMonth} onChange={(e) => { setFrom(`${e.target.value}-01`); setTo(monthEnd(e.target.value)); }} />
              </label>
              <div className={styles.periodMeta}>
                <div><small>Desde</small><strong>{from}</strong></div>
                <div><small>Hasta</small><strong>{to}</strong></div>
              </div>
              <button className={styles.secondaryButton} onClick={() => void load()} disabled={loading}>
                <RefreshCw size={16} className={loading ? styles.spin : ""} /> Refrescar
              </button>
              <div className={styles.miniNotes}>
                <div><ShieldCheck size={14} /><span>Este apartado solo utiliza los movimientos registrados aquí.</span></div>
                <div><Landmark size={14} /><span>No se importan ingresos desde Diario, CRM ni pagos web.</span></div>
              </div>
            </aside>
          </section>

          <section className={styles.kpiGrid}>
            {mainSummaryCards.map((card) => <Kpi key={card.label} icon={card.icon} label={card.label} value={card.value} detail={card.detail} tone={card.tone} />)}
          </section>

          <section className={styles.tableCard}>
            <div className={styles.tableHead}>
              <div>
                <span className={styles.eyebrow}>MOVIMIENTOS DEL MES</span>
                <h3>{section === "income" ? "Ingresos del mes" : section === "expense" ? "Gastos del mes" : "Movimientos del mes"}</h3>
                <p>Filtros simples, resumen claro y una sola tabla para entender rápido qué entra, qué sale y qué queda.</p>
              </div>
            </div>

            <div className={styles.simpleFilters}>
              <Field label="Fecha exacta">
                <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} />
              </Field>
              <FilterSelect label="Negocio" value={filters.business} values={filterOptions.businesses} onChange={(business) => setFilters((current) => ({ ...current, business }))} />
              <FilterSelect label="Origen" value={filters.category} values={filterOptions.categories} onChange={(category) => setFilters((current) => ({ ...current, category }))} />
              <FilterSelect label="Medio" value={filters.method} values={filterOptions.methods} onChange={(method) => setFilters((current) => ({ ...current, method }))} />
              <FilterSelect label="Estado" value={filters.status} values={filterOptions.statuses} onChange={(status) => setFilters((current) => ({ ...current, status }))} />
              <FilterSelect label="Moneda" value={filters.currency} values={filterOptions.currencies} onChange={(currency) => setFilters((current) => ({ ...current, currency }))} />
              <label className={styles.field}>
                <span>Movimiento</span>
                <select value={movementTypeFilter} onChange={(e) => setMovementTypeFilter(e.target.value as any)}>
                  <option value="all">Todos</option>
                  <option value="income">Ingresos</option>
                  <option value="expense">Gastos</option>
                  <option value="transfer">Traspasos</option>
                </select>
              </label>
            </div>

            <div className={styles.filteredSummary}>
              <div className={styles.filteredSummaryText}>
                <span className={styles.eyebrow}>Resumen de resultados filtrados</span>
                <p>Período: <b>{visibleMonthLabel}</b> · Negocio: <b>{filters.business === "all" ? "Todos" : filters.business}</b> · Medio: <b>{filters.method === "all" ? "Todos" : filters.method}</b> · Movimiento: <b>{movementTypeFilter === "all" ? "Todos" : movementTypeFilter === "income" ? "Ingresos" : movementTypeFilter === "expense" ? "Gastos" : "Traspasos"}</b></p>
              </div>
              <div className={styles.filteredStat}><small>Movimientos</small><strong>{movementSummary.count}</strong></div>
              <div className={styles.filteredStat}><small>Ingresos filtrados</small><strong>{totalsText(movementSummary.income)}</strong></div>
              <div className={styles.filteredStat}><small>Gastos filtrados</small><strong>{totalsText(movementSummary.expense)}</strong></div>
              <div className={styles.filteredStat}><small>Balance neto</small><strong>{totalsText(movementSummary.balance)}</strong></div>
              <div className={styles.filteredStat}><small>Total traspasado</small><strong>{totalsText(movementSummary.transfer)}</strong></div>
            </div>

            <div className={styles.tableHead}>
              <label className={styles.search}><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar concepto, negocio, método…" /></label>
            </div>

            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr><th>Fecha</th><th>Origen</th><th>Tipo</th><th>Concepto</th><th>Negocio</th><th>Método</th><th>Estado</th><th>Importe</th><th></th></tr>
                </thead>
                <tbody>
                  {movements.map((row) => <MovementRow key={row.id} row={row} onEdit={() => { setEditingMovement(row); setMovementOpen(true); }} onChanged={() => void load(true)} />)}
                  {!movements.length ? <tr><td colSpan={9} className={styles.empty}>{loading ? "Cargando movimientos…" : "No hay movimientos en este periodo."}</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          {!!businessBreakdown.length && (
            <section className={styles.businessGrid}>
              {businessBreakdown.map((item) => (
                <article key={item.business} className={styles.businessCard}>
                  <div className={styles.businessCardHead}>
                    <span className={styles.eyebrow}>Negocio</span>
                    <span className={styles.businessLines}>{item.count} líneas</span>
                  </div>
                  <h4>{item.business}</h4>
                  <div className={styles.businessCardStats}>
                    <div><small>Ingresos</small><strong>{totalsText(item.income)}</strong></div>
                    <div><small>Gastos</small><strong>{totalsText(item.expense)}</strong></div>
                    <div><small>Balance</small><strong>{totalsText(item.balance)}</strong></div>
                  </div>
                </article>
              ))}
            </section>
          )}
        </>
      )}

      {movementOpen ? <MovementModal movement={editingMovement} options={options} onClose={() => setMovementOpen(false)} onSaved={() => { setMovementOpen(false); void load(true); }} /> : null}
      {receivableOpen ? <ReceivableModal target={editingReceivable} options={options} onClose={() => { setReceivableOpen(false); setEditingReceivable(null); }} onSaved={() => { setReceivableOpen(false); setEditingReceivable(null); void load(true); }} /> : null}
      {settlementTarget ? <SettlementModal target={settlementTarget} accounts={Array.from(new Set([...optionLabels("destination"), ...optionLabels("origin")]))} onClose={() => setSettlementTarget(null)} onSaved={() => { setSettlementTarget(null); void load(true); }} /> : null}
    </div>
  );
}

function FilterSelect({ label, value, values, onChange }: { label: string; value: string; values?: string[]; onChange: (value: string) => void }) {
  return <label><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="all">Todos</option>{(values || []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>;
}

function Kpi({ icon: Icon, label, value, detail, tone }: { icon: any; label: string; value: string; detail: string; tone: string }) {
  return <article className={styles.kpi} data-tone={tone}><div className={styles.kpiTop}><div className={styles.kpiIcon}><Icon size={19} /></div><span>{label}</span></div><strong>{value}</strong><small>{detail}</small></article>;
}

async function openDocument(path: string) {
  try {
    const headers = await authHeaders(false);
    const response = await fetch(`/api/admin/finance/document?path=${encodeURIComponent(path)}`, { headers, cache: "no-store" });
    const json = await safeJson(response);
    if (!response.ok || !json.ok || !json.url) throw new Error(json.error || "No se pudo abrir el justificante");
    window.open(json.url, "_blank", "noopener,noreferrer");
  } catch (error: any) { window.alert(error?.message || "No se pudo abrir el justificante"); }
}

function MovementRow({ row, onEdit, onChanged }: { row: FinanceMovement; onEdit: () => void; onChanged: () => void }) {
  const archive = async () => {
    if (!window.confirm("¿Archivar este movimiento? Se conservará en el histórico y dejará de entrar en los indicadores.")) return;
    const headers = await authHeaders();
    const response = await fetch("/api/admin/finance", { method: "PATCH", headers, body: JSON.stringify({ entity: "movement", id: row.source_id, archive: true }) });
    const json = await safeJson(response); if (!response.ok || !json.ok) return window.alert(json.error || "No se pudo archivar"); onChanged();
  };
  return <tr>
    <td>{row.operation_date || "—"}</td><td><span className={`${styles.sourceBadge} ${styles.sourceManual}`}>Este apartado</span></td>
    <td><span className={styles.typeBadge} data-type={row.entry_type}>{row.entry_type === "income" ? "Ingreso" : row.entry_type === "expense" ? "Gasto" : "Traspaso"}</span></td>
    <td><b>{row.category || row.concept}</b><small className={styles.cellSub}>{row.description || row.reference || ""}</small></td><td>{row.business || "—"}</td><td>{row.payment_method || "—"}</td>
    <td><span className={styles.statusBadge} data-status={row.status}>{statusLabel(row.status)}</span></td><td className={styles.amount} data-type={row.entry_type}>{row.entry_type === "expense" ? "−" : row.entry_type === "income" ? "+" : ""}{money(row.amount, row.currency)}</td>
    <td><div className={styles.rowActions}>{row.document_path ? <button onClick={() => void openDocument(row.document_path!)} title="Abrir justificante"><FileText size={14} /></button> : null}{row.read_only ? <span className={styles.readOnly}>Fuente real</span> : <><button onClick={onEdit} title="Editar"><Pencil size={14} /></button><button onClick={() => void archive()} title="Archivar"><Archive size={14} /></button></>}</div></td>
  </tr>;
}

function PendingSection({ rows, settlements, onNew, onEdit, onSettle, onChanged }: { rows: Receivable[]; settlements: any[]; onNew: () => void; onEdit: (row: Receivable) => void; onSettle: (row: Receivable) => void; onChanged: () => void }) {
  const [historyTarget, setHistoryTarget] = useState<Receivable | null>(null);
  const archive = async (row: Receivable) => {
    if (!window.confirm("¿Archivar este registro? No se borrará su histórico de liquidaciones.")) return;
    const headers = await authHeaders();
    const response = await fetch("/api/admin/finance", { method: "PATCH", headers, body: JSON.stringify({ entity: "receivable", id: row.id, archive: true }) });
    const json = await safeJson(response); if (!response.ok || !json.ok) return window.alert(json.error || "No se pudo archivar"); onChanged();
  };
  return <><section className={styles.tableCard}><div className={styles.tableHead}><div><span className={styles.eyebrow}>PENDIENTES Y RETENIDOS</span><h3>Dinero que todavía no está disponible o no se ha pagado</h3><p>Una retención de Mollie/Stripe no es una deuda del cliente y su liberación no vuelve a sumar ingresos.</p></div><button className={styles.primaryButton} onClick={onNew}><Plus size={16} /> Registrar pendiente / retenido</button></div>
    <div className={styles.tableWrap}><table><thead><tr><th>Tipo</th><th>Concepto</th><th>Quién</th><th>Negocio</th><th>Previsto</th><th>Original</th><th>Recibido/Pagado</th><th>Pendiente</th><th>Estado</th><th></th></tr></thead><tbody>
      {rows.map((row) => <tr key={row.id}><td><span className={styles.holdBadge} data-kind={row.kind}>{RECEIVABLE_LABELS[row.kind]}</span></td><td><b>{row.concept}</b><small className={styles.cellSub}>{row.note || row.description || ""}{row.gross_amount != null || row.fee_amount != null || row.net_amount != null ? `${row.note || row.description ? " · " : ""}Bruto ${money(Number(row.gross_amount ?? row.original_amount), row.currency)} · Comisiones ${money(Number(row.fee_amount || 0), row.currency)} · Neto ${money(Number(row.net_amount ?? row.original_amount), row.currency)}` : ""}</small></td><td>{row.counterparty || row.provider || "—"}</td><td>{row.business}</td><td>{row.expected_date || (row.expected_month ? `${row.expected_month} · mes` : "Sin fecha")}</td><td>{money(row.original_amount, row.currency)}</td><td>{money(row.settled_amount, row.currency)}</td><td className={styles.amount}>{money(row.outstanding_amount, row.currency)}</td><td><span className={styles.statusBadge} data-status={row.status}>{statusLabel(row.status)}</span></td><td><div className={styles.rowActions}>{row.outstanding_amount > 0 && !["cancelled", "settled"].includes(row.status) ? <button className={styles.textAction} onClick={() => onSettle(row)}>{row.kind === "payable" ? "Registrar pago" : "Registrar recepción"}</button> : null}<button onClick={() => onEdit(row)} title="Editar"><Pencil size={14} /></button><button className={styles.textAction} onClick={() => setHistoryTarget(row)}>Historial</button><button onClick={() => void archive(row)} title="Archivar"><Archive size={14} /></button></div></td></tr>)}
      {!rows.length ? <tr><td colSpan={10} className={styles.empty}>No hay pendientes o retenciones con los filtros actuales.</td></tr> : null}
    </tbody></table></div></section>{historyTarget ? <Modal title="Historial de liquidaciones" subtitle={`${historyTarget.concept} · ${RECEIVABLE_LABELS[historyTarget.kind]}`} onClose={() => setHistoryTarget(null)}><div className={styles.historyList}>{settlements.filter((item) => String(item.receivable_id) === historyTarget.id).map((item) => <div key={item.id} className={styles.historyRow}><div><b>{item.settled_on}</b><small>{item.destination_account || "Cuenta no indicada"}{item.note ? ` · ${item.note}` : ""}</small></div><strong>{money(Number(item.amount || 0), item.currency || historyTarget.currency)}</strong></div>)}{!settlements.some((item) => String(item.receivable_id) === historyTarget.id) ? <div className={styles.empty}>Todavía no hay recepciones o pagos registrados en el periodo seleccionado.</div> : null}</div></Modal> : null}</>;
}

function MovementModal({ movement, options, onClose, onSaved }: { movement: FinanceMovement | null; options: AccountingOption[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<any>({ entry_type: movement?.entry_type || "expense", entry_date: movement?.operation_date || todayKey(), business: movement?.business || "Celestial", category: movement?.category || "Otros", payment_method: movement?.payment_method || "Transferencia", currency: movement?.currency || "EUR", amount: movement?.amount || "", status: movement?.status === "confirmed" ? "settled" : movement?.status || "settled", settled_amount: movement?.settled_amount ?? "", origin: movement?.origin || "", destination: movement?.destination || "", counterparty: movement?.counterparty || "", reference: movement?.reference || "", description: movement?.description || movement?.note || "", due_date: movement?.due_date || "", due_month: movement?.due_month || "", gross_amount: movement?.gross_amount || "", fee_amount: movement?.fee_amount || "", net_amount: movement?.net_amount || "", document_path: movement?.document_path || "" });
  const [saving, setSaving] = useState(false); const [uploading, setUploading] = useState(false); const [error, setError] = useState("");
  const labels = (category: OptionCategory) => options.filter((item) => item.category === category && item.is_active).sort((a,b)=>a.sort_order-b.sort_order).map((item)=>item.label);
  const set = (key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value }));
  const upload = async (file?: File) => { if (!file) return; setUploading(true); setError(""); try { const headers = await authHeaders(false); const body = new FormData(); body.append("file", file); const response = await fetch("/api/admin/finance/document", { method: "POST", headers, body }); const json = await safeJson(response); if (!response.ok || !json.ok) throw new Error(json.error || "No se pudo subir"); set("document_path", json.path); } catch (e:any) { setError(e.message); } finally { setUploading(false); } };
  const save = async () => { setSaving(true); setError(""); try { const headers = await authHeaders(); const payload = { ...form, amount: Number(String(form.amount).replace(",", ".")), settled_amount: form.settled_amount === "" ? undefined : Number(String(form.settled_amount).replace(",", ".")), gross_amount: form.gross_amount === "" ? undefined : Number(String(form.gross_amount).replace(",", ".")), fee_amount: form.fee_amount === "" ? 0 : Number(String(form.fee_amount).replace(",", ".")), net_amount: form.net_amount === "" ? undefined : Number(String(form.net_amount).replace(",", ".")), idempotency_key: crypto.randomUUID() }; const response = await fetch("/api/admin/finance", { method: movement ? "PATCH" : "POST", headers, body: JSON.stringify(movement ? { entity: "movement", id: movement.source_id, ...payload } : payload) }); const json = await safeJson(response); if (!response.ok || !json.ok) throw new Error(json.error || "No se pudo guardar"); onSaved(); } catch(e:any){ setError(e.message); } finally { setSaving(false); } };
  return <Modal title={movement ? "Editar movimiento" : "Nuevo movimiento económico"} subtitle="Los traspasos entre cuentas propias no cuentan como ingreso ni gasto." onClose={onClose}>
    <div className={styles.formGrid}><Field label="Tipo"><select value={form.entry_type} onChange={(e)=>set("entry_type",e.target.value)} disabled={!!movement}><option value="income">Ingreso manual</option><option value="expense">Gasto</option><option value="transfer">Traspaso entre cuentas</option></select></Field><Field label="Fecha"><input type="date" value={form.entry_date} onChange={(e)=>set("entry_date",e.target.value)} /></Field><Field label="Negocio"><DatalistInput value={form.business} values={labels("business")} onChange={(v)=>set("business",v)} /></Field><Field label="Categoría"><DatalistInput value={form.category} values={labels("type")} onChange={(v)=>set("category",v)} /></Field><Field label="Método / proveedor"><DatalistInput value={form.payment_method} values={labels("payment_method")} onChange={(v)=>set("payment_method",v)} /></Field><Field label="Moneda"><select value={form.currency} onChange={(e)=>set("currency",e.target.value)}><option>EUR</option><option>USD</option><option>GBP</option></select></Field><Field label="Importe"><input inputMode="decimal" value={form.amount} onChange={(e)=>set("amount",e.target.value)} placeholder="0,00" /></Field><Field label="Estado"><select value={form.status} onChange={(e)=>set("status",e.target.value)}><option value="settled">Liquidado</option><option value="pending">Pendiente</option><option value="partial">Parcial</option><option value="cancelled">Cancelado</option><option value="refunded">Reembolsado</option></select></Field><Field label="Importe cobrado/pagado"><input inputMode="decimal" value={form.settled_amount} onChange={(e)=>set("settled_amount",e.target.value)} placeholder={form.status === "settled" ? "Automático" : "0,00"} /></Field><Field label="Cuenta origen"><DatalistInput value={form.origin} values={labels("origin")} onChange={(v)=>set("origin",v)} /></Field><Field label="Cuenta destino"><DatalistInput value={form.destination} values={labels("destination")} onChange={(v)=>set("destination",v)} /></Field><Field label="Cliente / proveedor"><input value={form.counterparty} onChange={(e)=>set("counterparty",e.target.value)} /></Field><Field label="Referencia"><input value={form.reference} onChange={(e)=>set("reference",e.target.value)} /></Field><Field label="Vencimiento exacto"><input type="date" value={form.due_date} onChange={(e)=>set("due_date",e.target.value)} /></Field><Field label="O solo mes previsto"><input type="month" value={form.due_month} onChange={(e)=>set("due_month",e.target.value)} /></Field><Field label="Bruto"><input inputMode="decimal" value={form.gross_amount} onChange={(e)=>set("gross_amount",e.target.value)} placeholder="Opcional" /></Field><Field label="Comisiones"><input inputMode="decimal" value={form.fee_amount} onChange={(e)=>set("fee_amount",e.target.value)} placeholder="0,00" /></Field><Field label="Neto"><input inputMode="decimal" value={form.net_amount} onChange={(e)=>set("net_amount",e.target.value)} placeholder="Opcional" /></Field></div>
    <Field label="Descripción / notas"><textarea rows={3} value={form.description} onChange={(e)=>set("description",e.target.value)} /></Field>
    <div className={styles.uploadBox}><div><FileText size={18}/><span>{form.document_path ? "Justificante adjunto" : "Factura o justificante opcional"}</span></div><label className={styles.secondaryButton}><Upload size={15}/>{uploading ? "Subiendo…" : "Adjuntar"}<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden disabled={uploading} onChange={(e)=>void upload(e.target.files?.[0])}/></label></div>
    {error ? <div className={styles.errorBox}>{error}</div> : null}<div className={styles.modalActions}><button className={styles.secondaryButton} onClick={onClose}>Cancelar</button><button className={styles.primaryButton} onClick={()=>void save()} disabled={saving || uploading}><Save size={16}/>{saving?"Guardando…":"Guardar"}</button></div>
  </Modal>;
}

function ReceivableModal({ target, options, onClose, onSaved }: { target: Receivable | null; options: AccountingOption[]; onClose: () => void; onSaved: () => void }) {
  const labels=(c:OptionCategory)=>options.filter(i=>i.category===c&&i.is_active).sort((a,b)=>a.sort_order-b.sort_order).map(i=>i.label);
  const [form,setForm]=useState<any>({
    kind:target?.kind || "platform_hold",
    business:target?.business || "Celestial",
    concept:target?.concept || "Fondos retenidos",
    category:target?.category || "Venta / consulta",
    payment_method:target?.payment_method || "Mollie",
    provider:target?.provider || target?.payment_method || "Mollie",
    counterparty:target?.counterparty || target?.provider || "Mollie",
    currency:target?.currency || "EUR",
    original_amount:target?.original_amount ?? "",
    gross_amount:target?.gross_amount ?? "",
    fee_amount:target?.fee_amount ?? "",
    net_amount:target?.net_amount ?? "",
    operation_date:target?.operation_date || todayKey(),
    expected_date:target?.expected_date || "",
    expected_month:target?.expected_month || "",
    source_payment_id:target?.source_payment_id || "",
    reference:target?.reference || "",
    note:target?.note || "",
  });
  const [saving,setSaving]=useState(false); const [error,setError]=useState(""); const set=(k:string,v:any)=>setForm((c:any)=>({...c,[k]:v}));
  const numberOrUndefined=(value:any)=>String(value ?? "").trim()===""?undefined:Number(String(value).replace(",","."));
  const save=async()=>{setSaving(true);setError("");try{const headers=await authHeaders();const payload={...form,original_amount:Number(String(form.original_amount).replace(",",".")),gross_amount:numberOrUndefined(form.gross_amount),fee_amount:numberOrUndefined(form.fee_amount),net_amount:numberOrUndefined(form.net_amount)};const response=await fetch("/api/admin/finance",{method:target?"PATCH":"POST",headers,body:JSON.stringify(target?{entity:"receivable",id:target.id,...payload}:{action:"receivable",...payload,idempotency_key:crypto.randomUUID()})});const json=await safeJson(response);if(!response.ok||!json.ok)throw new Error(json.error||"No se pudo guardar");onSaved();}catch(e:any){setError(e.message)}finally{setSaving(false)}};
  return <Modal title={target?"Editar pendiente o retenido":"Registrar pendiente o retenido"} subtitle="Registro independiente para controlar disponibilidad, deudas y obligaciones." onClose={onClose}><div className={styles.formGrid}><Field label="Naturaleza"><select value={form.kind} disabled={!!target} onChange={(e)=>{const kind=e.target.value;set("kind",kind);set("concept",kind==="platform_hold"?"Fondos retenidos":kind==="payable"?"Gasto pendiente":"Cobro pendiente de cliente")}}><option value="platform_hold">Retenido por plataforma</option><option value="client_receivable">Cobro pendiente del cliente</option><option value="payable">Gasto pendiente de pagar</option></select></Field><Field label="Negocio"><DatalistInput value={form.business} values={labels("business")} onChange={(v)=>set("business",v)}/></Field><Field label="Concepto"><input value={form.concept} onChange={(e)=>set("concept",e.target.value)}/></Field><Field label="Categoría"><DatalistInput value={form.category} values={labels("type")} onChange={(v)=>set("category",v)}/></Field><Field label="Método / plataforma"><DatalistInput value={form.payment_method} values={labels("payment_method")} onChange={(v)=>{set("payment_method",v);set("provider",v);if(form.kind==="platform_hold")set("counterparty",v)}}/></Field><Field label="Quién debe entregar / recibir"><input value={form.counterparty} onChange={(e)=>set("counterparty",e.target.value)}/></Field><Field label="Importe pendiente original"><input inputMode="decimal" value={form.original_amount} onChange={(e)=>set("original_amount",e.target.value)} placeholder="0,00"/></Field><Field label="Moneda"><select value={form.currency} onChange={(e)=>set("currency",e.target.value)}><option>EUR</option><option>USD</option><option>GBP</option></select></Field><Field label="Bruto (opcional)"><input inputMode="decimal" value={form.gross_amount} onChange={(e)=>set("gross_amount",e.target.value)} placeholder="Antes de comisiones"/></Field><Field label="Comisiones (opcional)"><input inputMode="decimal" value={form.fee_amount} onChange={(e)=>set("fee_amount",e.target.value)} placeholder="0,00"/></Field><Field label="Neto previsto (opcional)"><input inputMode="decimal" value={form.net_amount} onChange={(e)=>set("net_amount",e.target.value)} placeholder="Después de comisiones"/></Field><Field label="Fecha operación"><input type="date" value={form.operation_date} onChange={(e)=>set("operation_date",e.target.value)}/></Field><Field label="Fecha prevista exacta"><input type="date" value={form.expected_date} onChange={(e)=>set("expected_date",e.target.value)}/></Field><Field label="O solo mes previsto"><input type="month" value={form.expected_month} onChange={(e)=>set("expected_month",e.target.value)}/></Field><Field label="Referencia"><input value={form.reference} onChange={(e)=>set("reference",e.target.value)}/></Field></div><Field label="Observaciones"><textarea rows={3} value={form.note} onChange={(e)=>set("note",e.target.value)}/></Field>{error?<div className={styles.errorBox}>{error}</div>:null}<div className={styles.modalActions}><button className={styles.secondaryButton} onClick={onClose}>Cancelar</button><button className={styles.primaryButton} onClick={()=>void save()} disabled={saving}>{saving?"Guardando…":target?"Guardar cambios":"Registrar"}</button></div></Modal>;
}

function SettlementModal({ target, accounts, onClose, onSaved }: { target: Receivable; accounts: string[]; onClose: () => void; onSaved: () => void }) {
  const [amount,setAmount]=useState(String(target.outstanding_amount)); const [date,setDate]=useState(todayKey()); const [destination,setDestination]=useState(accounts[0]||""); const [note,setNote]=useState(""); const [saving,setSaving]=useState(false); const [error,setError]=useState("");
  const save=async()=>{setSaving(true);setError("");try{const headers=await authHeaders();const response=await fetch("/api/admin/finance/settlements",{method:"POST",headers,body:JSON.stringify({receivable_id:target.id,amount:Number(amount.replace(",",".")),settled_on:date,destination_account:destination,note,idempotency_key:crypto.randomUUID()})});const json=await safeJson(response);if(!response.ok||!json.ok)throw new Error(json.error||"No se pudo registrar");onSaved();}catch(e:any){setError(e.message)}finally{setSaving(false)}};
  return <Modal title={target.kind==="payable"?"Registrar pago":"Registrar recepción"} subtitle="Puede ser total o parcial. El ingreso original no se duplica." onClose={onClose}><div className={styles.settlementSummary}><span>{RECEIVABLE_LABELS[target.kind]}</span><b>{target.concept}</b><strong>Pendiente: {money(target.outstanding_amount,target.currency)}</strong></div><div className={styles.formGrid}><Field label={`Importe (${target.currency})`}><input inputMode="decimal" value={amount} onChange={(e)=>setAmount(e.target.value)}/></Field><Field label="Fecha"><input type="date" value={date} onChange={(e)=>setDate(e.target.value)}/></Field><Field label={target.kind==="payable"?"Cuenta de origen":"Cuenta de destino"}><DatalistInput value={destination} values={accounts} onChange={setDestination}/></Field></div><Field label="Observaciones"><textarea rows={3} value={note} onChange={(e)=>setNote(e.target.value)}/></Field>{error?<div className={styles.errorBox}>{error}</div>:null}<div className={styles.modalActions}><button className={styles.secondaryButton} onClick={onClose}>Cancelar</button><button className={styles.primaryButton} onClick={()=>void save()} disabled={saving}>{saving?"Registrando…":target.kind==="payable"?"Registrar pago":"Registrar recepción"}</button></div></Modal>;
}

function OptionsSection({ options, onChanged }: { options: AccountingOption[]; onChanged: () => void }) {
  const [category,setCategory]=useState<OptionCategory>("type"); const [label,setLabel]=useState(""); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  const visible=options.filter(i=>i.category===category).sort((a,b)=>a.sort_order-b.sort_order);
  const request=async(method:string,body:any)=>{setBusy(true);setError("");try{const headers=await authHeaders();const response=await fetch("/api/admin/accounting/options",{method,headers,body:JSON.stringify(body)});const json=await safeJson(response);if(!response.ok||!json.ok)throw new Error(json.error||"No se pudo guardar");onChanged();return true}catch(e:any){setError(e.message);return false}finally{setBusy(false)}};
  const add=async()=>{if(!label.trim())return;const ok=await request("POST",{category,label,direction:category==="movement"?"expense":undefined});if(ok)setLabel("")};
  const rename=async(item:AccountingOption)=>{const next=window.prompt("Nuevo nombre",item.label);if(!next||next===item.label)return;await request("PATCH",{id:item.id,label:next})};
  const move=async(item:AccountingOption,delta:number)=>{await request("PATCH",{id:item.id,sort_order:Number(item.sort_order||0)+delta})};
  const archive=async(item:AccountingOption)=>{if(!window.confirm(`¿Archivar “${item.label}”? Los movimientos históricos conservarán el nombre.`))return;await request("DELETE",{id:item.id})};
  const restore=async(item:AccountingOption)=>{await request("PATCH",{id:item.id,is_active:true})};
  return <section className={styles.settingsCard}><div className={styles.tableHead}><div><span className={styles.eyebrow}>CONFIGURACIÓN</span><h3>Categorías, métodos, negocios y cuentas</h3><p>Renombrar o archivar no altera los movimientos históricos.</p></div></div><div className={styles.settingsToolbar}><select value={category} onChange={(e)=>setCategory(e.target.value as OptionCategory)}><option value="type">Categorías</option><option value="payment_method">Métodos / proveedores</option><option value="business">Negocios</option><option value="origin">Cuentas de origen</option><option value="destination">Cuentas de destino</option></select><input value={label} onChange={(e)=>setLabel(e.target.value)} placeholder="Nueva opción"/><button className={styles.primaryButton} onClick={()=>void add()} disabled={busy}><Plus size={15}/> Añadir</button></div>{error?<div className={styles.errorBox}>{error}</div>:null}<div className={styles.optionList}>{visible.map((item)=><div key={item.id} className={`${styles.optionRow} ${!item.is_active?styles.optionArchived:""}`}><div><b>{item.label}</b><small>{item.is_active?"Activa":"Archivada"} · orden {item.sort_order}</small></div><div className={styles.rowActions}>{item.is_active?<><button onClick={()=>void move(item,-10)} title="Subir">↑</button><button onClick={()=>void move(item,10)} title="Bajar">↓</button><button onClick={()=>void rename(item)} title="Renombrar"><Pencil size={14}/></button><button onClick={()=>void archive(item)} title="Archivar"><Archive size={14}/></button></>:<button className={styles.textAction} onClick={()=>void restore(item)}>Restaurar</button>}</div></div>)}</div></section>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className={styles.field}><span>{label}</span>{children}</label>; }
function DatalistInput({ value, values, onChange }: { value: string; values: string[]; onChange: (value: string) => void }) { const id=useId(); return <><input list={id} value={value} onChange={(e)=>onChange(e.target.value)}/><datalist id={id}>{values.map(v=><option key={v} value={v}/>)}</datalist></>; }
function Modal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: ReactNode }) { return <div className={styles.modalBackdrop} onMouseDown={(e)=>{if(e.target===e.currentTarget)onClose()}}><div className={styles.modal} role="dialog" aria-modal="true"><div className={styles.modalHeader}><div><span className={styles.eyebrow}>CENTRO ECONÓMICO</span><h3>{title}</h3><p>{subtitle}</p></div><button className={styles.closeButton} onClick={onClose}><X size={18}/></button></div><div className={styles.modalBody}>{children}</div></div></div>; }
