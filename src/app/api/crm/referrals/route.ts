import { requireReferralUuid, ReferralInputError } from "@/lib/client-referrals";
import { loadReferralState, referralFailure, referralReply, referralStaff } from "@/lib/server/client-referrals";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const gate = await referralStaff(req);
    if (!gate) return referralReply({ ok: false, error: "Se requiere una sesión de central o administración." }, 403);
    const url = new URL(req.url);
    if (url.searchParams.has("q")) {
      const q = (url.searchParams.get("q") || "").replace(/[^\p{L}\p{N}@+ .-]/gu, "").trim().slice(0, 80);
      if (q.length < 2) return referralReply({ ok: true, clients: [] });
      const result = await gate.admin.from("crm_clientes").select("id,nombre,apellido,telefono,email").or(`nombre.ilike.%${q}%,apellido.ilike.%${q}%,telefono.ilike.%${q}%,email.ilike.%${q}%`).order("nombre").order("id").limit(30);
      if (result.error) throw result.error;
      return referralReply({ ok: true, clients: result.data || [] });
    }
    const id = requireReferralUuid(url.searchParams.get("cliente_id"));
    const client = await gate.admin.from("crm_clientes").select("id").eq("id", id).maybeSingle();
    if (client.error) throw client.error;
    if (!client.data) return referralReply({ ok: false, error: "Cliente no encontrado." }, 404);
    return referralReply({ ok: true, ...await loadReferralState(gate.admin, id, true) });
  } catch (error) { return referralFailure(error); }
}
export async function POST(req: Request) {
  try {
    const gate = await referralStaff(req);
    if (!gate) return referralReply({ ok: false, error: "Se requiere una sesión de central o administración." }, 403);
    const body = await req.json().catch(() => null);
    if (body?.action !== "add") throw new ReferralInputError("Operación no válida.");
    const result = await gate.admin.rpc("tc_add_client_referral", { p_referrer_id: requireReferralUuid(body.cliente_id), p_referred_id: requireReferralUuid(body.referred_cliente_id), p_actor_worker_id: gate.me.id, p_actor_user_id: gate.authUserId, p_operation_id: requireReferralUuid(body.operation_id) });
    if (result.error) throw result.error;
    return referralReply({ ok: true, referral: result.data });
  } catch (error) { return referralFailure(error, true); }
}
