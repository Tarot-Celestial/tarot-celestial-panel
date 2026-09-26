"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import FinancialIntelligence from "@/components/accounting/FinancialIntelligence";
import { accountingBalanceEffects, applyAccountingEffects, isExtraCashAccount } from "@/lib/accountingMetrics";
import {
  CalendarDays,
  ArrowRightLeft,
  Bell,
  MoreHorizontal,
  ChevronDown,
  ChevronUp,
  Download,
  Filter,
  LockKeyhole,
  Plus,
  ReceiptText,
  ShieldCheck,
  Trash2,
  Vault,
  X,
} from "lucide-react";

type MovementType = "ingreso" | "gasto" | "traspaso";
type BalanceMap = Record<string, number>;
type OptionCategory = "business" | "origin" | "destination" | "channel" | "category";

type ConfigOption = {
  id: string;
  category: OptionCategory;
  label: string;
  active: boolean;
};

type ApiConfigOption = {
  id: string;
  category: string;
  value: string;
  active: boolean;
};

type AccountingEntry = {
  id: string;
  type: MovementType;
  date: string;
  business: string;
  channel: string;
  category: string;
  amount: number;
  note: string;
  originAccount: string;
  destinationAccount: string;
  createdAt?: string;
};

type ApiEntry = {
  id: string;
  movement_type: string;
  movement_date: string;
  business: string;
  channel: string;
  category: string;
  amount: number | string;
  note: string | null;
  origin_account?: string | null;
  destination_account?: string | null;
  created_at?: string;
};

type Filters = {
  date: string;
  business: string;
  origin: string;
  destination: string;
  channel: string;
  category: string;
  movement: string;
};

type CashRow = { entry: AccountingEntry; cashIn: number; cashOut: number; balance: number };
type AuditEvent = { id: number; movement_id: string; action: "INSERT" | "UPDATE" | "DELETE"; occurred_at: string; actor_user_id: string | null; database_role: string; source: string; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null };

const ACCESS_PASSWORD = "Nosotrostarot1.";
const defaultOptions: Record<OptionCategory, Array<{ label: string }>> = {
  business: [{ label: "Flowly" }, { label: "Celestial" }, { label: "Leonaris" }],
  origin: [{ label: "Banco" }, { label: "Caja extra" }],
  destination: [{ label: "Banco" }, { label: "Caja extra" }],
  channel: [{ label: "Square" }, { label: "Transferencia" }, { label: "Bizum" }, { label: "Tarjeta" }, { label: "Stripe" }, { label: "PayPal" }, { label: "Otro" }],
  category: [{ label: "recarga" }, { label: "facebook" }, { label: "pago tarotista" }, { label: "Deuda" }, { label: "Pago Centrales" }, { label: "Pago premium numbers" }, { label: "pago hubspot" }, { label: "otros" }, { label: "call400" }, { label: "Flowly" }],
};
const categoryLabels: Record<OptionCategory, string> = {
  business: "Negocio",
  origin: "Origen del dinero",
  destination: "Destino del dinero",
  channel: "Por dónde se paga",
  category: "Tipo",
};
const emptyFilters: Filters = { date: "", business: "", origin: "", destination: "", channel: "", category: "", movement: "" };

function euro(value: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(value || 0);
}
function today() { return new Date().toISOString().slice(0, 10); }
function currentMonth() { return new Date().toISOString().slice(0, 7); }
function apiCategory(category: OptionCategory) {
  return ({ business: "business", origin: "money_origin", destination: "money_destination", channel: "payment_method", category: "movement_type" } as const)[category];
}
function uiCategory(category: string): OptionCategory | null {
  return ({ business: "business", money_origin: "origin", money_destination: "destination", payment_method: "channel", movement_type: "category" } as Record<string, OptionCategory>)[category] || null;
}
function mapConfigOption(option: ApiConfigOption): ConfigOption | null {
  const category = uiCategory(option.category);
  return category ? { id: option.id, category, label: option.value, active: option.active } : null;
}
function optionValues(options: ConfigOption[], category: OptionCategory) {
  return options.filter((item) => item.category === category && item.active).map((item) => item.label);
}
function mergeHistoric(active: string[], historic: string[]) {
  return Array.from(new Set([...active, ...historic.filter(Boolean)]));
}
function mapEntry(entry: ApiEntry): AccountingEntry {
  return {
    id: entry.id,
    type: entry.movement_type.toLowerCase() === "traspaso" ? "traspaso" : entry.movement_type.toLowerCase() === "gasto" ? "gasto" : "ingreso",
    date: entry.movement_date,
    business: entry.business,
    channel: entry.channel,
    category: entry.category,
    amount: Number(entry.amount) || 0,
    note: entry.note || "",
    originAccount: entry.origin_account || "Banco",
    destinationAccount: entry.destination_account || "Banco",
    createdAt: entry.created_at,
  };
}
function classifyAccountingEntry(entry: AccountingEntry) {
  const effect = accountingBalanceEffects(entry, [entry.business]);
  return { income: effect.income, expenses: effect.expenses, mainBalanceDelta: Object.values(effect.main).reduce((sum, value) => sum + value, 0) };
}

function calculateTotals(entries: AccountingEntry[]) {
  return entries.reduce(
    (totals, entry) => {
      const effect = classifyAccountingEntry(entry);
      totals.income += effect.income;
      totals.expenses += effect.expenses;
      totals.balance += effect.mainBalanceDelta;
      return totals;
    },
    { income: 0, expenses: 0, balance: 0 },
  );
}
function calculateCashRows(entries: AccountingEntry[], openingBalance = 0) {
  const rows = entries.filter((entry) => isExtraCashAccount(entry.originAccount) || isExtraCashAccount(entry.destinationAccount)).slice().sort((a, b) => `${a.date}-${a.createdAt || ""}`.localeCompare(`${b.date}-${b.createdAt || ""}`));
  let balance = openingBalance;
  return rows.map((entry) => {
    const cashIn = isExtraCashAccount(entry.destinationAccount) ? entry.amount : 0;
    const cashOut = isExtraCashAccount(entry.originAccount) ? entry.amount : 0;
    balance += cashIn - cashOut;
    return { entry, cashIn, cashOut, balance };
  });
}
function fallbackConfigOptions(): ConfigOption[] {
  return (Object.keys(defaultOptions) as OptionCategory[]).flatMap((category) => defaultOptions[category].map((item, index) => ({
    id: `fallback-${category}-${index}`,
    category,
    label: item.label,
    active: true,
  })));
}

