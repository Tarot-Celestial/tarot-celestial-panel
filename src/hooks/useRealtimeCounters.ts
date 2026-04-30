"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

type RealtimeCounters = {
  parking: number;
  leads: number;
};

const PARKING_REFRESH_MS = 2500;
const LEADS_REFRESH_MS = 8000;

export function useRealtimeCounters(): RealtimeCounters {
  const [parking, setParking] = useState(0);
  const [leads, setLeads] = useState(0);
  const parkingInFlightRef = useRef(false);
  const leadsInFlightRef = useRef(false);
  const mountedRef = useRef(false);

  const fetchLeads = useCallback(async () => {
    if (leadsInFlightRef.current) return;
    leadsInFlightRef.current = true;

    try {
      const sb = supabaseBrowser();
      const { count, error } = await sb
        .from("captacion_leads")
        .select("*", { count: "exact", head: true })
        .eq("estado", "nuevo");

      if (!mountedRef.current) return;
      if (!error) setLeads(count || 0);
    } finally {
      leadsInFlightRef.current = false;
    }
  }, []);

  const fetchParking = useCallback(async () => {
    if (parkingInFlightRef.current) return;
    parkingInFlightRef.current = true;

    try {
      const res = await fetch(`/api/asterisk/parking?t=${Date.now()}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      const calls = Array.isArray(json?.calls) ? json.calls : [];

      if (!mountedRef.current) return;
      setParking(calls.length);
    } catch {
      if (mountedRef.current) setParking(0);
    } finally {
      parkingInFlightRef.current = false;
    }
  }, []);

  const refreshAll = useCallback(() => {
    void fetchParking();
    void fetchLeads();
  }, [fetchParking, fetchLeads]);

  useEffect(() => {
    mountedRef.current = true;
    const sb = supabaseBrowser();

    refreshAll();

    const leadsChannel = sb
      .channel("tc_counters_captacion_leads")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "captacion_leads" },
        () => void fetchLeads()
      )
      .subscribe();

    const parkingInterval = window.setInterval(() => void fetchParking(), PARKING_REFRESH_MS);
    const leadsInterval = window.setInterval(() => void fetchLeads(), LEADS_REFRESH_MS);

    const onFocus = () => refreshAll();
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshAll();
    };
    const onManualRefresh = () => refreshAll();

    window.addEventListener("focus", onFocus);
    window.addEventListener("tc-counters-refresh", onManualRefresh as EventListener);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      mountedRef.current = false;
      window.clearInterval(parkingInterval);
      window.clearInterval(leadsInterval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("tc-counters-refresh", onManualRefresh as EventListener);
      document.removeEventListener("visibilitychange", onVisible);
      sb.removeChannel(leadsChannel);
    };
  }, [fetchLeads, fetchParking, refreshAll]);

  return { parking, leads };
}
