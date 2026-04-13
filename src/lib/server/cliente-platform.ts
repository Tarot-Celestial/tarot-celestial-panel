import { createHash } from "crypto";

export const PUNTOS_POR_DOLAR = 10;

export type ClientePack = {
  id: string;
  nombre: string;
  descripcion: string;
  priceUsd: number;
  totalMinutes: number;
  bonusMinutes: number;
  highlight?: boolean;
};

export const CLIENTE_PACKS: ClientePack[] = [
  {
    id: "pack_10",
    nombre: "10 minutos",
    descripcion: "Compra rápida para una consulta breve.",
    priceUsd: 10,
    totalMinutes: 10,
    bonusMinutes: 0,
  },
  {
    id: "pack_20",
    nombre: "20 minutos",
    descripcion: "Tiempo ideal para una consulta más completa.",
    priceUsd: 20,
    totalMinutes: 20,
    bonusMinutes: 0,
  },
  {
    id: "pack_40_mas_10",
    nombre: "40 + 10 minutos de regalo",
    descripcion: "Uno de los packs más rentables dentro del panel.",
    priceUsd: 22,
    totalMinutes: 50,
    bonusMinutes: 10,
    highlight: true,
  },
  {
    id: "pack_60_mas_20",
    nombre: "60 + 20 minutos de regalo",
    descripcion: "Pack premium con bonus extra dentro de la app.",
    priceUsd: 44,
    totalMinutes: 80,
    bonusMinutes: 20,
    highlight: true,
  },
];

export function getClientePack(packId: string | null | undefined): ClientePack | null {
  return CLIENTE_PACKS.find((pack) => pack.id === String(packId || "").trim()) || null;
}

export function toNum(value: unknown): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

export function pointsFromAmount(amount: number): number {
  return Math.max(0, Math.round(toNum(amount) * PUNTOS_POR_DOLAR));
}

export function splitMinutes(totalMinutes: number) {
  const total = Math.max(0, Math.floor(toNum(totalMinutes)));
  const free = Math.floor(total / 2);
  const normal = total - free;
  return { free, normal };
}

export function monthRange(date = new Date()) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { start, end };
}

export function inferClientMarket(phoneLike: string | null | undefined): "PR" | "US" | "ES" {
  const digits = String(phoneLike || "").replace(/\D/g, "");
  if (digits.startsWith("1787") || digits.startsWith("1939") || digits.startsWith("787") || digits.startsWith("939")) return "PR";
  if (digits.startsWith("34")) return "ES";
  if (digits.startsWith("1")) return "US";
  return "ES";
}

export function getCallTarget(phoneLike: string | null | undefined) {
  const market = inferClientMarket(phoneLike);
  if (market === "PR") return { market, label: "Puerto Rico", displayNumber: "787 945 0710", telHref: "tel:+17879450710" };
  if (market === "US") return { market, label: "Estados Unidos", displayNumber: "786 539 4750", telHref: "tel:+17865394750" };
  return { market, label: "España", displayNumber: "930 502 586", telHref: "tel:+34930502586" };
}

export function computeCurrentRankFromSpend(spend: number, purchases: number) {
  const total = toNum(spend);
  const count = Math.max(0, Math.floor(toNum(purchases)));
  if (total >= 500) return "oro";
  if (total >= 100) return "plata";
  if (count >= 1 || total > 0) return "bronce";
  return null;
}

export function currentRankBenefits(rank: string | null | undefined) {
  const key = String(rank || "").toLowerCase();
  if (key === "oro") {
    return [
      "12 minutos GRATIS cuando se incorpora una nueva tarotista",
      "+12 minutos GRATIS permanentes en cada compra a precio regular",
      "Participación automática en sorteos activos (1 número por sorteo)",
      "3 pases GRATIS cada mes de 7 minutos",
      "Seguimiento energético durante 1 mes post rituales",
    ];
  }
  if (key === "plata") {
    return [
      "10 minutos GRATIS cuando se incorpora una nueva tarotista",
      "+10 minutos GRATIS permanentes en cada compra a precio regular",
      "3 pases GRATIS cada mes de 7 minutos",
      "Seguimiento energético durante 1 mes post rituales",
    ];
  }
  return ["3 pases GRATIS cada mes de 7 minutos"];
}

export async function createClientNotification(
  admin: any,
  payload: {
    cliente_id: string;
    titulo: string;
    mensaje: string;
    tipo?: string;
    meta?: Record<string, any> | null;
  }
) {
  await admin.from("cliente_notificaciones").insert({
    cliente_id: payload.cliente_id,
    titulo: payload.titulo,
    mensaje: payload.mensaje,
    tipo: payload.tipo || "info",
    meta: payload.meta || null,
    leida: false,
    created_at: new Date().toISOString(),
  });
}

