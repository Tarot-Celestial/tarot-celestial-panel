import { clientFromRequest } from "@/lib/server/auth-cliente";
import { requireReferralUuid, ReferralInputError } from "@/lib/client-referrals";
import { loadReferralState, referralFailure, referralReply } from "@/lib/server/client-referrals";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function GET(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid) return referralReply({ ok: false, error: "NO_AUTH" }, 401);
    if (!gate.cliente) return referralReply({ ok: false, error: "Tu cuenta todavía no está vinculada a una ficha. Contacta con tu central." }, 404);
    return referralReply({ ok: true, ...await loadReferralState(gate.admin, gate.cliente.id) });
  } catch (error) { return referralFailure(error); }
}
export async function POST(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid) return referralReply({ ok: false, error: "NO_AUTH" }, 401);
    if (!gate.cliente) return referralReply({ ok: false, error: "Tu cuenta no está vinculada a una ficha." }, 404);
    const body = await req.json().catch(() => null);
    if (body?.action !== "claim" || !Number.isSafeInteger(body.expected_version) || body.expected_version < 1) throw new ReferralInputError("Actualiza y selecciona un premio válido.");
    const result = await gate.admin.rpc("tc_claim_referral_reward", { p_cliente_id: gate.cliente.id, p_auth_user_id: gate.uid, p_reward_id: requireReferralUuid(body.reward_id), p_expected_version: body.expected_version, p_operation_id: requireReferralUuid(body.operation_id) });
    if (result.error) throw result.error;
    return referralReply({ ok: true, receipt: result.data });
  } catch (error) { return referralFailure(error, true); }
}
