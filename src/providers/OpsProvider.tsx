"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { usePathname } from "next/navigation";
import { isPanelPath, PANEL_HEARTBEAT_MS } from '@/lib/attendance/panel-session';

export type OpsCounters = {
  parking: number;
  leads: number;
  chatUnread: number;
};

export type OpsAttendance = {
  loading: boolean;
  online: boolean;
  status: string;
  lastEventAt: string | null;
  error: string | null;
  refreshedAt: string | null;
  workerId: string | null;
  workerRole: string | null;
  sessionId: string | null;
  sessionStartedAt: string | null;
  lastActivityAt: string | null;
  lastManualActivityAt: string | null;
  expiresAt: string | null;
  closeReason: string | null;
  serverNow: string | null;
  callActive: boolean;
  callProtectionAvailable: boolean | null;
  consultationStartedAt: string | null;
  consultationUntil: string | null;
  consultationSource: 'self_reported_external_call' | null;
};


export type OpsPresenceRow = {
  worker_id: string;
  display_name: string;
  team_key: string | null;
  online: boolean;
  status: string;
  last_event_at: string | null;
  last_seen_seconds: number | null;
};

export type OpsExpectedRow = {
  worker_id: string;
  display_name: string;
  start_time?: string | null;
  end_time?: string | null;
  timezone?: string | null;
  schedule_id?: string | null;
  online?: boolean;
  status?: string | null;
};

export type OpsListState<T> = {
  loading: boolean;
  rows: T[];
  error: string | null;
  refreshedAt: string | null;
};

export type OpsContextValue = {
  counters: OpsCounters;
  attendance: OpsAttendance;
  presences: OpsListState<OpsPresenceRow>;
  expected: OpsListState<OpsExpectedRow>;
  refreshCounters: () => void;
  refreshAttendance: () => Promise<void>;
  changeAttendance: (eventType: 'online' | 'offline' | 'break_start' | 'bathroom_start' | 'consultation_start' | 'consultation_end') => Promise<void>;
  keepAttendanceActive: () => Promise<void>;
  refreshPresences: () => void;
  refreshExpected: () => void;
};

const DEFAULT_COUNTERS: OpsCounters = {
  parking: 0,
  leads: 0,
  chatUnread: 0,
};

const DEFAULT_ATTENDANCE: OpsAttendance = {
  loading: false,
  online: false,
  status: "offline",
  lastEventAt: null,
  error: null,
  refreshedAt: null,
  workerId: null, workerRole: null, sessionId: null, sessionStartedAt: null, lastActivityAt: null,
  lastManualActivityAt: null, expiresAt: null, closeReason: null, serverNow: null,
  callActive: false, callProtectionAvailable: null,
  consultationStartedAt: null, consultationUntil: null, consultationSource: null,
};

function attendancePayload(json: any): OpsAttendance {
  return {
    loading: false, online: !!json.online, status: String(json.status || 'offline'),
    lastEventAt: json.last_event_at || null, error: null, refreshedAt: new Date().toISOString(),
    workerId: json.worker?.id || null, workerRole: json.worker?.role || null, sessionId: json.session_id || null,
    sessionStartedAt: json.session_started_at || null, lastActivityAt: json.last_activity_at || null,
    lastManualActivityAt: json.last_manual_activity_at || null, expiresAt: json.expires_at || null,
    closeReason: json.close_reason || null, serverNow: json.server_now || null,
    callActive: json.call_active === true, callProtectionAvailable: json.call_protection_available ?? null,
    consultationStartedAt: json.consultation_started_at || null, consultationUntil: json.consultation_until || null,
    consultationSource: json.consultation_source === 'self_reported_external_call' ? json.consultation_source : null,
  };
}

function defaultListState<T>(): OpsListState<T> {
  return {
    loading: false,
    rows: [],
    error: null,
    refreshedAt: null,
  };
}

const PARKING_REFRESH_MS = 60000;
const ASTERISK_ENABLED = process.env.NEXT_PUBLIC_ENABLE_ASTERISK === "true";
const LEADS_REFRESH_MS = 300000;
const ATTENDANCE_REFRESH_MS = 180000;
const PRESENCES_REFRESH_MS = 180000;
const EXPECTED_REFRESH_MS = 600000;

const OpsContext = createContext<OpsContextValue | null>(null);

async function getAccessToken() {
  const sb = supabaseBrowser();
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || null;
}

