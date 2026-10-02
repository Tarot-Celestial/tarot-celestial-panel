import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rarities = new Set(["common","uncommon","rare","epic","legendary","ultra","diamond","jackpot"]);
const rewardTypes = new Set(["minutes","coins","oracle_credits","rank","ritual","streak_minutes","perk"]);
const fulfillmentModes = new Set(["immediate","temporary","manual","claim","scheduled"]);
const campaignStatuses = new Set(["draft","scheduled","active","inactive","finished","archived"]);

function cleanText(value: unknown, max = 500) {
  const text = String(value || "").trim();
  return text ? text.slice(0, max) : null;
}
function asIso(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function jsonMeta(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function payload(admin: any) {
  const { data: campaigns, error: campaignError } = await admin
    .from("tc_client_roulette_campaigns")
    .select("*")
    .order("created_at", { ascending: false });
  if (campaignError) throw campaignError;

  const ids = (campaigns || []).map((row: any) => row.id);
  let rewards: any[] = [];
  if (ids.length) {
    const result = await admin
      .from("tc_client_roulette_rewards")
      .select("*")
      .in("campaign_id", ids)
      .order("nivel", { ascending: true })
      .order("sort_order", { ascending: true });
    if (result.error) throw result.error;
    rewards = result.data || [];
  }

  const now = new Date();
  const activeCampaign = (campaigns || []).find((row: any) => {
    if (row.status !== "active") return false;
    if (row.starts_at && new Date(row.starts_at) > now) return false;
    if (!row.active_until_disabled && row.ends_at && new Date(row.ends_at) <= now) return false;
    return true;
  }) || null;

  const totals = new Map<string, number>();
  for (const reward of rewards) {
    if (!reward.is_active || Number(reward.weight || 0) <= 0) continue;
    const key = `${reward.campaign_id}:${reward.nivel}`;
    totals.set(key, Number(totals.get(key) || 0) + Number(reward.weight || 0));
  }
  const decoratedRewards = rewards.map((reward: any) => {
    const total = Number(totals.get(`${reward.campaign_id}:${reward.nivel}`) || 0);
    return {
      ...reward,
      probability: total > 0 && reward.is_active ? Number(((Number(reward.weight || 0) / total) * 100).toFixed(4)) : 0,
    };
  });

  const [spinResult, entitlementResult] = await Promise.all([
    admin.from("cliente_ruleta_giros")
      .select("id,cliente_id,nivel,estado,created_at,used_at,reward_id,reward_type,reward_value,reward_label,reward_rarity,result_status,campaign_id")
      .eq("estado", "used")
      .order("used_at", { ascending: false })
      .limit(120),
    admin.from("tc_client_roulette_entitlements")
      .select("id,cliente_id,reward_name,reward_type,status,fulfillment_mode,claims_used,total_claims,created_at,expires_at")
      .order("created_at", { ascending: false })
      .limit(80),
  ]);
  if (spinResult.error) throw spinResult.error;
  if (entitlementResult.error) throw entitlementResult.error;

  const clientIds = Array.from(new Set((spinResult.data || []).map((row: any) => String(row.cliente_id || "")).filter(Boolean)));
  const clientMap = new Map<string, string>();
  if (clientIds.length) {
    const clients = await admin.from("crm_clientes").select("id,nombre,apellido,telefono").in("id", clientIds);
    if (!clients.error) {
      for (const c of clients.data || []) clientMap.set(String(c.id), [c.nombre,c.apellido].filter(Boolean).join(" ").trim() || c.telefono || "Cliente");
    }
  }
  const history = (spinResult.data || []).map((row: any) => ({ ...row, client_name: clientMap.get(String(row.cliente_id)) || "Cliente" }));

  const totalSpins = history.length;
  const rarityCounts: Record<string, number> = {};
  const rewardCounts: Record<string, number> = {};
  for (const row of history) {
    const rarity = String(row.reward_rarity || "common");
    rarityCounts[rarity] = Number(rarityCounts[rarity] || 0) + 1;
    const label = String(row.reward_label || "Premio");
    rewardCounts[label] = Number(rewardCounts[label] || 0) + 1;
  }
  const mostAwarded = Object.entries(rewardCounts).sort((a,b)=>b[1]-a[1])[0] || null;

  const ranks = await admin.from("tc_client_rank_benefits").select("rank_key,label").order("sort_order");
  if(ranks.error) throw ranks.error;
  return {
    ranks: ranks.data,
    campaigns: campaigns || [],
    active_campaign: activeCampaign,
    rewards: decoratedRewards,
    history,
    entitlements: entitlementResult.data || [],
    stats: {
      total_spins_loaded: totalSpins,
      special_spins: history.filter((row: any) => ["epic","legendary","ultra","diamond","jackpot"].includes(String(row.reward_rarity || ""))).length,
      pending_fulfillment: (entitlementResult.data || []).filter((row: any) => ["pending","active"].includes(String(row.status))).length,
      most_awarded: mostAwarded ? { name: mostAwarded[0], count: mostAwarded[1] } : null,
      rarity_counts: rarityCounts,
    },
  };
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.error === "FORBIDDEN" ? 403 : 401 });
    return NextResponse.json({ ok: true, ...(await payload(gate.admin)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    console.error("[admin/client-roulette:get]", error);
    return NextResponse.json({ ok: false, error: error?.message || "RULETA_ADMIN_LOAD_FAILED" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
    const body = await req.json();
    if (body.action === "save_campaign") {
      body.starts_at = asIso(body.starts_at); body.ends_at = asIso(body.ends_at);
    }
    const result = await gate.admin.rpc("tc_save_roulette_config", { p_actor: gate.me.user_id, p_data: body });
    if (result.error) throw result.error;
    return NextResponse.json({ ok: true, ...(await payload(gate.admin)) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch(error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "No se pudo guardar la ruleta." }, { status: 409 });
  }
}
