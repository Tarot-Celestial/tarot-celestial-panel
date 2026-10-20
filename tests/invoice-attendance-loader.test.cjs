const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, URL, Date, Intl, Map, Set, Error, Number,
    console: { error() {} },
    require(name) {
      if (name === 'next/server') return { NextResponse: Response };
      if (Object.hasOwn(mocks, name)) return mocks[name];
      throw new Error(`Unexpected import (no network allowed): ${name}`);
    },
  }, { filename: file });
  return exports;
}
const months = load('src/lib/month-key.ts');
const { loadInvoiceAttendance } = load('src/lib/server/invoice-attendance.ts', { '@/lib/month-key': months });
const comparison = load('src/lib/server/invoice-period-comparison.ts');
const plain = value => JSON.parse(JSON.stringify(value));

function incident(id = 'incident-1', patch = {}) {
  return {
    id, worker_id: 'worker-1', invoice_month: '2026-09', incident_date: '2026-09-12',
    missed_start: '10:00:00', missed_end: '11:00:00', missed_minutes: 60,
    recovered_minutes: 0, justified_minutes: 0, pending_minutes: 60, status: 'pending',
    reason_code: 'Ausencia', reason_detail: 'Motivo registrado', notes: 'Nota registrada',
    created_by_name: 'Admin de prueba', created_at: '2026-09-12T11:05:00Z', ...patch,
  };
}
function recovery(id, incidentId, amount = 30, patch = {}) {
  return { id, incident_id: incidentId, recovery_date: '2026-10-02', start_time: '10:00:00',
    end_time: '10:30:00', recovered_minutes: amount, notes: 'Recuperación posterior',
    created_by: 'actor-1', created_at: '2026-10-02T11:00:00Z', ...patch };
}
function justification(id, incidentId, amount = 30, patch = {}) {
  return { id, incident_id: incidentId, justified_minutes: amount, reason: 'Justificación guardada',
    created_by: 'actor-1', created_at: '2026-10-03T11:00:00Z', ...patch };
}

// A read-only PostgREST-shaped fake implements the filters, sort and pagination
// rather than handing back the expected result regardless of the actual query.
function fixture({ incidents = [], recoveries = [], justifications = [], actors = [], settings = { show_in_invoice: true }, extra = {}, failure } = {}) {
  const tables = {
    attendance_incident_settings: settings == null ? [] : [{ id: 1, ...settings }],
    v_attendance_incidents: incidents,
    attendance_incident_recoveries: recoveries,
    attendance_incident_justifications: justifications,
    workers: actors,
    ...extra,
  };
  const traces = [];
  const db = { from(table) {
    assert.ok(Object.hasOwn(tables, table), `Unexpected table ${table}`);
    const trace = { table, operations: [] };
    traces.push(trace);
    const query = {};
    for (const operation of ['select', 'eq', 'in', 'order', 'limit']) {
      query[operation] = (...args) => { trace.operations.push([operation, ...args]); return query; };
    }
    const execute = (single = false) => {
      if (failure) {
        const result = failure(trace);
        if (result) return result;
      }
      let data = [...tables[table]];
      for (const [operation, key, value] of trace.operations) {
        if (operation === 'eq') data = data.filter(row => row[key] === value);
        if (operation === 'in') data = data.filter(row => value.includes(row[key]));
      }
      const orders = trace.operations.filter(op => op[0] === 'order');
      data.sort((a, b) => {
        for (const [, key, options] of orders) {
          const difference = String(a[key] ?? '').localeCompare(String(b[key] ?? ''));
          if (difference) return options?.ascending === false ? -difference : difference;
        }
        return 0;
      });
      const range = trace.operations.find(op => op[0] === 'range');
      if (range) data = data.slice(range[1], range[2] + 1);
      const limit = trace.operations.find(op => op[0] === 'limit');
      if (limit) data = data.slice(0, limit[1]);
      return { data: single ? data[0] || null : data, error: null };
    };
    query.range = (start, end) => { trace.operations.push(['range', start, end]); return Promise.resolve(execute()); };
    query.maybeSingle = () => Promise.resolve(execute(true));
    query.then = (yes, no) => Promise.resolve(execute()).then(yes, no);
    return query;
  } };
  return { db, traces, tables };
}

