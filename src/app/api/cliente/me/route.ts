import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import {
  CLIENTE_PACKS,
  computeCurrentRankFromSpend,
  getCallTarget,
  toNum,
  touchClientActivity,
} from "@/lib/server/cliente-platform";

export const runtime = "nodejs";

type ClienteRow = Record<string, any> & {
  id: string;
  nombre?: string | null;
  apellido?: string | null;
  puntos?: number | null;
  minutos_free_pendientes?: number | null;
  minutos_normales_pendientes?: number | null;
  regalo_bienvenida_otorgado?: boolean | null;
};

function rankMeta(rank: string | null | undefined) {
  const key = String(rank || "").toLowerCase();

  if (key === "oro") {
    return {
      label: "Oro",
      min: 500,
      nextRank: null,
      nextTarget: null,
      benefits: [
        "12 minutos GRATIS cuando se incorpora una nueva tarotista",
        "+12 minutos GRATIS permanentes en cada compra a precio regular",
        "Participación automática en sorteos activos (1 número por sorteo)",
        "3 pases GRATIS cada mes de 7 minutos",
        "Seguimiento energético durante 1 mes post rituales",
      ],
    };
  }

  if (key === "plata") {
    return {
      label: "Plata",
      min: 100,
      nextRank: "oro",
      nextTarget: 500,
      benefits: [
        "10 minutos GRATIS cuando se incorpora una nueva tarotista",
        "+10 minutos GRATIS permanentes en cada compra a precio regular",
        "3 pases GRATIS cada mes de 7 minutos",
        "Seguimiento energético durante 1 mes post rituales",
      ],
    };
  }

  return {
    label: "Bronce",
    min: 1,
    nextRank: "plata",
    nextTarget: 100,
    benefits: ["3 pases GRATIS cada mes de 7 minutos"],
  };
}

function buildRankProgress(last30DaysSpend: number, last30DaysPurchases: number, currentRank: string | null | undefined) {
  const gasto = toNum(last30DaysSpend);
  const compras = Math.max(0, Math.floor(toNum(last30DaysPurchases)));
  const rank = String(currentRank || computeCurrentRankFromSpend(gasto, compras) || "sin_rango").toLowerCase();

  if (rank === "oro") {
    return {
      current_rank: "oro",
      current_label: "Oro",
      progress_percent: 100,
      current_value: gasto,
      next_rank: null,
      next_label: null,
      next_target: null,
      remaining_to_next: 0,
      status_text: "Ya disfrutas del rango más alto.",
      monthly_requirement_text: `En los últimos 30 días llevas ${gasto.toFixed(2)} USD acumulados y mantienes Oro.`,
    };
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
  if (cliente.regalo_bienvenida_otorgado) return { cliente, welcomeGift: null as any };

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

  await gate.admin.from("cliente_puntos_historial").insert({
    cliente_id: cliente.id,
    tipo: "regalo_bienvenida",
    puntos: 0,
    descripcion: "Felicidades, acabas de ganar 10 minutos gratis de consulta.",
  });

  await gate.admin.from("cliente_notificaciones").insert({
    cliente_id: cliente.id,
    tipo: "welcome_gift",
    titulo: "Has recibido 10 minutos gratis",
    mensaje: "Felicidades, acabas de ganar 10 minutos gratis de consulta.",
    leida: false,
    created_at: nowIso,
  });

  return {
    cliente: updated as ClienteRow,
    welcomeGift: {
      granted: true,
      minutes: 10,
      title: "Felicidades",
      message: "Acabas de ganar 10 minutos gratis de consulta.",
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

    await touchClientActivity(gate.admin, gate.cliente.id, { access: false });

    const welcomeState = await maybeGrantWelcomeGift(gate as any);
    const cliente = welcomeState.cliente;
    const minutosTotales = toNum(cliente.minutos_free_pendientes) + toNum(cliente.minutos_normales_pendientes);

    const now = new Date();
    const start30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      { data: historial },
      { data: recompensas },
      { data: llamadas },
      { data: notificaciones },
      { data: pagos30Dias },
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

      gate.admin
        .from("rendimiento_llamadas")
        .select("id, fecha_hora, tarotista_nombre, tarotista_manual_call")
        .eq("cliente_id", cliente.id)
        .order("fecha_hora", { ascending: false })
        .limit(15),

      gate.admin
        .from("cliente_notificaciones")
        .select("id, titulo, mensaje, tipo, leida, created_at")
        .eq("cliente_id", cliente.id)
        .order("created_at", { ascending: false })
        .limit(8),

      gate.admin
        .from("crm_cliente_pagos")
        .select("importe, estado, created_at")
        .eq("cliente_id", cliente.id)
        .eq("estado", "completed")
        .gte("created_at", start30.toISOString())
        .lte("created_at", now.toISOString()),
    ]);

    const lastTarotistas = Array.from(
      new Map(
        (llamadas || [])
          .map((row: any) => {
            const nombre = String(row?.tarotista_nombre || row?.tarotista_manual_call || "").trim();
            return nombre ? [nombre.toLowerCase(), { nombre, fecha_hora: row?.fecha_hora || null }] : null;
          })
          .filter(Boolean) as any
      ).values()
    ).slice(0, 3);

    const rolling30Spend = (pagos30Dias || []).reduce(
      (acc: number, row: any) => acc + toNum(row?.importe),
      0
    );
    const rolling30Purchases = (pagos30Dias || []).length;

    const liveRank = computeCurrentRankFromSpend(rolling30Spend, rolling30Purchases);

    const clienteConRank = {
      ...cliente,
      rango_actual: liveRank,
      rango_gasto_mes_anterior: Number(rolling30Spend.toFixed(2)),
      rango_compras_mes_anterior: rolling30Purchases,
    };

    const rank = rankMeta(clienteConRank?.rango_actual);
    const rankProgress = buildRankProgress(
      rolling30Spend,
      rolling30Purchases,
      clienteConRank?.rango_actual
    );

    const callTarget = getCallTarget(cliente?.telefono_normalizado || cliente?.telefono);

    const recompensasUnicas = Array.from(
      new Map(
        (recompensas || []).map((item: any) => [
          `${item?.nombre || ""}::${item?.puntos_coste || 0}::${item?.minutos_otorgados || 0}`,
          item,
        ])
      ).values()
    );

    return NextResponse.json({
      ok: true,
      cliente: {
        ...clienteConRank,
        minutos_totales: minutosTotales,
        puntos: toNum(cliente.puntos),
      },
      historial: historial || [],
      recompensas: recompensasUnicas,
      last_tarotistas: lastTarotistas,
      rank_info: rank,
      rank_progress: rankProgress,
      welcome_gift: welcomeState.welcomeGift,
      cliente_notificaciones: notificaciones || [],
      call_target: callTarget,
      packs: CLIENTE_PACKS,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_CLIENTE_ME" }, { status: 500 });
  }
}
