"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Crown, Droplets, Flame, RefreshCw, Sparkles, Target, TrendingDown, TrendingUp, Trophy, UsersRound, Zap } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./TeamCompetitionArena.module.css";

type TeamKey = "fuego" | "agua";
type Objective = {
  id: string | null;
  team_key: TeamKey;
  metric_key: string;
  title: string;
  target_value: number;
  reward_label: string;
  active: boolean;
  current_value: number;
  progress_pct: number;
  completed: boolean;
};

type Member = {
  worker_id: string;
  display_name: string;
  competition_points: number;
  captadas_total: number;
  pct_cliente: number;
  pct_repite: number;
  minutes_total: number;
  calls_total: number;
};

type TeamData = {
  key: TeamKey;
  members_count: number;
  score: number;
  pct_cliente: number;
  pct_repite: number;
  captadas_total: number;
  minutes_total: number;
  calls_total: number;
  members: Member[];
  weekly: {
    score: number;
    pct_cliente: number;
    pct_repite: number;
    captadas_total: number;
    minutes_total: number;
    calls_total: number;
    previous_score: number;
    delta_score: number;
  };
  objective: Objective | null;
};

type Payload = {
  ok: boolean;
  month: string;
  week_start: string;
  week_end: string;
  formula: { label: string };
  teams: Record<TeamKey, TeamData>;
  leader: TeamKey | "empate";
  difference: number;
  objectives_table_ready: boolean;
  me: (Member & { team: TeamKey | null; team_position: number | null }) | null;
  refreshed_at: string;
  error?: string;
};

const TEAM_META = {
  fuego: { label: "Fuego", Icon: Flame, rival: "Agua" },
  agua: { label: "Agua", Icon: Droplets, rival: "Fuego" },
} as const;

function formatValue(metric: string, value: number) {
  if (metric === "pct_cliente" || metric === "pct_repite") return `${Number(value || 0).toFixed(2)}%`;
  if (metric === "minutes_total") return `${Math.round(Number(value || 0))} min`;
  if (metric === "team_score") return `${Number(value || 0).toFixed(2)} pts`;
  return Number(value || 0).toLocaleString("es-ES", { maximumFractionDigits: 0 });
}

