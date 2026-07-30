import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";

export const runtime = "nodejs";

type InvoiceSummary = {
  invoice_id: string;
  worker_id: string;
  display_name: string;
  role: string;
  month_key: string;
  status: string;
  total: number;
  updated_at?: string | null;
  created_at?: string | null;
  worker_ack?: string | null;
  worker_ack_at?: string | null;
  worker_ack_note?: string | null;
};

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

  createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = getAuthUserFromRequest(req);
  return { uid: data.user?.id || null };
}

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function previousMonthKey(monthKey: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ""));
  if (!match) return monthKeyNow();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}

function safeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentageChange(current: number, previous: number, hasPrevious: boolean) {
  if (!hasPrevious) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round((((current - previous) / Math.abs(previous)) * 100) * 100) / 100;
}

function directionFromValues(current: number, previous: number, hasPrevious: boolean) {
  if (!hasPrevious || Math.abs(current - previous) < 0.005) return "neutral";
  return current > previous ? "up" : "down";
}

function minutesFromMeta(meta: unknown) {
  if (!meta) return 0;
  if (typeof meta === "object") return safeNumber((meta as Record<string, unknown>).minutes);
  if (typeof meta !== "string") return 0;
  try {
    const parsed = JSON.parse(meta);
    return safeNumber(parsed?.minutes);
  } catch {
    return 0;
  }
}

async function loadInvoiceMinutes(admin: any, invoiceIds: string[]) {
  const uniqueIds = Array.from(new Set(invoiceIds.filter(Boolean)));
  const totals = new Map<string, number>();
  if (!uniqueIds.length) return totals;

  const { data, error } = await admin
    .from("invoice_lines")
    .select("invoice_id, kind, meta")
    .in("invoice_id", uniqueIds);

  if (error) throw error;

  for (const line of data || []) {
    const invoiceId = String(line?.invoice_id || "");
    const kind = String(line?.kind || "");
    if (!invoiceId || !kind.startsWith("minutes_")) continue;
    const minutes = minutesFromMeta(line?.meta);
    totals.set(invoiceId, (totals.get(invoiceId) || 0) + minutes);
  }

  return totals;
}

async function loadInvoicesWithoutView(admin: any, month: string, activeWorkerIds: Set<string>) {
  const { data: invoices, error: invoicesError } = await admin
    .from("invoices")
    .select("id, worker_id, month_key, status, total, updated_at, created_at, worker_ack, worker_ack_at, worker_ack_note")
    .eq("month_key", month);

  if (invoicesError) throw invoicesError;

  const workerIds = Array.from(new Set((invoices || []).map((x: any) => x.worker_id).filter(Boolean)));
  let workers: any[] = [];

  if (workerIds.length) {
    const { data: workersData, error: workersError } = await admin
      .from("workers")
      .select("id, display_name, role, is_active")
      .in("id", workerIds)
      .or("is_active.is.null,is_active.eq.true");

    if (workersError) throw workersError;
    workers = workersData || [];
  }

  const workersById = new Map<string, any>();
  for (const worker of workers) workersById.set(String(worker.id), worker);

  return (invoices || [])
    .filter((invoice: any) => activeWorkerIds.has(String(invoice.worker_id)))
    .map((invoice: any) => ({
      invoice_id: String(invoice.id),
      worker_id: String(invoice.worker_id),
      display_name: workersById.get(String(invoice.worker_id))?.display_name || "—",
      role: workersById.get(String(invoice.worker_id))?.role || "—",
      month_key: invoice.month_key,
      status: invoice.status,
      total: safeNumber(invoice.total),
      updated_at: invoice.updated_at,
      created_at: invoice.created_at,
      worker_ack: invoice.worker_ack || null,
      worker_ack_at: invoice.worker_ack_at || null,
      worker_ack_note: invoice.worker_ack_note || null,
    })) as InvoiceSummary[];
}

