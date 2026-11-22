import { accountingToday, type Account, type Category, type Currency, type Entry } from "@/lib/accounting";
import { ACCOUNTS, monthBounds, monthlySummary, safeAdd } from "@/features/accounting/monthly-model";

const currencies: Currency[] = ["EUR", "USD"];

export function officeAccountingReport(entries: Entry[], categories: Category[], month: string, now: Date) {
  const today = accountingToday(now);
  const { from, to } = monthBounds(month);
  const through = to < today ? to : today;
  const names = new Map(categories.map(category => [category.id, category.name]));
  const breakdown = new Map<string, { account: Account; currency: Currency; kind: "income" | "expense"; name: string; amount: number }>();
  for (const entry of entries) {
    if (entry.voided_at || entry.occurred_on < from || entry.occurred_on > through) continue;
    if (entry.kind !== "income" && entry.kind !== "expense") continue;
    const key = [entry.account, entry.currency, entry.kind, entry.category_id].join("|");
    const category = breakdown.get(key) || {
      account: entry.account, currency: entry.currency, kind: entry.kind,
      name: (entry.category_id && names.get(entry.category_id)) || "Sin categoría", amount: 0,
    };
    category.amount = safeAdd(category.amount, entry.amount_cents);
    breakdown.set(key, category);
  }
  const accounts = ACCOUNTS.flatMap(account => currencies.map(currency => {
    const summary = monthlySummary(entries, month, currency, account, today);
    const { income, expense, net, opening, available, openingVault, vault, transferIn, transferOut, count } = summary;
    return { account, currency, income, expense, net, opening, available, openingVault, vault, transferIn, transferOut, count };
  }));
  return {
    month, zone: "Europe/Madrid", as_of: now.toISOString(), from, through, accounts,
    categories: Array.from(breakdown.values()).sort((a, b) =>
      a.account.localeCompare(b.account) || a.currency.localeCompare(b.currency) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, "es")),
  };
}

export type OfficeAccountingReport = ReturnType<typeof officeAccountingReport>;
