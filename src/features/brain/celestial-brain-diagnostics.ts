export type BrainDiagnosticSeverity = "attention" | "error";

export type BrainDiagnosticProbe = {
  name: string;
  ok: boolean;
  latency_ms?: number;
  error?: string | null;
};

export type BrainDiagnosticNode = {
  id: string;
  status?: string;
  probes?: BrainDiagnosticProbe[];
};

export type BrainDiagnostic = {
  id: string;
  severity: BrainDiagnosticSeverity;
  title: string;
  summary: string;
  root_node_id: string;
  affected_node_ids: string[];
  chain: string[];
  evidence: string[];
  recommendation: string;
};

type ImpactRule = {
  id: string;
  title: string;
  summary: string;
  rootNodeId: string;
  probeNames: string[];
  affectedNodeIds: string[];
  chain: string[];
  recommendation: string;
  severity: BrainDiagnosticSeverity;
};

export const brainImpactRules: ImpactRule[] = [
  {
    id: "infra-postgrest",
    title: "Capa de datos degradada",
    summary: "La conexión común con Supabase/PostgREST está fallando y puede impactar simultáneamente CRM, reservas, facturación, XP, presencia y accesos.",
    rootNodeId: "infra",
    probeNames: ["Supabase PostgREST"],
    affectedNodeIds: ["infra", "core", "clients", "realtime", "billing", "xp", "team"],
    chain: ["Supabase PostgREST", "APIs y datos compartidos", "Cerebro Celestial", "Panel Admin / Central / Tarotista / Cliente"],
    recommendation: "Prioriza la capa de datos antes de depurar pantallas individuales: revisa disponibilidad, conexiones, errores de PostgREST y consultas lentas.",
    severity: "error",
  },
  {
    id: "infra-auth",
    title: "Autenticación degradada",
    summary: "Supabase Auth no responde correctamente. El acceso y la identidad de los paneles pueden quedar afectados aunque la base de datos siga disponible.",
    rootNodeId: "infra",
    probeNames: ["Supabase Auth"],
    affectedNodeIds: ["infra", "core", "team"],
    chain: ["Supabase Auth", "Equipo y accesos", "Resolución de rol", "Paneles protegidos"],
    recommendation: "Revisa Auth antes de tocar permisos de UI. Confirma sesiones, roles y disponibilidad del servicio de autenticación.",
    severity: "error",
  },
  {
    id: "infra-vercel",
    title: "Runtime de aplicación degradado",
    summary: "El runtime que sirve APIs y páginas no está disponible como espera el sistema.",
    rootNodeId: "infra",
    probeNames: ["Vercel Runtime"],
    affectedNodeIds: ["infra", "core"],
    chain: ["Vercel Runtime", "APIs / Server Components", "Cerebro Celestial", "Paneles web"],
    recommendation: "Revisa el despliegue activo y los errores de runtime antes de buscar fallos de datos o de interfaz.",
    severity: "error",
  },
  {
    id: "reservas-flow",
    title: "Cadena de reservas afectada",
    summary: "La reserva no puede atravesar con garantías el recorrido completo entre base de datos, CRM, avisos en tiempo real y paneles.",
    rootNodeId: "clients",
    probeNames: ["reservas"],
    affectedNodeIds: ["clients", "realtime", "core"],
    chain: ["Supabase · reservas", "Clientes y CRM", "Operación en tiempo real", "Central / Panel Cliente"],
    recommendation: "Comprueba primero la tabla reservas y después la entrega de avisos antes de depurar el componente visual de reservas.",
    severity: "attention",
  },
  {
    id: "crm-flow",
    title: "Cadena CRM afectada",
    summary: "Existe una degradación en fichas, seguimiento, captación o perfiles vinculados al cliente.",
    rootNodeId: "clients",
    probeNames: ["crm_clientes", "crm_client_followups", "crm_client_capture_assignments", "central_public_profiles", "cliente_tarotista_reviews"],
    affectedNodeIds: ["clients", "core"],
    chain: ["Supabase · CRM", "Clientes y CRM", "Captación / Seguimientos / Fichas", "Admin / Central / Cliente"],
    recommendation: "Localiza la tabla concreta que falla y valida su relación con la ficha antes de crear lógica alternativa.",
    severity: "attention",
  },
  {
    id: "operations-flow",
    title: "Operación en tiempo real afectada",
    summary: "Presencia, asistencia, notificaciones, leads o chat presentan una conexión degradada.",
    rootNodeId: "realtime",
    probeNames: ["attendance_state", "attendance_events", "central_notifications", "captacion_leads", "chat_messages", "workers", "worker_schedules"],
    affectedNodeIds: ["realtime", "team", "core"],
    chain: ["Presencia / eventos operativos", "Operación en tiempo real", "Equipo y accesos", "Paneles internos"],
    recommendation: "Aísla primero si el fallo está en presencia, asistencia, notificaciones o mensajería; no dupliques suscripciones para compensarlo.",
    severity: "attention",
  },
  {
    id: "billing-flow",
    title: "Facturación y producción afectadas",
    summary: "Un fallo en pagos, facturas, contabilidad o rendimiento puede alterar cierres, diarios y señales de XP relacionadas con compras.",
    rootNodeId: "billing",
    probeNames: ["invoices", "invoice_lines", "manual_invoices", "crm_cliente_pagos", "accounting_entries", "rendimiento_llamadas"],
    affectedNodeIds: ["billing", "xp", "core"],
    chain: ["Pagos / Rendimiento", "Facturación", "Eventos derivados de compra", "XP / Panel Admin"],
    recommendation: "Verifica el registro fuente del cobro o rendimiento antes de recalcular facturas, diario o XP.",
    severity: "attention",
  },
  {
    id: "xp-flow",
    title: "Progresión y recompensas afectadas",
    summary: "El sistema de experiencia, niveles, misiones, recompensas o Coins tiene una conexión degradada.",
    rootNodeId: "xp",
    probeNames: ["worker_xp_events", "worker_xp_rules", "worker_xp_level_config", "worker_xp_missions", "worker_xp_reward_claims", "worker_coin_wallets", "worker_xp_coin_conversions"],
    affectedNodeIds: ["xp", "core"],
    chain: ["Eventos XP", "Reglas / niveles / misiones", "Recompensas / Coins", "Central / Admin"],
    recommendation: "Mantén worker_xp_events como historial real y corrige la conexión concreta antes de introducir cálculos paralelos.",
    severity: "attention",
  },
];

