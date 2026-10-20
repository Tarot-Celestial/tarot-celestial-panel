export type InvoiceAttendanceAdjustment = {
  kind: "recovery" | "justification";
  date: string;
  minutes: number;
  reason: string;
  recordedBy: string;
  recordedAt: string;
};

export type InvoiceAttendanceIncident = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  missedMinutes: number;
  recoveredMinutes: number;
  justifiedMinutes: number;
  pendingMinutes: number;
  status: string;
  reason: string;
  notes: string;
  recordedBy: string;
  recordedAt: string;
  adjustments: InvoiceAttendanceAdjustment[];
};

export type InvoiceAttendanceReport = {
  month: string;
  generatedAt: string;
  totals: { missedMinutes: number; recoveredMinutes: number; justifiedMinutes: number; pendingMinutes: number };
  incidents: InvoiceAttendanceIncident[];
  effectNote: string;
  warnings: string[];
};
