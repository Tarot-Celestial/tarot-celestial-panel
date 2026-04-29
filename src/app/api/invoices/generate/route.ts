import { NextResponse } from "next/server";
import {
  captadasTier,
  monthRange,
  normalizeMonthKey,
  rateForCode,
  roundMoney,
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

async function upsertInvoice(admin: any, workerId: string, month: string, total: number) {
  const { data: existingRows, error: existingError } = await admin
    .from("invoices")
    .select("id, created_at")
    .eq("worker_id", workerId)
    .eq("month_key", month)
    .order("created_at", { ascending: true });

  if (existingError) throw existingError;

  const existing = Array.isArray(existingRows) && existingRows.length ? existingRows[0] : null;
  const duplicates = Array.isArray(existingRows) ? existingRows.slice(1) : [];

  if (duplicates.length) {
    const duplicateIds = duplicates.map((row: any) => String(row.id)).filter(Boolean);
    if (duplicateIds.length) {
      const delLines = await admin.from("invoice_lines").delete().in("invoice_id", duplicateIds);
      if (delLines.error) throw delLines.error;
      const delInvoices = await admin.from("invoices").delete().in("id", duplicateIds);
      if (delInvoices.error) throw delInvoices.error;
    }
  }

  if (existing?.id) {
    const { data, error } = await admin
      .from("invoices")
      .update({
        total,
        status: "draft",
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    return { id: String(data?.id || existing.id), created: false };
  }

  const { data, error } = await admin
    .from("invoices")
    .insert({
      worker_id: workerId,
      month_key: month,
      status: "draft",
      total,
      notes: null,
    })
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) throw new Error("INVOICE_INSERT_WITHOUT_ID");

  return { id: String(data.id), created: true };
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

    const [workers, rendimientoRows] = await Promise.all([
      listTarotistaWorkers(),
      listRendimientoRows(start, endExclusive),
    ]);

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

      const preliminaryLines = [
        minuteLine({ invoice_id: "__pending__", kind: "minutes_free", label: "Minutos Free", code: "free", minutes: Number(row.minutes_free || 0) }),
        minuteLine({ invoice_id: "__pending__", kind: "minutes_rueda", label: "Minutos Rueda", code: "rueda", minutes: Number(row.minutes_rueda || 0) }),
        minuteLine({ invoice_id: "__pending__", kind: "minutes_cliente", label: "Minutos Cliente", code: "cliente", minutes: Number(row.minutes_cliente || 0) }),
        minuteLine({ invoice_id: "__pending__", kind: "minutes_repite", label: "Minutos Repite", code: "repite", minutes: Number(row.minutes_repite || 0) }),
        minuteLine({ invoice_id: "__pending__", kind: "minutes_call", label: "Minutos Call", code: "call_fixed", minutes: Number(row.minutes_call_fixed || 0), specialCall: true }),
        bonusCaptadasLine("__pending__", Number(row.captadas_total || 0)),
      ].filter(Boolean) as InvoiceLinePayload[];

      const total = roundMoney(preliminaryLines.reduce((acc, line) => acc + Number(line.amount || 0), 0));
      const invoice = await upsertInvoice(admin, workerId, month, total);
      if (invoice.created) created += 1;
      else updated += 1;

      const delLines = await admin.from("invoice_lines").delete().eq("invoice_id", invoice.id);
      if (delLines.error) throw delLines.error;

      const lines = preliminaryLines.length
        ? preliminaryLines.map((line) => ({ ...line, invoice_id: invoice.id }))
        : [emptyLine(invoice.id, month)];

      const insLines = await admin.from("invoice_lines").insert(lines);
      if (insLines.error) throw insLines.error;
      lineCount += lines.length;

      const finalTotal = roundMoney(lines.reduce((acc, line) => acc + Number(line.amount || 0), 0));
      if (finalTotal !== total) {
        const updTotal = await admin.from("invoices").update({ total: finalTotal, updated_at: new Date().toISOString() }).eq("id", invoice.id);
        if (updTotal.error) throw updTotal.error;
      }

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
