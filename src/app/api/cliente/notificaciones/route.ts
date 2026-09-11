import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const url = new URL(req.url);
    const requestedLimit = Number(url.searchParams.get("limit") || 60);
    const limit = Math.max(1, Math.min(100, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 60));

    const [itemsResult, unreadResult] = await Promise.all([
      gate.admin
        .from("cliente_notificaciones")
        .select("id, titulo, mensaje, tipo, leida, created_at, meta")
        .eq("cliente_id", gate.cliente.id)
        .order("created_at", { ascending: false })
        .limit(limit),
      gate.admin
        .from("cliente_notificaciones")
        .select("id", { count: "exact", head: true })
        .eq("cliente_id", gate.cliente.id)
        .eq("leida", false),
    ]);

    if (itemsResult.error) throw itemsResult.error;
    if (unreadResult.error) throw unreadResult.error;
    return NextResponse.json(
      { ok: true, data: itemsResult.data || [], unread_count: unreadResult.count || 0 },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_CLIENTE_NOTIFS" }, { status: 500 });
  }
}

