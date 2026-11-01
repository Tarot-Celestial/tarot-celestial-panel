import { NextResponse } from "next/server";
import { centralWorkspaceIdentity, centralWorkspaceAccessFailure } from "@/lib/server/central-workspace-access";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { db: admin } = await centralWorkspaceIdentity(req);

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || "").trim();

    if (!id) {
      return NextResponse.json({ ok: false, error: "FALTA_ID" }, { status: 400 });
    }


    const { error } = await admin
      .from("crm_call_close_notifications")
      .update({
        read_by_central: true,
      })
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const denied = centralWorkspaceAccessFailure(e);
    if (denied) return denied;
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
