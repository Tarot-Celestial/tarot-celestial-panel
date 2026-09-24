"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, Check, Clock3, Gem, Heart, LockKeyhole, MoonStar, Orbit, Shield, Sparkles, Sprout } from "lucide-react";
import ClienteLayout from "@/components/cliente/ClienteLayout";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import styles from "./Ritual.module.css";

type Phase = { name?: string; message?: string; advice?: string; asset_url?: string | null; index?: number };
type Ritual = {
  id: string; nombre_personalizado?: string | null; estado: string; progress: number;
  fecha_inicio?: string | null; fecha_fin_prevista?: string | null; fecha_fin_real?: string | null;
  message?: string; advice?: string; phase?: Phase;
  ritual_types?: { nombre?: string; slug?: string; icono?: string; descripcion?: string; fases?: Phase[] } | null;
};
type ResponseData = { ok: boolean; diamond: boolean; rank?: string; ritual: Ritual | null; history: Ritual[] };
const sb = supabaseClienteBrowser();
const icons: Record<string, typeof Shield> = { shield: Shield, heart: Heart, orbit: Orbit, gem: Gem, sprout: Sprout, sparkles: Sparkles };
const slugIcons: Record<string, string> = { proteccion: "shield", sanacion: "heart", armonizacion: "orbit", limpieza: "gem", prosperidad: "sprout" };
const statusNames: Record<string, string> = { pendiente: "Pendiente", activo: "En proceso", pausado: "Pausado", completado: "Completado", cancelado: "Cancelado" };
const date = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString("es-ES") : "Sin fecha registrada";
const title = (ritual: Ritual) => ritual.nombre_personalizado || ritual.ritual_types?.nombre || "Mi ritual";
const symbol = (ritual: Ritual) => ritual.ritual_types?.icono?.toLowerCase() || slugIcons[ritual.ritual_types?.slug || ""] || "sparkles";

