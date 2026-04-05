import { NextResponse } from 'next/server';
import { normalizeMonthKey, workerFromRequest } from '@/lib/server/auth-worker';
import { accumulateRendimientoByWorker, listMonthlyRendimiento, listTarotistaWorkers } from '@/lib/server/rendimiento-metrics';

export const runtime = 'nodejs';

function score(row: any) {
  return Number(row.captadas_total || 0) * 10 + Number(row.pct_cliente || 0) + Number(row.pct_repite || 0);
}

export async function GET(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: 'NO_AUTH' }, { status: 401 });

    const url = new URL(req.url);
    const month = normalizeMonthKey(url.searchParams.get('month'));

    const [workers, rendimientoRows] = await Promise.all([
      listTarotistaWorkers(),
      listMonthlyRendimiento(month),
    ]);

    const { rows } = accumulateRendimientoByWorker(rendimientoRows, workers);

    const top = {
      captadas: [...rows].sort((a, b) => Number(b.captadas_total || 0) - Number(a.captadas_total || 0)).slice(0, 10),
      cliente: [...rows].sort((a, b) => Number(b.pct_cliente || 0) - Number(a.pct_cliente || 0)).slice(0, 10),
      repite: [...rows].sort((a, b) => Number(b.pct_repite || 0) - Number(a.pct_repite || 0)).slice(0, 10),
    };

    const teams = ['fuego', 'agua'].reduce((acc: any, team) => {
      const members = rows.filter((r) => String(r.team || '').toLowerCase() === team);
      acc[team] = {
        members: members.length,
        score: members.reduce((a, r) => a + score(r), 0),
        captadas_total: members.reduce((a, r) => a + Number(r.captadas_total || 0), 0),
        minutes_total: members.reduce((a, r) => a + Number(r.minutes_total || 0), 0),
      };
      return acc;
    }, {} as any);

    const fw = Number(teams.fuego?.score || 0);
    const aw = Number(teams.agua?.score || 0);
    teams.winner = fw === aw ? 'empate' : fw > aw ? 'fuego' : 'agua';

    const my = rows.find((r) => String(r.worker_id) === String(me.id)) || null;
    const bonusForPos = (pos: number) => (pos === 1 ? 6 : pos === 2 ? 4 : pos === 3 ? 2 : 0);
    const pos = {
      captadas: top.captadas.findIndex((r) => String(r.worker_id) === String(me.id)) + 1 || null,
      cliente: top.cliente.findIndex((r) => String(r.worker_id) === String(me.id)) + 1 || null,
      repite: top.repite.findIndex((r) => String(r.worker_id) === String(me.id)) + 1 || null,
    };
    const bonus_ranking_breakdown = {
      captadas: pos.captadas ? bonusForPos(pos.captadas) : 0,
      cliente: pos.cliente ? bonusForPos(pos.cliente) : 0,
      repite: pos.repite ? bonusForPos(pos.repite) : 0,
    };

    return NextResponse.json({
      ok: true,
      month,
      top,
      teams,
      my,
      positions: pos,
      bonus_ranking: Object.values(bonus_ranking_breakdown).reduce((a: number, n: any) => a + Number(n || 0), 0),
      bonus_ranking_breakdown,
      rows,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'ERR' }, { status: 500 });
  }
}
