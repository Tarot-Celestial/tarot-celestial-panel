"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./ClientBalancesPanel.module.css";

type Client = { id: string; nombre: string; apellido: string; telefono: string; email: string };
type CoinsAdjustment = { operation_id: string; amount: number; reason: string; before_balance: number; after_balance: number; created_at: string; movement_id: string | null };
type OracleGrant = CoinsAdjustment & { cliente_id: string; actor_name: string | null; actor_user_id: string; replayed?: boolean };
type OracleReview = { clientId: string; amount: number; reason: string };
type OracleBalance = { credits: number; history: OracleGrant[] };
type Detail = { cliente: Client; wallet: { coins: number; minutes_free: number; minutes_normal: number; minutes_total: number; effective_rank: string }; spins: { level: number; count: number; available: number }[]; history: { operation_id: string; nivel: number; delta: number; reason: string; before_count: number; after_count: number; created_at: string }[]; coins_history?: CoinsAdjustment[]; oracle?: OracleBalance | null };
type AdjustmentKind = "coins" | "spins" | "oracle";
type PendingAdjustment = { kind: AdjustmentKind; clientId: string; clientName: string; body: string; uncertain: boolean };
const name = (c: Client) => [c.nombre, c.apellido].filter(Boolean).join(" ") || "Cliente sin nombre";
const formatCoins = (value: number) => value.toLocaleString("es-ES");
const drawLabel = (value: number) => `${value.toLocaleString("es-ES")} ${value === 1 ? "tirada" : "tiradas"}`;
class RequestError extends Error { constructor(message: string, readonly definitive: boolean) { super(message); } }
async function request(url: string, init: RequestInit = {}) {
  const token = (await supabaseBrowser().auth.getSession()).data.session?.access_token;
  const response = await fetch(url, { ...init, cache: "no-store", headers: { Authorization: `Bearer ${token || ""}`, "Content-Type": "application/json" } });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    const unavailable = data.code === "ORACLE_ADJUSTMENT_UNAVAILABLE" && data.uncertain !== true;
    const rejected = response.status >= 400 && response.status < 500 && data.code !== "OPERATION_CONFLICT" && data.error !== "OPERATION_CONFLICT";
    throw new RequestError(data.error || "No se pudo completar la operación.", unavailable || rejected);
  }
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
  const [coinsAmount, setCoinsAmount] = useState("");
  const [coinsReason, setCoinsReason] = useState("");
  const [oracleAmount, setOracleAmount] = useState("");
  const [oracleReason, setOracleReason] = useState("");
  const [oracleReview, setOracleReview] = useState<OracleReview | null>(null);
  const [operationKind, setOperationKind] = useState<AdjustmentKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [updated, setUpdated] = useState("");
  const active = useRef("");
  const version = useRef(0);
  const saving = useRef(false);
  const operation = useRef<PendingAdjustment | null>(null);
  const searchVersion = useRef(0);

  const refresh = useCallback(async (id: string) => {
    const current = ++version.current;
    try {
      const data = await request(`/api/admin/client-balances?id=${encodeURIComponent(id)}`);
      if (active.current !== id || version.current !== current) return;
      if (data?.cliente?.id !== id) throw new Error("La respuesta no corresponde a la cuenta seleccionada. Actualiza sus saldos.");
      setDetail(data); setUpdated(new Date().toLocaleTimeString("es-ES")); setError("");
    } catch (e) {
      if (active.current === id && version.current === current) setError(e instanceof Error ? e.message : "Error al consultar los saldos.");
    }
  }, []);
  useEffect(() => {
    if (!selected) return;
    const id = selected.id;
    void refresh(id);
    const update = () => { if (!document.hidden && !saving.current && !operation.current) void refresh(id); };
    const timer = window.setInterval(update, 15000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); ++version.current; };
  }, [selected, refresh]);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current || operation.current) return;
    const current = ++searchVersion.current;
    setSearching(true); setError("");
    try {
      const data = await request(`/api/admin/client-balances?q=${encodeURIComponent(query)}`);
      if (current === searchVersion.current) { setClients(data.clients); setSearched(true); }
    } catch (e) { if (current === searchVersion.current) setError(e instanceof Error ? e.message : "Error al buscar."); }
    finally { if (current === searchVersion.current) setSearching(false); }
  }
  function choose(client: Client) {
    if (saving.current || operation.current) return;
    if (active.current === client.id) { void refresh(client.id); return; }
    active.current = client.id; ++version.current;
    setSelected(client); setDetail(null); setError(""); setMessage(""); setReason(""); setCoinsAmount(""); setCoinsReason(""); setUpdated("");
    setOracleAmount(""); setOracleReason(""); setOracleReview(null);
  }
  function reviewOracle(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current || operation.current || !selected || active.current !== selected.id || !oracleValid || oracleReview) return;
    setOracleReview({ clientId: selected.id, amount: Number(oracleAmount), reason: oracleReason.trim() });
    setMessage("");
  }
  async function adjust(event: React.SyntheticEvent, kind: AdjustmentKind) {
    event.preventDefault();
    if (!selected || active.current !== selected.id || detail?.cliente.id !== selected.id || saving.current || (operation.current && operation.current.kind !== kind)) return;
    if (!operation.current) {
      let payload;
      if (kind === "oracle") {
        if (!oracleValid || oracleReview?.clientId !== selected.id) return;
        payload = { action: "oracle", amount: oracleReview.amount, reason: oracleReview.reason };
      } else if (kind === "coins") {
        if (!coinsValid) return;
        payload = { action: "coins", amount: Number(coinsAmount), reason: coinsReason.trim() };
      } else {
        if (!valid || (direction < 0 && Number(quantity) > count)) return;
        payload = { level, delta: direction * Number(quantity), reason: reason.trim() };
      }
      operation.current = {
        kind, clientId: selected.id, clientName: name(selected), uncertain: false,
        body: JSON.stringify({ ...payload, operation_id: crypto.randomUUID(), cliente_id: selected.id }),
      };
    }
    const pending = operation.current;
    setOperationKind(kind);
    saving.current = true; setBusy(true); setError(""); setMessage(""); ++version.current;
    try {
      const data = await request("/api/admin/client-balances", { method: "POST", body: pending.body });
      if (kind === "coins") {
        const adjustment = data.adjustment as CoinsAdjustment;
        if (!adjustment || !Number.isSafeInteger(adjustment.before_balance) || !Number.isSafeInteger(adjustment.after_balance)) throw new Error("La respuesta no confirma el saldo. Reintenta la misma operación.");
        setCoinsAmount(""); setCoinsReason("");
        setMessage(`Coins añadidos a ${pending.clientName}. Saldo: ${formatCoins(adjustment.before_balance)} → ${formatCoins(adjustment.after_balance)} Coins. Guardado en su historial y ficha.`);
        setDetail(current => current?.cliente.id === pending.clientId ? { ...current, wallet: { ...current.wallet, coins: adjustment.after_balance } } : current);
      } else if (kind === "oracle") {
        const granted = data.adjustment as OracleGrant | undefined;
        const expected = JSON.parse(pending.body);
        if (!granted || granted.operation_id !== expected.operation_id || granted.cliente_id !== pending.clientId
          || granted.amount !== expected.amount || granted.reason !== expected.reason
          || !Number.isSafeInteger(granted.before_balance) || granted.before_balance < 0
          || !Number.isSafeInteger(granted.after_balance) || granted.after_balance !== granted.before_balance + granted.amount) {
          throw new Error("No se pudo confirmar la concesión. Comprueba la misma operación para conocer su resultado.");
        }
        setOracleAmount(""); setOracleReason(""); setOracleReview(null);
        setMessage(`Concesión confirmada para ${pending.clientName}: +${drawLabel(granted.amount)}. Saldo al concederlas: ${granted.before_balance} → ${granted.after_balance}.`);
        setDetail(current => {
          if (!current?.oracle || current.cliente.id !== pending.clientId) return current;
          const history = [granted, ...current.oracle.history.filter(item => item.operation_id !== granted.operation_id)];
          const credits = !granted.replayed && current.oracle.credits === granted.before_balance ? granted.after_balance : current.oracle.credits;
          return { ...current, oracle: { credits, history } };
        });
      } else {
        setReason(""); setMessage("Ajuste guardado en la cuenta y en la ficha del cliente.");
      }
      operation.current = null; setUncertain(false); setOperationKind(null);
      await refresh(pending.clientId);
    } catch (e) {
      // Once a response was lost, later authentication/validation errors do not
      // prove the original operation failed. Keep its exact body for reconciliation.
      const definitive = !pending.uncertain && e instanceof RequestError && e.definitive;
      setUncertain(!definitive);
      if (definitive) { operation.current = null; setOperationKind(null); }
      else pending.uncertain = true;
      setError(e instanceof Error ? e.message : "No se pudo confirmar el ajuste. Reintenta.");
    }
    finally { saving.current = false; setBusy(false); }
  }
  const locked = busy || uncertain;
  const count = detail?.spins.find(s => s.level === level)?.count ?? 0;
  const valid = Number.isInteger(Number(quantity)) && Number(quantity) >= 1 && Number(quantity) <= 100 && reason.trim().length >= 3 && reason.trim().length <= 500;
  const coinsValue = Number(coinsAmount);
  const coinsAmountValid = Number.isSafeInteger(coinsValue) && coinsValue >= 1 && coinsValue <= 1_000_000;
  const coinsValid = coinsAmountValid && coinsReason.trim().length >= 3 && coinsReason.trim().length <= 500;
  const coinsUncertain = uncertain && operationKind === "coins";
  const spinsUncertain = uncertain && operationKind === "spins";
  const oracleUncertain = uncertain && operationKind === "oracle";
  const oracle = detail?.oracle;
  const oracleCredits = oracle && Number.isSafeInteger(oracle.credits) && oracle.credits >= 0 ? oracle.credits : null;
  const oracleNumber = Number(oracleAmount);
  const oracleValid = oracleCredits !== null && Number.isSafeInteger(oracleNumber) && oracleNumber >= 1
    && oracleNumber <= 100 && oracleReason.trim().length >= 3 && oracleReason.trim().length <= 500;
  return <section className={styles.panel} aria-label="Giros y saldos de clientes">
    <header><span className={styles.eyebrow}>CONTROL DE CLIENTES</span><h2>Giros y saldos</h2><p>Consulta los saldos, añade Coins, concede tiradas del Oráculo o ajusta los giros de la ruleta.</p></header>
    <form onSubmit={search} className={styles.search}><label>Buscar cliente<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nombre, teléfono o correo" minLength={2} required disabled={locked} /></label><button disabled={searching || locked || query.trim().length < 2}>{searching ? "Buscando…" : "Buscar"}</button></form>
    {searched && <div className={styles.results}>{clients.length ? clients.map(c => <button key={c.id} type="button" disabled={locked} aria-pressed={selected?.id === c.id} onClick={() => choose(c)}><strong>{name(c)}</strong><span>{c.telefono || c.email || c.id}</span></button>) : <p>No se encontraron clientes.</p>}</div>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {message && <p role="status" className={styles.success}>{message}</p>}
    {selected && <><div className={styles.heading}><div><h3>{name(selected)}</h3><p>{selected.telefono} · {selected.email}</p></div><button type="button" disabled={locked} onClick={() => { if (!saving.current && !operation.current) void refresh(selected.id); }}>Actualizar saldos</button></div>
      {!detail ? <p>{error ? "Pulsa Actualizar saldos para reintentar." : "Cargando saldos…"}</p> : <>
        <p className={styles.muted}>Última consulta: {updated} · Actualización automática cada 15 segundos · Rango: {detail.wallet.effective_rank || "Sin rango"}</p>
        <div className={styles.cards}><article><span>Coins disponibles</span><strong>{detail.wallet.coins}</strong></article><article><span>Minutos disponibles</span><strong>{detail.wallet.minutes_total}</strong></article><article><span>Minutos normales</span><strong>{detail.wallet.minutes_normal}</strong></article><article><span>Minutos FREE</span><strong>{detail.wallet.minutes_free}</strong></article></div>
        <section className={styles.coinsSection} aria-labelledby="admin-oracle-title">
          <div className={`${styles.adjust} ${styles.oracleAdjust}`}>
            <h3 id="admin-oracle-title">Tiradas del Oráculo</h3>
            <p>Saldo disponible de <strong>{name(selected)}</strong>: <strong>{oracleCredits === null ? "No disponible" : drawLabel(oracleCredits)}</strong>.</p>
            {oracleCredits === null ? <p className={styles.muted}>No se pudo cargar el saldo de tiradas. Pulsa «Actualizar saldos» para volver a consultarlo.</p> : <>
              <form onSubmit={reviewOracle} className={styles.oracleForm} aria-label="Conceder tiradas del Oráculo">
                <fieldset disabled={locked || !!oracleReview}>
                  <label>Tiradas que quieres añadir<input type="number" inputMode="numeric" min={1} max={100} step={1} required value={oracleAmount}
                    onChange={e => { if (!operation.current && !oracleReview) setOracleAmount(e.target.value); }} placeholder="De 1 a 100" /></label>
                  <label>Motivo de la concesión<textarea value={oracleReason} required minLength={3} maxLength={500}
                    onChange={e => { if (!operation.current && !oracleReview) setOracleReason(e.target.value); }} placeholder="Ej. Premio del sorteo" /></label>
                </fieldset>
                {!oracleReview && <button disabled={locked || !oracleValid}>Revisar concesión</button>}
              </form>
              {oracleReview && <div className={styles.oracleConfirmation} aria-label="Confirmación de tiradas del Oráculo">
                <strong>Conceder {drawLabel(oracleReview.amount)} a {name(selected)}</strong>
                <p>{oracleReview.reason}</p>
                <p className={styles.muted}>Según el último saldo consultado: {oracleCredits} → {drawLabel(oracleCredits + oracleReview.amount)}.</p>
                {oracleUncertain && <p role="status" className={styles.pending}>El resultado está pendiente de confirmación. Conserva esta cuenta abierta y comprueba la misma concesión para evitar duplicarla.</p>}
                <div className={styles.oracleActions}>
                  {!oracleUncertain && <button type="button" className={styles.editOracle} disabled={locked} onClick={() => { if (!operation.current) setOracleReview(null); }}>Volver a editar</button>}
                  <button type="button" disabled={busy || (uncertain && !oracleUncertain)} onClick={e => void adjust(e, "oracle")}>
                    {busy && operationKind === "oracle" ? "Guardando concesión…" : oracleUncertain ? "Comprobar la misma concesión" : "Confirmar y añadir tiradas"}
                  </button>
                </div>
              </div>}
            </>}
          </div>
          <div className={styles.coinsHistory}>
            <h3>Historial de tiradas concedidas</h3>
            {!oracle || !Array.isArray(oracle.history) ? <p className={styles.muted}>Historial no disponible.</p> : oracle.history.length === 0 ? <p className={styles.muted}>Aún no se han concedido tiradas a esta cuenta desde administración.</p> :
              <div className={styles.history}>{oracle.history.map(grant => <article key={grant.operation_id}>
                <strong>+{drawLabel(grant.amount)} · {grant.before_balance} → {grant.after_balance}</strong>
                <p>{grant.reason}</p>
                {grant.actor_name && <p className={styles.muted}>Concedido por {grant.actor_name}</p>}
                <time dateTime={grant.created_at}>{new Date(grant.created_at).toLocaleString("es-ES")}</time>
              </article>)}</div>}
          </div>
        </section>
        <section className={styles.coinsSection} aria-labelledby="admin-add-coins-title">
          <form onSubmit={event => void adjust(event, "coins")} className={`${styles.adjust} ${styles.coinsAdjust}`} aria-labelledby="admin-add-coins-title">
            <div><span className={styles.eyebrow}>COINS · AÑADIR SALDO</span><h3 id="admin-add-coins-title">Añadir Coins</h3><p>Se suman al saldo de <strong>{name(selected)}</strong>. No cambia sus giros ni sus minutos.</p></div>
            <fieldset disabled={locked}>
              <label>Coins que quieres añadir<input type="number" inputMode="numeric" min={1} max={1_000_000} step={1} value={coinsAmount} onChange={e => { if (!operation.current) setCoinsAmount(e.target.value); }} required aria-describedby="admin-coins-limit" placeholder="Ej. 50" /></label>
              <p id="admin-coins-limit" className={styles.muted}>Solo cantidades enteras positivas, entre 1 y 1.000.000 Coins.</p>
              <label>Motivo de los Coins<textarea value={coinsReason} onChange={e => { if (!operation.current) setCoinsReason(e.target.value); }} minLength={3} maxLength={500} required aria-describedby="admin-coins-reason-help" placeholder="Ej. Premio del sorteo o compensación acordada" /></label>
              <p id="admin-coins-reason-help" className={styles.muted}>La clienta también verá este motivo en su aviso de Coins.</p>
            </fieldset>
            <div className={styles.coinsPreview} aria-live="polite" aria-atomic="true"><span>Saldo actual <strong>{formatCoins(detail.wallet.coins)} Coins</strong></span><span className={styles.previewArrow} aria-hidden="true">→</span><span>Saldo tras añadir <strong>{coinsAmountValid ? `${formatCoins(detail.wallet.coins + coinsValue)} Coins` : "Indica la cantidad"}</strong></span></div>
            <p className={styles.muted}>Vista previa con el último saldo consultado. Al guardar se confirma el saldo real.</p>
            {coinsUncertain && <p role="status" className={styles.pending}>No se ha podido confirmar el resultado. Mantén esta cuenta abierta y reintenta la misma operación para comprobarla sin duplicar los Coins.</p>}
            <button disabled={busy || (uncertain && !coinsUncertain) || (!coinsUncertain && !coinsValid)}>{busy && operationKind === "coins" ? "Añadiendo Coins…" : coinsUncertain ? "Comprobar y reintentar los mismos Coins" : "Añadir Coins"}</button>
          </form>
          <div className={styles.coinsHistory}><h3>Historial de Coins añadidos</h3><p className={styles.muted}>Últimos Coins añadidos desde este apartado.</p>{!detail.coins_history?.length ? <p className={styles.muted}>Aún no hay adiciones desde este apartado.</p> : <div className={styles.history}>{detail.coins_history.map(h => <article key={h.operation_id}><strong>+{formatCoins(h.amount)} Coins · {formatCoins(h.before_balance)} → {formatCoins(h.after_balance)}</strong><p>{h.reason}</p><time dateTime={h.created_at}>{new Date(h.created_at).toLocaleString("es-ES")}</time></article>)}</div>}</div>
        </section>
        <h3>Giros por nivel</h3><div className={styles.cards}>{detail.spins.map(s => <article key={s.level}><span>Nivel {s.level}{s.level === 4 ? " · Especial" : s.level === 5 ? " · Diamante" : ""}</span><strong>{s.available}</strong><span>Disponibles ahora · {s.count} pendientes en total</span></article>)}</div>
        <p className={styles.muted}>Los disponibles coinciden con la ruleta del cliente. Los pendientes incluyen giros sujetos a requisitos de rango, como Diamante. Solo se pueden retirar giros pendientes.</p>
        <form onSubmit={event => void adjust(event, "spins")} className={styles.adjust} aria-label="Ajustar giros"><h3>Ajustar giros</h3><fieldset disabled={locked}><div className={styles.fields}><label>Nivel<select value={level} onChange={e => { if (!operation.current) setLevel(Number(e.target.value)); }}>{[1,2,3,4,5].map(n => <option key={n} value={n}>Nivel {n}</option>)}</select></label><label>Operación<select value={direction} onChange={e => { if (!operation.current) setDirection(Number(e.target.value)); }}><option value={1}>Añadir</option><option value={-1}>Retirar</option></select></label><label>Cantidad<input type="number" min={1} max={100} step={1} value={quantity} onChange={e => { if (!operation.current) setQuantity(e.target.value); }} required /></label></div><label>Motivo del ajuste<textarea value={reason} onChange={e => { if (!operation.current) setReason(e.target.value); }} minLength={3} maxLength={500} required placeholder="Explica el motivo para el historial" /></label></fieldset>
        <p>{direction === 1 ? "Añadir" : "Retirar"} {quantity || "0"} giro(s) de nivel {level} a {name(selected)}. Pendientes: {count}.</p>
        {spinsUncertain && <p>Reintenta este mismo ajuste para confirmar su resultado sin duplicarlo.</p>}
        <button disabled={busy || (uncertain && !spinsUncertain) || (!spinsUncertain && (!valid || (direction < 0 && Number(quantity) > count)))}>{busy && operationKind === "spins" ? "Guardando…" : spinsUncertain ? "Reintentar el mismo ajuste" : "Guardar ajuste"}</button></form>
        <h3>Historial de ajustes de giros</h3>{detail.history.length === 0 ? <p className={styles.muted}>Este cliente aún no tiene ajustes administrativos de giros.</p> : <div className={styles.history}>{detail.history.map(h => <article key={h.operation_id}><strong>Nivel {h.nivel} · {h.delta > 0 ? "+" : ""}{h.delta} giros · {h.before_count} → {h.after_count}</strong><p>{h.reason}</p><time dateTime={h.created_at}>{new Date(h.created_at).toLocaleString("es-ES")}</time></article>)}</div>}
      </>}
    </>}
  </section>;
}
