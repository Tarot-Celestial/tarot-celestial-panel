export type ClientLifecycleTone = "active" | "idle" | "risk" | "inactive" | "neutral";

export type ClientLifecycleStatus = {
  label: string;
  detail: string;
  tone: ClientLifecycleTone;
  daysSincePurchase: number | null;
};

export function daysSinceDate(value?: string | null, now = Date.now()) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((now - date.getTime()) / 86_400_000));
}

export function getClientLifecycleStatus(lastPurchaseAt?: string | null): ClientLifecycleStatus {
  const days = daysSinceDate(lastPurchaseAt);
  if (days === null) return { label: "Sin compra", detail: "Sin historial de compras", tone: "neutral", daysSincePurchase: null };
  if (days <= 30) return { label: "Activa", detail: "Muy comprometida", tone: "active", daysSincePurchase: days };
  if (days <= 50) return { label: "En inactividad", detail: "Requiere atención", tone: "idle", daysSincePurchase: days };
  if (days <= 74) return { label: "En riesgo", detail: "Alta probabilidad de abandono", tone: "risk", daysSincePurchase: days };
  return { label: "Inactiva", detail: "Necesita reconexión", tone: "inactive", daysSincePurchase: days };
}
