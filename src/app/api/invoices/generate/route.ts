import { NextResponse } from "next/server";
import { requireAdmin, normalizeMonthKey, roundMoney } from "@/lib/admin/require-admin";
import { buildInvoiceTotalsFromRendimiento, listMonthlyRendimiento, listTarotistaWorkers } from '@/lib/server/rendimiento-metrics';

export const runtime = "nodejs";

type TotalsRow = {
  worker_id: string;
  minutes_total: number;
  total: number;
  by_code: Record<string, { minutes: number; amount: number }>;
};

function lineKindForCode(codigo: string, isSpecialCall: boolean): string {
  if (isSpecialCall) return "salary_base";
  if (codigo === "free") return "minutes_free";
  if (codigo === "rueda") return "minutes_rueda";
  if (codigo === "cliente") return "minutes_cliente";
  if (codigo === "repite") return "minutes_repite";
  return "adjustment";
}

function labelForCode(codigo: string, isSpecialCall: boolean): string {
  if (isSpecialCall) return "Minutos tarifa fija";
  if (codigo === "free") return "Minutos free";
  if (codigo === "rueda") return "Minutos rueda";
  if (codigo === "cliente") return "Minutos cliente";
  if (codigo === "repite") return "Minutos repite";
  return `Minutos ${codigo || "otros"}`;
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) {
      const status = gate.error === "NO_AUTH" ? 401 : 403;
      return NextResponse.json({ ok: false, error: gate.error }, { status });
    }

    const body = await req.json().catch(() => ({}));
    const month_key = normalizeMonthKey(body?.month);
    const admin = gate.admin;

    const [workers, rendimientoRows] = await Promise.all([
      listTarotistaWorkers(),
      listMonthlyRendimiento(month_key),
    ]);

    const workerIds = (workers || []).map((w: any) => String(w.id));

    const { data: existingInvoices, error: existingError } = await admin
      .from("invoices")
      .select("id")
      .eq("month_key", month_key);
    if (existingError) throw existingError;

    const existingIds = (existingInvoices || []).map((x: any) => String(x.id));
    if (existingIds.length > 0) {
      const { error: delLinesError } = await admin
        .from("invoice_lines")
        .delete()
        .in("invoice_id", existingIds);
      if (delLinesError) throw delLinesError;
    }

    const { error: delInvoicesError } = await admin
      .from("invoices")
      .delete()
      .eq("month_key", month_key);
    if (delInvoicesError) throw delInvoicesError;

    const { totalsByWorker, skippedWithoutWorker } = buildInvoiceTotalsFromRendimiento(rendimientoRows, workers);

    let created = 0;

    for (const workerId of workerIds) {
      const totals: TotalsRow = totalsByWorker.get(workerId) || {
        worker_id: workerId,
        minutes_total: 0,
        total: 0,
        by_code: {},
      };

      const { data: invoice, error: invoiceError } = await admin
        .from("invoices")
        .insert({
          worker_id: workerId,
          month_key,
          status: "pending",
          total: roundMoney(totals.total),
        })
        .select("id")
        .single();
      if (invoiceError) throw invoiceError;

      const lineRows = Object.entries(totals.by_code)
        .filter(([, value]) => value.amount > 0 || value.minutes > 0)
        .map(([code, value]) => ({
          invoice_id: String((invoice as any).id),
          kind: lineKindForCode(code, code === "call_fixed"),
          label: labelForCode(code, code === "call_fixed"),
          amount: roundMoney(value.amount),
          meta: {
            code,
            minutes: roundMoney(value.minutes),
          },
        }));

      if (lineRows.length === 0) {
        lineRows.push({
          invoice_id: String((invoice as any).id),
          kind: "adjustment",
          label: "Sin producción en el periodo",
          amount: 0,
          meta: { code: "none", minutes: 0, rate: 0 },
        });
      }

      const { error: linesError } = await admin.from("invoice_lines").insert(lineRows);
      if (linesError) throw linesError;

      created += 1;
    }

    return NextResponse.json({
      ok: true,
      created,
      debug: {
        month_key,
        rendimiento_total: (rendimientoRows || []).length,
        workers_total: workerIds.length,
        workers_with_totals: totalsByWorker.size,
        skipped_without_worker: skippedWithoutWorker,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
