import { ACCOUNT_LABELS, accountingToday, entryAffectsAccount, entryImpact, filterEntries, type Account, type AccountingFilters, type Currency, type Entry } from "@/lib/accounting";

export const ACCOUNTS: Account[] = ["celestial", "leonaris"];
export const VAULT_KINDS = ["vault_deposit", "vault_withdrawal", "vault_payout"] as const;
export type RouteKey = "all" | "external" | "Alex" | "Ricky" | `${Account}:available` | `${Account}:vault`;
export const ROUTE_LABELS: Record<RouteKey, string> = {
  all: "Todos", external: "Exterior", Alex: "Alex", Ricky: "Ricky",
  "celestial:available": "Celestial · disponible", "leonaris:available": "Leonaris · disponible",
  "celestial:vault": "Celestial · bóveda", "leonaris:vault": "Leonaris · bóveda",
};
export type MonthlyFilters = { date: string; account: Account | "all"; origin: RouteKey; destination: RouteKey; methodId: string; categoryId: string; kind: AccountingFilters["kind"]; search: string; includeVoided: boolean };
export const EMPTY_MONTHLY_FILTERS: MonthlyFilters = { date: "", account: "all", origin: "all", destination: "all", methodId: "all", categoryId: "all", kind: "all", search: "", includeVoided: false };

