import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import {
  invoiceIssuerFromEnvironment,
  renderInvoiceDocument,
  type InvoiceDocumentLine,
  type InvoiceParty,
} from "@/lib/server/invoice-document";
import { compareInvoicePeriods, loadInvoiceMinuteTotals } from "@/lib/server/invoice-period-comparison";

export const runtime = "nodejs";

type UnknownRecord = Record<string, unknown>;

function num(value: unknown, digits = 0) {
  const n = Number(value || 0) || 0;
  return n.toLocaleString("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function buildInvoiceNumber(monthKey: string, index: number) {
  return `TC-${monthKey.replace("-", "")}-${String(index).padStart(4, "0")}`;
}

function monthLabel(monthKey: string) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month) return monthKey;
  const dt = new Date(Date.UTC(year, month - 1, 1));
  return dt.toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: "Europe/Madrid" });
}

function firstText(record: UnknownRecord | null | undefined, keys: string[]) {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function workerRecipient(worker: UnknownRecord | null, authUser: UnknownRecord | null): InvoiceParty {
  const metadata = authUser && typeof authUser.user_metadata === "object" && authUser.user_metadata
    ? authUser.user_metadata as UnknownRecord
    : null;

  const workerName = firstText(worker, ["full_name", "display_name", "name"]);
  const metadataName = firstText(metadata, ["full_name", "name", "display_name"]);

  return {
    name: workerName || metadataName || "Profesional colaborador/a",
    taxId: firstText(worker, ["tax_id", "nif", "nie", "cif", "document_number", "fiscal_id"]),
    address: firstText(worker, ["address", "direccion", "street_address", "fiscal_address"]),
    postalCode: firstText(worker, ["postal_code", "codigo_postal", "zip", "zip_code"]),
    city: firstText(worker, ["city", "ciudad", "locality"]),
    province: firstText(worker, ["province", "provincia", "state", "region"]),
    country: firstText(worker, ["country", "pais"]),
    email: firstText(worker, ["email"]) || firstText(authUser, ["email"]),
    phone: firstText(worker, ["phone", "telefono", "mobile", "phone_number"]) || firstText(metadata, ["phone", "telefono", "mobile"]),
  };
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) {
      const status = gate.error === "NO_AUTH" ? 401 : 403;
      return NextResponse.json({ ok: false, error: gate.error }, { status });
    }

    const invoiceId = new URL(req.url).searchParams.get("invoice_id") || "";
    if (!invoiceId) return NextResponse.json({ ok: false, error: "MISSING_INVOICE_ID" }, { status: 400 });

    const admin = gate.admin;
    const [{ data: invoice, error: invoiceError }, { data: lines, error: linesError }] = await Promise.all([
      admin.from("invoices").select("id, worker_id, month_key, status, total, notes, created_at, updated_at").eq("id", invoiceId).maybeSingle(),
      admin.from("invoice_lines").select("id, kind, label, amount, meta, created_at").eq("invoice_id", invoiceId).order("created_at", { ascending: true }),
    ]);

    if (invoiceError) throw invoiceError;
    if (linesError) throw linesError;
    if (!invoice) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });

    const previousMonthDate = new Date(`${invoice.month_key}-01T00:00:00Z`);
    previousMonthDate.setUTCMonth(previousMonthDate.getUTCMonth() - 1);
    const previousMonthKey = previousMonthDate.toISOString().slice(0, 7);
    const [{ data: worker, error: workerError }, { data: monthInvoices, error: monthInvoicesError }, { data: previousInvoice, error: previousInvoiceError }] = await Promise.all([
      admin.from("workers").select("*").eq("id", invoice.worker_id).maybeSingle(),
      admin.from("invoices").select("id, created_at").eq("month_key", invoice.month_key).order("created_at", { ascending: true }).order("id", { ascending: true }),
      admin.from("invoices").select("id, total, created_at").eq("worker_id", invoice.worker_id).eq("month_key", previousMonthKey).order("created_at", { ascending: true }).limit(1).maybeSingle(),
    ]);

    if (workerError) throw workerError;
    if (monthInvoicesError) throw monthInvoicesError;
    if (previousInvoiceError) throw previousInvoiceError;

    const minuteTotals = await loadInvoiceMinuteTotals(admin, [String(invoice.id), String(previousInvoice?.id || "")]);
    const totalComparison = compareInvoicePeriods(invoice.total, previousInvoice?.total, Boolean(previousInvoice));
    const minutesComparison = compareInvoicePeriods(
      minuteTotals.get(String(invoice.id)),
      minuteTotals.get(String(previousInvoice?.id || "")),
      Boolean(previousInvoice)
    );
    const isCentral = String(worker?.role || "").toLowerCase() === "central";

    let authUser: UnknownRecord | null = null;
    const workerRecord = (worker || null) as UnknownRecord | null;
    const userId = firstText(workerRecord, ["user_id"]);
    if (userId) {
      const { data: authData, error: authError } = await admin.auth.admin.getUserById(userId);
      if (!authError && authData?.user) authUser = authData.user as unknown as UnknownRecord;
    }

    const sortedIds = (monthInvoices || []).map((row) => String(row.id));
    const sequence = Math.max(sortedIds.indexOf(String(invoice.id)) + 1, 1);
    const invoiceNumber = buildInvoiceNumber(String(invoice.month_key || ""), sequence);
    const period = monthLabel(String(invoice.month_key || ""));

    const documentLines: InvoiceDocumentLine[] = (lines || []).map((line) => {
      const meta = line?.meta && typeof line.meta === "object" ? line.meta as UnknownRecord : {};
      const minutes = Number(meta.minutes || 0) || 0;
      const rate = Number(meta.rate || 0) || 0;
      const hasBreakdown = minutes > 0 && rate > 0;
      const detail = hasBreakdown
        ? `${num(minutes, 0)} min × ${num(rate, 2)} €/min`
        : String(line.kind || "") === "salary_base"
          ? `Periodo ${period}`
          : "—";

      return {
        concept: String(line.label || "Concepto"),
        detail,
        amount: Number(line.amount || 0) || 0,
      };
    });

    const origin = new URL(req.url).origin;
    const html = renderInvoiceDocument({
      invoiceNumber,
      issueDate: invoice.created_at || invoice.updated_at || null,
      dueDate: null,
      status: invoice.status || null,
      periodLabel: period,
      issuer: invoiceIssuerFromEnvironment(),
      recipient: workerRecipient(workerRecord, authUser),
      lines: documentLines,
      subtotal: Number(invoice.total || 0) || 0,
      vatPercent: 0,
      vatTotal: 0,
      total: Number(invoice.total || 0) || 0,
      notes: invoice.notes || null,
      logoUrl: `${origin}/Nuevo-logo-tarot.png`,
      progress: {
        currentLabel: monthLabel(String(invoice.month_key || "")),
        previousLabel: monthLabel(previousMonthKey),
        currentTotal: totalComparison.current,
        previousTotal: totalComparison.previous,
        difference: totalComparison.difference,
        changePct: totalComparison.change_pct,
        trend: totalComparison.trend,
        hasPrevious: totalComparison.has_previous,
        currentMinutes: minutesComparison.current,
        previousMinutes: minutesComparison.previous,
        minutesDifference: minutesComparison.difference,
        minutesChangePct: minutesComparison.change_pct,
        minutesTrend: minutesComparison.trend,
        showMinutes: !isCentral,
      },
    });

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[admin-invoice:pdf]", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "ERR" }, { status: 500 });
  }
}
