import { clientRankBenefits, rankPackageBenefitsForPacks } from "@/lib/server/rank-benefits";
import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import {
  computeCurrentRankFromSpend,
  currentRankBenefits,
  toNum,
} from "@/lib/server/cliente-platform";
import { loadEffectiveClientRank, normalizeClientRank } from "@/lib/server/client-rank-effective";
import { CLIENTE_MINUTE_PACKS } from "@/lib/server/cliente-minute-packs";
import { getActiveClientPaymentProvider } from "@/lib/server/client-payment-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function rankMeta(rank: string | null | undefined) {
  const key = normalizeClientRank(rank) || "sin_rango";
  const label = key === "diamante" ? "Diamante" : key === "oro" ? "Oro" : key === "plata" ? "Plata" : key === "bronce" ? "Bronce" : "Sin rango";
  const min = key === "diamante" ? 1000 : key === "oro" ? 500 : key === "plata" ? 100 : 1;
  const nextRank = key === "diamante" ? null : key === "oro" ? "diamante" : key === "plata" ? "oro" : "plata";
  const nextTarget = nextRank === "diamante" ? 1000 : nextRank === "oro" ? 500 : nextRank === "plata" ? 100 : null;

  return {
    key,
    label,
    min,
    nextRank,
    nextLabel: nextRank === "diamante" ? "Diamante" : nextRank === "oro" ? "Oro" : nextRank === "plata" ? "Plata" : null,
    nextTarget,
    benefits: currentRankBenefits(key),
    nextBenefits: nextRank ? currentRankBenefits(nextRank).filter(label => !label.includes("Mi Ritual")) : [],
  };
}

function buildRankProgress(last30DaysSpend: number, last30DaysPurchases: number, currentRank: string | null | undefined) {
  const gasto = toNum(last30DaysSpend);
  const compras = Math.max(0, Math.floor(toNum(last30DaysPurchases)));
  const rank = String(currentRank || computeCurrentRankFromSpend(gasto, compras) || "sin_rango").toLowerCase();

  if (rank === "diamante") {
    return { current_rank:"diamante", current_label:"Diamante", progress_percent:100, current_value:gasto, next_rank:null, next_label:null, next_target:null, remaining_to_next:0, status_text:"Has alcanzado Diamante, el rango más exclusivo de Tarot Celestial.", monthly_requirement_text:`En los últimos 30 días llevas ${gasto.toFixed(2)} USD acumulados y mantienes Diamante.` };
  }

  if (rank === "oro") {
    const target = 1000; const pct=Math.max(0,Math.min(100,((gasto-500)/(target-500))*100)); const remaining=Math.max(0,target-gasto);
    return { current_rank:"oro", current_label:"Oro", progress_percent:Number(pct.toFixed(1)), current_value:gasto, next_rank:"diamante", next_label:"Diamante", next_target:target, remaining_to_next:Number(remaining.toFixed(2)), status_text: remaining>0?`Te faltan ${remaining.toFixed(2)} USD de gasto en los últimos 30 días para llegar a Diamante.`:"Ya cumples el objetivo de Diamante.", monthly_requirement_text:`Tu progreso a Diamante se calcula con ${gasto.toFixed(2)} USD gastados en los últimos 30 días.` };
  }

  if (rank === "plata") {
    const target = 500;
    const pct = Math.max(0, Math.min(100, (gasto / target) * 100));
    const remaining = Math.max(0, target - gasto);

    return {
      current_rank: "plata",
      current_label: "Plata",
      progress_percent: Number(pct.toFixed(1)),
      current_value: gasto,
      next_rank: "oro",
      next_label: "Oro",
      next_target: target,
      remaining_to_next: Number(remaining.toFixed(2)),
      status_text:
        remaining > 0
          ? `Te faltan ${remaining.toFixed(2)} USD de gasto en los últimos 30 días para llegar a Oro.`
          : "Ya cumples el objetivo de Oro.",
      monthly_requirement_text: `Tu progreso actual se calcula con ${gasto.toFixed(2)} USD gastados en los últimos 30 días.`,
    };
  }

  const target = 100;
  const pct = Math.max(0, Math.min(100, (gasto / target) * 100));
  const remaining = Math.max(0, target - gasto);

  return {
    current_rank: rank === "sin_rango" ? "sin_rango" : "bronce",
    current_label: rank === "sin_rango" ? "Sin rango" : "Bronce",
    progress_percent: Number(pct.toFixed(1)),
    current_value: gasto,
    next_rank: "plata",
    next_label: "Plata",
    next_target: target,
    remaining_to_next: Number(remaining.toFixed(2)),
    status_text:
      compras <= 0
        ? "Con una compra dentro del panel entrarás en Bronce."
        : remaining > 0
        ? `Te faltan ${remaining.toFixed(2)} USD de gasto en los últimos 30 días para subir a Plata.`
        : "Ya cumples el objetivo de Plata.",
    monthly_requirement_text:
      compras <= 0
        ? "Haz una compra desde la app para activar Bronce y comenzar a sumar ventajas."
        : `Tu rango actual refleja ${gasto.toFixed(2)} USD y ${compras} compra(s) en los últimos 30 días.`,
  };
}

