"use client";

import { useMemo, useState, type FormEvent } from "react";
import { ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight, CircleHelp, CreditCard, Download, Filter, Landmark, LayoutDashboard, ListFilter, LoaderCircle, LockKeyhole, Pencil, Plus, RefreshCw, Search, Settings2, ShieldCheck, TrendingUp, Vault, Wallet, X } from "lucide-react";
import { ACCOUNT_LABELS, KIND_LABELS, buildCandles, entryImpact, filterEntries, formatMoney, summarize, type Account, type AccountingFilters, type AccountingSnapshot, type Currency, type Entry, type EntryInput, type EntryKind, type OptionInput } from "@/lib/accounting";
import AccountingDialog from "./AccountingDialog";
import AccountingOptions from "./AccountingOptions";
import BalanceCandles from "./BalanceCandles";
import EntryForm from "./EntryForm";
import { csvCell, dateLabel, madridDate } from "./accounting-client";
import styles from "./accounting.module.css";

type Tab = "overview" | "movements" | "vault" | "options";
const tabs = [{ id: "overview", label: "Resumen", icon: LayoutDashboard }, { id: "movements", label: "Movimientos", icon: ListFilter }, { id: "vault", label: "Bóveda", icon: Vault }, { id: "options", label: "Categorías y medios", icon: Settings2 }] as const;
const EMPTY_FILTERS = { kind: "all", categoryId: "all", methodId: "all", search: "", includeVoided: false } as const;
const pageSize = 25;

function VoidForm({ entry, onSave, onClose }: { entry: Entry; onSave: (id: string, reason: string) => Promise<void>; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setError(null); setBusy(true);
    try { await onSave(entry.id, reason.trim()); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo anular el movimiento."); }
    finally { setBusy(false); }
  }
  return <AccountingDialog title="Anular movimiento" subtitle="Se conservará en el historial y dejará de contar en los saldos." busy={busy} onClose={onClose}>
    <form onSubmit={submit} className={styles.entryForm}>
      <div className={styles.voidSummary}><span>{entry.description}</span><strong>{formatMoney(entry.amount_cents, entry.currency)}</strong><small>{ACCOUNT_LABELS[entry.account]} · {dateLabel(entry.occurred_on)}</small></div>
      <label>Motivo de la anulación<textarea data-initial-focus rows={3} required minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} placeholder="Explica por qué se anula este movimiento" /></label>
      <p className={styles.formHint}>Si necesitas corregir un importe, anula el movimiento y registra uno nuevo. Así siempre queda constancia del cambio.</p>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.dialogActions}><button type="button" className={styles.secondary} onClick={onClose} disabled={busy}>Conservar movimiento</button><button type="submit" className={styles.dangerButton} disabled={busy}>{busy ? <LoaderCircle size={16} className={styles.spin} /> : <X size={16} />}Confirmar anulación</button></div>
    </form>
  </AccountingDialog>;
}

