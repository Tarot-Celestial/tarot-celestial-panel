import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";

const esc = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (value: unknown) => (Number(value) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });

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

    const origin = new URL(req.url).origin;
    const rows = (lines || []).map((line) => {
      const concept = line.concept || line.description || "";
      const detail = line.detail || "";
      const amount = line.amount ?? line.unit_price ?? 0;
      return `<tr><td>${esc(concept)}</td><td>${esc(detail)}</td><td class="amount">${money(amount)}</td></tr>`;
    }).join("");
    const vatPercent = Number(invoice.vat_percent ?? (lines?.[0]?.vat_percent || 0));

    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(invoice.invoice_number)}</title><style>
      *{box-sizing:border-box}body{margin:0;background:#eee9e0;font-family:Arial;color:#17131b}.page{width:210mm;min-height:297mm;margin:auto;background:white;padding:18mm}.head{display:flex;justify-content:space-between;border-bottom:3px solid #c8a45d;padding-bottom:18px}.logo{display:flex;gap:14px;align-items:center}.logo img{width:62px;height:62px;object-fit:contain}.gold{color:#9a7024}.recipient{margin:24px 0;padding:18px;background:#faf7f1;border:1px solid #e7ddca}.meta{display:grid;grid-template-columns:1fr 1fr;gap:6px 30px}table{width:100%;border-collapse:collapse;margin-top:24px;table-layout:fixed}th{background:#20182b;color:white;text-align:left;padding:10px}th:nth-child(1){width:31%}th:nth-child(2){width:49%}th:nth-child(3){width:20%;text-align:right}td{padding:10px;border-bottom:1px solid #e9e2d7;vertical-align:top;overflow-wrap:anywhere}.amount{text-align:right;white-space:nowrap}.totals{margin-left:auto;width:310px;margin-top:24px}.totals div{display:flex;justify-content:space-between;padding:7px}.total{font-size:20px;font-weight:bold;border-top:2px solid #c8a45d}.notes{margin-top:30px;padding:15px;border:1px solid #e7ddca}.status{text-transform:uppercase;font-weight:bold;color:#7954bb}@media print{body{background:white}.page{margin:0}}
    </style></head><body><main class="page"><header class="head"><div class="logo"><img src="${origin}/Nuevo-logo-tarot.png"><div><h1>Tarot Celestial</h1><div>Factura manual</div></div></div><div><h2 class="gold">${esc(invoice.invoice_number)}</h2><div>Emisión: ${esc(invoice.issue_date)}</div>${invoice.due_date ? `<div>Vencimiento: ${esc(invoice.due_date)}</div>` : ""}<div class="status">${esc(invoice.status)}</div></div></header><section class="recipient"><h3>Destinatario</h3><div class="meta"><div><b>${esc(invoice.recipient_name)}</b></div><div>${esc(invoice.recipient_tax_id || "")}</div><div>${esc(invoice.recipient_address || "")}</div><div>${esc(invoice.recipient_postal_code || "")} ${esc(invoice.recipient_city || "")}</div><div>${esc(invoice.recipient_province || "")} · ${esc(invoice.recipient_country || "")}</div><div>${esc(invoice.recipient_email || "")} ${esc(invoice.recipient_phone || "")}</div></div></section><table><thead><tr><th>Concepto</th><th>Detalle</th><th>Importe</th></tr></thead><tbody>${rows}</tbody></table><section class="totals"><div><span>Subtotal</span><b>${money(invoice.taxable_base ?? invoice.subtotal)}</b></div><div><span>IVA ${vatPercent}%</span><b>${money(invoice.vat_total)}</b></div><div class="total"><span>TOTAL</span><b>${money(invoice.total)}</b></div></section>${invoice.notes ? `<section class="notes"><b>Observaciones</b><p>${esc(invoice.notes)}</p></section>` : ""}</main><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));</script></body></html>`;

    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[manual-invoice:pdf]", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "ERR" }, { status: 500 });
  }
}
