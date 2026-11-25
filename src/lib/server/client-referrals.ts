import { NextResponse } from "next/server";
import { getAdminClient, workerFromRequest } from "@/lib/server/auth-worker";
import { ReferralInputError, referralRewardDescription, referralRewardItems, type ReferralAdminClaim, type ReferralHistoryQuery, type ReferralReward, type ReferralState } from "@/lib/client-referrals";

export const referralReply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" } });
export async function referralStaff(req: Request) {
  const me = await workerFromRequest(req);
  if (!me || !me.resolved_uid || me.user_id !== me.resolved_uid || me.is_active === false) return null;
  if (!["admin", "central"].includes(me.role) && !me.can_admin) return null;
  return { me, admin: getAdminClient(), authUserId: me.resolved_uid as string };
}
const rewardFields = "id,title,referrals_required,reward_type,amount,roulette_level,rank_key,rank_days,reward_items,enabled,version";
export async function referralCatalog(admin: any, onlyEnabled = false): Promise<ReferralReward[]> {
  const rows: ReferralReward[] = [];
  for (let offset = 0; ; offset += 500) {
    let q = admin.from("client_referral_rewards").select(rewardFields).order("referrals_required").order("id").range(offset, offset + 499);
    if (onlyEnabled) q = q.eq("enabled", true);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < 500) break;
  }
  return rows;
}

function deliveredReferralReward(claim: any) {
  const snapshot = claim?.reward_snapshot || {};
  const delivered = claim?.receipt?.reward_items;
  return {
    ...snapshot,
    ...(Array.isArray(delivered) && delivered.length ? { reward_items: delivered } : {}),
  };
}

