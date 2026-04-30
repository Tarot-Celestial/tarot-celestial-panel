import type { InboxItem } from "@/components/central/OperationalInbox";

export type RevenueProfile = {
  totalRevenue: number;
  recentRevenue: number;
  paymentsCount: number;
  hasFirstPayment: boolean;
  firstPaymentAt?: string | null;
  lastPaymentAt?: string | null;
  rank?: string | null;
  isGold: boolean;
  isSilver: boolean;
  isHighValue: boolean;
  conversionSignal: "converted" | "likely" | "cold";
};

function cleanNum(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function revenueProfile(item: InboxItem | any): RevenueProfile {
  const rank = item?.rank || item?.rango_actual || item?.rango || item?.cliente?.rango_actual || item?.cliente?.rango || null;
  const normalizedRank = String(rank || "").toLowerCase();

  const totalRevenue = cleanNum(
    item?.cliente_revenue_total ??
      item?.revenue_total ??
      item?.valor_total ??
      item?.total_spent ??
      item?.importe_total ??
      item?.value ??
      item?.amount ??
      0
  );

  const recentRevenue = cleanNum(item?.cliente_revenue_30d ?? item?.revenue_30d ?? item?.total_30d ?? 0);
  const paymentsCount = cleanNum(item?.cliente_completed_payments_count ?? item?.completed_payments_count ?? item?.payments_count ?? 0);
  const hasFirstPayment = Boolean(item?.converted_first_payment || paymentsCount > 0 || totalRevenue > 0);
  const isGold = normalizedRank === "oro" || normalizedRank === "gold";
  const isSilver = normalizedRank === "plata" || normalizedRank === "silver";
  const isHighValue = totalRevenue >= 100 || recentRevenue >= 100 || isGold;

  return {
    totalRevenue,
    recentRevenue,
    paymentsCount,
    hasFirstPayment,
    firstPaymentAt: item?.cliente_first_payment_at ?? item?.first_payment_at ?? null,
    lastPaymentAt: item?.cliente_last_payment_at ?? item?.last_payment_at ?? null,
    rank,
    isGold,
    isSilver,
    isHighValue,
    conversionSignal: hasFirstPayment ? "converted" : isGold || isSilver || totalRevenue > 0 ? "likely" : "cold",
  };
}

export function revenueScore(item: InboxItem | any) {
  const profile = revenueProfile(item);
  let score = 0;

  if (profile.hasFirstPayment) score += 180;
  if (profile.isGold) score += 150;
  else if (profile.isSilver) score += 75;

  if (profile.totalRevenue > 0) score += Math.min(260, profile.totalRevenue / 2);
  if (profile.recentRevenue > 0) score += Math.min(220, profile.recentRevenue);
  if (profile.paymentsCount > 1) score += Math.min(120, profile.paymentsCount * 20);

  return score;
}

export function revenueLabel(item: InboxItem | any) {
  const profile = revenueProfile(item);
  const parts: string[] = [];

  if (profile.hasFirstPayment) parts.push("1er pago confirmado");
  if (profile.totalRevenue > 0) parts.push(`${profile.totalRevenue.toFixed(2)}€ total`);
  if (profile.recentRevenue > 0) parts.push(`${profile.recentRevenue.toFixed(2)}€ últimos 30d`);
  if (profile.paymentsCount > 0) parts.push(`${profile.paymentsCount} pago(s)`);

  return parts.join(" · ");
}
