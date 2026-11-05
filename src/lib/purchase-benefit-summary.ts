export type PurchaseBenefitSummary = {
  payment_id: string;
  is_purchase: boolean;
  classification: string | null;
  coins: number | null;
  coins_status: "confirmed" | "unconfirmed" | "unavailable";
  coins_balance_after: number | null;
  spins: { level: number; count: number }[] | null;
  revoked_spins: number;
  oracle_credits: number | null;
};

export type BenefitPayment = {
  id: string;
  source_rendimiento_id?: string | null;
  benefits_context?: Record<string, any> | null;
  benefits_processed_at?: string | null;
};

type Evidence = {
  ledger: any[] | null;
  events: any[] | null;
  spins: any[] | null;
};

// A receipt describes persisted movements, never a quote, today's rank, or a
// caller-supplied expected reward. null means unknown; it must not render as zero.
export function summarizePurchaseBenefits(payment: BenefitPayment, evidence: Evidence): PurchaseBenefitSummary {
  const events = evidence.events || [];
  const processedEvent = events.find((row) => row.benefit_key === "purchase_processed");
  const context = payment.benefits_context || processedEvent?.snapshot?.context || {};
  const pricingMode = context.pricing_mode || processedEvent?.snapshot?.reward_policy?.pricing_mode;
  const classification = context.purchase_classification || context.promotion?.purchase_classification ||
    (pricingMode === "promotion" ? "promo" : pricingMode === "super_promo" ? "super_promo_ruleta" : pricingMode === "regular" ? "nada" : null);
  const earned = (evidence.ledger || []).filter((row) => row.tipo === "ganado" && Number(row.puntos) > 0);
  const hasPurchaseEvidence = Boolean(payment.source_rendimiento_id || processedEvent || earned.length ||
    events.some((row) => String(row.benefit_key || "").startsWith("rank_package:")));
  const processed = Boolean(payment.benefits_processed_at || processedEvent);
  const reportedCoins = events.reduce((sum, row) => sum + Math.max(0, Number(row.coins) || 0), 0);
  const coinsKnown = evidence.ledger !== null && (earned.length > 0 || (processed && evidence.events !== null && reportedCoins === 0));
  const coins = coinsKnown ? earned.reduce((sum, row) => sum + Number(row.puntos), 0) : null;
  const lastMovement = [...earned].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")) ||
    Number(b.saldo_despues ?? -1) - Number(a.saldo_despues ?? -1))[0];
  const byLevel = new Map<number, number>();
  let revoked = 0;
  for (const spin of evidence.spins || []) {
    if (spin.estado === "revoked") { revoked += 1; continue; }
    const level = Number(spin.nivel);
    if (Number.isInteger(level) && level >= 1 && level <= 5) byLevel.set(level, (byLevel.get(level) || 0) + 1);
  }
  return {
    payment_id: payment.id,
    is_purchase: hasPurchaseEvidence,
    classification,
    coins,
    coins_status: evidence.ledger === null ? "unavailable" : coinsKnown ? "confirmed" : "unconfirmed",
    coins_balance_after: lastMovement?.saldo_despues == null ? null : Number(lastMovement.saldo_despues),
    // Used and expired spins remain earned benefits. Revoked spins are separate.
    spins: evidence.spins !== null && (processed || evidence.spins.length > 0)
      ? [...byLevel].sort(([a], [b]) => a - b).map(([level, count]) => ({ level, count })) : null,
    revoked_spins: revoked,
    oracle_credits: evidence.events !== null && processed
      ? events.reduce((sum, row) => sum + Math.max(0, Number(row.oracle_credits) || 0), 0) : null,
  };
}

export function purchaseClassificationLabel(classification: string | null): string {
  switch (classification) {
    case "nada": return "Normal · Nada";
    case "promo": return "Promo";
    case "captado": return "Normal · Captado";
    case "recuperado": return "Normal · Recuperado";
    case "super_promo_ruleta": return "Super Promo Ruleta";
    case "ruleta_diamante": return "Ruleta Diamante elegida";
    default: return "Clasificación no disponible";
  }
}

export function purchaseBenefitText(summary: PurchaseBenefitSummary): string {
  const coins = summary.coins === null ? "Coins pendientes de comprobar" : `${summary.coins > 0 ? "+" : ""}${summary.coins} Coins`;
  const spins = summary.spins === null ? "Giros pendientes de comprobar" : summary.spins.length === 0 ? "0 giros" : summary.spins.map(({ level, count }) =>
    `${count} giro${count === 1 ? "" : "s"} · ${level === 4 ? "Ruleta Especial" : level === 5 ? "Ruleta Diamante" : `Ruleta nivel ${level}`}`).join(" · ");
  return `${coins} · ${spins}${summary.revoked_spins ? ` · ${summary.revoked_spins} giro(s) retirado(s)` : ""}`;
}
