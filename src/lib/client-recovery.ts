export type RecoveryStatus = "pending" | "contacted" | "no_response" | "recycled" | "recovered";
export type RecoveryBucket = "pending" | "recycled" | "recovered";
export const recoveryLabels: Record<RecoveryStatus, string> = {
  pending: "Pendiente de contactar", contacted: "Contactada · Esperando resultado",
  no_response: "Sin respuesta · Pendiente de decidir reciclaje", recycled: "En reciclaje",
  recovered: "Compra confirmada · Cliente recuperado",
};
export type RecoveryContact = {
  id: string; nombre: string; telefono: string; tags: string[]; status: RecoveryStatus;
  version: number; responsible_id: string | null; responsible_name: string | null;
  contacted_at: string | null; updated_at: string | null; recovered_at: string | null;
  payment_id: string | null; purchase_amount: number | null; xp: number;
};
export type RecoveryPayment = { id: string; importe: number; created_at: string };
export type RecoveryHistory = { id: string; status: RecoveryStatus; actor_name: string; created_at: string; note: string | null };
