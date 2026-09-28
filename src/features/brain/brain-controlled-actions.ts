export type BrainControlledActionRisk = "low" | "medium";
export type BrainControlledActionStatus =
  | "proposed"
  | "approved"
  | "executing"
  | "succeeded"
  | "failed"
  | "cancelled";

export type BrainControlledActionKey =
  | "probe_core_services"
  | "refresh_incident_lifecycle"
  | "resolve_recovered_incident";

export type BrainControlledActionSpec = {
  key: BrainControlledActionKey;
  title: string;
  summary: string;
  risk: BrainControlledActionRisk;
  scope: "read_only" | "observability_only";
  requiresIncident?: boolean;
  requiresReason?: boolean;
  safety: string;
};

export const BRAIN_ACTION_APPROVAL_TTL_MINUTES = 15;

export const brainControlledActionCatalogue: BrainControlledActionSpec[] = [
  {
    key: "probe_core_services",
    title: "Sondear servicios base",
    summary: "Comprueba PostgREST y Auth con lecturas ligeras, sin modificar datos operativos.",
    risk: "low",
    scope: "read_only",
    safety: "Solo lectura. No toca CRM, XP, pagos, reservas ni configuraciones.",
  },
  {
    key: "refresh_incident_lifecycle",
    title: "Actualizar ciclo de incidentes",
    summary: "Ejecuta la lógica existente de recuperación y resolución automática de observabilidad.",
    risk: "low",
    scope: "observability_only",
    safety: "Solo cambia estados internos del Cerebro; no modifica datos de negocio.",
  },
  {
    key: "resolve_recovered_incident",
    title: "Cerrar incidente recuperado",
    summary: "Permite cerrar manualmente un incidente únicamente si ya está en estado de recuperación.",
    risk: "medium",
    scope: "observability_only",
    requiresIncident: true,
    requiresReason: true,
    safety: "El servidor bloquea el cierre si el incidente sigue abierto. Requiere motivo y aprobación explícita.",
  },
];

export function getBrainControlledActionSpec(value: string) {
  return brainControlledActionCatalogue.find((item) => item.key === value) || null;
}
