import { NextResponse } from 'next/server';
import {
  captadasTier,
  normalizeMonthKey,
  roundMoney,
  workerFromRequest,
} from '@/lib/server/auth-worker';
import { aggregateRendimientoByTarotista, listRendimientoRowsByIso, listTarotistaWorkers } from '@/lib/server/rendimiento-metrics';
import { brandFromRequest, filterRowsByBrand } from '@/lib/server/brand-filter';
import { getAdminClient } from '@/lib/server/auth-worker';
import { loadOfficialPayments, totalOfficialRevenue } from '@/lib/server/economic-payments';
import { fullMonthComparison, madridTodayKey, monthToDateComparison } from '@/lib/server/madrid-reporting-period';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function previousMonthKey(monthKey: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ''));
  if (!match) return normalizeMonthKey(null);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function tarotistaPublicScore(row: any) {
  const calls = Math.max(0, Number(row?.calls_total || 0));
  const pctCliente = Math.max(0, Math.min(100, Number(row?.pct_cliente || 0)));
  const pctRepite = Math.max(0, Math.min(100, Number(row?.pct_repite || 0)));

  // Nota pública 7.0-9.9 basada SOLO en % Cliente y % Repite.
  // No usa euros, importes ni factura.
  if (!calls && !pctCliente && !pctRepite) return 7;
  const rawQuality = (pctCliente + pctRepite) / 2;
  const score = 7 + ((rawQuality / 100) * 2.9);
  return Math.max(7, Math.min(9.9, Math.round(score * 10) / 10));
}

function tarotistaRangeByClientePct(row: any): 'A' | 'B' {
  const pctCliente = Math.max(0, Math.min(100, Number(row?.pct_cliente || 0)));
  return pctCliente > 25 ? 'A' : 'B';
}

function buildTarotistaRanges(rows: any[]) {
  const sorted = (rows || [])
    .map((row) => ({
      worker_id: String(row.worker_id),
      score: tarotistaPublicScore(row),
      puntuacion: tarotistaPublicScore(row),
      rango: tarotistaRangeByClientePct(row),
    }))
    .sort((a, b) => b.score - a.score);
  const byWorker = new Map<string, any>();
  sorted.forEach((row, index) => {
    byWorker.set(row.worker_id, { ...row, position: index + 1, total_compared: sorted.length });
  });
  return byWorker;
}

function buildSnapshot(month: string, rendimientoRows: any[], workers: any[]) {
  const rows = aggregateRendimientoByTarotista(rendimientoRows, workers).map((row) => {
    const bonusCaptadas = roundMoney(Number(row.captadas_total || 0) * captadasTier(Number(row.captadas_total || 0)));
    return {
      ...row,
      bonus_captadas: bonusCaptadas,
    };
  });

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
    { minutes_total: 0, calls_total: 0, captadas_total: 0, pay_minutes: 0, bonus_captadas: 0, revenue_total: 0, revenue_payment_count: 0 }
  );

  const rowsWithProduction = rows.filter((row) => Number(row.calls_total || 0) > 0 || Number(row.minutes_total || 0) > 0 || Number(row.captadas_total || 0) > 0 || Number(row.revenue_total || 0) > 0);
  const count = rowsWithProduction.length || 1;
  totals.avg_pct_cliente = roundMoney(rowsWithProduction.reduce((a, r) => a + Number(r.pct_cliente || 0), 0) / count);
  totals.avg_pct_repite = roundMoney(rowsWithProduction.reduce((a, r) => a + Number(r.pct_repite || 0), 0) / count);

  return { month, totals, rows };
}

