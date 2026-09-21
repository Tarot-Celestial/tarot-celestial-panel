import { NextResponse } from "next/server";
import { rouletteClient, RouletteAccessError } from "@/lib/server/ruleta-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const gate = await rouletteClient(req);
    const body = await req.json().catch(() => ({}));
    const id = String(body?.entitlement_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ ok: false, error: "BENEFICIO_INVALIDO" }, { status: 400 });
    }
    const { data, error } = await gate.admin.rpc("cliente_ruleta_reclamar_beneficio_v1", {
      p_cliente_id: gate.cliente.id,
      p_entitlement_id: id,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, ...data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error: any) {
    if (error instanceof RouletteAccessError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    const msg = String(error?.message || "");
    if (msg.includes("BENEFIT_NOT_READY")) return NextResponse.json({ ok: false, error: "Tu próximo premio diario todavía no está disponible." }, { status: 409 });
    if (msg.includes("BENEFIT_EXPIRED")) return NextResponse.json({ ok: false, error: "Este beneficio ya ha caducado." }, { status: 409 });
    if (msg.includes("BENEFIT_COMPLETED")) return NextResponse.json({ ok: false, error: "Ya has completado este beneficio." }, { status: 409 });
    console.error("[ruleta-ultra/claim]", error);
    return NextResponse.json({ ok: false, error: "No se ha podido reclamar el premio todavía." }, { status: 500 });
  }
}
