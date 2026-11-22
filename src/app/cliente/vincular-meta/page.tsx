"use client";

import { useEffect, useState } from "react";
import ClientAuthShell from "@/components/cliente/ClientAuthShell";
import css from "@/components/cliente/ClientAuthShell.module.css";
import { clientLoginHref } from "@/lib/client-entry";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";

const api = "/api/cliente/meta-attribution";
type Destination = "oracle" | "panel";
async function request(action?: string, bearer?: string, signal?: AbortSignal) {
  const headers = new Headers();
  if (action) headers.set("Content-Type","application/json");
  if (bearer) headers.set("Authorization","Bearer " + bearer);
  const ref = new URLSearchParams(window.location.search).get("ref") || "";
  const res = await fetch(api+"?ref="+encodeURIComponent(ref),{method:action ? "POST" : "GET",credentials:"same-origin",cache:"no-store",headers,signal,
    body:action ? JSON.stringify({action}) : undefined});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "No se pudo consultar el enlace.");
  return data;
}
export default function MetaPanelEntry() {
  const [destination,setDestination] = useState<Destination | null>(null);
  const [code,setCode] = useState("");
  const [confirmed,setConfirmed] = useState(false);
  const [copied,setCopied] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [attempt,setAttempt] = useState(0);
  const target = destination === "oracle" ? "/cliente/oraculo" : "/cliente/dashboard";
  const name = destination === "oracle" ? "Oráculo" : "panel de clientes";
  useEffect(() => {
    const controller = new AbortController();
    request(undefined,undefined,controller.signal).then(data => {
      if (!controller.signal.aborted) setDestination(data.destination);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  },[attempt]);
  async function enter(identify: boolean) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const visit = await request("visit");
      const url = visit.destination === "oracle" ? "/cliente/oraculo" : "/cliente/dashboard";
      if (!identify) { window.location.assign(url); return; }
      const session = await supabaseClienteBrowser().auth.getSession();
      if (session.error) throw new Error("No se pudo comprobar tu sesión.");
      const bearer = session.data.session?.access_token;
      if (!bearer) { window.location.assign(clientLoginHref("vincular-meta",window.location.search)); return; }
      const data = await request("challenge",bearer);
      setConfirmed(data.state==="confirmed"); setCopied(false); setCode(data.code || "");
    } catch(e) { setError(e instanceof Error ? e.message : "No se pudo continuar."); }
    finally { setBusy(false); }
  }
  return <ClientAuthShell eyebrow="Tarot Celestial" title={destination ? "Tu acceso al " + name : "Acceso al panel"}
    subtitle="Puedes vincular tu conversación privada con tu ficha para que nuestro equipo reconozca tu primera compra.">
    <div className={css.form}>
      {error && <p className={css.errorText} role="alert">{error}</p>}
      {!destination && (error ? <><button type="button" className={css.primaryButton} onClick={()=>{setError("");setAttempt(n=>n+1);}}>Reintentar</button>
        <a href="/cliente/login">Abrir el panel de clientes</a></> : <p role="status">Consultando enlace…</p>)}
      {destination && !code && !confirmed && <>
        <button type="button" className={css.primaryButton} disabled={busy} onClick={()=>enter(true)}>Vincular mi conversación</button>
        <button type="button" className={css.linkButton} disabled={busy} onClick={()=>enter(false)}>Entrar al {name} sin vincular</button>
      </>}
      {code && <><p>Envía este código como único mensaje en el mismo chat privado donde recibiste el enlace. Es válido durante 15 minutos desde su emisión.</p>
        <strong aria-label="Código de vinculación">{code}</strong>
        <button type="button" className={css.linkButton} onClick={async()=>{
          try { await navigator.clipboard.writeText(code); setCopied(true); }
          catch { setError("Selecciona y copia el código de la pantalla."); }
        }}>{copied ? "Código copiado" : "Copiar código"}</button>
        <button type="button" className={css.linkButton} disabled={busy} onClick={()=>enter(true)}>Comprobar vinculación</button></>}
      {confirmed && <p role="status">Tu conversación está vinculada a tu ficha.</p>}
      {(confirmed || code) && <a className={css.primaryButton} href={target}>Continuar al {name}</a>}
    </div>
  </ClientAuthShell>;
}
