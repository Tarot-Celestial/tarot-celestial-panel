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
    nombre: "30 + 10 minutos de regalo",
    descripcion: "Uno de los packs más rentables dentro del panel.",
    priceUsd: 22,
    totalMinutes: 40,
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

const CRM_MONTH_TAGS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

export async function syncClientMonthTag(admin: any, clienteId: string) {
  const monthName = CRM_MONTH_TAGS[new Date().getMonth()];

  const { data: allTags } = await admin
    .from("crm_etiquetas")
    .select("id,nombre")
    .in("nombre", CRM_MONTH_TAGS);

  let currentTag = (allTags || []).find((x: any) => String(x?.nombre || "").toLowerCase() === monthName.toLowerCase());

  if (!currentTag) {
    const { data: created } = await admin
      .from("crm_etiquetas")
      .insert({ nombre: monthName })
      .select("id,nombre")
      .single();

    currentTag = created;
  }

  const monthTagIds = (allTags || []).map((x: any) => String(x.id));

  if (monthTagIds.length) {
    await admin
      .from("crm_cliente_etiquetas")
      .delete()
      .eq("cliente_id", clienteId)
      .in("etiqueta_id", monthTagIds);
  }

  if (currentTag?.id) {
    await admin
      .from("crm_cliente_etiquetas")
      .upsert({
        cliente_id: clienteId,
        etiqueta_id: currentTag.id,
      }, {
        onConflict: 'cliente_id,etiqueta_id'
      });
  }
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

  const { error: activityError } = await admin.from("crm_clientes").update(patch).eq("id", clienteId);
  if (activityError) throw activityError;

  // El heartbeat se ejecuta cada 60 s. La etiqueta mensual solo necesita
  // sincronizarse cuando contamos un acceso real, no en cada ping.
  if (opts?.access) {
    await syncClientMonthTag(admin, clienteId);
  }
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
  const minutes = splitMinutes(params.totalMinutes);
  const { data, error } = await admin.rpc("cliente_confirmar_compra_ruleta_v3", { p: {
    cliente_id: params.clienteId, payment_ref: params.paymentRef, amount: params.amountUsd, currency: "USD",
    free: minutes.free, normal: minutes.normal, points: pointsFromAmount(params.amountUsd),
    pack_id: params.packId, pack_name: getClientePack(params.packId)?.nombre || params.packId,
    metodo: params.metodo || "stripe_checkout", notas: params.notas || null,
    stripe_session_id: params.stripeSessionId || null, payment_intent: params.paymentIntent || null,
    created_by_role: "cliente_webhook",
  } });
  if (error) throw error;
  return { ok: true, ...data };
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
    diamante: [
      "Tu rango Diamante abre una experiencia más exclusiva: hoy conviene actuar con claridad y propósito.",
      "Estás en el nivel más alto de la experiencia Celestial: aprovecha tus beneficios premium con intención.",
    ],
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

  const rankKey = ["diamante", "oro", "plata", "bronce"].includes(String(rank || "").toLowerCase())
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

  const rankNote = String(rank || "").toLowerCase() === "diamante"
    ? "Tu vibración Diamante representa el nivel premium de tu experiencia y favorece una lectura más personalizada."
    : String(rank || "").toLowerCase() === "oro"
    ? "Tu vibración Oro favorece respuestas más rápidas cuando actúas con decisión."
    : String(rank || "").toLowerCase() === "plata"
    ? "Tu energía Plata pide constancia y buena lectura de señales."
    : "Estás en una fase de construcción: lo importante hoy es dar el siguiente paso correcto.";

  return `${focus} ${rankNote} En el tema ${topicLabel}, tu pregunta apunta a: “${text}”. Observa lo que se repite hoy, porque ahí está la pista más clara.`;
}