function fmt(value: number, digits = 2) {
  return Number(value || 0).toLocaleString("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default function TeamCompetitionArena({ month, mode = "tarotista" }: { month: string; mode?: "tarotista" | "central" }) {
  const sb = useMemo(() => supabaseBrowser(), []);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [live, setLive] = useState<"connecting" | "live" | "fallback">("connecting");
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const timer = useRef<number | null>(null);

  const load = useCallback(async (manual = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (manual) setRefreshing(true);
    try {
      const { data: sessionData } = await sb.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sesión no disponible");
      const res = await fetch(`/api/teams/scoreboard?month=${encodeURIComponent(month)}&t=${Date.now()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json().catch(() => null)) as Payload | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setData(json);
      setError("");
    } catch (e: any) {
      setError(e?.message || "No se pudo actualizar la competición");
    } finally {
      inFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [month, sb]);

  useEffect(() => {
    setLoading(true);
    void load(false);
    const schedule = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void load(false), 500);
    };
    const channel = sb
      .channel(`team-competition-${mode}-${month}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rendimiento_llamadas" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "workers" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_weekly_objectives" }, schedule)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setLive("live");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setLive("fallback");
      });
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(false);
    }, 45_000);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
      window.clearInterval(interval);
      void sb.removeChannel(channel);
    };
  }, [load, mode, month, sb]);

  const fuego = data?.teams?.fuego;
  const agua = data?.teams?.agua;
  const maxScore = Math.max(Number(fuego?.score || 0), Number(agua?.score || 0), 1);
  const myTeam = data?.me?.team ? data.teams[data.me.team] : null;
  const myTeamMeta = data?.me?.team ? TEAM_META[data.me.team] : null;
  const rivalTeamKey: TeamKey | null = data?.me?.team === "fuego" ? "agua" : data?.me?.team === "agua" ? "fuego" : null;
  const rivalTeam = rivalTeamKey && data ? data.teams[rivalTeamKey] : null;
  const leaderLabel = data?.leader === "fuego" ? "Fuego" : data?.leader === "agua" ? "Agua" : "Empate";

  if (loading && !data) return <div className={styles.loading}>Preparando la arena de equipos…</div>;

  return (
    <section className={styles.arena}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrow}><Zap size={14} /> Arena de equipos · datos reales</div>
          <h2>Fuego vs Agua</h2>
          <p>Cada captada y cada mejora de Cliente o Repite empuja el marcador. La competición se calcula siempre desde Rendimiento.</p>
          <div className={styles.formula}><Sparkles size={14} /> {data?.formula?.label || "%Cliente + %Repite + captadas"}</div>
        </div>
        <div className={styles.heroStats}>
          <div><small>Líder actual</small><strong>{leaderLabel}</strong></div>
          <div><small>Diferencia</small><strong>{fmt(data?.difference || 0)} pts</strong></div>
          <button type="button" onClick={() => void load(true)} disabled={refreshing}><RefreshCw size={15} className={refreshing ? styles.spin : ""} />Actualizar</button>
          <span className={`${styles.liveBadge} ${styles[live]}`}><i />{live === "live" ? "En vivo" : live === "connecting" ? "Conectando" : "Respaldo activo"}</span>
        </div>
      </header>

      {error ? <div className={styles.error}>{error}</div> : null}

      <div className={styles.duelGrid}>
        {(["fuego", "agua"] as TeamKey[]).map((key) => {
          const team = data?.teams?.[key];
          const meta = TEAM_META[key];
          const Icon = meta.Icon;
          const winner = data?.leader === key;
          const objective = team?.objective;
          return (
            <article key={key} className={styles.teamCard} data-tone={key} data-leader={winner ? "true" : "false"}>
              <div className={styles.teamHead}>
                <span className={styles.teamIcon}><Icon size={22} /></span>
                <div><small>{winner ? "Marcando el ritmo" : "En persecución"}</small><h3>Equipo {meta.label}</h3></div>
                {winner ? <span className={styles.leaderPill}><Crown size={13} /> Líder</span> : <span className={styles.chaserPill}>Objetivo</span>}
              </div>
              <div className={styles.scoreLine}><div><small>Score mensual</small><strong>{fmt(team?.score || 0)}</strong></div><div className={styles.weekDelta} data-positive={Number(team?.weekly?.delta_score || 0) >= 0 ? "true" : "false"}>{Number(team?.weekly?.delta_score || 0) >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}{Number(team?.weekly?.delta_score || 0) >= 0 ? "+" : ""}{fmt(team?.weekly?.delta_score || 0)} esta semana</div></div>
              <div className={styles.powerTrack}><span style={{ width: `${Math.max(5, (Number(team?.score || 0) / maxScore) * 100)}%` }} /></div>
              <div className={styles.metricGrid}>
                <div><small>Cliente</small><strong>{fmt(team?.pct_cliente || 0)}%</strong></div>
                <div><small>Repite</small><strong>{fmt(team?.pct_repite || 0)}%</strong></div>
                <div><small>Captadas</small><strong>{team?.captadas_total || 0}</strong></div>
                <div><small>Minutos</small><strong>{Math.round(Number(team?.minutes_total || 0)).toLocaleString("es-ES")}</strong></div>
              </div>
              <div className={styles.objectiveBox} data-active={objective?.active ? "true" : "false"}>
                <div className={styles.objectiveHead}><Target size={16} /><div><small>Misión semanal</small><strong>{objective?.active ? objective.title : "Pendiente de configurar"}</strong></div></div>
                {objective?.active ? <>
                  <div className={styles.objectiveNumbers}><span>{formatValue(objective.metric_key, objective.current_value)}</span><b>{formatValue(objective.metric_key, objective.target_value)}</b></div>
                  <div className={styles.objectiveTrack}><span style={{ width: `${Math.max(2, Math.min(100, Number(objective.progress_pct || 0)))}%` }} /></div>
                  <div className={styles.objectiveFooter}><span>{objective.completed ? "✓ Objetivo completado" : `${fmt(objective.progress_pct || 0, 0)}% completado`}</span><strong>{objective.reward_label || "Recompensa por definir"}</strong></div>
                </> : <p>Administración puede crear el reto de esta semana desde «Equipos marcador».</p>}
              </div>
            </article>
          );
        })}
      </div>

      {mode === "tarotista" && data?.me ? (
        <div className={styles.personalGrid}>
          <article className={styles.personalCard} data-tone={data.me.team || "none"}>
            <div className={styles.cardTitle}><Trophy size={18} /><div><small>Tu impacto</small><h3>Tu aportación al Equipo {myTeamMeta?.label || "—"}</h3></div></div>
            <div className={styles.personalScore}><strong>{fmt(data.me.competition_points)} pts</strong><span>#{data.me.team_position || "—"} dentro de tu equipo</span></div>
            <div className={styles.personalMetrics}><span>Cliente <b>{fmt(data.me.pct_cliente)}%</b></span><span>Repite <b>{fmt(data.me.pct_repite)}%</b></span><span>Captadas <b>{data.me.captadas_total}</b></span></div>
          </article>
          <article className={styles.personalCard}>
            <div className={styles.cardTitle}><Target size={18} /><div><small>Tu siguiente empujón</small><h3>{myTeam && rivalTeam && Number(myTeam.score) < Number(rivalTeam.score) ? `Recortar a ${TEAM_META[rivalTeamKey!].label}` : "Defender el liderazgo"}</h3></div></div>
            <p>{myTeam && rivalTeam && Number(myTeam.score) < Number(rivalTeam.score) ? `A vuestro equipo le separan ${fmt(Math.abs(Number(myTeam.score) - Number(rivalTeam.score)))} puntos del rival.` : "Vais delante. La clave ahora es sostener Cliente, Repite y captadas durante toda la semana."}</p>
          </article>
        </div>
      ) : null}

      <div className={styles.rankingGrid}>
        {(["fuego", "agua"] as TeamKey[]).map((key) => {
          const team = data?.teams?.[key];
          const meta = TEAM_META[key];
          const Icon = meta.Icon;
          return (
            <article key={key} className={styles.rankingCard} data-tone={key}>
              <div className={styles.cardTitle}><UsersRound size={18} /><div><small>Contribución individual</small><h3>Top del Equipo {meta.label}</h3></div><Icon size={17} /></div>
              <div className={styles.memberList}>
                {(team?.members || []).slice(0, 6).map((member, index) => (
                  <div key={member.worker_id} className={styles.memberRow} data-me={String(member.worker_id) === String(data?.me?.worker_id) ? "true" : "false"}>
                    <span className={styles.position}>#{index + 1}</span><span className={styles.avatar}>{member.display_name.charAt(0).toUpperCase()}</span><strong>{member.display_name}</strong><b>{fmt(member.competition_points)} pts</b>
                  </div>
                ))}
                {!team?.members?.length ? <div className={styles.empty}>Sin actividad real registrada en este equipo.</div> : null}
              </div>
            </article>
          );
        })}
      </div>

      {!data?.objectives_table_ready ? <div className={styles.sqlNotice}>Para activar misiones semanales editables, aplica el SQL incluido en el ZIP. El marcador mensual sigue usando datos reales aunque esa tabla todavía no exista.</div> : null}
    </section>
  );
}
