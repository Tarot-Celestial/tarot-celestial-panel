import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(value: unknown) {
  const n = Number(value || 0) || 0;
  return n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function num(value: unknown, digits = 0) {
  const n = Number(value || 0) || 0;
  return n.toLocaleString("es-ES", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
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

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) {
      const status = gate.error === "NO_AUTH" ? 401 : 403;
      return NextResponse.json({ ok: false, error: gate.error }, { status });
    }

    const invoiceId = new URL(req.url).searchParams.get("invoice_id") || "";
    if (!invoiceId) {
      return NextResponse.json({ ok: false, error: "MISSING_INVOICE_ID" }, { status: 400 });
    }

    const admin = gate.admin;
    const [{ data: invoice, error: invoiceError }, { data: lines, error: linesError }] = await Promise.all([
      admin
        .from("invoices")
        .select("id, worker_id, month_key, status, total, created_at, updated_at")
        .eq("id", invoiceId)
        .maybeSingle(),
      admin
        .from("invoice_lines")
        .select("id, kind, label, amount, meta, created_at")
        .eq("invoice_id", invoiceId)
        .order("created_at", { ascending: true }),
    ]);

    if (invoiceError) throw invoiceError;
    if (linesError) throw linesError;
    if (!invoice) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }

    const [{ data: worker, error: workerError }, { data: monthInvoices, error: monthInvoicesError }] = await Promise.all([
      admin.from("workers").select("id, display_name").eq("id", invoice.worker_id).maybeSingle(),
      admin
        .from("invoices")
        .select("id, created_at")
        .eq("month_key", invoice.month_key)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
    ]);

    if (workerError) throw workerError;
    if (monthInvoicesError) throw monthInvoicesError;

    const sortedIds = (monthInvoices || []).map((row: any) => String(row.id));
    const sequence = Math.max(sortedIds.indexOf(String(invoice.id)) + 1, 1);
    const invoiceNumber = buildInvoiceNumber(String(invoice.month_key || ""), sequence);
    const origin = new URL(req.url).origin;
    const logoUrl = `${origin}/Nuevo-logo-tarot.png`;

    const rowsHtml = (lines || [])
      .map((line: any) => {
        const meta = line?.meta || {};
        const minutes = Number(meta.minutes || 0) || 0;
        const rate = Number(meta.rate || 0) || 0;
        const hasBreakdown = minutes > 0 && rate > 0;
        const detail = hasBreakdown
          ? `${num(minutes, 0)} x ${num(rate, 2)}€ = ${money(Number(line.amount || 0))}`
          : "—";

        return `
          <tr>
            <td>${esc(line.label)}</td>
            <td>${hasBreakdown ? esc(detail) : "—"}</td>
            <td class="amount">${money(line.amount)}</td>
          </tr>
        `;
      })
      .join("");

    const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>${invoiceNumber}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        --ink: #151318;
        --muted: #6f6a76;
        --line: #e8e1d6;
        --gold: #caa35f;
        --soft: #faf6ef;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: #f2efe9; color: var(--ink); font-family: Arial, Helvetica, sans-serif; }
      .page {
        width: 210mm;
        min-height: 297mm;
        margin: 0 auto;
        background: #fff;
        padding: 18mm 16mm;
      }
      .top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 20px;
        border-bottom: 2px solid var(--line);
        padding-bottom: 16px;
      }
      .brand img { width: 158px; max-width: 100%; height: auto; display: block; }
      .brand h1 { margin: 14px 0 4px; font-size: 28px; }
      .brand .sub { color: var(--muted); font-size: 13px; line-height: 1.5; }
      .meta {
        min-width: 250px;
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 16px;
        background: linear-gradient(180deg, #fff, var(--soft));
      }
      .meta h2 { margin: 0 0 10px; font-size: 20px; }
      .kv { display: grid; grid-template-columns: 110px 1fr; gap: 8px; font-size: 13px; }
      .kv div:nth-child(odd) { color: var(--muted); }
      .block-wrap { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 18px; }
      .block {
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 14px 16px;
      }
      .block h3 { margin: 0 0 10px; font-size: 15px; text-transform: uppercase; letter-spacing: .06em; color: var(--gold); }
      .block .line { font-size: 14px; line-height: 1.7; }
      table { width: 100%; border-collapse: collapse; margin-top: 18px; }
      thead th {
        text-align: left;
        padding: 12px 10px;
        background: var(--soft);
        border-bottom: 1px solid var(--line);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: .06em;
      }
      tbody td {
        padding: 12px 10px;
        border-bottom: 1px solid var(--line);
        font-size: 14px;
        vertical-align: top;
      }
      .amount { text-align: right; white-space: nowrap; font-weight: 700; }
      .total {
        margin-top: 18px;
        margin-left: auto;
        width: 280px;
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 16px;
        background: linear-gradient(180deg, #fff, var(--soft));
      }
      .total-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 15px; }
      .total-row strong { font-size: 24px; }
      .foot {
        margin-top: 22px;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.6;
      }
      @media print {
        html, body { background: #fff; }
        .page { margin: 0; width: auto; min-height: auto; padding: 14mm 12mm; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="top">
        <div class="brand">
          <img src="${logoUrl}" alt="Tarot Celestial" />
          <h1>Factura</h1>
          <div class="sub">Tarot Celestial</div>
        </div>

        <div class="meta">
          <h2>${invoiceNumber}</h2>
          <div class="kv">
            <div>Periodo</div><div>${esc(monthLabel(invoice.month_key))}</div>
            <div>Estado</div><div>${esc(String(invoice.status || "pending"))}</div>
            <div>País</div><div>España</div>
            <div>Emisor</div><div>Alex Rivera Saldaña</div>
            <div>Empresa</div><div>Tarot Celestial</div>
          </div>
        </div>
      </div>

      <div class="block-wrap">
        <div class="block">
          <h3>Emisor</h3>
          <div class="line"><strong>Alex Rivera Saldaña</strong></div>
          <div class="line">Empresa: Tarot Celestial</div>
          <div class="line">País: España</div>
        </div>
        <div class="block">
          <h3>Destinatario</h3>
          <div class="line"><strong>${esc(worker?.display_name || "Tarotista")}</strong></div>
          <div class="line">Profesional colaboradora</div>
          <div class="line">Periodo facturado: ${esc(monthLabel(invoice.month_key))}</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Concepto</th>
            <th>Detalle</th>
            <th style="text-align:right">Importe</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || `<tr><td>Sin líneas</td><td>—</td><td class="amount">${money(0)}</td></tr>`}
        </tbody>
      </table>

      <div class="total">
        <div class="total-row">
          <span>Total factura</span>
          <strong>${money(invoice.total)}</strong>
        </div>
      </div>

      <div class="foot">
        Documento generado desde el panel de facturación de Tarot Celestial. Al abrir esta vista se lanza la impresión del navegador para guardar la factura en PDF.
      </div>
    </div>
    <script>
      window.addEventListener('load', function () {
        setTimeout(function () {
          window.print();
        }, 250);
      });
    </script>
  </body>
</html>`;

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
