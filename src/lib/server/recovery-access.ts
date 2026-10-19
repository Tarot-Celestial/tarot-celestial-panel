import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/server/auth-worker';

export const recoveryJson = (value: object, status = 200) => NextResponse.json(value, {
  status, headers: { 'Cache-Control': 'private, no-store' },
});

class RecoveryAccessError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function recoveryIdentity(req: Request, adminOnly = false) {
  const token = (req.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new RecoveryAccessError('Inicia sesión para acceder.', 401);
  const db = getAdminClient();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new RecoveryAccessError('La sesión no es válida. Vuelve a entrar.', 401);
  const workers = await db.from('workers').select('id,role,is_active').eq('user_id', data.user.id);
  if (workers.error) throw workers.error;
  const roles = adminOnly ? ['admin'] : ['central', 'admin'];
  if (!workers.data?.some(worker => worker.is_active !== false && roles.includes(worker.role))) {
    throw new RecoveryAccessError('No tienes acceso a esta consulta de recuperación.', 403);
  }
  return { db, uid: data.user.id };
}

export function recoveryFailure(error: any) {
  if (error instanceof RecoveryAccessError) return recoveryJson({ ok: false, error: error.message }, error.status);
  const codes: Record<string, [number, string]> = {
    FORBIDDEN: [403, 'No tienes permiso para esta gestión.'],
    NOT_ELIGIBLE: [409, 'Este contacto ya no cumple el filtro de recuperación. Actualiza la lista.'],
    STALE_VERSION: [409, 'Otra central ha actualizado esta ficha. Actualiza antes de continuar.'],
    OTHER_OWNER: [409, 'Esta ficha está en seguimiento por otra central. Su responsable o el administrador puede cambiar el estado.'],
    RESTORE_FIRST: [409, 'Devuelve primero el contacto desde reciclaje.'],
    CONTACT_FIRST: [409, 'Registra primero que fue contactada; la compra debe ser posterior.'],
    PAYMENT_REQUIRED: [409, 'Selecciona una compra completada de esta clienta, posterior al contacto.'],
    INVALID_ACTION: [400, 'La acción no es válida para este estado.'],
    INVALID_CHANNEL: [400, 'Selecciona el canal utilizado para la gestión.'],
    OPERATION_CONFLICT: [409, 'Esta operación ya se guardó con otros datos. Actualiza la ficha.'],
  };
  const match = codes[String(error?.message || '')];
  if (match) return recoveryJson({ ok: false, error: match[1] }, match[0]);
  if (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error?.code)) {
    return recoveryJson({ ok: false, error: 'Falta actualizar el servicio de Recuperación de clientes. Contacta con el administrador.' }, 503);
  }
  console.error('client-recovery', { code: error?.code, message: error?.message });
  return recoveryJson({ ok: false, error: 'No se ha podido guardar o cargar la gestión. Reintenta; no se duplicarán los XP.' }, 500);
}
