import "server-only";
import type { rouletteClient } from "@/lib/server/ruleta-access";
import { promotionIsLive } from "@/lib/server/client-promotions";
import { CLIENT_GUIDE_RANKS, guideRankKey } from "@/lib/client-rank-guide";
import { leoAction, leoSpins, type LeoSnapshot } from "@/lib/leo-guide";
import type { LeoLiveFacts, LeoMemoryProfile } from "@/lib/leo-celestial-intelligence";
import { leonarisFavoriteSections, leonarisVisitCount, type LeoCompanion } from "@/lib/leonaris-companion";
import type { LeonarisMemoryState } from "@/lib/server/leonaris-memory";

type Gate = Awaited<ReturnType<typeof rouletteClient>>;
export type LeonarisContext = {
  name: string | null;
  facts: LeoLiveFacts;
  snapshot: LeoSnapshot;
  purchase: { id: string; name: string; coins: number | null } | null;
  purchaseAvailable: boolean;
  raffle: { title: string; numbers: number[]; total: number } | null;
  raffleAvailable: boolean;
};
export const leonarisProfile = (row: any): LeoMemoryProfile => ({
  hidden: Boolean(row?.hidden), muted: Boolean(row?.muted),
  visit_counts: row?.visit_counts || {}, interest_scores: row?.interest_scores || {},
  interaction_counts: row?.interaction_counts || {}, last_path: row?.last_path || null, last_seen_at: row?.last_seen_at || null,
});
const finite = (value: unknown): number | null => value != null && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const label = (value: unknown, max = 100) => typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";

async function loadRoulette(gate: Gate) {
  let result = await gate.admin.rpc("cliente_ruleta_resumen_ultra_v1", { p_cliente_id: gate.cliente.id });
  if (result.error && ["42883", "PGRST202"].includes(result.error.code)) {
    result = await gate.admin.rpc("cliente_ruleta_resumen_v4", { p_cliente_id: gate.cliente.id });
  }
  if (result.error || !result.data || result.data.cliente_id !== gate.cliente.id) return null;
  return result.data;
}

