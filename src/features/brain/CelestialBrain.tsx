"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type WheelEvent,
} from "react";
import {
  Activity,
  Bot,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  CircleDollarSign,
  CircleHelp,
  Clock3,
  Database,
  FileCode2,
  GitBranch,
  Maximize2,
  Minus,
  Network,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  Workflow,
  Sparkles,
  Users,
  X,
  Zap,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { auditSummary, brainConnections, brainNodes, statusMeta, type BrainNode, type BrainStatus } from "./celestial-brain-data";
import styles from "./CelestialBrain.module.css";

const VIEW_WIDTH = 1680;
const VIEW_HEIGHT = 1080;
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 1.45;
const LIVE_REFRESH_MS = 60_000;

type Probe = {
  name: string;
  ok: boolean;
  count?: number | null;
  latency_ms: number;
  error?: string | null;
};

type LiveNode = {
  id: string;
  status: BrainStatus;
  checked_at: string;
  latency_ms: number;
  healthy_checks: number;
  total_checks: number;
  metrics: string[];
  observations: string[];
  probes: Probe[];
};

type BrainDiagnostic = {
  id: string;
  severity: "attention" | "error";
  title: string;
  summary: string;
  root_node_id: string;
  affected_node_ids: string[];
  chain: string[];
  evidence: string[];
  recommendation: string;
};

type BrainIncident = {
  id: string;
  fingerprint: string;
  source: string;
  severity: "warning" | "error" | "critical";
  subsystem: string;
  route?: string | null;
  code?: string | null;
  title: string;
  message: string;
  affected_node_ids: string[];
  metadata?: Record<string, unknown>;
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at?: string | null;
};

type BrainHealthPayload = {
  ok: boolean;
  generated_at: string;
  duration_ms: number;
  nodes: Record<string, LiveNode>;
  summary: {
    healthy_nodes: number;
    attention_nodes: number;
    error_nodes: number;
    total_nodes: number;
  };
  diagnostics?: BrainDiagnostic[];
  diagnostics_summary?: {
    active: number;
    critical: number;
    attention: number;
    monitored_paths: number;
  };
  observability?: {
    window_hours: number;
    active_window_hours: number;
    incidents: BrainIncident[];
    summary: {
      open: number;
      critical: number;
      errors: number;
      warnings: number;
      occurrences: number;
    };
  };
  runtime?: {
    vercel_env?: string | null;
    deployment?: string | null;
    commit?: string | null;
  };
  error?: string;
};

const nodeIcons: Record<string, typeof Network> = {
  core: Network,
  clients: Users,
  team: ShieldAlert,
  realtime: Activity,
  xp: Sparkles,
  billing: CircleDollarSign,
  infra: Database,
};

const detailContext = {
  stable: { title: "Protecciones activas", observations: "Verificación reciente", icon: ShieldCheck },
  attention: { title: "Punto de atención", observations: "Observaciones recientes", icon: ShieldAlert },
  error: { title: "Fallo detectado", observations: "Errores detectados", icon: ShieldAlert },
  realtime: { title: "Operación en tiempo real", observations: "Estado reciente", icon: Clock3 },
  automation: { title: "Automatización activa", observations: "Ejecuciones recientes", icon: Bot },
  unknown: { title: "Pendiente de auditoría", observations: "Información disponible", icon: CircleHelp },
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatClock(iso?: string | null) {
  if (!iso) return "Sin lectura";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Sin lectura";
  return new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function DetailList({ icon: Icon, title, values }: { icon: typeof Boxes; title: string; values: string[] }) {
  return (
    <section className={styles.detailSection}>
      <div className={styles.detailTitle}><Icon size={15} />{title}</div>
      {values.length ? (
        <ul>{values.map((value) => <li key={value}>{value}</li>)}</ul>
      ) : <p className={styles.empty}>Sin conexiones auditadas.</p>}
    </section>
  );
}

export default function CelestialBrain() {
  const [selectedId, setSelectedId] = useState("core");
  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState(0.76);
  const [offset, setOffset] = useState({ x: 20, y: 18 });
  const [detailOpen, setDetailOpen] = useState(true);
  const [health, setHealth] = useState<BrainHealthPayload | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState("");
  const dragRef = useRef<{ pointerId: number; x: number; y: number; ox: number; oy: number } | null>(null);
  const sb = useMemo(() => supabaseBrowser(), []);

  const loadHealth = useCallback(async (manual = false) => {
    if (manual) setHealthLoading(true);
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token || "";
      if (!token) throw new Error("Sesión de administración no disponible.");

      const response = await fetch(`/api/admin/cerebro/health?t=${Date.now()}`, {
        method: "GET",
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => ({})) as BrainHealthPayload;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "No se pudo leer el pulso del sistema.");

      setHealth(payload);
      setHealthError("");
    } catch (error) {
      setHealthError(error instanceof Error ? error.message : "Error leyendo la salud del sistema.");
    } finally {
      if (manual) setHealthLoading(false);
    }
  }, [sb]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (!active || document.visibilityState !== "visible") return;
      void loadHealth(false);
    };

    void loadHealth(false);
    const timer = window.setInterval(refresh, LIVE_REFRESH_MS);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadHealth]);

  const nodeById = useMemo(() => {
    return brainNodes.map((node) => {
      const live = health?.nodes?.[node.id];
      return live ? { ...node, status: live.status } : node;
    });
  }, [health]);

  const selected = useMemo(
    () => nodeById.find((node) => node.id === selectedId) || nodeById[0],
    [nodeById, selectedId]
  );
  const selectedLive = health?.nodes?.[selected.id] || null;
  const diagnostics = health?.diagnostics || [];
  const incidents = health?.observability?.incidents || [];
  const affectedNodeIds = useMemo(
    () => new Set(diagnostics.flatMap((item) => item.affected_node_ids)),
    [diagnostics]
  );
  const incidentAffectedNodeIds = useMemo(
    () => new Set(incidents.flatMap((item) => item.affected_node_ids || [])),
    [incidents]
  );
  const selectedContext = detailContext[selected.status];
  const ContextIcon = selectedContext.icon;

  const visibleIds = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    if (!normalized) return new Set(nodeById.map((node) => node.id));
    return new Set(
      nodeById
        .filter((node) => `${node.title} ${node.description} ${node.children.join(" ")}`.toLocaleLowerCase("es").includes(normalized))
        .map((node) => node.id)
    );
  }, [nodeById, query]);

  function selectNode(node: BrainNode) {
    setSelectedId(node.id);
    setDetailOpen(true);
  }

  function resetView() {
    setZoom(0.76);
    setOffset({ x: 20, y: 18 });
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button, input, aside")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset({ x: drag.ox + event.clientX - drag.x, y: drag.oy + event.clientY - drag.y });
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey) event.preventDefault();
    setZoom((current) => clamp(current + (event.deltaY > 0 ? -0.07 : 0.07), MIN_ZOOM, MAX_ZOOM));
  }

  const liveSummary = health?.summary;
  const auditItems = [
    ...auditSummary,
    {
      value: liveSummary ? `${liveSummary.healthy_nodes}/${liveSummary.total_nodes}` : "—",
      label: "nodos saludables",
    },
    {
      value: health ? `${health.duration_ms} ms` : "—",
      label: "latencia pulso",
    },
    {
      value: health ? String(health.diagnostics_summary?.active ?? diagnostics.length) : "—",
      label: "diagnósticos activos",
    },
    {
      value: health ? String(health.observability?.summary.open ?? 0) : "—",
      label: "incidentes 24h",
    },
  ];

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <div className={styles.kicker}><Sparkles size={14} /> ARQUITECTURA VIVA · PULSO REAL</div>
          <h1>Cerebro Celestial</h1>
          <p>Mapa auditado con telemetría real de los sistemas críticos. Observa la salud, latencia y conexiones sin ejecutar procesos operativos.</p>
          <div className={styles.liveLine}>
            <span className={`${styles.liveDot} ${healthError ? styles.liveDotError : ""}`} />
            <strong>{healthError ? "Pulso degradado" : health ? "Pulso conectado" : "Conectando pulso…"}</strong>
            <span>{health ? `Última lectura ${formatClock(health.generated_at)}` : healthError}</span>
            <button type="button" onClick={() => void loadHealth(true)} disabled={healthLoading}>
              <RefreshCw size={13} className={healthLoading ? styles.spin : ""} />
              {healthLoading ? "Midiendo…" : "Actualizar ahora"}
            </button>
          </div>
        </div>
        <div className={styles.auditStrip} aria-label="Resumen de la auditoría">
          {auditItems.map((item) => <div key={item.label}><strong>{item.value}</strong><span>{item.label}</span></div>)}
        </div>
      </header>

      {health ? (
        <section className={`${styles.diagnosticPanel} ${diagnostics.length ? styles.diagnosticPanelActive : styles.diagnosticPanelHealthy}`}>
          <div className={styles.diagnosticHeader}>
            <div>
              <span className={styles.diagnosticKicker}><Workflow size={14} /> DIAGNÓSTICO DE DEPENDENCIAS</span>
              <h2>{diagnostics.length ? "El Cerebro detectó rutas que requieren atención" : "Todas las rutas monitorizadas responden"}</h2>
              <p>
                {diagnostics.length
                  ? "Relacionamos la conexión que falla con los sistemas que puede afectar para evitar corregir síntomas aislados."
                  : `${health.diagnostics_summary?.monitored_paths ?? 0} cadenas críticas monitorizadas sin incidencias activas.`}
              </p>
            </div>
            <div className={styles.diagnosticCounter}>
              <strong>{health.diagnostics_summary?.critical ?? 0}</strong>
              <span>críticos</span>
              <strong>{health.diagnostics_summary?.attention ?? 0}</strong>
              <span>atención</span>
            </div>
          </div>

          {diagnostics.length ? (
            <div className={styles.diagnosticGrid}>
              {diagnostics.map((diagnostic) => (
                <button
                  type="button"
                  key={diagnostic.id}
                  className={`${styles.diagnosticCard} ${diagnostic.severity === "error" ? styles.diagnosticError : styles.diagnosticAttention}`}
                  onClick={() => {
                    setSelectedId(diagnostic.root_node_id);
                    setDetailOpen(true);
                  }}
                >
                  <span className={styles.diagnosticCardIcon}><TriangleAlert size={17} /></span>
                  <span className={styles.diagnosticCardBody}>
                    <strong>{diagnostic.title}</strong>
                    <small>{diagnostic.summary}</small>
                    <span className={styles.diagnosticChain}>{diagnostic.chain.join(" → ")}</span>
                  </span>
                  <span className={styles.diagnosticCardMeta}>{diagnostic.affected_node_ids.length} nodos</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {health?.observability ? (
        <section className={`${styles.incidentPanel} ${incidents.length ? styles.incidentPanelActive : styles.incidentPanelHealthy}`}>
          <div className={styles.incidentHeader}>
            <div>
              <span className={styles.incidentKicker}><Activity size={14} /> INCIDENTES DE PRODUCCIÓN · 24H</span>
              <h2>{incidents.length ? "Errores reales correlacionados con el mapa" : "Sin incidentes abiertos en la ventana reciente"}</h2>
              <p>
                El Cerebro agrupa errores repetidos por huella, conserva la primera y última aparición y los relaciona con los nodos afectados.
              </p>
            </div>
            <div className={styles.incidentStats}>
              <div><strong>{health.observability.summary.critical}</strong><span>críticos</span></div>
              <div><strong>{health.observability.summary.errors}</strong><span>errores</span></div>
              <div><strong>{health.observability.summary.warnings}</strong><span>avisos</span></div>
              <div><strong>{health.observability.summary.occurrences}</strong><span>ocurrencias</span></div>
            </div>
          </div>

          {incidents.length ? (
            <div className={styles.incidentGrid}>
              {incidents.slice(0, 8).map((incident) => (
                <button
                  type="button"
                  key={incident.id}
                  className={`${styles.incidentCard} ${incident.severity === "critical" ? styles.incidentCritical : incident.severity === "error" ? styles.incidentError : styles.incidentWarning}`}
                  onClick={() => {
                    const firstNode = incident.affected_node_ids?.[0] || "core";
                    setSelectedId(firstNode);
                    setDetailOpen(true);
                  }}
                >
                  <span className={styles.incidentTopline}>
                    <b>{incident.severity === "critical" ? "CRÍTICO" : incident.severity === "error" ? "ERROR" : "AVISO"}</b>
                    <small>{incident.occurrences}× · {formatClock(incident.last_seen_at)}</small>
                  </span>
                  <strong>{incident.title}</strong>
                  <span className={styles.incidentMessage}>{incident.message}</span>
                  <span className={styles.incidentRoute}>{incident.route || incident.subsystem}{incident.code ? ` · ${incident.code}` : ""}</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className={styles.workspace}>
        <div className={styles.toolbar}>
          <label className={styles.search}>
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar sistema o conexión" />
          </label>
          <div className={styles.toolGroup}>
            <button type="button" onClick={() => setZoom((value) => clamp(value - 0.1, MIN_ZOOM, MAX_ZOOM))} aria-label="Alejar"><Minus size={17} /></button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => setZoom((value) => clamp(value + 0.1, MIN_ZOOM, MAX_ZOOM))} aria-label="Acercar"><Plus size={17} /></button>
            <button type="button" onClick={resetView} aria-label="Centrar mapa"><RotateCcw size={17} /></button>
            <button type="button" onClick={() => setDetailOpen((value) => !value)} aria-label="Mostrar detalle"><Maximize2 size={17} /></button>
          </div>
        </div>

        <div
          className={styles.viewport}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={onWheel}
        >
          <div
            className={styles.canvas}
            style={{ width: VIEW_WIDTH, height: VIEW_HEIGHT, transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
          >
            <svg className={styles.connections} viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} aria-hidden="true">
              <defs>
                <linearGradient id="brain-line" x1="0" x2="1">
                  <stop offset="0" stopColor="#7650c8" />
                  <stop offset="0.5" stopColor="#e7bd62" />
                  <stop offset="1" stopColor="#4bc7e8" />
                </linearGradient>
              </defs>
              {brainConnections.map((connection) => {
                const from = nodeById.find((node) => node.id === connection.from)!;
                const to = nodeById.find((node) => node.id === connection.to)!;
                const x1 = from.position.x + 130;
                const y1 = from.position.y + 70;
                const x2 = to.position.x + 130;
                const y2 = to.position.y + 70;
                const mid = (x1 + x2) / 2;
                const impacted = affectedNodeIds.has(connection.from) && affectedNodeIds.has(connection.to);
                return <path className={impacted ? styles.impactedConnection : undefined} key={connection.to} d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`} />;
              })}
            </svg>

            {nodeById.map((node) => {
              const Icon = nodeIcons[node.id] || Boxes;
              const meta = statusMeta[node.status];
              const hidden = !visibleIds.has(node.id);
              const live = health?.nodes?.[node.id];
              return (
                <button
                  type="button"
                  key={node.id}
                  className={`${styles.node} ${node.id === "core" ? styles.coreNode : ""} ${selectedId === node.id ? styles.selectedNode : ""} ${affectedNodeIds.has(node.id) ? styles.impactedNode : ""} ${incidentAffectedNodeIds.has(node.id) ? styles.incidentImpactedNode : ""} ${hidden ? styles.filteredNode : ""}`}
                  style={{ left: node.position.x, top: node.position.y, "--status": meta.color } as CSSProperties}
                  onClick={() => selectNode(node)}
                  aria-pressed={selectedId === node.id}
                >
                  <span className={styles.nodeGlow} />
                  <span className={styles.nodeTop}><span className={styles.nodeIcon}><Icon size={22} /></span><span className={styles.statusDot} /></span>
                  <span className={styles.nodeEyebrow}>{node.eyebrow}</span>
                  <strong>{node.title}</strong>
                  <span className={styles.nodeStatus}>{meta.label}</span>
                  <span className={styles.childCount}>
                    {live ? `${live.healthy_checks}/${live.total_checks} conexiones · ${live.latency_ms} ms` : `${node.children.length} conexiones`}
                  </span>
                </button>
              );
            })}
          </div>

          <div className={styles.legend}>
            {Object.entries(statusMeta).map(([key, meta]) => <span key={key}><i style={{ background: meta.color }} />{meta.label}</span>)}
          </div>

          {detailOpen ? (
            <aside className={styles.detailPanel} aria-label={`Detalle de ${selected.title}`}>
              <button type="button" className={styles.closeDetail} onClick={() => setDetailOpen(false)} aria-label="Cerrar detalle"><X size={17} /></button>
              <div className={styles.detailHeader}>
                <span className={styles.detailIcon} style={{ "--status": statusMeta[selected.status].color } as CSSProperties}>{(() => { const Icon = nodeIcons[selected.id] || Boxes; return <Icon size={24} />; })()}</span>
                <div><span>{selected.eyebrow}</span><h2>{selected.title}</h2></div>
              </div>
              <div className={styles.detailStatus}><i style={{ background: statusMeta[selected.status].color }} />{statusMeta[selected.status].label}<b>{selected.importance}</b></div>
              <p className={styles.description}>{selected.description}</p>

              {selectedLive ? (
                <section className={styles.liveTelemetry}>
                  <div className={styles.liveTelemetryHead}>
                    <span><Activity size={14} /> Pulso real</span>
                    <b>{selectedLive.latency_ms} ms</b>
                  </div>
                  <div className={styles.liveMetrics}>
                    <div><strong>{selectedLive.healthy_checks}/{selectedLive.total_checks}</strong><span>conexiones sanas</span></div>
                    <div><strong>{formatClock(selectedLive.checked_at)}</strong><span>última lectura</span></div>
                  </div>
                  {selectedLive.metrics.length ? (
                    <div className={styles.metricChips}>
                      {selectedLive.metrics.map((metric) => <span key={metric}>{metric}</span>)}
                    </div>
                  ) : null}
                  <div className={styles.probeGrid}>
                    {selectedLive.probes.map((probe) => (
                      <div key={probe.name} className={probe.ok ? styles.probeOk : styles.probeError}>
                        <span>{probe.name}</span>
                        <b>{probe.ok ? "OK" : "ERROR"}</b>
                        <small>{probe.latency_ms} ms{typeof probe.count === "number" ? ` · ~${probe.count} filas` : ""}</small>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {incidents.filter((item) => item.affected_node_ids?.includes(selected.id)).map((incident) => (
                <section key={incident.id} className={`${styles.nodeIncident} ${incident.severity === "critical" ? styles.nodeIncidentCritical : incident.severity === "error" ? styles.nodeIncidentError : styles.nodeIncidentWarning}`}>
                  <div className={styles.nodeIncidentTitle}><Activity size={15} /><strong>{incident.title}</strong><span>{incident.occurrences}×</span></div>
                  <p>{incident.message}</p>
                  <small>{incident.route || incident.subsystem}{incident.code ? ` · ${incident.code}` : ""}</small>
                  <small>Primera: {formatClock(incident.first_seen_at)} · Última: {formatClock(incident.last_seen_at)}</small>
                </section>
              ))}

              {diagnostics.filter((item) => item.affected_node_ids.includes(selected.id)).map((diagnostic) => (
                <section key={diagnostic.id} className={`${styles.nodeDiagnostic} ${diagnostic.severity === "error" ? styles.nodeDiagnosticError : styles.nodeDiagnosticAttention}`}>
                  <div className={styles.nodeDiagnosticTitle}><TriangleAlert size={15} /><strong>{diagnostic.title}</strong></div>
                  <p>{diagnostic.summary}</p>
                  <div className={styles.nodeDiagnosticChain}>{diagnostic.chain.join(" → ")}</div>
                  {diagnostic.evidence.map((evidence) => <small key={evidence}>{evidence}</small>)}
                  <b>Acción sugerida</b>
                  <p>{diagnostic.recommendation}</p>
                </section>
              ))}

              <div className={styles.chips}>{selected.children.map((child) => <span key={child}>{child}</span>)}</div>
              <DetailList icon={Boxes} title="Componentes" values={selected.components} />
              <DetailList icon={Zap} title="APIs y procesos" values={selected.apis} />
              <DetailList icon={Database} title="Tablas y servicios" values={selected.data} />
              <DetailList icon={Activity} title="Tiempo real" values={selected.realtime} />
              <DetailList icon={ArrowDownToLine} title="Entradas" values={selected.inputs} />
              <DetailList icon={ArrowUpFromLine} title="Salidas" values={selected.outputs} />
              <DetailList icon={GitBranch} title="Rutas de código" values={selected.sources} />

              <section className={styles.impactBox} style={{ "--status": statusMeta[selected.status].color } as CSSProperties}>
                <ContextIcon size={17} />
                <div><strong>{selectedContext.title}</strong><p>{selected.impact}</p></div>
              </section>
              <section className={styles.errors} style={{ "--status": statusMeta[selected.status].color } as CSSProperties}>
                <strong>{selectedContext.observations}</strong>
                {(selectedLive?.observations?.length ? selectedLive.observations : selected.recentErrors).map((error) => <p key={error}>{error}</p>)}
              </section>
              <footer className={styles.detailFooter}>
                <FileCode2 size={14} />
                {selectedLive ? `Pulso ${formatClock(selectedLive.checked_at)}` : selected.lastChecked}
              </footer>
            </aside>
          ) : null}
        </div>
      </section>
    </main>
  );
}
