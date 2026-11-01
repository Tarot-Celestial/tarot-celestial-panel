import { NextResponse } from "next/server";
import { centralWorkspaceIdentity, centralWorkspaceAccessFailure } from "@/lib/server/central-workspace-access";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { db: admin } = await centralWorkspaceIdentity(req);

    const { data, error } = await admin
      .from("crm_call_close_notifications")
      .select("*")
      .eq("visible", true)
      .eq("read_by_central", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      notification: data || null,
    });
  } catch (e: any) {
    const denied = centralWorkspaceAccessFailure(e);
    if (denied) return denied;
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
