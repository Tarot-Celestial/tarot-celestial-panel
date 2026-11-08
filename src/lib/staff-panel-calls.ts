export type StaffPanelCall = {
  id: string; thread_id: string; caller_worker_id: string; callee_worker_id: string;
  caller_name: string; callee_name: string; caller_tab_id: string; callee_tab_id: string | null;
  status: 'ringing' | 'accepted' | 'ended' | 'rejected' | 'missed' | 'failed';
  created_at: string; accepted_at: string | null; ended_at: string | null; expires_at: string;
  offer_sdp: string | null; answer_sdp: string | null;
};

export function panelCallActive(call: Pick<StaffPanelCall, 'status' | 'expires_at'> | null, now = Date.now()) {
  return !!call && ['ringing', 'accepted'].includes(call.status) && Date.parse(call.expires_at) > now;
}

export function panelCallError(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : error instanceof Error ? error.message : '';
  const messages: Record<string, string> = {
    CALL_BUSY: 'Una de las personas ya tiene una llamada en curso.',
    CALL_OFFLINE: 'Esta persona no tiene el panel conectado ahora.',
    CALL_EXPIRED: 'La llamada ha caducado. Puedes volver a llamar.',
    CALL_ALREADY_ANSWERED: 'La llamada ya se atendió en otra pestaña.',
    CALL_NOT_FOUND: 'La llamada ya no está disponible.',
    PANEL_CONNECTION_REQUIRED: 'Conecta tu panel para llamar al equipo.',
    NO_AUTH: 'Tu sesión ha caducado. Vuelve a entrar.',
    IDENTITY_CHANGED: 'La cuenta cambió. Abre de nuevo el chat.',
    NotAllowedError: 'Permite el micrófono en el navegador para hablar.',
    NotFoundError: 'No se ha encontrado un micrófono disponible.',
    NotReadableError: 'No se puede abrir el micrófono. Comprueba si lo usa otra aplicación.',
    CALL_NETWORK: 'No se pudo conectar el audio entre los paneles. Prueba otra red o consulta con administración.',
    CALL_UNSUPPORTED: 'Este navegador no permite llamadas de audio. Abre el panel en Chrome o Edge con HTTPS.',
    CALL_SIGNAL_TIMEOUT: 'No se pudo preparar la conexión de audio. Vuelve a intentarlo.',
  };
  return messages[code] || (error instanceof Error && messages[error.name]) || 'No se pudo completar la llamada. Comprueba la conexión y vuelve a intentarlo.';
}
