"use client";

import { useOps } from "@/hooks/useOps";

export function useCounters() {
  const { counters, refreshCounters } = useOps();
  return { ...counters, refreshCounters };
}
