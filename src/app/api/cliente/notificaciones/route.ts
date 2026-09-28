import { NextResponse } from "next/server";
import { campaignIdentity, campaignResponseError } from "@/lib/server/campaign-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { db: admin, clientId } = await campaignIdentity(req, "client");

    const url = new URL(req.url);
    const requestedLimit = Number(url.searchParams.get("limit") || 60);
    const limit = Math.max(1, Math.min(100, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 60));

    const [itemsResult, unreadResult] = await Promise.all([
      admin
        .from("cliente_notificaciones")
        .select("id, titulo, mensaje, tipo, leida, created_at, meta")
        .eq("cliente_id", clientId)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .order("created_at", { ascending: false })
        .limit(limit),
      admin
        .from("cliente_notificaciones")
        .select("id", { count: "exact", head: true })
        .eq("cliente_id", clientId)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .eq("leida", false),
    ]);

    if (itemsResult.error) throw itemsResult.error;
    if (unreadResult.error) throw unreadResult.error;
    return NextResponse.json(
      { ok: true, data: itemsResult.data || [], unread_count: unreadResult.count || 0 },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (e: any) {
    return campaignResponseError(e);
  }
}
