"use client";

import { useOps } from "@/hooks/useOps";

export type RealtimeCounters = {
  parking: number;
  leads: number;
};

export function useRealtimeCounters(): RealtimeCounters {
  const { counters } = useOps();

  return {
    parking: counters.parking,
    leads: counters.leads,
  };
}
