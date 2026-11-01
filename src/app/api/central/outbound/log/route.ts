import { NextResponse } from "next/server";
import { centralWorkspaceIdentity, centralWorkspaceAccessFailure } from "@/lib/server/central-workspace-access";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { db, worker: me } = await centralWorkspaceIdentity(req);

    const body = await req.json().catch(() => ({}));
    const item_id = String(body.item_id || "").trim();
    const status = String(body.status || "").trim();
    const note = body.note == null ? null : String(body.note).trim();

    if (!item_id) return NextResponse.json({ ok: false, error: "NO_ITEM_ID" }, { status: 400 });
    if (!status) return NextResponse.json({ ok: false, error: "NO_STATUS" }, { status: 400 });

    // Verificar item existe + traer batch_id (por si quieres checks extra)
    const { data: it0, error: e0 } = await db
      .from("outbound_batch_items")
      .select("id, batch_id")
      .eq("id", item_id)
      .maybeSingle();
    if (e0) throw e0;
    if (!it0?.id) return NextResponse.json({ ok: false, error: "ITEM_NOT_FOUND" }, { status: 404 });

    const now = new Date().toISOString();

    // 1) Update item (estado + nota + quién llamó + timestamp)
    const { data: updated, error: eu } = await db
      .from("outbound_batch_items")
      .update({
        current_status: status,
        last_note: note,
        last_call_at: now,
        last_called_by_worker_id: me.id,
      })
      .eq("id", item_id)
      .select(`
        id, batch_id, customer_name, phone, priority, position,
        current_status, last_call_at, last_note,
        last_called_by_worker_id
      `)
      .single();
    if (eu) throw eu;

    // 2) Insert log (si tienes esta tabla; es la que usa el panel tarotista para ver histórico)
    //    Si tu tabla se llama distinto, dímelo y lo ajusto.
    const { error: el } = await db.from("outbound_item_logs").insert({
      item_id,
      status,
      note,
      created_by_worker_id: me.id,
      created_at: now,
    });
    if (el) throw el;

    return NextResponse.json({ ok: true, item: updated });
  } catch (e: any) {
    const denied = centralWorkspaceAccessFailure(e);
    if (denied) return denied;
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
