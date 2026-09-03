"use client";

import { useEffect, useRef, useState } from "react";
import { landingRotation, randomTicketIndex, type WheelEntry } from "./raffle-wheel";
import styles from "./CentralRaffleWheel.module.css";

const COLORS = ["#7042a2", "#b48936", "#246f66", "#984663", "#3e6097", "#82622b"];

export default function CentralRaffleWheel({ entries, title, onClose }: {
  entries: WheelEntry[]; title: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spinningRef = useRef(false);
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

  function spin() {
    if (spinningRef.current || !entries.length) return;
    setError("");
    try {
      const index = randomTicketIndex(entries.length);
      const ms = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 50 : 5200;
      spinningRef.current = true; setSpinning(true); setWinner(null); setDuration(ms);
      setRotation((previous) => landingRotation(previous, index, entries.length));
      timer.current = setTimeout(() => {
        setWinner(entries[index]); setSpinning(false); spinningRef.current = false; timer.current = null;
      }, ms + 80);
    } catch {
      setError("No se pudo iniciar el giro. Comprueba que estás usando una conexión segura y vuelve a intentarlo.");
    }
  }
  const filtered = entries.filter((entry) => `${entry.number} ${entry.name}`.toLocaleLowerCase("es").includes(query.trim().toLocaleLowerCase("es")));

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="raffle-wheel-title"
    onCancel={(event) => { event.preventDefault(); if (!spinningRef.current) onClose(); }}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>SORTEO CELESTIAL</span><h2 id="raffle-wheel-title">Elegir ganadores</h2><p>{title} · {entries.length} números con dueño</p></div>
      <button type="button" onClick={onClose} disabled={spinning} aria-label="Cerrar ruleta">×</button>
    </header>
    <p className={styles.notice}>Esta primera versión muestra un resultado local: no lo guarda, no publica ganadores ni entrega premios. Al cerrar se descarta. Cada giro incluye de nuevo todos los números.</p>
    <div className={styles.layout}>
      <section className={styles.stage} aria-label="Ruleta del sorteo">
        <div className={styles.wheelFrame}>
          <div className={styles.pointer} aria-hidden="true" />
          <canvas ref={canvas} width={1000} height={1000} aria-label="Ruleta con los números de la lista de participantes" role="img"
            style={{ transform: `rotate(${rotation}deg)`, transition: `transform ${duration}ms cubic-bezier(.12,.75,.12,1)` }} />
          <div className={styles.hub} aria-hidden="true">✦</div>
        </div>
        <button type="button" className={styles.spinButton} disabled={spinning || !entries.length} onClick={spin}>{spinning ? "Girando…" : "Girar la ruleta"}</button>
        <div className={styles.result} role="status" aria-live="polite" aria-atomic="true">
          {winner ? <><span>NÚMERO SELECCIONADO</span><strong>{winner.number}</strong><b>{winner.name}</b></>
            : <p>{spinning ? "El destino está eligiendo…" : entries.length ? "Todo listo para girar" : "Todavía no hay números asignados a clientes."}</p>}
        </div>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
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
  </dialog>;
}
