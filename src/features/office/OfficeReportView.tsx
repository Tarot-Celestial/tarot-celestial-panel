"use client";

import { useEffect, useState } from "react";
import { officeRequest } from "./office-client";
import OfficeMonthlyReport, { type OfficeReportArea } from "./OfficeMonthlyReport";
import OfficeCohortHistory from "./OfficeCohortHistory";
import type { OfficeCohortReport } from "./office-cohorts";

export default function OfficeReportView({ area, month, onMonthChange }: {
  area: OfficeReportArea; month: string; onMonthChange: (value: string) => void;
}) {
  const [generation, refresh] = useState(0);
  const [result, setResult] = useState<{ month: string; generation: number; report?: OfficeCohortReport; error?: string } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    officeRequest<OfficeCohortReport>("/api/admin/office/cohorts?month=" + encodeURIComponent(month), { signal: abort.signal })
      .then(report => { if (!abort.signal.aborted) setResult({ month, generation, report }); })
      .catch(error => { if (!abort.signal.aborted) setResult({ month, generation, error: error instanceof Error ? error.message : "No se pudo leer el mes del CRM." }); });
    return () => abort.abort();
  }, [month, generation]);
  const current = result?.month === month && result.generation === generation ? result : null;
  return <OfficeMonthlyReport area={area} month={month} onMonthChange={onMonthChange} report={current?.report ?? null}
    error={current?.error ?? null} loading={!current} onReload={() => refresh(n => n + 1)}>
    <OfficeCohortHistory key={generation} month={month} onMonthChange={onMonthChange}/>
  </OfficeMonthlyReport>;
}
