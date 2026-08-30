"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bath, Coffee, Crown, Droplets, Flame, Globe2, RefreshCw, UsersRound, Wifi } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./CentralTeamLivePanel.module.css";

type LiveMember = {
  worker_id: string;
  display_name: string;
  team: "fuego" | "agua" | "tierra" | null;
  status: "connected" | "break" | "bathroom";
  source_status: string;
  last_event_at: string | null;
};

type TeamMetric = {
  key: "fuego" | "agua" | "tierra";
  members: number;
  minutes_total: number;
  minutes_cliente: number;
  minutes_repite: number;
  pct_cliente: number;
  pct_repite: number;
  score: number;
  delta_score: number;
};

type TeamLivePayload = {
  ok: boolean;
  month: string;
  active_total: number;
  connected_total: number;
  break_total: number;
  live_members: LiveMember[];
  teams: Record<"fuego" | "agua" | "tierra", TeamMetric>;
  leader: "fuego" | "agua" | "tierra" | null;
  refreshed_at: string;
  error?: string;
};

const TEAM_META = {
  fuego: { label: "Fuego", Icon: Flame },
  agua: { label: "Agua", Icon: Droplets },
  tierra: { label: "Tierra", Icon: Globe2 },
} as const;

const TEAM_ORDER = ["fuego", "agua", "tierra"] as const;
const FALLBACK_REFRESH_MS = 60_000;

function teamLabel(team: LiveMember["team"]) {
  return team ? TEAM_META[team].label : "Sin equipo";
}

function friendlyError(error: unknown) {
  const value = String(error || "");
  if (/SERVICE_UNAVAILABLE|fetch|network|timeout|connection/i.test(value)) {
    return "El servicio de datos no responde. Conservamos la última información y volveremos a intentarlo.";
  }
  if (/FORBIDDEN|401|403/i.test(value)) return "Tu sesión no tiene permiso para consultar el equipo.";
  return "No se pudo actualizar el equipo en vivo.";
}

function relativeTime(value: string | null) {
  if (!value) return "ahora";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (!Number.isFinite(seconds) || seconds < 10) return "ahora";
  if (seconds < 60) return `hace ${seconds} s`;
  return `hace ${Math.round(seconds / 60)} min`;
}