export default function AccountingWorkspace({ snapshot, updatedAt, refreshing, locking, message, error, onRefresh, onLock, onSaveEntry, onVoidEntry, onSaveOption }: {
  snapshot: AccountingSnapshot; updatedAt: string; refreshing: boolean; locking: boolean; message: string | null; error: string | null;
  onRefresh: () => Promise<unknown>; onLock: () => Promise<void>; onSaveEntry: (entry: EntryInput) => Promise<void>;
  onVoidEntry: (id: string, reason: string) => Promise<void>; onSaveOption: (option: OptionInput) => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [account, setAccount] = useState<Account | "all">("all");
  const [currency, setCurrency] = useState<Currency>("EUR");
  const [dateFrom, setDateFrom] = useState(() => `${madridDate().slice(0, 7)}-01`);
  const [dateTo, setDateTo] = useState(madridDate);
  const [filters, setFilters] = useState<Pick<AccountingFilters, "kind" | "categoryId" | "methodId" | "search" | "includeVoided">>({ ...EMPTY_FILTERS });
  const [page, setPage] = useState(1);
  const [entryForm, setEntryForm] = useState<{ kind: EntryKind; account: Account } | null>(null);
  const [voiding, setVoiding] = useState<Entry | null>(null);
  const dateError = !!dateFrom && !!dateTo && dateFrom > dateTo;
  const baseFilters = useMemo(() => ({ account, currency, dateFrom, dateTo }), [account, currency, dateFrom, dateTo]);
  const summary = useMemo(() => summarize(snapshot.entries, baseFilters), [snapshot.entries, baseFilters]);
  const candles = useMemo(() => dateError ? [] : buildCandles(snapshot.entries, baseFilters), [snapshot.entries, baseFilters, dateError]);
  const rows = useMemo(() => dateError ? [] : filterEntries(snapshot.entries, { ...baseFilters, ...filters }), [snapshot.entries, baseFilters, filters, dateError]);
  const categories = useMemo(() => new Map(snapshot.categories.map(option => [option.id, option.name])), [snapshot.categories]);
  const methods = useMemo(() => new Map(snapshot.methods.map(option => [option.id, option.name])), [snapshot.methods]);
  const categoryExpenses = useMemo(() => {
    const totals = new Map<string, number>();
    for (const entry of filterEntries(snapshot.entries, { ...baseFilters, kind: "expense" })) {
      const name = categories.get(entry.category_id || "") || "Sin categoría";
      totals.set(name, (totals.get(name) || 0) + entry.amount_cents);
    }
    return [...totals].sort((a, b) => b[1] - a[1]);
  }, [snapshot.entries, baseFilters, categories]);
  const activeCount = snapshot.entries.filter(entry => !entry.voided_at).length;
  const maxPage = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, maxPage);
  const visibleRows = tab === "overview" ? rows.slice(0, 6) : rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const vaultRows = useMemo(() => filterEntries(snapshot.entries, baseFilters).filter(entry => entry.kind.startsWith("vault_")), [snapshot.entries, baseFilters]);
  const payouts = useMemo(() => {
    const result = { Alex: 0, Ricky: 0 };
    for (const entry of snapshot.entries) if (!entry.voided_at && entry.currency === currency && entry.kind === "vault_payout" && entry.recipient && (account === "all" || entry.account === account)) result[entry.recipient] += entry.amount_cents;
    return result;
  }, [snapshot.entries, currency, account]);

  function create(kind: EntryKind, forAccount?: Account) { setEntryForm({ kind, account: forAccount || (account === "all" ? "celestial" : account) }); }
  function updateFilter(values: Partial<typeof filters>) { setFilters(previous => ({ ...previous, ...values })); setPage(1); }
  function preset(value: "month" | "year" | "all") {
    const today = madridDate();
    setDateTo(value === "all" ? "" : today);
    setDateFrom(value === "month" ? `${today.slice(0, 7)}-01` : value === "year" ? `${today.slice(0, 4)}-01-01` : "");
    setPage(1);
  }
  function exportRows() {
    const headings = ["Fecha", "Tipo", "Cuenta", "Destino", "Moneda", "Importe", "Categoría", "Medio", "Concepto", "Referencia", "Destinatario", "Estado", "Motivo anulación"];
    const body = rows.map(entry => [entry.occurred_on, KIND_LABELS[entry.kind], ACCOUNT_LABELS[entry.account], entry.to_account ? ACCOUNT_LABELS[entry.to_account] : "", entry.currency, (entry.amount_cents / 100).toFixed(2), categories.get(entry.category_id || "") || "", methods.get(entry.method_id || "") || "", entry.description, entry.reference, entry.recipient || "", entry.voided_at ? "Anulado" : "Activo", entry.void_reason || ""]);
    const csv = "\uFEFF" + [headings, ...body].map(row => row.map(csvCell).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `contabilidad-${account}-${currency}-${madridDate()}.csv`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function movementTable(entries: Entry[]) {
    return entries.length ? <div className={styles.tableScroll}><table className={styles.movementsTable}><thead><tr><th>Fecha</th><th>Concepto</th><th>Cuenta</th><th>Medio</th><th>Tipo</th><th className={styles.alignRight}>Importe</th><th><span className={styles.srOnly}>Acciones</span></th></tr></thead>
      <tbody>{entries.map(entry => {
        const impact = entryImpact(entry, account);
        const positive = entry.kind === "income" || (entry.kind === "transfer" && impact.available_cents > 0);
        const negative = entry.kind === "expense" || entry.kind === "vault_payout" || (entry.kind === "transfer" && impact.available_cents < 0);
        return <tr key={entry.id} className={entry.voided_at ? styles.voidedRow : undefined}>
          <td className={styles.dateCell}>{dateLabel(entry.occurred_on)}</td><td className={styles.conceptCell}><strong>{entry.description}</strong><small>{categories.get(entry.category_id || "") || (entry.recipient ? `Destinatario: ${entry.recipient}` : entry.reference || "Movimiento interno")}</small>{entry.voided_at ? <small className={styles.negative}>Anulado · {entry.void_reason}</small> : null}</td>
          <td><span className={entry.account === "celestial" ? styles.celestialText : styles.leonarisText}>{ACCOUNT_LABELS[entry.account]}</span>{entry.to_account ? <small className={styles.destination}><ArrowRight size={12} /> {ACCOUNT_LABELS[entry.to_account]}</small> : null}</td>
          <td>{methods.get(entry.method_id || "") || "—"}</td><td><span className={`${styles.kindBadge} ${entry.kind === "income" ? styles.incomeBadge : entry.kind === "expense" ? styles.expenseBadge : ""}`}>{entry.voided_at ? "Anulado" : KIND_LABELS[entry.kind]}</span></td>
          <td className={`${styles.amountCell} ${positive ? styles.positive : negative ? styles.negative : ""}`}>{positive ? "+" : negative ? "−" : ""}{formatMoney(entry.amount_cents, entry.currency)}</td>
          <td>{!entry.voided_at ? <button type="button" className={styles.iconButton} aria-label={`Anular: ${entry.description}`} title="Anular con motivo" onClick={() => setVoiding(entry)}><X size={16} /></button> : <ShieldCheck size={16} aria-label="Anulación registrada" />}</td>
        </tr>;
      })}</tbody></table></div> : <div className={styles.empty}><ListFilter size={30} strokeWidth={1.25} /><strong>No hay movimientos para estos filtros</strong><p>Puedes cambiar el periodo o registrar un nuevo ingreso o gasto.</p></div>;
  }

  return <main className={styles.workspace}>
    <a href="/admin" className={styles.backLink}><ChevronLeft size={16} />Volver al panel</a>
    <header className={styles.hero}>
      <div><p className={styles.eyebrow}><ShieldCheck size={14} /> ESPACIO FINANCIERO PRIVADO</p><h1>Contabilidad<span className={styles.goldPeriod}>.</span></h1><p className={styles.heroSubtitle}>Bienvenido, Alex. Tus dos cuentas, una visión clara.</p></div>
      <div className={styles.heroActions}><button type="button" className={styles.secondary} disabled={refreshing} onClick={() => void onRefresh().catch(() => null)}><RefreshCw size={16} className={refreshing ? styles.spin : undefined} />Actualizar</button><button type="button" className={styles.secondary} disabled={locking} onClick={() => void onLock()}><LockKeyhole size={16} />{locking ? "Cerrando…" : "Bloquear"}</button></div>
    </header>
    <div className={styles.contextBar}><span className={styles.verified}><span />{refreshing ? "Verificando datos…" : "Datos guardados en el servidor"}</span><span>Última lectura: {updatedAt ? new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }).format(new Date(updatedAt)) : "—"} · hora de España</span></div>
    <nav className={styles.tabs} aria-label="Secciones de contabilidad">{tabs.map(item => <button type="button" key={item.id} aria-current={tab === item.id ? "page" : undefined} className={tab === item.id ? styles.activeTab : ""} onClick={() => { setTab(item.id); setPage(1); if (item.id === "overview") setFilters({ ...EMPTY_FILTERS }); }}><item.icon size={17} />{item.label}{item.id === "vault" ? <span className={styles.privateTag}>Privada</span> : null}</button>)}</nav>
    {message ? <div className={styles.success} role="status"><CheckCircle2 size={18} />{message}</div> : null}
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    {tab !== "options" ? <>
      <section className={styles.filtersPanel} aria-label="Filtros principales">
        <div className={styles.accountTabs}>{(["all", "celestial", "leonaris"] as const).map(value => <button type="button" key={value} className={`${account === value ? styles.selectedAccount : ""} ${value === "leonaris" ? styles.leonarisAccount : ""}`} aria-pressed={account === value} onClick={() => { setAccount(value); setPage(1); }}><span className={value === "all" ? styles.allAccountDot : value === "celestial" ? styles.celestialDot : styles.leonarisDot} />{value === "all" ? "Vista conjunta" : ACCOUNT_LABELS[value]}</button>)}</div>
        <div className={styles.periodFilters}><label className={styles.currencySelect}>Moneda<select value={currency} onChange={event => { setCurrency(event.target.value as Currency); setPage(1); }}><option value="EUR">EUR · €</option><option value="USD">USD · $</option></select></label><label>Desde<input aria-label="Fecha desde" type="date" value={dateFrom} max={dateTo || undefined} onChange={event => { setDateFrom(event.target.value); setPage(1); }} /></label><span className={styles.dateArrow}>→</span><label>Hasta<input aria-label="Fecha hasta" type="date" value={dateTo} min={dateFrom || undefined} onChange={event => { setDateTo(event.target.value); setPage(1); }} /></label><div className={styles.presets}><button type="button" onClick={() => preset("month")}>Este mes</button><button type="button" onClick={() => preset("year")}>Este año</button><button type="button" onClick={() => preset("all")}>Todo</button></div></div>
      </section>
      {dateError ? <p className={styles.error} role="alert">La fecha de inicio no puede ser posterior a la fecha final.</p> : null}
    </> : null}

    {(tab === "overview" || tab === "movements") ? <>
      <div className={styles.actionBar}><p><Landmark size={15} /> Registro manual · {currency} · sin conexión a tu banco</p><div className={styles.row}><button type="button" className={styles.secondary} onClick={() => create("transfer")}><ArrowLeftRight size={16} />Traspaso</button><button type="button" className={styles.expenseButton} onClick={() => create("expense")}><ArrowUpRight size={17} />Nuevo gasto</button><button type="button" className={styles.primary} onClick={() => create("income")}><Plus size={18} />Nuevo ingreso</button></div></div>
      <section className={styles.metrics} aria-label="Resumen financiero">
        <div className={`${styles.metric} ${styles.balanceMetric}`}><div className={styles.metricLabel}><span>Disponible registrado</span><Wallet size={18} /></div><strong>{formatMoney(summary.available_cents, currency)}</strong><small>Todo el historial · excluye la bóveda</small></div>
        <div className={styles.metric}><div className={styles.metricLabel}><span>Ingresos</span><ArrowDownLeft size={18} className={styles.positive} /></div><strong className={styles.positive}>{formatMoney(summary.income_cents, currency)}</strong><small>En el periodo seleccionado</small></div>
        <div className={styles.metric}><div className={styles.metricLabel}><span>Gastos</span><ArrowUpRight size={18} className={styles.negative} /></div><strong className={styles.negative}>{formatMoney(summary.expense_cents, currency)}</strong><small>En el periodo seleccionado</small></div>
        <div className={styles.metric}><div className={styles.metricLabel}><span>Resultado neto registrado</span><TrendingUp size={18} /></div><strong className={summary.net_cents >= 0 ? styles.positive : styles.negative}>{formatMoney(summary.net_cents, currency)}</strong><small>Ingresos − gastos del periodo</small></div>
      </section>
      {summary.available_cents < 0 ? <p className={styles.warning}><CircleHelp size={17} />El saldo disponible registrado es negativo. Comprueba si falta el saldo inicial, algún ingreso o un traspaso; no es una consulta al saldo de tu banco.</p> : null}
      {!activeCount ? <div className={styles.startBanner}><Landmark size={25} /><div><strong>Empieza con lo que ya tienes</strong><p>Añade el saldo inicial de cada cuenta antes de registrar nuevos movimientos. No se sumará a los ingresos.</p></div><button type="button" className={styles.secondary} onClick={() => create("opening_balance")}>Añadir saldo inicial<ArrowRight size={15} /></button></div> : null}
    </> : null}

    {tab === "overview" ? <>
      <div className={styles.accountsGrid}>{(["celestial", "leonaris"] as const).map(brand => <section key={brand} className={`${styles.accountCard} ${brand === "leonaris" ? styles.leonarisCard : ""}`}><div className={styles.accountCardHeading}><span className={styles.accountMonogram}>{brand === "celestial" ? "C" : "L"}</span><div><h3>{ACCOUNT_LABELS[brand]}</h3><p>Cuenta independiente · {currency}</p></div><button type="button" className={styles.iconButton} aria-label={`Ver movimientos de ${ACCOUNT_LABELS[brand]}`} onClick={() => { setAccount(brand); setTab("movements"); }}><ArrowRight size={19} /></button></div><div className={styles.accountFigures}><div><small>Disponible · todo el historial</small><strong>{formatMoney(summary.accounts[brand].available_cents, currency)}</strong></div><div><small><Vault size={12} />En bóveda</small><b>{formatMoney(summary.accounts[brand].vault_cents, currency)}</b></div></div></section>)}</div>
      <div className={styles.analyticsGrid}><section className={`${styles.panel} ${styles.chartPanel}`}><div className={styles.panelHeading}><div><p className={styles.eyebrow}>EVOLUCIÓN</p><h2>El pulso de tu saldo</h2><p>Disponible registrado · {account === "all" ? "ambas cuentas" : ACCOUNT_LABELS[account]} · {currency}</p></div><span className={styles.chartType}>VELAS · 1 D</span></div><BalanceCandles candles={candles} currency={currency} /></section>
        <section className={`${styles.panel} ${styles.expensePanel}`}><div className={styles.panelHeading}><div><p className={styles.eyebrow}>DISTRIBUCIÓN</p><h2>¿A dónde va el dinero?</h2><p>Gastos del periodo por categoría</p></div></div>
          {categoryExpenses.length ? <div className={styles.breakdown}>{categoryExpenses.slice(0, 7).map(([name, cents], index) => <div key={name}><div className={styles.breakdownLabel}><span>{name}</span><b>{formatMoney(cents, currency)}</b></div><div className={styles.barTrack}><span style={{ width: `${Math.max(1, cents / Math.max(1, summary.expense_cents) * 100)}%`, opacity: 1 - index * .08 }} /></div></div>)}{categoryExpenses.length > 7 ? <p className={styles.formHint}>Y {categoryExpenses.length - 7} categorías más en Movimientos.</p> : null}</div> : <div className={styles.empty}><CreditCard size={30} strokeWidth={1.25} /><strong>Sin gastos en este periodo</strong><p>Las categorías aparecerán al registrar tus pagos.</p></div>}
        </section></div>
      <section className={styles.vaultTeaser}><div className={styles.vaultTeaserIcon}><Vault size={30} strokeWidth={1.25} /></div><div><p className={styles.eyebrow}>RESERVA PARA FINAL DE AÑO</p><h2>La bóveda de Alex y Ricky</h2><p>Dinero apartado, separado del disponible. Sin reparto automático.</p></div><strong>{formatMoney(summary.vault_cents, currency)}</strong><button type="button" className={styles.goldButton} onClick={() => setTab("vault")}>Abrir bóveda<ArrowRight size={16} /></button></section>
    </> : null}

    {(tab === "overview" || tab === "movements") ? <section className={styles.panel}>
      <div className={styles.panelHeading}><div><h2>{tab === "overview" ? "Últimos movimientos del periodo" : "Todos tus movimientos"}</h2><p>{rows.length} {rows.length === 1 ? "movimiento" : "movimientos"} · {account === "all" ? "ambas cuentas" : ACCOUNT_LABELS[account]}</p></div>{tab === "overview" ? <button type="button" className={styles.textButton} onClick={() => setTab("movements")}>Ver todos<ArrowRight size={15} /></button> : <button type="button" className={styles.secondary} disabled={!rows.length} onClick={exportRows}><Download size={16} />Exportar CSV</button>}</div>
      {tab === "movements" ? <div className={styles.movementFilters}><label className={styles.searchField}><Search size={17} /><input aria-label="Buscar movimientos" value={filters.search} onChange={event => updateFilter({ search: event.target.value })} placeholder="Buscar concepto, referencia o destinatario…" /></label>
        <label>Tipo<select value={filters.kind} onChange={event => updateFilter({ kind: event.target.value as EntryKind | "all" })}><option value="all">Todos los tipos</option>{Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Categoría<select value={filters.categoryId} onChange={event => updateFilter({ categoryId: event.target.value })}><option value="all">Todas las categorías</option>{snapshot.categories.map(option => <option key={option.id} value={option.id}>{option.name}{!option.active ? " (archivada)" : ""}</option>)}</select></label>
        <label>Medio<select value={filters.methodId} onChange={event => updateFilter({ methodId: event.target.value })}><option value="all">Todos los medios</option>{snapshot.methods.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
        <label className={styles.checkboxLabel}><input type="checkbox" checked={filters.includeVoided} onChange={event => updateFilter({ includeVoided: event.target.checked })} />Mostrar anulados</label><button type="button" className={styles.textButton} onClick={() => updateFilter({ ...EMPTY_FILTERS })}><Filter size={14} />Limpiar</button>
        <p className={styles.filterHint}>Estos filtros afinan la lista. Los indicadores y la gráfica usan cuenta, moneda y periodo.</p>
      </div> : null}
      {movementTable(visibleRows)}
      {tab === "movements" ? <div className={styles.tableFooter}><span>Los movimientos se anulan con motivo; no se borran del historial.</span><div className={styles.row}><button type="button" className={styles.iconButton} aria-label="Página anterior" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18} /></button><span>{currentPage} / {maxPage}</span><button type="button" className={styles.iconButton} aria-label="Página siguiente" disabled={currentPage >= maxPage} onClick={() => setPage(currentPage + 1)}><ChevronRight size={18} /></button></div></div> : null}
    </section> : null}

    {tab === "vault" ? <>
      <section className={styles.vaultHero}><div className={styles.vaultIllustration}><Vault size={70} strokeWidth={1} /><ShieldCheck size={25} /></div><div className={styles.vaultHeroBody}><p className={styles.eyebrow}>BÓVEDA PRIVADA · ALEX & RICKY</p><h2>Lo que hoy guardas,<br />mañana lo compartís.</h2><p>Reserva para el reparto de final de año. Cada aportación conserva su cuenta de origen y no se cuenta como un ingreso nuevo.</p><div className={styles.row}><button type="button" className={styles.goldButton} onClick={() => create("vault_deposit")}><Plus size={17} />Guardar en bóveda</button><button type="button" className={styles.secondary} disabled={summary.vault_cents <= 0} onClick={() => create("vault_withdrawal")}>Devolver a la cuenta</button></div></div><div className={styles.vaultHeroBalance}><span>Total reservado · {currency}</span><strong>{formatMoney(summary.vault_cents, currency)}</strong><small>Todo el historial · {account === "all" ? "ambas cuentas" : ACCOUNT_LABELS[account]}</small><span className={styles.privateChip}><LockKeyhole size={13} />Fuera del saldo disponible</span></div></section>
      <div className={styles.vaultAccounts}>{(["celestial", "leonaris"] as const).map(brand => <section className={styles.panel} key={brand}><div className={styles.panelHeading}><div className={styles.row}><span className={brand === "celestial" ? styles.celestialDot : styles.leonarisDot} /><h3>{ACCOUNT_LABELS[brand]}</h3></div><Vault size={19} /></div><strong className={styles.vaultAccountAmount}>{formatMoney(summary.accounts[brand].vault_cents, currency)}</strong><p className={styles.formHint}>Reserva procedente de esta cuenta · todo el historial</p><button type="button" className={styles.textButton} onClick={() => create("vault_deposit", brand)}>Añadir a esta reserva<ArrowRight size={15} /></button></section>)}
        <section className={`${styles.panel} ${styles.distributionCard}`}><div className={styles.panelHeading}><div><h3>Repartos registrados</h3><p>Todo el historial · {account === "all" ? "ambas cuentas" : ACCOUNT_LABELS[account]}</p></div></div><div><span>Alex</span><b>{formatMoney(payouts.Alex, currency)}</b></div><div><span>Ricky</span><b>{formatMoney(payouts.Ricky, currency)}</b></div><button type="button" className={styles.secondary} disabled={summary.vault_cents <= 0} onClick={() => create("vault_payout")}>Registrar reparto<ArrowUpRight size={15} /></button></section></div>
      <p className={styles.notice}><CircleHelp size={17} />No hay porcentajes fijados. Cuando llegue el momento, registrarás lo que reciba cada uno. La aplicación registra el reparto; no envía dinero.</p>
      <section className={styles.panel}><div className={styles.panelHeading}><div><h2>Movimientos de la bóveda</h2><p>{vaultRows.length} movimientos en el periodo seleccionado</p></div></div>{movementTable(vaultRows)}</section>
    </> : null}

    {tab === "options" ? <AccountingOptions snapshot={snapshot} onSave={onSaveOption} /> : null}
    <footer className={styles.workspaceFooter}><p><ShieldCheck size={15} />Acceso protegido · historial auditable · importes separados por moneda</p><button type="button" className={styles.textButton} onClick={() => create("opening_balance")}><Pencil size={14} />Registrar saldo inicial</button></footer>
    <p className={styles.accountingDisclaimer}>Control interno de ingresos y gastos registrados. El resultado no incluye impuestos, comisiones ni otros conceptos que no hayas añadido y no sustituye la contabilidad fiscal.</p>
    {entryForm ? <EntryForm kind={entryForm.kind} account={entryForm.account} currency={currency} snapshot={snapshot} onSave={onSaveEntry} onClose={() => setEntryForm(null)} /> : null}
    {voiding ? <VoidForm entry={voiding} onSave={onVoidEntry} onClose={() => setVoiding(null)} /> : null}
  </main>;
}
