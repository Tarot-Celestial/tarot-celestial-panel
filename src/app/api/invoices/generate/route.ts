import { NextResponse } from "next/server";
import { getServiceClient, uidAndEmailFromBearer, normalizeMonthKey, roundMoney } from "@/lib/admin/require-admin";

export const runtime = "nodejs";

type CallAgg = { minutos: number; importe: number };

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const start = `${monthKey}-01`;
  const end = new Date(year, month, 0).toISOString().slice(0, 10);
  return { start, end };
}

function normalizeName(value: any) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export async function POST(req: Request) {
  try {
    const { uid, email } = await uidAndEmailFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const db = getServiceClient();
    const { data: me, error: meErr } = await db
      .from("workers")
      .select("id, role, email")
      .or(`user_id.eq.${uid}${email ? `,email.eq.${email}` : ""}`)
      .maybeSingle();
    if (meErr) throw meErr;
    if (!me || me.role !== "admin") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const month_key = body?.month ? normalizeMonthKey(body.month) : monthKeyNow();
    const { start, end } = monthRange(month_key);

    const { data: workers, error: workersErr } = await db
      .from("workers")
      .select("id, display_name, role")
      .eq("role", "tarotista")
      .order("display_name", { ascending: true });
    if (workersErr) throw workersErr;

    const { data: mapping, error: mappingErr } = await db
      .from("tarot_mapping")
      .select("sheet_name, worker_id");
    if (mappingErr && !String(mappingErr.message || "").toLowerCase().includes("does not exist")) throw mappingErr;

    const { data: calls, error: callsErr } = await db
      .from("calls")
      .select("tarotista, minutos, importe, call_date, codigo")
      .gte("call_date", start)
      .lte("call_date", end)
      .limit(20000);
    if (callsErr) throw callsErr;

    const callsMap: Record<string, CallAgg> = {};
    for (const c of calls || []) {
      const key = normalizeName(c.tarotista);
      if (!key) continue;
      if (!callsMap[key]) callsMap[key] = { minutos: 0, importe: 0 };
      callsMap[key].minutos += Number(c.minutos) || 0;
      callsMap[key].importe += Number(c.importe) || 0;
    }

    const aliasesByWorker = new Map<string, Set<string>>();

    for (const w of workers || []) {
      const wid = String(w.id);
      if (!aliasesByWorker.has(wid)) aliasesByWorker.set(wid, new Set<string>());
      aliasesByWorker.get(wid)!.add(normalizeName(w.display_name));
    }

    for (const row of mapping || []) {
      const wid = String(row.worker_id || "");
      const alias = normalizeName(row.sheet_name);
      if (!wid || !alias) continue;
      if (!aliasesByWorker.has(wid)) aliasesByWorker.set(wid, new Set<string>());
      aliasesByWorker.get(wid)!.add(alias);
    }

    const { data: existingInvoices, error: existingErr } = await db
      .from("invoices")
      .select("id, worker_id")
      .eq("month_key", month_key);
    if (existingErr) throw existingErr;

    const existingByWorker = new Map<string, string>();
    for (const inv of existingInvoices || []) existingByWorker.set(String(inv.worker_id), String(inv.id));

    let created = 0;
    let updated = 0;

    for (const worker of workers || []) {
      const worker_id = String(worker.id);
      const aliases = Array.from(aliasesByWorker.get(worker_id) || []);

      let total_minutos = 0;
      let total_importe = 0;
      for (const alias of aliases) {
        const agg = callsMap[alias];
        if (!agg) continue;
        total_minutos += agg.minutos;
        total_importe += agg.importe;
      }

      total_minutos = Math.round(total_minutos * 100) / 100;
      total_importe = roundMoney(total_importe);

      let invoiceId = existingByWorker.get(worker_id) || "";

      if (invoiceId) {
        const { error: updErr } = await db
          .from("invoices")
          .update({ total: total_importe, status: "pending", updated_at: new Date().toISOString() })
          .eq("id", invoiceId);
        if (updErr) throw updErr;
        updated += 1;
      } else {
        const { data: invoice, error: insErr } = await db
          .from("invoices")
          .insert({
            worker_id,
            month_key,
            status: "pending",
            total: total_importe,
            worker_ack: "pending",
          })
          .select("id")
          .single();
        if (insErr) throw insErr;
        invoiceId = String(invoice.id);
        created += 1;
      }

      const { error: delErr } = await db.from("invoice_lines").delete().eq("invoice_id", invoiceId);
      if (delErr) throw delErr;

      const lines = [
        {
          invoice_id: invoiceId,
          kind: "minutes_cliente",
          label: "Minutos",
          amount: total_minutos,
          meta: { aliases },
        },
        {
          invoice_id: invoiceId,
          kind: "salary_base",
          label: "Importe",
          amount: total_importe,
          meta: { aliases },
        },
      ];

      const { error: linesErr } = await db.from("invoice_lines").insert(lines);
      if (linesErr) throw linesErr;
    }

    return NextResponse.json({
      ok: true,
      month: month_key,
      result: {
        invoices: created + updated,
        created,
        updated,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
