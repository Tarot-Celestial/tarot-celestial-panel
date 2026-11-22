"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, ArrowUpRight, Clock3, FileText, Play, Square } from "lucide-react";
import { ATLAS_IDENTITY } from "@/lib/atlas-identity";
import { officeDepartments } from "./catalog";
import { mapHandoffs, officeDesk, officeRoute, routeTiming, stationColor, stationName, type OfficeMapHandoff, type OfficeMapStation } from "./office-map-activity";
import s from "./OfficeMapAgents.module.css";

const bot = "/office/agente-celestial.webp";
const madrid = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Madrid" });
const stations: OfficeMapStation[] = [...officeDepartments.map(area => area.id), "atlas"];
type Playback = { event: OfficeMapHandoff; serial: number };

export function useMapActivity(records: readonly OfficeMapHandoff[], visible: boolean, loading?: boolean) {
  const events = useMemo(() => mapHandoffs(records), [records]);
  const [choice, setChoice] = useState<string | null>(null);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [reduced, setReduced] = useState(false);
  const [auto, setAuto] = useState(true);
  const known = useRef(new Set<string>());
  const latest = useRef<number | null>(null);
  const queue = useRef<OfficeMapHandoff[]>([]);
  const active = useRef<number | null>(null);
  const serial = useRef(0);
  const selected = events.find(event => event.id === choice) || events[0] || null;

  const stop = useCallback(() => {
    queue.current = []; active.current = null; setPlayback(null);
  }, []);
  const next = useCallback(() => {
    const event = queue.current.shift();
    if (!event) { active.current = null; setPlayback(null); return; }
    const key = ++serial.current;
    active.current = key; setChoice(event.id); setPlayback({ event, serial: key });
  }, []);
  const finish = useCallback((key: number) => { if (active.current === key) next(); }, [next]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    function update() { setReduced(media.matches); if (media.matches) stop(); }
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [stop]);
  useEffect(() => {
    if (!visible) { stop(); return; }
    if (!events.length || loading) return;
    const previous = latest.current;
    const fresh = previous === null ? [events[0]] : events.filter(event => !known.current.has(event.id) && Date.parse(event.at) >= previous);
    latest.current = Math.max(previous ?? 0, Date.parse(events[0].at));
    for (const event of events) known.current.add(event.id);
    if (known.current.size > 512) known.current = new Set(events.map(event => event.id));
    if (!auto || !fresh.length || document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    queue.current.push(...fresh.reverse());
    if (active.current === null) next();
  }, [events, visible, loading, auto, stop, next]);
  useEffect(() => {
    function visibility() { if (document.hidden) stop(); }
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [stop]);
  function select(event: OfficeMapHandoff) { stop(); setChoice(event.id); }
  function replay(event: OfficeMapHandoff) {
    if (reduced) { select(event); return; }
    queue.current = [event]; next();
  }
  function toggleAuto() { if (auto) stop(); setAuto(!auto); }
  function pause() { stop(); setAuto(false); }
  return { events, selected: playback?.event || selected, playback, reduced, auto, select, replay, pause, toggleAuto, finish };
}

function Robot({ station, travelling = false }: { station: OfficeMapStation; travelling?: boolean }) {
  return <span className={s.figure} data-moving={travelling || undefined}>
    <img src={station === "atlas" ? ATLAS_IDENTITY.image : bot} width={64} height={64} alt="" draggable={false}/>
    {travelling && <FileText className={s.parcel} size={12}/>}
  </span>;
}

export function MapAgentLayer({ event, playback, finish }: {
  event: OfficeMapHandoff | null; playback: Playback | null; finish: (key: number) => void;
}) {
  const travelling = playback?.event;
  const current = travelling || event;
  const from = current?.from, to = current?.to;
  const points = useMemo(() => from && to ? officeRoute(from, to) : [], [from, to]);
  const runner = useRef<HTMLSpanElement>(null);
  const sequence = playback?.serial;
  useEffect(() => {
    if (sequence === undefined || !runner.current || points.length < 2) return;
    if (!runner.current.animate) { finish(sequence); return; }
    const { frames, duration } = routeTiming(points);
    const animation = runner.current.animate(frames, { duration, easing: "linear", fill: "forwards" });
    animation.onfinish = () => finish(sequence);
    return () => { animation.onfinish = null; animation.cancel(); };
  }, [sequence, points, finish]);
  return <div className={s.overlay} aria-hidden="true">
    {current && points.map((point, i) => {
      const end = points[i + 1];
      if (!end) return null;
      const vertical = point.x === end.x;
      return <span key={"line" + i} className={s.trail} data-vertical={vertical || undefined} style={{
        left: Math.min(point.x, end.x) + "%", top: Math.min(point.y, end.y) + "%",
        width: vertical ? undefined : Math.abs(point.x - end.x) + "%", height: vertical ? Math.abs(point.y - end.y) + "%" : undefined,
      }}/>;
    })}
    {stations.map(station => {
      const desk = officeDesk(station);
      return <span key={station} data-desk={station} data-facing={desk.x < 50 && station !== "atlas" ? "right" : "left"} data-endpoint={current?.to === station || current?.from === station || undefined}
        className={s.piece} style={{ left: desk.x + "%", top: desk.y + "%", "--station-color": stationColor(station) } as CSSProperties}>
        {travelling?.from !== station && <Robot station={station}/>}
      </span>;
    })}
    {travelling && <span ref={runner} className={s.runner} data-transfer={travelling.id} data-facing={points[points.length - 1].x > points[0].x ? "right" : "left"} style={{
      left: points[0].x + "%", top: points[0].y + "%", "--station-color": stationColor(travelling.from),
    } as CSSProperties}><Robot station={travelling.from} travelling/></span>}
  </div>;
}

type Activity = ReturnType<typeof useMapActivity>;
function openLabel(id: string) {
  if (id.startsWith("meta:")) return "Ver seguimiento de Meta";
  if (id.startsWith("cliente:")) return "Abrir ficha";
  if (id.startsWith("cohorte:")) return "Abrir informe";
  if (id.startsWith("reservas:")) return "Ver reservas";
  return "Abrir encargo";
}
export function MapActivityLog({ activity, loading, error, open }: {
  activity: Activity; loading?: boolean; error?: string | null; open?: (id: string) => void;
}) {
  const { events, selected, playback, reduced, auto, select, replay, pause, toggleAuto } = activity;
  const [limit, setLimit] = useState(4);
  return <section className={s.log} aria-label="Entregas entre departamentos">
    <header className={s.header}><h3>Entregas entre departamentos</h3>
      {events.length > 0 && <small>Hora de Madrid</small>}</header>
    {error && <p className={s.message} role="alert">{error}</p>}
    {loading && <p className={s.message} role="status">Consultando entregas…</p>}
    {!selected && !error && !loading && <p className={s.message}><Clock3 size={15} aria-hidden="true"/> Agentes en espera. Sin entregas registradas en esta consulta.</p>}
    {selected && <>
      <span className={s.sr} role="status">{playback ? "Reproduciendo recorrido registrado" : "Recorrido registrado"} de {stationName(selected.from)} a {stationName(selected.to)}. {selected.what}.</span>
      <div className={s.selected}>
        <img className={s.portrait} src={selected.from === "atlas" ? ATLAS_IDENTITY.image : bot} alt="" width={42} height={42}/>
        <div><small>{selected.id === events[0]?.id ? "Última entrega" : "Entrega seleccionada"}</small><div className={s.direction}><strong>{stationName(selected.from)}</strong><ArrowRight size={13} aria-hidden="true"/><span className={s.sr}> entrega a </span><strong>{stationName(selected.to)}</strong></div>
          <p>{selected.what}</p><small>{selected.taskTitle} · <time dateTime={selected.at}>{madrid.format(new Date(selected.at))}</time></small></div>
      </div>
      <div className={s.actions}>
        {!reduced && <button type="button" onClick={() => playback ? pause() : replay(selected)}>
          {playback ? <Square size={13} aria-hidden="true"/> : <Play size={13} aria-hidden="true"/>}{playback ? "Detener recorrido" : "Reproducir recorrido"}</button>}
        {reduced && <span>Recorrido estático · movimiento reducido</span>}
        {open && <button type="button" onClick={() => open(selected.taskId)}>{openLabel(selected.taskId)}<ArrowUpRight size={14} aria-hidden="true"/></button>}
        {!reduced && <button type="button" aria-pressed={auto} onClick={toggleAuto}>Recorridos automáticos</button>}
      </div>
      {events.length > 1 && <ol className={s.history} aria-label="Historial de entregas">{events.slice(0, limit).map(event =>
        <li key={event.id}><button type="button" aria-pressed={selected.id === event.id} onClick={() => select(event)}>
          <span className={s.historyRoute}>{stationName(event.from)} <span aria-hidden="true">→</span><span className={s.sr}> entrega a </span> {stationName(event.to)}</span>
          <span className={s.historyWhat}>{event.what} · {event.taskTitle}</span><time dateTime={event.at}>{madrid.format(new Date(event.at))}</time>
        </button></li>)}</ol>}
      {events.length > limit && <button type="button" className={s.more} onClick={() => setLimit(count => count + 8)}>Ver más entregas</button>}
    </>}
  </section>;
}
