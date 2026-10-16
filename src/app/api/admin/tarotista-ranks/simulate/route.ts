import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { aggregateRendimientoByTarotista } from "@/lib/server/rendimiento-metrics";
import { brandFromRequest, filterRowsByBrand } from "@/lib/server/brand-filter";
import { fullMonthComparison, madridTodayKey } from "@/lib/server/madrid-reporting-period";
import { resolveTarotistaRankState } from "@/lib/server/tarotista-ranks";
import { evaluatePercentageRanks, percentageBenefitAmount, validatePercentageRules, validateSimulationMonth, structuredBenefitWarnings } from "@/lib/tarotista-percentage-ranks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const headers = { "Cache-Control": "private, no-store" };
const round = (n: number) => Math.round(n * 100) / 100;
// Fail on a cap instead of returning an apparently complete partial simulation.
async function paged(makeQuery: () => any, cap = 50000): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; offset < cap; offset += 1000) {
    const { data, error } = await makeQuery().range(offset, offset + 999);
    if (error) throw new Error("No se han podido leer todos los datos del periodo.");
    if (!Array.isArray(data)) throw new Error("La lectura del periodo no está completa.");
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
  const { data, error } = await makeQuery().range(cap, cap);
  if (error || !Array.isArray(data) || data.length) throw new Error("El periodo supera el límite de la simulación. No se ha calculado un resultado parcial.");
  return rows;
}
/** POST is read-only: the body holds a temporary proposal, never a persistence command. */
export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.error === "NO_AUTH" ? 401 : 403, headers });
    const text = await req.text();
    if (text.length > 32768) return NextResponse.json({ ok: false, error: "Propuesta demasiado grande." }, { status: 413, headers });
    let month: string, rules;
    try {
      const body = JSON.parse(text);
      month = validateSimulationMonth(body.month);
      rules = validatePercentageRules(body.rules);
      if (month > madridTodayKey().slice(0, 7)) throw new Error("Selecciona un mes actual o anterior con actividad registrada.");
    } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Propuesta no válida." }, { status: 400, headers }); }
    const { admin } = gate;
    const period = fullMonthComparison(month);
    const configResult = await admin.from("tarotista_rank_config").select("code,name,subtitle,description,min_cliente_pct,requirement_label,benefits,requirements,benefit_config,professional_mode,admin_notes,sort_order").order("sort_order", { ascending: true });
    if (configResult.error || !Array.isArray(configResult.data) || !["C", "B", "A", "S"].every(code => configResult.data.filter((r: any) => r.code === code).length === 1)) throw new Error("La configuración vigente no está completa. No se usan reglas de reserva.");
    const activeRules = configResult.data;
    const workers = await paged(() => admin.from("workers").select("id,display_name,role,team,is_active").eq("role", "tarotista").or("is_active.is.null,is_active.eq.true").order("id", { ascending: true }), 10000);
    const rawRows = await paged(() => admin.from("rendimiento_llamadas")
      .select("id,fecha_hora,cliente_id,tarotista_worker_id,tarotista_nombre,tarotista_manual_call,llamada_call,code_blocks,codigo_1,minutos_1,codigo_2,minutos_2,resumen_codigo,tiempo,tipo_registro,captado")
      .gte("fecha_hora", period.currentStartIso).lt("fecha_hora", period.currentEndExclusiveIso)
      .order("fecha_hora", { ascending: true }).order("id", { ascending: true }));
    const filtered = await filterRowsByBrand(admin, rawRows, brandFromRequest(req));
    const aggregates = aggregateRendimientoByTarotista(filtered, workers);
    const warningSet = new Set(structuredBenefitWarnings(activeRules));
    const recognizedCalls = aggregates.reduce((n, r) => n + Number(r.calls_total || 0), 0);
    if (recognizedCalls !== filtered.length) warningSet.add(`${filtered.length - recognizedCalls} registros no corresponden a las tarotistas activas evaluadas. No se incluyen en sus resultados.`);
    const results = aggregates.map(row => {
      const minutes = { minutes_total: Number(row.minutes_total), minutes_cliente: Number(row.minutes_cliente), minutes_repite: Number(row.minutes_repite) };
      const evaluation = evaluatePercentageRanks(minutes, rules);
      const current = resolveTarotistaRankState(row, activeRules).current;
      const benefit = current.benefit_config;
      if (!benefit) throw new Error("Hay beneficios sin configuración numérica. Revisa los rangos vigentes.");
      const proposed = rules.find(r => r.code === evaluation.candidate);
      const currentAmount = evaluation.evaluable ? round(Number(benefit.health_bonus || 0) + Number(benefit.rank_bonus || 0) + minutes.minutes_cliente * Number(benefit.cliente_rate_bonus || 0) + minutes.minutes_repite * Number(benefit.repite_rate_bonus || 0)) : null;
      const proposalAmount = proposed ? percentageBenefitAmount(proposed, minutes) : null;
      return {
        worker_id: row.worker_id, display_name: row.display_name, calls_total: row.calls_total, ...minutes,
        current_period_rank: evaluation.evaluable ? current.code : null,
        candidate: evaluation.candidate, cliente_pct: evaluation.cliente_pct, repite_pct: evaluation.repite_pct,
        current_rank_extras: currentAmount, proposed_rank_extras: proposalAmount,
        difference: proposalAmount === null || currentAmount === null ? null : round(proposalAmount - currentAmount),
        status: evaluation.evaluable ? "pending_review" : "no_activity",
      };
    });
    return NextResponse.json({ ok: true, simulation_only: true, month, time_zone: period.timeZone,
      partial_month: month === madridTodayKey().slice(0, 7), generated_at: new Date().toISOString(),
      financial_scope: "Solo salud, bono de rango y mejoras por minuto. No incluye salario, pagos base, misiones, captaciones, ranking ni impuestos. No es una factura.",
      rules, results, warnings: [...warningSet],
      totals: { evaluable: results.filter(r => r.candidate !== null).length,
        proposed_rank_extras: round(results.reduce((sum, r) => sum + (r.proposed_rank_extras || 0), 0)),
        current_rank_extras: round(results.reduce((sum, r) => sum + (r.current_rank_extras || 0), 0)),
        difference: round(results.reduce((sum, r) => sum + (r.difference || 0), 0)) },
    }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "No se pudo completar la simulación." }, { status: 503, headers });
  }
}
