import { rankingBonuses, rankingPositions, sortRanking } from "@/lib/bonuses/engine";
import { loadBonusRules } from "@/lib/server/tarotista-bonuses";
import { getAdminClient } from "@/lib/server/auth-worker";
import { fullMonthComparison } from "@/lib/server/madrid-reporting-period";
import { NextResponse } from 'next/server';
import { normalizeMonthKey, workerFromRequest } from '@/lib/server/auth-worker';
import { aggregateRendimientoByTarotista, listRendimientoRowsByIso, listTarotistaWorkers } from '@/lib/server/rendimiento-metrics';

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
      listRendimientoRowsByIso(fullMonthComparison(month).currentStartIso, fullMonthComparison(month).currentEndExclusiveIso),
    ]);

    const rows = aggregateRendimientoByTarotista(rendimientoRows, workers);

    const leaderboards = {
      captadas: sortRanking(rows, "captadas_total"),
      cliente: sortRanking(rows, "pct_cliente"),
      repite: sortRanking(rows, "pct_repite"),
    };

    const top = {
      captadas: leaderboards.captadas.slice(0, 10),
      cliente: leaderboards.cliente.slice(0, 10),
      repite: leaderboards.repite.slice(0, 10),
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
    const rules = await loadBonusRules(getAdminClient());
    const pos = rankingPositions(rows, me.id);
    const bonus_ranking_breakdown = rankingBonuses(rules, pos, month, my);


    return NextResponse.json({
      ok: true,
      month,
      top,
      leaderboards,
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

