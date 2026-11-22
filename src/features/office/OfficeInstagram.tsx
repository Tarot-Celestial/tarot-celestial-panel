"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { Instagram } from "lucide-react";
import type { OfficeVersion } from "./model";
import { officeRequest } from "./office-client";
import OfficeMedia, { previewableMedia } from "./OfficeMedia";
import { deadlineCandidates, displayTime } from "./WorkTime";
import s from "./OfficeWork.module.css";

const path = "/api/admin/office/instagram";
const zones = ["Europe/Madrid", "America/Puerto_Rico"] as const;
type Zone = typeof zones[number];
const statusNames = {
  queued: "En cola", preparing: "Preparando el archivo", container_ready: "Archivo preparado en Meta",
  dispatching: "Enviando a Instagram", verifying: "Verificando publicación", published: "Publicada",
  invalidated: "Aprobación invalidada", failed: "Fallida", cancelled: "Cancelada",
};
type Post = {
  id: string; version_id?: string; status: keyof typeof statusNames; scheduled_at: string | null; time_zone: Zone;
  container_id: string | null; external_post_id: string | null; permalink: string | null;
  last_error: string | null; updated_at: string;
  metrics: { likes?: number | null; comments?: number | null; reach?: number | null; period?: string | null; checked_at?: string | null } | null;
};
type Preparation = {
  connection: {
    username: string | null; account_id: string | null; owner_id: string | null; checked_at: string | null;
    expires_at: string | null; connected_at: string | null; permissions: string[]; can_publish: boolean; message: string;
    bind_on_approval?: boolean; account_type?: string | null; permission_source?: string | null;
  };
  caption: string; alt_text: string; media_sha256: string | null; media_type: string | null;
  offer: string | null; posts: Post[]; eligible: boolean; message?: string;
};
const active = (status: Post["status"]) => ["queued", "preparing", "container_ready", "dispatching", "verifying"].includes(status);
const cancellable = (status: Post["status"]) => ["queued", "preparing", "container_ready"].includes(status);
const prettyTime = (date: string, zone: string) => displayTime(date, zone) + " (" + zone + ")";
const err = (e: unknown) => e instanceof Error ? e.message : "No se pudo completar la consulta a Instagram.";

function instagramLink(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["instagram.com", "www.instagram.com"].includes(url.hostname) ? url.href : null;
  } catch { return null; }
}

function Receipt({ post, busy, send }: { post: Post; busy: boolean; send: (action: "cancel" | "refresh", id: string) => void }) {
  const label = post.status === "queued" && post.scheduled_at && Date.parse(post.scheduled_at) > Date.now() ? "Programada"
    : post.status === "published" && !post.external_post_id ? statusNames.verifying : statusNames[post.status];
  const permalink = instagramLink(post.permalink);
  const metrics = post.metrics;
  const zone = post.time_zone || "Europe/Madrid";
  return <article className={s.record} aria-label="Seguimiento de publicación">
    <div className={s.row}><strong role="status">{label}</strong>
      {permalink && post.external_post_id && post.status === "published" &&
        <a className={s.runLink} href={permalink} target="_blank" rel="noopener noreferrer">Ver en Instagram</a>}
    </div>
    <dl className={s.fields}>
      <div><dt>Horario aprobado</dt><dd>{post.scheduled_at ? prettyTime(post.scheduled_at, zone) : "Publicación inmediata"}</dd></div>
      <div><dt>Última actualización</dt><dd>{prettyTime(post.updated_at, zone)}</dd></div>
      {post.container_id && <div><dt>Contenedor de Meta</dt><dd>{post.container_id}</dd></div>}
      {post.external_post_id && <div><dt>ID de publicación</dt><dd>{post.external_post_id}</dd></div>}
    </dl>
    {post.last_error && <p className={s.body}>{post.last_error}</p>}
    {post.status === "published" && <div className={s.stack}>
      <h5>Estadísticas de la publicación</h5>
      <dl className={s.fields}>
        {([["likes","Me gusta"],["comments","Comentarios"],["reach","Alcance"]] as const).map(([key,name]) => {
          const value = metrics?.[key];
          return <div key={key}><dt>{name}</dt><dd>{typeof value === "number" ? value.toLocaleString("es-ES") : "Sin datos"}</dd></div>;
        })}
        <div><dt>Periodo</dt><dd>{metrics?.period === "lifetime" ? "Desde la publicación" : metrics?.period || "Sin datos"}</dd></div>
        <div><dt>Consulta de estadísticas</dt><dd>{metrics?.checked_at ? prettyTime(metrics.checked_at, zone) : "Sin datos"}</dd></div>
      </dl>
    </div>}
    <div className={s.actions}>
      {cancellable(post.status) && <button type="button" className={s.button} disabled={busy} onClick={() => send("cancel",post.id)}>Cancelar publicación</button>}
      {(post.status === "verifying" || post.status === "published") && <button type="button" className={s.button} disabled={busy} onClick={() => send("refresh",post.id)}>
        {post.status === "published" && post.external_post_id ? "Actualizar recibo y estadísticas" : "Reanudar comprobación"}
      </button>}
    </div>
  </article>;
}

