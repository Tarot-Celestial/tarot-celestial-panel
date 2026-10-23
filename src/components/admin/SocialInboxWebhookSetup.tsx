"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./SocialChannelAdminPanel.module.css";

type Provider = "instagram" | "facebook";
type Api = (url: string, options?: RequestInit) => Promise<any>;

function diagnosticLines(data: any): string[] {
  if (!data?.ok || (!Array.isArray(data.checks) && !Array.isArray(data.probes) && !data.identity && typeof data.configured !== "boolean")) {
    throw new Error("La comprobación no devolvió un diagnóstico válido. Vuelve a intentarlo.");
  }
  const lines: string[] = [];
  if (data.configured === false) lines.push("Falta completar la configuración del servidor.");
  if (data.identity) lines.push(data.identity.ok ? `Página verificada: ${data.identity.name || data.accountId}` : `Identidad pendiente: ${data.identity.code || "sin verificar"}`);
  for (const check of data.checks || data.probes || []) lines.push(`${check.label}: ${check.ok ? "consulta disponible" : check.code || "pendiente"}${typeof check.count === "number" ? ` · ${check.count} resultados` : ""}`);
  if (data.permissions?.verified === false) lines.push(`Permisos sin verificar${data.permissions.code ? `: ${data.permissions.code}` : "."}`);
  if (data.permissions?.missing?.length) lines.push(`Permisos pendientes: ${data.permissions.missing.join(", ")}`);
  if (data.subscription) {
    lines.push(data.subscription.ready ? "Suscripción de mensajes y comentarios verificada." : `Suscripción de mensajes y comentarios pendiente${data.subscription.code ? `: ${data.subscription.code}` : "."}`);
    if (Array.isArray(data.subscription.fields) && data.subscription.fields.length) lines.push(`Eventos suscritos: ${data.subscription.fields.join(", ")}`);
  }
  if (typeof data.webhookConfigured === "boolean") lines.push(data.webhookConfigured ? "Verificación del webhook configurada en el servidor." : "Falta configurar la verificación del webhook para recibir eventos.");
  if (Array.isArray(data.subscriptions?.items)) {
    if (!data.subscriptions.items.length) lines.push("La página no tiene aplicaciones suscritas a eventos.");
    for (const app of data.subscriptions.items) lines.push(`${app.name || app.id}: ${Array.isArray(app.fields) && app.fields.length ? app.fields.join(", ") : "sin eventos"}`);
  }
  if (data.subscriptions?.ok === false) lines.push(`Suscripciones pendientes: ${data.subscriptions.code || "sin verificar"}`);
  return lines.length ? lines : ["No hay resultados suficientes para confirmar la configuración."];
}

export default function SocialInboxWebhookSetup({ api }: { api: Api }) {
  const [busy, setBusy] = useState<Provider | null>(null);
  const [results, setResults] = useState<Partial<Record<Provider, string[]>>>({});
  const [errors, setErrors] = useState<Partial<Record<Provider, string>>>({});
  const [postId, setPostId] = useState("");
  const [postResult, setPostResult] = useState("");
  const active = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function run(provider: Provider, subscribe = false) {
    if (active.current) return;
    active.current = true;
    setBusy(provider);
    setErrors(previous => ({ ...previous, [provider]: "" }));
    setResults(previous => ({ ...previous, [provider]: undefined }));
    try {
      if (subscribe) {
        const receipt = await api(`/api/central/${provider}?action=subscribe`, { method: "POST", body: JSON.stringify({ confirmed: true }) });
        if (receipt?.ok !== true) throw new Error("No se pudo confirmar la suscripción. Comprueba la conexión antes de intentarlo de nuevo.");
      }
      const data = await api(`/api/central/${provider}?action=diagnostics`);
      const lines = diagnosticLines(data);
      if (subscribe) lines.unshift("La red confirmó la suscripción solicitada. Revisa los resultados de configuración a continuación.");
      if (mounted.current) setResults(previous => ({ ...previous, [provider]: lines }));
    } catch (error) {
      if (mounted.current) setErrors(previous => ({ ...previous, [provider]: error instanceof Error ? error.message : "No se pudo comprobar la conexión." }));
    } finally { active.current = false; if (mounted.current) setBusy(null); }
  }

  async function importPost() {
    if (active.current) return;
    const id = postId.trim();
    if (!/^\d{1,40}(?:_\d{1,40})?$/.test(id)) {
      setErrors(previous => ({ ...previous, facebook: "Introduce el ID de la publicación de Facebook." }));
      return;
    }
    active.current = true;
    setBusy("facebook");
    setPostResult("");
    setErrors(previous => ({ ...previous, facebook: "" }));
    try {
      const data = await api("/api/central/facebook?action=sync-post", { method: "POST", body: JSON.stringify({ postId: id }) });
      if (data?.ok !== true || !Number.isSafeInteger(data.processed)) throw new Error("No se pudo confirmar la importación. Vuelve a comprobar la bandeja.");
      if (mounted.current) setPostResult(`${data.processed} comentarios revisados. ${data.continuationQueued ? "El historial restante seguirá importándose automáticamente." : "La publicación queda en seguimiento automático."} Puedes verlos en Centrales → Facebook.`);
    } catch (error) {
      if (mounted.current) setErrors(previous => ({ ...previous, facebook: error instanceof Error ? error.message : "No se pudo importar la publicación." }));
    } finally { active.current = false; if (mounted.current) setBusy(null); }
  }

  return <section className={styles.card}>
    <h3>Sincronización de las bandejas de Centrales</h3>
    <p>Comprueba los permisos y activa la recepción de mensajes y comentarios. Los formularios de captación mantienen su conexión.</p>
    <p>La recepción se confirma cuando llega un mensaje o comentario real a la bandeja.</p>
    {(["instagram", "facebook"] as const).map(provider => <div key={provider} aria-busy={busy === provider}>
      <h4>{provider === "instagram" ? "Instagram" : "Facebook"}</h4>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} disabled={!!busy} onClick={() => void run(provider)}>Comprobar {provider === "instagram" ? "Instagram" : "Facebook"}</button>
        <button type="button" className={styles.primary} disabled={!!busy} onClick={() => void run(provider, true)}>Activar recepción de {provider === "instagram" ? "Instagram" : "Facebook"}</button>
      </div>
      {provider === "facebook" && <div className={styles.formStack}>
        <label htmlFor="facebook-post-import">Recuperar comentarios de una publicación o anuncio</label>
        <p>Introduce el ID de la publicación de Facebook. Se comprobará que pertenece a tu página y continuará en seguimiento aunque no aparezca entre las publicaciones recientes.</p>
        <div className={styles.actions}>
          <input id="facebook-post-import" aria-label="ID de la publicación de Facebook" value={postId} onChange={event => setPostId(event.target.value)} maxLength={81} placeholder="ID de Facebook, por ejemplo página_publicación" disabled={!!busy} />
          <button type="button" className={styles.secondary} disabled={!!busy || !postId.trim()} onClick={() => void importPost()}>Importar comentarios</button>
        </div>
        {postResult && <p role="status">{postResult}</p>}
      </div>}
      <div aria-live="polite">
        {errors[provider] && <p role="alert" className={`${styles.notice} ${styles.noticeError}`}>{errors[provider]}</p>}
        {results[provider] && <ul>{results[provider]!.map((line, index) => <li key={index}>{line}</li>)}</ul>}
      </div>
    </div>)}
  </section>;
}
