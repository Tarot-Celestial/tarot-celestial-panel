import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken } from "@/lib/server/auth-fast";

export const runtime = "nodejs";

type InvoiceLine = { id: string; kind: string; label: string; amount: number; created_at?: string | null; meta?: unknown };
type InvoiceRow = { id: string; worker_id: string; month_key: string; status: string; total: number; created_at?: string | null; updated_at?: string | null };

function env(name: string) { const value = process.env[name]; if (!value) throw new Error(`Missing env var: ${name}`); return value; }
function money(value: unknown) { const n = Number(value); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; }
function monthKey(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
function previousMonth(key: string) { const [y, m] = key.split("-").map(Number); const d = new Date(y, m - 2, 1); return monthKey(d); }
function isReward(kind: string) { return kind !== "salary_base" && (kind.includes("bonus") || kind.includes("reward") || kind.includes("coin") || kind.includes("recomp")); }

const MADRID_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" });

function madridDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return MADRID_DATE.format(date);
}

function currentMadridWeekStartKey(now = new Date()) {
  const todayKey = madridDateKey(now);
  const [year, month, day] = todayKey.split("-").map(Number);
  const calendarDay = new Date(Date.UTC(year, month - 1, day));
  const weekday = calendarDay.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  calendarDay.setUTCDate(calendarDay.getUTCDate() + mondayOffset);
  return calendarDay.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
    const authClient = createClient(supabaseUrl, env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), { auth: { persistSession: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    const uid = authData.user?.id || null;
    if (authError || !uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const admin = createClient(supabaseUrl, env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    const { data: worker, error: workerError } = await admin.from("workers")
      .select("id,user_id,display_name,role,team,salary_base,is_active")
      .eq("user_id", uid).maybeSingle();
    if (workerError) throw workerError;
    if (!worker || String(worker.role || "").toLowerCase() !== "central") return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const url = new URL(req.url);
    const month = url.searchParams.get("month") || monthKey();
    const previous = previousMonth(month);
    const { data: invoices, error: invoicesError } = await admin.from("invoices")
      .select("id,worker_id,month_key,status,total,created_at,updated_at")
      .eq("worker_id", worker.id).in("month_key", [month, previous]).order("created_at", { ascending: false });
    if (invoicesError) throw invoicesError;

    const invoiceRows = (invoices || []) as InvoiceRow[];
    const currentInvoice = invoiceRows.find((row: InvoiceRow) => row.month_key === month) || null;
    const previousInvoice = invoiceRows.find((row: InvoiceRow) => row.month_key === previous) || null;
    let lines: InvoiceLine[] = [];
    if (currentInvoice?.id) {
      const { data, error } = await admin.from("invoice_lines")
        .select("id,kind,label,amount,created_at,meta").eq("invoice_id", currentInvoice.id).order("created_at", { ascending: true });
      if (error) throw error;
      lines = ((data || []) as InvoiceLine[]).map((line: InvoiceLine) => ({ ...line, amount: money(line.amount) }));
    }

    const configuredSalary = money(worker.salary_base);
    const salaryLine = lines.find((line) => line.kind === "salary_base");
    const fixedSalary = salaryLine ? money(salaryLine.amount) : configuredSalary;
    const rewards = money(lines.filter((line) => isReward(line.kind)).reduce((sum, line) => sum + money(line.amount), 0));
    const invoiceTotal = currentInvoice ? money(currentInvoice.total) : money(fixedSalary + rewards);
    const todayMadrid = madridDateKey(new Date());
    const weekStartMadrid = currentMadridWeekStartKey();
    const weeklyEarnings = money(lines
      .filter((line) => {
        if (line.kind === "salary_base" || money(line.amount) <= 0 || !line.created_at) return false;
        const lineDate = madridDateKey(line.created_at);
        return Boolean(lineDate && lineDate >= weekStartMadrid && lineDate <= todayMadrid);
      })
      .reduce((sum, line) => sum + money(line.amount), 0));
    const previousTotal = previousInvoice ? money(previousInvoice.total) : 0;
    const difference = money(invoiceTotal - previousTotal);
    const variationPct = previousInvoice && previousTotal !== 0 ? Math.round((difference / Math.abs(previousTotal)) * 10000) / 100 : null;

    const evolution = [{ at: `${month}-01T00:00:00`, total: fixedSalary, label: "Nómina fija" }];
    let running = fixedSalary;
    for (const line of lines.filter((line) => line.kind !== "salary_base")) {
      running = money(running + line.amount);
      evolution.push({ at: line.created_at || currentInvoice?.updated_at || `${month}-01T00:00:00`, total: running, label: line.label || line.kind });
    }
    if (currentInvoice && evolution[evolution.length - 1]?.total !== invoiceTotal) {
      evolution.push({ at: currentInvoice.updated_at || currentInvoice.created_at || `${month}-01T00:00:00`, total: invoiceTotal, label: "Total actual" });
    }

    return NextResponse.json({
      ok: true,
      worker: { id: worker.id, display_name: worker.display_name, team: worker.team },
      month,
      invoice: currentInvoice ? { id: currentInvoice.id, status: currentInvoice.status, updated_at: currentInvoice.updated_at } : null,
      fixed_salary: fixedSalary,
      rewards,
      total: invoiceTotal,
      weekly_earnings: weeklyEarnings,
      previous: { month: previous, total: previousTotal, exists: Boolean(previousInvoice), difference, variation_pct: variationPct },
      lines,
      evolution,
      // XP/racha/fidelización todavía no tienen una fuente persistente real en este proyecto.
      // Se devuelven como no disponibles en vez de inventar valores.
      progress: { xp_month: null, total_xp: null, streak_days: null, loyalty_index: null, level: null, level_xp: null, next_level_xp: null, next_level_name: null },
      next_payment_at: null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const e = error as { code?: string; message?: string; details?: string; hint?: string };
    console.error("[central/my-invoice]", { code: e.code, message: e.message, details: e.details, hint: e.hint });
    return NextResponse.json({ ok: false, error: "MY_INVOICE_LOAD_FAILED" }, { status: 500 });
  }
}
