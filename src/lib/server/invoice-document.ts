export type InvoiceParty = {
  name: string;
  company?: string | null;
  taxId?: string | null;
  taxIdLabel?: string | null;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type InvoiceDocumentLine = {
  concept: string;
  detail?: string | null;
  amount: number;
};

export type InvoiceDocumentInput = {
  invoiceNumber: string;
  issueDate?: string | null;
  dueDate?: string | null;
  status?: string | null;
  periodLabel?: string | null;
  issuer: InvoiceParty;
  recipient: InvoiceParty;
  lines: InvoiceDocumentLine[];
  subtotal: number;
  vatPercent?: number | null;
  vatTotal?: number | null;
  total: number;
  notes?: string | null;
  logoUrl: string;
};

const esc = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

export function formatMoney(value: unknown) {
  return (Number(value) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

export function formatInvoiceStatus(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  const labels: Record<string, string> = {
    draft: "Borrador",
    borrador: "Borrador",
    issued: "Emitida",
    emitida: "Emitida",
    pending: "Pendiente",
    pendiente: "Pendiente",
    paid: "Pagada",
    pagada: "Pagada",
    accepted: "Aceptada",
    aceptada: "Aceptada",
    cancelled: "Cancelada",
    canceled: "Cancelada",
    cancelada: "Cancelada",
    rejected: "Rechazada",
    rechazada: "Rechazada",
    review: "En revisión",
  };
  return labels[normalized] || (normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "—");
}

function validDateInput(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("0001-01-01") || raw.startsWith("0000-00-00")) return null;
  const date = new Date(raw.length === 10 ? `${raw}T12:00:00` : raw);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() <= 1901) return null;
  return raw;
}

export function formatInvoiceDate(value: unknown) {
  const raw = validDateInput(value);
  if (!raw) return null;
  const date = new Date(raw.length === 10 ? `${raw}T12:00:00` : raw);
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Madrid",
  }).format(date);
}

function partyLines(party: InvoiceParty) {
  const locality = [party.postalCode, party.city].filter(Boolean).join(" ");
  const region = [party.province, party.country].filter(Boolean).join(" · ");
  const contact = [party.email, party.phone].filter(Boolean).join(" · ");
  return [
    party.taxId ? `${party.taxIdLabel || "NIF/CIF"}: ${party.taxId}` : null,
    party.company && party.company !== party.name ? party.company : null,
    party.address,
    locality || null,
    region || null,
    contact || null,
  ].filter((item): item is string => Boolean(item && String(item).trim()));
}

export function invoiceIssuerFromEnvironment(): InvoiceParty {
  return {
    name: process.env.INVOICE_ISSUER_NAME || "Alex Rivera Saldaña",
    company: process.env.INVOICE_ISSUER_COMPANY || "Tarot Celestial",
    taxId: process.env.INVOICE_ISSUER_TAX_ID || "Z3163579-A",
    taxIdLabel: process.env.INVOICE_ISSUER_TAX_ID_LABEL || "NIE",
    address: process.env.INVOICE_ISSUER_ADDRESS || "Calle Sant Pere 81 2C",
    postalCode: process.env.INVOICE_ISSUER_POSTAL_CODE || null,
    city: process.env.INVOICE_ISSUER_CITY || null,
    province: process.env.INVOICE_ISSUER_PROVINCE || null,
    country: process.env.INVOICE_ISSUER_COUNTRY || "España",
    email: process.env.INVOICE_ISSUER_EMAIL || null,
    phone: process.env.INVOICE_ISSUER_PHONE || null,
  };
}

