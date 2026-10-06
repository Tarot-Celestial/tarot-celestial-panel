import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const headers = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Authorization",
};

export async function GET(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401, headers });
    if (!gate.cliente?.id) return NextResponse.json({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, { status: 404, headers });

    // Endpoint deliberadamente pequeño: no depende del resto de módulos del dashboard.
    // Administración y Cliente leen exactamente la misma función SQL canónica.
    const { data: state, error } = await gate.admin.rpc("tc_client_state_snapshot_diamond_v1", {
      p_cliente_id: gate.cliente.id,
    });
    if (error) throw error;

    return NextResponse.json({ ok: true, state }, { headers });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "ERR_CLIENT_STATE" },
      { status: 500, headers }
    );
  }
}
