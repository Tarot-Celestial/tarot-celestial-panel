"use client";

import { Activity, ShieldAlert, Sparkles } from "lucide-react";
import styles from "./BrainPreventivePanel.module.css";

type RiskLevel = "low" | "elevated" | "high" | "critical";

type Signal = {
  id: string;
  title: string;
  detail: string;
  score: number;
  level: RiskLevel;
  affected_node_ids: string[];
  evidence: string[];
  recommendation: string;
};

export type BrainForecast = {
  score: number;
  level: RiskLevel;
  confidence: "low" | "medium" | "high";
  title: string;
  summary: string;
  watch_node_ids: string[];
  signals: Signal[];
  recommendations: string[];
  baseline: {
    snapshots_used: number;
    median_duration_ms: number | null;
    median_degraded_nodes: number | null;
  };
};

export default function BrainPreventivePanel({
  prevention,
  onSelectNode,
}: {
  prevention?: BrainForecast | null;
  onSelectNode?: (nodeId: string) => void;
}) {
  if (!prevention) return null;

  const levelLabel =
    prevention.level === "critical" ? "CRÍTICO" :
    prevention.level === "high" ? "ALTO" :
    prevention.level === "elevated" ? "ELEVADO" : "BAJO";

  return (
    <section className={`${styles.panel} ${styles[prevention.level]}`}>
      <div className={styles.header}>
        <div>
          <span className={styles.kicker}><Sparkles size={14} /> PREVENCIÓN PREDICTIVA</span>
          <h2>{prevention.title}</h2>
          <p>{prevention.summary}</p>
        </div>
        <div className={styles.score}>
          <span>{levelLabel}</span>
          <strong>{prevention.score}</strong>
          <small>/100 · confianza {prevention.confidence}</small>
        </div>
      </div>

      <div className={styles.baseline}>
        <div><strong>{prevention.baseline.snapshots_used}</strong><span>snapshots base</span></div>
        <div><strong>{prevention.baseline.median_duration_ms ?? "—"}{prevention.baseline.median_duration_ms != null ? " ms" : ""}</strong><span>latencia mediana</span></div>
        <div><strong>{prevention.baseline.median_degraded_nodes ?? "—"}</strong><span>nodos degradados base</span></div>
        <div><strong>{prevention.signals.length}</strong><span>señales tempranas</span></div>
      </div>

      {prevention.signals.length ? (
        <div className={styles.signals}>
          {prevention.signals.slice(0, 6).map((signal) => (
            <button
              type="button"
              key={signal.id}
              className={`${styles.signal} ${styles[signal.level]}`}
              onClick={() => onSelectNode?.(signal.affected_node_ids?.[0] || "core")}
            >
              <span className={styles.signalIcon}>
                {signal.level === "critical" || signal.level === "high" ? <ShieldAlert size={16} /> : <Activity size={16} />}
              </span>
              <span className={styles.signalBody}>
                <span className={styles.signalTop}><b>{signal.title}</b><em>{signal.score}/100</em></span>
                <span>{signal.detail}</span>
                <small>{signal.evidence.join(" · ")}</small>
                <i>{signal.recommendation}</i>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className={styles.clear}>
          <Activity size={16} />
          <span>Sin señales de aceleración, reincidencia o regresión suficientes para anticipar un fallo.</span>
        </div>
      )}
    </section>
  );
}
