"use client";

import { useMemo, useRef, useState, type CSSProperties, type PointerEvent, type WheelEvent } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  CircleDollarSign,
  Database,
  FileCode2,
  GitBranch,
  Maximize2,
  Minus,
  Network,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  Users,
  X,
  Zap,
} from "lucide-react";
import { auditSummary, brainConnections, brainNodes, statusMeta, type BrainNode } from "./celestial-brain-data";
import styles from "./CelestialBrain.module.css";

const VIEW_WIDTH = 1680;
const VIEW_HEIGHT = 1080;
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 1.45;

const nodeIcons: Record<string, typeof Network> = {
  core: Network,
  clients: Users,
  team: ShieldAlert,
  realtime: Activity,
  xp: Sparkles,
  billing: CircleDollarSign,
  infra: Database,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
  const dragRef = useRef<{ pointerId: number; x: number; y: number; ox: number; oy: number } | null>(null);

  const selected = useMemo(
    () => brainNodes.find((node) => node.id === selectedId) || brainNodes[0],
    [selectedId]
  );
  const visibleIds = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    if (!normalized) return new Set(brainNodes.map((node) => node.id));
    return new Set(
      brainNodes
        .filter((node) => `${node.title} ${node.description} ${node.children.join(" ")}`.toLocaleLowerCase("es").includes(normalized))
        .map((node) => node.id)
    );
  }, [query]);

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

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <div className={styles.kicker}><Sparkles size={14} /> ARQUITECTURA VIVA · SOLO LECTURA</div>
          <h1>Cerebro Celestial</h1>
          <p>Mapa auditado de conexiones, dependencias y puntos de atención. La vista no ejecuta procesos ni consulta tablas.</p>
        </div>
        <div className={styles.auditStrip} aria-label="Resumen de la auditoría">
          {auditSummary.map((item) => <div key={item.label}><strong>{item.value}</strong><span>{item.label}</span></div>)}
        </div>
      </header>

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
                const from = brainNodes.find((node) => node.id === connection.from)!;
                const to = brainNodes.find((node) => node.id === connection.to)!;
                const x1 = from.position.x + 130;
                const y1 = from.position.y + 70;
                const x2 = to.position.x + 130;
                const y2 = to.position.y + 70;
                const mid = (x1 + x2) / 2;
                return <path key={connection.to} d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`} />;
              })}
            </svg>

            {brainNodes.map((node) => {
              const Icon = nodeIcons[node.id] || Boxes;
              const meta = statusMeta[node.status];
              const hidden = !visibleIds.has(node.id);
              return (
                <button
                  type="button"
                  key={node.id}
                  className={`${styles.node} ${node.id === "core" ? styles.coreNode : ""} ${selectedId === node.id ? styles.selectedNode : ""} ${hidden ? styles.filteredNode : ""}`}
                  style={{ left: node.position.x, top: node.position.y, "--status": meta.color } as CSSProperties}
                  onClick={() => selectNode(node)}
                  aria-pressed={selectedId === node.id}
                >
                  <span className={styles.nodeGlow} />
                  <span className={styles.nodeTop}><span className={styles.nodeIcon}><Icon size={22} /></span><span className={styles.statusDot} /></span>
                  <span className={styles.nodeEyebrow}>{node.eyebrow}</span>
                  <strong>{node.title}</strong>
                  <span className={styles.nodeStatus}>{meta.label}</span>
                  <span className={styles.childCount}>{node.children.length} conexiones</span>
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

              <div className={styles.chips}>{selected.children.map((child) => <span key={child}>{child}</span>)}</div>
              <DetailList icon={Boxes} title="Componentes" values={selected.components} />
              <DetailList icon={Zap} title="APIs y procesos" values={selected.apis} />
              <DetailList icon={Database} title="Tablas y servicios" values={selected.data} />
              <DetailList icon={Activity} title="Tiempo real" values={selected.realtime} />
              <DetailList icon={ArrowDownToLine} title="Entradas" values={selected.inputs} />
              <DetailList icon={ArrowUpFromLine} title="Salidas" values={selected.outputs} />
              <DetailList icon={GitBranch} title="Rutas de código" values={selected.sources} />

              <section className={styles.impactBox}><ShieldAlert size={17} /><div><strong>Si falla</strong><p>{selected.impact}</p></div></section>
              <section className={styles.errors}><strong>Observaciones recientes</strong>{selected.recentErrors.map((error) => <p key={error}>{error}</p>)}</section>
              <footer className={styles.detailFooter}><FileCode2 size={14} />{selected.lastChecked}</footer>
            </aside>
          ) : null}
        </div>
      </section>
    </main>
  );
}
