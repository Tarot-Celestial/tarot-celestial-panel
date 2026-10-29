"use client";

import { useOps } from "@/hooks/useOps";

export function useAttendance() {
  const { attendance, refreshAttendance, changeAttendance, keepAttendanceActive } = useOps();
  return { ...attendance, refreshAttendance, changeAttendance, keepAttendanceActive };
}
