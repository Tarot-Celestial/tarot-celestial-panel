import type { Session, SupabaseClient } from '@supabase/supabase-js';

const ATTEMPT_PREFIX = 'tc-client-purchase-attempt:v1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class ClientPurchaseError extends Error {
  constructor(message: string, readonly pendingUrl: string | null = null) { super(message); }
}
function verifiedPaymentUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin && url.pathname === '/pago-tarjeta' && UUID.test(url.searchParams.get('ref') || '')
      ? url.pathname + url.search : null;
  } catch { return null; }
}

/** Shared by minutes, Oracle draws and questions. Never discards an unknown outcome. */
export async function prepareClientPurchase({ auth, session, packId, isCurrent }: {
  auth: SupabaseClient['auth']; session: Session; packId: string; isCurrent: () => boolean;
}): Promise<string | null> {
  if (!isCurrent()) return null;
  const key = `${ATTEMPT_PREFIX}${session.user.id}:${packId}`;
  let stored: { attemptId: string; url?: string } | null = null;
  try {
    const raw = localStorage.getItem(key);
    if (raw) { const parsed = JSON.parse(raw); if (UUID.test(parsed?.attemptId || '')) stored = parsed; }
  } catch { /* Replace a damaged entry before sending a request. */ }
  // A confirmed link belongs to a previous visit. Failed or ambiguous requests
  // retain the exact attempt ID through retries and reloads.
  const attemptId = stored?.url ? crypto.randomUUID() : stored?.attemptId || crypto.randomUUID();
  try { localStorage.setItem(key, JSON.stringify({ attemptId })); }
  catch { throw new ClientPurchaseError('Tu navegador no puede guardar este intento de compra. Permite el almacenamiento del sitio y vuelve a intentarlo.'); }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const request = (token: string) => fetch('/api/cliente/pagos/paypal', { method: 'POST', cache: 'no-store', signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ packId, attemptId }) });
    let response = await request(session.access_token);
    if (response.status === 401) {
      if (!isCurrent()) return null;
      const refreshed = (await auth.refreshSession()).data.session;
      if (!isCurrent() || refreshed?.user.id !== session.user.id) throw new ClientPurchaseError('Tu sesión ha caducado. Vuelve a iniciar sesión.');
      response = await request(refreshed.access_token);
    }
    const result = await response.json().catch(() => null);
    if (!isCurrent()) return null;
    const url = verifiedPaymentUrl(result?.url);
    if (!response.ok || !result?.ok || !result?.url) throw new ClientPurchaseError(result?.error || 'No hemos podido preparar el pago. Vuelve a intentarlo: recuperaremos la misma compra.', response.status === 409 ? url : null);
    if (!url) throw new ClientPurchaseError('No hemos podido verificar el enlace de pago. Vuelve a intentarlo.');
    const confirmedAttemptId = UUID.test(result.attempt_id || '') ? result.attempt_id : attemptId;
    localStorage.setItem(key, JSON.stringify({ attemptId: confirmedAttemptId, url }));
    return url;
  } finally { clearTimeout(timeout); }
}
