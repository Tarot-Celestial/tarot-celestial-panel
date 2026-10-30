'use client';

import { useEffect, useRef, useState } from 'react';

type PanelSessionState = {
  online: boolean; status: string; sessionId?: string | null;
  expiresAt?: string | null; serverNow?: string | null; error?: string | null;
};

export function isPanelSessionAuthError(error?: string | null) {
  return /^(NO_AUTH|UNAUTHENTICATED|FORBIDDEN|NO_WORKER|WORKER_DISABLED|WORKER_NOT_ALLOWED|SESSION_REQUIRED|INVALID_SESSION|HTTP (401|403))$/.test(error || '');
}

// This only projects the last server-confirmed session into the UI. Neither a
// retry, an overview poll nor a clock tick counts as activity or extends it.
export function usePanelSessionAccess(attendance: PanelSessionState) {
  const clock = useRef({ stamp: '', offset: 0 });
  const proof = `${attendance.sessionId || ''}:${attendance.serverNow || ''}`;
  const rejectedProof = useRef<string | null>(null);
  const [, tick] = useState(0);
  const stamp = attendance.serverNow || '';
  if (stamp !== clock.current.stamp) {
    const serverTime = Date.parse(stamp);
    clock.current = { stamp, offset: Number.isFinite(serverTime) ? serverTime - Date.now() : 0 };
  }
  if (isPanelSessionAuthError(attendance.error)) rejectedProof.current = proof;
  else if (rejectedProof.current !== proof) rejectedProof.current = null;

  useEffect(() => {
    const update = () => tick(value => value + 1);
    const timer = window.setInterval(update, 1000);
    window.addEventListener('focus', update);
    document.addEventListener?.('visibilitychange', update);
    return () => {
      window.clearInterval(timer); window.removeEventListener('focus', update);
      document.removeEventListener?.('visibilitychange', update);
    };
  }, []);

  const now = Date.now() + clock.current.offset;
  const expiresAt = Date.parse(attendance.expiresAt || '');
  const hasSession = attendance.online && attendance.status === 'working' && !!attendance.sessionId && Number.isFinite(expiresAt);
  const expired = hasSession && now >= expiresAt;
  const fatalError = rejectedProof.current === proof;
  const connected = hasSession && !expired && !fatalError;
  return { connected, expiresAt, now, expired, fatalError, verificationPending: connected && !!attendance.error };
}
