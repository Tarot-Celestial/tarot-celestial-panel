/** Shared, deterministic bookkeeping rules. Amounts are integer minor units. */
export const ACCOUNT_LABELS = { celestial: "Tarot Celestial", leonaris: "Tarot Leonaris" } as const;
export type Account = keyof typeof ACCOUNT_LABELS;
export type Currency = "EUR" | "USD";
export const KIND_LABELS = {
  income: "Ingreso",
  expense: "Gasto",
  transfer: "Traspaso",
  vault_deposit: "Aportación a la bóveda",
  vault_withdrawal: "Retirada de la bóveda",
  opening_balance: "Saldo inicial",
  vault_payout: "Reparto de la bóveda",
} as const;
export type EntryKind = keyof typeof KIND_LABELS;

export type Entry = {
  id: string;
  kind: EntryKind;
  account: Account;
  to_account: Account | null;
  currency: Currency;
  amount_cents: number;
  occurred_on: string;
  category_id: string | null;
  method_id: string | null;
  description: string;
  reference: string;
  recipient: "Alex" | "Ricky" | null;
  created_at: string;
  created_by: string;
  voided_at: string | null;
  void_reason: string | null;
  voided_by: string | null;
};
export type Category = { id: string; name: string; kind: "income" | "expense"; active: boolean; created_at: string };
export type PaymentMethod = { id: string; name: string; active: boolean; created_at: string };
export type AccountingSnapshot = { entries: Entry[]; categories: Category[]; methods: PaymentMethod[] };
export type EntryInput = Pick<Entry, "id" | "kind" | "account" | "currency" | "amount_cents" | "occurred_on" | "description"> &
  Partial<Pick<Entry, "to_account" | "category_id" | "method_id" | "reference" | "recipient">>;
export type OptionInput = { id?: string; kind: "income" | "expense" | "method"; name: string; active: boolean };
export type AccountingFilters = {
  account?: Account | "all";
  currency: Currency;
  dateFrom?: string;
  dateTo?: string;
  kind?: EntryKind | "all";
  categoryId?: string;
  methodId?: string;
  search?: string;
  includeVoided?: boolean;
};
export type Balance = { available_cents: number; vault_cents: number; total_cents: number };
export type AccountingSummary = Balance & {
  income_cents: number;
  expense_cents: number;
  net_cents: number;
  accounts: Record<Account, Balance>;
};
export type Candle = { date: string; open: number; high: number; low: number; close: number; volume_cents: number };

export const MAX_AMOUNT_CENTS = 100_000_000_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accept 1234.56 or 1234,56; ambiguous grouping, exponent and fractions fail. */
export function parseAmountToCents(value: string | number): number {
  const raw = String(value).trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(raw)) throw new Error("Introduce un importe positivo con un máximo de dos decimales, sin separadores de miles.");
  const [whole, fraction = ""] = raw.replace(",", ".").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_AMOUNT_CENTS) throw new Error("El importe debe ser mayor que cero y no superar 1.000.000.000.");
  return cents;
}

export function formatMoney(cents: number, currency: Currency = "EUR"): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
}

