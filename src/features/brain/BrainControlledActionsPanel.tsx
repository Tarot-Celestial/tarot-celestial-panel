"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Check,
  Clock3,
  Database,
  Lock,
  Play,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  brainControlledActionCatalogue,
  type BrainControlledActionKey,
  type BrainControlledActionRisk,
  type BrainControlledActionStatus,
} from "./brain-controlled-actions";
import styles from "./BrainControlledActionsPanel.module.css";

type ControlledAction = {
  id: string;
  request_id: string;
  action_key: BrainControlledActionKey;
  status: BrainControlledActionStatus;
  risk_level: BrainControlledActionRisk;
  title: string;
  target_node_id?: string | null;
  incident_id?: string | null;
  diagnostic_id?: string | null;
  input?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string | null;
  approved_at?: string | null;
  approval_expires_at?: string | null;
  execution_started_at?: string | null;
  executed_at?: string | null;
  cancelled_at?: string | null;
  created_at: string;
};

type RecoveringIncident = {
  id: string;
  title: string;
  severity: "warning" | "error" | "critical";
  subsystem: string;
  route?: string | null;
  code?: string | null;
  occurrences: number;
  last_seen_at: string;
  status: "recovering";
  affected_node_ids: string[];
};

type LatestSnapshot = {
  generated_at: string;
  duration_ms: number;
  healthy_nodes: number;
  attention_nodes: number;
  error_nodes: number;
  total_nodes: number;
  details?: {
    forecast_score?: number;
    forecast_level?: string;
  };
};

type ActionsPayload = {
  ok: boolean;
  actions?: ControlledAction[];
  recovering_incidents?: RecoveringIncident[];
  latest_snapshot?: LatestSnapshot | null;
  approval_ttl_minutes?: number;
  safety?: {
    business_mutations_enabled?: boolean;
    external_deployments_enabled?: boolean;
    destructive_actions_enabled?: boolean;
    mode?: string;
  };
  error?: string;
};

const statusLabel: Record<BrainControlledActionStatus, string> = {
  proposed: "Propuesta",
  approved: "Aprobada",
  executing: "Ejecutando",
  succeeded: "Completada",
  failed: "Fallida",
  cancelled: "Cancelada",
};

