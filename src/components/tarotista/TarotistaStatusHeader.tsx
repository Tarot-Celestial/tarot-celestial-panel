"use client";

import { CalendarDays, Check, ChevronDown, CirclePause, LogOut, RefreshCw, Sparkles } from "lucide-react";
import styles from "./TarotistaStatusHeader.module.css";

type StatusAction = "connected" | "break" | "bathroom" | "offline";

type Props = {
  workerName: string;
  team?: string | null;
  month: string;
  online: boolean;
  status: string;
  loading?: boolean;
  message?: string;
  onMonthChange: (month: string) => void;
  onRefresh: () => void;
  onStatusChange: (action: StatusAction) => void;
};

function statusCopy(online: boolean, status: string) {
  if (!online) return { label: "Desconectada", note: "Conéctate para recibir actividad.", tone: "offline" };
  if (status === "break") return { label: "En descanso", note: "Las nuevas llamadas quedan pausadas.", tone: "break" };
  if (status === "bathroom") return { label: "Pausa breve", note: "Vuelve cuando estés disponible.", tone: "bathroom" };
  return { label: "Disponible", note: "Esperando nueva actividad.", tone: "connected" };
}

function teamKey(team?: string | null) {
  const value = String(team || "").toLowerCase();
  if (value.includes("agua")) return "water";
  if (value.includes("tierra")) return "earth";
  return "fire";
}

export default function TarotistaStatusHeader({
  workerName,
  team,
  month,
  online,
  status,
  loading,
  message,
  onMonthChange,
  onRefresh,
  onStatusChange,
}: Props) {
  const current = statusCopy(online, status);
  const teamLabel = team ? `Equipo ${team}` : "Equipo sin asignar";

  return (
    <section className={styles.header} data-team={teamKey(team)} aria-label="Estado del turno">
      <div className={styles.identity}>
        <div className={styles.avatar} aria-hidden="true"><Sparkles size={24} /></div>
        <div>
          <div className={styles.eyebrow}>Centro operativo · Tarotista</div>
          <h1>{workerName || "Tarotista"}</h1>
          <div className={styles.team}>{teamLabel}</div>
        </div>
      </div>

      <div className={styles.stateCard} data-tone={current.tone}>
        <span className={styles.stateDot} aria-hidden="true" />
        <div>
          <strong>{current.label}</strong>
          <span>{current.note}</span>
        </div>
      </div>

      <div className={styles.controls}>
        <label className={styles.monthControl}>
          <CalendarDays size={16} aria-hidden="true" />
          <span className="sr-only">Mes seleccionado</span>
          <input type="month" value={month} onChange={(event) => onMonthChange(event.target.value)} />
        </label>

        <button className={styles.refresh} type="button" onClick={onRefresh} disabled={loading} aria-label="Actualizar datos" title="Actualizar datos">
          <RefreshCw size={17} className={loading ? styles.spinning : ""} />
        </button>

        {!online ? (
          <button className={styles.primary} type="button" onClick={() => onStatusChange("connected")} disabled={loading}>
            <Check size={17} /> Conectarme
          </button>
        ) : (
          <details className={styles.statusMenu}>
            <summary><span className={styles.liveDot} /> Estado <ChevronDown size={16} /></summary>
            <div className={styles.statusOptions}>
              <button type="button" onClick={() => onStatusChange("connected")}><Check size={16} /> Disponible</button>
              <button type="button" onClick={() => onStatusChange("break")}><CirclePause size={16} /> Descanso</button>
              <button type="button" onClick={() => onStatusChange("bathroom")}><span aria-hidden="true">WC</span> Pausa breve</button>
              <button type="button" className={styles.danger} onClick={() => onStatusChange("offline")}><LogOut size={16} /> Desconectarme</button>
            </div>
          </details>
        )}
      </div>

      <div className={styles.syncLine}>
        <span><span className={styles.liveDot} /> Sincronización activa</span>
        <span>Mes {month}</span>
        {message ? <span className={styles.message}>{message}</span> : null}
      </div>
    </section>
  );
}
