export type RitualPhase = { name?: string; from?: number; to?: number; message?: string; advice?: string; asset_url?: string | null; index?: number };
export type RitualType = { id: string; nombre: string; slug: string; descripcion?: string; icono?: string; duracion_default_dias?: number; activo?: boolean; fases: RitualPhase[] };
export type ClientRitual = {
  id: string; cliente_id: string; ritual_type_id: string; nombre_personalizado?: string | null;
  estado: string; modo: string; fecha_inicio: string; fecha_fin_prevista?: string | null; fecha_fin_real?: string | null;
  progreso_manual?: number; fase_manual?: number | null; override_automatico: boolean;
  mensaje_actual?: string | null; consejo_actual?: string | null; created_at: string; updated_at: string;
  ritual_types: RitualType | null;
};
export const ritualStatus: Record<string, string> = { pendiente: "Pendiente", activo: "En proceso", pausado: "Pausado", completado: "Completado", cancelado: "Cancelado" };
export const ritualModes: Record<string, string> = { automatico: "Automático", manual: "Manual", hibrido: "Híbrido" };
export const isOpenRitual = (status: string) => ["pendiente", "activo", "pausado"].includes(status);

/** Shared by both APIs: one calculation for the client and the administrator. */
export function computeRitual<T extends ClientRitual>(row: T, now = Date.now()) {
  let progress = Number(row.progreso_manual || 0);
  if (row.modo !== "manual" && !row.override_automatico && row.estado === "activo" && row.fecha_inicio && row.fecha_fin_prevista) {
    const start = Date.parse(row.fecha_inicio), end = Date.parse(row.fecha_fin_prevista);
    if (end > start) progress = ((now - start) / (end - start)) * 100;
  }
  progress = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;
  if (row.estado === "completado") progress = 100;
  const phases = Array.isArray(row.ritual_types?.fases) ? row.ritual_types.fases : [];
  const manual = row.override_automatico ? row.fase_manual : null;
  let index = Math.max(0, phases.findIndex(p => progress >= Number(p.from || 0) && progress <= Number(p.to ?? 100)));
  if (Number.isInteger(manual) && manual! >= 0 && phases[manual!]) index = manual!;
  if (row.estado === "completado") index = Math.max(0, phases.length - 1);
  const phase = { ...(phases[index] || {}), index };
  return { ...row, progress: Number(progress.toFixed(1)), phase,
    message: row.mensaje_actual || phase.message || "Tu ritual continúa avanzando.",
    advice: row.consejo_actual || phase.advice || "Reserva un momento tranquilo para ti." };
}
export type ComputedRitual = ReturnType<typeof computeRitual>;
