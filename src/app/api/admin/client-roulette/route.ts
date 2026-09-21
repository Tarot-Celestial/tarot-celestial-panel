import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rarities = new Set(["common","uncommon","rare","epic","legendary","ultra","diamond","jackpot"]);
const rewardTypes = new Set(["minutes","coins","rank","ritual","streak_minutes","perk"]);
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

  return {
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

async function audit(admin: any, gate: any, action: string, snapshot: any, campaignId?: string | null, rewardId?: string | null) {
  try {
    await admin.from("tc_client_roulette_audit").insert({
      campaign_id: campaignId || null,
      reward_id: rewardId || null,
      actor_user_id: gate.me?.user_id || null,
      action,
      snapshot: { ...(snapshot || {}), actor: gate.me?.display_name || gate.me?.email || "Admin" },
    });
  } catch {}
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
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.error === "FORBIDDEN" ? 403 : 401 });
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    const now = new Date().toISOString();

    if (action === "create_campaign") {
      const name = cleanText(body?.name, 120) || "Nueva Ruleta";
      const { data, error } = await gate.admin.from("tc_client_roulette_campaigns").insert({
        name,
        title: cleanText(body?.title, 160) || name,
        subtitle: cleanText(body?.subtitle, 300),
        status: "draft",
        active_until_disabled: true,
        created_by: gate.me?.user_id || null,
        updated_at: now,
      }).select("*").single();
      if (error) throw error;
      await audit(gate.admin, gate, "campaign_created", data, data.id);
      return NextResponse.json({ ok: true, ...(await payload(gate.admin)) });
    }

    if (action === "save_campaign") {
      const id = String(body?.id || "");
      if (!id) return NextResponse.json({ ok: false, error: "CAMPAIGN_REQUIRED" }, { status: 400 });
      const status = campaignStatuses.has(String(body?.status)) ? String(body.status) : "draft";
      const startsAt = asIso(body?.starts_at);
      const endsAt = body?.active_until_disabled ? null : asIso(body?.ends_at);
      if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) return NextResponse.json({ ok: false, error: "FECHA_FIN_INVALIDA" }, { status: 400 });
      const update = {
        name: cleanText(body?.name, 120),
        title: cleanText(body?.title, 160),
        subtitle: cleanText(body?.subtitle, 300),
        status,
        starts_at: startsAt,
        ends_at: endsAt,
        active_until_disabled: Boolean(body?.active_until_disabled),
        updated_at: now,
      };
      if (!update.name || !update.title) return NextResponse.json({ ok: false, error: "NOMBRE_Y_TITULO_REQUERIDOS" }, { status: 400 });
      const { data, error } = await gate.admin.from("tc_client_roulette_campaigns").update(update).eq("id", id).select("*").single();
      if (error) throw error;
      await audit(gate.admin, gate, "campaign_updated", data, id);
      return NextResponse.json({ ok: true, ...(await payload(gate.admin)) });
    }

    if (action === "activate_campaign") {
      const id = String(body?.id || "");
      if (!id) return NextResponse.json({ ok: false, error: "CAMPAIGN_REQUIRED" }, { status: 400 });
      await gate.admin.from("tc_client_roulette_campaigns").update({ status: "inactive", updated_at: now }).eq("status", "active").neq("id", id);
      const { data, error } = await gate.admin.from("tc_client_roulette_campaigns").update({ status: "active", starts_at: now, ends_at: null, active_until_disabled: true, updated_at: now }).eq("id", id).select("*").single();
      if (error) throw error;
      await audit(gate.admin, gate, "campaign_activated", data, id);
      return NextResponse.json({ ok: true, ...(await payload(gate.admin)) });
    }

    if (action === "save_reward") {
      const id = String(body?.id || "");
      const campaignId = String(body?.campaign_id || "");
      const level = Number(body?.nivel);
      const rewardType = String(body?.reward_type || "minutes");
      const rarity = String(body?.rarity || "common");
      const fulfillmentMode = String(body?.fulfillment_mode || "immediate");
      const name = cleanText(body?.name, 140);
      const weight = Number(body?.weight || 0);
      const rewardValue = Number(body?.reward_value || 0);
      if (!campaignId || ![1,2,3].includes(level) || !name || !rewardTypes.has(rewardType) || !rarities.has(rarity) || !fulfillmentModes.has(fulfillmentMode) || !Number.isFinite(weight) || weight < 0 || !Number.isFinite(rewardValue) || rewardValue < 0) {
        return NextResponse.json({ ok: false, error: "PREMIO_INVALIDO" }, { status: 400 });
      }
      const row = {
        campaign_id: campaignId,
        nivel: level,
        name,
        description: cleanText(body?.description, 500),
        reward_type: rewardType,
        reward_value: rewardValue,
        rarity,
        weight,
        special: Boolean(body?.special),
        fulfillment_mode: fulfillmentMode,
        icon_key: cleanText(body?.icon_key, 50),
        metadata: jsonMeta(body?.metadata),
        is_active: body?.is_active !== false,
        sort_order: Math.floor(Number(body?.sort_order || 0)),
        updated_at: now,
      };
      const result = id
        ? await gate.admin.from("tc_client_roulette_rewards").update(row).eq("id", id).select("*").single()
        : await gate.admin.from("tc_client_roulette_rewards").insert(row).select("*").single();
      if (result.error) throw result.error;
      await audit(gate.admin, gate, id ? "reward_updated" : "reward_created", result.data, campaignId, result.data.id);
      return NextResponse.json({ ok: true, ...(await payload(gate.admin)) });
    }

    if (action === "toggle_reward") {
      const id = String(body?.id || "");
      const { data, error } = await gate.admin.from("tc_client_roulette_rewards").update({ is_active: Boolean(body?.is_active), updated_at: now }).eq("id", id).select("*").single();
      if (error) throw error;
      await audit(gate.admin, gate, "reward_toggled", data, data.campaign_id, id);
      return NextResponse.json({ ok: true, ...(await payload(gate.admin)) });
    }

    if (action === "delete_reward") {
      const id = String(body?.id || "");
      const { data: reward, error: findError } = await gate.admin.from("tc_client_roulette_rewards").select("*").eq("id", id).single();
      if (findError) throw findError;
      const { count, error: usedError } = await gate.admin.from("cliente_ruleta_giros").select("id", { count: "exact", head: true }).eq("reward_id", id);
      if (usedError) throw usedError;
      if ((count || 0) > 0) {
        const { error } = await gate.admin.from("tc_client_roulette_rewards").update({ is_active: false, updated_at: now }).eq("id", id);
        if (error) throw error;
        await audit(gate.admin, gate, "reward_archived", reward, reward.campaign_id, id);
      } else {
        const { error } = await gate.admin.from("tc_client_roulette_rewards").delete().eq("id", id);
        if (error) throw error;
        await audit(gate.admin, gate, "reward_deleted", reward, reward.campaign_id, id);
      }
      return NextResponse.json({ ok: true, ...(await payload(gate.admin)) });
    }

    if (action === "complete_entitlement") {
      const id = String(body?.id || "");
      const { data, error } = await gate.admin.from("tc_client_roulette_entitlements").update({ status: "completed", updated_at: now }).eq("id", id).select("*").single();
      if (error) throw error;
      await audit(gate.admin, gate, "entitlement_completed", data, data.campaign_id, data.reward_id);
      return NextResponse.json({ ok: true, ...(await payload(gate.admin)) });
    }

    return NextResponse.json({ ok: false, error: "ACTION_NOT_SUPPORTED" }, { status: 400 });
  } catch (error: any) {
    console.error("[admin/client-roulette:post]", error);
    const message = String(error?.message || "");
    if (message.includes("relation") && message.includes("does not exist")) {
      return NextResponse.json({ ok: false, error: "FALTA_EJECUTAR_SQL_RULETA_ULTRA" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: message || "RULETA_ADMIN_ACTION_FAILED" }, { status: 500 });
  }
}
