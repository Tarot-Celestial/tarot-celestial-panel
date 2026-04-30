"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

export type OpsCounters = {
  parking: number;
  leads: number;
  chatUnread: number;
};

export type OpsContextValue = {
  counters: OpsCounters;
};

const DEFAULT_COUNTERS: OpsCounters = {
  parking: 0,
  leads: 0,
  chatUnread: 0,
};

const OpsContext = createContext<OpsContextValue | null>(null);

export function OpsProvider({ children }: { children: ReactNode }) {
  // Base segura para centralizar estado operativo en siguientes pasos.
  // De momento NO sustituye useRealtimeCounters ni toca lógica de llamadas/chat.
  const value = useMemo<OpsContextValue>(
    () => ({
      counters: DEFAULT_COUNTERS,
    }),
    []
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
