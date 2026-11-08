'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useStaffChat } from '@/providers/StaffChatProvider';
import { useAttendance } from '@/hooks/useAttendance';
import { usePanelSessionAccess } from '@/hooks/usePanelSessionAccess';
import { chatRequest } from '@/lib/staff-chat-client';
import { panelCallActive, panelCallError, type StaffPanelCall } from '@/lib/staff-panel-calls';
import StaffPanelCallOverlay from '@/components/chat/StaffPanelCallOverlay';

type StartCall = { threadId: string; targetWorkerId: string; targetName: string };
type CallsContext = { busy: boolean; enabled: boolean; startCall: (input: StartCall) => Promise<void> };
const Context = createContext<CallsContext | null>(null);
export function useStaffPanelCalls() { return useContext(Context); }

async function gatheredDescription(pc: RTCPeerConnection) {
  if (pc.iceGatheringState !== 'complete') await new Promise<void>((resolve, reject) => {
    const finish = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', changed); resolve(); };
    const changed = () => { if (pc.iceGatheringState === 'complete') finish(); };
    const timer = window.setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', changed);
      if (pc.localDescription?.sdp.includes('a=candidate:')) resolve(); else reject(new Error('CALL_SIGNAL_TIMEOUT'));
    }, 10000);
    pc.addEventListener('icegatheringstatechange', changed);
  });
  if (!pc.localDescription?.sdp) throw new Error('CALL_SIGNAL_TIMEOUT');
  return pc.localDescription.sdp;
}

