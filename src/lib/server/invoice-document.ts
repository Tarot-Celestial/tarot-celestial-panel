export type InvoiceParty = {
  name: string;
  role?: string | null;
  company?: string | null;
  taxId?: string | null;
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
  progress?: InvoiceDocumentProgress | null;
  codeProgress?: InvoiceCodeProgress | null;
};

export type InvoiceCodeProgress = {
  currentLabel: string;
  previousLabel: string;
  hasPrevious: boolean;
  codes: Array<{
    code: string;
    current: number;
    previous: number | null;
    difference: number | null;
    change_pct: number | null;
    trend: "up" | "down" | "neutral";
    has_previous: boolean;
  }>;
};

export type InvoiceDocumentProgress = {
  currentLabel: string;
  previousLabel: string;
  currentTotal: number;
  previousTotal: number | null;
  difference: number | null;
  changePct: number | null;
  trend: "up" | "down" | "neutral";
  hasPrevious: boolean;
  currentMinutes?: number | null;
  previousMinutes?: number | null;
  minutesDifference?: number | null;
  minutesChangePct?: number | null;
  minutesTrend?: "up" | "down" | "neutral";
  showMinutes?: boolean;
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
    party.role ? `Rol: ${party.role}` : null,
    party.company && party.company !== party.name ? `Empresa: ${party.company}` : null,
    party.taxId ? `NIF/CIF: ${party.taxId}` : null,
    party.address ? `Dirección: ${party.address}` : null,
    locality ? `Localidad: ${locality}` : null,
    region ? `País / región: ${region}` : null,
    contact ? `Contacto: ${contact}` : null,
  ].filter((item): item is string => Boolean(item && String(item).trim()));
}

