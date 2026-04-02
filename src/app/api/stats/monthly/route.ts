import { NextResponse } from 'next/server';
import {
  getAdminClient,
  monthRange,
  normalizeMonthKey,
  normalizeText,
  rateForCode,
  roundMoney,
  workerFromRequest,
  isSpecialCallName,
  captadasTier,
} from '@/lib/server/auth-worker';

export const runtime = 'nodejs';

type CallRow = {
  worker_id?: string | null;
  tarotista?: string | null;
  minutos?: number | string | null;
  codigo?: string | null;
  captada?: boolean | null;
  importe?: number | string | null;
  call_date?: string | null;
};

export async function GET(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: 'NO_AUTH' }, { status: 401 });

    const url = new URL(req.url);
    const month = normalizeMonthKey(url.searchParams.get('month'));
    const { start, endExclusive } = monthRange(month);
    const admin = getAdminClient();

    const { data: workers, error: workersError } = await admin
      .from('workers')
      .select('id, display_name, role, team')
      .eq('role', 'tarotista');
    if (workersError) throw workersError;

    const workerById = new Map<string, any>();
    const workerIdByName = new Map<string, string>();
    for (const w of workers || []) {
      workerById.set(String(w.id), w);
      workerIdByName.set(normalizeText(w.display_name), String(w.id));
    }

    const { data: calls, error: callsError } = await admin
      .from('calls')
      .select('worker_id, tarotista, minutos, codigo, captada, importe, call_date')
      .gte('call_date', start)
      .lt('call_date', endExclusive);
    if (callsError) throw callsError;

    const rowsMap = new Map<string, any>();
    for (const w of workers || []) {
      rowsMap.set(String(w.id), {
        worker_id: String(w.id),
        display_name: w.display_name || '—',
        team: w.team || null,
        role: w.role || 'tarotista',
        minutes_total: 0,
        calls_total: 0,
        captadas_total: 0,
        minutes_free: 0,
        minutes_rueda: 0,
        minutes_cliente: 0,
        minutes_repite: 0,
        pay_minutes: 0,
        bonus_captadas: 0,
        pct_cliente: 0,
        pct_repite: 0,
        revenue_total: 0,
      });
    }

    for (const call of (calls || []) as CallRow[]) {
      const special = isSpecialCallName(call.tarotista);
      const resolvedWorkerId = call.worker_id
        ? String(call.worker_id)
        : workerIdByName.get(normalizeText(call.tarotista)) || null;
      if (!resolvedWorkerId || !rowsMap.has(resolvedWorkerId)) continue;

      const row = rowsMap.get(resolvedWorkerId);
      const minutes = Number(call.minutos || 0) || 0;
      const code = special ? 'call_fixed' : normalizeText(call.codigo) || 'otros';
      const pay = roundMoney(minutes * rateForCode(code, special));

      row.minutes_total = roundMoney(row.minutes_total + minutes);
      row.calls_total += 1;
      row.revenue_total = roundMoney(row.revenue_total + (Number(call.importe || 0) || 0));
      if (call.captada) row.captadas_total += 1;
      if (code === 'free') row.minutes_free = roundMoney(row.minutes_free + minutes);
      if (code === 'rueda') row.minutes_rueda = roundMoney(row.minutes_rueda + minutes);
      if (code === 'cliente') row.minutes_cliente = roundMoney(row.minutes_cliente + minutes);
      if (code === 'repite') row.minutes_repite = roundMoney(row.minutes_repite + minutes);
      row.pay_minutes = roundMoney(row.pay_minutes + pay);
    }

    const rows = Array.from(rowsMap.values()).map((row) => {
      const denom = Number(row.minutes_total || 0) || 0;
      const pctCliente = denom ? (Number(row.minutes_cliente || 0) / denom) * 100 : 0;
      const pctRepite = denom ? (Number(row.minutes_repite || 0) / denom) * 100 : 0;
      const bonusCaptadas = roundMoney(Number(row.captadas_total || 0) * captadasTier(Number(row.captadas_total || 0)));
      return {
        ...row,
        pct_cliente: roundMoney(pctCliente),
        pct_repite: roundMoney(pctRepite),
        bonus_captadas: bonusCaptadas,
      };
    });

    const topCaptadas = [...rows].sort((a, b) => Number(b.captadas_total || 0) - Number(a.captadas_total || 0));
    const topCliente = [...rows].sort((a, b) => Number(b.pct_cliente || 0) - Number(a.pct_cliente || 0));
    const topRepite = [...rows].sort((a, b) => Number(b.pct_repite || 0) - Number(a.pct_repite || 0));

    const totals = rows.reduce(
      (acc, row) => {
        acc.minutes_total = roundMoney(acc.minutes_total + Number(row.minutes_total || 0));
        acc.calls_total += Number(row.calls_total || 0);
        acc.captadas_total += Number(row.captadas_total || 0);
        acc.pay_minutes = roundMoney(acc.pay_minutes + Number(row.pay_minutes || 0));
        acc.bonus_captadas = roundMoney(acc.bonus_captadas + Number(row.bonus_captadas || 0));
        acc.revenue_total = roundMoney(acc.revenue_total + Number(row.revenue_total || 0));
        return acc;
      },
      { minutes_total: 0, calls_total: 0, captadas_total: 0, pay_minutes: 0, bonus_captadas: 0, revenue_total: 0 }
    );

    totals.avg_pct_cliente = rows.length
      ? roundMoney(rows.reduce((a, r) => a + Number(r.pct_cliente || 0), 0) / rows.length)
      : 0;
    totals.avg_pct_repite = rows.length
      ? roundMoney(rows.reduce((a, r) => a + Number(r.pct_repite || 0), 0) / rows.length)
      : 0;

    if (me.role === 'admin' || me.role === 'central') {
      return NextResponse.json({ ok: true, month, totals, rows });
    }

    const bonusForPos = (pos: number) => (pos === 1 ? 6 : pos === 2 ? 4 : pos === 3 ? 2 : 0);
    const mine = rows.find((r) => String(r.worker_id) === String(me.id)) || {
      worker_id: me.id,
      display_name: me.display_name || '—',
      team: me.team || null,
      role: me.role || 'tarotista',
      minutes_total: 0,
      calls_total: 0,
      captadas_total: 0,
      minutes_free: 0,
      minutes_rueda: 0,
      minutes_cliente: 0,
      minutes_repite: 0,
      pay_minutes: 0,
      bonus_captadas: 0,
      pct_cliente: 0,
      pct_repite: 0,
      revenue_total: 0,
    };

    const posCaptadas = topCaptadas.findIndex((r) => String(r.worker_id) === String(me.id)) + 1 || null;
    const posCliente = topCliente.findIndex((r) => String(r.worker_id) === String(me.id)) + 1 || null;
    const posRepite = topRepite.findIndex((r) => String(r.worker_id) === String(me.id)) + 1 || null;
    const bonus_ranking_breakdown = {
      captadas: posCaptadas ? bonusForPos(posCaptadas) : 0,
      cliente: posCliente ? bonusForPos(posCliente) : 0,
      repite: posRepite ? bonusForPos(posRepite) : 0,
    };

    return NextResponse.json({
      ok: true,
      month,
      worker: { id: me.id, display_name: me.display_name, team: me.team },
      stats: {
        ...mine,
        bonus_ranking: Object.values(bonus_ranking_breakdown).reduce((a: number, n: any) => a + Number(n || 0), 0),
        bonus_ranking_breakdown,
      },
      totals,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'ERR' }, { status: 500 });
  }
}
