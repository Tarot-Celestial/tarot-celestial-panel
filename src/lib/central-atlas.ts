export type AtlasJobStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';
export type AtlasJob = {
  id: string; worker_id: string; kind: 'capture' | 'recovery' | 'task'; title: string; description: string;
  client_ids: string[]; lead_ids: string[]; status: AtlasJobStatus; result: string | null;
  due_at: string | null; created_at: string; updated_at: string;
  clients?: Array<{ id: string; name: string }>;
};
export type PurchaseCelebration = {
  id: string; worker_id: string; payment_id: string; client_id: string; xp: number;
  amount: number; currency: string; created_at: string;
};
export type AtlasOutcome = 'responded' | 'interested' | 'no_answer' | 'followup';
export const ATLAS_JOB_STATUSES: Record<AtlasJobStatus, string> = {
  pending: 'Pendiente', in_progress: 'En curso', completed: 'Completado', blocked: 'Necesita ayuda', cancelled: 'Cancelado',
};
export const ATLAS_OUTCOMES: Record<AtlasOutcome, string> = {
  responded: 'Respondió', interested: 'Tiene interés', no_answer: 'Sin respuesta', followup: 'Seguimiento acordado',
};
export function purchaseCelebrationMessage(event: PurchaseCelebration) {
  return `¡Bien! Compra confirmada. +${event.xp} XP registrados. Vamos sumando juntos 💜`;
}
