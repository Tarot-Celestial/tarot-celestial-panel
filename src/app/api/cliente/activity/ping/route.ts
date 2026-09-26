import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import { touchClientActivity } from "@/lib/server/cliente-platform";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { classifyBrainIncident, recordBrainIncident } from "@/lib/server/brain-observability";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const access = Boolean(body?.access);
    await touchClientActivity(gate.admin, gate.cliente.id, { access });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    await recordBrainIncident(
      supabaseAdmin(),
      classifyBrainIncident(e, {
        source: "vercel",
        subsystem: "clients",
        route: "/api/cliente/activity/ping",
        title: "Heartbeat del panel cliente degradado",
        affectedNodeIds: ["clients", "realtime", "core"],
      })
    );
    return NextResponse.json({ ok: false, error: e?.message || "ERR_CLIENTE_ACTIVITY" }, { status: 500 });
  }
}