/** The business day is explicitly Madrid, never the execution host's timezone. */
export function accountingToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function isAccountingDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Same shape and semantic rules are independently enforced in PostgreSQL. */
export function validateEntryInput(input: unknown): EntryInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Movimiento no válido.");
  const v = input as Record<string, unknown>;
  if (typeof v.id !== "string" || !uuid.test(v.id)) throw new Error("Identificador del movimiento no válido.");
  if (typeof v.kind !== "string" || !Object.prototype.hasOwnProperty.call(KIND_LABELS, v.kind)) throw new Error("Tipo de movimiento no válido.");
  if (v.account !== "celestial" && v.account !== "leonaris") throw new Error("Selecciona la cuenta de origen.");
  if (v.currency !== "EUR" && v.currency !== "USD") throw new Error("Selecciona EUR o USD.");
  if (!Number.isSafeInteger(v.amount_cents) || Number(v.amount_cents) <= 0 || Number(v.amount_cents) > MAX_AMOUNT_CENTS) throw new Error("Importe no válido.");
  if (!isAccountingDate(v.occurred_on)) throw new Error("Introduce una fecha válida entre 2000 y 2099.");
  if (v.occurred_on > accountingToday()) throw new Error("No se pueden registrar movimientos futuros: esta contabilidad refleja dinero ya recibido o pagado.");
  const description = typeof v.description === "string" ? v.description.trim() : "";
  if (description.length < 3 || description.length > 500) throw new Error("El motivo debe tener entre 3 y 500 caracteres.");
  if (v.reference != null && typeof v.reference !== "string") throw new Error("Referencia no válida.");
  const reference = typeof v.reference === "string" ? v.reference.trim() : "";
  if (reference.length > 200) throw new Error("La referencia no puede superar 200 caracteres.");
  for (const field of ["category_id", "method_id"] as const) {
    if (v[field] != null && (typeof v[field] !== "string" || !uuid.test(v[field] as string))) throw new Error("Categoría o método no válido.");
  }
  const isFlow = v.kind === "income" || v.kind === "expense";
  if (isFlow && (!v.category_id || !v.method_id)) throw new Error("Selecciona la categoría y el método del movimiento.");
  if (!isFlow && v.category_id != null) throw new Error("Este movimiento no utiliza una categoría de ingresos o gastos.");
  if (v.kind === "transfer") {
    if ((v.to_account !== "celestial" && v.to_account !== "leonaris") || v.to_account === v.account) throw new Error("El traspaso necesita dos cuentas distintas.");
  } else if (v.to_account != null) throw new Error("Solo los traspasos tienen una cuenta de destino.");
  if (v.kind === "vault_payout") {
    if (v.recipient !== "Alex" && v.recipient !== "Ricky") throw new Error("Selecciona el destinatario del reparto.");
  } else if (v.recipient != null) throw new Error("Solo los repartos de la bóveda tienen destinatario.");
  return {
    id: v.id, kind: v.kind as EntryKind, account: v.account, to_account: (v.to_account ?? null) as Account | null,
    currency: v.currency, amount_cents: v.amount_cents as number, occurred_on: v.occurred_on, description, reference,
    category_id: (v.category_id ?? null) as string | null, method_id: (v.method_id ?? null) as string | null,
    recipient: (v.recipient ?? null) as Entry["recipient"],
  };
}

export function validateOptionInput(input: unknown): OptionInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Categoría o método no válido.");
  const v = input as Record<string, unknown>;
  if (v.kind !== "income" && v.kind !== "expense" && v.kind !== "method") throw new Error("Tipo de categoría no válido.");
  if (v.id != null && (typeof v.id !== "string" || !uuid.test(v.id))) throw new Error("Identificador de categoría no válido.");
  const name = typeof v.name === "string" ? v.name.trim() : "";
  if (name.length < 2 || name.length > 80) throw new Error("El nombre debe tener entre 2 y 80 caracteres.");
  if (v.active !== undefined && typeof v.active !== "boolean") throw new Error("Estado de categoría no válido.");
  return { ...(v.id ? { id: v.id as string } : {}), kind: v.kind, name, active: v.active !== false };
}

export function entryAffectsAccount(entry: Entry, account?: Account | "all"): boolean {
  return !account || account === "all" || entry.account === account || (entry.kind === "transfer" && entry.to_account === account);
}

/** A transfer is stored once and projected to both ledgers; it is never revenue. */
export function entryImpact(entry: Entry, account?: Account | "all"): Balance {
  if (entry.voided_at || !entryAffectsAccount(entry, account)) return { available_cents: 0, vault_cents: 0, total_cents: 0 };
  const n = entry.amount_cents;
  let available = 0, vault = 0;
  switch (entry.kind) {
    case "income":
    case "opening_balance": available = n; break;
    case "expense": available = -n; break;
    case "transfer": available = !account || account === "all" ? 0 : entry.account === account ? -n : n; break;
    case "vault_deposit": available = -n; vault = n; break;
    case "vault_withdrawal": available = n; vault = -n; break;
    case "vault_payout": vault = -n; break;
  }
  return { available_cents: available, vault_cents: vault, total_cents: available + vault };
}

function checkedAdd(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) throw new Error("El saldo supera el límite seguro de cálculo.");
  return sum;
}

export function filterEntries(entries: Entry[], filters: AccountingFilters): Entry[] {
  const query = filters.search?.trim().toLocaleLowerCase("es");
  return entries.filter(entry => {
    if ((!filters.includeVoided && entry.voided_at) || entry.currency !== filters.currency || !entryAffectsAccount(entry, filters.account)) return false;
    if (filters.dateFrom && entry.occurred_on < filters.dateFrom) return false;
    if (filters.dateTo && entry.occurred_on > filters.dateTo) return false;
    if (filters.kind && filters.kind !== "all" && entry.kind !== filters.kind) return false;
    if (filters.categoryId && filters.categoryId !== "all" && entry.category_id !== filters.categoryId) return false;
    if (filters.methodId && filters.methodId !== "all" && entry.method_id !== filters.methodId) return false;
    if (query && !`${entry.description} ${entry.reference} ${entry.recipient ?? ""} ${KIND_LABELS[entry.kind]} ${ACCOUNT_LABELS[entry.account]} ${entry.id}`.toLocaleLowerCase("es").includes(query)) return false;
    return true;
  }).sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
}

