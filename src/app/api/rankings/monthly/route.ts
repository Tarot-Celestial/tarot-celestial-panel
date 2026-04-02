import { NextResponse } from 'next/server';
import {
  getAdminClient,
  monthRange,
  normalizeMonthKey,
  normalizeText,
  workerFromRequest,
} from '@/lib/server/auth-worker';

export const runtime = 'nodejs';

type CallRow = {
  worker_id?: string | null;
  tarotista?: string | null;
  minutos?: number | string | null;
  codigo?: string | null;
  captada?: boolean | null;
};

function score(row: any) {
  return Number(row.captadas_total || 0) * 10 + Number(row.pct_cliente || 0) + Number(row.pct_repite || 0);
}

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

    const workerIdByName = new Map<string, string>();
    const rowsMap = new Map<string, any>();
    for (const w of workers || []) {
      workerIdByName.set(normalizeText(w.display_name), String(w.id));
      rowsMap.set(String(w.id), {
        worker_id: String(w.id),
        display_name: w.display_name || '—',
        team: w.team || null,
        captadas_total: 0,
        minutes_total: 0,
        minutes_cliente: 0,
        minutes_repite: 0,
        pct_cliente: 0,
        pct_repite: 0,
      });
    }

    const { data: calls, error: callsError } = await admin
      .from('calls')
      .select('worker_id, tarotista, minutos, codigo, captada')
      .gte('call_date', start)
      .lt('call_date', endExclusive);
    if (callsError) throw callsError;

    for (const call of (calls || []) as CallRow[]) {
      const wid = call.worker_id ? String(call.worker_id) : workerIdByName.get(normalizeText(call.tarotista)) || null;
      if (!wid || !rowsMap.has(wid)) continue;
      const row = rowsMap.get(wid);
      const minutes = Number(call.minutos || 0) || 0;
      const code = normalizeText(call.codigo);
      row.minutes_total += minutes;
      if (call.captada) row.captadas_total += 1;
      if (code === 'cliente') row.minutes_cliente += minutes;
      if (code === 'repite') row.minutes_repite += minutes;
    }

    const rows = Array.from(rowsMap.values()).map((row) => {
      const denom = Number(row.minutes_total || 0) || 0;
      return {
        ...row,
        pct_cliente: denom ? (Number(row.minutes_cliente || 0) / denom) * 100 : 0,
        pct_repite: denom ? (Number(row.minutes_repite || 0) / denom) * 100 : 0,
      };
    });

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
