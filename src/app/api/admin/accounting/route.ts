import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}

async function uidFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  });
  const { data } = await sb.auth.getUser();
  return data.user?.id || null;
}

async function requireAdmin(req: Request) {
  const uid = await uidFromBearer(req);
  if (!uid) return { ok: false as const, error: "NO_AUTH" as const };
  const admin = adminClient();
  const { data, error } = await admin.from("workers").select("id, role").eq("user_id", uid).maybeSingle();
  if (error) throw error;
  if (!data || data.role !== "admin") return { ok: false as const, error: "FORBIDDEN" as const };
  return { ok: true as const, admin };
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.error === "NO_AUTH" ? 401 : 403 });
    const { searchParams } = new URL(req.url);
    const month_key = String(searchParams.get("month") || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`);
    const months_back = Math.max(1, Math.min(24, Number(searchParams.get("months_back") || 12)));

    const { data: entries, error } = await gate.admin.from("accounting_entries").select("*").eq("month_key", month_key).order("entry_date", { ascending: false }).order("created_at", { ascending: false });
    if (error) throw error;
    const rows = entries || [];
    const totals = rows.reduce((acc: any, row: any) => {
      const amount = Number(row?.amount_eur || 0) || 0;
      if (row?.entry_type === "income") acc.income += amount; else acc.expense += amount;
      acc.net = acc.income - acc.expense;
      return acc;
    }, { income: 0, expense: 0, net: 0 });

    const makeBreakdown = (type: "income" | "expense") => {
      const map = new Map<string, number>();
      rows.filter((r: any) => r.entry_type === type).forEach((r: any) => map.set(String(r.concept || "Sin concepto"), (map.get(String(r.concept || "Sin concepto")) || 0) + (Number(r.amount_eur || 0) || 0)));
      return Array.from(map.entries()).map(([concept, amount]) => ({ concept, amount })).sort((a, b) => Number(b.amount) - Number(a.amount));
    };

    const months = [] as any[];
    for (let i = months_back - 1; i >= 0; i--) {
      const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i);
      const mk = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      const { data: mrows } = await gate.admin.from("accounting_entries").select("entry_type, amount_eur").eq("month_key", mk);
      const agg = (mrows || []).reduce((acc: any, row: any) => {
        const amount = Number(row?.amount_eur || 0) || 0;
        if (row?.entry_type === "income") acc.income += amount; else acc.expense += amount;
        acc.net = acc.income - acc.expense;
        return acc;
      }, { income: 0, expense: 0, net: 0 });
      months.push({ month_key: mk, ...agg });
    }

    return NextResponse.json({ ok: true, totals, entries: rows, months, breakdown: { income: makeBreakdown("income"), expense: makeBreakdown("expense") } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.error === "NO_AUTH" ? 401 : 403 });
    const body = await req.json().catch(() => ({}));
    const payload = {
      month_key: String(body?.month_key || "").trim(),
      entry_date: String(body?.entry_date || "").trim(),
      entry_type: String(body?.entry_type || "expense").trim(),
      concept: String(body?.concept || "").trim(),
      amount_eur: Number(String(body?.amount_eur ?? 0).replace(",", ".")) || 0,
      note: String(body?.note || "").trim() || null,
    };
    if (!payload.month_key || !payload.entry_date || !payload.concept || !["income", "expense"].includes(payload.entry_type) || payload.amount_eur <= 0) {
      return NextResponse.json({ ok: false, error: "INVALID_PAYLOAD" }, { status: 400 });
    }
    const { error } = await gate.admin.from("accounting_entries").insert(payload);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
