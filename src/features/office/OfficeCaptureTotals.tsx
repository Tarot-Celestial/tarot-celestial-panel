"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { officeRequest } from "./office-client";
import type { OfficeCaptureTotals as Totals } from "./office-clients";
import s from "./OfficeCaptureTotals.module.css";

const format = new Intl.NumberFormat("es-ES");

export default function OfficeCaptureTotals() {
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    officeRequest<Totals>("/api/admin/office/clients/capture-totals", { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setTotals(value); })
      .catch(() => { if (!controller.signal.aborted) setError("No se pudo actualizar el resumen de captación."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);

  return <section className={s.summary} aria-label="Resumen histórico de captación">
    <div className={s.header}>
      <h3>Captación desde el primer registro del CRM</h3>
      <button type="button" disabled={loading} onClick={() => setRefresh(n => n + 1)}>
        <RefreshCw size={14} aria-hidden="true" />{loading ? "Consultando…" : "Actualizar resumen"}
      </button>
    </div>
    {error && <p role="alert">{error}{totals && " Se muestran las últimas cifras consultadas."}</p>}
    {totals && <dl className={s.figures}>
      <div><dt>Fichas de Tarot Celestial</dt><dd>{format.format(totals.total_clients)}</dd></div>
      <div><dt>Captados con primera compra</dt><dd>{format.format(totals.captured_clients)}</dd></div>
      <div><dt>Pendientes de primera compra</dt><dd>{format.format(totals.total_clients - totals.captured_clients)}</dd></div>
    </dl>}
  </section>;
}
