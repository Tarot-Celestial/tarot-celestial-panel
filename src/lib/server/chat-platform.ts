export type ChatPack = {
  id: string;
  nombre: string;
  descripcion: string;
  priceUsd: number;
  credits: number;
  highlight?: boolean;
};

export const CLIENTE_CHAT_PACKS: ChatPack[] = [
  {
    id: "chat_pack_5",
    nombre: "Chat 5 créditos",
    descripcion: "Ideal para continuar una consulta corta por chat.",
    priceUsd: 9.99,
    credits: 5,
  },
  {
    id: "chat_pack_12",
    nombre: "Chat 12 créditos",
    descripcion: "El pack más rentable para una sesión más profunda.",
    priceUsd: 19.99,
    credits: 12,
    highlight: true,
  },
  {
    id: "chat_pack_25",
    nombre: "Chat 25 créditos",
    descripcion: "Pensado para seguimiento y consultas continuadas.",
    priceUsd: 34.99,
    credits: 25,
  },
];

export function getChatPack(packId: string | null | undefined) {
  const id = String(packId || "").trim();
  return CLIENTE_CHAT_PACKS.find((pack) => pack.id === id) || null;
}

export function getChatWorkerStatusLabel(status: any) {
  const online = Boolean(status?.is_online);
  const enabled = status?.chat_enabled !== false;
  const busy = Boolean(status?.is_busy);
  if (!enabled || !online) return "desconectada";
  if (busy) return "ocupada";
  return "libre";
}

export function getChatWorkerStatusMeta(status: any) {
  const key = getChatWorkerStatusLabel(status);
  if (key === "libre") {
    return {
      key,
      label: "Libre",
      color: "#4ade80",
      bg: "rgba(34,197,94,.14)",
      border: "1px solid rgba(34,197,94,.34)",
    };
  }
  if (key === "ocupada") {
    return {
      key,
      label: "Ocupada",
      color: "#fdba74",
      bg: "rgba(249,115,22,.14)",
      border: "1px solid rgba(249,115,22,.34)",
    };
  }
  return {
    key,
    label: "Desconectada",
    color: "#d1d5db",
    bg: "rgba(148,163,184,.12)",
    border: "1px solid rgba(148,163,184,.24)",
  };
}

export async function getClientChatCredits(admin: any, clienteId: string) {
  const { data, error } = await admin
    .from("cliente_chat_creditos")
    .select("saldo_resultante, created_at")
    .eq("cliente_id", clienteId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return Math.max(0, Number(data?.saldo_resultante || 0));
}

export async function addClientChatCredits(admin: any, payload: {
  clienteId: string;
  threadId?: string | null;
  amount: number;
  type: string;
  notes?: string | null;
  meta?: Record<string, any> | null;
}) {
  const amount = Math.trunc(Number(payload.amount || 0));
  if (!amount) throw new Error("INVALID_CREDIT_AMOUNT");

  const current = await getClientChatCredits(admin, payload.clienteId);
  const next = Math.max(0, current + amount);

  const { data, error } = await admin
    .from("cliente_chat_creditos")
    .insert({
      cliente_id: payload.clienteId,
      thread_id: payload.threadId || null,
      tipo: payload.type,
      cantidad: amount,
      saldo_resultante: next,
      notas: payload.notes || null,
      meta: payload.meta || null,
    })
    .select("id, cliente_id, thread_id, tipo, cantidad, saldo_resultante, created_at")
    .single();

  if (error) throw error;
  return { ledger: data, balance: next };
}

// 🔥 CONTROL DE PREGUNTAS PRO
export async function puedeHablar(cliente_id: string, creditos: number) {
  const { data } = await supabase
    .from('cliente_chat_messages')
    .select('id')
    .eq('cliente_id', cliente_id)
    .eq('is_pregunta', true);

  const preguntas = data?.length || 0;

  if (preguntas >= 1 && creditos <= 0) {
    return false;
  }
  return true;
}
