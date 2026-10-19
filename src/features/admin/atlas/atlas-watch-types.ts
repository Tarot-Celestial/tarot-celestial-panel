export type AtlasWatchBalance = { state: 'known'; free: number; normal: number; total: number; observedAt?: string } | { state: 'unavailable' };
export type AtlasClientWatch = {
  id: string; clientId: string; clientName: string; threshold: number; enabled: boolean;
  balance: AtlasWatchBalance;
  alert: { id: string; triggeredAt: string; acknowledgedAt: string | null; totalAtTrigger: number } | null;
};
export type AtlasWatchMutation = { action: 'set_enabled'; watchId: string; enabled: boolean } | { action: 'acknowledge'; alertId: string };
export type AtlasWatchesController = {
  watches: AtlasClientWatch[]; loading: boolean; busy: string; error: string; stale: boolean;
  refresh: () => void; action: (mutation: AtlasWatchMutation) => Promise<boolean>;
};

const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function parseAtlasWatches(value: unknown): AtlasClientWatch[] {
  if (!Array.isArray(value)) throw new Error('No se pudieron comprobar los avisos de saldo.');
  return value.map(item => {
    if (!item || typeof item.id !== 'string' || typeof item.clientId !== 'string' || typeof item.clientName !== 'string' || !number(item.threshold) || typeof item.enabled !== 'boolean') throw new Error('Los avisos recibidos están incompletos. Actualiza para comprobarlos.');
    const balance = item.balance;
    const verified = balance?.state === 'known' && number(balance.free) && number(balance.normal) && number(balance.total) && Math.abs(balance.total - balance.free - balance.normal) < 0.001;
    const alert = item.alert;
    if (alert && (typeof alert.id !== 'string' || typeof alert.triggeredAt !== 'string' || !number(alert.totalAtTrigger) || (alert.acknowledgedAt !== null && typeof alert.acknowledgedAt !== 'string'))) throw new Error('El estado del aviso está incompleto. Actualiza para comprobarlo.');
    return {
      id: item.id, clientId: item.clientId, clientName: item.clientName, threshold: item.threshold, enabled: item.enabled,
      balance: verified ? { state: 'known', free: balance.free, normal: balance.normal, total: balance.total, ...(typeof balance.observedAt === 'string' ? { observedAt: balance.observedAt } : {}) } : { state: 'unavailable' },
      alert: alert ? { id: alert.id, triggeredAt: alert.triggeredAt, acknowledgedAt: alert.acknowledgedAt, totalAtTrigger: alert.totalAtTrigger } : null,
    };
  });
}

export function atlasUnreadWatches(watches: AtlasClientWatch[]) {
  return watches.filter(watch => watch.enabled && watch.alert && !watch.alert.acknowledgedAt);
}

export function atlasWatchMinutes(watch: AtlasClientWatch) {
  return watch.balance.state === 'known' ? `${watch.balance.total.toLocaleString('es-ES', { maximumFractionDigits: 2 })} min` : 'Saldo sin comprobar';
}
