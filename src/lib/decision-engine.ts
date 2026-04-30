import type { InboxItem } from "@/components/central/OperationalInbox";
import { revenueScore } from "@/lib/revenue-engine";

type ScoreContext = {
  loadLevel?: "low" | "medium" | "high" | "critical";
};

const TYPE_WEIGHT: Record<string, number> = {
  parking: 100,
  lead: 80,
  call: 70,
  incident: 60,
  team: 40,
  chat: 20,
  attendance: 10,
};

const PRIORITY_WEIGHT: Record<string, number> = {
  low: 10,
  medium: 30,
  high: 60,
  critical: 100,
};

export function scoreItem(item: InboxItem, ctx?: ScoreContext): number {
  let score = 0;

  score += PRIORITY_WEIGHT[item.priority || "low"];
  score += TYPE_WEIGHT[item.type || ""] || 0;

  if (item.value) score += Math.min(item.value / 10, 50);

  // Dinero real: primer pago, facturación histórica/30d y rango económico.
  // La conversión para este negocio es primer pago confirmado.
  score += revenueScore(item);

  const rank = String(item.rank || "").toLowerCase();
  if (rank === "oro" || rank === "gold") score += 40;
  if (rank === "plata" || rank === "silver") score += 20;

  if (item.sla?.breached) score += 80;

  if (item.created_at) {
    const minutes = (Date.now() - new Date(item.created_at).getTime()) / 60000;
    score += Math.min(minutes / 2, 40);
  }

  if (ctx?.loadLevel === "critical") score += 30;
  if (ctx?.loadLevel === "high") score += 15;

  return score;
}

export function sortByDecision(items: InboxItem[], ctx?: ScoreContext) {
  return [...items].sort((a, b) => scoreItem(b, ctx) - scoreItem(a, ctx));
}

export function getNextBestAction(items: InboxItem[], ctx?: ScoreContext) {
  return sortByDecision(items, ctx)[0] || null;
}
