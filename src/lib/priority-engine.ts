export type Priority = "critical" | "high" | "medium" | "low";

export type PriorityInput = {
  priority?: Priority;
  created_at?: string | null;
  updated_at?: string | null;
  last_activity_at?: string | null;
  next_contact_at?: string | null;
  unread_count?: number | null;
  type?: "parking" | "lead" | "chat" | "call" | "incident" | "team" | "attendance" | string;
  rank?: string | null;
  rango?: string | null;
  rango_actual?: string | null;
  value?: number | null;
  amount?: number | null;
};

const PRIORITY_WEIGHT: Record<Priority, number> = {
  critical: 4000,
  high: 3000,
  medium: 2000,
  low: 1000,
};

function normalizePriority(priority?: Priority): Priority {
  if (priority === "critical" || priority === "high" || priority === "medium" || priority === "low") return priority;
  return "low";
}

function minutesAgo(value?: string | null) {
  if (!value) return null;
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (Date.now() - t) / 60000);
}

function rankWeight(item: PriorityInput) {
  const raw = String(item.rank || item.rango || item.rango_actual || "").toLowerCase();
  if (raw === "oro" || raw === "gold") return 180;
  if (raw === "plata" || raw === "silver") return 100;
  if (raw === "bronce" || raw === "bronze") return 45;
  return 0;
}

export function priorityScore(item: PriorityInput) {
  let score = PRIORITY_WEIGHT[normalizePriority(item.priority)];
  const type = String(item.type || "").toLowerCase();

  // Parking siempre manda: por decisión de producto, va por encima de todo.
  if (type === "parking") score += 2500;

  // Chat tiene poca prioridad salvo que venga explícitamente sin leer.
  if (type === "chat") score += item.unread_count ? 220 : -160;

  if (type === "lead") score += 320;
  if (type === "call") score += 210;
  if (type === "incident") score += 180;
  if (type === "team") score += 120;

  const nextContactAt = item.next_contact_at;
  if (nextContactAt) {
    const dueAt = new Date(nextContactAt).getTime();
    if (Number.isFinite(dueAt)) {
      if (dueAt <= Date.now()) score += 700;
      else if (dueAt - Date.now() < 15 * 60_000) score += 350;
    }
  }

  const recentAt = item.last_activity_at || item.updated_at || item.created_at;
  const age = minutesAgo(recentAt);
  if (age != null) {
    if (age <= 5) score += 250;
    else if (age <= 15) score += 150;
    else if (age <= 60) score += 60;
  }

  score += rankWeight(item);

  const value = Number(item.value ?? item.amount ?? 0);
  if (Number.isFinite(value) && value > 0) score += Math.min(220, value / 5);

  return score;
}

export function sortItems<T extends PriorityInput>(items: T[]): T[] {
  return [...items].sort((a, b) => priorityScore(b) - priorityScore(a));
}
