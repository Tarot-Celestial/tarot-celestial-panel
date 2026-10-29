import { supabaseBrowser } from '@/lib/supabase-browser';

export async function chatRequest(url: string, init?: RequestInit) {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session?.access_token) throw new Error('Tu sesión ha caducado. Vuelve a entrar.');
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${data.session.access_token}`);
  const response = await fetch(url, { ...init, headers, cache: 'no-store', signal: init?.signal || AbortSignal.timeout(15000) });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) {
    const error = String(result?.error || '');
    throw new Error(error === 'PANEL_CONNECTION_REQUIRED' ? 'Pulsa Conectado para utilizar el chat.' : error === 'NO_AUTH' ? 'Tu sesión ha caducado. Vuelve a entrar.' : 'No se pudo completar la operación del chat. Inténtalo de nuevo.');
  }
  return result;
}
