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

export type OpsContextValue = {
  counters: OpsCounters;
  attendance: OpsAttendance;
  refreshCounters: () => void;
  refreshAttendance: () => void;
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

const PARKING_REFRESH_MS = 2500;
const LEADS_REFRESH_MS = 8000;
const ATTENDANCE_REFRESH_MS = 15000;

const OpsContext = createContext<OpsContextValue | null>(null);

async function getAccessToken() {
  const sb = supabaseBrowser();
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || null;
}

export function OpsProvider({ children }: { children: ReactNode }) {
  const [counters, setCounters] = useState<OpsCounters>(DEFAULT_COUNTERS);
  const [attendance, setAttendance] = useState<OpsAttendance>(DEFAULT_ATTENDANCE);

  const mountedRef = useRef(false);
  const parkingInFlightRef = useRef(false);
  const leadsInFlightRef = useRef(false);
  const attendanceInFlightRef = useRef(false);

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

  const refreshCounters = useCallback(() => {
    void fetchParking();
    void fetchLeads();
  }, [fetchParking, fetchLeads]);

  const refreshAttendance = useCallback(() => {
    void fetchAttendance();
  }, [fetchAttendance]);

  useEffect(() => {
    mountedRef.current = true;
    const sb = supabaseBrowser();

    refreshCounters();
    refreshAttendance();

    const leadsChannel = sb
      .channel("tc_ops_captacion_leads")
      .on("postgres_changes", { event: "*", schema: "public", table: "captacion_leads" }, () => void fetchLeads())
      .subscribe();

    const parkingInterval = window.setInterval(() => void fetchParking(), PARKING_REFRESH_MS);
    const leadsInterval = window.setInterval(() => void fetchLeads(), LEADS_REFRESH_MS);
    const attendanceInterval = window.setInterval(() => void fetchAttendance(), ATTENDANCE_REFRESH_MS);

    const onFocus = () => {
      refreshCounters();
      refreshAttendance();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        refreshCounters();
        refreshAttendance();
      }
    };
    const onCountersRefresh = () => refreshCounters();
    const onAttendanceRefresh = () => refreshAttendance();

    window.addEventListener("focus", onFocus);
    window.addEventListener("tc-counters-refresh", onCountersRefresh as EventListener);
    window.addEventListener("tc-attendance-refresh", onAttendanceRefresh as EventListener);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      mountedRef.current = false;
      window.clearInterval(parkingInterval);
      window.clearInterval(leadsInterval);
      window.clearInterval(attendanceInterval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("tc-counters-refresh", onCountersRefresh as EventListener);
      window.removeEventListener("tc-attendance-refresh", onAttendanceRefresh as EventListener);
      document.removeEventListener("visibilitychange", onVisible);
      sb.removeChannel(leadsChannel);
    };
  }, [fetchAttendance, fetchLeads, fetchParking, refreshAttendance, refreshCounters]);

  const value = useMemo<OpsContextValue>(
    () => ({ counters, attendance, refreshCounters, refreshAttendance }),
    [attendance, counters, refreshAttendance, refreshCounters]
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
