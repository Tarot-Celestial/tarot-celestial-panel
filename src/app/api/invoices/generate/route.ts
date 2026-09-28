import { NextResponse } from "next/server";
import {
  normalizeMonthKey,
  rateForCode,
  roundMoney,
  normalizeText,
} from "@/lib/server/auth-worker";
import { bonusAccess, bonusCandidates, loadBonusReport } from "@/lib/server/tarotista-bonuses";
import { validateMonth } from "@/lib/bonuses/engine";
import { fullMonthComparison } from "@/lib/server/madrid-reporting-period";
import { loadTarotistaRankConfig, resolveTarotistaRankState } from "@/lib/server/tarotista-ranks";
import {
  aggregateRendimientoByTarotista,
  listRendimientoRowsByIso,
  listTarotistaWorkers,
} from "@/lib/server/rendimiento-metrics";

export const runtime = "nodejs";

type InvoiceLinePayload = {
  invoice_id: string;
  kind: string;
  label: string;
  amount: number;
  meta: Record<string, any>;
};


const FIXED_SALARIES: Record<string, number> = {
  maria: 400,
  yami: 400,
  yamile: 400,
  michael: 280,
};

function fixedSalaryForWorker(worker: any) {
  const configuredSalary = roundMoney(Number(worker?.salary_base || 0));
  if (configuredSalary > 0) return configuredSalary;
  return FIXED_SALARIES[normalizeText(worker?.display_name)] || 0;
}

function salaryBaseLine(invoice_id: string, amount: number): InvoiceLinePayload {
  return {
    invoice_id,
    kind: "salary_base",
    label: "Sueldo fijo mensual",
    amount: roundMoney(amount),
    meta: {
      code: "salary_base",
      source: "fixed_salary",
      locked: true,
      protected: true,
    },
  };
}

function fixedBonusLine(invoice_id: string, amount = 0): InvoiceLinePayload {
  return {
    invoice_id,
    kind: "salary_bonus",
    label: "Bonus",
    amount: roundMoney(amount),
    meta: {
      code: "salary_bonus",
      source: "manual_bonus",
      optional: true,
    },
  };
}

function buildMonthLabel(monthKey: string) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month) return monthKey;
  const d = new Date(Date.UTC(year, month - 1, 1));
  return d.toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: "Europe/Madrid" });
}

function minuteLine(args: {
  invoice_id: string;
  kind: string;
  label: string;
  code: string;
  minutes: number;
  specialCall?: boolean;
  rateBonus?: number;
}): InvoiceLinePayload | null {
  const minutes = roundMoney(args.minutes || 0);
  if (minutes <= 0) return null;

  const baseRate = rateForCode(args.code, args.specialCall === true);
  const rateBonus = Math.max(0, Number(args.rateBonus || 0));
  const rate = Math.round((baseRate + rateBonus) * 10000) / 10000;
  const amount = roundMoney(minutes * rate);

  return {
    invoice_id: args.invoice_id,
    kind: args.kind,
    label: `${args.label} · ${minutes.toLocaleString("es-ES")} min x ${rate.toLocaleString("es-ES", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    })}€`,
    amount,
    meta: {
      code: args.code,
      minutes,
      rate,
      base_rate: baseRate,
      rank_rate_bonus: rateBonus,
      source: "auto_generate",
    },
  };
}

function rankBenefitLine(invoice_id: string, kind: "rank_health_bonus" | "rank_bonus", label: string, amount: number, rankCode: string): InvoiceLinePayload | null {
  const safeAmount = roundMoney(Math.max(0, Number(amount || 0)));
  if (safeAmount <= 0) return null;
  return {
    invoice_id,
    kind,
    label,
    amount: safeAmount,
    meta: {
      code: kind,
      source: "tarotista_rank",
      rank_code: rankCode,
      locked: true,
    },
  };
}

function emptyLine(invoice_id: string, month: string) {
  return {
    invoice_id,
    kind: "empty",
    label: `Sin producción en ${buildMonthLabel(month)}`,
    amount: 0,
    meta: {
      code: "none",
      minutes: 0,
      rate: 0,
      source: "auto_generate",
    },
  } satisfies InvoiceLinePayload;
}

