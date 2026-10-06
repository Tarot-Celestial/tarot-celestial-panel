import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { CLIENTE_MINUTE_PACKS } from "@/lib/server/cliente-minute-packs";
import {
  validateDiamondDailyBonus,
  validatePackageLevelAssignment,
  validateRankPackageBenefitEdit,
  validateRitualAccessEdit,
} from "@/lib/rank-benefit-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate", Pragma: "no-cache", Expires: "0", Vary: "Authorization" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

function failure(error: any) {
  const raw = String(error?.message || error?.details || "No se pudo completar la operación.");
  if (/CONFIG_CONFLICT/i.test(raw)) return reply({ ok: false, error: "Otra sesión modificó esta configuración. Recarga y revisa los cambios antes de guardar." }, 409);
  if (/42P01|PGRST205|does not exist|schema cache/i.test(raw)) return reply({ ok: false, error: "Faltan migraciones de Beneficios de rangos en Supabase. Aplica las migraciones pendientes en orden." }, 409);
  if (/INVALID_|BONUS_REWARD_REQUIRED/i.test(raw)) return reply({ ok: false, error: raw }, 400);
  return reply({ ok: false, error: raw }, 500);
}


async function clientState(admin: any, clienteId: string) {
  const [{ data: client, error: clientError }, snapshotResult] = await Promise.all([
    admin
      .from("crm_clientes")
      .select("id,nombre,apellido,email,telefono,telefono_normalizado")
      .eq("id", clienteId)
      .maybeSingle(),
    admin.rpc("tc_client_state_snapshot_diamond_v1", { p_cliente_id: clienteId }),
  ]);
  if (clientError) throw clientError;
  if (!client) throw new Error("CLIENT_NOT_FOUND");
  if (snapshotResult.error) throw snapshotResult.error;

  const snapshot = snapshotResult.data || {};
  const spins = snapshot.spins || {};
  return {
    id: String(client.id),
    name: [client.nombre, client.apellido].filter(Boolean).join(" ").trim() || client.telefono || "Cliente",
    email: client.email || null,
    phone: client.telefono || client.telefono_normalizado || null,
    coins: Math.max(0, Number(snapshot.coins || 0)),
    minutes_free: Math.max(0, Number(snapshot.minutes_free || 0)),
    minutes_normal: Math.max(0, Number(snapshot.minutes_normal || 0)),
    minutes_total: Math.max(0, Number(snapshot.minutes_total || 0)),
    oracle_credits: Math.max(0, Number(snapshot.oracle_credits || 0)),
    effective_rank: String(snapshot.effective_rank || "") || null,
    automatic_rank: String(snapshot.automatic_rank || "") || null,
    spins: {
      level_1: Math.max(0, Number(spins.level_1 || 0)),
      level_2: Math.max(0, Number(spins.level_2 || 0)),
      level_3: Math.max(0, Number(spins.level_3 || 0)),
      diamond: Math.max(0, Number(spins.diamond || 0)),
    },
    refreshed_at: snapshot.refreshed_at || null,
    signal_updated_at: snapshot.signal_updated_at || null,
  };
}

async function searchClients(admin: any, rawQuery: unknown) {
  const query = String(rawQuery || "").trim().slice(0, 120);
  if (query.length < 2) return [];
  const first = query.split(/\s+/)[0];
  const terms = [...new Set([query, first].filter((value) => value.length >= 2))];
  const columns = ["nombre", "apellido", "email", "telefono", "telefono_normalizado"] as const;
  const requests = terms.flatMap((term) => columns.map((column) => admin
    .from("crm_clientes")
    .select("id,nombre,apellido,email,telefono,telefono_normalizado,puntos")
    .ilike(column, `%${term}%`)
    .limit(15)));
  const settled = await Promise.all(requests);
  const merged = new Map<string, any>();
  for (const result of settled) {
    if (result.error) throw result.error;
    for (const row of result.data || []) merged.set(String(row.id), row);
  }
  const normalized = query.toLocaleLowerCase("es");
  const candidates = [...merged.values()].filter((row) => {
    const haystack = [row.nombre, row.apellido, row.email, row.telefono, row.telefono_normalizado].filter(Boolean).join(" ").toLocaleLowerCase("es");
    return haystack.includes(normalized) || query.split(/\s+/).every((piece) => haystack.includes(piece.toLocaleLowerCase("es")));
  }).slice(0, 20);
  return Promise.all(candidates.map(async (row) => {
    const rank = await admin.rpc("tc_client_rank_state", { p_cliente_id: row.id });
    if (rank.error) throw rank.error;
    return {
      id: String(row.id),
      name: [row.nombre, row.apellido].filter(Boolean).join(" ").trim() || row.telefono || "Cliente",
      email: row.email || null,
      phone: row.telefono || row.telefono_normalizado || null,
      coins: Math.max(0, Number(row.puntos || 0)),
      effective_rank: String(rank.data?.effective || "") || null,
    };
  }));
}