const disconnected: Preparation["connection"] = { username: null, account_id: null, owner_id: null, checked_at: null,
  expires_at: null, connected_at: null, permissions: [], can_publish: false, message: "Conecta Instagram desde Redes sociales." };

export default function OfficeInstagram({ version, current, onApproved }: {
  version: OfficeVersion; current: boolean; onApproved?: () => Promise<void>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Preparation | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [paused, setPaused] = useState(false);
  const [loadedSha, setLoadedSha] = useState("");
  const [mode, setMode] = useState<"now" | "scheduled">("now");
  const [zone, setZone] = useState<Zone>("Europe/Madrid");
  const [date, setDate] = useState("");
  const [fold, setFold] = useState("");
  const lock = useRef(false);
  const last = useRef<{ key: string; id: string } | null>(null);
  const refreshView = () => setRefresh(n => n + 1);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined, checks = 0;
    setReading(true);
    setPaused(false);
    setProblem("");
    async function read() {
      try {
        const snapshot = await officeRequest<Preparation>(path + "?version_id=" + encodeURIComponent(version.id), { signal: controller.signal });
        if (controller.signal.aborted) return;
        setData(snapshot);
        if (snapshot.posts.some(p => active(p.status))) {
          if (++checks < 24) timer = setTimeout(read, 6000);
          else setPaused(true);
        }
      } catch (e) { if (!controller.signal.aborted) setProblem(err(e)); }
      finally { if (!controller.signal.aborted) setReading(false); }
    }
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [open, refresh, version.id, version.status, current]);

  async function mutate(body: Record<string,string | null>, message: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice("");
    try {
      await officeRequest(path, { method: "POST", body: JSON.stringify(body) });
      setNotice(message);
      if (body.action === "approve" && version.status === "pendiente") {
        try { await onApproved?.(); }
        catch { setNotice(message + " Actualiza la Oficina para ver el estado del entregable."); }
      }
      if (body.action === "cancel") last.current = null;
    } catch (e) { setNotice(err(e)); }
    finally { lock.current = false; setBusy(false); setReading(true); refreshView(); }
  }
  const connection = data?.connection || disconnected;
  const reviewable = current && (version.status === "aprobado" || version.status === "pendiente");
  const candidates = mode === "scheduled" && date ? deadlineCandidates(date, zone) : [];
  const scheduledAt = mode === "now" ? null : candidates.length === 1 ? candidates[0] : candidates.includes(fold) ? fold : null;
  const maySchedule = mode === "now" || (!!scheduledAt && Date.parse(scheduledAt) > Date.now());
  const hasOpenOrPublished = data?.posts.some(p => active(p.status) || p.status === "published");
  const mayApprove = !!(reviewable && data?.eligible && connection.can_publish &&
    connection.username && connection.account_id && connection.owner_id && data.media_sha256 && data.media_sha256 === loadedSha &&
    !hasOpenOrPublished && !busy && !reading && !problem);
  async function approve(e: FormEvent) {
    e.preventDefault();
    if (!mayApprove || !data?.media_sha256 || !maySchedule || (scheduledAt && Date.parse(scheduledAt) <= Date.now())) return;
    const payload = { action: "approve", version_id: version.id, account_id: connection.account_id, username: connection.username,
      connection_owner: connection.owner_id, connected_at: connection.connected_at, caption: data.caption, alt_text: data.alt_text,
      offer: data.offer, media_sha256: data.media_sha256, scheduled_at: scheduledAt, time_zone: zone };
    // Preserve a request ID across uncertain responses, then allow a fresh approval after a confirmed terminal attempt.
    const key = JSON.stringify([payload, data.posts.map(post => post.id)]);
    if (last.current?.key !== key) last.current = { key, id: crypto.randomUUID() };
    await mutate({ ...payload, request_id: last.current.id }, "Aprobación registrada. Puedes seguir el envío en esta ficha.");
  }
  function handleReceipt(action: "cancel" | "refresh", postId: string) {
    return mutate({ action, id: postId }, action === "cancel" ? "Solicitud de cancelación recibida." : "Comprobación solicitada.");
  }
  const versionPosts = data?.posts.filter(p => !p.version_id || p.version_id === version.id) || [];
  return <section className={s.section} aria-label="Instagram">
    <div><button type="button" className={s.button} aria-expanded={open} aria-controls={id} onClick={() => {
      setLoadedSha(""); setData(null); setNotice(""); setProblem(""); setOpen(v => !v);
    }}><Instagram size={16} aria-hidden /> {current ? "Preparar publicación en Instagram" : "Ver historial de Instagram"}</button></div>
    {open && <div id={id} className={s.stack}>
      <div className={s.row}><h5>Instagram · Versión {version.version}</h5>
        <button type="button" className={s.button} onClick={refreshView} disabled={busy || reading}>Actualizar estado</button></div>
      {reading && !data && <p role="status">Consultando versión y cuenta…</p>}
      {problem && <p className={s.error} role="alert">{problem}</p>}
      {notice && <p role="status">{notice}</p>}
      {data && <>
        <dl className={s.fields}>
          <div><dt>Cuenta de destino</dt><dd>{connection.username ? "@" + connection.username.replace(/^@/, "") : "Pendiente de conexión"}</dd></div>
          {connection.account_id && <div><dt>ID de cuenta</dt><dd>{connection.account_id}</dd></div>}
          {connection.account_type && <div><dt>Tipo de cuenta</dt><dd>{connection.account_type}</dd></div>}
          <div><dt>Última comprobación</dt><dd>{connection.checked_at ? prettyTime(connection.checked_at, zone) : "Sin comprobar"}</dd></div>
          {connection.expires_at && <div><dt>Caducidad de la conexión</dt><dd>{prettyTime(connection.expires_at, zone)}</dd></div>}
          <div className={s.wide}><dt>Permisos de la conexión</dt><dd>{connection.permissions?.join(", ") || "Sin datos"}</dd></div>
          {connection.permission_source === "reported" && <div><dt>Comprobación de permisos</dt><dd>Permisos informados por Meta</dd></div>}
          {connection.permission_source === "quota" && <div><dt>Comprobación de permisos</dt><dd>Acceso a la cuota de publicación de Meta</dd></div>}
        </dl>
        {connection.message && <p>{connection.message}</p>}
        <a className={s.runLink} href="/admin?tab=redes-sociales">Gestionar conexión y desconexión en Redes sociales</a>
        {current && <div className={s.record}>
          <h5>Vista previa de la publicación</h5>
          {data.media_sha256 && data.media_type && previewableMedia(data.media_type) &&
            <OfficeMedia key={version.id + data.media_sha256} versionId={version.id} instagramSha={data.media_sha256} type={data.media_type}
              alt={data.alt_text || version.title} onReady={ok => setLoadedSha(ok ? data.media_sha256 || "" : "")} />}
          <dl className={s.fields}>
            <div className={s.wide}><dt>Texto para Instagram</dt><dd className={s.body}>{data.caption || "Sin texto"}</dd></div>
            <div className={s.wide}><dt>Texto alternativo</dt><dd className={s.body}>{data.alt_text || "Sin texto alternativo"}</dd></div>
            <div className={s.wide}><dt>Oferta</dt><dd>{data.offer || "Sin promoción"}</dd></div>
          </dl>
        </div>}
        {data.message && <p>{data.message}</p>}
        {versionPosts.map(post => <Receipt key={post.id} post={post} busy={busy || reading} send={handleReceipt} />)}
        {current && hasOpenOrPublished && !versionPosts.some(p => active(p.status) || p.status === "published") &&
          <p>Ya se autorizó otra versión de este entregable. Puedes consultar el recibo en «Versiones anteriores».</p>}
        {paused && <p className={s.muted}>La consulta automática ha terminado. Usa «Actualizar estado» para continuar el seguimiento.</p>}
        {reviewable && !hasOpenOrPublished && <form className={s.subform} onSubmit={approve}>
          <fieldset disabled={busy} className={s.formGrid} aria-label="Horario de publicación">
            <label htmlFor={id + "-mode"}>Cuándo publicar
              <select id={id + "-mode"} aria-label="Cuándo publicar" value={mode} onChange={e => setMode(e.target.value as typeof mode)}>
                <option value="now">Ahora</option><option value="scheduled">Programar</option>
              </select></label>
            <label htmlFor={id + "-zone"}>Zona de la campaña
              <select id={id + "-zone"} aria-label="Zona de la campaña" value={zone} onChange={e => { setZone(e.target.value as Zone); setFold(""); }}>
                {zones.map(z => <option key={z} value={z}>{z}</option>)}
              </select></label>
            {mode === "scheduled" && <label className={s.wide}>Fecha y hora local
              <input type="datetime-local" required value={date} onChange={e => { setDate(e.target.value); setFold(""); }} />
            </label>}
            {candidates.length > 1 && <label className={s.wide}>Esta hora se repite al cambiar el horario
              <select required aria-label="Hora en el cambio de horario" value={fold} onChange={e => setFold(e.target.value)}>
                <option value="">Selecciona una de las dos horas</option>{candidates.map((v,i) => <option key={v} value={v}>{i ? "Segunda" : "Primera"} · {v.slice(11,16)} UTC</option>)}
              </select></label>}
          </fieldset>
          {mode === "scheduled" && date && !candidates.length && <p role="alert">Esta hora no existe en la zona elegida.</p>}
          {scheduledAt && <p className={s.meta}>Horario de envío · {prettyTime(scheduledAt, zone)} · {displayTime(scheduledAt,"UTC")} UTC</p>}
          {scheduledAt && !maySchedule && <p role="alert">Elige una fecha y hora futuras.</p>}
          {version.status === "pendiente" && <p>Al confirmar, aprobarás esta versión del entregable y su publicación con la cuenta y el horario que aparecen aquí.</p>}
          {connection.bind_on_approval && <p>Al aprobar, vincularás esta cuenta a la Oficina como administrador responsable.</p>}
          <div><button type="submit" className={s.primary} disabled={!mayApprove || !maySchedule}>
            {mode === "now" ? "Aprobar y publicar ahora" : "Aprobar y programar"}
          </button></div>
        </form>}
      </>}
    </div>}
  </section>;
}
