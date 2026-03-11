import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function uidFromBearer(req: Request) {
  const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { uid: null as string | null };

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = await userClient.auth.getUser();
  return { uid: data.user?.id || null };
}

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(month: string) {
  const [y, m] = String(month || "").split("-").map(Number);
  if (!y || !m) throw new Error("INVALID_MONTH");

  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const d = new Date(y, m, 0);
  const to = `${y}-${String(m).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  return { from, to };
}

function roundMoney(n: any) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function requireAdmin(req: Request) {
  const { uid } = await uidFromBearer(req);
  if (!uid) return { ok: false as const, error: "NO_AUTH" as const };

  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(url, service, { auth: { persistSession: false } });

  const { data: me, error } = await admin
    .from("workers")
    .select("id, role")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;
  if (!me || me.role !== "admin") return { ok: false as const, error: "FORBIDDEN" as const };

  return { ok: true as const, admin, me };
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });

    const { admin } = gate;
    const u = new URL(req.url);

    const month = u.searchParams.get("month") || monthKeyNow();
    const monthsBack = Math.max(1, Math.min(24, Number(u.searchParams.get("months_back") || 12)));

    const { from, to } = monthBounds(month);

    const { data: entries, error: entriesErr } = await admin
      .from("accounting_entries")
      .select("id, month_key, entry_date, entry_type, concept, amount_eur, note, created_at, updated_at")
      .eq("month_key", month)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (entriesErr) throw entriesErr;

    const now = new Date();
    const monthKeys: string[] = [];
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }

    const oldestMonth = monthKeys[0];
    const oldestBounds = monthBounds(oldestMonth);

    const { data: allRows, error: allErr } = await admin
      .from("accounting_entries")
      .select("month_key, entry_type, concept, amount_eur")
      .gte("entry_date", oldestBounds.from)
      .lte("entry_date", to)
      .order("month_key", { ascending: true });

    if (allErr) throw allErr;

    const monthMap = new Map<string, { income: number; expense: number; net: number }>();
    for (const mk of monthKeys) {
      monthMap.set(mk, { income: 0, expense: 0, net: 0 });
    }

    const expenseByConcept = new Map<string, number>();
    const incomeByConcept = new Map<string, number>();

    for (const row of allRows || []) {
      const mk = String(row.month_key || "");
      const type = String(row.entry_type || "");
      const amt = Number(row.amount_eur || 0);
      const concept = String(row.concept || "—");

      if (monthMap.has(mk)) {
        const cur = monthMap.get(mk)!;
        if (type === "income") cur.income += amt;
        if (type === "expense") cur.expense += amt;
        cur.net = cur.income - cur.expense;
      }

      if (mk === month) {
        if (type === "expense") expenseByConcept.set(concept, (expenseByConcept.get(concept) || 0) + amt);
        if (type === "income") incomeByConcept.set(concept, (incomeByConcept.get(concept) || 0) + amt);
      }
    }

    const months = monthKeys.map((mk) => ({
      month_key: mk,
      income: roundMoney(monthMap.get(mk)?.income || 0),
      expense: roundMoney(monthMap.get(mk)?.expense || 0),
      net: roundMoney(monthMap.get(mk)?.net || 0),
    }));

    const totals = {
      income: roundMoney((entries || []).filter((x: any) => x.entry_type === "income").reduce((a: number, x: any) => a + Number(x.amount_eur || 0), 0)),
      expense: roundMoney((entries || []).filter((x: any) => x.entry_type === "expense").reduce((a: number, x: any) => a + Number(x.amount_eur || 0), 0)),
    };
    const net = roundMoney(totals.income - totals.expense);

    return NextResponse.json({
      ok: true,
      month,
      totals: { ...totals, net },
      entries: entries || [],
      months,
      breakdown: {
        expense: Array.from(expenseByConcept.entries())
          .map(([concept, amount]) => ({ concept, amount: roundMoney(amount) }))
          .sort((a, b) => b.amount - a.amount),
        income: Array.from(incomeByConcept.entries())
          .map(([concept, amount]) => ({ concept, amount: roundMoney(amount) }))
          .sort((a, b) => b.amount - a.amount),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });

    const { admin, me } = gate;
    const body = await req.json().catch(() => ({}));

    const entry_type = String(body?.entry_type || "");
    const concept = String(body?.concept || "").trim();
    const amount_eur = roundMoney(body?.amount_eur || 0);
    const note = String(body?.note || "").trim() || null;
    const entry_date = String(body?.entry_date || "");
    const month_key = String(body?.month_key || "");

    if (entry_type !== "income" && entry_type !== "expense") {
      return NextResponse.json({ ok: false, error: "INVALID_ENTRY_TYPE" }, { status: 400 });
    }

    if (!concept) {
      return NextResponse.json({ ok: false, error: "CONCEPT_REQUIRED" }, { status: 400 });
    }

    if (!entry_date) {
      return NextResponse.json({ ok: false, error: "ENTRY_DATE_REQUIRED" }, { status: 400 });
    }

    if (!month_key) {
      return NextResponse.json({ ok: false, error: "MONTH_REQUIRED" }, { status: 400 });
    }

    if (!(amount_eur > 0)) {
      return NextResponse.json({ ok: false, error: "AMOUNT_REQUIRED" }, { status: 400 });
    }

    const { error } = await admin.from("accounting_entries").insert({
      month_key,
      entry_date,
      entry_type,
      concept,
      amount_eur,
      note,
      created_by_worker_id: me.id,
    });

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