export async function POST(req: Request) {
  try {
    const gate = await bonusAccess(req, true);
    if (gate.response) return gate.response;
    const body = await req.json().catch(() => ({}));
    const month = validateMonth(normalizeMonthKey(body?.month));
    const admin = gate.db;
    const [bonusReport, rankConfig] = await Promise.all([
      loadBonusReport(admin, month),
      loadTarotistaRankConfig(admin),
    ]);
    const reportingPeriod = fullMonthComparison(month);

    const [tarotistaWorkers, rendimientoRows, activeWorkersResult] = await Promise.all([
      listTarotistaWorkers(),
      listRendimientoRowsByIso(reportingPeriod.currentStartIso, reportingPeriod.currentEndExclusiveIso),
      admin
        .from("workers")
        .select("id, display_name, role, team, is_active, salary_base")
        .or("is_active.is.null,is_active.eq.true"),
    ]);

    if (activeWorkersResult.error) throw activeWorkersResult.error;

    const fixedSalaryWorkers = (activeWorkersResult.data || []).filter(
      (worker: any) => fixedSalaryForWorker(worker) > 0
    );

    const workersById = new Map<string, any>();
    for (const worker of [...(tarotistaWorkers || []), ...fixedSalaryWorkers]) {
      if (worker?.id) workersById.set(String(worker.id), worker);
    }
    const workers = Array.from(workersById.values());

    const aggregatedRows = aggregateRendimientoByTarotista(rendimientoRows, workers);

    let historicalSkipped = 0;
    let created = 0;
    let updated = 0;
    let lineCount = 0;
    const generated: Array<{ invoice_id: string; worker_id: string; display_name: string; total: number }> = [];

    for (const row of aggregatedRows) {
      const workerId = String(row.worker_id || "").trim();
      if (!workerId) continue;

      if (workersById.get(workerId)?.role === 'tarotista' && month < bonusReport.activation_month) { historicalSkipped++; continue; }
      const worker = workersById.get(workerId);
      const fixedSalary = fixedSalaryForWorker(worker);
      const isTarotista = worker?.role === "tarotista";
      const rankState = isTarotista ? resolveTarotistaRankState(row, rankConfig) : null;
      const rankBenefits = rankState?.current?.benefit_config || { cliente_rate_bonus: 0, repite_rate_bonus: 0, health_bonus: 0, rank_bonus: 0, extras: [] };
      const rankCode = rankState?.current?.code || "";

      const preliminaryLines = fixedSalary > 0
        ? [
            salaryBaseLine("__pending__", fixedSalary),
            fixedBonusLine("__pending__", 0),
            isTarotista ? rankBenefitLine("__pending__", "rank_health_bonus", `Bono de salud · Rango ${rankCode}`, rankBenefits.health_bonus, rankCode) : null,
            isTarotista ? rankBenefitLine("__pending__", "rank_bonus", `Bono de rango · Rango ${rankCode}`, rankBenefits.rank_bonus, rankCode) : null,
          ].filter(Boolean) as InvoiceLinePayload[]
        : [
            minuteLine({ invoice_id: "__pending__", kind: "minutes_free", label: "Minutos Free", code: "free", minutes: Number(row.minutes_free || 0) }),
            minuteLine({ invoice_id: "__pending__", kind: "minutes_rueda", label: "Minutos Rueda", code: "rueda", minutes: Number(row.minutes_rueda || 0) }),
            minuteLine({ invoice_id: "__pending__", kind: "minutes_cliente", label: `Minutos Cliente${rankBenefits.cliente_rate_bonus > 0 ? ` · Rango ${rankCode}` : ""}`, code: "cliente", minutes: Number(row.minutes_cliente || 0), rateBonus: rankBenefits.cliente_rate_bonus }),
            minuteLine({ invoice_id: "__pending__", kind: "minutes_repite", label: `Minutos Repite${rankBenefits.repite_rate_bonus > 0 ? ` · Rango ${rankCode}` : ""}`, code: "repite", minutes: Number(row.minutes_repite || 0), rateBonus: rankBenefits.repite_rate_bonus }),
            minuteLine({ invoice_id: "__pending__", kind: "minutes_call", label: "Minutos CALL", code: "CALL", minutes: Number(row.minutes_call_fixed || 0), specialCall: true }),
            minuteLine({ invoice_id: "__pending__", kind: "minutes_otros", label: "Minutos otros / no facturables", code: "otros", minutes: Number(row.minutes_otros || 0) }),
            isTarotista ? rankBenefitLine("__pending__", "rank_health_bonus", `Bono de salud · Rango ${rankCode}`, rankBenefits.health_bonus, rankCode) : null,
            isTarotista ? rankBenefitLine("__pending__", "rank_bonus", `Bono de rango · Rango ${rankCode}`, rankBenefits.rank_bonus, rankCode) : null,
          ].filter(Boolean) as InvoiceLinePayload[];

      const lines = preliminaryLines.length ? preliminaryLines : [emptyLine("__pending__", month)];
      const rankMinuteExtra = fixedSalary > 0 ? 0 : roundMoney(
        Number(row.minutes_cliente || 0) * Number(rankBenefits.cliente_rate_bonus || 0) +
        Number(row.minutes_repite || 0) * Number(rankBenefits.repite_rate_bonus || 0)
      );
      const { data: invoice, error: regenerationError } = await admin.rpc("invoice_regenerate_preserving_manual", {
        p_worker_id: workerId, p_month: month, p_lines: lines,
        p_snapshot: {
          minutes_total: roundMoney(Number(row.minutes_total || 0)),
          pay_minutes: fixedSalary > 0 ? 0 : roundMoney(Number(row.pay_minutes || 0) + rankMinuteExtra),
          captadas_total: Math.max(0, Math.round(Number(row.captadas_total || 0))),
          bonus_captadas: fixedSalary > 0 ? 0 : roundMoney(Number(row.bonus_captadas || 0)),
          salary_base: fixedSalary,
          bonus_engine: workersById.get(workerId)?.role === 'tarotista',
          close_bonuses: workersById.get(workerId)?.role === 'tarotista' && bonusReport.closed,
          bonus_versions: bonusReport.versions,
          bonus_candidates: bonusCandidates(bonusReport, workerId),
          tarotista_rank: rankState ? { code: rankCode, benefits: rankBenefits } : null,
          actor_id: gate.worker.id,
        },
      });
      if (regenerationError) throw regenerationError;
      if (invoice?.skipped) continue;
      if (!invoice?.id) throw new Error("No se pudo actualizar la factura.");
      if (invoice.created) created += 1; else updated += 1;
      lineCount += Number(invoice.line_count || 0);
      const finalTotal = Number(invoice.total || 0);

      generated.push({
        invoice_id: invoice.id,
        worker_id: workerId,
        display_name: String(row.display_name || "—"),
        total: finalTotal,
      });
    }

    return NextResponse.json({
      ok: true,
      month,
      created,
      historical_skipped: historicalSkipped,
      updated,
      lines: lineCount,
      generated,
      source_rows: Array.isArray(rendimientoRows) ? rendimientoRows.length : 0,
      workers: Array.isArray(workers) ? workers.length : 0,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "INVOICE_GENERATE_ERROR" }, { status: 500 });
  }
}

