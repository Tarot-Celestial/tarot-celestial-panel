import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { loadCollaboratorMonthlyReport } from "@/lib/server/collaborator-billing";

export const runtime = "nodejs";

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function number(value: unknown, digits = 0) {
  return (Number(value || 0) || 0).toLocaleString("es-ES", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function amount(value: unknown, currency = "EUR") {
  const numeric = Number(value || 0) || 0;
  if (currency === "MULTI") return `${number(numeric, 2)} (varias monedas)`;
  try {
    return numeric.toLocaleString("es-ES", { style: "currency", currency });
  } catch {
    return `${number(numeric, 2)} ${currency}`;
  }
}

function monthLabel(monthKey: string) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month) return monthKey;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/Madrid",
  });
}

function dateTime(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return esc(value);
  return date.toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
}

function normalizeMonth(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) throw new Error("INVALID_MONTH");
  return value;
}

function breakdownHtml(values: Record<string, number>) {
  const entries = Object.entries(values || {});
  if (!entries.length) return "—";
  return entries.map(([currency, total]) => `${amount(total, currency)}`).join(" · ");
}

function signedNumber(value: number, suffix = "") {
  return `${value > 0 ? "+" : ""}${number(value, 2)}${suffix}`;
}

function signedAmount(value: number, currency: string) {
  return `${value > 0 ? "+" : ""}${amount(value, currency)}`;
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) {
      const status = gate.error === "NO_AUTH" ? 401 : 403;
      return NextResponse.json({ ok: false, error: gate.error }, { status });
    }

    const url = new URL(req.url);
    const collaboratorId = String(url.searchParams.get("collaborator_id") || "").trim();
    const month = normalizeMonth(String(url.searchParams.get("month") || "").trim());
    if (!collaboratorId) {
      return NextResponse.json({ ok: false, error: "MISSING_COLLABORATOR_ID" }, { status: 400 });
    }

    const report = await loadCollaboratorMonthlyReport(gate.admin, collaboratorId, month);
    const origin = url.origin;
    const logoUrl = `${origin}/Nuevo-logo-tarot.png`;
    const generatedAt = new Date(report.sync.generated_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" });

    const servicesRows = report.services.map((service) => `
      <tr>
        <td>${esc(dateTime(service.service_at))}</td>
        <td><strong>${esc(service.cliente_nombre)}</strong></td>
        <td>${number(service.minutes_total, 0)} min<br><small>${number(service.paid_minutes_used, 0)} normales · ${number(service.gift_minutes_used, 0)} regalo</small></td>
        <td>${esc(service.package_label)}</td>
        <td>${service.amount > 0 ? esc(amount(service.amount, service.currency)) : "Saldo previo"}</td>
        <td>${esc(service.payment_method)}<br><small>${esc(service.payment_status)}</small></td>
        <td>${esc(service.payment_reference || "—")}</td>
        <td>${esc(service.tarotista_nombre)}</td>
      </tr>
    `).join("");

    const paymentsRows = report.payments.map((payment) => `
      <tr>
        <td>${esc(dateTime(payment.created_at))}</td>
        <td>${esc(payment.cliente_nombre)}</td>
        <td>${esc(payment.package_name || payment.package_id || "Tarifa no identificada")}</td>
        <td>${esc(amount(payment.amount, payment.currency))}</td>
        <td>${esc(payment.method_group)}</td>
        <td>${esc(payment.status_raw || payment.status_group)}</td>
        <td>${esc(payment.reference || "—")}</td>
      </tr>
    `).join("");

    const remunerationHtml = report.remuneration.configured
      ? `<strong>${amount(report.remuneration.payable_total || 0, "EUR")}</strong><span>${esc(report.remuneration.note)}</span>`
      : `<strong>Sin calcular</strong><span>${esc(report.remuneration.note)} La facturación generada no equivale al importe a pagar.</span>`;
    const generatedComparison = report.comparisons.generated;
    const minutesComparison = report.comparisons.minutes;
    const comparableRevenue = generatedComparison.has_previous && !generatedComparison.reason;
    const revenueDifference = comparableRevenue
      ? generatedComparison.current - Number(generatedComparison.previous || 0)
      : null;
    const comparisonCurrency = Array.from(new Set([
      ...Object.keys(report.summary.totals_by_currency || {}),
      ...Object.keys(report.previous_summary?.totals_by_currency || {}),
    ].filter((currency) => Math.abs(Number(report.summary.totals_by_currency?.[currency] || report.previous_summary?.totals_by_currency?.[currency] || 0)) >= 0.005)))[0] || "EUR";
    const progressPercent = !generatedComparison.has_previous
      ? "Primer mes"
      : generatedComparison.reason
        ? generatedComparison.reason
        : generatedComparison.change_pct === null
          ? (generatedComparison.trend === "up" ? "Nuevo" : "No calculable")
          : `${signedNumber(generatedComparison.change_pct, " %")}`;
    const progressMessage = !generatedComparison.has_previous
      ? "Este será tu primer punto de referencia para comparar tu progreso en los próximos meses."
      : generatedComparison.reason
        ? "La evolución porcentual no se muestra porque los periodos contienen monedas que no se pueden comparar entre sí."
        : generatedComparison.trend === "up"
          ? (Number(generatedComparison.change_pct || 0) >= 10
            ? `Excelente evolución. Este mes has superado la facturación anterior en un ${number(Math.abs(Number(generatedComparison.change_pct || 0)), 2)} %.`
            : "Buen progreso. Has aumentado la facturación respecto al mes anterior.")
          : generatedComparison.trend === "down"
            ? "Este mes estás por debajo del periodo anterior. Utiliza esta referencia para seguir tu evolución."
            : "Te mantienes estable respecto al mes anterior.";
    const progressMax = Math.max(generatedComparison.current, Number(generatedComparison.previous || 0), 1);
    const previousWidth = generatedComparison.has_previous ? Math.max(2, (Number(generatedComparison.previous || 0) / progressMax) * 100) : 0;
    const currentWidth = Math.max(2, (generatedComparison.current / progressMax) * 100);

    const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Informe ${esc(report.collaborator.display_name)} · ${esc(report.month)}</title>
  <style>
    :root { --ink:#17131e; --muted:#6d6577; --line:#e7deed; --purple:#7647c7; --gold:#c49a4d; --soft:#faf7fd; --green:#16835b; --red:#b53d4b; }
    * { box-sizing:border-box; }
    html,body { margin:0; padding:0; background:#eee9f2; color:var(--ink); font-family:Arial,Helvetica,sans-serif; }
    .page { width:297mm; min-height:210mm; margin:0 auto; background:white; padding:14mm; }
    .top { display:flex; justify-content:space-between; gap:24px; align-items:flex-start; border-bottom:2px solid var(--line); padding-bottom:14px; }
    .brand img { width:145px; height:auto; display:block; }
    h1 { margin:10px 0 4px; font-size:27px; }
    .subtitle { color:var(--muted); font-size:13px; line-height:1.5; }
    .meta { border:1px solid var(--line); border-radius:16px; padding:14px 16px; min-width:280px; background:linear-gradient(180deg,#fff,var(--soft)); }
    .meta-grid { display:grid; grid-template-columns:105px 1fr; gap:7px; font-size:12px; }
    .meta-grid span:nth-child(odd) { color:var(--muted); }
    .cards { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin:16px 0; }
    .card { border:1px solid var(--line); border-radius:16px; padding:13px; background:linear-gradient(145deg,#fff,var(--soft)); }
    .card span { display:block; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.05em; }
    .card strong { display:block; margin-top:6px; font-size:21px; }
    .section { margin-top:18px; }
    .section h2 { margin:0 0 8px; font-size:16px; color:var(--purple); }
    table { width:100%; border-collapse:collapse; table-layout:fixed; }
    th { text-align:left; padding:9px 7px; background:var(--soft); border-bottom:1px solid var(--line); font-size:10px; text-transform:uppercase; letter-spacing:.04em; }
    td { padding:9px 7px; border-bottom:1px solid var(--line); font-size:11px; vertical-align:top; overflow-wrap:anywhere; }
    td small { color:var(--muted); line-height:1.4; }
    .totals { display:grid; grid-template-columns:1.3fr 1fr; gap:12px; margin-top:18px; }
    .box { border:1px solid var(--line); border-radius:16px; padding:14px; background:var(--soft); }
    .box h3 { margin:0 0 8px; font-size:13px; color:var(--gold); text-transform:uppercase; }
    .box strong { display:block; font-size:22px; }
    .box span { display:block; margin-top:5px; color:var(--muted); font-size:11px; line-height:1.5; }
    .progress { margin-top:18px; padding:15px; border:1px solid #dfd0ae; border-radius:16px; background:linear-gradient(135deg,#fffdf8,var(--soft)); break-inside:avoid; page-break-inside:avoid; }
    .progress-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }
    .progress-head small { color:var(--gold); font-weight:800; letter-spacing:.12em; }
    .progress-head h2 { margin:4px 0 0; font-size:19px; color:var(--ink); }
    .progress-badge { border-radius:999px; padding:7px 10px; font-size:12px; font-weight:800; background:#eeeaf3; color:#665e70; }
    .progress-up .progress-badge { background:#e7f6ee; color:var(--green); }.progress-down .progress-badge { background:#fbecef; color:var(--red); }
    .progress-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-top:13px; }
    .progress-stat { padding:10px; border:1px solid var(--line); border-radius:10px; background:rgba(255,255,255,.8); }
    .progress-stat span { display:block; color:var(--muted); font-size:9px; text-transform:uppercase; }.progress-stat strong { display:block; margin-top:5px; font-size:14px; }
    .progress-bars { display:grid; gap:6px; margin-top:12px; }.progress-bar { display:grid; grid-template-columns:105px 1fr; gap:8px; align-items:center; color:var(--muted); font-size:10px; }.track { height:7px; border-radius:99px; background:#e9e1ed; overflow:hidden; }.fill { height:100%; background:var(--gold); border-radius:inherit; }.fill.current { background:var(--purple); }
    .progress-copy { margin:11px 0 0; color:#4a424f; font-size:11px; line-height:1.5; }.progress-minutes { margin-top:10px; padding-top:9px; border-top:1px solid var(--line); color:var(--muted); font-size:11px; }
    .foot { margin-top:18px; color:var(--muted); font-size:10px; line-height:1.5; }
    @media print { html,body{background:#fff}.page{margin:0;width:auto;min-height:auto;padding:9mm} }
  </style>
</head>
<body>
  <main class="page">
    <header class="top">
      <div class="brand">
        <img src="${logoUrl}" alt="Tarot Celestial" />
        <h1>Informe mensual de colaborador</h1>
        <div class="subtitle">Registro real de servicios y cobros vinculados a la etiqueta ${esc(report.tag.name)}</div>
      </div>
      <div class="meta">
        <div class="meta-grid">
          <span>Colaborador</span><strong>${esc(report.collaborator.display_name)}</strong>
          <span>Rol</span><span>${esc(report.collaborator.role)}</span>
          <span>Periodo</span><span>${esc(monthLabel(report.month))}</span>
          <span>Etiqueta</span><span>${esc(report.tag.name)}</span>
          <span>Generado</span><span>${esc(generatedAt)}</span>
        </div>
      </div>
    </header>

    <section class="cards">
      <div class="card"><span>Clientes atendidos</span><strong>${number(report.summary.clients_total)}</strong></div>
      <div class="card"><span>Servicios</span><strong>${number(report.summary.services_total)}</strong></div>
      <div class="card"><span>Minutos hablados</span><strong>${number(report.summary.minutes_total)} min</strong></div>
      <div class="card"><span>Facturación registrada</span><strong>${esc(breakdownHtml(report.summary.totals_by_currency))}</strong></div>
      <div class="card"><span>TPV</span><strong>${esc(breakdownHtml(report.summary.totals_by_method_currency.TPV || {}))}</strong></div>
      <div class="card"><span>PayPal</span><strong>${esc(breakdownHtml(report.summary.totals_by_method_currency.PayPal || {}))}</strong></div>
      <div class="card"><span>Bizum</span><strong>${esc(breakdownHtml(report.summary.totals_by_method_currency.Bizum || {}))}</strong></div>
      <div class="card"><span>Anuladas / reembolsadas</span><strong>${number(report.summary.cancelled_or_refunded)}</strong></div>
    </section>

    <section class="section">
      <h2>Servicios prestados</h2>
      <table>
        <thead><tr><th>Fecha</th><th>Cliente</th><th>Duración</th><th>Tarifa / saldo</th><th>Importe</th><th>Cobro</th><th>Referencia</th><th>Tarotista</th></tr></thead>
        <tbody>${servicesRows || '<tr><td colspan="8">No hay servicios prestados en este periodo.</td></tr>'}</tbody>
      </table>
    </section>

    <section class="section">
      <h2>Operaciones de cobro del periodo</h2>
      <table>
        <thead><tr><th>Fecha</th><th>Cliente</th><th>Tarifa</th><th>Importe</th><th>Método</th><th>Estado</th><th>Referencia</th></tr></thead>
        <tbody>${paymentsRows || '<tr><td colspan="7">No hay operaciones registradas en este periodo.</td></tr>'}</tbody>
      </table>
    </section>

    <section class="totals">
      <div class="box">
        <h3>Total generado por moneda</h3>
        <strong>${esc(breakdownHtml(report.summary.totals_by_currency))}</strong>
        <span>Solo se suman operaciones completadas. Los fallos, anulaciones y reembolsos no se contabilizan como ingreso.</span>
      </div>
      <div class="box">
        <h3>Importe correspondiente a Mario</h3>
        ${remunerationHtml}
      </div>
    </section>

    <section class="progress progress-${esc(generatedComparison.trend)}">
      <div class="progress-head"><div><small>EVOLUCIÓN REAL</small><h2>Tu progreso este mes</h2></div><div class="progress-badge">${esc(progressPercent)}</div></div>
      <div class="progress-grid">
        <div class="progress-stat"><span>${esc(monthLabel(report.month))}</span><strong>${esc(breakdownHtml(report.summary.totals_by_currency))}</strong></div>
        <div class="progress-stat"><span>${esc(monthLabel(report.previous_month))}</span><strong>${report.previous_summary ? esc(breakdownHtml(report.previous_summary.totals_by_currency)) : "Sin histórico"}</strong></div>
        <div class="progress-stat"><span>Diferencia</span><strong>${revenueDifference === null ? "—" : esc(signedAmount(revenueDifference, comparisonCurrency))}</strong></div>
        <div class="progress-stat"><span>Evolución</span><strong>${esc(progressPercent)}</strong></div>
      </div>
      <div class="progress-bars">
        ${generatedComparison.has_previous ? `<div class="progress-bar"><span>Mes anterior</span><div class="track"><div class="fill" style="width:${previousWidth.toFixed(2)}%"></div></div></div>` : ""}
        <div class="progress-bar"><span>Mes actual</span><div class="track"><div class="fill current" style="width:${currentWidth.toFixed(2)}%"></div></div></div>
      </div>
      <div class="progress-minutes"><strong>Minutos reales:</strong> ${number(minutesComparison.current)} este mes · ${minutesComparison.has_previous ? `${number(minutesComparison.previous)} el mes anterior · ${signedNumber(minutesComparison.current - Number(minutesComparison.previous || 0), " min")}` : "sin histórico anterior"}</div>
      <p class="progress-copy">${esc(progressMessage)}</p>
    </section>

    <div class="foot">
      Fuente única: ${esc(report.sync.source)}. Este documento separa la facturación generada por clientes de cualquier remuneración del colaborador. Los servicios consumidos con saldo previo pueden no tener un cobro asociado en la misma fecha.
    </div>
  </main>
  <script>window.addEventListener('load',function(){setTimeout(function(){window.print()},250)});</script>
</body>
</html>`;

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    const message = e?.message || "COLLABORATOR_PDF_ERROR";
    const status = message === "COLLABORATOR_NOT_FOUND" ? 404 : message === "INVALID_MONTH" ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