/** Income/expense KPIs are period-scoped; balances intentionally use all history. */
export function summarize(entries: Entry[], filters: Pick<AccountingFilters, "account" | "currency" | "dateFrom" | "dateTo">): AccountingSummary {
  const zero = (): Balance => ({ available_cents: 0, vault_cents: 0, total_cents: 0 });
  const result: AccountingSummary = { ...zero(), income_cents: 0, expense_cents: 0, net_cents: 0, accounts: { celestial: zero(), leonaris: zero() } };
  const today = accountingToday();
  for (const entry of entries) {
    if (entry.voided_at || entry.currency !== filters.currency || entry.occurred_on > today) continue;
    for (const account of ["celestial", "leonaris"] as const) {
      const impact = entryImpact(entry, account), balance = result.accounts[account];
      balance.available_cents = checkedAdd(balance.available_cents, impact.available_cents);
      balance.vault_cents = checkedAdd(balance.vault_cents, impact.vault_cents);
      balance.total_cents = checkedAdd(balance.available_cents, balance.vault_cents);
    }
    if (!entryAffectsAccount(entry, filters.account)) continue;
    const impact = entryImpact(entry, filters.account);
    result.available_cents = checkedAdd(result.available_cents, impact.available_cents);
    result.vault_cents = checkedAdd(result.vault_cents, impact.vault_cents);
    if ((!filters.dateFrom || entry.occurred_on >= filters.dateFrom) && (!filters.dateTo || entry.occurred_on <= filters.dateTo)) {
      if (entry.kind === "income") result.income_cents = checkedAdd(result.income_cents, entry.amount_cents);
      if (entry.kind === "expense") result.expense_cents = checkedAdd(result.expense_cents, entry.amount_cents);
    }
  }
  result.net_cents = result.income_cents - result.expense_cents;
  result.total_cents = checkedAdd(result.available_cents, result.vault_cents);
  return result;
}

/** Daily real OHLC of available balance. History before the filter supplies open. */
export function buildCandles(entries: Entry[], filters: Pick<AccountingFilters, "account" | "currency" | "dateFrom" | "dateTo">): Candle[] {
  const today = accountingToday();
  const sorted = entries.filter(entry => !entry.voided_at && entry.currency === filters.currency && entry.occurred_on <= today && entryAffectsAccount(entry, filters.account))
    .sort((a, b) => a.occurred_on.localeCompare(b.occurred_on) || Number(b.kind === "opening_balance") - Number(a.kind === "opening_balance") || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  let balance = 0;
  const candles: Candle[] = [];
  for (const entry of sorted) {
    if (filters.dateTo && entry.occurred_on > filters.dateTo) break;
    const delta = entryImpact(entry, filters.account).available_cents;
    const previousBalance = balance;
    balance = checkedAdd(balance, delta);
    if (filters.dateFrom && entry.occurred_on < filters.dateFrom) continue;
    let candle = candles[candles.length - 1];
    if (entry.kind === "opening_balance") {
      // Starting cash is the day's baseline, not earned volume. Opening entries
      // from both accounts are ordered before all operational movements that day.
      if (candle?.date === entry.occurred_on) {
        candle.open = checkedAdd(candle.open, delta);
        candle.high = checkedAdd(candle.high, delta);
        candle.low = checkedAdd(candle.low, delta);
        candle.close = checkedAdd(candle.close, delta);
      } else {
        candles.push({ date: entry.occurred_on, open: balance, high: balance, low: balance, close: balance, volume_cents: 0 });
      }
      continue;
    }
    if (!candle || candle.date !== entry.occurred_on) {
      candle = { date: entry.occurred_on, open: previousBalance, high: previousBalance, low: previousBalance, close: previousBalance, volume_cents: 0 };
      candles.push(candle);
    }
    candle.high = Math.max(candle.high, balance);
    candle.low = Math.min(candle.low, balance);
    candle.close = balance;
    candle.volume_cents = checkedAdd(candle.volume_cents, Math.abs(delta));
  }
  return candles;
}