export async function touchClientActivity(
  admin: any,
  clienteId: string,
  opts?: { access?: boolean }
) {
  const nowIso = new Date().toISOString();
  const patch: Record<string, any> = {
    ultima_actividad_at: nowIso,
    updated_at: nowIso,
  };

  if (opts?.access) {
    const { data: current } = await admin
      .from("crm_clientes")
      .select("id, total_accesos")
      .eq("id", clienteId)
      .maybeSingle();

    patch.ultimo_acceso_at = nowIso;
    patch.total_accesos = Math.max(0, Number(current?.total_accesos || 0)) + 1;
  }

  await admin.from("crm_clientes").update(patch).eq("id", clienteId);
}

export async function applyClientPurchase(
  admin: any,
  params: {
    clienteId: string;
    packId: string;
    paymentRef: string;
    paymentIntent?: string | null;
    stripeSessionId?: string | null;
    amountUsd: number;
    totalMinutes: number;
    metodo?: string;
    notas?: string;
  }
) {
  const nowIso = new Date().toISOString();
  const metodo = String(params.metodo || "stripe_checkout");
  const pack = getClientePack(params.packId);
  const packName = pack?.nombre || params.packId;

  const { data: existingPayment, error: existingPaymentError } = await admin
    .from("crm_cliente_pagos")
    .select("id, referencia_externa, cliente_id")
    .eq("referencia_externa", params.paymentRef)
    .maybeSingle();
  if (existingPaymentError) throw existingPaymentError;
  if (existingPayment?.id) {
    return { ok: true, duplicated: true, payment: existingPayment };
  }

  const { data: clienteActual, error: clienteError } = await admin
    .from("crm_clientes")
    .select("id, nombre, apellido, puntos, minutos_free_pendientes, minutos_normales_pendientes")
    .eq("id", params.clienteId)
    .maybeSingle();
  if (clienteError) throw clienteError;
  if (!clienteActual?.id) throw new Error("CLIENTE_NO_EXISTE");

  const amountUsd = Number(params.amountUsd || 0);
  const totalMinutes = Math.max(0, Math.floor(Number(params.totalMinutes || 0)));
  const minutesSplit = splitMinutes(totalMinutes);
  const puntosGanados = pointsFromAmount(amountUsd);

  const { data: pago, error: pagoError } = await admin
    .from("crm_cliente_pagos")
    .insert({
      cliente_id: params.clienteId,
      importe: amountUsd,
      moneda: "USD",
      metodo,
      estado: "completed",
      notas: params.notas || `Compra automatizada desde panel cliente · ${packName}`,
      referencia_externa: params.paymentRef,
      created_by_user_id: null,
      created_by_role: "cliente_webhook",
    })
    .select("*")
    .single();
  if (pagoError) throw pagoError;

  const nextFree = toNum(clienteActual.minutos_free_pendientes) + minutesSplit.free;
  const nextNormal = toNum(clienteActual.minutos_normales_pendientes) + minutesSplit.normal;
  const nextPoints = toNum(clienteActual.puntos) + puntosGanados;

  await admin
    .from("crm_clientes")
    .update({
      minutos_free_pendientes: nextFree,
      minutos_normales_pendientes: nextNormal,
      puntos: nextPoints,
      updated_at: nowIso,
    })
    .eq("id", params.clienteId);

  await admin.from("cliente_puntos_historial").insert({
    cliente_id: params.clienteId,
    tipo: "ganado",
    puntos: puntosGanados,
    descripcion: `Compra ${packName} (${amountUsd.toFixed(2)} USD) → +${puntosGanados} puntos.`,
    created_at: nowIso,
  });

  const { start, end } = monthRange(new Date());
  const { data: monthPayments, error: monthPaymentsError } = await admin
    .from("crm_cliente_pagos")
    .select("id, importe, estado")
    .eq("cliente_id", params.clienteId)
    .eq("estado", "completed")
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());
  if (monthPaymentsError) throw monthPaymentsError;

  const monthlySpend = (monthPayments || []).reduce((acc: number, row: any) => acc + toNum(row?.importe), 0);
  const monthlyPurchases = (monthPayments || []).length;
  const nextRank = computeCurrentRankFromSpend(monthlySpend, monthlyPurchases);

  // No persistimos aquí el rango CRM para no sobrescribir el recálculo manual del panel.
  // El rango puede seguir mostrándose en vivo en la experiencia cliente sin tocar los KPIs de CRM.

  const nombre = [clienteActual?.nombre, clienteActual?.apellido].filter(Boolean).join(" ").trim() || "Cliente";

  await createClientNotification(admin, {
    cliente_id: params.clienteId,
    tipo: "purchase_completed",
    titulo: "Pago confirmado",
    mensaje: `Tu compra ${packName} ya está activa. Hemos añadido ${totalMinutes} minutos y +${puntosGanados} puntos a tu cuenta.`,
    meta: {
      pack_id: params.packId,
      pack_name: packName,
      total_minutes: totalMinutes,
      free_minutes: minutesSplit.free,
      normal_minutes: minutesSplit.normal,
      payment_intent: params.paymentIntent || null,
      stripe_session_id: params.stripeSessionId || null,
    },
  });

  try {
    await admin.from("notifications").insert({
      type: "cliente_payment_completed",
      title: "Compra completada en panel cliente",
      message: `${nombre} compró ${packName} por ${amountUsd.toFixed(2)} USD.`,
      cliente_id: params.clienteId,
      read: false,
      created_at: nowIso,
    });
  } catch {
    // notificación interna opcional
  }

  return {
    ok: true,
    duplicated: false,
    payment: pago,
    rank: nextRank,
    monthlySpend,
    monthlyPurchases,
  };
}

