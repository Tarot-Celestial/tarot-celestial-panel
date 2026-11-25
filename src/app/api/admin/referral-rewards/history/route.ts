import { requireAdmin } from "@/lib/admin/require-admin";
import { parseReferralHistoryQuery } from "@/lib/client-referrals";
import { loadReferralClaimHistory, referralFailure, referralReply } from "@/lib/server/client-referrals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return referralReply({ ok: false, error: gate.error }, gate.error === "FORBIDDEN" ? 403 : 401);
    const query = parseReferralHistoryQuery(new URL(req.url).searchParams);
    return referralReply({ ok: true, ...await loadReferralClaimHistory(gate.admin, query) });
  } catch (error) {
    return referralFailure(error);
  }
}