test('attendance is scoped to the invoice worker and canonical invoice month, retaining later adjustments and closed/justified records', async () => {
  const f = fixture({
    incidents: [
      incident('partial', { recovered_minutes: 30, justified_minutes: 15, pending_minutes: 15, status: 'partial' }),
      incident('closed', { incident_date: '2026-09-13', recovered_minutes: 20, justified_minutes: 40, pending_minutes: 0, status: 'closed' }),
      incident('justified', { incident_date: '2026-09-14', justified_minutes: 60, pending_minutes: 0, status: 'justified' }),
      incident('other-worker', { worker_id: 'worker-2' }),
      incident('other-month', { invoice_month: '2026-10' }),
    ],
    recoveries: [recovery('r1', 'partial', 30), recovery('r2', 'closed', 20), recovery('unrelated', 'other-worker', 60)],
    justifications: [justification('j1', 'partial', 15), justification('j2', 'closed', 40), justification('j3', 'justified', 60)],
    actors: [{ id: 'actor-1', display_name: 'Responsable de prueba' }],
  });
  const report = await loadInvoiceAttendance(f.db, 'worker-1', '2026-9');
  assert.equal(report.month, '2026-09');
  assert.deepEqual(plain(report.incidents.map(row => row.id)), ['partial', 'closed', 'justified']);
  assert.deepEqual(plain(report.totals), { missedMinutes: 180, recoveredMinutes: 50, justifiedMinutes: 115, pendingMinutes: 15 });
  assert.equal(report.incidents[1].status, 'closed');
  assert.equal(report.incidents[2].status, 'justified');
  assert.equal(report.incidents[0].adjustments[0].date, '2026-10-02');
  assert.equal(report.incidents[0].adjustments[0].recordedBy, 'Responsable de prueba');
  assert.match(report.incidents[0].adjustments[0].reason, /10:00 - 10:30.*Recuperación posterior/);
  assert.match(report.effectNote, /no añade descuentos automáticos/);
  assert.deepEqual(plain(report.warnings), []);
  for (const trace of f.traces.filter(row => row.table === 'v_attendance_incidents')) {
    assert.ok(trace.operations.some(op => op[0] === 'eq' && op[1] === 'worker_id' && op[2] === 'worker-1'));
    assert.ok(trace.operations.some(op => op[0] === 'eq' && op[1] === 'invoice_month' && op[2] === '2026-09'));
    assert.equal(trace.operations.some(op => op[1] === 'status'), false, 'Closed history must not be hidden');
  }
});

test('all incident pages and all adjustment pages are read beyond the 500-row page size', async () => {
  const incidents = Array.from({ length: 503 }, (_, index) => incident(`i${String(index).padStart(4, '0')}`));
  incidents[0] = incident('i0000', { missed_minutes: 1500, recovered_minutes: 503, justified_minutes: 503, pending_minutes: 494 });
  const recoveries = Array.from({ length: 503 }, (_, index) => recovery(`r${String(index).padStart(4, '0')}`, 'i0000', 1));
  const justifications = Array.from({ length: 503 }, (_, index) => justification(`j${String(index).padStart(4, '0')}`, 'i0000', 1));
  const f = fixture({ incidents, recoveries, justifications, actors: [{ id: 'actor-1', display_name: 'Responsable' }] });
  const report = await loadInvoiceAttendance(f.db, 'worker-1', '2026-09');
  assert.equal(report.incidents.length, 503);
  assert.equal(report.incidents[0].adjustments.length, 1006);
  assert.equal(report.totals.missedMinutes, 1500 + 502 * 60);
  assert.equal(report.totals.recoveredMinutes, 503);
  assert.equal(report.totals.justifiedMinutes, 503);
  assert.equal(report.totals.pendingMinutes, 494 + 502 * 60);
  for (const table of ['v_attendance_incidents', 'attendance_incident_recoveries', 'attendance_incident_justifications']) {
    assert.ok(f.traces.some(trace => trace.table === table && trace.operations.some(op => op[0] === 'range' && op[1] === 500)), `Second page for ${table}`);
  }
  for (const trace of f.traces.filter(row => row.table.startsWith('attendance_incident_') && row.table !== 'attendance_incident_settings')) {
    const scope = trace.operations.find(op => op[0] === 'in' && op[1] === 'incident_id');
    assert.ok(scope && scope[2].length <= 200, 'Child reads must be bounded by incident IDs');
  }
});

