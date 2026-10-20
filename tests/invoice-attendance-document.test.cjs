const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), ts = require("typescript");
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/lib/server/invoice-document.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exportsObject, Intl, Date, process: { env: {} } });
const { renderInvoiceDocument } = exportsObject;

function report() {
  return {
    month: "2026-09", generatedAt: "2026-10-20T00:15:00Z",
    totals: { missedMinutes: 523, recoveredMinutes: 0, justifiedMinutes: 58, pendingMinutes: 465 },
    effectNote: "El importe depende de los conceptos económicos de la factura. Las horas pendientes requieren revisión.",
    warnings: ["Hay registros con horarios solapados. Los totales suman los registros guardados; revisa los solapamientos antes de tomar decisiones."],
    incidents: [{
      id: "synthetic-incident", date: "2026-09-27", startTime: "22:00", endTime: "23:45",
      missedMinutes: 105, recoveredMinutes: 0, justifiedMinutes: 0, pendingMinutes: 105,
      status: "closed", reason: "Salida anticipada", notes: "Revisar el registro del turno.",
      recordedBy: "Administración de prueba", recordedAt: "2026-09-28T10:30:00Z",
      adjustments: [
        { kind: "recovery", date: "2026-10-04", minutes: 30, reason: "Recuperación documentada de 10:00 a 10:30.", recordedBy: "Supervisión de prueba", recordedAt: "2026-10-04T09:00:00Z" },
        { kind: "justification", date: "", minutes: 15, reason: "Justificación registrada, sin fecha efectiva indicada.", recordedBy: "Administración de prueba", recordedAt: "2026-10-20T00:15:00Z" },
      ],
    }],
  };
}
const input = attendance => ({
  invoiceNumber: "TC-TEST-202609", issueDate: "2026-10-20", periodLabel: "septiembre de 2026",
  issuer: { name: "Emisor de prueba" }, recipient: { name: "Destinataria de prueba" },
  lines: [{ concept: "Producción registrada", detail: "Concepto económico de prueba", amount: 123.45 }],
  subtotal: 123.45, vatPercent: 0, vatTotal: 0, total: 123.45,
  notes: "Notas de la factura", logoUrl: "", attendance,
  progress: { currentLabel: "Septiembre", previousLabel: "Agosto", currentTotal: 123.45, previousTotal: null, difference: null, changePct: null, trend: "neutral", hasPrevious: false },
});
const attendanceHtml = html => html.match(/<section class="attendance"[\s\S]*?<\/section>/)?.[0] || "";

test("attendance is optional and cannot change existing financial lines or totals", () => {
  const baseline = renderInvoiceDocument(input(undefined));
  const withReport = renderInvoiceDocument(input(report()));
  assert.equal(attendanceHtml(baseline), "");
  assert.equal(renderInvoiceDocument(input(null)), baseline);
  for (const section of [/<table>[\s\S]*?<\/table>/, /<section class="totals">[\s\S]*?<\/section>/]) {
    assert.equal(withReport.match(section)[0], baseline.match(section)[0]);
  }
  assert.ok(withReport.indexOf("Notas de la factura") < withReport.indexOf("<section class=\"attendance\""));
  assert.ok(withReport.indexOf("<section class=\"attendance\"") < withReport.indexOf("<section class=\"progress "));
});

test("four summary cards show supplied record totals, overlap warnings and the supplied economic note", () => {
  const data = report(), html = attendanceHtml(renderInvoiceDocument(input(data)));
  assert.equal((html.match(/class="attendance-stat"/g) || []).length, 4);
  assert.match(html, /Registro de horas e incidencias/);
  assert.match(html, /Ausencias registradas<\/span><strong>8 h 43 min/);
  assert.match(html, /Recuperado<\/span><strong>0 min/);
  assert.match(html, /Justificado<\/span><strong>58 min/);
  assert.match(html, /Pendiente<\/span><strong>7 h 45 min/);
  assert.ok(html.includes(data.warnings[0])); assert.ok(html.includes(data.effectNote));
  assert.match(html, /Suma de los registros guardados/);
  assert.doesNotMatch(html, /descuento automático|descontado automáticamente/);
});

test("incident dates, intervals, status, reason, notes and responsible person remain visible", () => {
  const html = attendanceHtml(renderInvoiceDocument(input(report())));
  for (const text of ["27/09/2026", "22:00 – 23:45", "Cerrada", "Salida anticipada", "Revisar el registro del turno.", "Administración de prueba", "28/09/2026, 12:30"]) assert.ok(html.includes(text), text);
  assert.match(html, /Pendiente <b>1 h 45 min/);
});

