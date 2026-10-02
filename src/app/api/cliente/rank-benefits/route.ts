import { NextResponse } from "next/server";
import { rouletteClient, RouletteAccessError } from "@/lib/server/ruleta-access";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
function failure(error: any) {
  if (error instanceof RouletteAccessError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status, headers });
  const code = String(error?.message || "");
  const message = code.includes("BONUS_ALREADY_USED") ? "Ya has utilizado tu bono de hoy." : code.includes("RANK_BENEFIT_FORBIDDEN") ? "Este beneficio no está disponible para tu rango actual." : code.includes("BONUS_NOT_ACTIVE") ? "Este bono ya no está activo." : "No se ha podido completar la operación. Actualiza y vuelve a intentarlo.";
  return NextResponse.json({ ok: false, error: message }, { status: code.includes("FORBIDDEN") ? 403 : 409, headers });
}
export async function GET(req: Request) {
  try {
    const { admin, cliente } = await rouletteClient(req);
    const [rank, bonuses] = await Promise.all([
      admin.rpc("tc_client_rank_state", { p_cliente_id: cliente.id }),
      admin.rpc("tc_available_rank_bonuses", { p_cliente_id: cliente.id }),
    ]);
    if (rank.error) throw rank.error;
    if (bonuses.error) throw bonuses.error;
    return NextResponse.json({ ok: true, cliente_id: cliente.id, rank: rank.data, bonuses: bonuses.data }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  try {
    const { admin, cliente } = await rouletteClient(req);
    const { promotion_id } = await req.json();
    if (!/^[0-9a-f-]{36}$/i.test(String(promotion_id || ""))) return NextResponse.json({ ok: false, error: "Bono no válido." }, { status: 400, headers });
    const { data, error } = await admin.rpc("tc_claim_rank_bonus", { p_cliente_id: cliente.id, p_promotion_id: promotion_id });
    if (error) throw error;
    return NextResponse.json({ ok: true, ...data }, { headers });
  } catch (error) { return failure(error); }
}
