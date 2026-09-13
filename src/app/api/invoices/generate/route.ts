import { NextResponse } from "next/server";
import {
  captadasTier,
  monthRange,
  normalizeMonthKey,
  rateForCode,
  roundMoney,
  normalizeText,
} from "@/lib/server/auth-worker";
import { requireAdmin } from "@/lib/admin/require-admin";
import {
  aggregateRendimientoByTarotista,
  listRendimientoRows,
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
}): InvoiceLinePayload | null {
  const minutes = roundMoney(args.minutes || 0);
  if (minutes <= 0) return null;

  const rate = rateForCode(args.code, args.specialCall === true);
  const amount = roundMoney(minutes * rate);

  return {
    invoice_id: args.invoice_id,
    kind: args.kind,
    label: `${args.label} · ${minutes.toLocaleString("es-ES")} min x ${rate.toLocaleString("es-ES", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}€`,
    amount,
    meta: {
      code: args.code,
      minutes,
      rate,
      source: "auto_generate",
    },
  };
}

function bonusCaptadasLine(invoice_id: string, captadas: number) {
  const safeCaptadas = Math.max(0, Number(captadas || 0));
  if (safeCaptadas <= 0) return null;

  const rate = captadasTier(safeCaptadas);
  const amount = roundMoney(safeCaptadas * rate);
  if (amount <= 0) return null;

  return {
    invoice_id,
    kind: "bonus_captadas",
    label: `Bonus captadas · ${safeCaptadas} x ${rate.toLocaleString("es-ES", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}€`,
    amount,
    meta: {
      code: "bonus_captadas",
      captadas: safeCaptadas,
      rate,
      source: "auto_generate",
    },
  } satisfies InvoiceLinePayload;
}

function bonusRepiteGoalLine(invoice_id: string, minutesRepite: number) {
  const target = 8000;
  const minutes = Math.max(0, Number(minutesRepite || 0));
  if (minutes < target) return null;

  return {
    invoice_id,
    kind: "bonus_repite_goal",
    label: "Bonus objetivo Repite · 8.000 minutos",
    amount: 7,
    meta: {
      code: "bonus_repite_goal",
      minutes,
      target,
      reward: 7,
      source: "auto_generate",
      unique_goal: "repite_8000_monthly",
    },
  } satisfies InvoiceLinePayload;
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
    const gate = await requireAdmin(req);
    if (!gate.ok) {
      const status = gate.error === "NO_AUTH" ? 401 : 403;
      return NextResponse.json({ ok: false, error: gate.error }, { status });
    }

    const body = await req.json().catch(() => ({}));
    const month = normalizeMonthKey(body?.month);
    const { start, endExclusive } = monthRange(month);
    const admin = gate.admin;

    const [tarotistaWorkers, rendimientoRows, activeWorkersResult] = await Promise.all([
      listTarotistaWorkers(),
      listRendimientoRows(start, endExclusive),
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

    const aggregatedRows = aggregateRendimientoByTarotista(rendimientoRows, workers).map((row: any) => ({
      ...row,
      bonus_captadas: roundMoney(Number(row.captadas_total || 0) * captadasTier(Number(row.captadas_total || 0))),
    }));

    let created = 0;
    let updated = 0;
    let lineCount = 0;
    const generated: Array<{ invoice_id: string; worker_id: string; display_name: string; total: number }> = [];

    for (const row of aggregatedRows) {
      const workerId = String(row.worker_id || "").trim();
      if (!workerId) continue;

      const fixedSalary = fixedSalaryForWorker(workersById.get(workerId));
      const preliminaryLines = fixedSalary > 0
        ? [
            salaryBaseLine("__pending__", fixedSalary),
            fixedBonusLine("__pending__", 0),
          ]
        : [
            minuteLine({ invoice_id: "__pending__", kind: "minutes_free", label: "Minutos Free", code: "free", minutes: Number(row.minutes_free || 0) }),
            minuteLine({ invoice_id: "__pending__", kind: "minutes_rueda", label: "Minutos Rueda", code: "rueda", minutes: Number(row.minutes_rueda || 0) }),
            minuteLine({ invoice_id: "__pending__", kind: "minutes_cliente", label: "Minutos Cliente", code: "cliente", minutes: Number(row.minutes_cliente || 0) }),
            minuteLine({ invoice_id: "__pending__", kind: "minutes_repite", label: "Minutos Repite", code: "repite", minutes: Number(row.minutes_repite || 0) }),
            minuteLine({ invoice_id: "__pending__", kind: "minutes_call", label: "Minutos CALL", code: "CALL", minutes: Number(row.minutes_call_fixed || 0), specialCall: true }),
            minuteLine({ invoice_id: "__pending__", kind: "minutes_otros", label: "Minutos otros / no facturables", code: "otros", minutes: Number(row.minutes_otros || 0) }),
            bonusCaptadasLine("__pending__", Number(row.captadas_total || 0)),
            bonusRepiteGoalLine("__pending__", Number(row.minutes_repite || 0)),
          ].filter(Boolean) as InvoiceLinePayload[];

      const lines = preliminaryLines.length ? preliminaryLines : [emptyLine("__pending__", month)];
      const { data: invoice, error: regenerationError } = await admin.rpc("invoice_regenerate_preserving_manual", {
        p_worker_id: workerId, p_month: month, p_lines: lines,
        p_snapshot: {
          minutes_total: roundMoney(Number(row.minutes_total || 0)),
          pay_minutes: fixedSalary > 0 ? 0 : roundMoney(Number(row.pay_minutes || 0)),
          captadas_total: Math.max(0, Math.round(Number(row.captadas_total || 0))),
          bonus_captadas: fixedSalary > 0 ? 0 : roundMoney(Number(row.bonus_captadas || 0)),
          salary_base: fixedSalary,
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
