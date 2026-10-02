import { rankState, decoratePacks } from "@/lib/server/rank-benefits";
import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import {
  toNum,
} from "@/lib/server/cliente-platform";
import { loadEffectiveClientRank, normalizeClientRank } from "@/lib/server/client-rank-effective";
import { CLIENTE_MINUTE_PACKS } from "@/lib/server/cliente-minute-packs";
import { getActiveClientPaymentProvider } from "@/lib/server/client-payment-settings";

export const runtime = "nodejs";

type ClienteRow = Record<string, any> & {
  id: string;
  nombre?: string | null;
  apellido?: string | null;
  puntos?: number | null;
  minutos_free_pendientes?: number | null;
  minutos_normales_pendientes?: number | null;
  regalo_bienvenida_elegible?: boolean | null;
  regalo_bienvenida_otorgado?: boolean | null;
};

function configuredBenefits(c:any):string[] {
  if(!c?.is_active) return [];
  return [c.coins_enabled?`+${c.purchase_coins} Coins extra por compra`:null,
    c.roulette_enabled?`${c.roulette_spins} tirada(s) extra en ${c.roulette_level===5?"Ruleta Diamante":`Ruleta Nivel ${c.roulette_level}`}`:null,
    c.daily_bonus_enabled?"Acceso al bono exclusivo diario activo":null].filter(Boolean) as string[];
}
function rankMeta(rank:any) {return {key:rank,label:rank,min:0,nextRank:null,nextLabel:null,nextTarget:null,benefits:[] as string[],nextBenefits:[] as string[]}}

async function maybeGrantWelcomeGift(gate: { cliente: ClienteRow; admin: any }) {
  const cliente = gate.cliente;
  if (!cliente?.id) return { cliente, welcomeGift: null as any };
  if (!cliente.regalo_bienvenida_elegible || cliente.regalo_bienvenida_otorgado) {
    return { cliente, welcomeGift: null as any };
  }

  const nextFree = toNum(cliente.minutos_free_pendientes) + 10;
  const nowIso = new Date().toISOString();

  const { data: updated, error } = await gate.admin
    .from("crm_clientes")
    .update({
      minutos_free_pendientes: nextFree,
      regalo_bienvenida_otorgado: true,
      regalo_bienvenida_fecha: nowIso,
      updated_at: nowIso,
    })
    .eq("id", cliente.id)
    .eq("regalo_bienvenida_elegible", true)
    .eq("regalo_bienvenida_otorgado", false)
    .select("*")
    .maybeSingle();

  if (error) throw error;

  if (!updated) {
    const { data: refreshed, error: refreshError } = await gate.admin
      .from("crm_clientes")
      .select("*")
      .eq("id", cliente.id)
      .maybeSingle();

    if (refreshError) throw refreshError;
    return { cliente: (refreshed || cliente) as ClienteRow, welcomeGift: null as any };
  }

  await Promise.allSettled([
    gate.admin.from("cliente_puntos_historial").insert({
      cliente_id: cliente.id,
      tipo: "regalo_bienvenida",
      puntos: 0,
      descripcion: "Regalo de bienvenida: +10 minutos free.",
      created_at: nowIso,
    }),
    gate.admin.from("cliente_notificaciones").insert({
      cliente_id: cliente.id,
      tipo: "welcome_gift",
      titulo: "Has recibido 10 minutos gratis",
      mensaje: "Como agradecimiento por registrarte, hemos añadido 10 minutos free a tu cuenta.",
      leida: false,
      created_at: nowIso,
    }),
    gate.admin.from("crm_client_notes").insert({
      cliente_id: cliente.id,
      texto: "🎁 Regalo de bienvenida por registro: +10 minutos free.",
      author_user_id: null,
      author_name: "Tarot Celestial",
      author_email: null,
      is_pinned: false,
    }),
  ]);

  return {
    cliente: updated as ClienteRow,
    welcomeGift: {
      granted: true,
      minutes: 10,
      title: "¡Bienvenido a Tarot Celestial!",
      message: "Como agradecimiento por registrarte, acabamos de añadir 10 minutos totalmente gratis a tu cuenta.",
    },
  };
}

