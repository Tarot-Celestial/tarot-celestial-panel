"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./ClientBalancesPanel.module.css";

type Client = { id: string; nombre: string; apellido: string; telefono: string; email: string };
type Detail = { cliente: Client; wallet: { coins: number; minutes_free: number; minutes_normal: number; minutes_total: number; effective_rank: string }; spins: { level: number; count: number }[]; history: { operation_id: string; nivel: number; delta: number; reason: string; before_count: number; after_count: number; created_at: string }[] };
const name = (c: Client) => [c.nombre, c.apellido].filter(Boolean).join(" ") || "Cliente sin nombre";
class RequestError extends Error { constructor(message: string, readonly definitive: boolean) { super(message); } }
async function request(url: string, init: RequestInit = {}) {
  const token = (await supabaseBrowser().auth.getSession()).data.session?.access_token;
  const response = await fetch(url, { ...init, cache: "no-store", headers: { Authorization: `Bearer ${token || ""}`, "Content-Type": "application/json" } });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new RequestError(data.error || "No se pudo completar la operación.", response.status >= 400 && response.status < 500);
  return data;
}

export default function ClientBalancesPanel() {
  const [query, setQuery] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Client | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [level, setLevel] = useState(1);
  const [direction, setDirection] = useState(1);
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [updated, setUpdated] = useState("");
  const active = useRef("");
  const version = useRef(0);
  const saving = useRef(false);
  const operation = useRef<string | null>(null);
  const searchVersion = useRef(0);

  const refresh = useCallback(async (id: string) => {
    const current = ++version.current;
    try {
      const data = await request(`/api/admin/client-balances?id=${encodeURIComponent(id)}`);
      if (active.current !== id || version.current !== current) return;
      setDetail(data); setUpdated(new Date().toLocaleTimeString("es-ES")); setError("");
    } catch (e) {
      if (active.current === id && version.current === current) setError(e instanceof Error ? e.message : "Error al consultar los saldos.");
    }
  }, []);
  useEffect(() => {
    if (!selected) return;
    const id = selected.id;
    void refresh(id);
    const update = () => { if (!document.hidden && !saving.current) void refresh(id); };
    const timer = window.setInterval(update, 15000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); ++version.current; };
  }, [selected, refresh]);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    const current = ++searchVersion.current;
    setSearching(true); setError("");
    try {
      const data = await request(`/api/admin/client-balances?q=${encodeURIComponent(query)}`);
      if (current === searchVersion.current) { setClients(data.clients); setSearched(true); }
    } catch (e) { if (current === searchVersion.current) setError(e instanceof Error ? e.message : "Error al buscar."); }
    finally { if (current === searchVersion.current) setSearching(false); }
  }
  function choose(client: Client) {
    active.current = client.id; ++version.current;
    setSelected(client); setDetail(null); setError(""); setMessage(""); setReason(""); setUpdated(""); operation.current = null;
  }
  async function adjust(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || saving.current) return;
    saving.current = true; setBusy(true); setError(""); setMessage(""); ++version.current;
    operation.current ||= crypto.randomUUID();
    const id = selected.id;
    try {
      await request("/api/admin/client-balances", { method: "POST", body: JSON.stringify({ operation_id: operation.current, cliente_id: id, level, delta: direction * Number(quantity), reason }) });
      operation.current = null; setUncertain(false); setReason(""); setMessage("Ajuste guardado en la cuenta y en la ficha del cliente.");
      await refresh(id);
    } catch (e) {
      const definitive = e instanceof RequestError && e.definitive;
      setUncertain(!definitive);
      if (definitive) operation.current = null;
      setError(e instanceof Error ? e.message : "No se pudo confirmar el ajuste. Reintenta.");
    }
    finally { saving.current = false; setBusy(false); }
  }
  const locked = busy || uncertain;
  const count = detail?.spins.find(s => s.level === level)?.count ?? 0;
  const valid = Number.isInteger(Number(quantity)) && Number(quantity) >= 1 && Number(quantity) <= 100 && reason.trim().length >= 3;
  return <section className={styles.panel} aria-label="Giros y saldos de clientes">
    <header><span className={styles.eyebrow}>CONTROL DE CLIENTES</span><h2>Giros y saldos</h2><p>Consulta Coins y minutos disponibles y ajusta los giros de cada nivel.</p></header>
    <form onSubmit={search} className={styles.search}><label>Buscar cliente<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nombre, teléfono o correo" minLength={2} required disabled={locked} /></label><button disabled={searching || locked || query.trim().length < 2}>{searching ? "Buscando…" : "Buscar"}</button></form>
    {searched && <div className={styles.results}>{clients.length ? clients.map(c => <button key={c.id} type="button" disabled={locked} aria-pressed={selected?.id === c.id} onClick={() => choose(c)}><strong>{name(c)}</strong><span>{c.telefono || c.email || c.id}</span></button>) : <p>No se encontraron clientes.</p>}</div>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {message && <p role="status" className={styles.success}>{message}</p>}
    {selected && <><div className={styles.heading}><div><h3>{name(selected)}</h3><p>{selected.telefono} · {selected.email}</p></div><button type="button" disabled={busy} onClick={() => void refresh(selected.id)}>Actualizar saldos</button></div>
      {!detail ? <p>{error ? "Pulsa Actualizar saldos para reintentar." : "Cargando saldos…"}</p> : <>
        <p className={styles.muted}>Última consulta: {updated} · Actualización automática cada 15 segundos · Rango: {detail.wallet.effective_rank || "Sin rango"}</p>
        <div className={styles.cards}><article><span>Coins disponibles</span><strong>{detail.wallet.coins}</strong></article><article><span>Minutos disponibles</span><strong>{detail.wallet.minutes_total}</strong></article><article><span>Minutos normales</span><strong>{detail.wallet.minutes_normal}</strong></article><article><span>Minutos FREE</span><strong>{detail.wallet.minutes_free}</strong></article></div>
        <h3>Giros pendientes por nivel</h3><div className={styles.cards}>{detail.spins.map(s => <article key={s.level}><span>Nivel {s.level}{s.level === 4 ? " · Especial" : s.level === 5 ? " · Diamante" : ""}</span><strong>{s.count}</strong></article>)}</div>
        <p className={styles.muted}>Los giros Diamante mantienen los requisitos de acceso del rango. Solo se pueden retirar giros pendientes.</p>
        <form onSubmit={adjust} className={styles.adjust}><h3>Ajustar giros</h3><fieldset disabled={locked}><div className={styles.fields}><label>Nivel<select value={level} onChange={e => setLevel(Number(e.target.value))}>{[1,2,3,4,5].map(n => <option key={n} value={n}>Nivel {n}</option>)}</select></label><label>Operación<select value={direction} onChange={e => setDirection(Number(e.target.value))}><option value={1}>Añadir</option><option value={-1}>Retirar</option></select></label><label>Cantidad<input type="number" min={1} max={100} step={1} value={quantity} onChange={e => setQuantity(e.target.value)} required /></label></div><label>Motivo del ajuste<textarea value={reason} onChange={e => setReason(e.target.value)} minLength={3} maxLength={500} required placeholder="Explica el motivo para el historial" /></label></fieldset>
        <p>{direction === 1 ? "Añadir" : "Retirar"} {quantity || "0"} giro(s) de nivel {level} a {name(selected)}. Disponibles: {count}.</p>
        {uncertain && <p>Reintenta este mismo ajuste para confirmar su resultado sin duplicarlo.</p>}
        <button disabled={busy || !valid || (!uncertain && direction < 0 && Number(quantity) > count)}>{busy ? "Guardando…" : uncertain ? "Reintentar el mismo ajuste" : "Guardar ajuste"}</button></form>
        <h3>Últimos ajustes administrativos</h3>{detail.history.length === 0 ? <p className={styles.muted}>Este cliente aún no tiene ajustes administrativos.</p> : <div className={styles.history}>{detail.history.map(h => <article key={h.operation_id}><strong>Nivel {h.nivel} · {h.delta > 0 ? "+" : ""}{h.delta} giros · {h.before_count} → {h.after_count}</strong><p>{h.reason}</p><time>{new Date(h.created_at).toLocaleString("es-ES")}</time></article>)}</div>}
      </>}
    </>}
  </section>;
}