export default function RitualPage() {
  const [data, setData] = useState<ResponseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const token = (await sb.auth.getSession()).data.session?.access_token;
      if (controller.signal.aborted) return;
      if (!token) { setData(null); throw new Error("Tu sesión ha caducado. Vuelve a iniciar sesión para ver tu ritual."); }
      const response = await fetch("/api/cliente/ritual", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
      if (response.status === 401 || response.status === 403) setData(null);
      if (!response.ok) throw new Error("No se pudo actualizar tu ritual. Inténtalo de nuevo.");
      const result: ResponseData = await response.json();
      if (!result.ok) throw new Error("No se pudo cargar tu ritual.");
      if (!controller.signal.aborted) { setData(result); setError(""); }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "No se pudo cargar tu ritual.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Also refresh empty/history-only states so new assignments appear without reloading.
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => { request.current?.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);
  useEffect(() => {
    if (!data?.ritual?.id) return;
    const channel = sb.channel(`ritual-${data.ritual.id}`).on("postgres_changes", {
      event: "*", schema: "public", table: "client_rituals", filter: `id=eq.${data.ritual.id}`,
    }, () => void load()).subscribe();
    return () => { void sb.removeChannel(channel); };
  }, [data?.ritual?.id, load]);

  return <ClienteLayout title="Mi Ritual" subtitle="Tu espacio privado para seguir cada etapa de tu experiencia." eyebrow="Tarot Celestial · Experiencia privada">
    <div className={styles.root}>
      {error && <section className={styles.error} role="alert"><span>{error}{data ? " Se muestra la última información recibida." : ""}</span><button onClick={() => void load()}>Reintentar</button></section>}
      {loading ? <section className={styles.state} role="status">Preparando tu espacio ritual…</section>
        : !data ? null : !data.diamond ? <Locked rank={data.rank} /> : <>
          {data.ritual ? <Active ritual={data.ritual} /> : <Empty />}
          <History rituals={data.history || []} />
        </>}
    </div>
  </ClienteLayout>;
}

function Locked({ rank }: { rank?: string }) {
  return <section className={styles.empty}><LockKeyhole size={42} /><span className={styles.eyebrow}>EXPERIENCIA EXCLUSIVA DIAMANTE</span><h2>Tu ritual merece una experiencia única</h2><p>Diamante desbloquea el seguimiento visual de tus rituales, sus fases y los consejos para cada momento.</p><small>Tu rango actual: {rank || "Sin rango"}</small></section>;
}
function Empty() {
  return <section className={styles.empty}><Sparkles size={42} /><span className={styles.eyebrow}>RANGO DIAMANTE</span><h2>Tu espacio ritual está preparado</h2><p>Cuando tengas un ritual activo podrás seguir aquí cada etapa de su evolución.</p></section>;
}

function Visual({ ritual, current, count }: { ritual: Ritual; current: number; count: number }) {
  const id = useId().replace(/:/g, "");
  const key = symbol(ritual);
  const Icon = icons[key] || Sparkles;
  const completed = ritual.estado === "completado";
  const energy = completed ? 1 : count > 1 ? current / (count - 1) : 0;
  const [reduced, setReduced] = useState(true);
  const [visible, setVisible] = useState(true);
  const [failedAsset, setFailedAsset] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const asset = ritual.phase?.asset_url;
  const paused = ritual.estado !== "activo" || reduced || !visible;
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update(); query.addEventListener("change", update);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    if (host.current) observer.observe(host.current);
    return () => { query.removeEventListener("change", update); observer.disconnect(); };
  }, []);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (paused || document.hidden) element.pause();
    else void element.play().catch(() => {});
    const update = () => { if (document.hidden || paused) element.pause(); else void element.play().catch(() => {}); };
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [paused, asset, failedAsset]);
  return <div ref={host} className={styles.visual} data-paused={paused} data-theme={ritual.ritual_types?.slug} style={{ "--energy": energy, "--aura-opacity": .25 + energy * .5 } as CSSProperties}>
    <div className={styles.scene} aria-hidden="true">
      <div className={styles.halo} /><div className={styles.chart} /><div className={styles.pedestal} />
      <div className={styles.levitation}>
        <div className={styles.crystal}>✧</div>
        <div className={styles.sphere}>
          <div className={styles.meridian} />
          <div className={styles.symbol}>
            {key === "shield" ? <svg viewBox="0 0 160 190" fill="none">
              <defs>
                <linearGradient id={`${id}-gold`} x1="25" y1="15" x2="140" y2="180" gradientUnits="userSpaceOnUse"><stop stopColor="#fff8ce" /><stop offset=".28" stopColor="#d19a3e" /><stop offset=".5" stopColor="#fff0ad" /><stop offset=".78" stopColor="#a96723" /><stop offset="1" stopColor="#ffe7a1" /></linearGradient>
                <linearGradient id={`${id}-face`} x1="30" y1="40" x2="132" y2="148" gradientUnits="userSpaceOnUse"><stop stopColor="#5c436a" /><stop offset=".5" stopColor="#1c142b" /><stop offset="1" stopColor="#0b0814" /></linearGradient>
              </defs>
              <path d="M80 14C60 31 36 37 19 37v63c0 33 25 59 61 77 36-18 61-44 61-77V37c-17 0-41-6-61-23Z" fill={`url(#${id}-face)`} stroke={`url(#${id}-gold)`} strokeWidth="7" />
              <path d="M80 27c-17 12-35 19-48 20v52c0 26 19 48 48 64 29-16 48-38 48-64V47c-13-1-31-8-48-20Z" stroke="#f9d98a" strokeOpacity=".65" />
              <path d="M80 29v132c-29-16-47-37-47-62V48c17-3 32-9 47-19Z" fill="#fff4cf" fillOpacity=".07" />
              <path d="m80 65 6 28 21 8-21 7-6 28-6-28-21-7 21-8 6-28Z" fill={`url(#${id}-gold)`} />
            </svg> : <><Icon className={styles.symbolDepth} strokeWidth={1.25} /><Icon strokeWidth={1.25} /></>}
          </div>
        </div>
        {Array.from({ length: 1 + Math.round(energy * 2) }, (_, i) => <div key={i} className={styles.orbit} style={{ "--orbit-index": i } as CSSProperties}><i /></div>)}
        <div className={styles.lowerCrystal}>✧</div>
      </div>
      {Array.from({ length: 6 + Math.round(energy * 10) }, (_, i) => <span key={i} className={styles.mote} style={{ left: `${8 + (i * 31) % 86}%`, top: `${12 + (i * 47) % 76}%`, animationDelay: `${-i * .7}s` }}>✦</span>)}
    </div>
    {asset && failedAsset !== asset && <video ref={video} className={styles.video} src={asset} muted loop playsInline controls preload="metadata" aria-label={`Vídeo de ${ritual.phase?.name || title(ritual)}`} onError={() => setFailedAsset(asset)} />}
  </div>;
}

