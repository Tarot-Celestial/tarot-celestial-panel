import { NextResponse } from "next/server";
import { rouletteClient, RouletteAccessError } from "@/lib/server/ruleta-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

function failure(error: any) {
  if (error instanceof RouletteAccessError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status, headers });
  const code = String(error?.message || "");
  const message = code.includes("BENEFIT_EXPIRED") ? "Los siete días de este premio ya han terminado."
    : code.includes("BENEFIT_COMPLETED") ? "Ya has reclamado todos los días de este premio."
    : code.includes("BENEFIT_NOT_READY") ? "Todavía no puedes reclamar los minutos de este día."
    : code.includes("INVALID_BENEFIT") ? "Este premio no está disponible en tu cuenta."
    : "No hemos podido confirmar tus premios Diamante. Puedes reintentar con seguridad.";
  const expected = /BENEFIT_EXPIRED|BENEFIT_COMPLETED|BENEFIT_NOT_READY|INVALID_BENEFIT/.test(code);
  if (!expected) console.error("[diamond-rewards]", error);
  return NextResponse.json({ ok: false, error: message }, { status: expected ? 409 : 503, headers });
}

export async function GET(req: Request) {
  try {
    const { admin, cliente } = await rouletteClient(req);
    const result = await admin.rpc("tc_diamond_roulette_benefits_v1", { p_cliente_id: cliente.id });
    if (result.error) throw result.error;
    return NextResponse.json({ ok: true, cliente_id: cliente.id, benefits: result.data }, { headers });
  } catch (error) { return failure(error); }
}

export async function POST(req: Request) {
  try {
    const { admin, cliente } = await rouletteClient(req);
    const body = await req.json().catch(() => null);
    const id = String(body?.entitlement_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ ok: false, error: "Premio no válido." }, { status: 400, headers });
    }
    const result = await admin.rpc("tc_diamond_roulette_claim_v1", { p_cliente_id: cliente.id, p_entitlement_id: id });
    if (result.error) throw result.error;
    return NextResponse.json({ ok: true, ...result.data }, { headers });
  } catch (error) { return failure(error); }
}
