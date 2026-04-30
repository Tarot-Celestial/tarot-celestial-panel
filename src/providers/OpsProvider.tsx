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

export type OpsCounters = {
  parking: number;
  leads: number;
  chatUnread: number;
};

export type OpsAttendance = {
  loading: boolean;
  online: boolean;
  status: string;
  error: string | null;
  refreshedAt: string | null;
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
  refreshAttendance: () => void;
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
  error: null,
  refreshedAt: null,
};

function defaultListState<T>(): OpsListState<T> {
  return {
    loading: false,
    rows: [],
    error: null,
    refreshedAt: null,
  };
}

const PARKING_REFRESH_MS = 2500;
const LEADS_REFRESH_MS = 8000;
const ATTENDANCE_REFRESH_MS = 15000;
const PRESENCES_REFRESH_MS = 20000;
const EXPECTED_REFRESH_MS = 30000;

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
  const [counters, setCounters] = useState<OpsCounters>(DEFAULT_COUNTERS);
  const [attendance, setAttendance] = useState<OpsAttendance>(DEFAULT_ATTENDANCE);
  const [presences, setPresences] = useState<OpsListState<OpsPresenceRow>>(() => defaultListState<OpsPresenceRow>());
  const [expected, setExpected] = useState<OpsListState<OpsExpectedRow>>(() => defaultListState<OpsExpectedRow>());

  const mountedRef = useRef(false);
  const parkingInFlightRef = useRef(false);
  const leadsInFlightRef = useRef(false);
  const attendanceInFlightRef = useRef(false);
  const presencesInFlightRef = useRef(false);
  const expectedInFlightRef = useRef(false);

  const fetchParking = useCallback(async () => {
    if (parkingInFlightRef.current) return;
    parkingInFlightRef.current = true;

    try {
      const res = await fetch(`/api/asterisk/parking?t=${Date.now()}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      const calls = Array.isArray(json?.calls) ? json.calls : [];

      if (!mountedRef.current) return;
      setCounters((prev) => (prev.parking === calls.length ? prev : { ...prev, parking: calls.length }));
    } catch {
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
    attendanceInFlightRef.current = true;

    try {
      const token = await getAccessToken();
      if (!mountedRef.current) return;

      if (!token) {
        setAttendance({ ...DEFAULT_ATTENDANCE, refreshedAt: new Date().toISOString() });
        return;
      }

      setAttendance((prev) => ({ ...prev, loading: true, error: null }));

      const res = await fetch(`/api/attendance/me?t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);

      if (!mountedRef.current) return;

      if (!res.ok || !json?.ok) {
        setAttendance({
          loading: false,
          online: false,
          status: "offline",
          error: String(json?.error || `HTTP ${res.status}`),
          refreshedAt: new Date().toISOString(),
        });
        return;
      }

      setAttendance({
        loading: false,
        online: !!json.online,
        status: String(json.status || (json.online ? "working" : "offline")),
        error: null,
        refreshedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      if (!mountedRef.current) return;
      setAttendance({
        loading: false,
        online: false,
        status: "offline",
        error: String(e?.message || "Error"),
        refreshedAt: new Date().toISOString(),
      });
    } finally {
      attendanceInFlightRef.current = false;
    }
  }, []);

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

  const refreshAttendance = useCallback(() => {
    void fetchAttendance();
  }, [fetchAttendance]);

  const refreshPresences = useCallback(() => {
    void fetchPresences();
  }, [fetchPresences]);

  const refreshExpected = useCallback(() => {
    void fetchExpected();
  }, [fetchExpected]);

  useEffect(() => {
    mountedRef.current = true;
    const sb = supabaseBrowser();

    refreshCounters();
    refreshAttendance();
    refreshPresences();
    refreshExpected();

    const leadsChannel = sb
      .channel("tc_ops_captacion_leads")
      .on("postgres_changes", { event: "*", schema: "public", table: "captacion_leads" }, () => void fetchLeads())
      .subscribe();

    const parkingInterval = window.setInterval(() => void fetchParking(), PARKING_REFRESH_MS);
    const leadsInterval = window.setInterval(() => void fetchLeads(), LEADS_REFRESH_MS);
    const attendanceInterval = window.setInterval(() => void fetchAttendance(), ATTENDANCE_REFRESH_MS);
    const presencesInterval = window.setInterval(() => void fetchPresences(), PRESENCES_REFRESH_MS);
    const expectedInterval = window.setInterval(() => void fetchExpected(), EXPECTED_REFRESH_MS);

    const onFocus = () => {
      refreshCounters();
      refreshAttendance();
      refreshPresences();
      refreshExpected();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        refreshCounters();
        refreshAttendance();
        refreshPresences();
        refreshExpected();
      }
    };
    const onCountersRefresh = () => refreshCounters();
    const onAttendanceRefresh = () => refreshAttendance();
    const onPresencesRefresh = () => refreshPresences();
    const onExpectedRefresh = () => refreshExpected();

    window.addEventListener("focus", onFocus);
    window.addEventListener("tc-counters-refresh", onCountersRefresh as EventListener);
    window.addEventListener("tc-attendance-refresh", onAttendanceRefresh as EventListener);
    window.addEventListener("tc-presences-refresh", onPresencesRefresh as EventListener);
    window.addEventListener("tc-expected-refresh", onExpectedRefresh as EventListener);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      mountedRef.current = false;
      window.clearInterval(parkingInterval);
      window.clearInterval(leadsInterval);
      window.clearInterval(attendanceInterval);
      window.clearInterval(presencesInterval);
      window.clearInterval(expectedInterval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("tc-counters-refresh", onCountersRefresh as EventListener);
      window.removeEventListener("tc-attendance-refresh", onAttendanceRefresh as EventListener);
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
    refreshAttendance,
    refreshCounters,
    refreshExpected,
    refreshPresences,
  ]);

  const value = useMemo<OpsContextValue>(
    () => ({
      counters,
      attendance,
      presences,
      expected,
      refreshCounters,
      refreshAttendance,
      refreshPresences,
      refreshExpected,
    }),
    [
      attendance,
      counters,
      expected,
      presences,
      refreshAttendance,
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