export function StaffPanelCallProvider({ children }: { children: ReactNode }) {
  const { me, sound, audioReady, testSound } = useStaffChat();
  const attendance = useAttendance();
  const { connected } = usePanelSessionAccess(attendance);
  const [call, setCall] = useState<StaffPanelCall | null>(null);
  const hasCall = !!call;
  const [preparing, setPreparing] = useState(false), [remoteBusy, setRemoteBusy] = useState(false);
  const [phase, setPhase] = useState(''), [error, setError] = useState(''), [muted, setMuted] = useState(false);
  const [needsPlayback, setNeedsPlayback] = useState(false);
  const [relayConfigured, setRelayConfigured] = useState(true);
  const meId = me?.id || '';
  const actor = useRef(meId), enabled = useRef(false), tab = useRef('');
  const callRef = useRef<StaffPanelCall | null>(null), peer = useRef<RTCPeerConnection | null>(null);
  const outgoingId = useRef<string | null>(null);
  const closedCalls = useRef(new Map<string, { until: number; confirmed: boolean }>());
  const microphone = useRef<MediaStream | null>(null), speaker = useRef<HTMLAudioElement | null>(null);
  const generation = useRef(0), starting = useRef(false), answering = useRef(false), polling = useRef(false), applyAnswer = useRef(false);
  const nextHeartbeat = useRef(0), connectTimer = useRef<number>(), disconnectTimer = useRef<number>();
  const serverOffset = useRef(0);
  actor.current = meId; enabled.current = !!meId && connected;
  const callRequest = useCallback(async (url: string, init?: RequestInit) => {
    const result = await chatRequest(url, init);
    const serverNow = Date.parse(String(result?.server_now || ''));
    if (Number.isFinite(serverNow)) serverOffset.current = serverNow - Date.now();
    return result;
  }, []);
  const isActiveCall = useCallback((current: StaffPanelCall | null) => panelCallActive(current, Date.now() + serverOffset.current), []);
  const markClosed = useCallback((id: string, confirmed = false) => {
    closedCalls.current.set(id, { until: Date.now() + 120000, confirmed: confirmed || closedCalls.current.get(id)?.confirmed === true });
  }, []);
  const updateCall = useCallback((next: StaffPanelCall | null) => { callRef.current = next; setCall(next); }, []);
  const cleanMedia = useCallback(() => {
    window.clearTimeout(connectTimer.current); window.clearTimeout(disconnectTimer.current);
    const pc = peer.current; peer.current = null;
    if (pc) { pc.ontrack = null; pc.onconnectionstatechange = null; pc.close(); }
    microphone.current?.getTracks().forEach(track => track.stop()); microphone.current = null;
    if (speaker.current) { speaker.current.pause(); speaker.current.srcObject = null; speaker.current = null; }
    applyAnswer.current = false; setMuted(false); setNeedsPlayback(false);
  }, []);
  const sendAction = useCallback((action: string, current: StaffPanelCall, extra: Record<string, unknown> = {}) => callRequest('/api/chat/calls', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, call_id: current.id, tab_id: tab.current, expected_actor_id: actor.current, ...extra }),
  }), [callRequest]);
  const ownsCall = useCallback((current: StaffPanelCall) => current.caller_worker_id === actor.current ? current.caller_tab_id === tab.current : current.callee_tab_id === tab.current, []);

  const endCall = useCallback(async (reason?: string) => {
    const current = callRef.current;
    // GET may already be in flight while cancellation reaches the server.
    // Remember local intent before clearing UI so an old snapshot cannot ring again.
    const closingId = current?.id || outgoingId.current;
    if (closingId) markClosed(closingId);
    outgoingId.current = null;
    generation.current++; starting.current = false; answering.current = false;
    cleanMedia(); setPreparing(false); setPhase(''); updateCall(null);
    if (reason) setError(reason);
    if (current && isActiveCall(current) && (ownsCall(current) || (current.callee_worker_id === actor.current && current.status === 'ringing'))) {
      try {
        const result = await sendAction(current.callee_worker_id === actor.current && current.status === 'ringing' ? 'reject' : 'end', current);
        if (result.call && !isActiveCall(result.call)) { markClosed(current.id, true); setRemoteBusy(false); }
      }
      catch { if (!reason) setError('El audio se ha cerrado. El aviso remoto caducará si no puede recibir la cancelación.'); }
    }
  }, [cleanMedia, updateCall, ownsCall, sendAction, isActiveCall, markClosed]);
  const endRef = useRef(endCall); endRef.current = endCall;

  const preparePeer = useCallback(async (currentGeneration: number) => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error('CALL_UNSUPPORTED');
    const config = await callRequest('/api/chat/calls?config=1');
    if (generation.current !== currentGeneration || !enabled.current) throw new Error('IDENTITY_CHANGED');
    setRelayConfigured(config.relayConfigured === true);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    if (generation.current !== currentGeneration || !enabled.current) { stream.getTracks().forEach(track => track.stop()); throw new Error('IDENTITY_CHANGED'); }
    microphone.current = stream;
    const pc = new RTCPeerConnection({ iceServers: config.iceServers, bundlePolicy: 'max-bundle' });
    peer.current = pc;
    const audio = new Audio(); audio.autoplay = true; speaker.current = audio;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    pc.ontrack = event => {
      if (peer.current !== pc) return;
      audio.srcObject = event.streams[0] || new MediaStream([event.track]);
      void audio.play().then(() => { if (peer.current === pc) setNeedsPlayback(false); }).catch(() => { if (peer.current === pc) setNeedsPlayback(true); });
    };
    pc.onconnectionstatechange = () => {
      if (peer.current !== pc) return;
      if (pc.connectionState === 'connected') { clearTimeout(connectTimer.current); clearTimeout(disconnectTimer.current); setPhase('En llamada'); }
      if (pc.connectionState === 'failed') void endRef.current(panelCallError(new Error('CALL_NETWORK')));
      if (pc.connectionState === 'disconnected') {
        setPhase('Reconectando audio…'); clearTimeout(disconnectTimer.current);
        disconnectTimer.current = window.setTimeout(() => { if (peer.current === pc && pc.connectionState !== 'connected') void endRef.current(panelCallError(new Error('CALL_NETWORK'))); }, 15000);
      }
    };
    return pc;
  }, [callRequest]);
  const startConnectionTimeout = useCallback(() => {
    clearTimeout(connectTimer.current);
    connectTimer.current = window.setTimeout(() => { if (peer.current && peer.current.connectionState !== 'connected') void endRef.current(panelCallError(new Error('CALL_NETWORK'))); }, 30000);
  }, []);

  const startCall = useCallback(async ({ threadId, targetWorkerId }: StartCall) => {
    if (starting.current || callRef.current || !enabled.current || remoteBusy) return;
    starting.current = true; setPreparing(true); setError(''); setPhase('Preparando micrófono…');
    const version = ++generation.current, owner = actor.current;
    const callId = crypto.randomUUID();
    outgoingId.current = callId;
    try {
      const pc = await preparePeer(version);
      await pc.setLocalDescription(await pc.createOffer());
      const sdp = await gatheredDescription(pc);
      if (generation.current !== version || actor.current !== owner) return;
      const result = await callRequest('/api/chat/calls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start', call_id: callId, tab_id: tab.current, expected_actor_id: owner, thread_id: threadId, target_worker_id: targetWorkerId, sdp }) });
      if (generation.current !== version || actor.current !== owner) {
        // The microphone may have been closed while the server accepted the invitation.
        if (actor.current === owner) {
          markClosed(callId);
          void sendAction('end', result.call).then(ended => { if (ended.call && !isActiveCall(ended.call)) markClosed(callId, true); }).catch(() => {});
        }
        return;
      }
      updateCall(result.call); setPhase('Llamando…'); nextHeartbeat.current = Date.now() + 10000;
    } catch (failure) {
      // A timed-out start is reconciled by the stable call id, never resent automatically.
      if (generation.current === version && actor.current === owner) {
        markClosed(callId); outgoingId.current = null;
        cleanMedia(); setError(panelCallError(failure)); setPhase('');
        try {
          const state = await callRequest(`/api/chat/calls?call_id=${callId}`);
          if (state.call && isActiveCall(state.call)) { const ended = await sendAction('end', state.call); if (ended.call && !isActiveCall(ended.call)) markClosed(callId, true); }
        } catch { /* server invitation expires; never open microphone on recovery */ }
      }
    } finally { if (generation.current === version) { starting.current = false; setPreparing(false); } }
  }, [remoteBusy, preparePeer, updateCall, cleanMedia, sendAction, callRequest, isActiveCall, markClosed]);

  const answerCall = useCallback(async () => {
    const current = callRef.current;
    if (!current || current.status !== 'ringing' || current.callee_worker_id !== actor.current || answering.current) return;
    answering.current = true; setPreparing(true); setError(''); setPhase('Conectando micrófono…');
    const version = ++generation.current, owner = actor.current;
    try {
      const pc = await preparePeer(version);
      if (!current.offer_sdp) throw new Error('CALL_EXPIRED');
      await pc.setRemoteDescription({ type: 'offer', sdp: current.offer_sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      const sdp = await gatheredDescription(pc);
      if (generation.current !== version) return;
      const result = await sendAction('answer', current, { sdp });
      if (generation.current !== version) {
        // If cancel won locally but answer reached the server, close that accepted call too.
        if (actor.current === owner && result.call?.status === 'accepted' && ownsCall(result.call)) void sendAction('end', result.call).catch(() => {});
        return;
      }
      if (result.call?.status !== 'accepted') throw new Error('CALL_EXPIRED');
      updateCall(result.call); setPhase('Conectando audio…'); nextHeartbeat.current = Date.now() + 10000; startConnectionTimeout();
    } catch (failure) {
      if (generation.current === version) {
        cleanMedia(); setError(panelCallError(failure)); setPhase('');
        // A lost answer response must not leave an accepted call renewing without audio.
        try {
          const state = await callRequest(`/api/chat/calls?call_id=${current.id}`);
          if (generation.current === version && actor.current === owner && state.call?.status === 'accepted' && ownsCall(state.call)) {
            markClosed(current.id); updateCall(null);
            const ended = await sendAction('end', state.call); if (ended.call && !isActiveCall(ended.call)) markClosed(current.id, true);
          }
        } catch { /* accepted calls expire when either side stops heartbeating */ }
      }
    } finally { if (generation.current === version) { answering.current = false; setPreparing(false); } }
  }, [preparePeer, sendAction, updateCall, cleanMedia, startConnectionTimeout, ownsCall, callRequest, markClosed, isActiveCall]);

  useEffect(() => {
    tab.current = crypto.randomUUID();
    generation.current++; cleanMedia(); updateCall(null); setPreparing(false); setRemoteBusy(false); setError('');
    starting.current = false; answering.current = false;
    outgoingId.current = null; closedCalls.current.clear();
    return () => { generation.current++; cleanMedia(); };
  }, [meId, cleanMedia, updateCall]);
  useEffect(() => {
    if (!connected && (callRef.current || starting.current)) void endCall();
  }, [connected, endCall]);
  useEffect(() => {
    if (!meId || !connected) return;
    let stopped = false;
    const poll = async () => {
      if (polling.current || starting.current || stopped) return;
      if (callRef.current && !isActiveCall(callRef.current)) { void endRef.current('La llamada ha caducado o se ha perdido la conexión del panel.'); return; }
      polling.current = true;
      const owner = actor.current, version = generation.current, before = callRef.current;
      try {
        const result = await callRequest(`/api/chat/calls${before ? `?call_id=${before.id}` : ''}`);
        if (stopped || owner !== actor.current || version !== generation.current) return;
        const next: StaffPanelCall | null = result.call;
        for (const [id, item] of closedCalls.current) if (item.until < Date.now()) closedCalls.current.delete(id);
        const closed = next ? closedCalls.current.get(next.id) : null;
        if (next && closed) { setRemoteBusy(!closed.confirmed && isActiveCall(next)); return; }
        if (!next || !isActiveCall(next)) {
          if (before) { generation.current++; cleanMedia(); updateCall(null); setPreparing(false); answering.current = false; setPhase(''); if (next?.status === 'rejected') setError('La llamada ha sido rechazada.'); else if (next?.status === 'missed') setError('No hubo respuesta o se perdió la conexión del panel.'); }
          setRemoteBusy(false); return;
        }
        const mine = ownsCall(next), isIncoming = next.callee_worker_id === owner && next.status === 'ringing';
        if (!mine && !isIncoming) {
          if (before || answering.current) { generation.current++; answering.current = false; setPreparing(false); }
          cleanMedia(); updateCall(null); setRemoteBusy(true); return;
        }
        setRemoteBusy(false); updateCall(next);
        if (next.status === 'accepted' && mine && !peer.current && !answering.current) {
          void endRef.current('El audio se ha cerrado. Vuelve a llamar para reconectar.'); return;
        }
        if (next.status === 'ringing' && !preparing) setPhase(isIncoming ? 'Llamada entrante' : 'Llamando…');
        if (next.status === 'accepted' && mine && next.caller_worker_id === owner && next.answer_sdp && peer.current && !peer.current.remoteDescription && !applyAnswer.current) {
          applyAnswer.current = true; const pc = peer.current;
          await pc.setRemoteDescription({ type: 'answer', sdp: next.answer_sdp });
          if (peer.current === pc) { setPhase('Conectando audio…'); startConnectionTimeout(); }
          applyAnswer.current = false;
        }
        if (mine && next.status === 'accepted' && Date.now() >= nextHeartbeat.current) {
          nextHeartbeat.current = Date.now() + 10000;
          await sendAction('heartbeat', next);
        }
      } catch (failure) {
        if (stopped || owner !== actor.current || version !== generation.current) return;
        const code = failure && typeof failure === 'object' && 'code' in failure ? String(failure.code) : '';
        if (['NO_AUTH', 'FORBIDDEN', 'IDENTITY_CHANGED', 'PANEL_CONNECTION_REQUIRED', 'CALL_ALREADY_ANSWERED'].includes(code)) void endRef.current(panelCallError(failure));
        if (failure instanceof Error && ['OperationError', 'InvalidStateError'].includes(failure.name)) void endRef.current(panelCallError(new Error('CALL_NETWORK')));
        // Temporary polling failure never replays a call or pretends the remote party hung up.
      } finally { polling.current = false; }
    };
    void poll(); const timer = window.setInterval(() => void poll(), hasCall ? 2500 : 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, [meId, connected, cleanMedia, updateCall, ownsCall, sendAction, startConnectionTimeout, preparing, hasCall, callRequest, isActiveCall]);

  useEffect(() => {
    const incoming = call?.status === 'ringing' && call.callee_worker_id === meId;
    if (!incoming || !sound || !audioReady || preparing) return;
    void testSound(); const timer = window.setInterval(() => void testSound(), 4000);
    return () => clearInterval(timer);
  }, [call?.id, call?.status, call?.callee_worker_id, meId, sound, audioReady, preparing, testSound]);
  useEffect(() => {
    const leave = () => { generation.current++; cleanMedia(); };
    window.addEventListener('pagehide', leave);
    return () => { window.removeEventListener('pagehide', leave); cleanMedia(); };
  }, [cleanMedia]);

  const toggleMute = () => { const next = !muted; microphone.current?.getAudioTracks().forEach(track => { track.enabled = !next; }); setMuted(next); };
  const playAudio = () => {
    const audio = speaker.current;
    void audio?.play().then(() => { if (speaker.current === audio) setNeedsPlayback(false); }).catch(() => { if (speaker.current === audio) setError('Activa el sonido del navegador para escuchar a la otra persona.'); });
  };
  return <Context.Provider value={{ busy: preparing || !!call || remoteBusy, enabled: !!meId && connected, startCall }}>
    {children}
    {(call || preparing || error) && <StaffPanelCallOverlay call={call} meId={meId} phase={phase} error={error} preparing={preparing} muted={muted} relayConfigured={relayConfigured} audioReady={audioReady} needsPlayback={needsPlayback}
      onAnswer={() => void answerCall()} onEnd={() => void endCall()} onMute={toggleMute} onPlayback={playAudio} onDismissError={() => setError('')} />}
  </Context.Provider>;
}