function secondsAgo(ts: string | null) {
  if (!ts) return null;
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 1000));
}

export function OpsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAdminPath = pathname?.startsWith("/admin") ?? false;
  const isCentralPath = pathname?.startsWith("/panel-central") ?? false;
  const isTarotistaPath = pathname?.startsWith("/panel-tarotista") ?? false;
  const shouldRunOps = isAdminPath || isCentralPath || isTarotistaPath;

  const [counters, setCounters] = useState<OpsCounters>(DEFAULT_COUNTERS);
  const [attendance, setAttendance] = useState<OpsAttendance>(DEFAULT_ATTENDANCE);
  const [presences, setPresences] = useState<OpsListState<OpsPresenceRow>>(() => defaultListState<OpsPresenceRow>());
  const [expected, setExpected] = useState<OpsListState<OpsExpectedRow>>(() => defaultListState<OpsExpectedRow>());

  const mountedRef = useRef(false);
  const parkingInFlightRef = useRef(false);
  const leadsInFlightRef = useRef(false);
  const attendanceInFlightRef = useRef<symbol | null>(null);
  const presencesInFlightRef = useRef(false);
  const expectedInFlightRef = useRef(false);
  const parkingDisabledUntilRef = useRef(0);
  const lastVisibleRefreshRef = useRef(0);
  const attendanceRef = useRef(attendance);
  attendanceRef.current = attendance;
  const activityRef = useRef(0);
  const clockOffsetRef = useRef(0);
  const heartbeatInFlightRef = useRef<Promise<boolean> | null>(null);
  const attendanceUserRef = useRef<string | null>(null);
  const authEpochRef = useRef(0);
  const transitionRef = useRef(0);
  const stateRevisionRef = useRef(0);
  const lastResponseAtRef = useRef(0);
  const resetAttendanceUser = useCallback((userId: string | null) => {
    if (attendanceUserRef.current === userId) return;
    attendanceUserRef.current = userId;
    authEpochRef.current++;
    transitionRef.current++;
    stateRevisionRef.current++;
    lastResponseAtRef.current = 0;
    activityRef.current = 0;
    clockOffsetRef.current = 0;
    attendanceInFlightRef.current = null;
    heartbeatInFlightRef.current = null;
    attendanceRef.current = DEFAULT_ATTENDANCE;
    setAttendance(DEFAULT_ATTENDANCE);
  }, []);
  const getAttendanceAuth = useCallback(async () => {
    const epoch = authEpochRef.current;
    const { data } = await supabaseBrowser().auth.getSession();
    // An auth event while this read was pending makes its result obsolete.
    if (epoch !== authEpochRef.current) return null;
    resetAttendanceUser(data.session?.user?.id || null);
    if (!data.session?.access_token) return null;
    return { token: data.session.access_token, epoch: authEpochRef.current };
  }, [resetAttendanceUser]);
  useEffect(() => {
    const sb = supabaseBrowser();
    const subscription = sb.auth.onAuthStateChange?.((_event, session) => {
      resetAttendanceUser(session?.user?.id || null);
    }).data.subscription;
    return () => subscription?.unsubscribe();
  }, [resetAttendanceUser]);
  const applyAttendance = useCallback((json: any) => {
    const next = attendancePayload(json);
    const serverAt = Date.parse(next.serverNow || '');
    if (Number.isFinite(serverAt) && serverAt < lastResponseAtRef.current) return;
    if (Number.isFinite(serverAt)) lastResponseAtRef.current = serverAt;
    stateRevisionRef.current++;
    if (Number.isFinite(serverAt)) clockOffsetRef.current = serverAt-Date.now();
    const manual = Date.parse(next.lastManualActivityAt || '') || 0;
    activityRef.current = attendanceRef.current.sessionId === next.sessionId ? Math.max(activityRef.current, manual) : manual;
    attendanceRef.current = next;
    setAttendance(next);
  }, []);

  const fetchParking = useCallback(async () => {
    if (!ASTERISK_ENABLED) {
      setCounters((prev) => (prev.parking === 0 ? prev : { ...prev, parking: 0 }));
      return;
    }
    if (parkingInFlightRef.current) return;
    if (Date.now() < parkingDisabledUntilRef.current) return;
    parkingInFlightRef.current = true;

    try {
      const token = await getAccessToken();
      if (!mountedRef.current) return;

      if (!token) {
        parkingDisabledUntilRef.current = Date.now() + 120_000;
        setCounters((prev) => (prev.parking === 0 ? prev : { ...prev, parking: 0 }));
        return;
      }

      const res = await fetch(`/api/asterisk/parking?t=${Date.now()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401 || res.status === 403) {
        parkingDisabledUntilRef.current = Date.now() + 120_000;
        if (mountedRef.current) setCounters((prev) => (prev.parking === 0 ? prev : { ...prev, parking: 0 }));
        return;
      }

      if (!res.ok) {
        parkingDisabledUntilRef.current = Date.now() + 60_000;
        return;
      }

      const json = await res.json().catch(() => null);
      const calls = Array.isArray(json?.calls) ? json.calls : [];

      if (!mountedRef.current) return;
      setCounters((prev) => (prev.parking === calls.length ? prev : { ...prev, parking: calls.length }));
    } catch {
      parkingDisabledUntilRef.current = Date.now() + 60_000;
      if (mountedRef.current) {
        setCounters((prev) => (prev.parking === 0 ? prev : { ...prev, parking: 0 }));
      }
    } finally {
      parkingInFlightRef.current = false;
    }
  }, []);

  const fetchLeads = useCallback(async () => {
    if (leadsInFlightRef.current) return;
    leadsInFlightRef.current = true;

    try {
      const sb = supabaseBrowser();
      const { count, error } = await sb
        .from("captacion_leads")
        .select("*", { count: "exact", head: true })
        .eq("estado", "nuevo");

      if (!mountedRef.current || error) return;
      const next = count || 0;
      setCounters((prev) => (prev.leads === next ? prev : { ...prev, leads: next }));
    } finally {
      leadsInFlightRef.current = false;
    }
  }, []);

  const fetchAttendance = useCallback(async () => {
    if (attendanceInFlightRef.current) return;
    const requestId = Symbol('attendance-read');
    attendanceInFlightRef.current = requestId;
    let epoch = authEpochRef.current;
    let transition = transitionRef.current;
    let revision = stateRevisionRef.current;
    const stillCurrent = () => mountedRef.current && epoch === authEpochRef.current && transition === transitionRef.current;
    const fail = (error: string) => {
      if (!stillCurrent() || revision !== stateRevisionRef.current) return;
      setAttendance(previous => ({ ...previous, loading: false, error, refreshedAt: new Date().toISOString() }));
    };

    try {
      const auth = await getAttendanceAuth();
      if (!auth || !mountedRef.current) return;
      epoch = auth.epoch;
      transition = transitionRef.current;
      revision = stateRevisionRef.current;

      setAttendance((prev) => ({ ...prev, loading: true, error: null }));

      const res = await fetch(`/api/attendance/me?t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);

      if (!stillCurrent()) return;

      if (!res.ok || !json?.ok) {
        fail(String(json?.error || `HTTP ${res.status}`));
        return;
      }

      applyAttendance(json);
    } catch (e: any) {
      fail(String(e?.message || 'Error'));
    } finally {
      if (attendanceInFlightRef.current === requestId) attendanceInFlightRef.current = null;
    }
  }, [applyAttendance, getAttendanceAuth]);

  const changeAttendance = useCallback(async (eventType: 'online' | 'offline' | 'break_start' | 'bathroom_start' | 'consultation_start' | 'consultation_end') => {
    const auth = await getAttendanceAuth();
    if (!auth) throw new Error('SESSION_REQUIRED');
    const transition = ++transitionRef.current;
    const res = await fetch('/api/attendance/event', {
      method: 'POST', headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: eventType, session_id: attendanceRef.current.sessionId }),
    });
    const json = await res.json().catch(() => null);
    if (auth.epoch !== authEpochRef.current || transition !== transitionRef.current || !mountedRef.current) return;
    if (res.status === 401) throw new Error('SESSION_REQUIRED');
    if (!res.ok || !json?.ok || json.state_updated === false) {
      void fetchAttendance();
      throw new Error(json?.error === 'SESSION_CHANGED' ? 'El estado cambió en otra pestaña. Revisa el estado e inténtalo de nuevo.' : 'No se pudo confirmar el estado. Inténtalo de nuevo.');
    }
    applyAttendance(json);
    if (json.worker?.id) {
      try { localStorage.setItem(`tc-panel-state-v1:${json.worker.id}`, JSON.stringify({ at: Date.now(), session: json.session_id, status: json.status })); } catch {}
    }
  }, [applyAttendance, fetchAttendance, getAttendanceAuth]);

  const sendPanelHeartbeat = useCallback(async () => {
    const current = attendanceRef.current;
    if (!current.sessionId || current.status !== 'working') return false;
    if (heartbeatInFlightRef.current) return heartbeatInFlightRef.current;
    const task = (async () => {
      try {
        const auth = await getAttendanceAuth();
        if (!auth) return false;
        const transition = transitionRef.current;
        const res = await fetch('/api/attendance/event', {
          method: 'POST', headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ event_type: 'heartbeat', session_id: current.sessionId,
            activity_at: activityRef.current ? new Date(activityRef.current).toISOString() : null }),
        });
        const json = await res.json().catch(() => null);
        if (auth.epoch !== authEpochRef.current || transition !== transitionRef.current || !mountedRef.current) return false;
        if (!res.ok || !json?.ok) { await fetchAttendance(); return false; }
        applyAttendance(json);
        return !!json.session_id && json.status === 'working';
      } catch {
        // A network failure is not a sign-out. The gate uses the last confirmed
        // server expiry and shows a retry option without replacing Auth tokens.
        return false;
      }
    })();
    heartbeatInFlightRef.current = task;
    try { return await task; }
    finally { if (heartbeatInFlightRef.current === task) heartbeatInFlightRef.current = null; }
  }, [applyAttendance, fetchAttendance, getAttendanceAuth]);

  const keepAttendanceActive = useCallback(async () => {
    const requestedAt = Date.now()+clockOffsetRef.current;
    activityRef.current = requestedAt;
    const current = attendanceRef.current;
    if (current.workerId && current.sessionId) {
      try { localStorage.setItem(`tc-panel-activity-v1:${current.workerId}`, JSON.stringify({ session: current.sessionId, at: activityRef.current })); } catch {}
    }
    if (!await sendPanelHeartbeat()) throw new Error('No se pudo confirmar la actividad.');
    // A poll already in flight may have carried the previous activity value.
    // Send the explicit click after that poll finishes instead of losing it.
    if (Date.parse(attendanceRef.current.lastManualActivityAt || '') < requestedAt-1000) {
      if (!await sendPanelHeartbeat()) throw new Error('No se pudo confirmar la actividad.');
    }
  }, [sendPanelHeartbeat]);

  useEffect(() => {
    if (!isPanelPath(pathname)) return;
    let lastSaved = 0;
    const onActivity = (event: Event) => {
      if (!event.isTrusted || !attendanceRef.current.sessionId || attendanceRef.current.status !== 'working') return;
      const now = Date.now()+clockOffsetRef.current;
      activityRef.current = now;
      if (now-lastSaved < 1000) return;
      lastSaved = now;
      const current = attendanceRef.current;
      try { localStorage.setItem(`tc-panel-activity-v1:${current.workerId}`, JSON.stringify({ session: current.sessionId, at: now })); } catch {}
      if (Date.parse(current.expiresAt || '')-now <= 60_000) void sendPanelHeartbeat();
    };
    const onStorage = (event: StorageEvent) => {
      const current = attendanceRef.current;
      if (!current.workerId) return;
      if (event.key === `tc-panel-state-v1:${current.workerId}`) { void fetchAttendance(); return; }
      if (event.key !== `tc-panel-activity-v1:${current.workerId}` || !event.newValue) return;
      try {
        const item = JSON.parse(event.newValue);
        if (item.session === current.sessionId && typeof item.at === 'number' && item.at <= Date.now()+clockOffsetRef.current+5000) activityRef.current = Math.max(activityRef.current,item.at);
      } catch {}
    };
    // Scroll events can also be emitted by automatic chat scroll/scrollTo.
    // Wheel, keys and pointer interaction cover deliberate user navigation.
    const events = ['pointerdown','pointermove','keydown','input','wheel'];
    for (const event of events) window.addEventListener(event,onActivity,{ passive: true });
    window.addEventListener('storage',onStorage);
    const interval = window.setInterval(() => { void sendPanelHeartbeat(); }, PANEL_HEARTBEAT_MS);
    return () => {
      for (const event of events) window.removeEventListener(event,onActivity);
      window.removeEventListener('storage',onStorage);
      window.clearInterval(interval);
    };
  }, [pathname, sendPanelHeartbeat, fetchAttendance]);

  const fetchPresences = useCallback(async () => {
    if (presencesInFlightRef.current) return;
    presencesInFlightRef.current = true;

    try {
      const token = await getAccessToken();
      if (!mountedRef.current) return;

      if (!token) {
        setPresences({ ...defaultListState<OpsPresenceRow>(), refreshedAt: new Date().toISOString() });
        return;
      }

      setPresences((prev) => ({ ...prev, loading: true, error: null }));

      const res = await fetch(`/api/central/attendance/online?t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);

      if (!mountedRef.current) return;

      if (!res.ok || !json?.ok) {
        setPresences({
          loading: false,
          rows: [],
          error: String(json?.error || `HTTP ${res.status}`),
          refreshedAt: new Date().toISOString(),
        });
        return;
      }

      const rows: OpsPresenceRow[] = (json.rows || []).map((r: any) => {
        const last = r.last_event_at ? String(r.last_event_at) : null;
        return {
          worker_id: String(r.worker_id),
          display_name: String(r.display_name || "—"),
          team_key: r.team_key ? String(r.team_key) : null,
          online: !!r.online,
          status: String(r.status || (r.online ? "working" : "offline")),
          last_event_at: last,
          last_seen_seconds: secondsAgo(last),
        };
      });

      setPresences({ loading: false, rows, error: null, refreshedAt: new Date().toISOString() });
    } catch (e: any) {
      if (!mountedRef.current) return;
      setPresences({
        loading: false,
        rows: [],
        error: String(e?.message || "Error"),
        refreshedAt: new Date().toISOString(),
      });
    } finally {
      presencesInFlightRef.current = false;
    }
  }, []);

  const fetchExpected = useCallback(async () => {
    if (expectedInFlightRef.current) return;
    expectedInFlightRef.current = true;

    try {
      const token = await getAccessToken();
      if (!mountedRef.current) return;

      if (!token) {
        setExpected({ ...defaultListState<OpsExpectedRow>(), refreshedAt: new Date().toISOString() });
        return;
      }

      setExpected((prev) => ({ ...prev, loading: true, error: null }));

      const res = await fetch(`/api/central/attendance/expected?t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);

      if (!mountedRef.current) return;

      if (!res.ok || !json?.ok) {
        setExpected({
          loading: false,
          rows: [],
          error: String(json?.error || `HTTP ${res.status}`),
          refreshedAt: new Date().toISOString(),
        });
        return;
      }

      const rows: OpsExpectedRow[] = (json.rows || json.expected || []).map((r: any) => ({
        worker_id: String(r.worker_id || r.id || ""),
        display_name: String(r.display_name || r.name || "—"),
        start_time: r.start_time ? String(r.start_time) : null,
        end_time: r.end_time ? String(r.end_time) : null,
        timezone: r.timezone ? String(r.timezone) : null,
        schedule_id: r.schedule_id ? String(r.schedule_id) : null,
        online: r.online != null ? !!r.online : undefined,
        status: r.status != null ? String(r.status) : null,
      }));

      setExpected({ loading: false, rows, error: null, refreshedAt: new Date().toISOString() });
    } catch (e: any) {
      if (!mountedRef.current) return;
      setExpected({
        loading: false,
        rows: [],
        error: String(e?.message || "Error"),
        refreshedAt: new Date().toISOString(),
      });
    } finally {
      expectedInFlightRef.current = false;
    }
  }, []);

  const refreshCounters = useCallback(() => {
    void fetchParking();
    void fetchLeads();
  }, [fetchParking, fetchLeads]);

  const refreshAttendance = useCallback(() => fetchAttendance(), [fetchAttendance]);

  const refreshPresences = useCallback(() => {
    void fetchPresences();
  }, [fetchPresences]);

  const refreshExpected = useCallback(() => {
    void fetchExpected();
  }, [fetchExpected]);

  useEffect(() => {
    mountedRef.current = true;

    if (!shouldRunOps) {
      return () => {
        mountedRef.current = false;
      };
    }

    const sb = supabaseBrowser();
    const needsCentralPresence = isCentralPath;
    // Fuente única para cabecera, dock y panel. Antes esas tres superficies
    // consultaban /api/attendance/me de forma independiente.
    const needsOwnAttendance = shouldRunOps;

    // No bloquear el primer render: las lecturas operativas arrancan en background.
    const initialTimer = window.setTimeout(() => {
      refreshCounters();
      if (needsOwnAttendance) refreshAttendance();
      if (needsCentralPresence) {
        refreshPresences();
        refreshExpected();
      }
    }, 1500);

    const leadsChannel = sb
      .channel("tc_ops_captacion_leads")
      .on("postgres_changes", { event: "*", schema: "public", table: "captacion_leads" }, () => void fetchLeads())
      .subscribe();

    const runVisible = (task: () => void) => {
      if (document.visibilityState === "visible") task();
    };
    const parkingInterval = ASTERISK_ENABLED ? window.setInterval(() => runVisible(() => void fetchParking()), PARKING_REFRESH_MS) : null;
    const leadsInterval = window.setInterval(() => runVisible(() => void fetchLeads()), LEADS_REFRESH_MS);
    const attendanceInterval = needsOwnAttendance ? window.setInterval(() => runVisible(() => void fetchAttendance()), ATTENDANCE_REFRESH_MS) : null;
    const presencesInterval = needsCentralPresence ? window.setInterval(() => runVisible(() => void fetchPresences()), PRESENCES_REFRESH_MS) : null;
    const expectedInterval = needsCentralPresence ? window.setInterval(() => runVisible(() => void fetchExpected()), EXPECTED_REFRESH_MS) : null;

    const refreshVisibleOps = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastVisibleRefreshRef.current < 5_000) return;
      lastVisibleRefreshRef.current = now;
      refreshCounters();
      if (needsOwnAttendance) refreshAttendance();
      if (needsCentralPresence) {
        refreshPresences();
        refreshExpected();
      }
    };
    const onFocus = () => refreshVisibleOps();
    const onVisible = () => refreshVisibleOps();
    const onCountersRefresh = () => refreshCounters();
    const onAttendanceRefresh = () => {
      if (needsOwnAttendance) refreshAttendance();
    };
    const onPresencesRefresh = () => {
      if (needsCentralPresence) refreshPresences();
    };
    const onExpectedRefresh = () => {
      if (needsCentralPresence) refreshExpected();
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("tc-counters-refresh", onCountersRefresh as EventListener);
    window.addEventListener("tc-attendance-refresh", onAttendanceRefresh as EventListener);
    window.addEventListener("tc-attendance-changed", onAttendanceRefresh as EventListener);
    window.addEventListener("tc-presences-refresh", onPresencesRefresh as EventListener);
    window.addEventListener("tc-expected-refresh", onExpectedRefresh as EventListener);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      mountedRef.current = false;
      window.clearTimeout(initialTimer);
      if (parkingInterval) window.clearInterval(parkingInterval);
      window.clearInterval(leadsInterval);
      if (attendanceInterval) window.clearInterval(attendanceInterval);
      if (presencesInterval) window.clearInterval(presencesInterval);
      if (expectedInterval) window.clearInterval(expectedInterval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("tc-counters-refresh", onCountersRefresh as EventListener);
      window.removeEventListener("tc-attendance-refresh", onAttendanceRefresh as EventListener);
      window.removeEventListener("tc-attendance-changed", onAttendanceRefresh as EventListener);
      window.removeEventListener("tc-presences-refresh", onPresencesRefresh as EventListener);
      window.removeEventListener("tc-expected-refresh", onExpectedRefresh as EventListener);
      document.removeEventListener("visibilitychange", onVisible);
      sb.removeChannel(leadsChannel);
    };
  }, [
    fetchAttendance,
    fetchExpected,
    fetchLeads,
    fetchParking,
    fetchPresences,
    isCentralPath,
    refreshAttendance,
    refreshCounters,
    refreshExpected,
    refreshPresences,
    shouldRunOps,
  ]);

  const value = useMemo<OpsContextValue>(
    () => ({
      counters,
      attendance,
      presences,
      expected,
      refreshCounters,
      refreshAttendance,
      changeAttendance,
      keepAttendanceActive,
      refreshPresences,
      refreshExpected,
    }),
    [
      attendance,
      counters,
      expected,
      presences,
      refreshAttendance,
      changeAttendance,
      keepAttendanceActive,
      refreshCounters,
      refreshExpected,
      refreshPresences,
    ]
  );

  return <OpsContext.Provider value={value}>{children}</OpsContext.Provider>;
}

export function useOps() {
  const ctx = useContext(OpsContext);

  if (!ctx) {
    throw new Error("useOps debe usarse dentro de <OpsProvider />");
  }

  return ctx;
}
