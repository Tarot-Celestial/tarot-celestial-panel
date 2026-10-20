import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvoiceAttendanceAdjustment, InvoiceAttendanceIncident, InvoiceAttendanceReport } from "@/lib/invoice-attendance";
import { normalizeMonthKey } from "@/lib/month-key";

const PAGE_SIZE = 500;
const INCIDENT_FIELDS = "id,worker_id,invoice_month,incident_date,missed_start,missed_end,missed_minutes,recovered_minutes,justified_minutes,pending_minutes,status,reason_code,reason_detail,notes,created_by_name,created_at";

async function allRows(query: () => any): Promise<any[]> {
  const rows: any[] = [];
  const seen = new Set<string>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await query().range(offset, offset + PAGE_SIZE - 1);
    if (result.error) throw new Error("No se pudo cargar el registro de horas. Vuelve a descargar la factura.");
    if (!Array.isArray(result.data)) throw new Error("El registro de horas no está disponible.");
    for (const row of result.data) {
      if (!row.id || seen.has(String(row.id))) throw new Error("El registro de horas ha cambiado. Vuelve a descargar la factura.");
      seen.add(String(row.id));
    }
    rows.push(...result.data);
    if (result.data.length < PAGE_SIZE) return rows;
  }
}

function minutes(value: unknown): number {
  const number = Number(value);
  const numeric = typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value.trim()));
  if (!numeric || !Number.isSafeInteger(number) || number < 0) throw new Error("Hay un registro de horas incompleto. Revisa las incidencias antes de descargar.");
  return number;
}

// Compare the saved local intervals only to flag overlap, never to rewrite totals.
function hasOverlappingIntervals(incidents: InvoiceAttendanceIncident[]) {
  const intervals = incidents.map(incident => {
    const day = Date.parse(`${incident.date}T00:00:00Z`);
    const startParts = incident.startTime.split(":").map(Number);
    const endParts = incident.endTime.split(":").map(Number);
    const start = day + (startParts[0] * 60 + startParts[1]) * 60000;
    let end = day + (endParts[0] * 60 + endParts[1]) * 60000;
    if (end <= start) end += 86400000;
    return { start, end };
  }).filter(interval => Number.isFinite(interval.start) && Number.isFinite(interval.end)).sort((a, b) => a.start - b.start);
  let previousEnd = -Infinity;
  for (const interval of intervals) {
    if (interval.start < previousEnd) return true;
    previousEnd = Math.max(previousEnd, interval.end);
  }
  return false;
}

