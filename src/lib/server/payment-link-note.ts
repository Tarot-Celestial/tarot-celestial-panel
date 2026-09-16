import { createHash } from "crypto";

/** Stable note identity makes retries safe without adding a second ledger or schema. */
export async function savePaymentLinkNote(admin: any, input: {
  paymentId: string; clienteId: string; packName: string; amount: number; currency: string;
  normal: number; free: number; paidAt?: string; initiatedBy?: string; manual: boolean; source?: "web" | "link";
}) {
  const hash = createHash("sha256").update(`tarot:crm-payment-note:mollie:${input.paymentId}`).digest("hex");
  const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
  const texto = [
    input.source === "web" ? "Compra web · Tarot Celestial" : "Compra mediante enlace de pago · Tarot Celestial",
    `Compra: ${input.packName}`,
    `Importe: ${input.amount.toFixed(2)} ${input.currency}`,
    `Minutos normales acreditados: ${input.normal}`,
    `Minutos FREE acreditados: ${input.free}`,
    input.manual ? "Cobro de importe libre, sin pack de minutos asociado." : null,
    `Proveedor: Mollie · Referencia: mollie:${input.paymentId}`,
    input.paidAt ? `Pago confirmado: ${input.paidAt}` : null,
    input.initiatedBy ? `Enlace generado por: ${input.initiatedBy}` : null,
  ].filter(Boolean).join("\n");
  const { error } = await admin.from("crm_client_notes").upsert({
    id, cliente_id: input.clienteId, texto,
    author_user_id: null, author_name: "Sistema", author_email: null, is_pinned: false,
  }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw new Error(`PAYMENT_NOTE_PENDING: ${error.message || error.code}`);
}
