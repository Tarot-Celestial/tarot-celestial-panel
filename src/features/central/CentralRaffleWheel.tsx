"use client";

import { useEffect, useRef, useState } from "react";
import { landingRotation, type WheelEntry } from "./raffle-wheel";
import styles from "./CentralRaffleWheel.module.css";

import { supabaseBrowser } from "@/lib/supabase-browser";
type Prize = { id: string; position: number; name: string; candidate_entry_id: string | null; candidate_number: number | null; selected_at: string | null; confirmed_at: string | null };
function PrizeEditor({ position, prize, busy, save }: { position: number; prize?: Prize; busy: boolean; save: (position: number, name: string) => void }) {
  const [name, setName] = useState(prize?.name || "");
  useEffect(() => { setName(prize?.name || ""); }, [prize?.name]);
  return <div className={styles.prizeRow}>
    <label>Premio N{position}{position === 1 ? " · Mayor valor" : ""}
      <input maxLength={200} value={name} disabled={busy || Boolean(prize?.selected_at)} placeholder="Ej. 100 minutos de consulta o limpieza espiritual" onChange={(e) => setName(e.target.value)} />
    </label>
    <button type="button" disabled={busy || !name.trim() || Boolean(prize?.selected_at)} onClick={() => save(position, name)}>Guardar premio</button>
    {prize?.selected_at ? <small>{prize.confirmed_at ? "Publicado" : "Pendiente de confirmar"} · Número {prize.candidate_number}</small> : null}
  </div>;
}
const COLORS = ["#7042a2", "#b48936", "#246f66", "#984663", "#3e6097", "#82622b"];

