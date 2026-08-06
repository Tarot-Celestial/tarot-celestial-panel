import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";

type ManualInvoiceLineInput = {
  concept: string;
  detail: string;
  amount: number;
};

type SupabaseLikeError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

const ALLOWED_STATUS = new Set(["draft", "issued", "paid", "cancelled"]);

function normalizeMoney(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error("INVALID_AMOUNT");
  return Math.round(numeric * 100) / 100;
}

function normalizeLine(value: unknown): ManualInvoiceLineInput {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const concept = String(row.concept || row.description || "").trim();
  const detail = String(row.detail || "").trim();
  const amount = normalizeMoney(row.amount ?? row.unit_price ?? 0);
  if (!concept || amount <= 0) throw new Error("INVALID_LINE");
  return { concept, detail, amount };
}

function diagnostic(error: unknown) {
  const value = error && typeof error === "object" ? error as SupabaseLikeError : {};
  return {
    code: value.code || null,
    message: value.message || (error instanceof Error ? error.message : "UNKNOWN_ERROR"),
    details: value.details || null,
    hint: value.hint || null,
  };
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ ok: false, error: "MISSING_ID" }, { status: 400 });

    const [{ data: invoice, error: invoiceError }, { data: lines, error: linesError }] = await Promise.all([
      gate.admin.from("manual_invoices").select("*").eq("id", id).maybeSingle(),
      gate.admin.from("manual_invoice_lines").select("*").eq("invoice_id", id).order("position", { ascending: true }),
    ]);
    if (invoiceError) throw invoiceError;
    if (linesError) throw linesError;
    if (!invoice) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });

    return NextResponse.json({ ok: true, invoice, lines: lines || [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const info = diagnostic(error);
    console.error("[manual-invoice:load]", info);
    return NextResponse.json({ ok: false, error: info.message, diagnostic: info }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = body.id ? String(body.id) : "";
    const action = String(body.action || (id ? "update" : "create"));

    if (action === "set_status") {
      const status = String(body.status || "");
      if (!id || !ALLOWED_STATUS.has(status)) return NextResponse.json({ ok: false, error: "INVALID_STATUS" }, { status: 400 });
      const { data: current, error: currentError } = await gate.admin.from("manual_invoices").select("status").eq("id", id).maybeSingle();
      if (currentError) throw currentError;
      if (!current) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
      if (current.status !== "draft" && status === "draft") return NextResponse.json({ ok: false, error: "CANNOT_RETURN_TO_DRAFT" }, { status: 400 });
      const { error } = await gate.admin.from("manual_invoices").update({ status, updated_by: gate.me.user_id || null }).eq("id", id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    const recipientName = String(body.recipient_name || "").trim();
    const issueDate = String(body.issue_date || "").trim();
    const status = String(body.status || "draft");
    const vatPercent = normalizeMoney(body.vat_percent ?? 0);
    const lines = (Array.isArray(body.lines) ? body.lines : []).map(normalizeLine);

    if (!recipientName || !issueDate) return NextResponse.json({ ok: false, error: "RECIPIENT_AND_DATE_REQUIRED" }, { status: 400 });
    if (!ALLOWED_STATUS.has(status)) return NextResponse.json({ ok: false, error: "INVALID_STATUS" }, { status: 400 });
    if (vatPercent > 100) return NextResponse.json({ ok: false, error: "INVALID_VAT" }, { status: 400 });
    if (!lines.length) return NextResponse.json({ ok: false, error: "LINES_REQUIRED" }, { status: 400 });

    const payload = {
      id: id || null,
      issue_date: issueDate,
      due_date: String(body.due_date || "").trim() || null,
      status,
      recipient_name: recipientName,
      recipient_tax_id: String(body.recipient_tax_id || "").trim() || null,
      recipient_address: String(body.recipient_address || "").trim() || null,
      recipient_postal_code: String(body.recipient_postal_code || "").trim() || null,
      recipient_city: String(body.recipient_city || "").trim() || null,
      recipient_province: String(body.recipient_province || "").trim() || null,
      recipient_country: String(body.recipient_country || "España").trim() || "España",
      recipient_email: String(body.recipient_email || "").trim() || null,
      recipient_phone: String(body.recipient_phone || "").trim() || null,
      notes: String(body.notes || "").trim() || null,
      vat_percent: vatPercent,
      lines,
      user_id: gate.me.user_id || null,
    };

    const { data, error } = await gate.admin.rpc("save_manual_invoice_v2", { p_payload: payload });
    if (error) {
      console.error("[manual-invoice:save]", {
        ...diagnostic(error),
        endpoint: "/api/admin/invoices/manual",
        payload: {
          id: payload.id,
          issue_date: payload.issue_date,
          status: payload.status,
          recipient_name: payload.recipient_name,
          vat_percent: payload.vat_percent,
          line_count: payload.lines.length,
          amounts: payload.lines.map((line) => line.amount),
        },
      });
      throw error;
    }

    const result = data && typeof data === "object" ? data as Record<string, unknown> : {};
    return NextResponse.json({ ok: true, id: String(result.id || id || ""), invoice_number: result.invoice_number || null });
  } catch (error) {
    const info = diagnostic(error);
    console.error("[manual-invoice]", info);
    const publicError = ["INVALID_AMOUNT", "INVALID_LINE", "INVALID_VAT"].includes(info.message) ? info.message : "MANUAL_INVOICE_SAVE_FAILED";
    return NextResponse.json({ ok: false, error: publicError, diagnostic: info }, { status: 500 });
  }
}