async function maybeGrantWelcomeGift(gate: { cliente: ClienteRow; admin: any }) {
  const cliente = gate.cliente;
  if (!cliente?.id) return { cliente, welcomeGift: null as any };
  if (!cliente.regalo_bienvenida_elegible || cliente.regalo_bienvenida_otorgado) {
    return { cliente, welcomeGift: null as any };
  }

  const nextFree = toNum(cliente.minutos_free_pendientes) + 10;
  const nowIso = new Date().toISOString();

  let grantQuery = gate.admin
    .from("crm_clientes")
    .update({
      minutos_free_pendientes: nextFree,
      regalo_bienvenida_otorgado: true,
      regalo_bienvenida_fecha: nowIso,
      updated_at: nowIso,
    })
    .eq("id", cliente.id)
    .eq("regalo_bienvenida_elegible", true)
    .eq("regalo_bienvenida_otorgado", false);
  // La lectura de auth puede haber ocurrido antes de una compra. Si otro
  // proceso acaba de sumar minutos, jamás devolver el saldo a la cifra antigua.
  grantQuery = cliente.minutos_free_pendientes == null
    ? grantQuery.is("minutos_free_pendientes", null)
    : grantQuery.eq("minutos_free_pendientes", cliente.minutos_free_pendientes);
  const { data: updated, error } = await grantQuery.select("*").maybeSingle();

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

    // La ficha que devuelve clientFromRequest se leyó al principio de la petición.
    // Volvemos a leerla justo antes de construir el dashboard para garantizar que
    // Coins/minutos reflejan la última escritura confirmada (canjes, compras, etc.).
    const { data: freshCliente, error: freshClienteError } = await gate.admin
      .from("crm_clientes")
      .select("*")
      .eq("id", gate.cliente.id)
      .maybeSingle();
    if (freshClienteError) throw freshClienteError;
    if (!freshCliente) {
      return NextResponse.json({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, { status: 404 });
    }

    const { data: stateSnapshot, error: stateSnapshotError } = await gate.admin
      .rpc("tc_client_state_snapshot", { p_cliente_id: gate.cliente.id });
    if (stateSnapshotError) throw stateSnapshotError;

    const snapshot = stateSnapshot || {};
    const cliente = {
      ...(freshCliente as ClienteRow),
      puntos: toNum(snapshot.coins),
      minutos_free_pendientes: toNum(snapshot.minutes_free),
      minutos_normales_pendientes: toNum(snapshot.minutes_normal),
    } as ClienteRow;
    const minutosTotales = Math.max(0, toNum(snapshot.minutes_total));

    const now = new Date();
    const start30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      { data: historial },
      { data: recompensas },
      { data: pagos30Dias },
      { data: llamadas30Dias },
      { data: clienteNotificaciones },
    ] = await Promise.all([
  gate.admin
    .from("cliente_puntos_historial")
    .select("id, tipo, puntos, descripcion, created_at")
    .eq("cliente_id", cliente.id)
    .order("created_at", { ascending: false })
    .limit(10),

  gate.admin
    .from("recompensas")
    .select("id, nombre, puntos_coste, minutos_otorgados, activo")
    .eq("activo", true)
    .order("puntos_coste", { ascending: true }),

  // 💳 PAGOS APP
  gate.admin
    .from("crm_cliente_pagos")
    .select("importe, estado, created_at")
    .eq("cliente_id", cliente.id)
    .eq("estado", "completed")
    .gte("created_at", start30.toISOString())
    .lte("created_at", now.toISOString()),

  // 📞 LLAMADAS (AQUÍ ESTÁ LA CLAVE)
  gate.admin
    .from("rendimiento_llamadas")
    .select("importe, created_at")
    .eq("cliente_id", cliente.id)
    .gte("created_at", start30.toISOString())
    .lte("created_at", now.toISOString()),

  gate.admin
    .from("cliente_notificaciones")
    .select("id,titulo,mensaje,tipo,leida,created_at")
    .eq("cliente_id", cliente.id)
    .order("created_at", { ascending: false })
    .limit(20),
]);

    const spendPagos = (pagos30Dias || []).reduce(
  (acc: number, row: any) => acc + toNum(row?.importe),
  0
);

    // Fuente canónica del rango: la misma función PostgreSQL que usa el resto del
    // ecosistema de beneficios. Antes se sumaban crm_cliente_pagos +
    // rendimiento_llamadas, aunque en muchos casos representan la misma compra.
    // Eso duplicaba el gasto (por ejemplo 2.602 -> 5.204) y podía desincronizar
    // el rango mostrado respecto al rango real.
    const canonicalRankState = snapshot.rank_state || {};

    const rolling30Spend = Number.isFinite(Number(canonicalRankState?.total))
      ? Math.max(0, Number(canonicalRankState?.total || 0))
      : spendPagos;
    const rolling30Purchases = Number.isFinite(Number(canonicalRankState?.compras))
      ? Math.max(0, Math.floor(Number(canonicalRankState?.compras || 0)))
      : (pagos30Dias?.length || 0);

    const liveRank = computeCurrentRankFromSpend(rolling30Spend, rolling30Purchases);
    const effectiveRankState = await loadEffectiveClientRank(gate.admin, cliente.id, rolling30Spend);
    const configuredBenefits = await clientRankBenefits(gate.admin, cliente.id);
    const effectiveRank = String(snapshot.effective_rank || canonicalRankState?.effective || configuredBenefits.rank_key || "sin_rango");

    // rango_actual es un campo legado/cache. Lo mantenemos alineado con el rango
    // efectivo para que vistas antiguas del CRM no enseñen Oro/Plata mientras el
    // motor real ya considera al cliente Diamante.
    if (effectiveRank !== "sin_rango" && String(cliente.rango_actual || "") !== effectiveRank) {
      const { error: syncRankError } = await gate.admin
        .from("crm_clientes")
        .update({ rango_actual: effectiveRank, updated_at: new Date().toISOString() })
        .eq("id", cliente.id);
      if (!syncRankError) cliente.rango_actual = effectiveRank;
    }
    const packsWithRankBenefits = await rankPackageBenefitsForPacks(gate.admin, cliente.id, CLIENTE_MINUTE_PACKS);
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
      benefits: [
        ...currentRankBenefits(effectiveRank).filter(label => !label.includes("Mi Ritual")),
        ...(configuredBenefits.ritual_access ? ["Acceso a Mi ritual"] : []),
      ],
      automatic_rank: effectiveRankState.automatic || normalizeClientRank(liveRank),
      effective_rank: effectiveRank,
      has_override: Boolean(effectiveRankState.override),
      override_type: effectiveRankState.override?.intervention_type || null,
      override_ends_at: effectiveRankState.override?.ends_at || null,
    };
    const rankProgress = buildRankProgress(
      rolling30Spend,
      rolling30Purchases,
      effectiveRank
    );

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
      cliente_notificaciones: clienteNotificaciones || [],
      recompensas: recompensasUnicas,
      rank_info: rank,
      rank_benefits: configuredBenefits,
      rank_progress: rankProgress,
      welcome_gift: welcomeState.welcomeGift,
      packs: packsWithRankBenefits,
      payment_provider: paymentProvider,
      wallet: {
        coins: Math.max(0, toNum(snapshot.coins)),
        minutes_free: Math.max(0, toNum(snapshot.minutes_free)),
        minutes_normal: Math.max(0, toNum(snapshot.minutes_normal)),
        minutes_total: Math.max(0, toNum(snapshot.minutes_total)),
        oracle_credits: Math.max(0, toNum(snapshot.oracle_credits)),
        spins: snapshot.spins || { level_1: 0, level_2: 0, level_3: 0, diamond: 0, total: 0 },
        effective_rank: effectiveRank,
        automatic_rank: snapshot.automatic_rank || null,
        client_updated_at: snapshot.client_updated_at || cliente.updated_at || null,
        signal_updated_at: snapshot.signal_updated_at || null,
        refreshed_at: snapshot.refreshed_at || new Date().toISOString(),
      },
    }, {
      headers: {
        "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
        Vary: "Authorization",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_CLIENTE_ME" }, { status: 500 });
  }
}

