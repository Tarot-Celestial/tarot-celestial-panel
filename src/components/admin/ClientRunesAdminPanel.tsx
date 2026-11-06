"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Check, ChevronRight, Gem, RefreshCw, Save, Search, ShieldCheck, Sparkles } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { announceClientRunesChange, CLIENT_RUNES_CHANGED } from "@/lib/client-runes-sync";
import styles from "./ClientRunesAdminPanel.module.css";

type Rune = { id: string; enabled: boolean; title: string; benefit: string; updated_at: string };
type Client = { id: string; nombre?: string | null; apellido?: string | null; email?: string | null; telefono?: string | null; rune: Rune | null };
type Draft = { enabled: boolean; title: string; benefit: string };
type SaveRune = (client: Client, draft: Draft, version: string | null) => Promise<Rune | null>;
const DEFAULT_TITLE = "Obsidiana carmesí";
const clientName = (client: Client) => [client.nombre, client.apellido].filter(Boolean).join(" ") || client.email || client.telefono || "Cliente sin nombre";
const toDraft = (rune: Rune | null): Draft => ({ enabled: rune?.enabled ?? false, title: rune?.title || DEFAULT_TITLE, benefit: rune?.benefit || "" });
const sameDraft = (a: Draft, b: Draft) => a.enabled === b.enabled && a.title === b.title && a.benefit === b.benefit;
const formatDate = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "—";

async function authHeaders() {
  const token = (await supabaseBrowser().auth.getSession()).data.session?.access_token;
  if (!token) throw new Error("Tu sesión ha caducado. Vuelve a iniciar sesión.");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export default function ClientRunesAdminPanel() {
  const [query, setQuery] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [updated, setUpdated] = useState<Date | null>(null);
  const request = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true);
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
    try {
      const headers = await authHeaders();
      async function get(url: string): Promise<Client[]> {
        const response = await fetch(url, { headers, cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "No se pudieron consultar las runas de clientes.");
        return result.clients;
      }
      const [results, current] = await Promise.all([
        get(`/api/admin/client-runes?q=${encodeURIComponent(query)}`),
        selectedId ? get(`/api/admin/client-runes?cliente_id=${encodeURIComponent(selectedId)}`) : Promise.resolve(null),
      ]);
      if (controller.signal.aborted || !mounted.current) return;
      setClients(results);
      if (current) setSelected(current.find(client => client.id === selectedId) || null);
      setUpdated(new Date()); setError("");
    } catch (cause) {
      if (!mounted.current || request.current !== controller || controller.signal.aborted && !timedOut) return;
      setError(timedOut ? "La consulta está tardando. Pulsa Actualizar para comprobar el estado."
        : cause instanceof Error ? cause.message : "No se pudo actualizar el panel.");
    } finally {
      window.clearTimeout(timeout);
      if (mounted.current && request.current === controller) setLoading(false);
    }
  }, [query, selectedId]);

  useEffect(() => {
    const debounce = window.setTimeout(() => { if (!writing.current) void load(); }, 250);
    const refresh = () => { if (!document.hidden && !writing.current) void load(); };
    const storage = (event: StorageEvent) => { if (event.key === CLIENT_RUNES_CHANGED) refresh(); };
    const timer = window.setInterval(refresh, 20000);
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh);
    window.addEventListener("storage", storage);
    return () => {
      window.clearTimeout(debounce); window.clearInterval(timer); request.current?.abort();
      window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh);
      window.removeEventListener("storage", storage);
    };
  }, [load]);

  const save: SaveRune = async (client, draft, version) => {
    if (writing.current) return null;
    writing.current = true; request.current?.abort();
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/admin/client-runes", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ cliente_id: client.id, ...draft, expected_updated_at: version, operation_id: crypto.randomUUID() }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        if (response.status === 409) {
          await load();
          throw new Error("La runa cambió en otra sesión. Revisa los datos actuales antes de guardar de nuevo.");
        }
        throw new Error(result.error || "No se pudo guardar la runa.");
      }
      const rune: Rune = result.rune;
      announceClientRunesChange();
      if (!mounted.current) return rune;
      setSelected(previous => previous?.id === client.id ? { ...previous, rune } : previous);
      setClients(previous => previous.map(item => item.id === client.id ? { ...item, rune } : item));
      setUpdated(new Date());
      setMessage(`${rune.enabled ? "Runa activada" : "Runa desactivada"} para ${clientName(client)}. El cambio ya está guardado.`);
      return rune;
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "No se confirmó el guardado. Actualiza para comprobar su estado antes de repetir.");
      return null;
    } finally {
      writing.current = false;
      if (mounted.current) { setBusy(false); setLoading(false); }
    }
  };

  return <section className={styles.root}>
    <header className={styles.hero}>
      <div><span className={styles.eyebrow}>RANGOS DE CLIENTES · RUNAS</span><h1>Una runa, elegida para cada cliente.</h1><p>Activa su colección y escribe la ventaja que verá en su panel.</p></div>
      <button type="button" className={styles.secondary} disabled={busy || loading} onClick={() => void load()}><RefreshCw size={16} aria-hidden="true" />{loading ? "Actualizando…" : "Actualizar"}</button>
    </header>
    <p className={styles.scope}><ShieldCheck size={16} aria-hidden="true" /> La activación es individual. Mostrar una runa no añade Coins, minutos ni otros saldos.</p>
    {message && <div className={styles.success} role="status"><Check size={18} aria-hidden="true" />{message}</div>}
    {error && <div className={styles.error} role="alert">{error}</div>}
    <div className={styles.workspace}>
      <section className={styles.card} aria-labelledby="runes-client-search-title">
        <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>ELIGE A QUIÉN ACTIVARLA</span><h2 id="runes-client-search-title">Buscar cliente</h2></div><Search size={21} aria-hidden="true" /></div>
        <label className={styles.searchLabel}>Nombre, teléfono o correo<input value={query} onChange={event => setQuery(event.target.value)} disabled={busy} placeholder="Busca en tu CRM…" autoComplete="off" /></label>
        <p className={styles.hint} aria-live="polite">{loading ? "Consultando clientes…" : `${clients.length} clientes en esta búsqueda`}</p>
        <div className={styles.clientList}>
          {!loading && !clients.length ? <p className={styles.emptyText}>{error ? "No se pudo cargar la búsqueda." : "No hay clientes que coincidan. Prueba otro nombre, teléfono o correo."}</p> : clients.map(client => <button type="button" className={styles.clientRow} key={client.id} disabled={busy} aria-pressed={selectedId === client.id} onClick={() => { setSelected(client); setSelectedId(client.id); setMessage(""); }}>
            <span className={styles.clientSymbol}><Gem size={19} aria-hidden="true" /></span>
            <span className={styles.clientCopy}><strong>{clientName(client)}</strong><span>{client.telefono || client.email || "Sin datos de contacto"}</span><small>{client.rune?.title || "Sin runa asignada"}</small></span>
            <span className={styles.badge} data-active={!!client.rune?.enabled}>{client.rune?.enabled ? "Activa" : "Sin activar"}</span>
            <ChevronRight size={15} aria-hidden="true" />
          </button>)}
        </div>
        <p className={styles.hint}>{updated ? `Última comprobación: ${updated.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}.` : "Los cambios se guardan en la ficha real del cliente."}</p>
      </section>
      {selected ? <RuneEditor key={selected.id} client={selected} busy={busy} unavailable={!!error || loading} save={save} />
        : <section className={`${styles.card} ${styles.empty}`}><Gem size={38} aria-hidden="true" /><h2>Su colección empieza aquí</h2><p>Selecciona un cliente para ver su runa, escribir su ventaja y decidir si aparece en su panel.</p></section>}
    </div>
  </section>;
}

