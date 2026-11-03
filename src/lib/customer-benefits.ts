export type CustomerBenefitRank = { intro_minutes: number; regular_bonus_minutes: number; pass_minutes: number; post_ritual?: string };
export type CustomerBenefitPolicy = {
  version: string;
  activated_at: string | null;
  legacy_spin_clock_started_at: string;
  ranks: Record<string, CustomerBenefitRank>;
  diamond_purchase_coins: number;
  spin_lifetime_hours: number;
  pass_cycle_days: number;
  pass_transition: string;
  package_benefits: any[];
};

export function customerBenefitLabels(policy: CustomerBenefitPolicy, rank: string | null | undefined) {
  const rule = policy.ranks[rank || "sin_rango"];
  if (!rule) return [];
  const labels = [`${rule.intro_minutes} minutos FREE para conocer a una nueva tarotista, una vez por cliente y tarotista habilitada`];
  if (rule.regular_bonus_minutes > 0) labels.push(`+${rule.regular_bonus_minutes} minutos FREE por compra confirmada a precio regular`);
  if (rule.pass_minutes > 0) labels.push(`1 pase de ${rule.pass_minutes} minutos cada ${policy.pass_cycle_days} días, con una compra confirmada en los últimos ${policy.pass_cycle_days} días`);
  if (rank === "diamante") {
    labels.push(`${policy.diamond_purchase_coins} Coins totales por compra a tarifa normal de nivel 1, 2 o 3, con los giros del nivel comprado; al registrar la compra en Central puedes elegir 1 giro Diamante en su lugar`);
  }
  labels.push("Las compras Promo no conceden Coins ni giros de ruleta, sea cual sea el rango");
  if (rank === "oro" || rank === "diamante") labels.push("Un número automático por cliente y sorteo activo");
  if (rule.post_ritual) labels.push(`Seguimiento postritual: ${rule.post_ritual}${rank === "diamante" ? "; acceso a Mi ritual y seguimiento durante el ritual" : ""}`);
  return labels;
}

export function spinSecondsRemaining(expiresAt: string | null | undefined, now: number) {
  if (!expiresAt) return null;
  const expires = Date.parse(expiresAt);
  return Number.isFinite(expires) ? Math.max(0, Math.ceil((expires - now) / 1000)) : null;
}

export function spinCountdownLabel(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  return [Math.floor(total / 3600), Math.floor(total % 3600 / 60), total % 60].map(n => String(n).padStart(2, "0")).join(":");
}
