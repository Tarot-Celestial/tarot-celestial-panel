import { validUuid } from '@/lib/central-assistant';
import { filterRowsByBrand } from './brand-filter';
import { reservaDate } from '@/lib/reservas';
import { reservationCandidates, type UpcomingReservation } from '@/lib/reservation-reminders';
import { allRows, AssistantError, type AssistantContext } from './central-assistant';

const OPEN_STATES = ['pendiente', 'confirmada'];

export async function upcomingReservations(ctx: AssistantContext, now = Date.now(), reservationId?: string): Promise<UpcomingReservation[]> {
  // Existing writers store UTC in timestamp-without-time-zone columns.
  const from = new Date(now).toISOString();
  const until = new Date(now + 6 * 60_000).toISOString();
  const rows = await allRows(() => {
    let query = ctx.db.from('reservas')
      .select('id,cliente_id,cliente_nombre,tarotista_nombre,tarotista_nombre_manual,fecha_reserva,estado')
      .is('deleted_at', null)
      .in('estado', OPEN_STATES).gt('fecha_reserva', from).lte('fecha_reserva', until).order('id');
    if (reservationId) query = query.eq('id', reservationId);
    return query;
  });
  if (!rows.length) return [];
  // Admin and Central share the operational agenda, independently of capture ownership.
  const visible = await filterRowsByBrand(ctx.db, rows, 'celestial');
  return visible.filter(row => OPEN_STATES.includes(row.estado)
    && Number.isFinite(reservaDate(row.fecha_reserva).getTime())
    && reservaDate(row.fecha_reserva).getTime() > now).map(row => ({
    id: String(row.id), clientId: String(row.cliente_id),
    clientName: String(row.cliente_nombre || 'Cliente').trim() || 'Cliente',
    tarotistName: String(row.tarotista_nombre || row.tarotista_nombre_manual || 'Sin asignar').trim(),
    scheduledAt: reservaDate(row.fecha_reserva).toISOString(),
    actionPath: `${ctx.worker.role === 'admin' ? '/admin' : '/panel-central'}?tab=reservas&reserva=${encodeURIComponent(row.id)}`,
  }));
}

export async function claimReservationReminder(ctx: AssistantContext, body: unknown) {
  const input = body as { id?: unknown; scheduledAt?: unknown; threshold?: unknown } | null;
  if (!input || typeof input.id !== 'string' || !validUuid(input.id)
    || typeof input.scheduledAt !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(input.scheduledAt)
    || !Number.isFinite(Date.parse(input.scheduledAt)) || typeof input.threshold !== 'number' || input.threshold !== 5) {
    throw new AssistantError('Aviso de reserva no válido.');
  }
  const rows = await upcomingReservations(ctx, Date.now(), input.id);
  const now = Date.now();
  const reminder = reservationCandidates(rows, now).find(row => row.scheduledAt === new Date(input.scheduledAt as string).toISOString()
    && row.threshold === input.threshold);
  if (!reminder) return { delivered: false, reason: 'stale' as const };
  // The existing unique(worker_id,key) constraint arbitrates simultaneous tabs and survives reloads.
  const { error } = await ctx.db.from('central_assistant_deliveries').insert({ worker_id: ctx.worker.id, key: reminder.key });
  if (error?.code === '23505') return { delivered: false, reason: 'duplicate' as const };
  if (error) throw new AssistantError('No puedo confirmar los avisos de reservas ahora. Volveré a intentarlo.', 503);
  return { delivered: true, reminder };
}