export const BRAIN_MONITORED_PATHS_COUNT = brainImpactRules.length;

function collectFailedProbes(nodes: Record<string, BrainDiagnosticNode>) {
  const failed: Array<{ nodeId: string; probe: BrainDiagnosticProbe }> = [];

  Object.values(nodes).forEach((node) => {
    (node.probes || []).forEach((probe) => {
      if (!probe.ok) failed.push({ nodeId: node.id, probe });
    });
  });

  return failed;
}

function evidenceFor(
  failed: Array<{ nodeId: string; probe: BrainDiagnosticProbe }>,
  names: string[]
) {
  const accepted = new Set(names);
  const unique = new Map<string, string>();

  failed.forEach(({ nodeId, probe }) => {
    if (!accepted.has(probe.name)) return;
    const key = `${nodeId}:${probe.name}`;
    const latency = typeof probe.latency_ms === "number" ? ` · ${probe.latency_ms} ms` : "";
    unique.set(key, `${probe.name} · ${nodeId}${latency}${probe.error ? ` · ${probe.error}` : ""}`);
  });

  return Array.from(unique.values());
}

export function buildBrainDiagnostics(nodes: Record<string, BrainDiagnosticNode>): BrainDiagnostic[] {
  const failed = collectFailedProbes(nodes);
  if (!failed.length) return [];

  const postgrestDown = failed.some(({ probe }) => probe.name === "Supabase PostgREST");
  const diagnostics: BrainDiagnostic[] = [];

  for (const rule of brainImpactRules) {
    if (postgrestDown && !["infra-postgrest", "infra-auth", "infra-vercel"].includes(rule.id)) {
      continue;
    }

    const evidence = evidenceFor(failed, rule.probeNames);
    if (!evidence.length) continue;

    const impactedStatuses = rule.affectedNodeIds
      .map((nodeId) => nodes[nodeId]?.status)
      .filter(Boolean);

    const severity: BrainDiagnosticSeverity =
      rule.severity === "error" || impactedStatuses.includes("error") ? "error" : "attention";

    diagnostics.push({
      id: rule.id,
      severity,
      title: rule.title,
      summary: rule.summary,
      root_node_id: rule.rootNodeId,
      affected_node_ids: rule.affectedNodeIds,
      chain: rule.chain,
      evidence,
      recommendation: rule.recommendation,
    });
  }

  return diagnostics.sort((a, b) => {
    if (a.severity === b.severity) return a.title.localeCompare(b.title, "es");
    return a.severity === "error" ? -1 : 1;
  });
}
