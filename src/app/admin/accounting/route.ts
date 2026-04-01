import { NextResponse } from "next/server";
import { normalizeMonthKey, requireAdmin, roundMoney } from "@/lib/admin/require-admin";

export const runtime = "nodejs";

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function entryTypeFromKind(kind: any): "income" | "expense" {
  const raw = String(kind || "").trim().toLowerCase();
  if (["ingreso", "ingresos", "income", "bizum", "paypal", "square"].includes(raw)) return "income";
  return "expense";
}

function normalizeKind(entryType: any, concept: any) {
  const type = String(entryType || "").trim().toLowerCase();
  const conceptValue = String(concept || "").trim();

  if (type === "income" || type === "ingreso" || type === "ingresos") {
    const c = conceptValue.toLowerCase();
    if (["bizum", "paypal", "square"].includes(c)) return c;
    return "ingresos";
  }

  const expenseConcepts = [
    "recarga",
    "facebook",
    "pago tarotista",
    "deuda",
    "pago centrales",
    "pago premium numbers",
    "pago hubspot",
  ];

  const c = conceptValue.toLowerCase();
  if (expenseConcepts.includes(c)) return c;
  return "gastos";
}

function breakdownFromEntries(entries: any[]) {
  const incomeMap = new Map<string, number>();
  const expenseMap = new Map<string, number>();

  for (const row of entries || []) {
    const concept = String(row.concept || row.kind || "Otros");
    const amount = roundMoney(row.amount || 0);
    const target = entryTypeFromKind(row.kind) === "income" ? incomeMap : expenseMap;
    target.set(concept, roundMoney((target.get(concept) || 0) + amount));
  }

  const toRows = (m: Map<string, number>) => Array.from(m.entries())
    .map(([concept, amount]) => ({ concept, amount }))
    .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));

  return {
    income: toRows(incomeMap),
    expense: toRows(expenseMap),
  };
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });

    const url = new URL(req.url);
    const month = normalizeMonthKey(url.searchParams.get("month") || monthKeyNow());
    const monthsBack = Math.max(1, Math.min(24, Number(url.searchParams.get("months_back") || 12)));

    const { data: entries, error } = await gate.admin
      .from("accounting_entries")
      .select("id, kind, concept, amount, month_key, note, created_at")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const all = entries || [];
    const currentMonthEntries = all.filter((row: any) => String(row.month_key || "") === month);

    let income = 0;
    let expense = 0;
    for (const row of currentMonthEntries) {
      if (entryTypeFromKind(row.kind) === "income") income += Number(row.amount || 0);
      else expense += Number(row.amount || 0);
    }

    const uniqueMonths = Array.from(new Set(all.map((row: any) => String(row.month_key || "")).filter(Boolean))).sort().reverse();
    const monthKeys = uniqueMonths.slice(0, monthsBack);
    const months = monthKeys.map((key) => {
      const rows = all.filter((row: any) => String(row.month_key || "") === key);
      let income = 0;
      let expense = 0;
      for (const row of rows) {
        if (entryTypeFromKind(row.kind) === "income") income += Number(row.amount || 0);
        else expense += Number(row.amount || 0);
      }
      income = roundMoney(income);
      expense = roundMoney(expense);
      return { month_key: key, income, expense, net: roundMoney(income - expense) };
    }).sort((a, b) => String(a.month_key).localeCompare(String(b.month_key)));

    return NextResponse.json({
      ok: true,
      totals: { income: roundMoney(income), expense: roundMoney(expense), net: roundMoney(income - expense) },
      entries: currentMonthEntries,
      months,
      breakdown: breakdownFromEntries(currentMonthEntries),
    });
  } catch (e: any) {
    const status = e?.message === "INVALID_MONTH_KEY" ? 400 : 500;
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const month_key = normalizeMonthKey(body?.month_key || monthKeyNow());
    const concept = String(body?.concept || "").trim();
    const entry_type = String(body?.entry_type || "expense").trim().toLowerCase();
    const note = String(body?.note || "").trim() || null;
    const amount = roundMoney(body?.amount_eur ?? body?.amount ?? 0);

    if (!concept) return NextResponse.json({ ok: false, error: "CONCEPT_REQUIRED" }, { status: 400 });
    if (!(amount > 0)) return NextResponse.json({ ok: false, error: "AMOUNT_REQUIRED" }, { status: 400 });

    const kind = normalizeKind(entry_type, concept);

    const { data, error } = await gate.admin
      .from("accounting_entries")
      .insert({ month_key, kind, concept, amount, note })
      .select("id, kind, concept, amount, month_key, note, created_at")
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({ ok: true, entry: data });
  } catch (e: any) {
    const status = ["INVALID_MONTH_KEY"].includes(e?.message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status });
  }
}
