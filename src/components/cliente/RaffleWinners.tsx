"use client";
import { useEffect, useState } from "react";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import styles from "./RaffleWinners.module.css";
type Winner = { position: number; prize_name: string; winning_number: number };
export default function RaffleWinners() {
  const [winners, setWinners] = useState<Winner[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const sb = supabaseClienteBrowser();
    let alive = true, running = false, again = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      if (!alive) return;
      if (running) { again = true; return; }
      running = true;
      try {
        const token = (await sb.auth.getSession()).data.session?.access_token;
        if (!token) throw new Error("Inicia sesión para ver los ganadores.");
        const response = await fetch("/api/cliente/raffle/winners", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const json = await response.json();
        if (!response.ok || !json.ok) throw new Error(json.error || "No se pudieron cargar los ganadores.");
        if (alive) { setWinners(json.winners || []); setError(""); }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "No se pudieron cargar los ganadores.");
      } finally {
        running = false;
        if (alive) setLoading(false);
        if (again && alive) { again = false; schedule(); }
      }
    }
    function schedule() { if (timer) clearTimeout(timer); timer = setTimeout(() => void load(), 250); }
    function visible() { if (document.visibilityState === "visible") schedule(); }
    void load();
    const channel = sb.channel("cliente:raffle:public-winners")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "raffle_public_winners" }, schedule)
      .subscribe((status) => { if (status === "SUBSCRIBED") schedule(); });
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => { alive = false; if (timer) clearTimeout(timer); void sb.removeChannel(channel); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, [refresh]);
  return <section className={styles.root} aria-labelledby="raffle-winners-title">
    <header><h2 id="raffle-winners-title">Ganadores del sorteo</h2><button type="button" onClick={() => setRefresh((n) => n + 1)}>Actualizar ganadores</button></header>
    {error ? <p role="alert">{error}</p> : null}
    <div className={styles.grid} aria-live="polite">
      {winners.map((winner) => <article key={winner.position}><span>Premio puesto N{winner.position}</span><h3>{winner.prize_name}</h3><p>GANADOR NÚMERO</p><strong>{winner.winning_number}</strong></article>)}
    </div>
    {!winners.length && !error ? <p>{loading ? "Consultando ganadores…" : "Los ganadores aparecerán aquí cuando la central los confirme."}</p> : null}
  </section>;
}