test('overnight intervals warn on next-day overlap without changing recorded minutes', async () => {
  const f = fixture({ incidents: [
    incident('overnight', { incident_date: '2026-09-12', missed_start: '23:30:00', missed_end: '01:00:00', missed_minutes: 90, pending_minutes: 90 }),
    incident('next-day', { incident_date: '2026-09-13', missed_start: '00:30:00', missed_end: '01:30:00' }),
  ] });
  const report = await loadInvoiceAttendance(f.db, 'worker-1', '2026-09');
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /solapados/);
  assert.equal(report.totals.missedMinutes, 150);
  assert.equal(report.totals.pendingMinutes, 150);
  f.tables.v_attendance_incidents[1].missed_start = '01:00:00';
  const adjacent = await loadInvoiceAttendance(f.db, 'worker-1', '2026-09');
  assert.equal(adjacent.warnings.length, 0, 'Touching interval boundaries do not overlap');
});

test('disabled invoice attendance skips incident reads, while an enabled empty report explicitly has zero totals', async () => {
  const disabled = fixture({ incidents: [incident()], settings: { show_in_invoice: false } });
  assert.equal(await loadInvoiceAttendance(disabled.db, 'worker-1', '2026-09'), null);
  assert.equal(disabled.traces.length, 1);
  const empty = await loadInvoiceAttendance(fixture().db, 'worker-1', '2026-09');
  assert.deepEqual(plain(empty.incidents), []);
  assert.deepEqual(plain(empty.totals), { missedMinutes: 0, recoveredMinutes: 0, justifiedMinutes: 0, pendingMinutes: 0 });
});

test('settings, parent, child, and actor read failures reject instead of returning fabricated zero totals', async () => {
  for (const table of ['attendance_incident_settings', 'v_attendance_incidents', 'attendance_incident_recoveries', 'attendance_incident_justifications', 'workers']) {
    const f = fixture({ incidents: [incident('i', { recovered_minutes: 30, pending_minutes: 30 })], recoveries: [recovery('r', 'i')],
      failure: trace => trace.table === table ? { data: null, error: { message: 'Synthetic unavailable' } } : null });
    await assert.rejects(() => loadInvoiceAttendance(f.db, 'worker-1', '2026-09'), /No se pudo/, table);
  }
  const missing = fixture({ failure: trace => trace.table === 'v_attendance_incidents' ? { data: null, error: null } : null });
  await assert.rejects(() => loadInvoiceAttendance(missing.db, 'worker-1', '2026-09'), /no está disponible/);
});

test('incomplete numeric totals and a concurrent adjustment inconsistent with the view block the PDF data', async () => {
  for (const value of [null, undefined, '', ' ', false, true, -1, 1.5, NaN, 'not-a-number']) {
    const f = fixture({ incidents: [incident('i', { missed_minutes: value })] });
    await assert.rejects(() => loadInvoiceAttendance(f.db, 'worker-1', '2026-09'), /incompleto/);
  }
  for (const child of ['recovery', 'justification']) {
    const f = fixture({ incidents: [incident('i')],
      recoveries: child === 'recovery' ? [recovery('new-recovery', 'i')] : [],
      justifications: child === 'justification' ? [justification('new-justification', 'i')] : [],
    });
    await assert.rejects(() => loadInvoiceAttendance(f.db, 'worker-1', '2026-09'), /ha cambiado/);
  }
});

test('duplicate incident IDs between pages or missing row IDs reject an inconsistent read', async () => {
  const incidents = Array.from({ length: 500 }, (_, index) => incident(`i${String(index).padStart(4, '0')}`));
  const duplicate = fixture({ incidents, failure: trace => {
    const range = trace.operations.find(op => op[0] === 'range');
    return trace.table === 'v_attendance_incidents' && range?.[1] === 500
      ? { data: [incidents[0]], error: null } : null;
  } });
  await assert.rejects(() => loadInvoiceAttendance(duplicate.db, 'worker-1', '2026-09'), /ha cambiado/);
  assert.ok(duplicate.traces.some(trace => trace.operations.some(op => op[0] === 'range' && op[1] === 500)));
  const missingId = fixture({ incidents: [incident('ignored', { id: null })] });
  await assert.rejects(() => loadInvoiceAttendance(missingId.db, 'worker-1', '2026-09'), /ha cambiado/);
});