const riskLabel: Record<BrainControlledActionRisk, string> = {
  low: "Riesgo bajo",
  medium: "Riesgo medio",
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function explainError(error: string) {
  const known: Record<string, string> = {
    CEREBRO_ACTIONS_STORAGE_MISSING: "Falta aplicar el SQL de la Fase 5 antes de activar las operaciones controladas.",
    ACTION_NOT_ALLOWED: "Esta acción no pertenece a la lista segura del Cerebro.",
    ACTION_NOT_PROPOSED: "La acción ya cambió de estado y no puede aprobarse desde aquí.",
    ACTION_NOT_APPROVED: "La acción todavía no tiene una aprobación válida.",
    ACTION_CANNOT_BE_CANCELLED: "Esta acción ya no puede cancelarse.",
    ACTION_STATE_CHANGED: "El estado cambió durante la operación. Actualiza el panel.",
    APPROVAL_EXPIRED: "La aprobación caducó. Crea una nueva propuesta para ejecutarla.",
    INCIDENT_NOT_RECOVERING: "El incidente ya no está en recuperación; el Cerebro bloqueó el cierre.",
    INCIDENT_STATE_CHANGED: "El incidente cambió de estado antes de cerrarse.",
  };
  return known[error] || error || "No se pudo completar la operación.";
}

export default function BrainControlledActionsPanel() {
  const [payload, setPayload] = useState<ActionsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const sb = useMemo(() => supabaseBrowser(), []);

  const request = useCallback(async (method: "GET" | "POST", body?: Record<string, unknown>) => {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token || "";
    if (!token) throw new Error("Sesión de administración no disponible.");

    const response = await fetch("/api/admin/cerebro/actions", {
      method,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      body: method === "POST" ? JSON.stringify(body || {}) : undefined,
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json?.ok) throw new Error(String(json?.error || "CEREBRO_ACTION_ERROR"));
    return json;
  }, [sb]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const json = await request("GET") as ActionsPayload;
      setPayload(json);
      setError("");
    } catch (loadError) {
      setError(explainError(loadError instanceof Error ? loadError.message : "CEREBRO_ACTION_ERROR"));
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void load();
  }, [load]);

  const operate = useCallback(async (key: string, body: Record<string, unknown>) => {
    try {
      setBusyId(key);
      setError("");
      await request("POST", body);
      await load();
    } catch (operationError) {
      setError(explainError(operationError instanceof Error ? operationError.message : "CEREBRO_ACTION_ERROR"));
    } finally {
      setBusyId("");
    }
  }, [load, request]);

  async function propose(actionKey: BrainControlledActionKey, incident?: RecoveringIncident) {
    let reason = "";
    if (actionKey === "resolve_recovered_incident") {
      reason = window.prompt("Motivo del cierre manual. El incidente debe seguir en RECUPERANDO:", "Recuperación verificada desde Cerebro Celestial")?.trim() || "";
      if (!reason) return;
    }

    await operate(`propose:${actionKey}:${incident?.id || "global"}`, {
      operation: "propose",
      action_key: actionKey,
      incident_id: incident?.id || null,
      target_node_id: incident?.affected_node_ids?.[0] || null,
      reason,
      request_id: crypto.randomUUID(),
    });
  }

  async function approve(action: ControlledAction) {
    const accepted = window.confirm(`Aprobar “${action.title}”? La aprobación caducará en ${payload?.approval_ttl_minutes || 15} minutos.`);
    if (!accepted) return;
    await operate(`approve:${action.id}`, { operation: "approve", action_id: action.id });
  }

  async function execute(action: ControlledAction) {
    const accepted = window.confirm(
      `Ejecutar “${action.title}” ahora?\n\nEsta Fase 5 solo permite acciones de lectura u observabilidad; no modifica CRM, pagos, XP ni despliegues.`
    );
    if (!accepted) return;
    await operate(`execute:${action.id}`, { operation: "execute", action_id: action.id });
  }

  async function cancel(action: ControlledAction) {
    await operate(`cancel:${action.id}`, { operation: "cancel", action_id: action.id });
  }

  const actions = payload?.actions || [];
  const recovering = payload?.recovering_incidents || [];
  const snapshot = payload?.latest_snapshot || null;
  const activeActions = actions.filter((item) => ["proposed", "approved", "executing"].includes(item.status)).length;

  return (
    <section className={styles.section} aria-label="Operaciones controladas del Cerebro Celestial">
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <span className={styles.kicker}><Lock size={14} /> FASE 5 · OPERACIONES CONTROLADAS</span>
            <h2>Acciones seguras con aprobación explícita</h2>
            <p>
              El Cerebro ya puede preparar y ejecutar una lista mínima de acciones internas. Cada operación queda registrada,
              requiere aprobación y el servidor vuelve a validar el estado antes de ejecutarla.
            </p>
          </div>
          <div className={styles.headerStats}>
            <div><strong>{activeActions}</strong><span>activas</span></div>
            <div><strong>{recovering.length}</strong><span>recuperando</span></div>
            <div><strong>{snapshot?.details?.forecast_score ?? "—"}</strong><span>riesgo</span></div>
            <button type="button" onClick={() => void load()} disabled={loading} aria-label="Actualizar operaciones">
              <RefreshCw size={15} className={loading ? styles.spin : ""} />
            </button>
          </div>
        </header>

        <div className={styles.safetyStrip}>
          <span><ShieldCheck size={15} /> Sin mutaciones de negocio</span>
          <span><Database size={15} /> Sin cambios de esquema automáticos</span>
          <span><Activity size={15} /> Solo observabilidad y sondeos</span>
          <span><Lock size={15} /> Aprobación con caducidad</span>
        </div>

        {error ? <div className={styles.errorBox}><TriangleAlert size={16} />{error}</div> : null}

        <div className={styles.catalogueGrid}>
          {brainControlledActionCatalogue
            .filter((spec) => !spec.requiresIncident)
            .map((spec) => (
              <article key={spec.key} className={styles.catalogueCard}>
                <div className={styles.cardTop}>
                  <span className={spec.risk === "medium" ? styles.riskMedium : styles.riskLow}>{riskLabel[spec.risk]}</span>
                  <span className={styles.scope}>{spec.scope === "read_only" ? "SOLO LECTURA" : "OBSERVABILIDAD"}</span>
                </div>
                <h3>{spec.title}</h3>
                <p>{spec.summary}</p>
                <small>{spec.safety}</small>
                <button
                  type="button"
                  onClick={() => void propose(spec.key)}
                  disabled={Boolean(busyId) || loading}
                >
                  <ShieldCheck size={15} /> Preparar acción
                </button>
              </article>
            ))}
        </div>

        <section className={styles.recoveryBlock}>
          <div className={styles.subHeader}>
            <div>
              <span><Clock3 size={14} /> CIERRE MANUAL PROTEGIDO</span>
              <h3>Incidentes ya recuperados</h3>
            </div>
            <small>Solo pueden proponerse cierres cuando producción ya está en estado RECUPERANDO.</small>
          </div>

          {recovering.length ? (
            <div className={styles.recoveryGrid}>
              {recovering.map((incident) => (
                <article key={incident.id} className={styles.recoveryCard}>
                  <div><strong>{incident.title}</strong><span>{incident.subsystem}{incident.route ? ` · ${incident.route}` : ""}</span></div>
                  <small>{incident.occurrences} ocurrencia(s) · última {formatDate(incident.last_seen_at)}</small>
                  <button
                    type="button"
                    onClick={() => void propose("resolve_recovered_incident", incident)}
                    disabled={Boolean(busyId)}
                  >
                    <Check size={14} /> Preparar cierre
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>No hay incidentes en recuperación que puedan cerrarse manualmente.</div>
          )}
        </section>

        <section className={styles.queueBlock}>
          <div className={styles.subHeader}>
            <div>
              <span><ShieldCheck size={14} /> COLA DE APROBACIÓN</span>
              <h3>Auditoría de acciones</h3>
            </div>
            <small>Propuesta → aprobación → ejecución. Ningún botón salta pasos.</small>
          </div>

          {loading && !payload ? (
            <div className={styles.emptyState}>Cargando operaciones del Cerebro…</div>
          ) : actions.length ? (
            <div className={styles.actionList}>
              {actions.slice(0, 16).map((action) => (
                <article key={action.id} className={styles.actionRow} data-status={action.status}>
                  <div className={styles.actionMain}>
                    <span className={styles.statusBadge}>{statusLabel[action.status]}</span>
                    <strong>{action.title}</strong>
                    <small>
                      {riskLabel[action.risk_level]} · creada {formatDate(action.created_at)}
                      {action.approval_expires_at ? ` · aprobación vence ${formatDate(action.approval_expires_at)}` : ""}
                    </small>
                    {action.error ? <em>{explainError(action.error)}</em> : null}
                  </div>
                  <div className={styles.actionButtons}>
                    {action.status === "proposed" ? (
                      <>
                        <button type="button" onClick={() => void approve(action)} disabled={Boolean(busyId)}><Check size={14} /> Aprobar</button>
                        <button type="button" className={styles.cancelButton} onClick={() => void cancel(action)} disabled={Boolean(busyId)}><X size={14} /> Cancelar</button>
                      </>
                    ) : null}
                    {action.status === "approved" ? (
                      <>
                        <button type="button" className={styles.executeButton} onClick={() => void execute(action)} disabled={Boolean(busyId)}><Play size={14} /> Ejecutar</button>
                        <button type="button" className={styles.cancelButton} onClick={() => void cancel(action)} disabled={Boolean(busyId)}><X size={14} /> Cancelar</button>
                      </>
                    ) : null}
                    {action.status === "executing" ? <span className={styles.executing}><RefreshCw size={14} className={styles.spin} /> Ejecutando</span> : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>Todavía no hay acciones controladas registradas.</div>
          )}
        </section>
      </div>
    </section>
  );
}
