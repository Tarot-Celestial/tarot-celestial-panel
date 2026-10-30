import { supabaseBrowser } from '@/lib/supabase-browser';

export class ChatRequestError extends Error {
  constructor(public readonly code: string, public readonly status = 0) {
    const messages: Record<string, string> = {
      NO_AUTH: 'Tu sesión ha caducado. Vuelve a entrar.',
      IDENTITY_CHANGED: 'La cuenta ha cambiado. Abre de nuevo la conversación antes de enviar.',
      PANEL_CONNECTION_REQUIRED: 'Pulsa Conectado para utilizar el chat.',
      FORBIDDEN: 'No tienes acceso a esta conversación.',
      NO_WORKER: 'Tu cuenta no tiene acceso al chat del equipo.',
      REQUEST_TIMEOUT: 'La conexión tarda demasiado. Conservamos el mensaje para que puedas reintentarlo.',
      NETWORK_ERROR: 'No se pudo conectar. Comprueba tu conexión y reintenta el envío.',
      INVALID_ATTACHMENT_TYPE: 'Elige una imagen JPG, PNG o WebP, o un archivo de audio compatible.',
      INVALID_ATTACHMENT_SIZE: 'El archivo supera el tamaño permitido.',
      INVALID_MEDIA_TYPE: 'Elige una imagen JPG, PNG o WebP, o un archivo de audio compatible.',
      INVALID_MEDIA_SIZE: 'La imagen debe ocupar como máximo 10 MB y el audio 15 MB.',
      INVALID_MEDIA_CONTENT: 'El contenido del archivo no coincide con su formato. Vuelve a seleccionarlo.',
      INVALID_MEDIA_NAME: 'El archivo necesita un nombre válido.',
      MEDIA_STORAGE_UNAVAILABLE: 'No se pudo acceder al archivo. Conservamos el mensaje para que puedas reintentarlo.',
      ATTACHMENT_NOT_UPLOADED: 'La subida del archivo no se ha completado. Reintenta el envío.',
      ATTACHMENT_ALREADY_USED: 'Este archivo ya está enviado. Selecciónalo de nuevo para otro mensaje.',
      UPLOAD_ID_CONFLICT: 'Este envío no coincide con el archivo anterior. Vuelve a seleccionarlo.',
      ATTACHMENT_NOT_READY: 'El archivo todavía no está listo. Reintenta el envío.',
      ATTACHMENT_NOT_FOUND: 'El archivo no está disponible. Vuelve a adjuntarlo.',
    };
    super(messages[code] || 'No se pudo completar la operación del chat. Inténtalo de nuevo.');
    this.name = 'ChatRequestError';
  }
}

export async function chatRequest(url: string, init?: RequestInit) {
  const auth = supabaseBrowser().auth;
  const { data } = await auth.getSession();
  const session = data.session;
  if (!session?.access_token) throw new ChatRequestError('NO_AUTH', 401);
  let token = session.access_token;
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    let response: Response;
    try {
      response = await fetch(url, { ...init, headers, cache: 'no-store', signal: init?.signal || AbortSignal.timeout(15000) });
    } catch (error) {
      // Selection changes intentionally abort reads. Do not turn them into a
      // visible failure or automatically repeat a send with an unknown outcome.
      if (init?.signal?.aborted) throw error;
      throw new ChatRequestError(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR');
    }
    const result = await response.json().catch(() => null);
    // A rejected authentication check has performed no mutation. Refresh once,
    // preserving the original identity and message id; never replay across users.
    if (attempt === 0 && response.status === 401 && result?.error === 'NO_AUTH') {
      const { data: current } = await auth.getSession();
      if (current.session?.user.id !== session.user.id) throw new ChatRequestError('IDENTITY_CHANGED', 401);
      const { data: refreshed, error: refreshError } = current.session.access_token !== token
        ? { data: current, error: null }
        : await auth.refreshSession();
      if (refreshError || !refreshed.session?.access_token) throw new ChatRequestError('NO_AUTH', 401);
      if (refreshed.session.user.id !== session.user.id) throw new ChatRequestError('IDENTITY_CHANGED', 401);
      token = refreshed.session.access_token;
      continue;
    }
    if (!response.ok || !result?.ok) throw new ChatRequestError(String(result?.error || 'CHAT_ERROR'), response.status);
    return result;
  }
  throw new ChatRequestError('NO_AUTH', 401);
}
