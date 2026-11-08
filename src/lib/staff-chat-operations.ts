import { parseActivityCodes, type CodeBlock } from '@/lib/activity-codes';

export type StaffPause = {
  id: string; thread_id: string; worker_id: string; worker_name: string;
  kind: 'bathroom' | 'lunch' | 'break'; status: 'pending' | 'active' | 'returned' | 'rejected' | 'cancelled';
  created_at: string; started_at: string | null; ended_at: string | null; revision: number;
};
export type StaffAppeal = { id: string; call_id: string; worker_id: string; reason: string; status: 'pending' | 'resolved'; resolution: string | null; revision: number; call_revision: number; created_at: string };
export type StaffConsultation = { id: string; first_name: string; blocks: CodeBlock[]; total: number; revision: number; occurred_at: string; deleted?: boolean; appeal: StaffAppeal | null };
export type StaffOperationActor = { id: string; role: string; display_name: string; can_admin?: boolean };
export type StaffOperationsOverview = { pauses: StaffPause[]; can_manage: boolean; is_tarotist: boolean; latest_consultation: StaffConsultation | null; pending_appeals: StaffConsultation[] };
export type StaffOperationsSummary = { pauses: StaffPause[]; pending: { id: string; thread_id: string; worker_name: string; kind: 'pause' | 'appeal'; created_at: string }[] };

export const pauseLabel = (kind: StaffPause['kind']) => kind === 'bathroom' ? 'en el baño' : kind === 'lunch' ? 'almorzando' : 'en descanso';
export function consultationFirstName(value: unknown): string {
  const name = String(value || '').trim().split(/\s+/)[0] || '';
  // Never publish the legacy fallback phone/email as a customer name.
  return /^[\p{L}][\p{L}'’-]{0,49}$/u.test(name) ? name : 'Clienta';
}
export function consultationView(row: Record<string, any>, appeal: StaffAppeal | null = null): StaffConsultation {
  return { id: String(row.id), first_name: consultationFirstName(row.cliente_nombre), blocks: parseActivityCodes(row), total: Number(row.tiempo || 0), revision: Number(row.edit_revision || 0), occurred_at: String(row.fecha_hora || row.created_at), appeal };
}
export function operationErrorMessage(code: string): string {
  return ({ OPERATION_CONFLICT: 'Este aviso cambió. Actualiza el chat y vuelve a revisarlo.', PAUSE_ALREADY_OPEN: 'Ya tienes una pausa o solicitud pendiente. Termínala antes de abrir otra.', CALL_CHANGED: 'La consulta ha cambiado. Revisa los minutos actualizados antes de apelar.', APPEAL_ALREADY_OPEN: 'Esta consulta ya tiene una apelación para esta revisión.', FORBIDDEN: 'Tu cuenta no puede realizar esta acción.', PANEL_CONNECTION_REQUIRED: 'Conéctate al panel para realizar esta acción.', INVALID_REASON: 'Escribe el motivo (entre 3 y 500 caracteres).', CALL_NOT_FOUND: 'La consulta ya no está disponible.', THREAD_NOT_FOUND: 'Esta conversación ya no está disponible.' } as Record<string, string>)[code] || 'No se pudo confirmar la acción. Actualiza para comprobar su estado antes de repetirla.';
}