test("every adjustment is rendered and an undated justification uses its recorded time in Madrid", () => {
  const html = attendanceHtml(renderInvoiceDocument(input(report())));
  assert.equal((html.match(/class="attendance-adjustment(?: attendance-adjustment-short)?"/g) || []).length, 2);
  assert.match(html, /Recuperación · 04\/10\/2026/);
  assert.match(html, /Justificación · 20\/10\/2026, 02:15 \(registro, hora de Madrid\)/);
  assert.match(html, /30 min/); assert.match(html, /15 min/);
  assert.match(html, /Supervisión de prueba/);
  assert.match(html, /Datos consultados el 20\/10\/2026, 02:15 \(hora de Madrid\)/);
});

test("untrusted report, incident and adjustment fields are escaped as text", () => {
  const value = "<img src=x onerror=\"alert(1)\"> & \"quoted\"";
  const escaped = "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &quot;quoted&quot;";
  const data = report();
  data.month = value; data.generatedAt = value; data.effectNote = value; data.warnings = [value];
  Object.assign(data.incidents[0], { date: value, startTime: value, endTime: value, status: value, reason: value, notes: value, recordedBy: value, recordedAt: value });
  data.incidents[0].adjustments = [{ kind: value, date: value, minutes: 1, reason: value, recordedBy: value, recordedAt: value }];
  const html = attendanceHtml(renderInvoiceDocument(input(data)));
  assert.equal(html.includes(value), false);
  assert.ok((html.split(escaped).length - 1) >= 16);
  assert.doesNotMatch(html, /<img|<script|<iframe/);
});

test("an empty attendance report states absence of records without claiming complete attendance", () => {
  const data = report(); data.incidents = []; data.warnings = [];
  data.totals = { missedMinutes: 0, recoveredMinutes: 0, justifiedMinutes: 0, pendingMinutes: 0 };
  const html = attendanceHtml(renderInvoiceDocument(input(data)));
  assert.match(html, /No hay incidencias horarias registradas para este periodo/);
  assert.match(html, /La ausencia de registros no confirma por sí sola la asistencia completa/);
  assert.equal((html.match(/class="attendance-incident"/g) || []).length, 0);
});

test("long incident notes and all adjustments are preserved with printable page boundaries", () => {
  const data = report();
  data.incidents[0].notes = Array.from({ length: 70 }, (_, index) => `Observación de prueba ${index + 1}.`).join("\n");
  data.incidents[0].adjustments = Array.from({ length: 24 }, (_, index) => ({ kind: "recovery", date: "2026-10-04", minutes: 5, reason: `Ajuste documentado ${index + 1}`, recordedBy: "Supervisión de prueba", recordedAt: "2026-10-04T09:00:00Z" }));
  const html = renderInvoiceDocument(input(data)), section = attendanceHtml(html);
  assert.match(section, /Observación de prueba 70/); assert.match(section, /Ajuste documentado 24/);
  assert.equal((section.match(/class="attendance-adjustment(?: attendance-adjustment-short)?"/g) || []).length, 24);
  for (const className of ["attendance", "attendance-incident", "attendance-adjustment"]) {
    const rule = html.match(new RegExp(`\\.${className}\\{([^}]+)\\}`))[1];
    assert.match(rule, /break-inside:auto/); assert.doesNotMatch(rule, /break-inside:avoid/);
  }
  assert.match(html, /@page\{size:A4 portrait;margin:15mm 17mm\}/);
});

test("short adjustments keep their audit record together while lengthy adjustments remain divisible", () => {
  const data = report();
  const shortHtml = attendanceHtml(renderInvoiceDocument(input(data)));
  const shortAdjustment = shortHtml.match(/<li class="attendance-adjustment attendance-adjustment-short">[\s\S]*?<\/li>/)[0];
  assert.match(shortAdjustment, /Recuperación · 04\/10\/2026/);
  assert.match(shortAdjustment, /Registrado por:<\/b> Supervisión de prueba/);
  assert.match(shortHtml, /<div class="attendance-overview attendance-overview-compact">/);
  data.incidents[0].adjustments[0].reason = Array.from({ length: 40 }, (_, index) => `Explicación documentada ${index + 1}`).join("\n");
  data.warnings = [Array.from({ length: 40 }, (_, index) => `Aviso de revisión ${index + 1}`).join("\n")];
  const longHtml = attendanceHtml(renderInvoiceDocument(input(data)));
  const longAdjustment = longHtml.match(/<li class="attendance-adjustment">[\s\S]*?<\/li>/)[0];
  assert.match(longAdjustment, /Explicación documentada 40/);
  assert.match(longAdjustment, /Registrado por:<\/b> Supervisión de prueba/);
  assert.match(longHtml, /<div class="attendance-overview">/);
  assert.doesNotMatch(longHtml, /attendance-overview-compact/);
});