export default function CentralRaffleWheel({ entries: initialEntries, title, raffleId, onClose }: {
  entries: WheelEntry[]; title: string; raffleId: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spinningRef = useRef(false);
  const [entries, setEntries] = useState(initialEntries);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [slots, setSlots] = useState(4);
  const [selectedPrize, setSelectedPrize] = useState("");
  const [busy, setBusy] = useState(true);
  const requestBusy = useRef(false);
  const [ready, setReady] = useState(false);
  const [confirmSpin, setConfirmSpin] = useState(false);
  const [notice, setNotice] = useState("");
  const activePrize = prizes.find((prize) => prize.id === selectedPrize);
  async function request(action?: string, values: Record<string, unknown> = {}) {
    const session = await supabaseBrowser().auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) throw new Error("Vuelve a iniciar sesión.");
    const response = await fetch(action ? "/api/central/raffle/prizes" : `/api/central/raffle/prizes?raffle_id=${raffleId}`, {
      method: action ? "POST" : "GET", cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(action ? { body: JSON.stringify({ ...values, action, raffle_id: raffleId }) } : {}),
    });
    const json = await response.json();
    if (!response.ok || !json.ok) throw new Error(json.error || "No se pudo completar la operación.");
    setPrizes(json.prizes || []);
    setSlots((n) => Math.max(n, ...((json.prizes || []).map((p: Prize) => p.position))));
    return json;
  }
  useEffect(() => {
    let alive = true;
    request().then(() => { if (alive) setReady(true); }).catch((e) => { if (alive) setError(e.message); }).finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
    // This dialog is keyed by raffle and only loads on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function mutate(action: string, values: Record<string, unknown>) {
    if (requestBusy.current || spinningRef.current) return;
    requestBusy.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await request(action, values);
      setNotice(action === "confirm" ? "Ganador confirmado y publicado. No se han abonado minutos automáticamente." : "Premio guardado.");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar. Puedes reintentar sin duplicar el resultado."); }
    finally { requestBusy.current = false; setBusy(false); }
  }
  const [rotation, setRotation] = useState(0);
  const [duration, setDuration] = useState(5200);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<WheelEntry | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      if (timer.current) clearTimeout(timer.current);
      element?.close();
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const size = 1000, center = size / 2, radius = 475;
    ctx.clearRect(0, 0, size, size);
    if (!entries.length) {
      ctx.fillStyle = "#2a2038";
      ctx.beginPath(); ctx.arc(center, center, radius, 0, Math.PI * 2); ctx.fill();
      return;
    }
    const step = Math.PI * 2 / entries.length;
    entries.forEach((entry, index) => {
      const start = -Math.PI / 2 + index * step;
      ctx.beginPath(); ctx.moveTo(center, center);
      ctx.arc(center, center, radius, start, start + step); ctx.closePath();
      ctx.fillStyle = COLORS[index % COLORS.length]; ctx.fill();
      if (entries.length <= 150) { ctx.strokeStyle = "#e4c77888"; ctx.lineWidth = 2; ctx.stroke(); }
      // Large pools retain equal sectors; the full, searchable list stays alongside.
      if (entries.length <= 100 || index % Math.ceil(entries.length / 80) === 0) {
        ctx.save(); ctx.translate(center, center); ctx.rotate(start + step / 2);
        ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillStyle = "#fff7de";
        ctx.font = `700 ${entries.length <= 20 ? 26 : entries.length <= 50 ? 18 : 12}px Arial`;
        const label = entries.length <= 50 ? `#${entry.number} · ${entry.name.slice(0, 14)}` : String(entry.number);
        ctx.fillText(label, radius - 20, 0, 300); ctx.restore();
      }
    });
  }, [entries]);

  async function spin() {
    if (spinningRef.current || requestBusy.current || !activePrize || activePrize.selected_at) return;
    spinningRef.current = true; setSpinning(true); setError(""); setWinner(null); setConfirmSpin(false);
    try {
      const json = await request("draw", { prize_id: activePrize.id });
      const fresh: WheelEntry[] = json.entries;
      const prize: Prize = json.prizes.find((p: Prize) => p.id === activePrize.id);
      const index = fresh.findIndex((entry) => entry.id === prize.candidate_entry_id);
      if (index < 0) throw new Error("Resultado guardado. Cierra y vuelve a abrir para recuperarlo.");
      setEntries(fresh);
      const ms = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 50 : 5200;
      setDuration(ms);
      setRotation((previous) => landingRotation(previous, index, fresh.length));
      timer.current = setTimeout(() => {
        setWinner(fresh[index]); setSpinning(false); spinningRef.current = false; timer.current = null;
      }, ms + 80);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo girar. Reintenta: un resultado ya guardado no se repite.");
      setSpinning(false); spinningRef.current = false;
    }
  }
  const savedWinner = activePrize?.candidate_entry_id ? entries.find((entry) => entry.id === activePrize.candidate_entry_id) : null;
  const displayedWinner = spinning ? null : winner || savedWinner || (activePrize?.candidate_number ? { number: activePrize.candidate_number, name: "Cliente asignado" } : null);
  const filtered = entries.filter((entry) => `${entry.number} ${entry.name}`.toLocaleLowerCase("es").includes(query.trim().toLocaleLowerCase("es")));

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="raffle-wheel-title"
    onCancel={(event) => { event.preventDefault(); if (!spinningRef.current && !requestBusy.current) onClose(); }}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>SORTEO CELESTIAL</span><h2 id="raffle-wheel-title">Elegir ganadores</h2><p>{title} · {entries.length} números con dueño</p></div>
      <button type="button" onClick={onClose} disabled={spinning || busy} aria-label="Cerrar ruleta">×</button>
    </header>
    <p className={styles.notice}>Configura los premios abajo. Elige uno y confirma el giro; después confirma el ganador para publicar solo su número y el premio. El resultado pendiente se conserva al cerrar. Cada número puede participar en distintos premios; no se abonan minutos automáticamente.</p>
    <div className={styles.layout}>
      <section className={styles.stage} aria-label="Ruleta del sorteo">
        <div className={styles.wheelFrame}>
          <div className={styles.pointer} aria-hidden="true" />
          <canvas ref={canvas} width={1000} height={1000} aria-label="Ruleta con los números de la lista de participantes" role="img"
            style={{ transform: `rotate(${rotation}deg)`, transition: `transform ${duration}ms cubic-bezier(.12,.75,.12,1)` }} />
          <div className={styles.hub} aria-hidden="true">✦</div>
        </div>
        <label className={styles.prizeSelect}>Premio que se sorteará
          <select value={selectedPrize} disabled={spinning || busy} onChange={(e) => { setSelectedPrize(e.target.value); setWinner(null); setConfirmSpin(false); setNotice(""); }}>
            <option value="">Selecciona un premio guardado</option>
            {prizes.map((p) => <option key={p.id} value={p.id}>Premio N{p.position} · {p.name}{p.confirmed_at ? " · Publicado" : p.selected_at ? " · Pendiente de confirmar" : ""}</option>)}
          </select>
        </label>
        {confirmSpin && activePrize ? <div className={styles.confirmBox}>
          <p>¿Sortear Premio N{activePrize.position}: <strong>{activePrize.name}</strong>?</p>
          <button type="button" disabled={spinning || busy} onClick={() => void spin()}>Confirmar y girar</button>
          <button type="button" onClick={() => setConfirmSpin(false)}>Cancelar</button>
        </div> : <button type="button" className={styles.spinButton} disabled={spinning || busy || !ready || !entries.length || !activePrize || Boolean(activePrize.selected_at)} onClick={() => setConfirmSpin(true)}>{spinning ? "Girando…" : "Girar la ruleta"}</button>}
        <div className={styles.result} role="status" aria-live="polite" aria-atomic="true">
          {displayedWinner ? <><span>PREMIO N{activePrize?.position} · {activePrize?.name}</span><strong>{displayedWinner.number}</strong><b>{displayedWinner.name}</b>
            {activePrize?.confirmed_at ? <p>Ganador publicado</p> : <button type="button" className={styles.spinButton} disabled={busy} onClick={() => void mutate("confirm", { prize_id: selectedPrize })}>Confirmar ganador</button>}</>
            : <p>{spinning ? "El destino está eligiendo…" : entries.length ? "Todo listo para girar" : "Todavía no hay números asignados a clientes."}</p>}
        </div>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {notice ? <p role="status">{notice}</p> : null}
      </section>
      <section className={styles.participants} aria-labelledby="raffle-participants-title">
        <h3 id="raffle-participants-title">Números participantes <span>{entries.length}</span></h3>
        <p>Una oportunidad por número. Un mismo cliente puede aparecer varias veces.</p>
        <label>Buscar número o cliente<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Número o nombre…" /></label>
        <ul>{filtered.map((entry) => <li key={entry.id} className={winner?.id === entry.id ? styles.selected : undefined}><b>#{entry.number}</b><span>{entry.name}</span></li>)}</ul>
        {!filtered.length ? <p>{entries.length ? "No hay coincidencias." : "Asigna números en el sorteo para comenzar."}</p> : null}
        <small>Lista actualizada al abrir. Ciérrala y vuelve a abrirla para incorporar nuevas asignaciones.</small>
      </section>
    </div>
    <section className={styles.prizeSettings} aria-labelledby="prize-settings-title">
      <h3 id="prize-settings-title">Configurar premios</h3>
      <p>Premio N1 es el de mayor valor. Escribe el premio completo, por ejemplo «100 minutos de consulta» o «Limpieza espiritual». No incluyas nombres de clientes: este texto se publicará.</p>
      {Array.from({ length: slots }, (_, i) => <PrizeEditor key={i + 1} position={i + 1} prize={prizes.find((p) => p.position === i + 1)} busy={busy || spinning || !ready} save={(position, name) => void mutate("save", { position, name })} />)}
      <button type="button" disabled={busy || spinning || !ready || slots >= 100} onClick={() => setSlots((n) => n + 1)}>+ Añadir otro premio</button>
    </section>
  </dialog>;
}