function Active({ ritual, historical = false }: { ritual: Ritual; historical?: boolean }) {
  const type = ritual.ritual_types || {};
  const phases = Array.isArray(type.fases) ? type.fases : [];
  const phase = ritual.phase || {};
  const current = Math.max(0, Math.min(phases.length - 1, Number(phase.index) || 0));
  const progress = Number.isFinite(Number(ritual.progress)) ? Math.max(0, Math.min(100, Number(ritual.progress))) : 0;
  const complete = ritual.estado === "completado";
  const next = !complete && ritual.estado !== "cancelado" ? phases[current + 1] : undefined;
  const status = statusNames[ritual.estado] || ritual.estado;
  const Icon = icons[symbol(ritual)] || Sparkles;
  return <section className={styles.experience} aria-label={title(ritual)}>
    <div className={styles.hero}>
      <div className={styles.intro}>
        <span className={styles.eyebrow}>{historical ? "TU RITUAL" : "TU RITUAL ACTUAL"} · DIAMANTE</span>
        <h2>{title(ritual)}</h2><span className={styles.status}>{status}</span>
        {type.descripcion && <p>{type.descripcion}</p>}
      </div>
      <Visual ritual={ritual} current={current} count={phases.length} />
      <div className={styles.statusCard}>
        <h3><Sparkles size={16} /> Estado de tu ritual</h3>
        <div className={styles.progressHead}><strong>{progress.toLocaleString("es-ES", { maximumFractionDigits: 1 })}<small>%</small></strong><span>{complete ? "Ritual completado" : phase.name ? <>Fase {current + 1}<br />{phase.name}</> : "Sin fase configurada"}</span></div>
        <div className={styles.progress} role="progressbar" aria-label="Progreso del ritual" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>
        {ritual.message && <p className={styles.phaseMessage}>{ritual.message}</p>}
      </div>
    </div>
    {phases.length > 0 && <ol className={styles.timeline} aria-label="Fases del ritual">{phases.map((item, i) => {
      const done = complete || i < current;
      const active = !complete && ritual.estado !== "cancelado" && i === current;
      return <li key={`${item.name}-${i}`} data-state={done ? "done" : active ? "active" : "next"} aria-current={active ? "step" : undefined}>
        <div className={styles.phaseIcon}>{done ? <Check size={24} /> : active ? <Icon size={24} /> : <Sparkles size={21} />}</div>
        <div><small>{String(i + 1).padStart(2, "0")}</small><b>{item.name || `Fase ${i + 1}`}</b><span>{done ? "Completada" : active ? status : "Pendiente"}</span></div>
      </li>;
    })}</ol>}
    <div className={styles.infoGrid}>
      <article><h3><MoonStar size={18} /> {historical ? "EN TU RITUAL" : "HOY EN TU RITUAL"}</h3><h4>{phase.name || status}</h4><p>{ritual.message || "Sin mensaje disponible."}</p></article>
      <article className={styles.advice}><h3><Sprout size={18} /> CONSEJO PARA ESTE MOMENTO</h3><p>{ritual.advice || "Sin consejo disponible."}</p></article>
      <article><h3><ArrowRight size={18} /> PRÓXIMO PASO</h3><h4>{next ? `Fase ${current + 2} · ${next.name || "Siguiente fase"}` : complete ? "Ritual completado" : ritual.estado === "cancelado" ? "Ritual cancelado" : "Sin siguiente fase"}</h4>{next?.message && <p>{next.message}</p>}</article>
      <article><h3><Clock3 size={18} /> {complete ? "FINALIZACIÓN" : "TIEMPO ESTIMADO"}</h3><h4>{date(complete ? ritual.fecha_fin_real : ritual.fecha_fin_prevista)}</h4><p>{complete ? "Fecha de finalización registrada" : ritual.estado === "pausado" ? "Ritual en pausa · fecha prevista registrada" : "Fecha prevista de finalización del ritual"}</p></article>
    </div>
  </section>;
}

function History({ rituals }: { rituals: Ritual[] }) {
  return <section className={styles.history} aria-label="Historial de rituales"><div className={styles.historyHeading}><Sparkles size={27} /><div><h2>Historial y rituales completados</h2><p>Tus últimos rituales y el detalle de cada experiencia.</p></div></div>
    {!rituals.length ? <p className={styles.noHistory}>Todavía no tienes rituales en tu historial.</p> : rituals.map(ritual => {
      const Icon = icons[symbol(ritual)] || Sparkles;
      return <details key={ritual.id} className={styles.historyItem}><summary><span className={styles.historyIcon}><Icon size={26} /></span><span className={styles.historyName}><b>{title(ritual)}</b><small>{statusNames[ritual.estado] || ritual.estado}</small></span><span className={styles.historyDate}>{ritual.fecha_fin_real ? `Finalizado el ${date(ritual.fecha_fin_real)}` : `Inicio: ${date(ritual.fecha_inicio)}`}</span><span className={styles.detailButton}><span className={styles.openLabel}>Ver detalle</span><span className={styles.closeLabel}>Cerrar detalle</span><ArrowRight size={16} /></span></summary><Active ritual={ritual} historical /></details>;
    })}
  </section>;
}
