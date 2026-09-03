"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Coins, Clock3, Sparkles, ShieldCheck, ArrowRight, RotateCw } from "lucide-react";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import { useRouletteSignal } from "@/hooks/useRouletteSignal";
import { prizeLabel, winningRotation, type RouletteLevel, type RouletteSummary, type RouletteReward } from "@/lib/ruleta";
import styles from "./PurchaseRoulette.module.css";

const sb = supabaseClienteBrowser();
type Pending = { spin_id: string; level: RouletteLevel };
const storageKey = (id: string) => "tc-ruleta-pending:" + id;
export default function PurchaseRoulette({ onReward }: { onReward?: () => void | Promise<void> }) {
  const router = useRouter();
  const [summary, setSummary] = useState<RouletteSummary | null>(null);
  const [level, setLevel] = useState<RouletteLevel>(1);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState<RouletteReward | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const mounted = useRef(true), inFlight = useRef(false), loadingRef = useRef(false);
  const animation = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const resultRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [result]);

  const load = useCallback(async () => {
    if (loadingRef.current || inFlight.current) return;
    loadingRef.current = true;
    try {
      const { data } = await sb.auth.getSession();
      if (!data.session) { router.replace("/cliente/login?next=ruleta"); return; }
      const response = await fetch("/api/cliente/ruleta", {
        headers: { Authorization: "Bearer " + data.session.access_token }, cache: "no-store", signal: AbortSignal.timeout(15000),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || "No hemos podido cargar tus giros.");
      if (!mounted.current) return;
      setSummary(json);
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey(json.cliente_id)) || "null");
        if (saved?.spin_id && [1, 2].includes(saved.level)) {
          pendingRef.current = saved; setPending(saved); setLevel(saved.level);
          setMessage("Hay un giro pendiente de comprobar. Recupera su resultado sin gastar otro giro.");
        }
      } catch { /* Storage can be unavailable in private browsing. */ }
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : "No hemos podido cargar tus giros. Vuelve a intentarlo.");
    } finally { loadingRef.current = false; if (mounted.current) setLoading(false); }
  }, [router]);
  useEffect(() => {
    mounted.current = true;
    if (new URLSearchParams(window.location.search).get("nivel") === "2") setLevel(2);
    void load();
    return () => { mounted.current = false; if (animation.current) clearTimeout(animation.current); };
  }, [load]);
  useRouletteSignal(sb, summary?.cliente_id, load);

  const prizes = useMemo(() => summary?.catalogue.filter(p => p.nivel === level) || [], [summary, level]);
  const available = summary ? (level === 1 ? summary.level_1_spins : summary.level_2_spins) : null;
  const gradient = useMemo(() => "conic-gradient(" + prizes.map((p, i) => {
    const color = p.special ? "#b58a30" : p.reward_type === "coins" ? "#247b74" : i % 2 ? "#362050" : "#70409b";
    return color + " " + i * 360 / prizes.length + "deg " + (i + 1) * 360 / prizes.length + "deg";
  }).join(",") + ")", [prizes]);
  const goToBalance = useCallback(() => {
    if (result) router.push("/cliente/dashboard?reward=" + result.reward_type + "&spin=" + encodeURIComponent(result.spin_id) + "#saldo-" + result.reward_type);
  }, [router, result]);
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) { goToBalance(); return; }
    const timer = setTimeout(() => setCountdown(n => n === null ? null : n - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, goToBalance]);

  async function spin() {
    if (inFlight.current || !summary) return;
    const request = pendingRef.current || {
      spin_id: (level === 1 ? summary.next_spin_1 : summary.next_spin_2) || "", level,
    };
    if (!request.spin_id) return;
    inFlight.current = true; setBusy(true); setResult(null); setCountdown(null); setMessage("");
    pendingRef.current = request; setPending(request);
    try { sessionStorage.setItem(storageKey(summary.cliente_id), JSON.stringify(request)); } catch {}
    try {
      const { data } = await sb.auth.getSession();
      if (!data.session) throw new Error("Tu sesión ha caducado. Vuelve a entrar para recuperar tu giro.");
      const response = await fetch("/api/cliente/ruleta", {
        method: "POST", headers: { Authorization: "Bearer " + data.session.access_token, "Content-Type": "application/json" },
        body: JSON.stringify(request), signal: AbortSignal.timeout(15000),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        if (response.status === 409) {
          pendingRef.current = null; setPending(null);
          try { sessionStorage.removeItem(storageKey(summary.cliente_id)); } catch {}
        }
        throw new Error(json.error || "No se ha podido confirmar el giro.");
      }
      if (!mounted.current) return;
      const awardedPrizes = json.catalogue.filter((p: { nivel: number }) => p.nivel === request.level);
      const index = awardedPrizes.findIndex((p: { id: string }) => p.id === json.reward_id);
      setSummary(json); setLevel(request.level);
      if (index >= 0) setRotation(previous => winningRotation(previous, index, awardedPrizes.length));
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      animation.current = setTimeout(() => {
        if (!mounted.current) return;
        setResult(json); setBusy(false); inFlight.current = false;
        setPending(null); pendingRef.current = null;
        try { sessionStorage.removeItem(storageKey(summary.cliente_id)); } catch {}
        void Promise.resolve(onReward?.()).catch(() => {});
        void load();
        // No forced navigation: countdown starts only when the customer chooses it.
      }, reduced || index < 0 ? 50 : 3800);
    } catch (error) {
      if (mounted.current) {
        setMessage(error instanceof Error && !["TimeoutError", "AbortError"].includes(error.name) ? error.message : "Conexión interrumpida. Comprueba el mismo giro sin gastar otro.");
        setBusy(false);
      }
      inFlight.current = false;
    }
  }
  return (
    <section className={styles.wrap} aria-label="Ruleta Celestial" aria-busy={loading}>
      <header className={styles.hero}>
        <div><span className={styles.eyebrow}>EL DESTINO TAMBIÉN TE PREMIA</span>
          <h2>Tu compra <em>tiene premio.</em></h2>
          <p>Una compra confirmada. Un giro. Minutos FREE o Coins que llegan a tu saldo real.</p>
          <div className={styles.steps}><span>01 · Compra</span><ArrowRight size={14}/><span>02 · Gira</span><ArrowRight size={14}/><span>03 · Disfruta</span></div>
        </div>
        <div className={styles.brand}><Image src="/Nuevo-logo-tarot.png" alt="Tarot Celestial" width={130} height={130} priority/><span aria-hidden="true"/></div>
      </header>
      <div className={styles.levels} aria-label="Elige el nivel de tu giro">
        {([1, 2] as const).map(n => <button type="button" key={n} aria-pressed={level === n} disabled={busy || !!pending} onClick={() => { setLevel(n); setRotation(0); setResult(null); setCountdown(null); }} className={styles.level} data-selected={level === n}>
          <span className={styles.eyebrow}>{n === 1 ? "DESTELLO CELESTIAL" : "CONSTELACIÓN DORADA"}</span>
          <div><strong>Nivel {n}</strong><b>{summary ? (n === 1 ? summary.level_1_spins : summary.level_2_spins) : "—"} <small>giros</small></b></div>
          <span>{n === 1 ? "Compras inferiores a " : "Compras desde "}{summary?.level_2_from ?? "…"} € · importe de tu compra</span>
          <small>{n === 1 ? "Hasta 60 min · 400 Coins" : "Hasta 80 min · 1000 Coins"}</small>
        </button>)}
      </div>
      {message && <div className={styles.message} role="alert">{message} {!pending && <button type="button" onClick={() => void load()}>Volver a cargar</button>}</div>}
      {loading ? <div className={styles.skeleton} role="status">Preparando tu experiencia…</div> : !summary ? <p>No mostramos un saldo hasta poder confirmarlo.</p> : <div className={styles.arena}>
        <div className={styles.stage}>
          <span className={styles.stageLabel}>RULETA NIVEL {level} · {prizes.length} PREMIOS</span>
          <div className={styles.wheelBox}>
            <div className={styles.pointer} aria-hidden="true"/>
            <div className={styles.wheel} style={{ background: gradient, transform: "rotate(" + rotation + "deg)" }} aria-hidden="true">
              {prizes.map((p, i) => {
                const angle = (i + .5) * 2 * Math.PI / prizes.length;
                return <span key={p.id} className={styles.sector} data-winner={result?.reward_id === p.id}
                  style={{ left: (50 + 34 * Math.sin(angle)) + "%", top: (50 - 34 * Math.cos(angle)) + "%", transform: "translate(-50%,-50%) rotate(" + (-rotation) + "deg)" }}>
                  {p.reward_type === "coins" ? <Coins size={18}/> : <Clock3 size={18}/>}<b>{p.reward_value}</b><small>{p.reward_type === "coins" ? "COINS" : "MIN"}</small>
                </span>;
              })}
            </div>
            <button
              type="button"
              className={styles.core}
              disabled={busy || (!pending && !available)}
              onClick={() => void spin()}
              aria-label={pending ? "Comprobar giro pendiente" : available ? `Girar ruleta Nivel ${level}` : "No hay giros disponibles"}
            >
              <RotateCw size={24}/>
              <strong>{busy ? "…" : pending ? "COMPROBAR" : available ? "GIRAR" : "SIN GIROS"}</strong>
              <small>NIVEL {level}</small>
            </button>
          </div>
          <small className={styles.wheelNote}>Sectores ilustrativos. El premio se determina de forma segura al confirmar el giro.</small>
        </div>
        <div className={styles.controls}>
          <span className={styles.eyebrow}>ELIGE TU MOMENTO</span>
          <h3>{available ? "Tu próximo premio te espera" : "Desbloquea tu próximo giro"}</h3>
          <p>Un giro por cada compra distinta confirmada. Puedes acumular todos los que quieras.</p>
          <ul className={styles.prizes}>{prizes.map(p => <li key={p.id} data-special={p.special}>
            {p.reward_type === "coins" ? <Coins size={18}/> : <Clock3 size={18}/>}
            <span>{prizeLabel(p)}{p.special && <small>PREMIO ESPECIAL</small>}</span>
          </li>)}</ul>
          <button type="button" className={styles.spin} disabled={busy || (!pending && !available)} onClick={() => void spin()}>
            <RotateCw size={20}/>{busy ? "Descubriendo tu premio…" : pending ? "Comprobar mi giro pendiente" : "Girar · Nivel " + level}
          </button>
          {!available && !pending && <Link className={styles.buy} href="/cliente/precios-ofertas">Ver consultas · Desbloquear un giro <ArrowRight size={17}/></Link>}
          <div className={styles.trust}><ShieldCheck size={18}/><span>El premio se decide y se acredita de forma segura antes de mostrar el resultado.</span></div>
        </div>
      </div>}
      {result && <section ref={resultRef} className={styles.result} data-special={result.special} role="status" aria-live="polite">
        <div className={styles.rewardIcon}>{result.reward_type === "coins" ? <Coins size={38}/> : <Clock3 size={38}/>}</div>
        <span className={styles.eyebrow}>{result.special ? "¡PREMIO ESPECIAL CELESTIAL!" : "¡TU PREMIO YA ES TUYO!"}</span>
        <h3>{prizeLabel(result)}</h3>
        <p>Abono confirmado en tus {result.reward_type === "coins" ? "Coins" : "minutos FREE"}.</p>
        <div className={styles.balance}><span>Antes <b>{result.balance_before}</b></span><ArrowRight/><span>Después <b>{result.balance_after}</b></span></div>
        <button type="button" className={styles.spin} onClick={goToBalance}>Ver mis {result.reward_type === "coins" ? "Coins" : "minutos"} <ArrowRight size={18}/></button>
        {countdown === null ? <button className={styles.subtle} type="button" onClick={() => setCountdown(4)}>Ir a mi saldo en 4 segundos</button>
          : <p>Volviendo a tu saldo en {countdown}… <button type="button" className={styles.subtle} onClick={() => setCountdown(null)}>Permanecer aquí</button></p>}
      </section>}
      <footer className={styles.footer}><Sparkles size={16}/> Tus giros de Ruleta son independientes de las tiradas del Oráculo. Siempre sabes qué has ganado.</footer>
    </section>
  );
}