export function invoiceIssuerFromEnvironment(): InvoiceParty {
  return {
    name: process.env.INVOICE_ISSUER_NAME || "Alex Rivera Saldaña",
    company: process.env.INVOICE_ISSUER_COMPANY || "Tarot Celestial",
    taxId: process.env.INVOICE_ISSUER_TAX_ID || null,
    address: process.env.INVOICE_ISSUER_ADDRESS || null,
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
  const progress = input.progress;
  const codeProgress = input.codeProgress;

  const signedMoney = (value: number | null) => value === null
    ? "—"
    : `${value > 0 ? "+" : ""}${formatMoney(value)}`;
  const percent = (value: number | null) => value === null
    ? "No calculable"
    : `${value > 0 ? "+" : ""}${value.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
  const unsignedPercent = (value: number | null) => value === null
    ? ""
    : `${Math.abs(value).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
  const progressMessage = !progress?.hasPrevious
    ? "Este será tu primer punto de referencia para comparar tu progreso en los próximos meses."
    : progress.trend === "up"
      ? (Number(progress.changePct || 0) >= 10
        ? `Excelente evolución. Este mes has superado tu facturación anterior en un ${unsignedPercent(progress.changePct)}.`
        : "Buen progreso. Has aumentado tu facturación respecto al mes anterior.")
      : progress.trend === "down"
        ? "Este mes estás por debajo del periodo anterior. Utiliza esta referencia para seguir tu evolución."
        : "Te mantienes estable respecto al mes anterior.";
  const chartMax = progress?.hasPrevious ? Math.max(progress.currentTotal, Number(progress.previousTotal || 0), 1) : Math.max(progress?.currentTotal || 0, 1);
  const previousBar = progress?.hasPrevious ? Math.max(2, (Number(progress.previousTotal || 0) / chartMax) * 100) : 0;
  const currentBar = Math.max(2, ((progress?.currentTotal || 0) / chartMax) * 100);

  const codeLabels: Record<string, string> = { cliente: "CLIENTE", repite: "REPITE", rueda: "RUEDA", free: "FREE", call_center: "CALL CENTER" };
  const formatMinutes = (value: number | null) => `${Number(value || 0).toLocaleString("es-ES", { maximumFractionDigits: 2 })} min`;
  const signedMinutes = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${Number(value).toLocaleString("es-ES", { maximumFractionDigits: 2 })} min`;
  const codePercent = (item: InvoiceCodeProgress["codes"][number]) => {
    if (!item.has_previous) return "Sin histórico";
    if (Number(item.previous || 0) === 0 && item.current > 0) return "Nuevo este mes";
    if (item.current === 0 && Number(item.previous || 0) === 0) return "Sin actividad";
    return percent(item.change_pct);
  };
  const codeTrendLabel = (item: InvoiceCodeProgress["codes"][number]) => item.trend === "up" ? "↑ Mejora" : item.trend === "down" ? "↓ Área de mejora" : "→ Estable";
  const primaryCodes = (codeProgress?.codes || []).filter((item) => item.code === "cliente" || item.code === "repite");
  const comparableCodes = (codeProgress?.codes || []).filter((item) => item.change_pct !== null);
  const bestCode = comparableCodes.filter((item) => Number(item.change_pct) > 0).sort((a, b) => Number(b.change_pct) - Number(a.change_pct))[0];
  const opportunityCode = comparableCodes.filter((item) => Number(item.change_pct) < 0).sort((a, b) => Number(a.change_pct) - Number(b.change_pct))[0];
  const primaryUp = primaryCodes.filter((item) => item.trend === "up");
  const primaryDown = primaryCodes.filter((item) => item.trend === "down");
  const primaryBest = primaryUp.sort((a, b) => Number(b.change_pct ?? -Infinity) - Number(a.change_pct ?? -Infinity))[0];
  const primaryOpportunity = primaryDown.sort((a, b) => Number(a.change_pct ?? Infinity) - Number(b.change_pct ?? Infinity))[0];
  const clientCode = primaryCodes.find((item) => item.code === "cliente");
  const repeatCode = primaryCodes.find((item) => item.code === "repite");
  const codeConclusion = !codeProgress?.hasPrevious
    ? "No hay datos del periodo anterior para realizar la comparativa por código."
    : primaryCodes.length === 2 && primaryUp.length === 2
      ? "Buen progreso general. Has mejorado tanto en CLIENTE como en REPITE respecto al periodo anterior."
      : primaryCodes.length === 2 && primaryDown.length === 2 && clientCode && repeatCode
        ? `Este mes ambos códigos quedaron por debajo del periodo anterior. CLIENTE presenta una variación de ${codePercent(clientCode)} y REPITE de ${codePercent(repeatCode)}.`
        : [primaryBest ? `Has mejorado especialmente en ${codeLabels[primaryBest.code] || primaryBest.code.toUpperCase()}, con una evolución de ${codePercent(primaryBest)}.` : null, primaryOpportunity ? `${codeLabels[primaryOpportunity.code] || primaryOpportunity.code.toUpperCase()} queda como principal oportunidad de mejora, con una variación de ${codePercent(primaryOpportunity)}.` : null].filter(Boolean).join(" ") || "La actividad por código se mantiene estable respecto al periodo anterior.";
  const codeCards = (codeProgress?.codes || []).map((item) => {
    const chartMaximum = Math.max(item.current, Number(item.previous || 0), 1);
    const previousWidth = item.has_previous ? Math.max(item.previous ? 3 : 0, (Number(item.previous || 0) / chartMaximum) * 100) : 0;
    const currentWidth = Math.max(item.current ? 3 : 0, (item.current / chartMaximum) * 100);
    return `<article class="code-card code-${item.trend}">
      <div class="code-card-head"><b>${esc(codeLabels[item.code] || item.code.toUpperCase())}</b><span>${esc(codeTrendLabel(item))}</span></div>
      <div class="code-numbers"><div><small>${esc(codeProgress?.currentLabel)}</small><strong>${formatMinutes(item.current)}</strong></div><div><small>${esc(codeProgress?.previousLabel)}</small><strong>${item.has_previous ? formatMinutes(item.previous) : "Sin histórico"}</strong></div></div>
      <div class="code-delta"><b>${item.has_previous ? signedMinutes(item.difference) : "—"}</b><span>${esc(codePercent(item))}</span></div>
      <div class="code-bars">${item.has_previous ? `<div><small>Anterior</small><i><u style="width:${previousWidth.toFixed(2)}%"></u></i></div>` : ""}<div><small>Actual</small><i><u class="current" style="width:${currentWidth.toFixed(2)}%"></u></i></div></div>
    </article>`;
  }).join("");

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
    .head{display:flex;justify-content:space-between;gap:28px;align-items:stretch;border-bottom:2px solid #c8a45d;padding-bottom:18px;break-inside:avoid;page-break-inside:avoid}
    .brand{display:flex;gap:16px;align-items:flex-start;min-width:0;padding:8px 0}.brand img{width:68px;height:68px;object-fit:contain;flex:none}.brand-copy{padding-top:4px}.brand h1{margin:0;font-size:31px;line-height:1;color:var(--ink)}.brand p{margin:7px 0 0;color:#9a7024;font-size:14px;font-weight:700;letter-spacing:.03em}
    .invoice-meta{width:310px;max-width:48%;padding:15px 17px;border:1px solid #decfaa;border-radius:14px;background:linear-gradient(145deg,#fffdf8,#faf6ee);text-align:left;break-inside:avoid}.invoice-meta h2{margin:0 0 11px;color:#9a7024;font-size:21px;line-height:1.1;overflow-wrap:anywhere}.meta-grid{display:grid;grid-template-columns:76px 1fr;gap:5px 10px;align-items:start}.meta-label{color:var(--muted);font-size:10.5px;text-transform:uppercase;letter-spacing:.04em}.meta-value{font-size:11.5px;font-weight:700;overflow-wrap:anywhere}.status{display:inline-block;padding:3px 7px;border-radius:999px;background:#f0e8fb;color:#68459d;font-weight:800;font-size:10px;letter-spacing:.05em}
    .parties{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:18px;break-inside:avoid;page-break-inside:avoid}.party{padding:15px 16px;background:linear-gradient(145deg,#fffdf9,var(--soft));border:1px solid var(--line);border-radius:12px;min-height:132px}.party h3{margin:0 0 10px;text-transform:uppercase;letter-spacing:.1em;font-size:10px;color:#8b672a}.party strong{display:block;font-size:16px;margin-bottom:7px}.party-line{font-size:11.5px;line-height:1.5;color:#3f3944;overflow-wrap:anywhere}.party-period{margin-top:6px;padding-top:6px;border-top:1px solid #eadfce;color:#6f6575;font-size:11.5px}
    .period{margin:16px 0 0;font-size:12.5px;color:var(--muted)}
    table{width:100%;border-collapse:collapse;margin-top:22px;table-layout:fixed;page-break-inside:auto}thead{display:table-header-group}tr{page-break-inside:avoid;page-break-after:auto}th{background:#20182b;color:#fff;text-align:left;padding:10px;font-size:12px;text-transform:uppercase;letter-spacing:.05em}th:nth-child(1){width:31%}th:nth-child(2){width:49%}th:nth-child(3){width:20%;text-align:right}td{padding:10px;border-bottom:1px solid #e9e2d7;vertical-align:top;font-size:12.5px;line-height:1.45;overflow-wrap:anywhere}.amount{text-align:right;white-space:nowrap;font-weight:700}
    .totals{margin-left:auto;width:315px;max-width:100%;margin-top:22px;break-inside:avoid}.total-row{display:flex;justify-content:space-between;gap:16px;padding:7px 4px;font-size:13px}.grand{font-size:19px;font-weight:900;border-top:2px solid #c8a45d;padding-top:10px;margin-top:3px}.notes{margin-top:27px;padding:14px;border:1px solid var(--line);background:#fffdfa;break-inside:avoid}.notes b{font-size:12px;text-transform:uppercase;letter-spacing:.06em}.notes p{margin:7px 0 0;white-space:pre-wrap;line-height:1.5;font-size:12.5px}
    .progress{margin-top:26px;padding:17px;border:1px solid #decfaa;border-radius:14px;background:linear-gradient(135deg,#fffdf8,#f7f1fc);break-inside:avoid;page-break-inside:avoid}.progress-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.progress-kicker{font-size:10px;letter-spacing:.14em;color:#9a7024;font-weight:900}.progress h3{margin:4px 0 0;font-size:19px}.progress-badge{padding:7px 10px;border-radius:999px;font-size:12px;font-weight:900;white-space:nowrap}.progress-up .progress-badge{background:#e8f6ef;color:#16734f}.progress-down .progress-badge{background:#fbecef;color:#a53444}.progress-neutral .progress-badge{background:#eeeaf3;color:#665e70}.progress-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px}.progress-stat{padding:10px;background:rgba(255,255,255,.75);border:1px solid #ebe2d3;border-radius:9px}.progress-stat span{display:block;color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.05em}.progress-stat strong{display:block;margin-top:5px;font-size:14px}.progress-chart{margin-top:13px}.progress-chart>b{display:block;margin-bottom:7px}.bars{display:grid;gap:6px}.bar-row{display:grid;grid-template-columns:105px 1fr;gap:7px;align-items:center;font-size:10px;color:var(--muted)}.bar-track{height:7px;border-radius:99px;background:#e9e1ed;overflow:hidden}.bar-fill{height:100%;border-radius:inherit;background:#b78a3b}.bar-fill.current{background:#7653ad}.progress-message{margin:13px 0 0;font-size:12px;line-height:1.45;color:#4a424f}.minutes-line{margin-top:11px;padding-top:10px;border-top:1px solid #e8decc;font-size:11.5px;color:#51495a}.minutes-line b{color:#2e2634}
    .code-progress{margin-top:16px;padding:15px 17px;border:1px solid #decfaa;border-radius:14px;background:linear-gradient(135deg,#fffdf8,#faf7fd);break-inside:avoid;page-break-inside:avoid}.code-progress-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.code-progress-head h3{margin:4px 0 0;font-size:18px}.code-summary{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.code-summary span{padding:5px 8px;border:1px solid #e1d6c3;border-radius:999px;background:#fff;color:#5b5261;font-size:9px;font-weight:800}.code-summary .best{color:#16734f;background:#e8f6ef;border-color:#cfeadd}.code-summary .opportunity{color:#8c4b57;background:#fbeff1;border-color:#efd9dd}.code-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}.code-card{padding:10px;border:1px solid #e8dece;border-radius:10px;background:rgba(255,255,255,.82);break-inside:avoid}.code-card-head,.code-delta{display:flex;align-items:center;justify-content:space-between;gap:8px}.code-card-head b{color:#7653ad;font-size:11px;letter-spacing:.08em}.code-card-head span{padding:3px 6px;border-radius:999px;background:#eeeaf3;color:#665e70;font-size:8.5px;font-weight:800}.code-up .code-card-head span{background:#e8f6ef;color:#16734f}.code-down .code-card-head span{background:#fbecef;color:#a53444}.code-numbers{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px}.code-numbers div{padding:6px 7px;border:1px solid #eee6db;border-radius:7px;background:#fff}.code-numbers small{display:block;color:var(--muted);font-size:8px;text-transform:capitalize}.code-numbers strong{display:block;margin-top:3px;font-size:12px}.code-delta{margin-top:7px}.code-delta b{font-size:11px}.code-delta span{color:#625968;font-size:9px;font-weight:800}.code-bars{display:grid;gap:4px;margin-top:7px}.code-bars>div{display:grid;grid-template-columns:43px 1fr;gap:5px;align-items:center}.code-bars small{color:var(--muted);font-size:7.5px}.code-bars i{display:block;height:5px;border-radius:99px;background:#e9e1ed;overflow:hidden}.code-bars u{display:block;height:100%;border-radius:inherit;background:#b78a3b;text-decoration:none}.code-bars u.current{background:#7653ad}.code-conclusion{margin:10px 0 0;padding-top:9px;border-top:1px solid #e8decc;color:#4a424f;font-size:10.5px;line-height:1.45}.code-conclusion b{color:#7653ad}
    .foot{margin-top:24px;padding-top:10px;border-top:1px solid #eee7db;color:#8a828e;font-size:10.5px;text-align:center}
    @page{size:A4 portrait;margin:0}
    @media print{html,body{background:#fff}.page{margin:0;width:210mm;min-height:auto;padding:15mm 17mm}.no-print{display:none}}
    @media(max-width:600px){.page{width:100%;min-height:0;padding:24px}.head{flex-direction:column}.invoice-meta{width:100%;max-width:none}.parties{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <main class="page">
    <header class="head">
      <div class="brand">
        <img src="${esc(input.logoUrl)}" alt="Tarot Celestial" />
        <div class="brand-copy"><h1>Factura</h1><p>${esc(input.issuer.company || input.issuer.name)}</p></div>
      </div>
      <div class="invoice-meta">
        <h2>${esc(input.invoiceNumber)}</h2>
        <div class="meta-grid">
          ${input.periodLabel ? `<span class="meta-label">Periodo</span><span class="meta-value">${esc(input.periodLabel)}</span>` : ""}
          <span class="meta-label">Estado</span><span class="meta-value"><span class="status">${esc(input.status || "—")}</span></span>
          ${input.issuer.country ? `<span class="meta-label">País</span><span class="meta-value">${esc(input.issuer.country)}</span>` : ""}
          <span class="meta-label">Emisor</span><span class="meta-value">${esc(input.issuer.name)}</span>
          ${input.issuer.company ? `<span class="meta-label">Empresa</span><span class="meta-value">${esc(input.issuer.company)}</span>` : ""}
          <span class="meta-label">Emisión</span><span class="meta-value">${esc(issueDate)}</span>
          ${dueDate ? `<span class="meta-label">Vencimiento</span><span class="meta-value">${esc(dueDate)}</span>` : ""}
        </div>
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
        ${input.periodLabel ? `<div class="party-period">Periodo facturado: <b>${esc(input.periodLabel)}</b></div>` : ""}
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
    ${progress ? `<section class="progress progress-${progress.trend}">
      <div class="progress-head"><div><span class="progress-kicker">EVOLUCIÓN REAL</span><h3>Tu progreso este mes</h3></div><div class="progress-badge">${esc(progress.hasPrevious ? percent(progress.changePct) : "Primer mes")}</div></div>
      <div class="progress-grid">
        <div class="progress-stat"><span>${esc(progress.currentLabel)}</span><strong>${formatMoney(progress.currentTotal)}</strong></div>
        <div class="progress-stat"><span>${esc(progress.previousLabel)}</span><strong>${progress.hasPrevious ? formatMoney(progress.previousTotal) : "Sin histórico"}</strong></div>
        <div class="progress-stat"><span>Diferencia</span><strong>${progress.hasPrevious ? signedMoney(progress.difference) : "—"}</strong></div>
        <div class="progress-stat"><span>Evolución</span><strong>${progress.hasPrevious ? percent(progress.changePct) : "Sin histórico"}</strong></div>
      </div>
      <div class="progress-chart"><b>Comparativa</b><div class="bars">
        ${progress.hasPrevious ? `<div class="bar-row"><span>${esc(progress.previousLabel)}</span><div class="bar-track"><div class="bar-fill" style="width:${previousBar.toFixed(2)}%"></div></div></div>` : ""}
        <div class="bar-row"><span>${esc(progress.currentLabel)}</span><div class="bar-track"><div class="bar-fill current" style="width:${currentBar.toFixed(2)}%"></div></div></div>
      </div></div>
      ${progress.showMinutes ? `<div class="minutes-line"><b>Minutos reales:</b> ${(Number(progress.currentMinutes || 0)).toLocaleString("es-ES")} este mes · ${progress.hasPrevious ? `${(Number(progress.previousMinutes || 0)).toLocaleString("es-ES")} el mes anterior · ${Number(progress.minutesDifference || 0) > 0 ? "+" : ""}${(Number(progress.minutesDifference || 0)).toLocaleString("es-ES")} min (${percent(progress.minutesChangePct ?? null)})` : "sin histórico anterior"}</div>` : ""}
      <p class="progress-message">${esc(progressMessage)}</p>
    </section>` : ""}
    ${codeProgress ? `<section class="code-progress">
      <div class="code-progress-head"><div><span class="progress-kicker">DATOS REALES DE LA FACTURA</span><h3>Evolución por código</h3></div><div class="code-summary">${bestCode ? `<span class="best">Mayor progreso: ${esc(codeLabels[bestCode.code] || bestCode.code.toUpperCase())} ${esc(codePercent(bestCode))}</span>` : ""}${opportunityCode ? `<span class="opportunity">A reforzar: ${esc(codeLabels[opportunityCode.code] || opportunityCode.code.toUpperCase())} ${esc(codePercent(opportunityCode))}</span>` : ""}</div></div>
      <div class="code-grid">${codeCards}</div>
      <p class="code-conclusion"><b>Conclusión:</b> ${esc(codeConclusion)}</p>
    </section>` : ""}
    <footer class="foot">Documento generado desde el panel de facturación de Tarot Celestial.</footer>
  </main>
  <script>window.addEventListener('load',function(){setTimeout(function(){window.print()},250)});</script>
</body>
</html>`;
}
