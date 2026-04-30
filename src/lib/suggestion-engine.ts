export type SuggestionAction =
  | "leads"
  | "parking"
  | "chat"
  | "calls"
  | "team"
  | "incidents"
  | "crm"
  | "attendance";

export type SuggestionSeverity = "critical" | "high" | "medium" | "low";

export type SuggestionInput = {
  id?: string;
  type?: string;
  title?: string;
  subtitle?: string;
  meta?: string;
  priority?: string;
  action?: SuggestionAction;
  unread_count?: number | null;
  rank?: string | null;
  value?: number | null;
};

export type Suggestion = {
  label: string;
  action: SuggestionAction;
  severity: SuggestionSeverity;
  reason: string;
};

function normalizeAction(action?: string | null): SuggestionAction | null {
  if (
    action === "leads" ||
    action === "parking" ||
    action === "chat" ||
    action === "calls" ||
    action === "team" ||
    action === "incidents" ||
    action === "crm" ||
    action === "attendance"
  ) {
    return action;
  }
  return null;
}

export function getSuggestion(item: SuggestionInput, fallbackAction?: SuggestionAction): Suggestion | null {
  const type = String(item.type || "").toLowerCase();
  const priority = String(item.priority || "low").toLowerCase();
  const action = normalizeAction(item.action) || fallbackAction || null;

  if (type === "parking" || item.id === "parking") {
    return {
      label: "Recuperar llamada YA",
      action: "parking",
      severity: "critical",
      reason: "Hay llamada en parking y tiene prioridad máxima.",
    };
  }

  if (type === "lead") {
    const rank = String(item.rank || "").toLowerCase();
    if (priority === "high" || rank === "oro" || rank === "gold") {
      return {
        label: "Atender lead ahora",
        action: "leads",
        severity: "high",
        reason: rank === "oro" || rank === "gold" ? "Cliente de rango alto." : "Lead vencido o caliente.",
      };
    }
    return {
      label: "Abrir lead",
      action: "leads",
      severity: "medium",
      reason: "Lead pendiente de seguimiento.",
    };
  }

  if (type === "chat") {
    if (Number(item.unread_count || 0) > 0 || priority === "medium" || priority === "high") {
      return {
        label: "Responder chat",
        action: "chat",
        severity: "medium",
        reason: "Hay mensajes pendientes.",
      };
    }
    return null;
  }

  if (type === "call") {
    return {
      label: "Gestionar llamada",
      action: "calls",
      severity: priority === "high" ? "high" : "medium",
      reason: "Llamada pendiente de gestión.",
    };
  }

  if (type === "incident") {
    return {
      label: "Revisar aviso",
      action: "incidents",
      severity: priority === "high" ? "high" : "medium",
      reason: "Incidencia o aviso pendiente.",
    };
  }

  if (type === "team" && priority !== "low") {
    return {
      label: "Revisar equipo",
      action: "team",
      severity: "high",
      reason: "Hay ausencias o estado de equipo que revisar.",
    };
  }

  if (type === "attendance") {
    return {
      label: "Gestionar estado",
      action: "attendance",
      severity: priority === "medium" ? "medium" : "low",
      reason: "Estado de turno.",
    };
  }

  if (action) {
    return {
      label: "Abrir",
      action,
      severity: priority === "critical" ? "critical" : priority === "high" ? "high" : "low",
      reason: "Acción disponible.",
    };
  }

  return null;
}
