"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Coins, Clock3, Sparkles, ShieldCheck, ArrowRight, RotateCw, Crown, Gift, Star, CheckCircle2 } from "lucide-react";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import { useRouletteSignal } from "@/hooks/useRouletteSignal";
import { prizeLabel, winningRotation, type RouletteLevel, type RouletteSummary, type RouletteReward } from "@/lib/ruleta";
import { announceLeoCelestial } from "@/lib/leo-celestial-events";
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
        if (saved?.spin_id && [1, 2, 3].includes(saved.level)) {
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
    const requestedLevel = Number(new URLSearchParams(window.location.search).get("nivel"));
    if ([1, 2, 3].includes(requestedLevel)) setLevel(requestedLevel as RouletteLevel);
    void load();
    return () => { mounted.current = false; if (animation.current) clearTimeout(animation.current); };
  }, [load]);
  useRouletteSignal(sb, summary?.cliente_id, load);

  const prizes = useMemo(() => summary?.catalogue.filter(p => p.nivel === level) || [], [summary, level]);
  const levelMeta = useMemo(() => ({
    1: { name: "Destello Celestial", icon: Sparkles, tone: "warm", cap: "Hasta 60 min · 400 Coins" },
    2: { name: "Constelación Dorada", icon: Star, tone: "violet", cap: "Hasta 80 min · 1000 Coins" },
    3: { name: "Corona Astral Premium", icon: Crown, tone: "premium", cap: "Hasta 100 min · 2000 Coins" },
  } as const), []);
  const spinsByLevel = summary ? { 1: summary.level_1_spins, 2: summary.level_2_spins, 3: summary.level_3_spins } : null;
  const nextSpinByLevel = summary ? { 1: summary.next_spin_1, 2: summary.next_spin_2, 3: summary.next_spin_3 } : null;
  const available = spinsByLevel?.[level] ?? null;
  const selectedMeta = levelMeta[level];
  const SelectedLevelIcon = selectedMeta.icon;
  const selectedMaxMinutes = useMemo(() => Math.max(0, ...prizes.filter(p => p.reward_type === "minutes").map(p => Number(p.reward_value || 0))), [prizes]);
  const selectedMaxCoins = useMemo(() => Math.max(0, ...prizes.filter(p => p.reward_type === "coins").map(p => Number(p.reward_value || 0))), [prizes]);
  const selectedSpecial = useMemo(() => prizes.find(p => p.special) || null, [prizes]);
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
      spin_id: nextSpinByLevel?.[level] || "", level,
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
        announceLeoCelestial({
          id: `roulette:${json.spin_id}`,
          reaction: "roulette",
          title: json.special ? "¡Premio especial celestial!" : "¡Tu premio ya es tuyo!",
          message: `${prizeLabel(json)} ya se ha añadido a tus ${json.reward_type === "coins" ? "Coins" : "minutos FREE"}.`,
          href: `/cliente/dashboard?reward=${json.reward_type}&spin=${encodeURIComponent(json.spin_id)}#saldo-${json.reward_type}`,
          actionLabel: "Ver mi nuevo saldo",
          duration: 9_000,
        });
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
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>EXPERIENCIA CELESTIAL · RECOMPENSAS</span>
          <h2>Tu compra <em>tiene premio.</em></h2>
          <p>Una compra confirmada puede desbloquear giros. Cada giro acredita Minutos FREE o Coins directamente en tu saldo real.</p>
          <div className={styles.steps} aria-label="Cómo funciona la Ruleta Celestial">
            <span><b>01</b> Compra</span><ArrowRight size={14}/><span><b>02</b> Gira</span><ArrowRight size={14}/><span><b>03</b> Disfruta</span>
          </div>
        </div>
        <div className={styles.heroSide}>
          <div className={styles.brand} aria-hidden="true"><Image src="/Nuevo-logo-tarot.png" alt="" width={126} height={126} priority/><span/></div>
          <div className={styles.heroBalance}>
            <small>GIROS DISPONIBLES</small>
            <strong>{summary?.available_spins ?? "—"}</strong>
            <span>Saldo real de giros</span>
          </div>
        </div>
      </header>

      <div className={styles.levels} aria-label="Elige el nivel de tu giro">
        {([1, 2, 3] as const).map(n => {
          const meta = levelMeta[n];
          const LevelIcon = meta.icon;
          const count = spinsByLevel?.[n] ?? null;
          return <button
            type="button"
            key={n}
            aria-pressed={level === n}
            disabled={busy || !!pending}
            onClick={() => { setLevel(n); setRotation(0); setResult(null); setCountdown(null); }}
            className={styles.level}
            data-selected={level === n}
            data-level={n}
            data-tone={meta.tone}
          >
            <div className={styles.levelTop}>
              <span className={styles.levelIcon}><LevelIcon size={19}/></span>
              <span className={styles.levelStatus}>{Number(count || 0) > 0 ? "DISPONIBLE" : level === n ? "EXPLORANDO" : "SIN GIROS"}</span>
            </div>
            <span className={styles.eyebrow}>{meta.name.toUpperCase()}</span>
            <div className={styles.levelMain}><strong>Nivel {n}</strong><b>{count ?? "—"} <small>giros</small></b></div>
            <span>{n === 1 ? `Compras inferiores a $${summary?.level_2_from ?? "…"}` : n === 2 ? `Compras desde $${summary?.level_2_from ?? "…"} hasta menos de $${summary?.level_3_from ?? "…"}` : `Compras premium desde $${summary?.level_3_from ?? "…"}`}</span>
            <small className={styles.levelCap}>{meta.cap}</small>
          </button>;
        })}
      </div>

      {message && <div className={styles.message} role="alert">{message} {!pending && <button type="button" onClick={() => void load()}>Volver a cargar</button>}</div>}

      {loading ? <div className={styles.skeleton} role="status">Preparando tu experiencia…</div> : !summary ? <p>No mostramos un saldo hasta poder confirmarlo.</p> : <div className={styles.arena}>
        <div className={styles.stage}>
          <div className={styles.stageHead}>
            <span className={styles.stageLabel}>RULETA NIVEL {level} · {prizes.length} PREMIOS</span>
            <small>{selectedMeta.name}</small>
          </div>
          <div className={styles.wheelBox} data-level={level}>
            <div className={styles.orbitRing} aria-hidden="true"/>
            <div className={styles.pointer} aria-hidden="true"/>
            <div className={styles.wheel} style={{ background: gradient, transform: "rotate(" + rotation + "deg)" }} aria-hidden="true">
              {prizes.map((p, i) => {
                const angle = (i + .5) * 2 * Math.PI / prizes.length;
                return <span key={p.id} className={styles.sector} data-winner={result?.reward_id === p.id} data-special={p.special}
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
              <RotateCw size={25}/>
              <strong>{busy ? "…" : pending ? "COMPROBAR" : available ? "GIRAR" : "SIN GIROS"}</strong>
              <small>NIVEL {level}</small>
            </button>
          </div>
          <small className={styles.wheelNote}>Sectores ilustrativos. El premio se determina y acredita de forma segura antes de mostrar el resultado.</small>
        </div>

        <aside className={styles.controls}>
          <div className={styles.controlsHead}>
            <span className={styles.eyebrow}>ELIGE TU MOMENTO</span>
            <span className={styles.currentLevel}><SelectedLevelIcon size={15}/> Nivel {level}</span>
          </div>
          <h3>{available ? "Tu próximo premio te espera" : "Desbloquea tu próximo giro"}</h3>
          <p>Cada paquete acredita los giros indicados al confirmar el pago. Puedes acumularlos y cada premio consume solo uno.</p>
          <div className={styles.prizeTitle}><Gift size={16}/><span>Premios de este nivel</span><b>{prizes.length}</b></div>
          <ul className={styles.prizes}>{prizes.map(p => <li key={p.id} data-special={p.special}>
            <span className={styles.prizeIcon}>{p.reward_type === "coins" ? <Coins size={18}/> : <Clock3 size={18}/>}</span>
            <span>{prizeLabel(p)}{p.special && <small>PREMIO ESPECIAL</small>}</span>
            {p.special && <Star size={14} className={styles.specialStar}/>} 
          </li>)}</ul>
          <button type="button" className={styles.spin} disabled={busy || (!pending && !available)} onClick={() => void spin()}>
            <RotateCw size={20}/>{busy ? "Descubriendo tu premio…" : pending ? "Comprobar mi giro pendiente" : "Girar · Nivel " + level}
          </button>
          {!available && !pending && <Link className={styles.buy} href="/cliente/precios-ofertas">Ver consultas · Desbloquear un giro <ArrowRight size={17}/></Link>}
          <div className={styles.trust}><ShieldCheck size={18}/><span>El premio se decide y se acredita de forma segura antes de mostrar el resultado.</span></div>
        </aside>
      </div>}

      {result && <section ref={resultRef} className={styles.result} data-special={result.special} data-level={result.spin_level} role="status" aria-live="polite">
        <div className={styles.rewardIcon}>{result.reward_type === "coins" ? <Coins size={38}/> : <Clock3 size={38}/>}</div>
        <span className={styles.eyebrow}>{result.special ? "¡PREMIO ESPECIAL CELESTIAL!" : "¡TU PREMIO YA ES TUYO!"}</span>
        <h3>{prizeLabel(result)}</h3>
        <p>Abono confirmado en tus {result.reward_type === "coins" ? "Coins" : "minutos FREE"}.</p>
        <div className={styles.balance}><span>Antes <b>{result.balance_before}</b></span><ArrowRight/><span>Después <b>{result.balance_after}</b></span></div>
        <button type="button" className={styles.spin} onClick={goToBalance}>Ver mis {result.reward_type === "coins" ? "Coins" : "minutos"} <ArrowRight size={18}/></button>
        {countdown === null ? <button className={styles.subtle} type="button" onClick={() => setCountdown(4)}>Ir a mi saldo en 4 segundos</button>
          : <p>Volviendo a tu saldo en {countdown}… <button type="button" className={styles.subtle} onClick={() => setCountdown(null)}>Permanecer aquí</button></p>}
      </section>}

      {summary && <section className={styles.infoGrid} aria-label="Información de la Ruleta Celestial">
        <article className={styles.infoCard}>
          <span className={styles.infoIcon}><RotateCw size={18}/></span>
          <div><span className={styles.eyebrow}>CÓMO FUNCIONA</span><h4>Tres pasos, sin sorpresas</h4></div>
          <ol>
            <li><b>1</b><span><strong>Compra</strong><small>Una compra confirmada puede generar giros.</small></span></li>
            <li><b>2</b><span><strong>Gira</strong><small>Utiliza un giro del nivel disponible.</small></span></li>
            <li><b>3</b><span><strong>Disfruta</strong><small>El premio llega directamente a tu saldo.</small></span></li>
          </ol>
        </article>

        <article className={styles.infoCard}>
          <span className={styles.infoIcon}><Gift size={18}/></span>
          <div><span className={styles.eyebrow}>NIVEL SELECCIONADO</span><h4>{selectedMeta.name}</h4></div>
          <div className={styles.realStats}>
            <div><small>Giros disponibles</small><strong>{available ?? 0}</strong></div>
            <div><small>Hasta minutos FREE</small><strong>{selectedMaxMinutes}</strong></div>
            <div><small>Hasta Coins</small><strong>{selectedMaxCoins}</strong></div>
          </div>
          {selectedSpecial && <div className={styles.specialHint}><Star size={15}/><span>Este nivel contiene al menos un premio especial.</span></div>}
        </article>

        <article className={styles.infoCard}>
          <span className={styles.infoIcon}><ShieldCheck size={18}/></span>
          <div><span className={styles.eyebrow}>PREMIO REAL</span><h4>Seguro, acreditado y verificable</h4></div>
          <ul className={styles.securityList}>
            <li><CheckCircle2 size={15}/> El giro se valida en servidor.</li>
            <li><CheckCircle2 size={15}/> Un giro solo puede consumirse una vez.</li>
            <li><CheckCircle2 size={15}/> El saldo se actualiza antes de mostrar el premio.</li>
          </ul>
        </article>
      </section>}

      <footer className={styles.footer}><Sparkles size={16}/> Tus giros de Ruleta son independientes de las tiradas del Oráculo. Siempre sabes qué has ganado.</footer>
    </section>
  );
}