export function safeAdd(a: number, b: number): number {
  const n = a + b;
  if (!Number.isSafeInteger(n)) throw new Error("El importe supera el límite seguro de cálculo.");
  return n;
}
export function monthBounds(month: string) {
  if (!/^(?:19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Selecciona un mes válido.");
  const [year, m] = month.split("-").map(Number);
  return { from: `${month}-01`, to: new Date(Date.UTC(year, m, 0, 12)).toISOString().slice(0, 10) };
}
export function shiftMonth(month: string, delta: number): string {
  monthBounds(month);
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1, 12)).toISOString().slice(0, 7);
}
export function monthLabel(month: string, short = false): string {
  return new Intl.DateTimeFormat("es-ES", { month: short ? "short" : "long", ...(short ? {} : { year: "numeric" as const }), timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`));
}
export function entryRoute(entry: Pick<Entry, "kind" | "account" | "to_account" | "recipient">): { origin: RouteKey; destination: RouteKey } {
  const available: RouteKey = `${entry.account}:available`, vault: RouteKey = `${entry.account}:vault`;
  switch (entry.kind) {
    case "income": case "opening_balance": return { origin: "external", destination: available };
    case "expense": return { origin: available, destination: "external" };
    case "transfer": return { origin: available, destination: `${entry.to_account || (entry.account === "celestial" ? "leonaris" : "celestial")}:available` };
    case "vault_deposit": return { origin: available, destination: vault };
    case "vault_withdrawal": return { origin: vault, destination: available };
    case "vault_payout": return { origin: vault, destination: entry.recipient || "external" };
  }
}
export function monthlyRows(entries: Entry[], month: string, currency: Currency, filters: MonthlyFilters, today = accountingToday()): Entry[] {
  const { from, to } = monthBounds(month);
  const cutoff = to < today ? to : today;
  return filterEntries(entries, { account: filters.account, currency, dateFrom: from, dateTo: cutoff, kind: filters.kind, methodId: filters.methodId, categoryId: filters.categoryId, search: filters.search, includeVoided: filters.includeVoided }).filter(entry => {
    const route = entryRoute(entry);
    return (!filters.date || entry.occurred_on === filters.date) &&
      (filters.origin === "all" || route.origin === filters.origin) && (filters.destination === "all" || route.destination === filters.destination);
  });
}
/** Balances are the true historical opening/closing of the selected month; filters never erase them. */
export function monthlySummary(entries: Entry[], month: string, currency: Currency, account: Account | "all" = "all", today = accountingToday()) {
  const { from, to } = monthBounds(month), cutoff = to < today ? to : today;
  const result = { opening: 0, available: 0, openingVault: 0, vault: 0, income: 0, expense: 0, net: 0, vaultIn: 0, vaultOut: 0, transferIn: 0, transferOut: 0, payouts: { Alex: 0, Ricky: 0 }, count: 0 };
  for (const entry of entries) {
    if (entry.voided_at || entry.currency !== currency || entry.occurred_on > cutoff || !entryAffectsAccount(entry, account)) continue;
    const impact = entryImpact(entry, account);
    result.available = safeAdd(result.available, impact.available_cents);
    result.vault = safeAdd(result.vault, impact.vault_cents);
    if (entry.occurred_on < from) {
      result.opening = safeAdd(result.opening, impact.available_cents);
      result.openingVault = safeAdd(result.openingVault, impact.vault_cents);
      continue;
    }
    result.count++;
    if (entry.kind === "income") result.income = safeAdd(result.income, entry.amount_cents);
    if (entry.kind === "expense") result.expense = safeAdd(result.expense, entry.amount_cents);
    if (impact.vault_cents > 0) result.vaultIn = safeAdd(result.vaultIn, impact.vault_cents);
    if (impact.vault_cents < 0) result.vaultOut = safeAdd(result.vaultOut, -impact.vault_cents);
    if (entry.kind === "transfer") {
      if (impact.available_cents > 0) result.transferIn = safeAdd(result.transferIn, impact.available_cents);
      if (impact.available_cents < 0) result.transferOut = safeAdd(result.transferOut, -impact.available_cents);
    }
    if (entry.kind === "vault_payout" && entry.recipient) result.payouts[entry.recipient] = safeAdd(result.payouts[entry.recipient], entry.amount_cents);
  }
  result.net = safeAdd(result.income, -result.expense);
  return result;
}
export function filteredTotals(rows: Entry[]) {
  const result = { income: 0, expense: 0, net: 0, transferred: 0, count: 0 };
  for (const entry of rows) {
    if (entry.voided_at) continue;
    result.count++;
    if (entry.kind === "income") result.income = safeAdd(result.income, entry.amount_cents);
    if (entry.kind === "expense") result.expense = safeAdd(result.expense, entry.amount_cents);
    if (entry.kind === "transfer") result.transferred = safeAdd(result.transferred, entry.amount_cents);
  }
  result.net = safeAdd(result.income, -result.expense);
  return result;
}
export function vaultHistory(entries: Entry[], month: string, currency: Currency, account: Account, today = accountingToday()) {
  const { from, to } = monthBounds(month), cutoff = to < today ? to : today;
  let balance = 0;
  const result: { entry: Entry; incoming: number; outgoing: number; balance: number }[] = [];
  const ordered = entries.filter(e => !e.voided_at && e.currency === currency && e.account === account && e.occurred_on <= cutoff && e.kind.startsWith("vault_")).slice().sort((a,b) => a.occurred_on.localeCompare(b.occurred_on) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  for (const entry of ordered) {
    const delta = entryImpact(entry, account).vault_cents;
    balance = safeAdd(balance, delta);
    if (entry.occurred_on >= from) result.push({ entry, incoming: Math.max(0, delta), outgoing: Math.max(0, -delta), balance });
  }
  return result.reverse();
}
/** Percentage is undefined, not infinity, when there is no meaningful base. */
export function percentageChange(current: number, previous: number): number | null {
  return previous > 0 ? (current - previous) * 100 / previous : null;
}
export function historyMonths(entries: Entry[], month: string, currency: Currency): string[] {
  const first = entries.filter(e => !e.voided_at && e.currency === currency && e.occurred_on.slice(0,7) <= month).map(e => e.occurred_on.slice(0,7)).sort()[0];
  if (!first) return [];
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) { const candidate = shiftMonth(month, -i); if (candidate >= first) months.push(candidate); }
  return months;
}
/** Start a chart only when its selected metric has history; retain subsequent quiet months. */
export function historyMonthsForMetric(entries: Entry[], month: string, currency: Currency, filters: Pick<MonthlyFilters, "account" | "methodId" | "categoryId">, metric: "income" | "expense" | "available" | "vault", today = accountingToday()): string[] {
  const { to } = monthBounds(month), cutoff = to < today ? to : today;
  const stock = metric === "available" || metric === "vault";
  const selected = filterEntries(entries, {
    account: filters.account, currency, dateTo: cutoff,
    kind: stock ? "all" : metric,
    methodId: stock ? "all" : filters.methodId,
    categoryId: stock ? "all" : filters.categoryId,
  }).filter(entry => metric !== "vault" || entry.kind.startsWith("vault_"));
  return historyMonths(selected, month, currency);
}
export function filterCount(filters: MonthlyFilters) {
  return Object.values(filters).filter(v => v !== "all" && v !== "" && v !== false).length;
}
export function accountShort(account: Account): string { return ACCOUNT_LABELS[account].replace("Tarot ", ""); }
