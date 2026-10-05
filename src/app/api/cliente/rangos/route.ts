import { NextResponse } from "next/server";
import { rouletteClient, RouletteAccessError } from "@/lib/server/ruleta-access";
import { currentRankBenefits } from "@/lib/server/cliente-platform";
import { CLIENT_GUIDE_RANKS, guideRankKey, type ClientRankGuide } from "@/lib/client-rank-guide";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };


export async function GET(req: Request) {
  try {
    // Client identity comes from the verified token; no caller-supplied client id.
    const { admin, cliente } = await rouletteClient(req);
    const [stateResult, catalogue, matrix, daily] = await Promise.all([
      admin.rpc("tc_client_rank_state", { p_cliente_id: cliente.id }),
      admin.from("tc_client_rank_benefits")
        .select("rank_key,label,min_spend,sort_order,is_active,ritual_access,coins_enabled,purchase_coins,roulette_enabled,roulette_level,roulette_spins")
        .in("rank_key", [...CLIENT_GUIDE_RANKS]).order("sort_order"),
      admin.from("tc_rank_package_benefits")
        .select("rank_key,package_level,enabled,coins,oracle_credits,roulette_level_1_spins,roulette_level_2_spins,roulette_level_3_spins,roulette_special_spins").order("package_level"),
      admin.from("tc_rank_daily_bonus_config")
        .select("rank_key,enabled,name,description,coins,oracle_credits,roulette_level_1_spins,roulette_level_2_spins,roulette_level_3_spins,roulette_special_spins").eq("rank_key", "diamante").eq("enabled", true).maybeSingle(),
    ]);
    if (stateResult.error) throw stateResult.error;
    if (catalogue.error) throw catalogue.error;
    const source = stateResult.data;
    if (!source || source.total == null || !Number.isFinite(Number(source.total)) || Number(source.total) < 0) {
      throw new Error("RANK_STATE_UNAVAILABLE");
    }
    const rows = catalogue.data || [];
    if (CLIENT_GUIDE_RANKS.some(key => !rows.some(row => row.rank_key === key &&
      row.min_spend != null && Number.isFinite(Number(row.min_spend)) && Number(row.min_spend) >= 0))) {
      throw new Error("RANK_CATALOGUE_UNAVAILABLE");
    }
    const effective = guideRankKey(source.effective);
    const automatic = guideRankKey(source.automatic);
    const result: ClientRankGuide = {
      ok: true, cliente_id: String(cliente.id), currency: "USD", window_days: 30,
      refreshed_at: new Date().toISOString(),
      state: {
        effective, automatic, total: Number(source.total),
        purchases: source.compras == null ? null : Math.max(0, Number(source.compras) || 0),
        has_override: Boolean(source.override || source.has_override || effective !== automatic),
        override_ends_at: source.override?.ends_at || source.override_ends_at || null,
      },
      ranks: CLIENT_GUIDE_RANKS.map(key => {
        const row = rows.find(item => item.rank_key === key)!;
        // is_active controls legacy global grants; it does not disable the rank programme or its matrix.
        const active = true;
        const benefits = active ? currentRankBenefits(key).filter(label => !label.includes("Mi Ritual")) : [];
        if (active && row.ritual_access) benefits.unshift("Acceso a Mi ritual y seguimiento de tus rituales");
        if (key !== "diamante" && active && row.coins_enabled && Number(row.purchase_coins) > 0) benefits.push("+" + row.purchase_coins + " Coins adicionales por compra válida");
        if (active && row.roulette_enabled && Number(row.roulette_spins) > 0) benefits.push("+" + row.roulette_spins + " giro(s) de ruleta nivel " + row.roulette_level + " por compra válida");
        if (key === "diamante") benefits.push("1 giro de Ruleta Diamante por cada compra válida confirmada con rango Diamante");
        return {
          key, label: String(row.label || key), min_spend: Number(row.min_spend), active, benefits,
          package_benefits: matrix.error ? null : (matrix.data || []).filter(item => item.rank_key === key),
        };
      }),
      // Only public programme fields are returned; no notes, audits or staff ids.
      daily_bonus: daily.error ? null : daily.data,
      daily_bonus_available: !daily.error,
      warnings: [
        ...(matrix.error ? ["No hemos podido consultar los extras por paquete."] : []),
        ...(daily.error ? ["No hemos podido consultar la configuración del bono diario."] : []),
      ],
    };
    return NextResponse.json(result, { headers });
  } catch (error) {
    const status = error instanceof RouletteAccessError ? error.status : 503;
    return NextResponse.json({ ok: false, error: error instanceof RouletteAccessError ? error.message :
      "No hemos podido consultar tus rangos. Vuelve a intentarlo." }, { status, headers });
  }
}