export async function loadInvoiceAttendance(db: SupabaseClient, workerId: string, rawMonth: string): Promise<InvoiceAttendanceReport | null> {
  const month = normalizeMonthKey(rawMonth);
  if (!workerId) throw new Error("Falta la persona de la factura.");
  const settings = await db.from("attendance_incident_settings").select("show_in_invoice").eq("id", 1).maybeSingle();
  if (settings.error) throw new Error("No se pudo comprobar la configuración del registro de horas.");
  if (settings.data?.show_in_invoice === false) return null;

  const rows = await allRows(() => db.from("v_attendance_incidents").select(INCIDENT_FIELDS)
    .eq("worker_id", workerId).eq("invoice_month", month).order("incident_date").order("created_at").order("id"));
  const recoveries: any[] = [], justifications: any[] = [];
  // Read all adjustments of these incidents, including resolutions made in a later month.
  for (let index = 0; index < rows.length; index += 200) {
    const ids = rows.slice(index, index + 200).map(row => row.id);
    const [recoveryRows, justificationRows] = await Promise.all([
      allRows(() => db.from("attendance_incident_recoveries").select("id,incident_id,recovery_date,start_time,end_time,recovered_minutes,notes,created_by,created_at").in("incident_id", ids).order("created_at").order("id")),
      allRows(() => db.from("attendance_incident_justifications").select("id,incident_id,justified_minutes,reason,created_by,created_at").in("incident_id", ids).order("created_at").order("id")),
    ]);
    recoveries.push(...recoveryRows);
    justifications.push(...justificationRows);
  }
  const actors = new Map<string, string>();
  const actorIds = Array.from(new Set([...recoveries, ...justifications].map(row => row.created_by).filter(Boolean)));
  for (let index = 0; index < actorIds.length; index += 200) {
    const people = await allRows(() => db.from("workers").select("id,display_name").in("id", actorIds.slice(index, index + 200)).order("id"));
    for (const person of people) actors.set(person.id, person.display_name || "Sin responsable registrado");
  }

  const incidents: InvoiceAttendanceIncident[] = rows.map(row => {
    const adjustments: InvoiceAttendanceAdjustment[] = [
      ...recoveries.filter(item => item.incident_id === row.id).map(item => ({
        kind: "recovery" as const, date: String(item.recovery_date || ""), minutes: minutes(item.recovered_minutes),
        reason: [item.start_time && item.end_time ? `${String(item.start_time).slice(0, 5)} - ${String(item.end_time).slice(0, 5)}` : "", item.notes].filter(Boolean).join(" · "),
        recordedBy: actors.get(item.created_by) || "Sin responsable registrado", recordedAt: String(item.created_at || ""),
      })),
      ...justifications.filter(item => item.incident_id === row.id).map(item => ({
        kind: "justification" as const, date: "", minutes: minutes(item.justified_minutes), reason: String(item.reason || ""),
        recordedBy: actors.get(item.created_by) || "Sin responsable registrado", recordedAt: String(item.created_at || ""),
      })),
    ].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    const incident = {
      id: String(row.id), date: String(row.incident_date), startTime: String(row.missed_start || "").slice(0, 5), endTime: String(row.missed_end || "").slice(0, 5),
      missedMinutes: minutes(row.missed_minutes), recoveredMinutes: minutes(row.recovered_minutes), justifiedMinutes: minutes(row.justified_minutes), pendingMinutes: minutes(row.pending_minutes),
      status: String(row.status), reason: [row.reason_code, row.reason_detail].filter(Boolean).join(" · "), notes: String(row.notes || ""),
      recordedBy: String(row.created_by_name || "Sin responsable registrado"), recordedAt: String(row.created_at || ""), adjustments,
    };
    // An adjustment arriving during the reads must not produce a contradictory PDF.
    const recovered = adjustments.filter(item => item.kind === "recovery").reduce((sum, item) => sum + item.minutes, 0);
    const justified = adjustments.filter(item => item.kind === "justification").reduce((sum, item) => sum + item.minutes, 0);
    if (recovered !== incident.recoveredMinutes || justified !== incident.justifiedMinutes) throw new Error("El registro de horas ha cambiado. Vuelve a descargar la factura para obtener el detalle actualizado.");
    return incident;
  });
  const warnings: string[] = [];
  if (hasOverlappingIntervals(incidents)) warnings.push("Hay registros con horarios solapados. Los totales suman los registros guardados; revisa los solapamientos antes de tomar decisiones.");
  if (incidents.some(incident => incident.recoveredMinutes + incident.justifiedMinutes > incident.missedMinutes || incident.pendingMinutes !== Math.max(0, incident.missedMinutes - incident.recoveredMinutes - incident.justifiedMinutes))) {
    warnings.push("Hay incidencias cuyos minutos recuperados, justificados o pendientes no cuadran con los minutos registrados. Revisa sus ajustes antes de tomar decisiones.");
  }
  return {
    month, generatedAt: new Date().toISOString(), incidents,
    totals: incidents.reduce((sum, row) => ({ missedMinutes: sum.missedMinutes + row.missedMinutes, recoveredMinutes: sum.recoveredMinutes + row.recoveredMinutes, justifiedMinutes: sum.justifiedMinutes + row.justifiedMinutes, pendingMinutes: sum.pendingMinutes + row.pendingMinutes }), { missedMinutes: 0, recoveredMinutes: 0, justifiedMinutes: 0, pendingMinutes: 0 }),
    effectNote: "Las horas no trabajadas quedan registradas para el seguimiento de la jornada. Las pendientes de recuperar o justificar requieren revisión. El importe recoge los conceptos económicos desglosados en esta factura; este registro no añade descuentos automáticos.",
    warnings,
  };
}
