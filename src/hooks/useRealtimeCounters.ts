"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

export function useRealtimeCounters() {
  const [parking, setParking] = useState(0);
  const [leads, setLeads] = useState(0);

  useEffect(() => {
    const sb = supabaseBrowser();

    // 🔥 LEADS (SOLO NUEVOS)
    async function fetchLeads() {
      const { count } = await sb
        .from("captacion_leads")
        .select("*", { count: "exact", head: true })
        .eq("estado", "nuevo"); // 🔥 FIX

      setLeads(count || 0);
    }

    // 🔴 REALTIME LEADS
    const leadsChannel = sb
      .channel("captacion_leads_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "captacion_leads" },
        () => {
          fetchLeads();
        }
      )
      .subscribe();

    // 🅿️ PARKING (API)
    async function fetchParking() {
      try {
        const res = await fetch("/api/asterisk/parking", {
          cache: "no-store",
        });
        const json = await res.json();

        const calls = Array.isArray(json?.calls) ? json.calls : [];
        setParking(calls.length);
      } catch {
        setParking(0);
      }
    }

    // ⏱ REFRESH
    const interval = setInterval(() => {
      fetchParking();
      fetchLeads();
    }, 3000);

    // Primera carga
    fetchParking();
    fetchLeads();

    return () => {
      sb.removeChannel(leadsChannel);
      clearInterval(interval);
    };
  }, []);

  return { parking, leads };
}
