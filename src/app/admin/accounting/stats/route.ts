import { NextResponse } from "next/server";
import { normalizeMonthKey, requireAdmin, roundMoney } from "@/lib/admin/require-admin";

export const runtime = "nodejs";

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function isIncome(kind: any) {
  return ["ingreso", "ingresos", "income", "bizum", "paypal", "square"].includes(String(kind || "").trim().toLowerCase());
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });

    const url = new URL(req.url);
    const month = normalizeMonthKey(url.searchParams.get("month") || monthKeyNow());

    const { data, error } = await gate.admin
      .from("accounting_entries")
      .select("kind, concept, amount, month_key")
      .eq("month_key", month);

    if (error) throw error;

    const rows = data || [];
    const totals = rows.reduce((acc: any, row: any) => {
      const amount = Number(row.amount || 0);
      if (isIncome(row.kind)) acc.income += amount;
      else acc.expense += amount;
      return acc;
    }, { income: 0, expense: 0 });

    return NextResponse.json({
      ok: true,
      month_key: month,
      income: roundMoney(totals.income),
      expense: roundMoney(totals.expense),
      net: roundMoney(totals.income - totals.expense),
      entries_count: rows.length,
    });
  } catch (e: any) {
    const status = e?.message === "INVALID_MONTH_KEY" ? 400 : 500;
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status });
  }
}
