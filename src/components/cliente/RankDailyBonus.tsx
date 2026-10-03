"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Check, Clock3 } from "lucide-react";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import { useRouletteSignal } from "@/hooks/useRouletteSignal";
import CrystalEmblem from "@/components/benefits/CrystalEmblem";
import styles from "./RankDailyBonus.module.css";

const sb = supabaseClienteBrowser();

function nextLabel(value: unknown) {
  if (!value) return "Disponible de nuevo mañana";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "Disponible de nuevo mañana";
  return `Disponible de nuevo ${date.toLocaleString("es-ES", { timeZone: "Europe/Madrid", weekday: "long", hour: "2-digit", minute: "2-digit" })}`;
}

export default function RankDailyBonus() {
  const [state, setState] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  const load = useCallback(async () => {
    const token = (await sb.auth.getSession()).data.session?.access_token;
    if (!token) { setState(null); return; }
    const response = await fetch("/api/cliente/rank-benefits", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const result = await response.json();
    if (response.ok && result.ok) setState(result); else setState(null);
  }, []);

  useEffect(() => { void load().catch(() => setState(null)); }, [load]);
  useRouletteSignal(sb, state?.cliente_id, load);

  async function claim(id: string) {
    if (busy) return;
    setBusy(id); setMessage(""); setSuccess(false);
    try {
      const token = (await sb.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error("Tu sesión ha caducado.");
      const response = await fetch("/api/cliente/rank-benefits", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ promotion_id: id }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "No se pudo confirmar el bono.");
      setState((current: any) => ({ ...current, bonuses: result.bonuses || current?.bonuses || [] }));
      setSuccess(true);
      setMessage("Bono recibido. La recompensa ya está acreditada en tu cuenta.");
      window.dispatchEvent(new Event("tc-client-balances-changed"));
    } catch (error: any) {
      setMessage(error.message || "No se pudo confirmar el bono. Puedes reintentar con seguridad.");
    } finally {
      setBusy("");
      void load().catch(() => setState(null));
    }
  }

  if (!state?.bonuses?.length && !message) return null;

  return <div className={styles.wrap}>
    {message && <div role={success ? "status" : "alert"} className={styles.message} data-success={success}>{success && <Check size={18}/>} {message}</div>}
    {(state?.bonuses || []).map((bonus: any) => {
      const claimed = bonus.claimed_today === true;
      return <section className={styles.card} key={bonus.id} aria-labelledby={`bonus-${bonus.id}`}>
        <div className={styles.art}><CrystalEmblem size={184} tone="diamante"/><span className={styles.artCaption}>TAROT CELESTIAL</span></div>
        <div className={styles.content}>
          <span className={styles.eyebrow}>EXCLUSIVO · RANGO DIAMANTE</span>
          <h2 id={`bonus-${bonus.id}`}>{bonus.name}</h2>
          <p>{bonus.description}</p>
          <div className={styles.benefits}>
            {Number(bonus.benefit?.coins) > 0 && <span><i className={styles.coin}>✦</i><b>+{bonus.benefit.coins}</b> Coins</span>}
            {Number(bonus.benefit?.oracle_credits) > 0 && <span><b>+{bonus.benefit.oracle_credits}</b> tiradas Oráculo</span>}
            {Number(bonus.benefit?.roulette_level_1_spins) > 0 && <span><b>+{bonus.benefit.roulette_level_1_spins}</b> giro N1</span>}
            {Number(bonus.benefit?.roulette_level_2_spins) > 0 && <span><b>+{bonus.benefit.roulette_level_2_spins}</b> giro N2</span>}
            {Number(bonus.benefit?.roulette_level_3_spins) > 0 && <span><b>+{bonus.benefit.roulette_level_3_spins}</b> giro N3</span>}
            {Number(bonus.benefit?.roulette_special_spins) > 0 && <span><b>+{bonus.benefit.roulette_special_spins}</b> giro Especial</span>}
          </div>
          <div className={styles.footer}>
            <button onClick={() => void claim(bonus.id)} disabled={!!busy || claimed}>{claimed ? "Bono de hoy utilizado" : busy === bonus.id ? "Aplicando tu bono…" : "Utilizar mi bono"}{!claimed && <ArrowRight size={17}/>}</button>
            <small><Clock3 size={13}/> {claimed ? nextLabel(bonus.next_available_at) : "Un único uso por día natural · Europe/Madrid"}</small>
          </div>
        </div><span className={styles.corner} aria-hidden="true"/>
      </section>;
    })}
  </div>;
}
