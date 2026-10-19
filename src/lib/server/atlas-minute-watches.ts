import { atlasChecked, AtlasError, type AtlasContext } from './atlas-access';
import { atlasUuid } from '@/lib/atlas';

export type AtlasMinuteWatch = {
  id: string; clientId: string; clientName: string; threshold: number; enabled: boolean;
  balance: { state: 'known'; free: number; normal: number; total: number; observedAt: string | null };
  alert: { id: string; triggeredAt: string; acknowledgedAt: string | null; totalAtTrigger: number } | null;
};
export type AtlasMinuteWatches = { watches: AtlasMinuteWatch[]; unreadCount: number };

export function atlasMinuteWatches(ctx: AtlasContext): Promise<AtlasMinuteWatches> {
  return atlasChecked(ctx.db.rpc('tc_atlas_minute_watches', { p_user: ctx.worker.user_id }));
}

export async function atlasChangeMinuteWatch(ctx: AtlasContext, body: unknown): Promise<AtlasMinuteWatches> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AtlasError('Solicitud no válida.');
  const input = body as Record<string, unknown>;
  if (input.action === 'upsert') {
    const threshold = input.threshold === undefined ? 30 : input.threshold;
    if (!atlasUuid(input.clientId) || typeof threshold !== 'number' || !Number.isInteger(threshold) || threshold < 0 || threshold > 1000) throw new AtlasError('Selecciona una clienta y un umbral de entre 0 y 1000 minutos.');
    return atlasChecked(ctx.db.rpc('tc_atlas_upsert_minute_watch', { p_user: ctx.worker.user_id, p_client: input.clientId, p_threshold: threshold, p_enabled: true }));
  }
  if (input.action === 'set_enabled') {
    if (!atlasUuid(input.watchId) || typeof input.enabled !== 'boolean') throw new AtlasError('Selecciona un seguimiento válido.');
    return atlasChecked(ctx.db.rpc('tc_atlas_set_minute_watch_enabled', { p_user: ctx.worker.user_id, p_watch: input.watchId, p_enabled: input.enabled }));
  }
  if (input.action === 'acknowledge') {
    if (!atlasUuid(input.alertId)) throw new AtlasError('Selecciona un aviso válido.');
    return atlasChecked(ctx.db.rpc('tc_atlas_ack_minute_alert', { p_user: ctx.worker.user_id, p_alert: input.alertId }));
  }
  throw new AtlasError('Acción no válida.');
}
