import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import {
  invoiceIssuerFromEnvironment,
  renderInvoiceDocument,
  type InvoiceDocumentLine,
} from "@/lib/server/invoice-document";

export const runtime = "nodejs";

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

    const documentLines: InvoiceDocumentLine[] = (lines || []).map((line) => ({
      concept: String(line.concept || line.description || ""),
      detail: String(line.detail || ""),
      amount: Number(line.amount ?? line.unit_price ?? 0) || 0,
    }));

    const vatPercent = Number(invoice.vat_percent ?? lines?.[0]?.vat_percent ?? 0) || 0;
    const origin = new URL(req.url).origin;

    const html = renderInvoiceDocument({
      invoiceNumber: String(invoice.invoice_number || "Factura manual"),
      issueDate: invoice.issue_date || invoice.created_at || null,
      dueDate: invoice.due_date || null,
      status: invoice.status || null,
      issuer: invoiceIssuerFromEnvironment(),
      recipient: {
        name: String(invoice.recipient_name || ""),
        taxId: invoice.recipient_tax_id || null,
        address: invoice.recipient_address || null,
        postalCode: invoice.recipient_postal_code || null,
        city: invoice.recipient_city || null,
        province: invoice.recipient_province || null,
        country: invoice.recipient_country || null,
        email: invoice.recipient_email || null,
        phone: invoice.recipient_phone || null,
      },
      lines: documentLines,
      subtotal: Number(invoice.taxable_base ?? invoice.subtotal ?? 0) || 0,
      vatPercent,
      vatTotal: Number(invoice.vat_total || 0) || 0,
      total: Number(invoice.total || 0) || 0,
      notes: invoice.notes || null,
      logoUrl: `${origin}/Nuevo-logo-tarot.png`,
    });

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[manual-invoice:pdf]", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "ERR" }, { status: 500 });
  }
}