export async function GET(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: 'NO_AUTH' }, { status: 401 });

    const url = new URL(req.url);
    const month = normalizeMonthKey(url.searchParams.get('month'));
    const previousMonth = previousMonthKey(month);
    const todayKey = madridTodayKey();
    const usesMtdComparison = month === todayKey.slice(0, 7);
    const period = usesMtdComparison ? monthToDateComparison(todayKey) : fullMonthComparison(month);
    const includePrevious = me.role === 'admin' || me.role === 'central';
    const brand = brandFromRequest(req);
    const admin = getAdminClient();

    const [workers, currentRowsRaw, previousRowsRaw, currentPayments, previousPayments] = await Promise.all([
      listTarotistaWorkers(),
      listRendimientoRowsByIso(period.currentStartIso, period.currentEndExclusiveIso),
      includePrevious
        ? listRendimientoRowsByIso(period.previousStartIso, period.previousEndExclusiveIso)
        : Promise.resolve([]),
      loadOfficialPayments(admin, period.currentStartIso, period.currentEndExclusiveIso, brand),
      includePrevious
        ? loadOfficialPayments(admin, period.previousStartIso, period.previousEndExclusiveIso, brand)
        : Promise.resolve([]),
    ]);

    const [currentFilteredRows, previousFilteredRows] = await Promise.all([
      filterRowsByBrand(admin, currentRowsRaw, brand),
      includePrevious ? filterRowsByBrand(admin, previousRowsRaw, brand) : Promise.resolve([]),
    ]);

    const current = buildSnapshot(month, currentFilteredRows, workers);
    current.totals.revenue_total = totalOfficialRevenue(currentPayments);
    current.totals.revenue_payment_count = currentPayments.length;
    const previous = includePrevious ? buildSnapshot(previousMonth, previousFilteredRows, workers) : null;
    if (previous) {
      previous.totals.revenue_total = totalOfficialRevenue(previousPayments);
      previous.totals.revenue_payment_count = previousPayments.length;
    }
    const rows = current.rows;
    const totals = current.totals;

    const tarotistaRanges = buildTarotistaRanges(rows);
    const topCaptadas = [...rows].sort((a, b) => Number(b.captadas_total || 0) - Number(a.captadas_total || 0));
    const topCliente = [...rows].sort((a, b) => Number(b.pct_cliente || 0) - Number(a.pct_cliente || 0));
    const topRepite = [...rows].sort((a, b) => Number(b.pct_repite || 0) - Number(a.pct_repite || 0));

    if (includePrevious) {
      return NextResponse.json({
        ok: true,
        month,
        brand,
        totals,
        rows,
        previous,
        comparison_period: {
          mode: usesMtdComparison ? 'mtd' : 'full_month',
          time_zone: period.timeZone,
          current_start: period.currentStartKey,
          current_end: period.currentEndKey,
          previous_start: period.previousStartKey,
          previous_end: period.previousEndKey,
        },
      }, { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } });
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

    const tarotistaLevel = Number(me.tarotista_level || 1);
    const myRange = tarotistaRanges.get(String(me.id)) || { rango: 'B', score: 0, puntuacion: 0, position: null, total_compared: tarotistaRanges.size };
    const moneyPatch = tarotistaLevel === 2
      ? { pay_minutes: 0, bonus_captadas: 0, bonus_ranking: 0, bonus_ranking_breakdown: { captadas: 0, cliente: 0, repite: 0 }, revenue_total: 0 }
      : { bonus_ranking: Object.values(bonus_ranking_breakdown).reduce((a: number, n: any) => a + Number(n || 0), 0), bonus_ranking_breakdown };

    return NextResponse.json({
      ok: true,
      month,
      worker: { id: me.id, display_name: me.display_name, team: me.team, role: me.role, tarotista_level: tarotistaLevel },
      stats: {
        ...mine,
        ...moneyPatch,
        tarotista_rango: myRange.rango,
        tarotista_rango_score: myRange.score,
        tarotista_rango_media: myRange.puntuacion,
        tarotista_rango_puntuacion: myRange.puntuacion,
        tarotista_rango_position: myRange.position,
        tarotista_rango_total: myRange.total_compared,
      },
      totals,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'ERR' }, { status: 500 });
  }
}
