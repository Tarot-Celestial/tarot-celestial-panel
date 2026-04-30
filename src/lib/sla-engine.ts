import type { Priority } from "@/lib/priority-engine";

export type SlaInput = {
  type?: string | null;
  priority?: Priority | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_activity_at?: string | null;
  next_contact_at?: string | null;
  unread_count?: number | null;
  id?: string | null;
};

export type SlaStatus = {
  breached: boolean;
  priority?: Priority;
  label?: string;
  reason?: string;
  minutesWaiting?: number | null;
};

function minutesSince(value?: string | null) {
  if (!value) return null;
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 60000));
}

export function evaluateSla(item: SlaInput): SlaStatus {
  const type = String(item.type || "").toLowerCase();

  if (type === "parking" || item.id === "parking") {
    return {
      breached: true,
      priority: "critical",
      label: "SLA crítico",
      reason: "Hay llamada en parking. Debe recuperarse antes que cualquier otra tarea.",
      minutesWaiting: null,
    };
  }

  if (type === "lead") {
    const nextAt = item.next_contact_at ? new Date(item.next_contact_at).getTime() : NaN;
    const leadAge = minutesSince(item.last_activity_at || item.updated_at || item.created_at);

    if (Number.isFinite(nextAt) && nextAt <= Date.now()) {
      return {
        breached: true,
        priority: "high",
        label: "Lead vencido",
        reason: "El próximo contacto ya está vencido.",
        minutesWaiting: Math.max(0, Math.round((Date.now() - nextAt) / 60000)),
      };
    }

    if (leadAge != null && leadAge >= 10) {
      return {
        breached: true,
        priority: "high",
        label: "Lead sin tocar",
        reason: "Lead pendiente demasiado tiempo sin actividad.",
        minutesWaiting: leadAge,
      };
    }
  }

  if (type === "chat") {
    const unread = Number(item.unread_count || 0);
    const wait = minutesSince(item.last_activity_at || item.updated_at || item.created_at);
    if (unread > 0 && wait != null && wait >= 10) {
      return {
        breached: true,
        priority: "medium",
        label: "Chat pendiente",
        reason: "Chat sin responder durante más de 10 minutos.",
        minutesWaiting: wait,
      };
    }
  }

  if (type === "call") {
    const wait = minutesSince(item.last_activity_at || item.updated_at || item.created_at);
    if (wait != null && wait >= 30) {
      return {
        breached: true,
        priority: "high",
        label: "Llamada atrasada",
        reason: "Llamada pendiente desde hace demasiado tiempo.",
        minutesWaiting: wait,
      };
    }
  }

  if (type === "incident") {
    const wait = minutesSince(item.created_at || item.updated_at || item.last_activity_at);
    if (wait != null && wait <= 60) {
      return {
        breached: true,
        priority: "medium",
        label: "Aviso reciente",
        reason: "Incidencia reciente pendiente de revisión.",
        minutesWaiting: wait,
      };
    }
  }

  if (type === "team" && item.priority === "high") {
    return {
      breached: true,
      priority: "high",
      label: "Ausencia en turno",
      reason: "Hay personas esperadas que no están conectadas.",
      minutesWaiting: null,
    };
  }

  return { breached: false, minutesWaiting: null };
}
