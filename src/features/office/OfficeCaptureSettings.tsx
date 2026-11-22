"use client";

import { useEffect, useRef, useState } from "react";
import { officeRequest } from "./office-client";
import OfficeFormWhatsApp from "./OfficeFormWhatsApp";
import s from "./OfficeMonthlyReport.module.css";

const path = "/api/admin/office/capture-settings";
const countries: Record<string, string> = { PR: "Puerto Rico", US: "Estados Unidos", ES: "España", DO: "República Dominicana", CL: "Chile" };
const health: Record<string, string> = { connected: "Bandeja accesible", checked: "Sincronización comprobada", partial: "Sincronización parcial",
  paused: "En pausa por la regla de autonomía",
  cooldown: "En espera de sincronización", blocked: "Revisar conexión", offline: "Sin conexión", not_configured: "Pendiente de conexión", unavailable: "No disponible",
  not_authorized: "Pendiente de autorización" };
type Settings = { enabled: boolean; last_round_at: string | null; last_round: {social: {channel: string; state: string}[]; whatsapp: string} | null;
  lines: {country: string; phone: string; enabled: boolean}[] };

export default function OfficeCaptureSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  useEffect(() => {
    const abort = new AbortController();
    officeRequest<Settings>(path, { signal: abort.signal }).then(value => {
      if (!abort.signal.aborted) { setSettings(value); setError(""); }
    }).catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "No se pudo leer la configuración."); });
    return () => abort.abort();
  }, [refresh]);
  async function change(enabled: boolean, country?: string) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError("");
    try {
      await officeRequest(path, { method: "POST", body: JSON.stringify({ enabled, country }) });
      setSettings(await officeRequest<Settings>(path));
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar el cambio."); }
    finally { saving.current = false; setBusy(false); }
  }
  const last = settings?.last_round;
  return <section className={s.section} aria-label="Respuestas automáticas">
    <h3 className={s.subheading}>Respuestas automáticas</h3>
    {error && <p role="alert" className={s.notice}>{error} <button type="button" onClick={() => setRefresh(n => n + 1)}>Volver a consultar</button></p>}
    {settings ? <>
      <div className={s.controls}><p role="status" className={s.note}>{settings.enabled ? "Habilitadas según las reglas de Autonomía" : "En pausa"}</p>
        <button type="button" disabled={busy} onClick={() => change(!settings.enabled)}>{settings.enabled ? "Pausar respuestas" : "Activar respuestas"}</button></div>
      <p className={s.note}>Marketing atiende consultas en el canal de entrada. Si conoce el país, ofrece su línea habilitada o el Oráculo. Si necesita saber el país, lo pregunta.</p>
      {settings.last_round_at && <p className={s.note}>Última ronda · {new Intl.DateTimeFormat("es-ES", {timeZone:"Europe/Madrid",dateStyle:"short",timeStyle:"short"}).format(new Date(settings.last_round_at))} (Madrid)</p>}
      {last && <p className={s.note}>{[...last.social.map(ch => ch.channel + " · " + (health[ch.state] || ch.state)), "WhatsApp · " + (health[last.whatsapp] || last.whatsapp)].join(" / ")}</p>}
      <details className={s.details}><summary>Líneas de atención por país</summary>
        <div className={s.scroll}><table className={s.table}><caption>Directorio de Marketing · números contrastados con Premium Numbers</caption><thead><tr><th>País</th><th>Línea</th><th>Uso en respuestas</th></tr></thead>
          <tbody>{settings.lines.map(line => <tr key={line.country}><th scope="row">{countries[line.country] || line.country}</th><td>{line.phone}</td><td>
            <label><input type="checkbox" checked={line.enabled} disabled={busy} aria-label={"Ofrecer línea de " + (countries[line.country] || line.country)} onChange={e => change(e.target.checked, line.country)}/> {line.enabled ? "Habilitada" : "En pausa"}</label>
          </td></tr>)}</tbody></table></div>
        <p className={s.note}>Actualiza este directorio cuando cambie un encaminamiento en Premium Numbers.</p>
      </details>
      <OfficeFormWhatsApp/>
    </> : !error && <p role="status" className={s.note}>Consultando las líneas y la actividad…</p>}
  </section>;
}
