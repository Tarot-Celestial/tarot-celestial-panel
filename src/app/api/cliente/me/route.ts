import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";

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

function toNum(value: unknown): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

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
    benefits: [
      "3 pases GRATIS cada mes de 7 minutos",
    ],
  };
}

function buildRankProgress(cliente: any) {
  const gasto = toNum(cliente?.rango_gasto_mes_anterior);
  const compras = toNum(cliente?.rango_compras_mes_anterior);
  const rank = String(cliente?.rango_actual || (gasto >= 500 ? "oro" : gasto >= 100 ? "plata" : gasto > 0 || compras > 0 ? "bronce" : "sin_rango")).toLowerCase();

  if (rank === "oro") {
    return {
      current_rank: "oro",
      current_label: "Oro",
      progress_percent: 100,
      current_value: gasto,
      next_rank: null,
      next_label: null,
      next_target: 500,
      remaining_to_next: 0,
      status_text: "Ya disfrutas del rango más alto.",
      monthly_requirement_text: `El mes anterior acumulaste ${gasto.toFixed(2)}€ y mantienes Oro este mes.`,
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
      status_text: remaining > 0 ? `Te faltan ${remaining.toFixed(2)}€ de gasto mensual para llegar a Oro.` : "Ya cumples objetivo de Oro.",
      monthly_requirement_text: `Tu rango actual se basa en ${gasto.toFixed(2)}€ gastados el mes anterior.`,
    };
  }

  const base = compras > 0 ? Math.max(gasto, 1) : gasto;
  const target = 100;
  const pct = Math.max(0, Math.min(100, (base / target) * 100));
  const remaining = Math.max(0, target - base);
  return {
    current_rank: rank === "sin_rango" ? "sin_rango" : "bronce",
    current_label: rank === "sin_rango" ? "Sin rango" : "Bronce",
    progress_percent: Number(pct.toFixed(1)),
    current_value: Number(base.toFixed(2)),
    next_rank: "plata",
    next_label: "Plata",
    next_target: target,
    remaining_to_next: Number(remaining.toFixed(2)),
    status_text: compras <= 0 ? "Con una compra mensual entrarás en Bronce." : `Te faltan ${remaining.toFixed(2)}€ de gasto mensual para subir a Plata.`,
    monthly_requirement_text: compras <= 0
      ? "Haz una compra este mes para activar Bronce en el siguiente cálculo."
      : `Tu rango actual se basa en ${gasto.toFixed(2)}€ y ${compras} compra(s) del mes anterior.`,
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

    const welcomeState = await maybeGrantWelcomeGift(gate as any);
    const cliente = welcomeState.cliente;
    const minutosTotales = toNum(cliente.minutos_free_pendientes) + toNum(cliente.minutos_normales_pendientes);

    const [{ data: historial }, { data: recompensas }, { data: llamadas }] = await Promise.all([
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

    const rank = rankMeta(cliente?.rango_actual);
    const rankProgress = buildRankProgress(cliente);

    return NextResponse.json({
      ok: true,
      cliente: {
        ...cliente,
        minutos_totales: minutosTotales,
        puntos: toNum(cliente.puntos),
      },
      historial: historial || [],
      recompensas: recompensas || [],
      last_tarotistas: lastTarotistas,
      rank_info: rank,
      rank_progress: rankProgress,
      welcome_gift: welcomeState.welcomeGift,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_CLIENTE_ME" }, { status: 500 });
  }
}
