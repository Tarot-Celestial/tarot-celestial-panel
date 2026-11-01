import { NextResponse } from "next/server";
import { centralWorkspaceIdentity, centralWorkspaceAccessFailure } from "@/lib/server/central-workspace-access";

export const runtime = "nodejs";

function todayISO() { return new Date().toISOString().slice(0, 10); }

export async function GET(req: Request) {
  try {
    const { db } = await centralWorkspaceIdentity(req);

    const { searchParams } = new URL(req.url);
    const date = (searchParams.get("date") || todayISO()).slice(0, 10);

    const { data, error } = await db
      .from("outbound_batches")
      .select(`
        id, batch_date, note, status, created_at,
        sender:workers!outbound_batches_created_by_worker_id_fkey (id, display_name, role, team),
        outbound_batch_items (
          id, customer_name, phone, priority, position,
          current_status, last_call_at, last_note,
          last_called_by:workers!outbound_batch_items_last_called_by_worker_id_fkey (id, display_name)
        )
      `)
      .eq("batch_date", date)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const normalized = (data ?? []).map((b: any) => ({
      ...b,
      outbound_batch_items: (b.outbound_batch_items ?? [])
        .filter((it: any) => it.current_status !== "done")
        .sort((a: any, c: any) => (a.position ?? 0) - (c.position ?? 0)),
    }));

    return NextResponse.json({ ok: true, date, batches: normalized });
  } catch (e: any) {
    const denied = centralWorkspaceAccessFailure(e);
    if (denied) return denied;
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
