export type OperatorControlInput = {
  presences?: any[];
  expected?: any[];
  outboundItems?: any[];
  chatItems?: any[];
  offlineExpected?: number;
  parkingCount?: number;
};

export type OperatorScore = {
  id: string;
  name: string;
  online: boolean;
  status: string;
  calls: number;
  chats: number;
  score: number;
  level: "low" | "medium" | "high";
};

export type OperatorControlSummary = {
  operators: OperatorScore[];
  topOperators: OperatorScore[];
  overloaded: OperatorScore | null;
  available: OperatorScore | null;
  alertItems: Array<{
    id: string;
    title: string;
    subtitle?: string;
    meta?: string;
    priority: "critical" | "high" | "medium" | "low";
    action: "team" | "parking" | "calls" | "chat";
    type: "team";
  }>;
};

function normalizeName(value: any) {
  return String(value || "").trim() || "Sin nombre";
}

function operatorId(row: any) {
  return String(row?.worker_id || row?.id || row?.user_id || row?.display_name || row?.name || "unknown");
}

function operatorName(row: any) {
  return normalizeName(row?.display_name || row?.name || row?.email || row?.worker_name);
}

function scoreLevel(score: number): OperatorScore["level"] {
  if (score >= 6) return "high";
  if (score >= 3) return "medium";
  return "low";
}

function matchName(a: string, b: string) {
  const aa = normalizeName(a).toLowerCase();
  const bb = normalizeName(b).toLowerCase();
  return !!aa && !!bb && (aa === bb || aa.includes(bb) || bb.includes(aa));
}

export function getOperatorControlSummary(input: OperatorControlInput): OperatorControlSummary {
  const presences = input.presences || [];
  const expected = input.expected || [];
  const outboundItems = input.outboundItems || [];
  const chatItems = input.chatItems || [];
  const parkingCount = Number(input.parkingCount || 0);
  const offlineExpected = Number(input.offlineExpected || 0);

  const byId = new Map<string, OperatorScore>();

  for (const row of [...expected, ...presences]) {
    const id = operatorId(row);
    const existing = byId.get(id);
    const online = !!row?.online || !!existing?.online;
    const name = operatorName(row);
    byId.set(id, {
      id,
      name: existing?.name && existing.name !== "Sin nombre" ? existing.name : name,
      online,
      status: String(row?.status || existing?.status || (online ? "working" : "offline")),
      calls: existing?.calls || 0,
      chats: existing?.chats || 0,
      score: existing?.score || 0,
      level: existing?.level || "low",
    });
  }

  // Add work pressure by matching available names from current payloads.
  for (const it of outboundItems) {
    const sender = it?._sender || it?.sender || {};
    const rawName = sender?.display_name || it?.tarotist_display_name || it?.worker_display_name || it?.assigned_to_display_name;
    if (!rawName) continue;
    const name = normalizeName(rawName);
    const found = [...byId.values()].find((op) => matchName(op.name, name));
    if (found) found.calls += 1;
  }

  for (const chat of chatItems) {
    const rawName = chat?.tarotist_display_name || chat?.worker_display_name || chat?.display_name;
    if (!rawName) continue;
    const name = normalizeName(rawName);
    const found = [...byId.values()].find((op) => matchName(op.name, name));
    if (found) found.chats += 1;
  }

  const operators = [...byId.values()].map((op) => {
    const score = op.calls * 2 + op.chats + (op.online ? 0 : 2);
    return { ...op, score, level: scoreLevel(score) };
  });

  operators.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const onlineOperators = operators.filter((op) => op.online);
  const overloaded = onlineOperators.find((op) => op.level === "high") || null;
  const available = [...onlineOperators].sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))[0] || null;
  const topOperators = operators.slice(0, 3);

  const alertItems: OperatorControlSummary["alertItems"] = [];

  if (parkingCount > 0) {
    alertItems.push({
      id: "team-parking-pressure",
      title: "Parking con prioridad máxima",
      subtitle: `${parkingCount} llamada(s) aparcada(s). El equipo debe atender esto antes que el resto.`,
      meta: "Alerta de equipo",
      priority: "critical",
      action: "parking",
      type: "team",
    });
  }

  if (offlineExpected > 0) {
    alertItems.push({
      id: "team-offline-expected",
      title: "Ausencias en turno detectadas",
      subtitle: `${offlineExpected} persona(s) deberían estar conectadas y no lo están.`,
      meta: "Revisar equipo ahora",
      priority: "high",
      action: "team",
      type: "team",
    });
  }

  if (overloaded && available && overloaded.id !== available.id && overloaded.score - available.score >= 3) {
    alertItems.push({
      id: "team-rebalance",
      title: `${overloaded.name} está saturada`,
      subtitle: `${available.name} tiene menor carga. Conviene repartir trabajo manualmente.`,
      meta: `Carga ${overloaded.score} vs ${available.score}`,
      priority: "high",
      action: "team",
      type: "team",
    });
  }

  if (!onlineOperators.length && operators.length) {
    alertItems.push({
      id: "team-none-online",
      title: "No hay nadie conectado",
      subtitle: "Hay equipo esperado, pero no hay presencia activa.",
      meta: "Alerta crítica de operación",
      priority: "critical",
      action: "team",
      type: "team",
    });
  }

  return { operators, topOperators, overloaded, available, alertItems };
}