function RuneEditor({ client, busy, unavailable, save }: { client: Client; busy: boolean; unavailable: boolean; save: SaveRune }) {
  const [base, setBase] = useState<Rune | null>(client.rune);
  const [draft, setDraft] = useState<Draft>(() => toDraft(client.rune));
  const dirty = !sameDraft(draft, toDraft(base));
  const stale = (client.rune?.updated_at || null) !== (base?.updated_at || null);
  useEffect(() => {
    if (!dirty && stale) { setBase(client.rune); setDraft(toDraft(client.rune)); }
  }, [client.rune, dirty, stale]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || unavailable || stale || !dirty || !draft.title.trim() || draft.enabled && !draft.benefit.trim()) return;
    const saved = await save(client, { ...draft, title: draft.title.trim(), benefit: draft.benefit.trim() }, base?.updated_at || null);
    if (saved) { setBase(saved); setDraft(toDraft(saved)); }
  }
  return <section className={styles.card} aria-labelledby="runes-editor-title">
    <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>CONFIGURACIÓN INDIVIDUAL</span><h2 id="runes-editor-title">{clientName(client)}</h2><p>{[client.telefono, client.email].filter(Boolean).join(" · ")}</p></div><span className={styles.badge} data-active={!!client.rune?.enabled}>{client.rune?.enabled ? "Activada" : "Sin activar"}</span></div>
    {stale && dirty && <div className={styles.notice} role="alert"><p>Hay cambios guardados desde otra sesión. Tu borrador sigue aquí; carga la versión actual para continuar.</p><button type="button" className={styles.secondary} disabled={busy} onClick={() => { setBase(client.rune); setDraft(toDraft(client.rune)); }}>Cargar versión actual</button></div>}
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <label className={styles.toggle}><input type="checkbox" checked={draft.enabled} onChange={event => setDraft(previous => ({ ...previous, enabled: event.target.checked }))} /><span>Activar runa para este cliente<small>Al guardar, el cliente verá su runa y la ventaja escrita abajo.</small></span></label>
        <label>Nombre de la runa<input required maxLength={100} value={draft.title} onChange={event => setDraft(previous => ({ ...previous, title: event.target.value }))} /></label>
        <label>Ventaja que verá el cliente<textarea required={draft.enabled} maxLength={2000} rows={5} value={draft.benefit} onChange={event => setDraft(previous => ({ ...previous, benefit: event.target.value }))} placeholder="Escribe la ventaja y sus condiciones con claridad…" /></label>
        <p className={styles.counter}>{draft.benefit.length}/2000</p>
        <div className={styles.preview}><span className={styles.eyebrow}>VISTA PREVIA · SIN GUARDAR</span><div><Sparkles size={22} aria-hidden="true" /><h3>{draft.title.trim() || DEFAULT_TITLE}</h3></div><p>{draft.enabled ? draft.benefit.trim() || "Escribe una ventaja para activar esta runa." : "Esta runa no se mostrará como activada en el panel del cliente."}</p></div>
        <p className={styles.hint}>{base ? `Último cambio guardado: ${formatDate(base.updated_at)}.` : "Este cliente todavía no tiene una runa asignada."} {dirty ? "Tienes cambios sin guardar." : "Sin cambios pendientes."}</p>
        <button type="submit" className={styles.primary} disabled={unavailable || stale || !dirty || !draft.title.trim() || draft.enabled && !draft.benefit.trim()}><Save size={16} aria-hidden="true" />{busy ? "Guardando…" : "Guardar configuración"}</button>
      </fieldset>
    </form>
  </section>;
}
