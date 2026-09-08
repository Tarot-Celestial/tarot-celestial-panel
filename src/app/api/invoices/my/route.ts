import { NextResponse } from 'next/server';
import { getAdminClient, normalizeMonthKey, workerFromRequest } from '@/lib/server/auth-worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function previousMonthKey(monthKey: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return normalizeMonthKey(null);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function minutesByCode(lines: any[]) {
  const result = { cliente: 0, repite: 0 };
  for (const line of lines || []) {
    const kind = String(line?.kind || '').toLowerCase();
    const code = String(line?.meta?.code || (kind.startsWith('minutes_') ? kind.slice(8) : '')).toLowerCase();
    if (code !== 'cliente' && code !== 'repite') continue;
    result[code] = Math.round((result[code] + Number(line?.meta?.minutes || 0)) * 100) / 100;
  }
  return result;
}

function monthSnapshot(invoice: any, lines: any[]) {
  const codes = minutesByCode(lines);
  const captureLine = (lines || []).find((line: any) => String(line?.kind || '').toLowerCase() === 'bonus_captadas');
  const captured = invoice?.captadas_total ?? captureLine?.meta?.captadas ?? 0;
  return {
    exists: Boolean(invoice),
    month: invoice?.month_key || null,
    total: invoice ? Number(invoice.total || 0) : null,
    status: invoice?.status || null,
    captadas: Number(captured || 0),
    cliente_minutes: codes.cliente,
    repite_minutes: codes.repite,
  };
}

export async function GET(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: 'NO_AUTH' }, { status: 401 });

    const url = new URL(req.url);
    const month = normalizeMonthKey(url.searchParams.get('month'));
    const previousMonth = previousMonthKey(month);
    const admin = getAdminClient();
    const tarotistaLevel = Number((me as any)?.tarotista_level || 1);
    const canSeeMoney = !(me.role === 'tarotista' && tarotistaLevel === 2);

    const { data: invoiceRows, error: invErr } = await admin
      .from('invoices')
      .select('id, worker_id, month_key, status, total, captadas_total, notes, updated_at, created_at, worker_ack, worker_ack_at, worker_ack_note')
      .eq('worker_id', me.id)
      .in('month_key', [month, previousMonth]);
    if (invErr) throw invErr;

    const invoices = invoiceRows || [];
    const invoice = invoices.find((row: any) => row.month_key === month) || null;
    const previousInvoice = invoices.find((row: any) => row.month_key === previousMonth) || null;
    const invoiceIds = invoices.map((row: any) => String(row.id)).filter(Boolean);
    let allLines: any[] = [];

    if (invoiceIds.length) {
      const { data, error } = await admin
        .from('invoice_lines')
        .select('id, invoice_id, kind, label, amount, meta, created_at')
        .in('invoice_id', invoiceIds)
        .order('created_at', { ascending: true });
      if (error) throw error;
      allLines = data || [];
    }

    const lines = invoice ? allLines.filter((line: any) => String(line.invoice_id) === String(invoice.id)) : [];
    const previousLines = previousInvoice
      ? allLines.filter((line: any) => String(line.invoice_id) === String(previousInvoice.id))
      : [];
    const insights = {
      current: monthSnapshot(invoice, lines),
      previous: monthSnapshot(previousInvoice, previousLines),
      previous_month: previousMonth,
      goals: {
        captaciones: { target: 10, reward: canSeeMoney ? 10 : null },
        repite: { target: 8000, reward: canSeeMoney ? 7 : null },
      },
    };

    if (!canSeeMoney) {
      const safeInvoice = invoice ? { ...invoice, total: null, money_hidden: true } : null;
      const safeLines = lines.map((line: any) => {
        const meta = { ...(line.meta || {}) };
        delete meta.rate;
        delete meta.unit_rate;
        return { ...line, amount: null, meta, money_hidden: true };
      });
      return NextResponse.json({
        ok: true,
        invoice: safeInvoice,
        lines: safeLines,
        insights: {
          ...insights,
          current: { ...insights.current, total: null },
          previous: { ...insights.previous, total: null },
        },
        money_hidden: true,
      }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
    }

    return NextResponse.json(
      { ok: true, invoice, lines, insights, money_hidden: false },
      { headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'ERR' }, { status: 500 });
  }
}