async function actorNames(admin: any, rows: any[]) {
  const ids = [...new Set(rows.map((row) => row?.actor_user_id || row?.updated_by).filter(Boolean))];
  if (!ids.length) return new Map<string, string>();
  const { data, error } = await admin.from("workers").select("user_id,display_name,email").in("user_id", ids);
  if (error) throw error;
  return new Map((data || []).map((row: any) => [String(row.user_id), String(row.display_name || row.email || row.user_id)]));
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return reply({ ok: false, error: gate.error }, 403);

    const [ranks, matrix, assignments, promotionPacks, bonus, events, audit] = await Promise.all([
      gate.admin.from("tc_client_rank_benefits").select("rank_key,label,sort_order,is_active,coins_enabled,purchase_coins,roulette_enabled,roulette_level,roulette_spins,daily_bonus_enabled,ritual_access,revision,updated_at,updated_by").order("sort_order"),
      gate.admin.from("tc_rank_package_benefits").select("*").order("rank_key").order("package_level"),
      gate.admin.from("tc_purchase_package_levels").select("*").order("package_source").order("package_label"),
      gate.admin.from("tc_client_promotion_packages").select("id,name,promotion_id,is_active,price,currency,coins,oracle_credits,roulette_level,roulette_spins").order("created_at", { ascending: false }),
      gate.admin.from("tc_rank_daily_bonus_config").select("*").eq("rank_key", "diamante").maybeSingle(),
      gate.admin.from("tc_client_benefit_events").select("id,cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,package_level,delivery_key,snapshot,created_at").in("benefit_type", ["rank_package", "daily_rank_bonus"]).order("created_at", { ascending: false }).limit(80),
      gate.admin.from("tc_client_benefit_audit").select("*").in("entity", ["rank_package_benefit", "rank_ritual_access", "package_level_assignment", "diamond_daily_bonus"]).order("created_at", { ascending: false }).limit(80),
    ]);
    for (const result of [ranks, matrix, assignments, promotionPacks, bonus, events, audit]) if (result.error) throw result.error;

    const standard = CLIENTE_MINUTE_PACKS.map((pack) => ({
      package_source: "standard",
      package_key: pack.id,
      package_label: `${pack.nombre} · $${pack.priceUsd}`,
      active: true,
      native_benefits: {
        coins: Number(pack.rewardCoins || 0),
        oracle_credits: Number(pack.oracleCredits || 0),
        roulette_level: pack.rouletteLevel,
        roulette_spins: pack.rouletteSpins,
      },
    }));
    const promotions = (promotionPacks.data || []).map((pack: any) => ({
      package_source: "promotion",
      package_key: String(pack.id),
      package_label: `${pack.name || "Pack promoción"} · ${Number(pack.price || 0).toFixed(2)} ${pack.currency || "EUR"}`,
      active: pack.is_active !== false,
      promotion_id: pack.promotion_id,
      native_benefits: { coins: Number(pack.coins || 0), oracle_credits: Number(pack.oracle_credits || 0), roulette_level: pack.roulette_level, roulette_spins: Number(pack.roulette_spins || 0) },
    }));

    const eventClientIds = [...new Set((events.data || []).map((row: any) => row.cliente_id).filter(Boolean))];
    const clients = eventClientIds.length
      ? await gate.admin.from("crm_clientes").select("id,nombre,apellido").in("id", eventClientIds)
      : { data: [], error: null } as any;
    if (clients.error) throw clients.error;
    const names = new Map((clients.data || []).map((row: any) => [String(row.id), [row.nombre, row.apellido].filter(Boolean).join(" ") || row.id]));
    const namesByActor = await actorNames(gate.admin, [...(audit.data || []), ...(ranks.data || []), ...(matrix.data || []), ...(assignments.data || []), ...(bonus.data ? [bonus.data] : [])]);

    return reply({
      ok: true,
      business_timezone: "Europe/Madrid",
      ranks: (ranks.data || []).map((row: any) => ({ ...row, updated_by_name: namesByActor.get(String(row.updated_by || "")) || null })),
      matrix: (matrix.data || []).map((row: any) => ({ ...row, updated_by_name: namesByActor.get(String(row.updated_by || "")) || null })),
      assignments: (assignments.data || []).map((row: any) => ({ ...row, updated_by_name: namesByActor.get(String(row.updated_by || "")) || null })),
      packages: [...standard, ...promotions],
      diamond_bonus: bonus.data ? { ...bonus.data, updated_by_name: namesByActor.get(String(bonus.data.updated_by || "")) || null } : null,
      deliveries: (events.data || []).map((row: any) => ({ ...row, client_name: names.get(String(row.cliente_id)) || row.cliente_id })),
      audit: (audit.data || []).map((row: any) => ({ ...row, actor_name: namesByActor.get(String(row.actor_user_id || "")) || "Sistema / migración" })),
    });
  } catch (error) { return failure(error); }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return reply({ ok: false, error: gate.error }, 403);
    const body = await req.json();
    const action = String(body?.action || "");
    let data: any;
    let rpc = "";
    let args: Record<string, unknown> = {};

    if (action === "search_clients") {
      return reply({ ok: true, clients: await searchClients(gate.admin, body?.query) });
    } else if (action === "client_state") {
      const clienteId = String(body?.cliente_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(clienteId)) return reply({ ok: false, error: "Cliente no válido." }, 400);
      return reply({ ok: true, client: await clientState(gate.admin, clienteId) });
    } else if (action === "grant_manual_benefits") {
      const clienteId = String(body?.cliente_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(clienteId)) return reply({ ok: false, error: "Cliente no válido." }, 400);
      const grant = body?.grant && typeof body.grant === "object" ? body.grant : {};
      const safeGrant = {
        roulette_level_1_spins: Math.min(100, Math.max(0, Math.trunc(Number(grant.roulette_level_1_spins || 0)))),
        roulette_level_2_spins: Math.min(100, Math.max(0, Math.trunc(Number(grant.roulette_level_2_spins || 0)))),
        roulette_level_3_spins: Math.min(100, Math.max(0, Math.trunc(Number(grant.roulette_level_3_spins || 0)))),
        roulette_diamond_spins: Math.min(100, Math.max(0, Math.trunc(Number(grant.roulette_diamond_spins || 0)))),
        coins: Math.min(1000000, Math.max(0, Math.trunc(Number(grant.coins || 0)))),
        oracle_credits: Math.min(10000, Math.max(0, Math.trunc(Number(grant.oracle_credits || 0)))),
        gift_minutes: Math.min(100000, Math.max(0, Math.trunc(Number(grant.gift_minutes || 0)))),
        reason: String(grant.reason || "").trim().slice(0, 300),
      };
      const total = safeGrant.roulette_level_1_spins + safeGrant.roulette_level_2_spins + safeGrant.roulette_level_3_spins + safeGrant.roulette_diamond_spins + safeGrant.coins + safeGrant.oracle_credits + safeGrant.gift_minutes;
      if (total <= 0) return reply({ ok: false, error: "Indica al menos un beneficio para acreditar." }, 400);
      const { data: granted, error: grantError } = await gate.admin.rpc("tc_admin_grant_client_benefits", {
        p_actor: gate.me.user_id,
        p_cliente_id: clienteId,
        p_grant: safeGrant,
      });
      if (grantError) throw grantError;
      return reply({ ok: true, granted, client: await clientState(gate.admin, clienteId) });
    } else if (action === "save_matrix") {
      data = validateRankPackageBenefitEdit(body.data);
      rpc = "tc_save_rank_package_benefit";
      args = { p_actor: gate.me.user_id, p_edit: data };
    } else if (action === "save_ritual") {
      data = validateRitualAccessEdit(body.data);
      rpc = "tc_save_rank_ritual_access";
      args = { p_actor: gate.me.user_id, p_edit: data };
    } else if (action === "save_assignment") {
      data = validatePackageLevelAssignment(body.data);
      rpc = "tc_save_purchase_package_level";
      args = { p_actor: gate.me.user_id, p_edit: data };
    } else if (action === "save_bonus") {
      data = validateDiamondDailyBonus(body.data);
      rpc = "tc_save_diamond_daily_bonus";
      args = { p_actor: gate.me.user_id, p_edit: data };
    } else if (action === "preview") {
      data = validateRankPackageBenefitEdit(body.data);
      const packageSource = String(body?.package_source || "");
      const packageKey = String(body?.package_key || "").trim();
      if (!["standard", "promotion"].includes(packageSource) || !packageKey) {
        return reply({ ok: false, error: "Selecciona un paquete asignado a este nivel para la vista previa." }, 400);
      }
      rpc = "tc_resolve_rank_package_benefit";
      args = {
        p_cliente_id: null,
        p_rank_key_override: data.rank_key,
        p_package_source: packageSource,
        p_package_key: packageKey,
        p_config_override: data,
      };
    } else {
      return reply({ ok: false, error: "Acción no válida." }, 400);
    }

    const { data: saved, error } = await gate.admin.rpc(rpc, args);
    if (error) throw error;
    if (saved == null) throw new Error("Supabase no confirmó la operación.");
    return reply({ ok: true, saved });
  } catch (error) { return failure(error); }
}