export async function GET(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: me } = await admin
      .from("workers")
      .select("role")
      .eq("user_id", uid)
      .maybeSingle();

    if (me?.role !== "admin") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const requestUrl = new URL(req.url);
    const month = requestUrl.searchParams.get("month") || monthKeyNow();
    const previousMonth = previousMonthKey(month);

    const { data: activeWorkers, error: activeWorkersError } = await admin
      .from("workers")
      .select("id")
      .or("is_active.is.null,is_active.eq.true");

    if (activeWorkersError) throw activeWorkersError;

    const activeWorkerIds = new Set((activeWorkers || []).map((worker: any) => String(worker.id)));

    const { data: viewRows, error: viewError } = await admin
      .from("v_invoice_full")
      .select("invoice_id,worker_id,display_name,role,month_key,status,total,updated_at,created_at,worker_ack,worker_ack_at,worker_ack_note")
      .eq("month_key", month)
      .order("role", { ascending: true })
      .order("display_name", { ascending: true });

    const currentInvoices: InvoiceSummary[] = viewError
      ? await loadInvoicesWithoutView(admin, month, activeWorkerIds)
      : (viewRows || [])
          .filter((invoice: any) => activeWorkerIds.has(String(invoice.worker_id)))
          .map((invoice: any) => ({
            ...invoice,
            invoice_id: String(invoice.invoice_id),
            worker_id: String(invoice.worker_id),
            total: safeNumber(invoice.total),
          }));

    const { data: previousInvoicesData, error: previousInvoicesError } = await admin
      .from("invoices")
      .select("id, worker_id, total, created_at")
      .eq("month_key", previousMonth)
      .order("created_at", { ascending: true });

    if (previousInvoicesError) throw previousInvoicesError;

    const previousByWorker = new Map<string, { invoice_id: string; total: number }>();
    for (const invoice of previousInvoicesData || []) {
      const workerId = String(invoice?.worker_id || "");
      if (!workerId || previousByWorker.has(workerId)) continue;
      previousByWorker.set(workerId, {
        invoice_id: String(invoice.id),
        total: safeNumber(invoice.total),
      });
    }

    const minuteTotals = await loadInvoiceMinutes(admin, [
      ...currentInvoices.map((invoice) => invoice.invoice_id),
      ...Array.from(previousByWorker.values()).map((invoice) => invoice.invoice_id),
    ]);

    const enrichedInvoices = currentInvoices.map((invoice) => {
      const previous = previousByWorker.get(invoice.worker_id) || null;
      const currentMinutes = safeNumber(minuteTotals.get(invoice.invoice_id));
      const previousMinutes = previous ? safeNumber(minuteTotals.get(previous.invoice_id)) : 0;
      const isCentral = String(invoice.role || "").toLowerCase() === "central";
      const totalChangePct = percentageChange(safeNumber(invoice.total), previous?.total || 0, Boolean(previous));
      const minutesChangePct = isCentral
        ? null
        : percentageChange(currentMinutes, previousMinutes, Boolean(previous));

      return {
        ...invoice,
        previous_month_key: previousMonth,
        previous_total: previous ? previous.total : null,
        current_minutes: currentMinutes,
        previous_minutes: previous ? previousMinutes : null,
        total_change_pct: totalChangePct,
        minutes_change_pct: minutesChangePct,
        total_trend: directionFromValues(safeNumber(invoice.total), previous?.total || 0, Boolean(previous)),
        minutes_trend: isCentral
          ? "neutral"
          : directionFromValues(currentMinutes, previousMinutes, Boolean(previous)),
        has_previous_invoice: Boolean(previous),
        trend_basis: isCentral ? "fixed_salary" : "minutes",
      };
    });

    enrichedInvoices.sort((a, b) => {
      const roleCompare = String(a.role || "").localeCompare(String(b.role || ""), "es");
      if (roleCompare !== 0) return roleCompare;
      return String(a.display_name || "").localeCompare(String(b.display_name || ""), "es");
    });

    return NextResponse.json({
      ok: true,
      month,
      previous_month: previousMonth,
      invoices: enrichedInvoices,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
