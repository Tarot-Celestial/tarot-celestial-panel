import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.admin) {
      console.warn("[cliente:raffle:auth] sesión ausente o vencida", {
        hasUid: Boolean(gate.uid),
        hasAdmin: Boolean(gate.admin),
      });
      return NextResponse.json({ ok: false, error: "SESSION_EXPIRED" }, { status: 401 });
    }
    if (!gate.cliente?.id) {
      console.warn("[cliente:raffle:auth] cuenta sin ficha CRM vinculada", { uid: gate.uid });
      return NextResponse.json({ ok: false, error: "CLIENT_NOT_LINKED" }, { status: 403 });
    }

    const raffle = await gate.admin
      .from("raffles")
      .select("id,title,status,created_at,updated_at")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (raffle.error) throw raffle.error;
    if (!raffle.data) return NextResponse.json({ ok: true, client_id: gate.cliente.id, raffle: null, numbers: [] });

    const entries = await gate.admin
      .from("raffle_entries")
      .select("id,raffle_number,assigned_at,client_auth_user_id")
      .eq("raffle_id", raffle.data.id)
      .eq("client_id", gate.cliente.id)
      .order("raffle_number", { ascending: true });
    if (entries.error) throw entries.error;

    const rows = entries.data || [];
    if (rows.some((row: any) => String(row.client_auth_user_id || "") !== gate.uid)) {
      const sync = await gate.admin
        .from("raffle_entries")
        .update({ client_auth_user_id: gate.uid })
        .eq("raffle_id", raffle.data.id)
        .eq("client_id", gate.cliente.id);
      if (sync.error) throw sync.error;
    }

    return NextResponse.json({
      ok: true,
      client_id: gate.cliente.id,
      raffle: raffle.data,
      numbers: rows.map((row: any) => ({ id: row.id, number: row.raffle_number, assigned_at: row.assigned_at })),
    });
  } catch (error: any) {
    console.error("[cliente:raffle:get]", error);
    return NextResponse.json({ ok: false, error: error?.message || "ERR_CLIENT_RAFFLE" }, { status: 500 });
  }
}
