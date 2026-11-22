import { requireAdmin } from "@/lib/admin/require-admin";
import { parseReferralReward, requireReferralUuid, ReferralInputError } from "@/lib/client-referrals";
import { referralCatalog, referralFailure, referralReply } from "@/lib/server/client-referrals";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return referralReply({ ok: false, error: gate.error }, gate.error === "FORBIDDEN" ? 403 : 401);
    return referralReply({ ok: true, rewards: await referralCatalog(gate.admin) });
  } catch (error) { return referralFailure(error); }
}
export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return referralReply({ ok: false, error: gate.error }, gate.error === "FORBIDDEN" ? 403 : 401);
    const body = await req.json().catch(() => null);
    if (body?.action !== "save") throw new ReferralInputError("Operación no válida.");
    const operationId = requireReferralUuid(body.operation_id);
    const rewardId = body.reward?.id ? requireReferralUuid(body.reward.id) : null;
    if (rewardId ? !Number.isSafeInteger(body.expected_version) || body.expected_version < 1 : body.expected_version != null) throw new ReferralInputError("Actualiza el catálogo antes de guardar.");
    const reward = parseReferralReward(body.reward);
    const result = await gate.admin.rpc("tc_save_referral_reward", { p_reward_id: rewardId || operationId, p_expected_version: body.expected_version ?? null, p_data: reward, p_actor_worker_id: gate.me.id, p_actor_user_id: gate.authUserId, p_operation_id: operationId });
    if (result.error) throw result.error;
    return referralReply({ ok: true, reward: result.data });
  } catch (error) { return referralFailure(error, true); }
}
