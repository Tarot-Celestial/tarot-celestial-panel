"use client";

import { useEffect, useState } from "react";
import type { OfficeInstagramPerformance as PerformanceReport } from "@/lib/server/office-instagram-performance";
import { officeRequest } from "./office-client";
import { displayTime } from "./WorkTime";
import styles from "./OfficeWork.module.css";

const count = (value:number|null) => value == null ? "Sin dato" : value.toLocaleString("es-ES");

export default function OfficeInstagramPerformance() {
  const [open,setOpen] = useState(false);
  const [revision,setRevision] = useState(0);
  const [report,setReport] = useState<PerformanceReport|null>(null);
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(false);
  const maxLikes = Math.max(0,...(report?.posts.map(post=>post.likes ?? 0) || []));
  const maxComments = Math.max(0,...(report?.posts.map(post=>post.comments ?? 0) || []));
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    officeRequest<PerformanceReport>("/api/admin/office/instagram/performance",{signal:controller.signal})
      .then(data => { if (!controller.signal.aborted) setReport(data); })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "No se pudo leer Instagram."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  },[open,revision]);
  return <details className={styles.card} onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary>Rendimiento de @tarotcelestialof</summary>
    <div className={styles.stack}>
      {loading && <p role="status">Consultando publicaciones en Instagram…</p>}
      {error && <p role="alert">{error}</p>}
      {report && <>
        <p className={styles.meta}>Últimas {report.posts.length} publicaciones · {displayTime(report.checked_at)} (Madrid). Para elegir una referencia, Atlas compara publicaciones de entre {report.min_age_hours} horas y {report.max_age_days} días.</p>
        <p>{report.basis ? (report.basis === "per_reach"
          ? "Atlas compara los me gusta y comentarios por cuenta alcanzada."
          : "Atlas compara los me gusta y comentarios de publicaciones comparables.") :
          "Todavía faltan datos comparables para elegir una publicación de referencia."}</p>
        {report.posts.length === 0 ? <p>Instagram no devolvió publicaciones.</p> :
          <ul className={styles.stack} aria-label="Resultados por publicación">{report.posts.map(post=><li className={styles.record} key={post.id}>
            <strong>{post.permalink ? <a className={styles.runLink} href={post.permalink} target="_blank" rel="noreferrer">{post.caption?.trim().slice(0,90) || "Ver publicación"}</a> : post.caption?.trim().slice(0,90) || "Publicación de Instagram"}</strong>
            <span>{post.published_at ? displayTime(post.published_at) + " · " : ""}{count(post.likes)} me gusta · {count(post.comments)} comentarios · Alcance {count(post.reach)}</span>
            {(post.likes === maxLikes && maxLikes > 0 || post.comments === maxComments && maxComments > 0) && <span className={styles.meta}>
              {[post.likes === maxLikes && maxLikes > 0 && "Más me gusta de la muestra",post.comments === maxComments && maxComments > 0 && "Más comentarios de la muestra"].filter(Boolean).join(" · ")}
            </span>}
            {post.id === report.variant_source?.id && <strong>Referencia de Atlas para una variante</strong>}
          </li>)}</ul>}
      </>}
      <div><button type="button" className={styles.button} disabled={loading} onClick={()=>setRevision(n=>n+1)}>Actualizar resultados</button></div>
    </div>
  </details>;
}
