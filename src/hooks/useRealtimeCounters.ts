"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

export function useRealtimeCounters() {
  const [parking, setParking] = useState(0);
  const [leads, setLeads] = useState(0);

  useEffect(() => {
    const sb = supabaseBrowser();

    // 🅿️ PARKING
    const parkingChannel = sb
      .channel("parking")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "parked_calls" },
        (payload) => {
          console.log("parking update", payload);
          fetchCounts();
        }
      )
      .subscribe();

    // 🔥 LEADS
    const leadsChannel = sb
      .channel("leads")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads" },
        (payload) => {
          console.log("leads update", payload);
          fetchCounts();
        }
      )
      .subscribe();

    async function fetchCounts() {
      const { count: p } = await sb
        .from("parked_calls")
        .select("*", { count: "exact", head: true });

      const { count: l } = await sb
        .from("leads")
        .select("*", { count: "exact", head: true });

      setParking(p || 0);
      setLeads(l || 0);
    }

    fetchCounts();

    return () => {
      sb.removeChannel(parkingChannel);
      sb.removeChannel(leadsChannel);
    };
  }, []);

  return { parking, leads };
}