// Only the client id resolved from a verified auth_user_id is accepted. Never use names/phones from a prompt.
export async function loadLeonarisContext(gate: Gate, detailed = false): Promise<LeonarisContext> {
  const id = gate.cliente.id;
  const [stateResult, roulette, customer, promotions, payment] = await Promise.all([
    gate.admin.rpc("tc_client_state_snapshot", { p_cliente_id: id }), loadRoulette(gate),
    gate.admin.from("crm_clientes").select("nombre").eq("id", id).maybeSingle(),
    gate.admin.from("tc_client_promotions").select("id,name,status,starts_at,ends_at,active_until_disabled").in("status", ["active", "scheduled"]).order("created_at", { ascending: false }),
    gate.admin.from("crm_cliente_pagos").select("id,pack_name,updated_at").eq("cliente_id", id).eq("estado", "completed")
      .gte("updated_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const state = stateResult.data;
  if (stateResult.error || !state || state.cliente_id !== id || state.auth_user_id !== gate.user.id ||
    [state.coins, state.minutes_total, state.oracle_credits].some(value => finite(value) === null)) throw new Error("LEONARIS_BALANCE_UNAVAILABLE");
  const active = promotions.error ? null : (promotions.data || []).find(row => promotionIsLive(row, new Date()));
  const facts: LeoLiveFacts = {
    coins: Number(state.coins), minutes: Number(state.minutes_total), oracleCredits: Number(state.oracle_credits),
    pendingSpins: roulette ? leoSpins(roulette).reduce((sum, row) => sum + row.amount, 0) : 0,
    activePromotion: active ? { id: active.id, name: label(active.name) || "Promoción activa" } : null,
  };
  const context: LeonarisContext = {
    name: customer.error ? null : label(customer.data?.nombre, 80) || null,
    facts, snapshot: { roulette, ranks: null, bonuses: null, oracle: null, wallet: facts, updatedAt: Date.now() },
    purchase: null, purchaseAvailable: !payment.error, raffle: null, raffleAvailable: false,
  };
  if (!payment.error && payment.data) {
    const benefits = await gate.admin.from("tc_client_benefit_events").select("coins").eq("cliente_id", id).eq("payment_id", payment.data.id);
    context.purchase = { id: payment.data.id, name: label(payment.data.pack_name) || "tu paquete", coins: benefits.error ? null : (benefits.data || []).reduce((sum, row) => sum + (finite(row.coins) || 0), 0) };
  }
  if (!detailed) return context;
  const [catalogue, daily, raffle] = await Promise.all([
    gate.admin.from("tc_client_rank_benefits").select("rank_key,label,min_spend,ritual_access").in("rank_key", [...CLIENT_GUIDE_RANKS]).order("sort_order"),
    gate.admin.rpc("tc_available_rank_bonuses", { p_cliente_id: id }),
    gate.admin.from("raffles").select("id,title").eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const rank = state.rank_state;
  if (!catalogue.error && finite(rank?.total) !== null && CLIENT_GUIDE_RANKS.every(key => catalogue.data?.some(row => row.rank_key === key && finite(row.min_spend) !== null))) {
    context.snapshot.ranks = {
      ok: true, cliente_id: id, currency: "USD", window_days: 30, refreshed_at: new Date().toISOString(),
      state: { effective: guideRankKey(rank.effective), automatic: guideRankKey(rank.automatic), total: Number(rank.total), purchases: finite(rank.compras), has_override: Boolean(rank.override || rank.has_override || rank.effective !== rank.automatic), override_ends_at: rank.override?.ends_at || null },
      ranks: CLIENT_GUIDE_RANKS.map(key => {
        const row = catalogue.data!.find(item => item.rank_key === key)!;
        return { key, label: label(row.label) || key, min_spend: Number(row.min_spend), active: true, benefits: row.ritual_access ? ["Acceso a Mi ritual"] : [], package_benefits: null };
      }), daily_bonus: null, daily_bonus_available: false, warnings: [],
    };
  }
  if (!daily.error && Array.isArray(daily.data)) context.snapshot.bonuses = daily.data;
  if (!raffle.error) {
    context.raffleAvailable = true;
    if (raffle.data) {
      const entries = await gate.admin.from("raffle_entries").select("raffle_number", { count: "exact" }).eq("raffle_id", raffle.data.id).eq("client_id", id).order("raffle_number").limit(100);
      if (entries.error || entries.data?.some(row => !Number.isSafeInteger(Number(row.raffle_number)) || Number(row.raffle_number) < 1)) context.raffleAvailable = false;
      else context.raffle = { title: label(raffle.data.title) || "Sorteo activo", numbers: (entries.data || []).map(row => Number(row.raffle_number)), total: entries.count ?? entries.data?.length ?? 0 };
    }
  }
  return context;
}

export function leonarisCompanion(memory: LeonarisMemoryState, context: LeonarisContext): LeoCompanion {
  const name = memory.displayName || context.name;
  const hello = name ? `Hola, ${name}.` : "Hola, qué bueno verte por aquí.";
  const spins = leoSpins(context.snapshot.roulette).filter(row => row.playable);
  const purchase = context.purchase;
  const balance = `Ahora tienes ${context.facts.coins.toLocaleString("es-ES")} Coins y ${context.facts.minutes.toLocaleString("es-ES")} minutos.`;
  const available = spins.length ? ` Tienes ${spins.map(row => `${row.amount} giro${row.amount === 1 ? "" : "s"} de nivel ${row.level}`).join(" y ")} disponible${spins.reduce((sum, row) => sum + row.amount, 0) === 1 ? "" : "s"}. Te acompaño cuando quieras.` : " Puedes preguntarme por tus minutos, tus cartas o tus apartados.";
  const favorites = memory.memoryEnabled ? leonarisFavoriteSections(memory.profile) : [];
  const visits = memory.memoryEnabled ? leonarisVisitCount(memory.profile) : 0;
  return {
    displayName: memory.displayName, memoryEnabled: memory.memoryEnabled, style: memory.style, memories: memory.memories,
    favoriteSections: favorites,
    learning: { helpful: memory.helpful, unhelpful: memory.unhelpful, visits,
      summary: !memory.memoryEnabled ? "Memoria pausada: no uso recuerdos ni registro tus nuevas visitas o conversaciones." : favorites.length ? `Tengo en cuenta que visitas ${favorites[0].label}. Tus valoraciones me ayudan a ajustar las explicaciones.` : "Voy conociendo tus apartados habituales y las explicaciones que te resultan útiles." },
    greeting: { id: purchase ? `purchase:${purchase.id}` : "welcome", title: purchase ? "Tu compra está confirmada" : "Soy Leonaris, tu compañero",
      message: `${hello} ${purchase ? `La compra de ${purchase.name} figura confirmada.${purchase.coins ? ` Ha acreditado ${purchase.coins.toLocaleString("es-ES")} Coins.` : ""} ` : ""}${balance}${available}`,
      actions: spins.length ? spins.map(row => row.action).slice(0, 3) : [leoAction("welcome-minutes", "Ver mis minutos", "/cliente/dashboard", "minutes", "Aquí puedes ver el saldo actualizado de tus minutos.")],
    },
  };
}
