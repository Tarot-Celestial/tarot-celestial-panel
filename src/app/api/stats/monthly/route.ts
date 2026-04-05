import { NextResponse } from 'next/server';
import {
  captadasTier,
  monthRange,
  normalizeMonthKey,
  roundMoney,
  workerFromRequest,
} from '@/lib/server/auth-worker';
import { aggregateRendimientoByTarotista, listRendimientoRows, listTarotistaWorkers } from '@/lib/server/rendimiento-metrics';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: 'NO_AUTH' }, { status: 401 });

    const url = new URL(req.url);
    const month = normalizeMonthKey(url.searchParams.get('month'));
    const { start, endExclusive } = monthRange(month);

    const [workers, rendimientoRows] = await Promise.all([
      listTarotistaWorkers(),
      listRendimientoRows(start, endExclusive),
    ]);

    const rows = aggregateRendimientoByTarotista(rendimientoRows, workers).map((row) => {
      const bonusCaptadas = roundMoney(Number(row.captadas_total || 0) * captadasTier(Number(row.captadas_total || 0)));
      return {
        ...row,
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

    const count = rows.length || 1;
    totals.avg_pct_cliente = roundMoney(rows.reduce((a, r) => a + Number(r.pct_cliente || 0), 0) / count);
    totals.avg_pct_repite = roundMoney(rows.reduce((a, r) => a + Number(r.pct_repite || 0), 0) / count);

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
