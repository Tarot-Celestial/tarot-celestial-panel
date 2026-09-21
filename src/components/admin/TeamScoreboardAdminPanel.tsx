"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Crown, Droplets, Flame, RefreshCw, Save, Settings2, Sparkles, Target, Trophy, UsersRound, Zap } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./TeamScoreboardAdminPanel.module.css";

type TeamKey = "fuego" | "agua";
type MetricKey = "team_score" | "captadas_total" | "minutes_total" | "calls_total" | "pct_cliente" | "pct_repite";

type Objective = {
  id: string | null;
  week_start: string;
  team_key: TeamKey;
  metric_key: MetricKey;
  title: string;
  target_value: number;
  reward_label: string;
  active: boolean;
  current_value: number;
  progress_pct: number;
  completed: boolean;
};

type Team = {
  key: TeamKey;
  score: number;
  pct_cliente: number;
  pct_repite: number;
  captadas_total: number;
  minutes_total: number;
  calls_total: number;
  members_count: number;
  members: Array<{ worker_id: string; display_name: string; competition_points: number; pct_cliente: number; pct_repite: number; captadas_total: number }>;
  weekly: { score: number; delta_score: number; captadas_total: number; minutes_total: number; calls_total: number; pct_cliente: number; pct_repite: number; previous_score: number };
  objective: Objective | null;
};

type Payload = {
  ok: boolean;
  month: string;
  week_start: string;
  week_end: string;
  formula: { label: string };
  teams: Record<TeamKey, Team>;
  leader: TeamKey | "empate";
  difference: number;
  objectives_table_ready: boolean;
  refreshed_at: string;
  error?: string;
};

type Draft = Pick<Objective, "team_key" | "week_start" | "metric_key" | "title" | "target_value" | "reward_label" | "active">;

const META = {
  fuego: { label: "Fuego", Icon: Flame },
  agua: { label: "Agua", Icon: Droplets },
} as const;

const METRIC_OPTIONS: Array<{ value: MetricKey; label: string }> = [
  { value: "captadas_total", label: "Captadas válidas" },
  { value: "pct_cliente", label: "% Cliente" },
  { value: "pct_repite", label: "% Repite" },
  { value: "minutes_total", label: "Minutos registrados" },
  { value: "calls_total", label: "Llamadas registradas" },
  { value: "team_score", label: "Score de equipo" },
];