export default function ContabilidadClient() {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [configOptions, setConfigOptions] = useState<ConfigOption[]>(fallbackConfigOptions());
  const [type, setType] = useState<MovementType>("ingreso");
  const [date, setDate] = useState(today());
  const [month, setMonth] = useState(currentMonth());
  const [business, setBusiness] = useState("Flowly");
  const [originAccount, setOriginAccount] = useState("Banco");
  const [destinationAccount, setDestinationAccount] = useState("Banco");
  const [channel, setChannel] = useState("Square");
  const [category, setCategory] = useState("recarga");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [entries, setEntries] = useState<AccountingEntry[]>([]);
  const [analyticsEntries, setAnalyticsEntries] = useState<AccountingEntry[]>([]);
  const [openingBalances, setOpeningBalances] = useState<BalanceMap>({});
  const [openingCashBalances, setOpeningCashBalances] = useState<BalanceMap>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [addCategory, setAddCategory] = useState<OptionCategory | null>(null);
  const [confirmingTransfer, setConfirmingTransfer] = useState<number | null>(null);
  const [editingEntry, setEditingEntry] = useState<AccountingEntry | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditReady, setAuditReady] = useState(true);
  const [toast, setToast] = useState<{ message: string; tone: "emerald" | "rose" | "violet" } | null>(null);
  const lastAuditId = useRef<number | null>(null);

  const showToast = useCallback((message: string, tone: "emerald" | "rose" | "violet") => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 4500);
  }, []);

  const loadAudit = useCallback(async (notify = false) => {
    setAuditLoading(true);
    try {
      const response = await fetch("/api/contabilidad/auditoria?limit=300", { cache: "no-store", headers: { "x-contabilidad-password": ACCESS_PASSWORD } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "No se pudo cargar la comparación.");
      const nextEvents = (payload.events || []) as AuditEvent[];
      if (notify && lastAuditId.current != null && nextEvents[0]?.id > lastAuditId.current) {
        const latest = nextEvents[0];
        const data = (latest.action === "DELETE" ? latest.old_data : latest.new_data) || {};
        showToast(`${latest.action === "DELETE" ? "Movimiento eliminado" : latest.action === "UPDATE" ? "Movimiento modificado" : String(data.movement_type || "Movimiento") + " registrado"} · ${euro(Number(data.amount) || 0)}`, latest.action === "DELETE" ? "rose" : String(data.movement_type).toLowerCase() === "traspaso" ? "violet" : "emerald");
      }
      if (nextEvents[0]?.id) lastAuditId.current = nextEvents[0].id;
      setAuditEvents(nextEvents); setAuditReady(payload.auditReady !== false);
    } catch (error) { setFormError(error instanceof Error ? error.message : "No se pudo cargar la comparación."); }
    finally { setAuditLoading(false); }
  }, [showToast]);

  const openAudit = useCallback(async () => { setAuditOpen(true); await loadAudit(false); }, [loadAudit]);

  useEffect(() => {
    if (!unlocked) return;
    void loadAudit(false);
    const timer = window.setInterval(() => void loadAudit(true), 15000);
    return () => window.clearInterval(timer);
  }, [loadAudit, unlocked]);

  const businessOptions = optionValues(configOptions, "business");
  const originOptions = optionValues(configOptions, "origin");
  const destinationOptions = optionValues(configOptions, "destination");
  const channelOptions = optionValues(configOptions, "channel");
  const categoryOptions = optionValues(configOptions, "category");

  const filterAccounts = useMemo(() => mergeHistoric(mergeHistoric(originOptions, destinationOptions), entries.flatMap((entry) => [entry.originAccount, entry.destinationAccount])), [originOptions, destinationOptions, entries]);
  const filterChannels = useMemo(() => mergeHistoric(channelOptions, entries.map((entry) => entry.channel)), [channelOptions, entries]);
  const filterCategories = useMemo(() => mergeHistoric(categoryOptions, entries.map((entry) => entry.category)), [categoryOptions, entries]);
  const filterMovements = useMemo(() => mergeHistoric(["ingreso", "gasto", "traspaso"], entries.map((entry) => entry.type)), [entries]);

  const monthlyTotals = useMemo(() => calculateTotals(entries), [entries]);
  const allBusinessNames = useMemo(() => mergeHistoric(businessOptions, [...Object.keys(openingBalances), ...Object.keys(openingCashBalances), ...entries.map((entry) => entry.business)]), [businessOptions, entries, openingBalances, openingCashBalances]);
  const totalOpening = useMemo(() => allBusinessNames.reduce((sum, name) => sum + (openingBalances[name] || 0), 0), [allBusinessNames, openingBalances]);
  const totalOpeningCash = useMemo(() => allBusinessNames.reduce((sum, name) => sum + (openingCashBalances[name] || 0), 0), [allBusinessNames, openingCashBalances]);
  const allCashRows = useMemo(() => calculateCashRows(entries, totalOpeningCash), [entries, totalOpeningCash]);
  const totalCashMovement = useMemo(() => {
    const incoming = allCashRows.reduce((sum, row) => sum + row.cashIn, 0);
    const outgoing = allCashRows.reduce((sum, row) => sum + row.cashOut, 0);
    return { final: totalOpeningCash + incoming - outgoing };
  }, [allCashRows, totalOpeningCash]);
  const currentBalances = useMemo(() => applyAccountingEffects(entries, allBusinessNames, openingBalances, openingCashBalances), [allBusinessNames, entries, openingBalances, openingCashBalances]);
  const entriesByBusiness = useMemo(() => allBusinessNames.map((name) => {
    const businessEntries = entries.filter((entry) => entry.business === name || (entry.type === "traspaso" && (entry.originAccount === name || entry.destinationAccount === name)));
    const totals = businessEntries.reduce((result, entry) => {
      const effect = accountingBalanceEffects(entry, allBusinessNames);
      result.income += entry.business === name ? effect.income : 0;
      result.expenses += entry.business === name ? effect.expenses : 0;
      result.balance += effect.main[name] || 0;
      return result;
    }, { income: 0, expenses: 0, balance: 0 });
    const cashEntries = entries.filter((entry) => Boolean(accountingBalanceEffects(entry, allBusinessNames).cash[name]));
    const cashRows = calculateCashRows(cashEntries, openingCashBalances[name] || 0);
    const cashIn = cashRows.reduce((sum, row) => sum + row.cashIn, 0);
    const cashOut = cashRows.reduce((sum, row) => sum + row.cashOut, 0);
    return { business: name, entries: businessEntries, totals, opening: openingBalances[name] || 0, final: currentBalances.main[name] || 0, cashRows, cashIn, cashOut, cashFinal: currentBalances.cash[name] || 0 };
  }), [allBusinessNames, currentBalances, entries, openingBalances, openingCashBalances]);

  async function loadOptions() {
    const response = await fetch("/api/contabilidad/opciones", { cache: "no-store", headers: { "x-contabilidad-password": ACCESS_PASSWORD } });
    const payload = await response.json();
    if (!response.ok) return;
    const stored = ((payload.options || []) as ApiConfigOption[]).map(mapConfigOption).filter((item): item is ConfigOption => Boolean(item));
    const defaults = fallbackConfigOptions();
    const merged = defaults.map((item) => stored.find((saved) => saved.category === item.category && saved.label.toLocaleLowerCase("es") === item.label.toLocaleLowerCase("es")) || item);
    for (const item of stored) {
      if (!merged.some((current) => current.category === item.category && current.label.toLocaleLowerCase("es") === item.label.toLocaleLowerCase("es"))) merged.push(item);
    }
    setConfigOptions(merged);
  }

  useEffect(() => {
    if (!unlocked) return;
    loadOptions().catch(() => undefined);
  }, [unlocked]);

  const loadEntries = useCallback(async (silent = false) => {
      if (!unlocked) return;
      if (!silent) setLoading(true);
      setFormError("");
      try {
        const response = await fetch(`/api/contabilidad/movimientos?month=${encodeURIComponent(month)}`, { headers: { "x-contabilidad-password": ACCESS_PASSWORD } });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || "No se pudieron cargar los movimientos.");
        setEntries((payload.entries || []).map(mapEntry));
        setAnalyticsEntries((payload.analyticsEntries || payload.entries || []).map(mapEntry));
        setOpeningBalances(payload.openingBalances || {});
        setOpeningCashBalances(payload.openingCashBalances || {});
      } catch (error) {
        if (!silent) setFormError(error instanceof Error ? error.message : "No se pudieron cargar los movimientos.");
      } finally {
        if (!silent) setLoading(false);
      }
  }, [month, unlocked]);

  useEffect(() => { void loadEntries(); }, [loadEntries]);

  useEffect(() => {
    if (!unlocked) return;
    const timer = window.setInterval(() => void loadEntries(true), 30000);
    const onVisible = () => { if (document.visibilityState === "visible") void loadEntries(true); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [loadEntries, unlocked]);

  useEffect(() => {
    if (!businessOptions.includes(business) && businessOptions[0]) setBusiness(businessOptions[0]);
    if (!originOptions.includes(originAccount) && originOptions[0]) setOriginAccount(originOptions[0]);
    if (!destinationOptions.includes(destinationAccount) && destinationOptions[0]) setDestinationAccount(destinationOptions[0]);
    if (!channelOptions.includes(channel) && channelOptions[0]) setChannel(channelOptions[0]);
    if (!categoryOptions.includes(category) && categoryOptions[0]) setCategory(categoryOptions[0]);
  }, [configOptions]);

  const handleAccess = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.trim() === ACCESS_PASSWORD) { setUnlocked(true); setAccessError(""); }
    else setAccessError("Contraseña incorrecta.");
  };

  const handleDelete = async (entry: AccountingEntry) => {
    if (!window.confirm(`¿Seguro que deseas eliminar este movimiento de ${euro(entry.amount)}? Esta acción no se puede deshacer.`)) return;
    setDeletingId(entry.id);
    setFormError("");
    try {
      const response = await fetch(`/api/contabilidad/movimientos?id=${encodeURIComponent(entry.id)}`, { method: "DELETE", headers: { "x-contabilidad-password": ACCESS_PASSWORD } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "No se pudo eliminar el movimiento.");
      await loadEntries(true);
      showToast(`${entry.type === "traspaso" ? "Traspaso" : "Movimiento"} eliminado · ${euro(entry.amount)}`, "rose");
    } catch (error) { setFormError(error instanceof Error ? error.message : "No se pudo eliminar el movimiento."); }
    finally { setDeletingId(null); }
  };

  const saveMovement = async (numericAmount: number) => {
    if (!date || !business || !type || !channel || !category || !originAccount || !destinationAccount || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setFormError("Completa los campos obligatorios y pon un importe válido.");
      return;
    }
    if (type === "traspaso" && originAccount.localeCompare(destinationAccount, "es", { sensitivity: "base" }) === 0) {
      setFormError("El origen y el destino del traspaso deben ser diferentes.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const response = await fetch("/api/contabilidad/movimientos", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-contabilidad-password": ACCESS_PASSWORD },
        body: JSON.stringify({ type, date, business, originAccount, destinationAccount, channel, category, amount: numericAmount, note: note.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "No se pudo guardar el movimiento.");
      const savedEntry = mapEntry(payload.entry);
      if (savedEntry.date.slice(0, 7) !== month) setMonth(savedEntry.date.slice(0, 7));
      else await loadEntries(true);
      setAmount("");
      setNote("");
      setConfirmingTransfer(null);
      showToast(`${savedEntry.type === "traspaso" ? "Traspaso realizado" : savedEntry.type === "ingreso" ? "Ingreso registrado" : "Gasto registrado"} · ${euro(savedEntry.amount)}`, savedEntry.type === "traspaso" ? "violet" : "emerald");
    } catch (error) { setFormError(error instanceof Error ? error.message : "No se pudo guardar el movimiento."); }
    finally { setSaving(false); }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const numericAmount = Number(amount.replace(",", "."));
    if (type === "traspaso") {
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) return setFormError("Introduce un importe válido para el traspaso.");
      if (originAccount.localeCompare(destinationAccount, "es", { sensitivity: "base" }) === 0) return setFormError("El origen y el destino del traspaso deben ser diferentes.");
      setFormError("");
      setConfirmingTransfer(numericAmount);
      return;
    }
    void saveMovement(numericAmount);
  };

  if (!unlocked) return (
    <main className="flowly-app-shell min-h-screen px-6 py-10 text-white"><section className="mx-auto flex min-h-[78vh] max-w-xl items-center justify-center"><form onSubmit={handleAccess} className="flowly-client-card w-full rounded-[2rem] border border-white/10 bg-white/[0.04] p-8 shadow-2xl shadow-purple-950/30 backdrop-blur"><div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-400/15 text-cyan-200"><LockKeyhole size={26} /></div><p className="text-xs font-black uppercase tracking-[0.32em] text-cyan-200/70">Área privada</p><h1 className="mt-3 text-3xl font-black tracking-tight">Contabilidad mensual</h1><p className="mt-3 text-sm leading-6 text-slate-300">Introduce la contraseña para acceder al panel de ingresos, gastos y cajas independientes.</p><div className="mt-8 space-y-3"><label className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Contraseña</label><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-4 text-white outline-none transition focus:border-cyan-300/70" placeholder="••••••••••••" />{accessError ? <p className="text-sm font-semibold text-rose-300">{accessError}</p> : null}</div><button type="submit" className="mt-6 w-full rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950 transition hover:bg-cyan-200">Entrar</button></form></section></main>
  );

  const selectProps = (categoryName: OptionCategory, value: string, setValue: (value: string) => void, options: string[]) => ({ category: categoryName, value, options, onChange: setValue, onAdd: () => setAddCategory(categoryName) });

  return (
    <main className="flowly-app-shell min-h-screen overflow-x-hidden px-5 py-8 text-white sm:px-8">
      <section className="mx-auto max-w-[1600px] space-y-6">
        <header className="flowly-client-hero overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-cyan-400/12 via-purple-500/10 to-black p-6 shadow-2xl shadow-cyan-950/20 sm:p-8"><div className="flex flex-col gap-6 2xl:flex-row 2xl:items-end 2xl:justify-between"><div className="shrink-0"><p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.32em] text-cyan-200/75"><ShieldCheck size={16} /> Privado</p><h1 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">Contabilidad mensual</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">Los saldos anteriores se arrastran automáticamente y cada negocio conserva su propia caja extra.</p></div><div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:max-w-[900px] 2xl:grid-cols-5"><StatCard label="Saldo anterior" value={euro(totalOpening)} tone="purple" /><StatCard label="Ingresos del mes" value={euro(monthlyTotals.income)} tone="emerald" /><StatCard label="Gastos del mes" value={euro(monthlyTotals.expenses)} tone="rose" /><StatCard label="Saldo actual" value={euro(totalOpening + monthlyTotals.balance)} tone="cyan" /><StatCard label="Cajas extra" value={euro(totalCashMovement.final)} tone="amber" /></div></div></header>

        <FinancialIntelligence entries={analyticsEntries} month={month} businesses={allBusinessNames} channels={filterChannels} categories={filterCategories} loading={loading} onOpenComparison={() => void openAudit()} />

        <form onSubmit={handleSubmit} className="flowly-client-card rounded-[2rem] border border-white/10 bg-white/[0.04] p-4 shadow-2xl shadow-purple-950/10 backdrop-blur sm:p-5">
          <div className="mb-4 flex flex-col gap-4 px-1 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-300/15 text-cyan-100"><Plus size={20} /></div><div><h2 className="font-black">Nuevo movimiento</h2><p className="text-xs text-slate-400">Añade o administra las opciones desde cada desplegable.</p></div></div><Field label="Mes visible"><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="min-h-[46px] rounded-2xl border border-white/10 bg-black/30 px-4 text-white outline-none transition focus:border-cyan-300/70" /></Field></div>
          <div className="space-y-3">
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Field label="Movimiento"><select value={type} onChange={(event) => setType(event.target.value as MovementType)} className="field-control"><option value="ingreso">Ingreso</option><option value="gasto">Gasto</option><option value="traspaso">Traspaso</option></select></Field>
              <Field label="Fecha"><div className="relative"><CalendarDays className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="field-control pl-10" /></div></Field>
              <Field label="Negocio"><ConfigurableSelect {...selectProps("business", business, setBusiness, businessOptions)} /></Field>
              <Field label="Origen del dinero"><ConfigurableSelect {...selectProps("origin", originAccount, setOriginAccount, type === "traspaso" ? mergeHistoric(originOptions, businessOptions) : originOptions)} /></Field>
              <Field label="Destino del dinero"><ConfigurableSelect {...selectProps("destination", destinationAccount, setDestinationAccount, type === "traspaso" ? mergeHistoric(destinationOptions, businessOptions) : destinationOptions)} /></Field>
            </div>
            {type === "traspaso" ? <div className="flex flex-col gap-3 rounded-2xl border border-violet-300/20 bg-violet-300/[0.07] px-4 py-3 sm:flex-row sm:items-center sm:justify-between" role="status"><div className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-300/15 text-violet-200"><ArrowRightLeft size={18} aria-hidden="true" /></span><div><p className="text-xs font-black uppercase tracking-[0.14em] text-violet-200">Traspaso interno</p><p className="text-sm text-slate-300"><strong>{originAccount || "Selecciona origen"}</strong> <span aria-hidden="true">→</span> <strong>{destinationAccount || "Selecciona destino"}</strong></p></div></div><p className="max-w-xl text-xs leading-5 text-slate-400">Resta saldo al origen y lo suma al destino. No modifica ingresos ni gastos. Medio y tipo se conservan únicamente como referencia.</p></div> : null}
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-[1.15fr_1fr_0.8fr_1.5fr_auto]">
              <Field label={type === "ingreso" ? "Por dónde se ingresa" : "Por dónde se paga"}><ConfigurableSelect {...selectProps("channel", channel, setChannel, channelOptions)} /></Field>
              <Field label="Tipo"><ConfigurableSelect {...selectProps("category", category, setCategory, categoryOptions)} /></Field>
              <Field label="Importe"><input type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className="field-control" placeholder="0,00 €" /></Field>
              <Field label="Observación"><input value={note} onChange={(event) => setNote(event.target.value)} className="field-control" placeholder="Opcional" /></Field>
              <div className="flex min-w-0 items-end"><button type="submit" disabled={saving} className="h-[50px] w-full whitespace-nowrap rounded-2xl bg-cyan-300 px-6 font-black text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60 xl:w-auto">{saving ? "Guardando" : "Añadir"}</button></div>
            </div>
          </div>
          {formError ? <p role="alert" className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm font-semibold text-rose-200">{formError}</p> : null}
        </form>

        <section className="flowly-client-card rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-purple-950/10 backdrop-blur"><MovementTableWithFilters entries={entries} month={month} showSummaryReport options={{ businesses: allBusinessNames, accounts: filterAccounts, channels: filterChannels, categories: filterCategories, movements: filterMovements }} emptyText="No hay movimientos en este mes." onEdit={setEditingEntry} onDelete={handleDelete} deletingId={deletingId} loading={loading} /></section>

        <section className="grid gap-5 xl:grid-cols-3">
          {entriesByBusiness.map((group) => <div key={group.business} className="flowly-client-card rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-purple-950/10 backdrop-blur"><div className="mb-4 flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-200/70">Negocio</p><h3 className="mt-1 text-2xl font-black">{group.business}</h3></div><span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-bold text-slate-300">{group.entries.length} líneas</span></div><div className="mb-4 grid grid-cols-2 gap-3"><MiniStat label="Saldo anterior" value={euro(group.opening)} tone="purple" /><MiniStat label="Ingresos" value={euro(group.totals.income)} tone="emerald" /><MiniStat label="Gastos" value={euro(group.totals.expenses)} tone="rose" /><MiniStat label="Saldo actual" value={euro(group.final)} tone="cyan" /><MiniStat label="Caja extra" value={euro(group.cashFinal)} tone="amber" /></div><MovementTableWithFilters entries={group.entries} compact options={{ businesses: allBusinessNames, accounts: filterAccounts, channels: filterChannels, categories: filterCategories, movements: filterMovements }} emptyText={`Sin movimientos para ${group.business}.`} onEdit={setEditingEntry} onDelete={handleDelete} deletingId={deletingId} /><div className="mt-5 rounded-3xl border border-amber-300/20 bg-amber-300/[0.06] p-4"><CashHeader business={group.business} cashIn={group.cashIn} cashOut={group.cashOut} balance={group.cashFinal} /><CashTable rows={group.cashRows} onEdit={setEditingEntry} onDelete={handleDelete} deletingId={deletingId} /></div></div>)}
        </section>
      </section>

      {addCategory ? <OptionEditorModal category={addCategory} title={`Añadir opción · ${categoryLabels[addCategory]}`} onClose={() => setAddCategory(null)} onSaved={async (saved) => { await loadOptions(); setAddCategory(null); if (saved.category === "business") setBusiness(saved.label); if (saved.category === "origin") setOriginAccount(saved.label); if (saved.category === "destination") setDestinationAccount(saved.label); if (saved.category === "channel") setChannel(saved.label); if (saved.category === "category") setCategory(saved.label); }} setError={setFormError} /> : null}
      {confirmingTransfer != null ? <TransferConfirmation amount={confirmingTransfer} origin={originAccount} destination={destinationAccount} business={business} businessNames={allBusinessNames} balances={currentBalances} onClose={() => setConfirmingTransfer(null)} onConfirm={() => void saveMovement(confirmingTransfer)} saving={saving} /> : null}
      {editingEntry ? <EditAmountDialog entry={editingEntry} onClose={() => setEditingEntry(null)} onSaved={async (saved) => {
        setEntries((current) => current.map((entry) => entry.id === saved.id ? saved : entry));
        setAnalyticsEntries((current) => current.map((entry) => entry.id === saved.id ? saved : entry));
        setEditingEntry(null);
        showToast(`Importe corregido: ${euro(editingEntry.amount)} → ${euro(saved.amount)}`, "emerald");
        await Promise.all([loadEntries(true), loadAudit(false)]);
      }} /> : null}
      {auditOpen ? <AuditModal events={auditEvents} loading={auditLoading} ready={auditReady} onClose={() => setAuditOpen(false)} onRefresh={() => void loadAudit(false)} /> : null}
      {toast ? <div role="status" aria-live="polite" className={`fixed bottom-5 right-5 z-[120] flex max-w-sm items-center gap-3 rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur ${toast.tone === "rose" ? "border-rose-300/30 bg-rose-950/90 text-rose-100" : toast.tone === "violet" ? "border-violet-300/30 bg-violet-950/90 text-violet-100" : "border-emerald-300/30 bg-emerald-950/90 text-emerald-100"}`}><Bell size={18} aria-hidden="true" /><span className="text-sm font-bold">{toast.message}</span></div> : null}
    </main>
  );
}

function EditAmountButton({ entry, onEdit, disabled }: { entry: AccountingEntry; onEdit: (entry: AccountingEntry) => void; disabled: boolean }) {
  return <button type="button" onClick={() => onEdit(entry)} disabled={disabled} aria-label={`Editar importe de ${entry.type}: ${euro(entry.amount)}`} aria-haspopup="dialog" title="Editar importe" className="mr-2 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 disabled:opacity-50"><MoreHorizontal size={20} aria-hidden="true" /></button>;
}

function EditAmountDialog({ entry, onClose, onSaved }: { entry: AccountingEntry; onClose: () => void; onSaved: (entry: AccountingEntry) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const [value, setValue] = useState(entry.amount.toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    input.current?.select();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const text = value.trim().replace(",", ".");
    const amount = Number(text);
    if (!/^\d+(?:\.\d{1,2})?$/.test(text) || !Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(Math.round(amount * 100))) {
      setError("Introduce un importe mayor que cero, con un máximo de dos decimales."); return;
    }
    if (amount === entry.amount) { onClose(); return; }
    pending.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/contabilidad/movimientos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-contabilidad-password": ACCESS_PASSWORD },
        body: JSON.stringify({ id: entry.id, amount: text, previousAmount: entry.amount }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "No se pudo guardar el importe.");
      await onSaved(mapEntry(payload.entry));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "No se pudo guardar el importe.");
    } finally { pending.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} aria-labelledby="edit-amount-title" aria-describedby="edit-amount-description" onCancel={(event) => { event.preventDefault(); if (!pending.current) onClose(); }} className="m-auto w-[calc(100%-2rem)] max-w-md rounded-3xl border border-cyan-300/20 bg-slate-950 p-5 text-white shadow-2xl backdrop:bg-slate-950/80">
    <form onSubmit={save} className="space-y-4" aria-busy={busy}>
      <h2 id="edit-amount-title" className="text-xl font-black">Editar importe</h2>
      <p id="edit-amount-description" className="text-sm text-slate-300">{entry.business} · {entry.date} · {entry.channel}<br />Importe actual: <strong>{euro(entry.amount)}</strong><br />Se sustituirá este importe, sin añadir otro movimiento.</p>
      <label className="block space-y-2 text-sm font-bold" htmlFor="edit-movement-amount">Nuevo importe (€)<input id="edit-movement-amount" ref={input} value={value} onChange={(event) => setValue(event.target.value)} type="text" inputMode="decimal" autoComplete="off" disabled={busy} aria-invalid={Boolean(error)} aria-describedby={error ? "edit-amount-error" : undefined} className="field-control w-full" /></label>
      {error ? <p id="edit-amount-error" role="alert" className="text-sm text-rose-200">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-3"><button type="button" disabled={busy} onClick={onClose} className="rounded-xl border border-white/20 px-4 py-3 text-sm font-bold disabled:opacity-50">Cancelar</button><button type="submit" disabled={busy} className="rounded-xl bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-50">{busy ? "Guardando…" : "Guardar importe"}</button></div>
    </form>
  </dialog>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="min-w-0 space-y-1.5"><span className="block text-[10px] font-black uppercase tracking-[0.14em] text-slate-400 [overflow-wrap:normal] [word-break:normal]">{label}</span>{children}</label>; }
function ConfigurableSelect({ category, value, options, onChange, onAdd }: { category: OptionCategory; value: string; options: string[]; onChange: (value: string) => void; onAdd: () => void }) {
  return <select value={value} onChange={(event) => { if (event.target.value === "__add__") onAdd(); else onChange(event.target.value); }} className="field-control min-w-0 w-full"><option value="" disabled>Selecciona</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}<option value="__add__">➕ Añadir nueva opción</option></select>;
}
function OptionEditorModal({ category, title, initial, onClose, onSaved, setError }: { category: OptionCategory; title: string; initial?: ConfigOption; onClose: () => void; onSaved: (option: ConfigOption) => void | Promise<void>; setError: (error: string) => void }) {
  const [label, setLabel] = useState(initial?.label || "");
  const [saving, setSaving] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch("/api/contabilidad/opciones", { method: initial ? "PATCH" : "POST", headers: { "Content-Type": "application/json", "x-contabilidad-password": ACCESS_PASSWORD }, body: JSON.stringify({ id: initial?.id, category: apiCategory(category), value: label.trim() }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "No se pudo guardar la opción.");
      const saved = mapConfigOption(payload.option as ApiConfigOption);
      if (!saved) throw new Error("La categoría recibida no es válida.");
      await onSaved(saved);
    } catch (error) { setError(error instanceof Error ? error.message : "No se pudo guardar la opción."); }
    finally { setSaving(false); }
  }
  return <Modal title={title} onClose={onClose}><form onSubmit={save} className="space-y-4"><Field label="Nombre de la opción"><input autoFocus value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} className="field-control" placeholder="Escribe el nuevo valor" /></Field><div className="flex justify-end gap-3 pt-2"><button type="button" onClick={onClose} className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-bold text-slate-300">Cancelar</button><button type="submit" disabled={saving || !label.trim()} className="rounded-2xl bg-cyan-300 px-5 py-3 text-sm font-black text-slate-950 disabled:opacity-50">{saving ? "Guardando" : "Guardar"}</button></div></form></Modal>;
}
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) { return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"><div className="w-full max-w-lg rounded-[2rem] border border-white/10 bg-slate-950 p-5 shadow-2xl shadow-black/60"><div className="mb-5 flex items-center justify-between"><h3 className="text-lg font-black text-white">{title}</h3><button type="button" onClick={onClose} className="rounded-xl border border-white/10 p-2 text-slate-400 hover:text-white"><X size={18} /></button></div>{children}</div></div>; }
function AuditModal({ events, loading, ready, onClose, onRefresh }: { events: AuditEvent[]; loading: boolean; ready: boolean; onClose: () => void; onRefresh: () => void }) {
  const [filter, setFilter] = useState<"ALL" | AuditEvent["action"]>("ALL");
  const visible = filter === "ALL" ? events : events.filter((event) => event.action === filter);
  const labels = { INSERT: "Añadido", UPDATE: "Modificado", DELETE: "Eliminado" } as const;
  return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/85 p-3 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-labelledby="audit-title" className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-[2rem] border border-violet-300/20 bg-slate-950 p-4 shadow-2xl sm:p-6"><header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-black uppercase tracking-[.18em] text-violet-200">Auditoría protegida</p><h2 id="audit-title" className="mt-1 text-2xl font-black">Comparación e historial</h2><p className="mt-1 text-xs text-slate-400">Altas, cambios y eliminaciones conservadas por la base de datos.</p></div><div className="flex gap-2"><button type="button" onClick={onRefresh} className="rounded-xl border border-cyan-300/20 px-3 py-2 text-xs font-bold text-cyan-100">Actualizar</button><button type="button" onClick={onClose} aria-label="Cerrar historial" className="rounded-xl border border-white/10 p-2 text-slate-300"><X size={18}/></button></div></header><div className="mb-3 flex flex-wrap gap-2">{(["ALL","INSERT","UPDATE","DELETE"] as const).map((item)=><button type="button" key={item} onClick={()=>setFilter(item)} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${filter===item?"border-violet-300/40 bg-violet-300/15 text-violet-100":"border-white/10 text-slate-400"}`}>{item==="ALL"?"Todo":labels[item]}</button>)}</div>{!ready ? <div role="alert" className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">La auditoría todavía no está activa. Ejecuta el archivo SQL incluido en Supabase.</div> : <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-white/10"><table className="min-w-[900px] w-full text-left text-xs"><thead className="sticky top-0 bg-slate-900 text-slate-400"><tr><th className="p-3">Fecha y hora</th><th className="p-3">Acción</th><th className="p-3">Movimiento</th><th className="p-3">Negocio</th><th className="p-3">Importe</th><th className="p-3">Origen → destino</th><th className="p-3">Procedencia</th></tr></thead><tbody>{visible.map((event)=>{const data=(event.action==="DELETE"?event.old_data:event.new_data)||event.old_data||{}; return <tr key={event.id} className="border-t border-white/5"><td className="whitespace-nowrap p-3">{new Intl.DateTimeFormat("es-ES",{dateStyle:"short",timeStyle:"medium"}).format(new Date(event.occurred_at))}</td><td className={`p-3 font-black ${event.action==="DELETE"?"text-rose-200":event.action==="UPDATE"?"text-amber-200":"text-emerald-200"}`}>{labels[event.action]}</td><td className="p-3">{String(data.movement_type||"—")}</td><td className="p-3">{String(data.business||"—")}</td><td className="whitespace-nowrap p-3 font-bold">{euro(Number(data.amount)||0)}</td><td className="p-3">{String(data.origin_account||"—")} → {String(data.destination_account||"—")}</td><td className="p-3"><span className="block">{event.source}</span><span className="text-slate-500">Rol: {event.database_role}{event.actor_user_id?` · Usuario ${event.actor_user_id}`:""}</span></td></tr>})}{!loading&&!visible.length?<tr><td colSpan={7} className="p-8 text-center text-slate-400">No hay eventos registrados todavía.</td></tr>:null}</tbody></table>{loading?<p className="p-5 text-center text-slate-400">Cargando historial…</p>:null}</div>}</section></div>;
}
function TransferConfirmation({ amount, origin, destination, business, businessNames, balances, saving, onClose, onConfirm }: { amount: number; origin: string; destination: string; business: string; businessNames: string[]; balances: { main: BalanceMap; cash: BalanceMap }; saving: boolean; onClose: () => void; onConfirm: () => void }) {
  const previewEntry: AccountingEntry = { id: "preview", type: "traspaso", date: "", business, channel: "", category: "", amount, note: "", originAccount: origin, destinationAccount: destination };
  const effect = accountingBalanceEffects(previewEntry, businessNames);
  const owner = businessNames.find((name) => name === origin || name === destination) || business;
  const originBefore = isExtraCashAccount(origin) ? balances.cash[owner] || 0 : balances.main[origin] ?? balances.main[business] ?? 0;
  const destinationBefore = isExtraCashAccount(destination) ? balances.cash[owner] || 0 : balances.main[destination] ?? balances.main[business] ?? 0;
  const originDelta = isExtraCashAccount(origin) ? effect.cash[owner] || 0 : effect.main[origin] ?? effect.main[business] ?? 0;
  const destinationDelta = isExtraCashAccount(destination) ? effect.cash[owner] || 0 : effect.main[destination] ?? effect.main[business] ?? 0;
  return <Modal title="Confirmar traspaso" onClose={onClose}><div className="space-y-4"><p className="text-sm text-slate-300">Se moverán <strong className="text-white">{euro(amount)}</strong> sin alterar ingresos ni gastos.</p><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-2xl border border-rose-300/20 bg-rose-300/[0.07] p-4"><p className="text-xs font-black uppercase text-rose-200">Origen · {origin}</p><p className="mt-2 text-sm text-slate-400">{euro(originBefore)} → <strong className="text-white">{euro(originBefore + originDelta)}</strong></p></div><div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.07] p-4"><p className="text-xs font-black uppercase text-emerald-200">Destino · {destination}</p><p className="mt-2 text-sm text-slate-400">{euro(destinationBefore)} → <strong className="text-white">{euro(destinationBefore + destinationDelta)}</strong></p></div></div><div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} disabled={saving} className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-bold text-slate-300">Cancelar</button><button type="button" onClick={onConfirm} disabled={saving} className="rounded-2xl bg-cyan-300 px-5 py-3 text-sm font-black text-slate-950 disabled:opacity-50">{saving ? "Guardando" : "Confirmar traspaso"}</button></div></div></Modal>;
}
function StatCard({ label, value, tone }: { label: string; value: string; tone: "purple" | "emerald" | "rose" | "cyan" | "amber" }) { const tones = { purple: "text-purple-200/70", emerald: "text-emerald-200", rose: "text-rose-200", cyan: "text-cyan-200", amber: "text-amber-200" }; const subdued = tone === "purple"; return <div className={`min-w-0 rounded-2xl border p-4 ${subdued ? "border-white/[0.06] bg-black/15 opacity-75" : "border-white/10 bg-black/25"}`}><p className={`font-black uppercase text-slate-500 [overflow-wrap:normal] [word-break:normal] ${subdued ? "text-[8px] tracking-[0.12em]" : "text-[9px] tracking-[0.14em]"}`}>{label}</p><p className={`mt-1 whitespace-nowrap font-black ${subdued ? "text-sm" : "text-base"} ${tones[tone]}`}>{value}</p></div>; }
function MiniStat({ label, value, tone }: { label: string; value: string; tone: "purple" | "emerald" | "rose" | "cyan" | "amber" }) { return <StatCard label={label} value={value} tone={tone} />; }
type FilterOptions = { businesses: string[]; accounts: string[]; channels: string[]; categories: string[]; movements: string[] };

type FilterSummary = {
  count: number;
  income: number;
  expenses: number;
  balance: number;
  transferred: number;
};

function formatMonthLabel(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return month;
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(new Date(year, monthNumber - 1, 1));
}

function reportFilterRows(filters: Filters, month: string) {
  return [
    ["Periodo", filters.date || formatMonthLabel(month)],
    ["Negocio", filters.business || "Todos"],
    ["Origen", filters.origin || "Todos"],
    ["Destino", filters.destination || "Todos"],
    ["Medio", filters.channel || "Todos"],
    ["Tipo", filters.category || "Todos"],
    ["Movimiento", filters.movement ? filters.movement.charAt(0).toUpperCase() + filters.movement.slice(1) : "Todos"],
  ];
}

function escapeHtml(value: string | number) {
  return String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] || character);
}

function buildAccountingReportHtml(entries: AccountingEntry[], filters: Filters, month: string, summary: FilterSummary, generatedAt: string) {
  const filterHtml = reportFilterRows(filters, month).map(([label, value]) => `<div><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</div>`).join("");
  const rows = entries.map((entry) => `<tr><td>${escapeHtml(entry.type)}</td><td>${escapeHtml(entry.date)}</td><td>${escapeHtml(entry.business)}</td><td>${escapeHtml(entry.originAccount)}</td><td>${escapeHtml(entry.destinationAccount)}</td><td>${escapeHtml(entry.channel)}</td><td>${escapeHtml(entry.category)}</td><td class="amount">${entry.type === "gasto" ? "-" : entry.type === "ingreso" ? "+" : "↔ "}${escapeHtml(euro(entry.amount))}</td><td>${escapeHtml(entry.note || "—")}</td></tr>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe de contabilidad ${escapeHtml(month)}</title><style>body{font-family:Arial,sans-serif;color:#172033;margin:32px}h1{margin-bottom:4px}.subtitle{color:#64748b;margin-bottom:20px}.filters{background:#f1f5f9;border-radius:10px;padding:14px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-bottom:16px}.summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:18px}.card{border:1px solid #cbd5e1;border-radius:10px;padding:12px}.label{font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700}.value{font-size:18px;font-weight:800;margin-top:4px}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#e2e8f0;text-align:left;padding:9px}td{padding:9px;border-bottom:1px solid #e2e8f0;vertical-align:top}.amount{text-align:right;white-space:nowrap}.footer{margin-top:16px;color:#64748b;font-size:11px}@media print{body{margin:16px}.summary{grid-template-columns:repeat(3,minmax(0,1fr))}}</style></head><body><h1>Informe de movimientos filtrados</h1><div class="subtitle">Contabilidad mensual · ${escapeHtml(formatMonthLabel(month))}</div><section class="filters">${filterHtml}</section><section class="summary"><div class="card"><div class="label">Movimientos</div><div class="value">${summary.count}</div></div><div class="card"><div class="label">Ingresos</div><div class="value">${escapeHtml(euro(summary.income))}</div></div><div class="card"><div class="label">Gastos</div><div class="value">${escapeHtml(euro(summary.expenses))}</div></div><div class="card"><div class="label">Balance neto</div><div class="value">${escapeHtml(euro(summary.balance))}</div></div><div class="card"><div class="label">Total traspasado</div><div class="value">${escapeHtml(euro(summary.transferred))}</div></div></section><table><thead><tr><th>Movimiento</th><th>Fecha</th><th>Negocio</th><th>Origen</th><th>Destino</th><th>Medio</th><th>Tipo</th><th>Importe</th><th>Observación</th></tr></thead><tbody>${rows || '<tr><td colspan="9">No hay movimientos que coincidan con los filtros seleccionados.</td></tr>'}</tbody></table><div class="footer">Generado el ${escapeHtml(generatedAt)}</div></body></html>`;
}

function MovementTableWithFilters({ entries, options, emptyText, compact = false, onDelete, onEdit, deletingId, month = currentMonth(), showSummaryReport = false, loading = false }: { entries: AccountingEntry[]; options: FilterOptions; emptyText: string; compact?: boolean; onEdit: (entry: AccountingEntry) => void; onDelete: (entry: AccountingEntry) => void; deletingId: string | null; month?: string; showSummaryReport?: boolean; loading?: boolean }) {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [visibleCount, setVisibleCount] = useState(10);
  const [exporting, setExporting] = useState(false);
  const filtered = useMemo(() => entries.filter((entry) => (!filters.date || entry.date === filters.date) && (!filters.business || entry.business === filters.business || (entry.type === "traspaso" && (entry.originAccount === filters.business || entry.destinationAccount === filters.business))) && (!filters.origin || entry.originAccount === filters.origin) && (!filters.destination || entry.destinationAccount === filters.destination) && (!filters.channel || entry.channel === filters.channel) && (!filters.category || entry.category === filters.category) && (!filters.movement || entry.type === filters.movement)), [entries, filters]);
  const summary = useMemo<FilterSummary>(() => filtered.reduce((result, entry) => {
    const effect = classifyAccountingEntry(entry);
    result.income += effect.income;
    result.expenses += effect.expenses;
    if (entry.type === "traspaso") result.transferred += entry.amount;
    result.count += 1;
    result.balance = result.income - result.expenses;
    return result;
  }, { count: 0, income: 0, expenses: 0, balance: 0, transferred: 0 }), [filtered]);
  useEffect(() => { setVisibleCount(10); }, [filters, entries.length]);
  const activeFilters = Object.values(filters).filter(Boolean).length;
  async function downloadReport() {
    setExporting(true);
    try {
      const generatedAt = new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "medium" }).format(new Date());
      const html = buildAccountingReportHtml(filtered, filters, month, summary, generatedAt);
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `informe-contabilidad-${month}${filters.date ? `-${filters.date}` : ""}.html`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  }
  return <div>
    {showSummaryReport ? <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-purple-300/15 text-purple-100"><ReceiptText size={20} /></div><div><h2 className="font-black">Movimientos del mes</h2><p className="text-xs text-slate-400">{loading ? "Cargando..." : `${entries.length} movimientos registrados`}</p></div></div><button type="button" onClick={downloadReport} disabled={exporting || loading} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm font-black text-cyan-100 transition hover:bg-cyan-300/20 disabled:opacity-50"><Download size={16} />{exporting ? "Generando informe" : "Descargar informe"}</button></div> : null}
    <div className="mb-4 rounded-3xl border border-white/10 bg-black/20 p-3"><div className="mb-3 flex items-center justify-between"><p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-slate-300"><Filter size={14} /> Filtros {activeFilters ? `(${activeFilters})` : ""}</p>{activeFilters ? <button type="button" onClick={() => setFilters(emptyFilters)} className="flex items-center gap-1 text-xs font-bold text-cyan-200"><X size={13} /> Limpiar</button> : null}</div><div className={`grid gap-2 ${compact ? "sm:grid-cols-2 2xl:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7"}`}><FilterInput label="Fecha" type="date" value={filters.date} onChange={(value) => setFilters((current) => ({ ...current, date: value }))} />{!compact ? <FilterSelect label="Negocio" value={filters.business} options={options.businesses} onChange={(value) => setFilters((current) => ({ ...current, business: value }))} /> : null}<FilterSelect label="Origen" value={filters.origin} options={options.accounts} onChange={(value) => setFilters((current) => ({ ...current, origin: value }))} /><FilterSelect label="Destino" value={filters.destination} options={options.accounts} onChange={(value) => setFilters((current) => ({ ...current, destination: value }))} /><FilterSelect label="Medio" value={filters.channel} options={options.channels} onChange={(value) => setFilters((current) => ({ ...current, channel: value }))} /><FilterSelect label="Tipo" value={filters.category} options={options.categories} onChange={(value) => setFilters((current) => ({ ...current, category: value }))} /><FilterSelect label="Movimiento" value={filters.movement} options={options.movements} onChange={(value) => setFilters((current) => ({ ...current, movement: value }))} /></div></div>
    {showSummaryReport ? <div className="mb-4 rounded-3xl border border-cyan-300/15 bg-gradient-to-br from-cyan-300/[0.08] via-purple-300/[0.05] to-transparent p-4"><div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200">Resumen de resultados filtrados</p><div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-300">{reportFilterRows(filters, month).map(([label, value]) => <span key={label}><strong className="text-slate-400">{label}:</strong> {value}</span>)}</div></div><div className="grid min-w-full grid-cols-2 gap-2 sm:grid-cols-3 xl:min-w-[760px] xl:grid-cols-5"><SummaryStat label="Movimientos" value={String(summary.count)} tone="purple" /><SummaryStat label="Ingresos filtrados" value={euro(summary.income)} tone="emerald" /><SummaryStat label="Gastos filtrados" value={euro(summary.expenses)} tone="rose" /><SummaryStat label="Balance neto" value={euro(summary.balance)} tone="cyan" /><SummaryStat label="Total traspasado" value={euro(summary.transferred)} tone="purple" /></div></div></div> : null}
    <MovementsTable entries={filtered.slice(0, visibleCount)} emptyText={emptyText} compact={compact} onEdit={onEdit} onDelete={onDelete} deletingId={deletingId} />{filtered.length > 10 ? <div className="mt-4 flex justify-center"><button type="button" onClick={() => setVisibleCount((current) => current >= filtered.length ? 10 : current + 10)} className="inline-flex items-center gap-2 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-5 py-3 text-sm font-black text-cyan-100 transition hover:bg-cyan-300/20">{visibleCount >= filtered.length ? <><ChevronUp size={16} /> Mostrar menos</> : <><ChevronDown size={16} /> Mostrar más ({Math.min(10, filtered.length - visibleCount)})</>}</button></div> : null}{entries.length > 0 && filtered.length === 0 ? <p className="mt-3 text-center text-xs text-slate-400">No hay movimientos que coincidan con los filtros seleccionados.</p> : null}</div>;
}

function SummaryStat({ label, value, tone }: { label: string; value: string; tone: "purple" | "emerald" | "rose" | "cyan" }) {
  const tones = { purple: "text-purple-200", emerald: "text-emerald-200", rose: "text-rose-200", cyan: "text-cyan-200" };
  return <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><p className="text-[8px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</p><p className={`mt-1 whitespace-nowrap text-sm font-black ${tones[tone]}`}>{value}</p></div>;
}
function FilterInput({ label, type, value, onChange }: { label: string; type: string; value: string; onChange: (value: string) => void }) { return <label className="space-y-1"><span className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-white outline-none focus:border-cyan-300/60" /></label>; }
function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) { return <label className="space-y-1"><span className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-xl border border-white/10 bg-slate-950 px-3 text-xs text-white outline-none focus:border-cyan-300/60"><option value="">Todos</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>; }
function CashHeader({ business, cashIn, cashOut, balance }: { business: string; cashIn: number; cashOut: number; balance: number }) { return <div className="mb-4"><div className="mb-3 flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-amber-300/15 text-amber-100"><Vault size={18} /></div><div><h4 className="font-black">Caja extra · {business}</h4><p className="text-[11px] text-slate-400">Saldo independiente y acumulado para futuros meses.</p></div></div><div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><MiniStat label="Entradas" value={euro(cashIn)} tone="emerald" /><MiniStat label="Salidas" value={euro(cashOut)} tone="rose" /><MiniStat label="Saldo actual" value={euro(balance)} tone="amber" /></div></div>; }
function MovementsTable({ entries, emptyText, compact = false, onDelete, onEdit, deletingId }: { entries: AccountingEntry[]; emptyText: string; compact?: boolean; onEdit: (entry: AccountingEntry) => void; onDelete: (entry: AccountingEntry) => void; deletingId: string | null }) {
  if (!entries.length) return <div className="rounded-3xl border border-dashed border-white/15 bg-black/20 p-8 text-center text-sm text-slate-400">{emptyText}</div>;
  return <div className="max-w-full overflow-x-auto rounded-2xl border border-white/[0.06]"><table className={`w-full table-auto text-left text-sm [overflow-wrap:normal] [word-break:normal] ${compact ? "min-w-[980px]" : "min-w-[1180px]"}`}><thead className="bg-black/20 text-xs uppercase tracking-[0.16em] text-slate-400"><tr className="border-b border-white/10"><th className="px-4 py-3">Movimiento</th><th className="px-4 py-3">Fecha</th>{!compact ? <th className="px-4 py-3">Negocio</th> : null}<th className="px-4 py-3">Origen</th><th className="px-4 py-3">Destino</th><th className="px-4 py-3">Medio</th><th className="px-4 py-3">Tipo</th><th className="whitespace-nowrap px-4 py-3 text-right">Importe</th><th className="px-4 py-3">Observación</th><th className="px-4 py-3 text-right">Acciones</th></tr></thead><tbody>{entries.map((entry) => { const transfer = entry.type === "traspaso"; const badge = entry.type === "ingreso" ? "bg-emerald-300/15 text-emerald-200" : entry.type === "gasto" ? "bg-rose-300/15 text-rose-200" : "bg-violet-300/15 text-violet-200"; const amountTone = entry.type === "ingreso" ? "text-emerald-200" : entry.type === "gasto" ? "text-rose-200" : "text-violet-200"; return <tr key={entry.id} className="border-b border-white/5 text-slate-200 transition last:border-0 hover:bg-white/[0.025]"><td className="px-4 py-4"><span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${badge}`}>{entry.type}</span></td><td className="px-4 py-4">{entry.date}</td>{!compact ? <td className="px-4 py-4 font-semibold">{entry.business}</td> : null}<td className="px-4 py-4">{entry.originAccount}</td><td className="px-4 py-4">{entry.destinationAccount}</td><td className="px-4 py-4">{entry.channel}</td><td className="px-4 py-4">{entry.category}</td><td className={`whitespace-nowrap px-4 py-4 text-right font-black ${amountTone}`}>{entry.type === "gasto" ? "-" : entry.type === "ingreso" ? "+" : "↔ "}{euro(entry.amount)}{transfer ? <span className="sr-only"> traspasados</span> : null}</td><td className="px-4 py-4 text-slate-400">{entry.note || "—"}</td><td className="px-4 py-4 text-right"><EditAmountButton entry={entry} onEdit={onEdit} disabled={deletingId === entry.id} /><button type="button" aria-label={`Eliminar ${entry.type} de ${euro(entry.amount)}`} onClick={() => onDelete(entry)} disabled={deletingId === entry.id} className="inline-flex items-center gap-2 rounded-xl border border-rose-300/20 bg-rose-300/10 px-3 py-2 text-xs font-black text-rose-200 transition hover:bg-rose-300/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200 disabled:opacity-50"><Trash2 size={15} aria-hidden="true" />{deletingId === entry.id ? "Eliminando" : "Eliminar"}</button></td></tr>; })}</tbody></table></div>;
}
function CashTable({ rows, onDelete, onEdit, deletingId }: { rows: CashRow[]; onEdit: (entry: AccountingEntry) => void; onDelete: (entry: AccountingEntry) => void; deletingId: string | null }) { if (!rows.length) return <div className="rounded-2xl border border-dashed border-amber-300/20 bg-black/20 p-5 text-center text-xs text-slate-400">Sin movimientos de caja extra este mes.</div>; const recent = rows.slice().reverse().slice(0, 10); return <div className="overflow-x-auto"><table className="min-w-[760px] w-full text-left text-xs"><thead className="uppercase tracking-[0.14em] text-slate-500"><tr className="border-b border-white/10"><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Medio</th><th className="px-3 py-2 text-right">Entrada</th><th className="px-3 py-2 text-right">Salida</th><th className="px-3 py-2 text-right">Saldo</th><th className="px-3 py-2 text-right">Acción</th></tr></thead><tbody>{recent.map((row) => <tr key={row.entry.id} className="border-b border-white/5"><td className="px-3 py-3">{row.entry.date}</td><td className="px-3 py-3">{row.entry.channel}</td><td className="px-3 py-3 text-right font-bold text-emerald-200">{row.cashIn ? euro(row.cashIn) : "—"}</td><td className="px-3 py-3 text-right font-bold text-rose-200">{row.cashOut ? euro(row.cashOut) : "—"}</td><td className="px-3 py-3 text-right font-black text-amber-100">{euro(row.balance)}</td><td className="px-3 py-3 text-right"><EditAmountButton entry={row.entry} onEdit={onEdit} disabled={deletingId === row.entry.id} /><button type="button" onClick={() => onDelete(row.entry)} disabled={deletingId === row.entry.id} className="rounded-lg p-2 text-rose-200 hover:bg-rose-300/10"><Trash2 size={14} /></button></td></tr>)}</tbody></table></div>; }
