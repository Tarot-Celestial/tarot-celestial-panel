import { NextResponse } from 'next/server';
import { requireAdmin, normalizeMonthKey, roundMoney } from '@/lib/admin/require-admin';
import { aggregateRendimientoByTarotista, listRendimientoRows, listTarotistaWorkers } from '@/lib/server/rendimiento-metrics';
import { rateForCode } from '@/lib/server/auth-worker';

export const runtime = 'nodejs';

function buildMonthRange(monthKey: string): { start: string; endExclusive: string } {
  const [year, month] = monthKey.split('-').map(Number);
  const start = `${monthKey}-01`;
  const endExclusive = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  return { start, endExclusive };
}

function lineKindForCode(code: string): string {
  if (code === 'call_fixed') return 'salary_base';
  if (code === 'free') return 'minutes_free';
  if (code === 'rueda') return 'minutes_rueda';
  if (code === 'cliente') return 'minutes_cliente';
  if (code === 'repite') return 'minutes_repite';
  return 'adjustment';
}


function lineRateForCode(code: string): number {
  return rateForCode(code, code === 'call_fixed');
}
function labelForCode(code: string): string {
  if (code === 'call_fixed') return 'Minutos tarifa fija';
  if (code === 'free') return 'Minutos free';
  if (code === 'rueda') return 'Minutos rueda';
  if (code === 'cliente') return 'Minutos cliente';
  if (code === 'repite') return 'Minutos repite';
  return `Minutos ${code || 'otros'}`;
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) {
      const status = gate.error === 'NO_AUTH' ? 401 : 403;
      return NextResponse.json({ ok: false, error: gate.error }, { status });
    }

    const body = await req.json().catch(() => ({}));
    const month_key = normalizeMonthKey(body?.month);
    const { start, endExclusive } = buildMonthRange(month_key);
    const admin = gate.admin;

    const [workers, rendimientoRows] = await Promise.all([
      listTarotistaWorkers(),
      listRendimientoRows(start, endExclusive),
    ]);

    const workerIds = workers.map((w: any) => String(w.id));
    const totalsRows = aggregateRendimientoByTarotista(rendimientoRows, workers);
    const totalsByWorker = new Map(totalsRows.map((row: any) => [String(row.worker_id), row]));

    const { data: existingInvoices, error: existingError } = await admin
      .from('invoices')
      .select('id')
      .eq('month_key', month_key);
    if (existingError) throw existingError;

    const existingIds = (existingInvoices || []).map((x: any) => String(x.id));
    if (existingIds.length > 0) {
      const { error: delLinesError } = await admin.from('invoice_lines').delete().in('invoice_id', existingIds);
      if (delLinesError) throw delLinesError;
    }

    const { error: delInvoicesError } = await admin.from('invoices').delete().eq('month_key', month_key);
    if (delInvoicesError) throw delInvoicesError;

    let created = 0;

    for (const workerId of workerIds) {
      const totals: any = totalsByWorker.get(workerId) || {
        worker_id: workerId,
        minutes_total: 0,
        pay_minutes: 0,
        by_code: {},
      };

      const { data: invoice, error: invoiceError } = await admin
        .from('invoices')
        .insert({
          worker_id: workerId,
          month_key,
          status: 'pending',
          total: roundMoney(Number(totals.pay_minutes || 0)),
        })
        .select('id')
        .single();
      if (invoiceError) throw invoiceError;

      const lineRows = Object.entries((totals.by_code || {}) as Record<string, { minutes: number; amount: number }>)
        .filter(([, value]) => Number(value.amount || 0) > 0 || Number(value.minutes || 0) > 0)
        .map(([code, value]) => {
          const rate = lineRateForCode(code);
          const minutes = roundMoney(value.minutes);
          const amount = roundMoney(minutes * rate);

          return {
            invoice_id: String((invoice as any).id),
            kind: lineKindForCode(code),
            label: labelForCode(code),
            amount,
            meta: {
              code,
              minutes,
              rate,
            },
          };
        });

      if (lineRows.length === 0) {
        lineRows.push({
          invoice_id: String((invoice as any).id),
          kind: 'adjustment',
          label: 'Sin producción en el periodo',
          amount: 0,
          meta: { code: 'none', minutes: 0 },
        });
      }

      const { error: linesError } = await admin.from('invoice_lines').insert(lineRows);
      if (linesError) throw linesError;

      created += 1;
    }

    return NextResponse.json({
      ok: true,
      created,
      debug: {
        month_key,
        rendimiento_total: rendimientoRows.length,
        workers_total: workerIds.length,
        workers_with_totals: totalsByWorker.size,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'ERR' }, { status: 500 });
  }
}