function fmt(value: number, digits = 2) {
  return Number(value || 0).toLocaleString("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatMetric(metric: MetricKey, value: number) {
  if (metric === "pct_cliente" || metric === "pct_repite") return `${fmt(value)}%`;
  if (metric === "minutes_total") return `${Math.round(value).toLocaleString("es-ES")} min`;
  if (metric === "team_score") return `${fmt(value)} pts`;
  return Math.round(value).toLocaleString("es-ES");
}

export default function TeamScoreboardAdminPanel({ month }: { month: string }) {
  const sb = useMemo(() => supabaseBrowser(), []);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState<TeamKey | null>(null);
  const [message, setMessage] = useState("");
  const [drafts, setDrafts] = useState<Record<TeamKey, Draft> | null>(null);
  const inFlight = useRef(false);
  const timer = useRef<number | null>(null);

  const token = useCallback(async () => {
    const { data: sessionData } = await sb.auth.getSession();
    return sessionData.session?.access_token || "";
  }, [sb]);

  const hydrateDrafts = useCallback((payload: Payload) => {
    const make = (team: TeamKey): Draft => {
      const objective = payload.teams[team]?.objective;
      return {
        team_key: team,
        week_start: payload.week_start,
        metric_key: (objective?.metric_key || "captadas_total") as MetricKey,
        title: objective?.title && objective.active ? objective.title : `Reto semanal · Equipo ${META[team].label}`,
        target_value: Number(objective?.target_value || 0),
        reward_label: objective?.reward_label && objective.active ? objective.reward_label : "",
        active: objective?.active === true,
      };
    };
    setDrafts({ fuego: make("fuego"), agua: make("agua") });
  }, []);

  const load = useCallback(async (manual = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (manual) setRefreshing(true);
    try {
      const auth = await token();
      if (!auth) throw new Error("Sesión no disponible");
      const res = await fetch(`/api/admin/team-scoreboard?month=${encodeURIComponent(month)}&t=${Date.now()}`, { cache: "no-store", headers: { Authorization: `Bearer ${auth}` } });
      const json = (await res.json().catch(() => null)) as Payload | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setData(json);
      hydrateDrafts(json);
      setMessage("");
    } catch (e: any) {
      setMessage(`❌ ${e?.message || "No se pudo cargar el marcador"}`);
    } finally {
      inFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [hydrateDrafts, month, token]);

  useEffect(() => {
    setLoading(true);
    void load(false);
    const schedule = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void load(false), 450);
    };
    const channel = sb
      .channel(`admin-team-scoreboard-${month}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rendimiento_llamadas" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "workers" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_weekly_objectives" }, schedule)
      .subscribe();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(false);
    }, 45_000);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
      window.clearInterval(interval);
      void sb.removeChannel(channel);
    };
  }, [load, month, sb]);

  async function save(team: TeamKey) {
    const draft = drafts?.[team];
    if (!draft) return;
    setSaving(team);
    setMessage("");
    try {
      const auth = await token();
      if (!auth) throw new Error("Sesión no disponible");
      const res = await fetch("/api/admin/team-scoreboard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth}` },
        body: JSON.stringify(draft),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        if (json?.error === "TEAM_WEEKLY_OBJECTIVES_TABLE_MISSING") throw new Error("Falta aplicar SQL_NECESARIO_EQUIPOS.sql en Supabase.");
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setMessage(`✅ Reto del Equipo ${META[team].label} actualizado y sincronizado.`);
      await load(false);
    } catch (e: any) {
      setMessage(`❌ ${e?.message || "No se pudo guardar"}`);
    } finally {
      setSaving(null);
    }
  }

  function patch(team: TeamKey, values: Partial<Draft>) {
    setDrafts((current) => current ? { ...current, [team]: { ...current[team], ...values } } : current);
  }

  if (loading && !data) return <div className={styles.loading}>Cargando marcador real de equipos…</div>;

  const maxScore = Math.max(Number(data?.teams?.fuego?.score || 0), Number(data?.teams?.agua?.score || 0), 1);
  const leaderLabel = data?.leader === "fuego" ? "Fuego" : data?.leader === "agua" ? "Agua" : "Empate";

  return (
    <section className={styles.panel}>
      <header className={styles.hero}>
        <div>
          <div className={styles.eyebrow}><Trophy size={14} /> Centro de competición · administración</div>
          <h2>Equipos marcador</h2>
          <p>Una única fuente de verdad para Fuego vs Agua. Desde aquí ves el progreso real y configuras los retos semanales que aparecen en todos los paneles.</p>
        </div>
        <div className={styles.heroTools}>
          <div><small>Líder mensual</small><strong>{leaderLabel}</strong></div>
          <div><small>Diferencia</small><strong>{fmt(data?.difference || 0)} pts</strong></div>
          <button type="button" onClick={() => void load(true)} disabled={refreshing}><RefreshCw size={16} className={refreshing ? styles.spin : ""} />Actualizar</button>
        </div>
      </header>

      {message ? <div className={message.startsWith("✅") ? styles.success : styles.error}>{message}</div> : null}
      {!data?.objectives_table_ready ? <div className={styles.warning}>⚠ Para guardar objetivos semanales aplica <b>SQL_NECESARIO_EQUIPOS.sql</b>. El marcador ya puede leer datos reales de Rendimiento.</div> : null}

      <div className={styles.summaryStrip}>
        <div><Sparkles size={16} /><span>Fórmula oficial</span><strong>{data?.formula?.label || "—"}</strong></div>
        <div><Target size={16} /><span>Semana activa</span><strong>{data?.week_start || "—"} → {data?.week_end || "—"}</strong></div>
        <div><Zap size={16} /><span>Sincronización</span><strong>Realtime + respaldo 45 s</strong></div>
      </div>

      <div className={styles.scoreGrid}>
        {(["fuego", "agua"] as TeamKey[]).map((teamKey) => {
          const team = data?.teams?.[teamKey];
          const meta = META[teamKey];
          const Icon = meta.Icon;
          const leader = data?.leader === teamKey;
          return (
            <article key={teamKey} className={styles.scoreCard} data-tone={teamKey} data-leader={leader ? "true" : "false"}>
              <div className={styles.scoreHead}><span><Icon size={22} /></span><div><small>Equipo</small><h3>{meta.label}</h3></div>{leader ? <b><Crown size={13} /> Ganador actual</b> : null}</div>
              <div className={styles.bigScore}><strong>{fmt(team?.score || 0)}</strong><small>puntos</small></div>
              <div className={styles.track}><span style={{ width: `${Math.max(5, (Number(team?.score || 0) / maxScore) * 100)}%` }} /></div>
              <div className={styles.metrics}><div><span>Cliente</span><b>{fmt(team?.pct_cliente || 0)}%</b></div><div><span>Repite</span><b>{fmt(team?.pct_repite || 0)}%</b></div><div><span>Captadas</span><b>{team?.captadas_total || 0}</b></div><div><span>Minutos</span><b>{Math.round(Number(team?.minutes_total || 0)).toLocaleString("es-ES")}</b></div><div><span>Llamadas</span><b>{team?.calls_total || 0}</b></div><div><span>Integrantes</span><b>{team?.members_count || 0}</b></div></div>
              <div className={styles.weekPulse}><span>Impulso semanal</span><b data-positive={Number(team?.weekly?.delta_score || 0) >= 0 ? "true" : "false"}>{Number(team?.weekly?.delta_score || 0) >= 0 ? "+" : ""}{fmt(team?.weekly?.delta_score || 0)} pts</b></div>
            </article>
          );
        })}
      </div>

      <section className={styles.objectivesSection}>
        <div className={styles.sectionTitle}><Settings2 size={19} /><div><small>Control semanal</small><h3>Objetivos que verán los equipos</h3><p>Al guardar, se actualiza la misión semanal en Panel Tarotista y Panel Central.</p></div></div>
        <div className={styles.editorGrid}>
          {(["fuego", "agua"] as TeamKey[]).map((teamKey) => {
            const draft = drafts?.[teamKey];
            const liveObjective = data?.teams?.[teamKey]?.objective;
            const meta = META[teamKey];
            const Icon = meta.Icon;
            if (!draft) return null;
            return (
              <article key={teamKey} className={styles.editorCard} data-tone={teamKey}>
                <div className={styles.editorHead}><span><Icon size={18} /></span><div><small>Reto semanal</small><h4>Equipo {meta.label}</h4></div><label className={styles.switch}><input type="checkbox" checked={draft.active} onChange={(e) => patch(teamKey, { active: e.target.checked })} /><i /></label></div>
                <label>Título<input value={draft.title} onChange={(e) => patch(teamKey, { title: e.target.value })} placeholder="Ej. Sprint de captadas" /></label>
                <div className={styles.twoCols}><label>Métrica<select value={draft.metric_key} onChange={(e) => patch(teamKey, { metric_key: e.target.value as MetricKey })}>{METRIC_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label>Objetivo<input type="number" min="0" step="0.01" value={draft.target_value} onChange={(e) => patch(teamKey, { target_value: Number(e.target.value || 0) })} /></label></div>
                <label>Recompensa / mensaje<input value={draft.reward_label} onChange={(e) => patch(teamKey, { reward_label: e.target.value })} placeholder="Ej. Cofre especial + reconocimiento" /></label>
                <div className={styles.progressBox}><div><span>Progreso real esta semana</span><b>{liveObjective ? `${formatMetric(liveObjective.metric_key, liveObjective.current_value)} / ${formatMetric(liveObjective.metric_key, liveObjective.target_value)}` : "—"}</b></div><div className={styles.track}><span style={{ width: `${Math.max(2, Math.min(100, Number(liveObjective?.progress_pct || 0)))}%` }} /></div></div>
                <button type="button" onClick={() => void save(teamKey)} disabled={saving === teamKey}><Save size={15} />{saving === teamKey ? "Guardando…" : "Guardar y sincronizar"}</button>
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.membersSection}>
        <div className={styles.sectionTitle}><UsersRound size={19} /><div><small>Impacto individual</small><h3>Quién está empujando cada equipo</h3><p>La contribución usa exactamente la misma fórmula que el marcador.</p></div></div>
        <div className={styles.memberColumns}>
          {(["fuego", "agua"] as TeamKey[]).map((teamKey) => (
            <article key={teamKey} className={styles.memberCard} data-tone={teamKey}>
              <h4>Equipo {META[teamKey].label}</h4>
              {(data?.teams?.[teamKey]?.members || []).slice(0, 8).map((member, index) => <div key={member.worker_id} className={styles.memberRow}><span>#{index + 1}</span><i>{member.display_name.charAt(0).toUpperCase()}</i><strong>{member.display_name}</strong><b>{fmt(member.competition_points)} pts</b></div>)}
              {!data?.teams?.[teamKey]?.members?.length ? <p>Sin actividad real registrada.</p> : null}
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
