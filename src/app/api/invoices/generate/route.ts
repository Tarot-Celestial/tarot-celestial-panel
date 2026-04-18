import { NextResponse } from 'next/server';
import {
  captadasTier,
  monthRange,
  normalizeMonthKey,
  roundMoney,
  workerFromRequest,
  rateForCode,
} from '@/lib/server/auth-worker';
import {
  aggregateRendimientoByTarotista,
  listRendimientoRows,
  listTarotistaWorkers,
} from '@/lib/server/rendimiento-metrics';
import { getServiceClient } from '@/lib/admin/require-admin';

export const runtime = 'nodejs';

type InvoiceLinePayload = {
  kind: string;
  label: string;
  amount: number;
  meta: Record<string, any>;
};

const CODE_LABELS: Record<string, string> = {
  free: 'Minutos Free',
  rueda: 'Minutos Rueda',
  cliente: 'Minutos Cliente',
  repite: 'Minutos Repite',
  call_fixed: 'Minutos Call',
  otros: 'Otros minutos',
};

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function buildLines(row: any): InvoiceLinePayload[] {
  const lines: InvoiceLinePayload[] = [];
  const byCode = row?.by_code || {};

  for (const [code, info] of Object.entries(byCode) as Array<[string, any]>) {
    const minutes = roundMoney(Number(info?.minutes || 0));
    if (!(minutes > 0)) continue;

    const specialCall = code === 'call_fixed';
    const rate = rateForCode(code, specialCall);
    const amount = roundMoney(Number(info?.amount || minutes * rate));
    if (!(amount > 0)) continue;

    lines.push({
      kind: `minutes_${code}`,
      label: CODE_LABELS[code] || `Minutos ${code}`,
      amount,
      meta: {
        code,
        minutes,
        rate,
        source: 'rendimiento_llamadas',
      },
    });
  }

  const captadas = Number(row?.captadas_total || 0);
  if (captadas > 0) {
    const tier = captadasTier(captadas);
    const bonus = roundMoney(captadas * tier);
    if (bonus > 0) {
      lines.push({
        kind: 'bonus_captadas',
        label: `Bonus captadas (${captadas})`,
        amount: bonus,
        meta: {
          code: 'bonus_captadas',
          captadas,
          rate: tier,
          source: 'rendimiento_llamadas',
        },
      });
    }
  }

  if (!lines.length) {
    lines.push({
      kind: 'summary_empty',
      label: 'Sin producción en el periodo',
      amount: 0,
      meta: {
        source: 'rendimiento_llamadas',
      },
    });
  }

  return lines;
}

async function upsertInvoiceForWorker(admin: any, workerId: string, month: string, lines: InvoiceLinePayload[]) {
  const total = roundMoney(lines.reduce((acc, line) => acc + Number(line.amount || 0), 0));
  const nowIso = new Date().toISOString();

  const { data: existing, error: existingError } = await admin
    .from('invoices')
    .select('id, status, worker_ack, worker_ack_at, worker_ack_note, notes, created_at')
    .eq('worker_id', workerId)
    .eq('month_key', month)
    .maybeSingle();
  if (existingError) throw existingError;

  let invoiceId = String(existing?.id || '');

  if (invoiceId) {
    const { error: updateError } = await admin
      .from('invoices')
      .update({ total, updated_at: nowIso })
      .eq('id', invoiceId);
    if (updateError) throw updateError;

    const { error: deleteLinesError } = await admin.from('invoice_lines').delete().eq('invoice_id', invoiceId);
    if (deleteLinesError) throw deleteLinesError;
  } else {
    const { data: created, error: createError } = await admin
      .from('invoices')
      .insert({
        worker_id: workerId,
        month_key: month,
        status: 'pending',
        total,
        worker_ack: 'pending',
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select('id')
      .maybeSingle();
    if (createError) throw createError;
    invoiceId = String(created?.id || '');
  }

  if (!invoiceId) throw new Error('INVOICE_ID_NOT_CREATED');

  const linePayload = lines.map((line) => ({
    invoice_id: invoiceId,
    kind: line.kind,
    label: line.label,
    amount: roundMoney(line.amount),
    meta: line.meta,
    created_at: nowIso,
  }));

  const { error: insertLinesError } = await admin.from('invoice_lines').insert(linePayload);
  if (insertLinesError) throw insertLinesError;

  return { invoiceId, total, created: !existing?.id };
}

export async function POST(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: 'NO_AUTH' }, { status: 401 });
    if (!['admin', 'central'].includes(String(me.role || ''))) {
      return NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const month = normalizeMonthKey(body?.month || monthKeyNow());
    const { start, endExclusive } = monthRange(month);

    const [workers, rendimientoRows] = await Promise.all([
      listTarotistaWorkers(),
      listRendimientoRows(start, endExclusive),
    ]);

    const rows = aggregateRendimientoByTarotista(rendimientoRows, workers);
    const admin = getServiceClient();

    let created = 0;
    let updated = 0;
    const invoices: Array<{ worker_id: string; display_name: string; invoice_id: string; total: number }> = [];

    for (const row of rows) {
      const workerId = String(row?.worker_id || '');
      if (!workerId) continue;
      const lines = buildLines(row);
      const saved = await upsertInvoiceForWorker(admin, workerId, month, lines);
      if (saved.created) created += 1;
      else updated += 1;
      invoices.push({
        worker_id: workerId,
        display_name: String(row?.display_name || '—'),
        invoice_id: saved.invoiceId,
        total: saved.total,
      });
    }

    return NextResponse.json({
      ok: true,
      month,
      created,
      updated,
      total: created + updated,
      invoices,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'INVOICE_GENERATE_ERROR' }, { status: 500 });
  }
}
