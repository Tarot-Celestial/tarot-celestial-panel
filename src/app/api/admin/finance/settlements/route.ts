import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { cleanFinanceDate, roundFinanceMoney } from "@/lib/server/finance-center";
import { madridTodayKey } from "@/lib/server/madrid-reporting-period";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const receivableId = String(body.receivable_id || "").trim();
    const amount = roundFinanceMoney(body.amount);
    if (!receivableId) return NextResponse.json({ ok: false, error: "RECEIVABLE_REQUIRED" }, { status: 400 });
    if (!(amount > 0)) return NextResponse.json({ ok: false, error: "AMOUNT_REQUIRED" }, { status: 400 });
    const idempotencyKey = String(body.idempotency_key || "").trim();
    if (!idempotencyKey) return NextResponse.json({ ok: false, error: "IDEMPOTENCY_KEY_REQUIRED" }, { status: 400 });

    const { data, error } = await gate.admin.rpc("finance_register_settlement", {
      p_receivable_id: receivableId,
      p_amount: amount,
      p_settled_on: cleanFinanceDate(body.settled_on, madridTodayKey()),
      p_destination_account: String(body.destination_account || "").trim() || null,
      p_note: String(body.note || "").trim() || null,
      p_actor_worker_id: String(gate.me.id || "") || null,
      p_actor_user_id: String(gate.me.user_id || "") || null,
      p_idempotency_key: idempotencyKey,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, result: data });
  } catch (error: any) {
    const message = String(error?.message || "SETTLEMENT_ERROR");
    const status = message.includes("EXCEEDS_OUTSTANDING") ? 409 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