export default function CentralTeamLivePanel({ month }: { month: string }) {
  const sb = useMemo(() => supabaseBrowser(), []);
  const [data, setData] = useState<TeamLivePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [liveState, setLiveState] = useState<"connecting" | "live" | "fallback">("connecting");
  const mountedRef = useRef(false);
  const inFlightRef = useRef(false);
  const requestIdRef = useRef(0);
  const refreshTimerRef = useRef<number | null>(null);

  const load = useCallback(async (mode: "initial" | "manual" | "silent" = "silent") => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const requestId = ++requestIdRef.current;
    if (mode === "initial") setLoading(true);
    if (mode === "manual") setRefreshing(true);

    try {
      const { data: sessionData } = await sb.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("401");

      const response = await fetch(`/api/central/team-live?month=${encodeURIComponent(month)}&t=${Date.now()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await response.json().catch(() => null)) as TeamLivePayload | null;
      if (!response.ok || !json?.ok) throw new Error(json?.error || `HTTP ${response.status}`);
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setData(json);
      setError(null);
    } catch (loadError) {
      if (mountedRef.current && requestId === requestIdRef.current) setError(friendlyError(loadError));
    } finally {
      if (requestId === requestIdRef.current) inFlightRef.current = false;
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [month, sb]);

  useEffect(() => {
    mountedRef.current = true;
    inFlightRef.current = false;
    requestIdRef.current += 1;
    void load("initial");

    const scheduleRefresh = () => {
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        if (document.visibilityState === "visible") void load("silent");
      }, 650);
    };

    const channel = sb
      .channel(`central-team-live-${month}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "workers" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_state" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "rendimiento_llamadas" }, scheduleRefresh)
      .subscribe((status) => {
        if (!mountedRef.current) return;
        if (status === "SUBSCRIBED") setLiveState("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setLiveState("fallback");
      });

    const fallback = window.setInterval(() => {
      if (document.visibilityState === "visible") void load("silent");
    }, FALLBACK_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load("silent");
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      inFlightRef.current = false;
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
      window.clearInterval(fallback);
      document.removeEventListener("visibilitychange", onVisible);
      void sb.removeChannel(channel);
    };
  }, [load, month, sb]);

  const visibleMembers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return data?.live_members || [];
    return (data?.live_members || []).filter((member) =>
      `${member.display_name} ${teamLabel(member.team)}`.toLowerCase().includes(normalized)
    );
  }, [data?.live_members, query]);

  const maxScore = Math.max(...TEAM_ORDER.map((key) => Number(data?.teams?.[key]?.score || 0)), 1);
  const disconnectedTotal = Math.max(0, Number(data?.active_total || 0) - Number(data?.connected_total || 0) - Number(data?.break_total || 0));

  return (
    <section className={styles.hud} aria-label="Centro de equipo en vivo">
      <header className={styles.hero}>
        <div>
          <div className={styles.eyebrow}><Wifi size={14} /> Centro operativo</div>
          <h2>Equipo en vivo</h2>
          <p>Presencia real y competición CLIENTE + REPITE del mes seleccionado.</p>
        </div>
        <div className={styles.toolbar}>
          <span className={`${styles.liveBadge} ${styles[liveState]}`}>
            <i /> {liveState === "live" ? "En vivo" : liveState === "connecting" ? "Conectando" : "Respaldo activo"}
          </span>
          <button type="button" onClick={() => void load("manual")} disabled={refreshing} className={styles.refreshButton}>
            <RefreshCw size={16} className={refreshing ? styles.spinning : ""} />
            {refreshing ? "Actualizando" : "Actualizar"}
          </button>
        </div>
      </header>

      {error ? <div className={styles.error} role="alert">⚠ {error}</div> : null}

      <div className={styles.summaryGrid}>
        <article><strong>{data?.active_total ?? "—"}</strong><span>Tarotistas activas</span></article>
        <article className={styles.connected}><strong>{data?.connected_total ?? "—"}</strong><span>Conectadas</span></article>
        <article className={styles.break}><strong>{data?.break_total ?? "—"}</strong><span>En descanso</span></article>
        <article className={styles.disconnected}><strong>{data ? disconnectedTotal : "—"}</strong><span>Desconectadas</span></article>
      </div>

      <div className={styles.sectionHeading}>
        <div><UsersRound size={19} /><div><h3>Presencias operativas</h3><p>Solo conectadas y descansos con señal reciente.</p></div></div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar tarotista o equipo" aria-label="Buscar tarotista o equipo" />
      </div>

      {loading && !data ? (
        <div className={styles.stateBox}>Cargando equipo en vivo…</div>
      ) : error && !data ? (
        <div className={styles.stateBox}>No se pudo consultar la presencia. Usa «Actualizar» para volver a intentarlo.</div>
      ) : visibleMembers.length ? (
        <div className={styles.presenceGrid}>
          {visibleMembers.map((member) => (
            <article key={member.worker_id} className={`${styles.memberCard} ${styles[member.team || "none"]}`}>
              <div className={styles.avatar}>{member.display_name.trim().charAt(0).toUpperCase() || "T"}</div>
              <div className={styles.memberInfo}>
                <strong>{member.display_name}</strong>
                <span>{teamLabel(member.team)}</span>
                <small>{relativeTime(member.last_event_at)}</small>
              </div>
              <div className={`${styles.presenceStatus} ${member.status !== "connected" ? styles.onBreak : styles.online}`}>
                {member.status === "bathroom" ? <Bath size={15} /> : member.status === "break" ? <Coffee size={15} /> : <i />}
                {member.status === "bathroom" ? "Baño" : member.status === "break" ? "Descanso" : "Conectada"}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.stateBox}>No hay tarotistas conectadas que coincidan con la búsqueda.</div>
      )}

      <div className={styles.competitionHeader}>
        <div>
          <span>Temporada {month}</span>
          <h3>Competición de equipos</h3>
          <p>Puntuación = % de minutos CLIENTE + % de minutos REPITE.</p>
        </div>
        {data?.leader ? <div className={styles.leaderPill}><Crown size={16} /> Lidera {TEAM_META[data.leader].label}</div> : null}
      </div>

      <div className={styles.teamGrid}>
        {TEAM_ORDER.map((key) => {
          const metric = data?.teams?.[key];
          const meta = TEAM_META[key];
          const Icon = meta.Icon;
          const isLeader = data?.leader === key;
          const score = Number(metric?.score || 0);
          const delta = Number(metric?.delta_score || 0);
          return (
            <article key={`${key}-${isLeader ? "leader" : "team"}`} className={`${styles.teamCard} ${styles[key]} ${isLeader ? styles.teamLeader : ""}`}>
              <div className={styles.teamTop}>
                <div className={styles.teamIcon}><Icon size={22} /></div>
                <div><span>Equipo</span><h4>{meta.label}</h4></div>
                {isLeader ? <Crown className={styles.crown} size={20} /> : null}
              </div>
              <div className={styles.scoreRow}>
                <strong>{score.toFixed(2)}</strong>
                <span className={delta > 0 ? styles.up : delta < 0 ? styles.down : ""}>
                  {delta > 0 ? "↑" : delta < 0 ? "↓" : "•"} {Math.abs(delta).toFixed(2)}
                </span>
              </div>
              <div className={styles.progress}><i style={{ width: `${Math.max(0, Math.min(100, (score / maxScore) * 100))}%` }} /></div>
              <div className={styles.metrics}>
                <div><span>CLIENTE</span><strong>{Number(metric?.pct_cliente || 0).toFixed(2)}%</strong></div>
                <div><span>REPITE</span><strong>{Number(metric?.pct_repite || 0).toFixed(2)}%</strong></div>
                <div><span>Activas</span><strong>{metric?.members || 0}</strong></div>
              </div>
            </article>
          );
        })}
      </div>

      <footer className={styles.footerNote}>
        Datos persistidos · actualización Realtime con respaldo cada minuto
        {data?.refreshed_at ? ` · ${new Date(data.refreshed_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : ""}
      </footer>
    </section>
  );
}
