"use client";

import { useOps } from "@/hooks/useOps";

export function useAttendance() {
  const { attendance, refreshAttendance } = useOps();
  return { ...attendance, refreshAttendance };
}