export function pickDailyOracle(topic: string, clientId: string, rank: string | null | undefined) {
  const normalizedTopic = String(topic || "general").trim().toLowerCase() || "general";
  const dayKey = new Date().toISOString().slice(0, 10);
  const seed = createHash("sha256").update(`${clientId}:${dayKey}:${normalizedTopic}:${rank || ""}`).digest("hex");
  const n = parseInt(seed.slice(0, 8), 16);

  const topicTitles: Record<string, string[]> = {
    amor: [
      "Se abre una conversación importante en lo sentimental.",
      "Hoy conviene escuchar más y reaccionar menos en el amor.",
      "Una energía del pasado puede volver a buscarte.",
    ],
    dinero: [
      "Tu intuición detecta antes que nadie dónde no debes insistir.",
      "Hoy el dinero pide estrategia, no impulso.",
      "Se marca una oportunidad pequeña que puede crecer rápido.",
    ],
    energia: [
      "Tu energía necesita bajar el ruido para recuperar claridad.",
      "Hoy la protección está en poner límites suaves pero firmes.",
      "Hay una limpieza emocional silenciosa ocurriendo a tu favor.",
    ],
    general: [
      "Hoy el oráculo marca avance si confías en lo que ya vienes sintiendo.",
      "Es un día para observar señales antes de decidir.",
      "La energía general abre un camino más claro de lo que parecía ayer.",
    ],
  };

  const intros = topicTitles[normalizedTopic] || topicTitles.general;
  const adviceByRank: Record<string, string[]> = {
    oro: [
      "Tu rango Oro te favorece con energía expansiva: aprovecha para tomar iniciativa.",
      "Hoy estás en un punto de liderazgo espiritual: si das el primer paso, la respuesta llega.",
    ],
    plata: [
      "La vibración Plata te pide constancia: lo que sostienes con calma termina abriéndose.",
      "Tu energía está creciendo; hoy conviene actuar con precisión y sin prisa.",
    ],
    bronce: [
      "Tu avance está en marcha: lo pequeño que hagas hoy tiene efecto real.",
      "La clave hoy es moverte aunque aún no veas todo el resultado.",
    ],
    default: [
      "Hoy lo más importante es escuchar tu intuición antes que el ruido externo.",
      "No fuerces respuestas: la señal correcta se muestra cuando bajas la ansiedad.",
    ],
  };

  const closeOptions = [
    "Si quieres profundizar más, este es un buen día para hablar con una tarotista.",
    "Toma esta lectura como una orientación y observa cómo responde tu realidad durante el día.",
    "La señal es favorable, pero la claridad total llega cuando preguntas lo concreto.",
  ];

  const rankKey = ["oro", "plata", "bronce"].includes(String(rank || "").toLowerCase())
    ? String(rank || "").toLowerCase()
    : "default";

  return {
    fecha: dayKey,
    topic: normalizedTopic,
    titulo: intros[n % intros.length],
    energia: adviceByRank[rankKey][n % adviceByRank[rankKey].length],
    cierre: closeOptions[n % closeOptions.length],
  };
}

export function answerOracleFollowup(input: string, topic: string, rank: string | null | undefined) {
  const text = String(input || "").trim();
  const q = text.toLowerCase();
  const topicLabel = String(topic || "general");

  let focus = "La señal marca avance, pero con calma.";
  if (/(amor|pareja|ex|relacion|relación)/.test(q)) focus = "En amor la respuesta no está en perseguir, sino en leer la reciprocidad real.";
  else if (/(dinero|trabajo|negocio|cobro|venta)/.test(q)) focus = "En dinero el oráculo sugiere ordenar primero, acelerar después.";
  else if (/(salud|energia|energía|ansiedad|cans)/.test(q)) focus = "Tu energía necesita bajar carga antes de abrir una nueva etapa.";
  else if (/(llamar|consulta|tarotista)/.test(q)) focus = "Sí hay tema para profundizar con una consulta, porque la energía aparece activa y no cerrada.";

  const rankNote = String(rank || "").toLowerCase() === "oro"
    ? "Tu vibración Oro favorece respuestas más rápidas cuando actúas con decisión."
    : String(rank || "").toLowerCase() === "plata"
    ? "Tu energía Plata pide constancia y buena lectura de señales."
    : "Estás en una fase de construcción: lo importante hoy es dar el siguiente paso correcto.";

  return `${focus} ${rankNote} En el tema ${topicLabel}, tu pregunta apunta a: “${text}”. Observa lo que se repite hoy, porque ahí está la pista más clara.`;
}