export async function GET(req: Request) {
  try {
    const gate = await clientFromRequest(req);

    if (!gate.uid) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    if (!gate.cliente) {
      return NextResponse.json({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, { status: 404 });
    }

    const welcomeState = await maybeGrantWelcomeGift(gate as any);
    const cliente = welcomeState.cliente;
    const minutosTotales = toNum(cliente.minutos_free_pendientes) + toNum(cliente.minutos_normales_pendientes);

    const [historyResult,rewardsResult,effectiveRankState,packs] = await Promise.all([
      gate.admin.from("cliente_puntos_historial").select("id,tipo,puntos,descripcion,created_at").eq("cliente_id",cliente.id).order("created_at",{ascending:false}).limit(10),
      gate.admin.from("recompensas").select("id,nombre,puntos_coste,minutos_otorgados,activo").eq("activo",true).order("puntos_coste"),
      rankState(gate.admin,cliente.id),
      decoratePacks(gate.admin,CLIENTE_MINUTE_PACKS),
    ]);
    if(historyResult.error) throw historyResult.error;
    if(rewardsResult.error) throw rewardsResult.error;
    const historial = historyResult.data, recompensas = rewardsResult.data;
    const rolling30Spend=Number(effectiveRankState.total), rolling30Purchases=Number(effectiveRankState.compras);
    const effectiveRank=effectiveRankState.effective;
    const liveRank=effectiveRankState.automatic;
    const clienteConRank = {
      ...cliente,
      rango_actual: effectiveRank,
      rango_automatico: effectiveRankState.automatic || normalizeClientRank(liveRank),
      rango_es_temporal: effectiveRankState.override?.intervention_type === "temporary" || effectiveRankState.override?.intervention_type === "penalty",
      rango_override_tipo: effectiveRankState.override?.intervention_type || null,
      rango_override_fin: effectiveRankState.override?.ends_at || null,
      rango_gasto_mes_anterior: Number(rolling30Spend.toFixed(2)),
      rango_compras_mes_anterior: rolling30Purchases,
    };

    const rank = {
      ...rankMeta(effectiveRank),
      key: effectiveRank || "sin_rango", label: effectiveRankState.config?.label || "Sin rango",
      min: effectiveRankState.config?.min_spend || 0,
      nextRank: effectiveRankState.next?.rank_key || null,
      nextLabel: effectiveRankState.next?.label || null,
      nextTarget: effectiveRankState.next?.min_spend || null,
      benefits: configuredBenefits(effectiveRankState.config),
      nextBenefits: configuredBenefits(effectiveRankState.next),
      automatic_rank: effectiveRankState.automatic || normalizeClientRank(liveRank),
      effective_rank: effectiveRank,
      has_override: Boolean(effectiveRankState.override),
      override_type: effectiveRankState.override?.intervention_type || null,
      override_ends_at: effectiveRankState.override?.ends_at || null,
    };
    const next=effectiveRankState.next;
    const minimum=Number(effectiveRankState.config?.min_spend||0);
    const rankProgress={current_rank:effectiveRank||"sin_rango",current_label:rank.label,current_value:rolling30Spend,
      next_rank:next?.rank_key||null,next_label:next?.label||null,next_target:next?.min_spend||null,
      remaining_to_next:next?Math.max(0,Number(next.min_spend)-rolling30Spend):0,
      progress_percent:next?Math.max(0,Math.min(100,100*(rolling30Spend-minimum)/Math.max(.01,Number(next.min_spend)-minimum))):100,
      status_text:next?`Tu próximo rango es ${next.label}.`:"Has alcanzado el rango más alto.",monthly_requirement_text:"Calculado con compras reales de los últimos 30 días."};

    const recompensasUnicas = Array.from(
      new Map(
        (recompensas || []).map((item: any) => [
          `${item?.nombre || ""}::${item?.puntos_coste || 0}::${item?.minutos_otorgados || 0}`,
          item,
        ])
      ).values()
    );

    const paymentProvider = await getActiveClientPaymentProvider(gate.admin);

    return NextResponse.json({
      ok: true,
      cliente: {
        ...clienteConRank,
        minutos_totales: minutosTotales,
        puntos: toNum(cliente.puntos),
      },
      historial: historial || [],
      recompensas: recompensasUnicas,
      rank_info: rank,
      rank_progress: rankProgress,
      welcome_gift: welcomeState.welcomeGift,
      packs,
      payment_provider: paymentProvider,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_CLIENTE_ME" }, { status: 500 });
  }
}

