import { NextResponse } from "next/server";
import { requireAdmin, normalizeMonthKey, roundMoney } from "@/lib/admin/require-admin";

export const runtime = "nodejs";

type CallRow = {
  worker_id: string | null;
  tarotista: string | null;
  minutos: number | string | null;
  codigo: string | null;
  call_date?: string | null;
};

type TotalsRow = {
  worker_id: string;
  minutes_total: number;
  total: number;
  by_code: Record<string, { minutes: number; amount: number }>;
};

function toNumber(val: unknown): number {
  if (val == null) return 0;
  return Number(String(val).replace("€", "").replace(",", ".").trim()) || 0;
}

function normalizeText(val: unknown): string {
  return String(val || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isSpecialCallName(val: unknown): boolean {
  return /^call\d+/i.test(String(val || "").trim());
}

function rateForCall(codigo: string, isSpecialCall: boolean): number {
  if (isSpecialCall) return 0.12;

  const code = normalizeText(codigo);
  if (code === "free") return 0.04;
  if (code === "rueda") return 0.08;
  if (code === "cliente") return 0.12;
  if (code === "repite") return 0.14;
  return 0;
}

function lineKindForCode(codigo: string, isSpecialCall: boolean): string {
  if (isSpecialCall) return "salary_base";

  const code = normalizeText(codigo);
  if (code === "free") return "minutes_free";
  if (code === "rueda") return "minutes_rueda";
  if (code === "cliente") return "minutes_cliente";
  if (code === "repite") return "minutes_repite";
  return "adjustment";
}

function labelForCode(codigo: string, isSpecialCall: boolean): string {
  if (isSpecialCall) return "Minutos tarifa fija";

  const code = normalizeText(codigo);
  if (code === "free") return "Minutos free";
  if (code === "rueda") return "Minutos rueda";
  if (code === "cliente") return "Minutos cliente";
  if (code === "repite") return "Minutos repite";
  return `Minutos ${code || "otros"}`;
}

function buildMonthRange(monthKey: string): { start: string; endExclusive: string } {
  const [year, month] = monthKey.split("-").map(Number);
  const start = `${monthKey}-01`;
  const endExclusive = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  return { start, endExclusive };
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
    const { start, endExclusive } = buildMonthRange(month_key);
    const admin = gate.admin;

    const { data: workers, error: workersError } = await admin
      .from("workers")
      .select("id, display_name, role")
      .eq("role", "tarotista");
    if (workersError) throw workersError;

    const workerIds = (workers || []).map((w: any) => String(w.id));
    const workerByName = new Map<string, string>();
    for (const w of workers || []) {
      workerByName.set(normalizeText(w.display_name), String(w.id));
    }

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

    const { data: calls, error: callsError } = await admin
      .from("calls")
      .select("worker_id, tarotista, minutos, codigo, call_date")
      .gte("call_date", start)
      .lt("call_date", endExclusive);
    if (callsError) throw callsError;

    const totalsByWorker = new Map<string, TotalsRow>();
    let skippedWithoutWorker = 0;

    for (const call of (calls || []) as CallRow[]) {
      const specialCall = isSpecialCallName(call.tarotista);
      const resolvedWorkerId = call.worker_id
        ? String(call.worker_id)
        : workerByName.get(normalizeText(call.tarotista)) || null;

      if (!resolvedWorkerId) {
        skippedWithoutWorker += 1;
        continue;
      }

      const minutes = toNumber(call.minutos);
      if (minutes <= 0) continue;

      const codeKey = specialCall ? "call_fixed" : normalizeText(call.codigo) || "otros";
      const rate = rateForCall(codeKey, specialCall);
      const amount = roundMoney(minutes * rate);

      const current = totalsByWorker.get(resolvedWorkerId) || {
        worker_id: resolvedWorkerId,
        minutes_total: 0,
        total: 0,
        by_code: {},
      };

      current.minutes_total = roundMoney(current.minutes_total + minutes);
      current.total = roundMoney(current.total + amount);

      if (!current.by_code[codeKey]) {
        current.by_code[codeKey] = { minutes: 0, amount: 0 };
      }
      current.by_code[codeKey].minutes = roundMoney(current.by_code[codeKey].minutes + minutes);
      current.by_code[codeKey].amount = roundMoney(current.by_code[codeKey].amount + amount);

      totalsByWorker.set(resolvedWorkerId, current);
    }

    let created = 0;

    for (const workerId of workerIds) {
      const totals = totalsByWorker.get(workerId) || {
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
            rate: code === "call_fixed" ? 0.12 : rateForCall(code, false),
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
        calls_total: (calls || []).length,
        workers_total: workerIds.length,
        workers_with_totals: totalsByWorker.size,
        skipped_without_worker: skippedWithoutWorker,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
