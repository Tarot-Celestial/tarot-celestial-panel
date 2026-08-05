import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";

type ManualLineInput = {
  id?: string;
  description: string;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  vat_percent: number;
};

const ALLOWED_STATUS = new Set(["draft", "issued", "paid", "cancelled"]);

function money(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error("INVALID_AMOUNT");
  return Math.round(n * 100) / 100;
}

function normalizeLine(value: unknown): ManualLineInput {
  const row = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const description = String(row.description || "").trim();
  const quantity = money(row.quantity ?? 0);
  const unitPrice = money(row.unit_price ?? 0);
  const discount = money(row.discount_percent ?? 0);
  const vat = money(row.vat_percent ?? 0);
  if (!description || quantity <= 0 || discount > 100 || vat > 100) throw new Error("INVALID_LINE");
  return { id: row.id ? String(row.id) : undefined, description, quantity, unit_price: unitPrice, discount_percent: discount, vat_percent: vat };
}

function calculate(lines: ManualLineInput[]) {
  return lines.map((line) => {
    const gross = line.quantity * line.unit_price;
    const discountAmount = gross * (line.discount_percent / 100);
    const net = gross - discountAmount;
    const vatAmount = net * (line.vat_percent / 100);
    return {
      ...line,
      net_amount: money(net),
      discount_amount: money(discountAmount),
      vat_amount: money(vatAmount),
      total_amount: money(net + vatAmount),
    };
  });
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
    return NextResponse.json({ ok: true, invoice, lines: lines || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ERR";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
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

    const rawLines = Array.isArray(body.lines) ? body.lines : [];
    const calculated = calculate(rawLines.map(normalizeLine));
    if (!calculated.length) return NextResponse.json({ ok: false, error: "LINES_REQUIRED" }, { status: 400 });
    const recipientName = String(body.recipient_name || "").trim();
    const issueDate = String(body.issue_date || "").trim();
    if (!recipientName || !issueDate) return NextResponse.json({ ok: false, error: "RECIPIENT_AND_DATE_REQUIRED" }, { status: 400 });
    const status = String(body.status || "draft");
    if (!ALLOWED_STATUS.has(status)) return NextResponse.json({ ok: false, error: "INVALID_STATUS" }, { status: 400 });

    const subtotal = money(calculated.reduce((sum, line) => sum + line.quantity * line.unit_price, 0));
    const discountTotal = money(calculated.reduce((sum, line) => sum + line.discount_amount, 0));
    const taxableBase = money(calculated.reduce((sum, line) => sum + line.net_amount, 0));
    const vatTotal = money(calculated.reduce((sum, line) => sum + line.vat_amount, 0));
    const total = money(calculated.reduce((sum, line) => sum + line.total_amount, 0));
    const userId = gate.me.user_id || null;

    let invoiceId = id;
    if (id) {
      const { data: current, error: currentError } = await gate.admin.from("manual_invoices").select("status").eq("id", id).maybeSingle();
      if (currentError) throw currentError;
      if (!current || current.status !== "draft") return NextResponse.json({ ok: false, error: "ONLY_DRAFT_EDITABLE" }, { status: 400 });
      const { error } = await gate.admin.from("manual_invoices").update({
        issue_date: issueDate, due_date: body.due_date || null, status,
        recipient_name: recipientName, recipient_tax_id: String(body.recipient_tax_id || "").trim() || null,
        recipient_address: String(body.recipient_address || "").trim() || null, recipient_postal_code: String(body.recipient_postal_code || "").trim() || null,
        recipient_city: String(body.recipient_city || "").trim() || null, recipient_province: String(body.recipient_province || "").trim() || null,
        recipient_country: String(body.recipient_country || "España").trim() || "España", recipient_email: String(body.recipient_email || "").trim() || null,
        recipient_phone: String(body.recipient_phone || "").trim() || null, notes: String(body.notes || "").trim() || null,
        subtotal, discount_total: discountTotal, taxable_base: taxableBase, vat_total: vatTotal, total, updated_by: userId,
      }).eq("id", id);
      if (error) throw error;
      const { error: deleteError } = await gate.admin.from("manual_invoice_lines").delete().eq("invoice_id", id);
      if (deleteError) throw deleteError;
    } else {
      const { data: number, error: numberError } = await gate.admin.rpc("next_manual_invoice_number", { p_issue_date: issueDate });
      if (numberError) throw numberError;
      const { data: created, error } = await gate.admin.from("manual_invoices").insert({
        invoice_number: number, issue_date: issueDate, due_date: body.due_date || null, status,
        recipient_name: recipientName, recipient_tax_id: String(body.recipient_tax_id || "").trim() || null,
        recipient_address: String(body.recipient_address || "").trim() || null, recipient_postal_code: String(body.recipient_postal_code || "").trim() || null,
        recipient_city: String(body.recipient_city || "").trim() || null, recipient_province: String(body.recipient_province || "").trim() || null,
        recipient_country: String(body.recipient_country || "España").trim() || "España", recipient_email: String(body.recipient_email || "").trim() || null,
        recipient_phone: String(body.recipient_phone || "").trim() || null, notes: String(body.notes || "").trim() || null,
        subtotal, discount_total: discountTotal, taxable_base: taxableBase, vat_total: vatTotal, total, created_by: userId, updated_by: userId,
      }).select("id").single();
      if (error) throw error;
      invoiceId = String(created.id);
    }

    const lineRows = calculated.map((line, index) => ({ invoice_id: invoiceId, position: index + 1, ...line, id: undefined }));
    const { error: linesError } = await gate.admin.from("manual_invoice_lines").insert(lineRows);
    if (linesError) throw linesError;
    return NextResponse.json({ ok: true, id: invoiceId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ERR";
    console.error("[manual-invoice]", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