export async function loadReferralClaimHistory(admin: any, query: ReferralHistoryQuery) {
  const { data, error } = await admin.rpc("tc_admin_referral_claim_history", query);
  if (error) throw error;
  const claims: ReferralAdminClaim[] = (data?.claims || []).map((claim: any) => {
    const reward = deliveredReferralReward(claim);
    return {
      id: claim.id,
      created_at: claim.created_at,
      cliente_id: claim.cliente_id,
      client_name: claim.client_name || "Cliente",
      client_phone: claim.client_phone || null,
      reward_id: claim.reward_id,
      reward_title: claim.reward_snapshot?.title || claim.receipt?.title || "Premio de referidos",
      reward_description: referralRewardDescription(reward),
      // The staff history exposes the delivered benefits, not balance snapshots,
      // auth identities or internal payment/rank operation identifiers.
      reward_items: referralRewardItems(reward).map(item => ({
        reward_type: item.reward_type, amount: item.amount,
        roulette_level: item.roulette_level ?? null,
        rank_key: item.rank_key ?? null, rank_days: item.rank_days ?? null,
      })),
      referrals_used: Number(claim.referrals_used || 0),
      status: "delivered",
    };
  });
  return { claims, total: Number(data?.total || 0), offset: query.p_offset, limit: query.p_limit };
}
export function referralFirstName(value: unknown): string {
  const name = String(value || "").trim().split(/\s+/u)[0] || "";
  return /[\p{L}]/u.test(name) && !name.includes("@") && !/\d{3}/.test(name) ? name : "Cliente";
}
export async function loadReferralState(admin: any, clientId: string, staff = false): Promise<ReferralState> {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 500) {
    const r = await admin.rpc("tc_client_referral_status", { p_referrer_id: clientId }).order("created_at").order("id").range(offset, offset + 499);
    if (r.error) throw r.error;
    rows.push(...(r.data || []));
    if ((r.data || []).length < 500) break;
  }
  const [rewards, history, oracle] = await Promise.all([
    referralCatalog(admin, true),
    admin.from("client_referral_claims").select("id,reward_snapshot,receipt,created_at").eq("cliente_id", clientId).order("created_at", { ascending: false }).order("id").limit(100),
    staff ? admin.rpc("get_cliente_oracle_balance", { p_cliente_id: clientId }) : Promise.resolve({ data: null, error: null }),
  ]);
  if (history.error) throw history.error;
  if (oracle.error) throw oracle.error;
  const ids = [...new Set(rows.map(r => r.referred_id))];
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 100) {
    const clients = await admin.from("crm_clientes").select("id,nombre,apellido").in("id", ids.slice(i, i + 100));
    if (clients.error) throw clients.error;
    for (const c of clients.data || []) names.set(c.id, staff ? [c.nombre, c.apellido].filter(Boolean).join(" ") || "Cliente" : referralFirstName(c.nombre));
  }
  const claimMap = new Map<string, any>((history.data || []).map((c: any) => [c.id, c]));
  // Fetch older linked receipts too: a consumed referral always keeps its original prize.
  const missing = [...new Set<string>(rows.map(r => r.claimed_by).filter(id => id && !claimMap.has(id)))];
  for (let i = 0; i < missing.length; i += 100) {
    const old = await admin.from("client_referral_claims").select("id,reward_snapshot,receipt,created_at").eq("cliente_id", clientId).in("id", missing.slice(i, i + 100));
    if (old.error) throw old.error;
    for (const c of old.data || []) claimMap.set(c.id, c);
  }
  const summary = { total: rows.length, available: rows.filter(r => r.status === "available").length, pending: rows.filter(r => r.status === "pending").length, claimed: rows.filter(r => r.status === "claimed").length, ...(staff ? { oracle_credits: Number(oracle.data || 0) } : {}) };
  let effectiveRank = "", rankOverride = false;
  if (rewards.some(r => referralRewardItems(r).some(item => item.reward_type === "rank"))) {
    const [rank, overrides] = await Promise.all([
      admin.rpc("tc_client_rank_state", { p_cliente_id: clientId }),
      admin.from("client_rank_overrides").select("id").eq("client_id", clientId).eq("active", true).or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`).limit(1),
    ]);
    if (rank.error) throw rank.error;
    if (overrides.error) throw overrides.error;
    effectiveRank = rank.data?.effective || "";
    rankOverride = (overrides.data || []).length > 0;
  }
  const weight: Record<string, number> = { bronce: 1, plata: 2, oro: 3, diamante: 4 };
  return {
    qualification: "purchases_over_10", claim_mode: "consume", summary,
    referrals: rows.map(r => {
      const claim = claimMap.get(r.claimed_by);
      return { id: r.id, ...(staff ? { referred_id: r.referred_id, paid_total: Number(r.paid_total || 0) } : {}), name: names.get(r.referred_id) || "Cliente", status: r.status, created_at: r.created_at, claimed_at: claim?.created_at || null, reward_title: claim?.reward_snapshot?.title || null };
    }),
    rewards: rewards.map(r => {
      const rankBlocked = referralRewardItems(r).some(item => item.reward_type === "rank" && (rankOverride || (weight[effectiveRank] || 0) >= (weight[item.rank_key || ""] || 0)));
      return { ...r, claimable: summary.available >= r.referrals_required && !rankBlocked, unavailable_reason: rankBlocked ? "Ya tienes un rango igual o superior, o una asignación temporal que debemos conservar." : summary.available < r.referrals_required ? `Necesitas ${r.referrals_required - summary.available} referido(s) disponible(s) más.` : null };
    }),
    claims: (history.data || []).map((c: any) => ({ id: c.id, reward_title: c.reward_snapshot?.title || "Premio de referidos", reward_description: referralRewardDescription(deliveredReferralReward(c)), created_at: c.created_at })),
  };
}
export function referralFailure(error: unknown, mutation = false) {
  if (error instanceof ReferralInputError) return referralReply({ ok: false, error: error.message }, 400);
  const message = String((error as any)?.message || "");
  const failures: [RegExp, number, string][] = [
    [/FORBIDDEN|AUTH_MISMATCH/, 403, "Tu sesión no permite realizar esta operación."],
    [/SELF|SAME_CLIENT|SAME_IDENTITY/, 409, "No se puede vincular a una persona como su propio referido."],
    [/CYCLE/, 409, "Ese vínculo crearía un círculo de referidos. Revisa las fichas."],
    [/ALREADY_REFERRED|DUPLICATE|ALREADY_LINKED/, 409, "Ese cliente ya está vinculado como referido."],
    [/OPERATION_REUSED|OPERATION_CONFLICT/, 409, "Esta operación ya corresponde a otros datos. Actualiza antes de continuar."],
    [/RANK/, 409, "Este premio no puede sustituir tu rango o asignación actual. Tus referidos siguen disponibles."],
    [/VERSION|CONFLICT|REWARD_CHANGED/, 409, "Los datos han cambiado. Actualiza y revisa el premio antes de continuar."],
    [/INSUFFICIENT|NOT_ENOUGH|NOT_QUALIFIED/, 409, "No tienes suficientes referidos disponibles con más de 10 € en compras confirmadas."],
    [/DISABLED|NOT_ACTIVE|NOT_FOUND|UNAVAILABLE/, 404, "El premio o la ficha ya no está disponible. Actualiza la página."],
    [/INVALID|LIMIT/, 400, "Revisa los datos y las cantidades del premio."],
  ];
  for (const [pattern, status, text] of failures) if (pattern.test(message)) return referralReply({ ok: false, error: text }, status);
  console.error("[client-referrals]", (error as any)?.code || "FAILED");
  return referralReply({ ok: false, uncertain: mutation, error: mutation ? "No se pudo confirmar la operación. Actualiza para comprobar el resultado; si reintentas, conserva la misma operación." : "No se pudieron consultar los referidos. Vuelve a intentarlo." }, 503);
}
