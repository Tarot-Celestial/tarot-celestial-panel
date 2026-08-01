export type FidelityPurchase = {
  created_at?: string | null;
  importe?: number | string | null;
};

export type FidelityActivity = {
  created_at?: string | null;
  estado?: string | null;
};

export type ClientFidelityInput = {
  capturedAt?: string | null;
  purchases: FidelityPurchase[];
  calls: FidelityActivity[];
  interactions: FidelityActivity[];
  notes: FidelityActivity[];
  now?: Date;
};

export type ClientFidelityResult = {
  score: number;
  level: "excellent" | "very_high" | "high" | "medium" | "low" | "very_low";
  label: string;
  description: string;
  stars: number;
  breakdown: {
    recentPurchase: number;
    purchaseHistory: number;
    purchaseFrequency: number;
    longevity: number;
    activity: number;
    followUps: number;
    spend: number;
  };
};

const DAY = 86_400_000;

function validDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysSince(value: string | null | undefined, now: Date) {
  const date = validDate(value);
  if (!date) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY));
}

function countRecent(rows: FidelityActivity[], days: number, now: Date) {
  return rows.reduce((total, row) => {
    const elapsed = daysSince(row.created_at, now);
    return total + (elapsed != null && elapsed <= days ? 1 : 0);
  }, 0);
}

function classify(score: number): Pick<ClientFidelityResult, "level" | "label" | "description" | "stars"> {
  if (score >= 95) return { level: "excellent", label: "Excelente", description: "Muy fidelizada", stars: 5 };
  if (score >= 80) return { level: "very_high", label: "Muy alta", description: "Cliente muy comprometida", stars: 4 };
  if (score >= 60) return { level: "high", label: "Alta", description: "Cliente estable", stars: 3 };
  if (score >= 40) return { level: "medium", label: "Media", description: "Necesita seguimiento", stars: 2 };
  if (score >= 20) return { level: "low", label: "Baja", description: "Existe riesgo", stars: 1 };
  return { level: "very_low", label: "Muy baja", description: "Cliente crítica", stars: 0 };
}

export function calculateClientFidelity(input: ClientFidelityInput): ClientFidelityResult {
  const now = input.now || new Date();
  const purchases = input.purchases
    .map((purchase) => ({ ...purchase, date: validDate(purchase.created_at) }))
    .filter((purchase) => purchase.date)
    .sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));

  const lastPurchaseDays = purchases[0]?.date
    ? Math.max(0, Math.floor((now.getTime() - purchases[0].date!.getTime()) / DAY))
    : null;

  const recentPurchase = lastPurchaseDays == null ? 0 : lastPurchaseDays <= 30 ? 25 : lastPurchaseDays <= 45 ? 15 : 0;
  const purchaseHistory = Math.min(20, purchases.length * 4);
  const purchasesLast90 = purchases.filter((purchase) => {
    const elapsed = purchase.date ? Math.floor((now.getTime() - purchase.date.getTime()) / DAY) : 9999;
    return elapsed <= 90;
  }).length;
  const purchaseFrequency = purchasesLast90 >= 4 ? 15 : purchasesLast90 === 3 ? 10 : purchasesLast90 === 2 ? 5 : 0;

  const relationshipDays = daysSince(input.capturedAt, now) || 0;
  let longevity = 0;
  if (relationshipDays >= 180 && lastPurchaseDays != null && lastPurchaseDays <= 45) longevity = 10;
  else if (relationshipDays >= 90 && lastPurchaseDays != null && lastPurchaseDays <= 60) longevity = 6;
  else if (relationshipDays >= 30 && purchases.length > 0) longevity = 3;

  const recentCalls = countRecent(input.calls, 30, now);
  const recentInteractions = countRecent(input.interactions, 30, now);
  const recentNotes = countRecent(input.notes, 30, now);
  const activity = Math.min(15, Math.min(6, recentCalls * 2) + Math.min(5, recentInteractions) + Math.min(4, recentNotes));

  const completedFollowUps = input.interactions.filter((row) => {
    const status = String(row.estado || "").toLowerCase();
    return ["completed", "completado", "cerrado", "done", "atendido"].includes(status);
  }).length;
  const pendingFollowUps = input.interactions.filter((row) => {
    const status = String(row.estado || "").toLowerCase();
    return ["pending", "pendiente", "open", "abierto"].includes(status);
  }).length;
  const followUps = Math.max(0, Math.min(10, completedFollowUps * 5) - Math.min(10, pendingFollowUps * 5));

  const totalSpent = purchases.reduce((sum, purchase) => sum + (Number(purchase.importe) || 0), 0);
  const spend = totalSpent >= 500 ? 5 : totalSpent >= 250 ? 3 : totalSpent >= 100 ? 2 : totalSpent > 0 ? 1 : 0;

  const breakdown = { recentPurchase, purchaseHistory, purchaseFrequency, longevity, activity, followUps, spend };
  const score = Math.max(0, Math.min(100, Object.values(breakdown).reduce((sum, value) => sum + value, 0)));

  return { score, ...classify(score), breakdown };
}
