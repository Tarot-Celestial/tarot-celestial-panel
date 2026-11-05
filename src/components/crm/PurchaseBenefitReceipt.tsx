import { purchaseBenefitText, purchaseClassificationLabel, type PurchaseBenefitSummary } from "@/lib/purchase-benefit-summary";

export default function PurchaseBenefitReceipt({ summary }: { summary?: PurchaseBenefitSummary | null }) {
  if (!summary) return null;
  return <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(105,240,177,.24)", background: "rgba(105,240,177,.07)", lineHeight: 1.5 }}>
    <div style={{ fontWeight: 800, color: "#b7ffe0" }}>{purchaseBenefitText(summary)}</div>
    <div className="tc-sub" style={{ marginTop: 3 }}>{purchaseClassificationLabel(summary.classification)} · Beneficios de esta compra</div>
    {summary.coins === null || summary.spins === null ? <div className="tc-sub" style={{ marginTop: 3 }}>No se ha podido confirmar todo el detalle. Actualiza la ficha para volver a comprobarlo.</div> : null}
  </div>;
}