export function renderInvoiceDocument(input: InvoiceDocumentInput) {
  const issueDate = formatInvoiceDate(input.issueDate) || "—";
  const dueDate = formatInvoiceDate(input.dueDate);
  const issuerExtra = partyLines(input.issuer);
  const recipientExtra = partyLines(input.recipient);
  const vatPercent = Number(input.vatPercent || 0) || 0;
  const vatTotal = Number(input.vatTotal || 0) || 0;

  const rows = input.lines.length
    ? input.lines.map((line) => `
      <tr>
        <td>${esc(line.concept || "—")}</td>
        <td>${esc(line.detail || "—")}</td>
        <td class="amount">${formatMoney(line.amount)}</td>
      </tr>`).join("")
    : `<tr><td>Sin conceptos</td><td>—</td><td class="amount">${formatMoney(0)}</td></tr>`;

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(input.invoiceNumber)}</title>
  <style>
    :root{--ink:#17131b;--muted:#716a78;--gold:#b78a3b;--line:#e7ddca;--soft:#faf7f1;--violet:#7653ad}
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;background:#eee9e0;color:var(--ink);font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .page{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:17mm 17mm 18mm}
    .head{display:flex;justify-content:space-between;gap:22px;align-items:flex-start;border-bottom:3px solid #c8a45d;padding-bottom:17px}
    .brand{display:flex;gap:14px;align-items:center;min-width:0}.brand img{width:62px;height:62px;object-fit:contain;flex:none}.brand h1{margin:0;font-size:28px;line-height:1.05}.brand p{margin:5px 0 0;color:var(--muted);font-size:13px}
    .invoice-meta{text-align:right;min-width:245px}.invoice-meta h2{margin:0 0 9px;color:#9a7024;font-size:22px;overflow-wrap:anywhere}.meta-line{font-size:13px;margin:4px 0}.status{display:inline-block;margin-top:6px;padding:5px 9px;border-radius:999px;background:#f0e8fb;color:#68459d;font-weight:800;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
    .parties{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:22px}.party{padding:16px;background:var(--soft);border:1px solid var(--line);min-height:126px}.party h3{margin:0 0 10px;text-transform:uppercase;letter-spacing:.08em;font-size:11px;color:#8b672a}.party strong{display:block;font-size:15px;margin-bottom:5px}.party-line{font-size:12.5px;line-height:1.55;color:#3f3944;overflow-wrap:anywhere}
    .period{margin:16px 0 0;font-size:12.5px;color:var(--muted)}
    table{width:100%;border-collapse:collapse;margin-top:22px;table-layout:fixed;page-break-inside:auto}thead{display:table-header-group}tr{page-break-inside:avoid;page-break-after:auto}th{background:#20182b;color:#fff;text-align:left;padding:10px;font-size:12px;text-transform:uppercase;letter-spacing:.05em}th:nth-child(1){width:31%}th:nth-child(2){width:49%}th:nth-child(3){width:20%;text-align:right}td{padding:10px;border-bottom:1px solid #e9e2d7;vertical-align:top;font-size:12.5px;line-height:1.45;overflow-wrap:anywhere}.amount{text-align:right;white-space:nowrap;font-weight:700}
    .totals{margin-left:auto;width:315px;max-width:100%;margin-top:22px;break-inside:avoid}.total-row{display:flex;justify-content:space-between;gap:16px;padding:7px 4px;font-size:13px}.grand{font-size:19px;font-weight:900;border-top:2px solid #c8a45d;padding-top:10px;margin-top:3px}.notes{margin-top:27px;padding:14px;border:1px solid var(--line);background:#fffdfa;break-inside:avoid}.notes b{font-size:12px;text-transform:uppercase;letter-spacing:.06em}.notes p{margin:7px 0 0;white-space:pre-wrap;line-height:1.5;font-size:12.5px}
    .foot{margin-top:24px;padding-top:10px;border-top:1px solid #eee7db;color:#8a828e;font-size:10.5px;text-align:center}
    @page{size:A4 portrait;margin:0}
    @media print{html,body{background:#fff}.page{margin:0;width:210mm;min-height:297mm;padding:17mm}.no-print{display:none}}
    @media(max-width:760px){.page{width:100%;min-height:0;padding:24px}.head{flex-direction:column}.invoice-meta{text-align:left;min-width:0}.parties{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <main class="page">
    <header class="head">
      <div class="brand">
        <img src="${esc(input.logoUrl)}" alt="Tarot Celestial" />
        <div><h1>${esc(input.issuer.company || input.issuer.name)}</h1><p>Factura</p></div>
      </div>
      <div class="invoice-meta">
        <h2>${esc(input.invoiceNumber)}</h2>
        <div class="meta-line"><b>Emisión:</b> ${esc(issueDate)}</div>
        ${dueDate ? `<div class="meta-line"><b>Vencimiento:</b> ${esc(dueDate)}</div>` : ""}
        ${input.periodLabel ? `<div class="meta-line"><b>Periodo:</b> ${esc(input.periodLabel)}</div>` : ""}
        <div class="status">${esc(formatInvoiceStatus(input.status))}</div>
      </div>
    </header>

    <section class="parties">
      <div class="party">
        <h3>Emisor</h3>
        <strong>${esc(input.issuer.name)}</strong>
        ${issuerExtra.map((line) => `<div class="party-line">${esc(line)}</div>`).join("")}
      </div>
      <div class="party">
        <h3>Destinatario</h3>
        <strong>${esc(input.recipient.name || "—")}</strong>
        ${recipientExtra.map((line) => `<div class="party-line">${esc(line)}</div>`).join("")}
      </div>
    </section>

    <table>
      <thead><tr><th>Concepto</th><th>Detalle</th><th>Importe</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <section class="totals">
      <div class="total-row"><span>Subtotal</span><b>${formatMoney(input.subtotal)}</b></div>
      <div class="total-row"><span>IVA ${vatPercent.toLocaleString("es-ES", { maximumFractionDigits: 2 })}%</span><b>${formatMoney(vatTotal)}</b></div>
      <div class="total-row grand"><span>TOTAL</span><b>${formatMoney(input.total)}</b></div>
    </section>

    ${input.notes ? `<section class="notes"><b>Observaciones</b><p>${esc(input.notes)}</p></section>` : ""}
    <footer class="foot">Documento generado desde el panel de facturación de Tarot Celestial.</footer>
  </main>
  <script>window.addEventListener('load',function(){setTimeout(function(){window.print()},250)});</script>
</body>
</html>`;
}