test('over-resolution and inconsistent pending minutes warn without silently rewriting persisted totals', async () => {
  for (const candidate of [
    { recovered: 50, justified: 40, pending: 0 },
    { recovered: 20, justified: 20, pending: 60 },
  ]) {
    const f = fixture({ incidents: [incident('i', { recovered_minutes: candidate.recovered, justified_minutes: candidate.justified, pending_minutes: candidate.pending })],
      recoveries: [recovery('r', 'i', candidate.recovered)],
      justifications: [justification('j', 'i', candidate.justified)],
    });
    const report = await loadInvoiceAttendance(f.db, 'worker-1', '2026-09');
    assert.equal(report.warnings.length, 1);
    assert.match(report.warnings[0], /no cuadran/);
    assert.deepEqual(plain(report.totals), { missedMinutes: 60, recoveredMinutes: candidate.recovered,
      justifiedMinutes: candidate.justified, pendingMinutes: candidate.pending });
  }
});

function pdfHarness({ failAttendance = false } = {}) {
  const invoice = { id: 'invoice-1', worker_id: 'worker-1', month_key: '2026-09', status: 'review', total: 427.35,
    notes: 'Ajuste acordado', created_at: '2026-10-01T10:00:00Z' };
  const lines = [
    { id: 'l1', invoice_id: 'invoice-1', kind: 'salary_base', label: 'Sueldo', amount: 400, meta: {} },
    { id: 'l2', invoice_id: 'invoice-1', kind: 'salary_bonus', label: 'Bonus manual', amount: 42.35, meta: {} },
    { id: 'l3', invoice_id: 'invoice-1', kind: 'manual_adjustment', label: 'Ajuste manual', amount: -15, meta: {} },
  ];
  const f = fixture({ incidents: [incident()], actors: [{ id: 'worker-1', display_name: 'Central de prueba', role: 'central' }],
    extra: { invoices: [invoice], invoice_lines: lines },
    failure: trace => failAttendance && trace.table === 'v_attendance_incidents' ? { data: null, error: { message: 'Synthetic failure' } } : null,
  });
  const rendered = [];
  const route = load('src/app/api/admin/invoices/pdf/route.ts', {
    '@/lib/server/invoice-attendance': { loadInvoiceAttendance },
    '@/lib/admin/require-admin': { requireAdmin: async () => ({ ok: true, admin: f.db }) },
    '@/lib/server/invoice-period-comparison': comparison,
    '@/lib/server/invoice-document': {
      invoiceIssuerFromEnvironment: () => ({ name: 'Synthetic issuer' }),
      renderInvoiceDocument: args => { rendered.push(args); return '<html>synthetic invoice</html>'; },
    },
  });
  return { ...f, invoice, lines, rendered, route };
}

test('real PDF route appends attendance but preserves every monetary line, subtotal, total and notes', async () => {
  const f = pdfHarness();
  const before = plain({ invoice: f.invoice, lines: f.lines });
  const response = await f.route.GET(new Request('https://synthetic.invalid/api/admin/invoices/pdf?invoice_id=invoice-1'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.equal(f.rendered.length, 1);
  const document = f.rendered[0];
  assert.deepEqual(plain(document.lines.map(line => line.amount)), [400, 42.35, -15]);
  assert.equal(document.subtotal, 427.35);
  assert.equal(document.total, 427.35);
  assert.equal(document.vatTotal, 0);
  assert.equal(document.notes, 'Ajuste acordado');
  assert.equal(document.attendance.month, '2026-09');
  assert.equal(document.attendance.totals.pendingMinutes, 60);
  assert.deepEqual(plain({ invoice: f.invoice, lines: f.lines }), before, 'Read-only generation must leave original invoice data intact');
});

test('PDF route refuses to render when attendance cannot be loaded', async () => {
  const f = pdfHarness({ failAttendance: true });
  const response = await f.route.GET(new Request('https://synthetic.invalid/api/admin/invoices/pdf?invoice_id=invoice-1'));
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /No se pudo cargar el registro de horas/);
  assert.equal(f.rendered.length, 0);
});
