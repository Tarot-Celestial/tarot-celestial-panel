"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import CelestialWheel, { WHEEL_SPIN_MS } from "./CelestialWheel";
import RouletteRewardArt from "./RouletteRewardArt";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Coins, Clock3, Sparkles, ShieldCheck, ArrowRight, RotateCw, Crown, Gift, Star, CheckCircle2, Gem, CalendarCheck2, Flame, Award, Diamond, LockKeyhole } from "lucide-react";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import { useRouletteSignal } from "@/hooks/useRouletteSignal";
import { prizeLabel, rarityLabel, winningRotation, type RouletteLevel, type RouletteSummary, type RouletteReward, type RoulettePrize, type RouletteRewardType } from "@/lib/ruleta";
import { announceLeoCelestial } from "@/lib/leo-celestial-events";
import { LEO_SELECT_ROULETTE } from "@/lib/leo-guide";
import styles from "./PurchaseRoulette.module.css";

const sb = supabaseClienteBrowser();
type Pending = { spin_id: string; level: RouletteLevel };
const storageKey = (id: string) => "tc-ruleta-pending:" + id;

const rarityPower: Record<string, number> = {
  common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, ultra: 5, diamond: 6, jackpot: 7,
};

function arrangeWheelPrizes(input: RoulettePrize[], level: RouletteLevel) {
  const prizes = [...input].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  if (level < 4 || prizes.length < 4) return prizes;

  const strong = prizes
    .filter((p) => Boolean(p.special) || (rarityPower[String(p.rarity || "common")] || 0) >= 4)
    .sort((a, b) => (rarityPower[String(b.rarity || "common")] || 0) - (rarityPower[String(a.rarity || "common")] || 0) || Number(a.sort_order || 0) - Number(b.sort_order || 0));
  const regular = prizes.filter((p) => !strong.some((candidate) => candidate.id === p.id));
  const arranged: RoulettePrize[] = [];
  let si = 0;
  let ri = 0;
  const startStrong = strong.length > regular.length;

  while (si < strong.length || ri < regular.length) {
    const wantsStrong = (arranged.length % 2 === 0) === startStrong;
    if (wantsStrong && si < strong.length) arranged.push(strong[si++]);
    else if (!wantsStrong && ri < regular.length) arranged.push(regular[ri++]);
    else if (ri < regular.length) arranged.push(regular[ri++]);
    else if (si < strong.length) arranged.push(strong[si++]);
  }
  return arranged;
}

function RewardGlyph({ type, size = 18 }: { type: RouletteRewardType; size?: number }) {
  if (type === "coins") return <Coins size={size}/>;
  if (type === "rank") return <Crown size={size}/>;
  if (type === "ritual") return <ShieldCheck size={size}/>;
  if (type === "streak_minutes") return <CalendarCheck2 size={size}/>;
  if (type === "perk") return <Gem size={size}/>;
  return <Clock3 size={size}/>;
}


export default function PurchaseRoulette({ onReward }: { onReward?: () => void | Promise<void> }) {
  const router = useRouter();
  const [summary, setSummary] = useState<RouletteSummary | null>(null);
  const [level, setLevel] = useState<RouletteLevel>(1);
  const [busy, setBusy] = useState(false);
  const [spinning, setSpinning] = useState(false);
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
  const arenaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  }, [result]);

  const load = useCallback(async () => {
    if (loadingRef.current || inFlight.current) return;
    loadingRef.current = true;
    try {
      const { data } = await sb.auth.getSession();
      if (!data.session) { router.replace("/cliente/login?next=ruleta"); return; }

      const rouletteResponse = await fetch("/api/cliente/ruleta", {
        headers: { Authorization: "Bearer " + data.session.access_token }, cache: "no-store", signal: AbortSignal.timeout(15000),
      });

      const json = await rouletteResponse.json();
      if (!rouletteResponse.ok || !json.ok) throw new Error(json.error || "No hemos podido cargar tus giros.");
      if (!mounted.current) return;
      setSummary(json);

      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey(json.cliente_id)) || "null");
        if (saved?.spin_id && [1, 2, 3, 4, 5].includes(saved.level)) {
          pendingRef.current = saved;
          setPending(saved);
          setLevel(saved.level);
          setMessage("Hay un giro pendiente de comprobar. Recupera su resultado sin gastar otro giro.");
        }
      } catch {}
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : "No hemos podido cargar tus giros. Vuelve a intentarlo.");
    } finally {
      loadingRef.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    mounted.current = true;
    const requestedLevel = Number(new URLSearchParams(window.location.search).get("nivel"));
    if ([1, 2, 3, 4, 5].includes(requestedLevel)) setLevel(requestedLevel as RouletteLevel);
    void load();
    return () => {
      mounted.current = false;
      if (animation.current) clearTimeout(animation.current);
    };
  }, [load]);

  useRouletteSignal(sb, summary?.cliente_id, load);
  useEffect(() => {
    const select = (event: Event) => {
      const requested = Number((event as CustomEvent).detail?.level);
      if (inFlight.current || pendingRef.current || ![1,2,3,4,5].includes(requested)) return;
      setLevel(requested as RouletteLevel); setResult(null); setRotation(0); setCountdown(null);
    };
    window.addEventListener(LEO_SELECT_ROULETTE, select);
    return () => window.removeEventListener(LEO_SELECT_ROULETTE, select);
  }, []);

  const prizes = useMemo(() => summary?.catalogue.filter(p => p.nivel === level) || [], [summary, level]);
  const wheelPrizes = useMemo(() => arrangeWheelPrizes(prizes, level), [prizes, level]);
  const levelMeta = useMemo(() => ({
    1: { name: "Bronce Celestial", icon: Sparkles, tone: "warm" },
    2: { name: "Plata Celestial", icon: Star, tone: "silver" },
    3: { name: "Corona Astral", icon: Crown, tone: "premium" },
    4: { name: "Ruleta Especial", icon: Gift, tone: "special" },
    5: { name: "Ruleta Diamante", icon: Diamond, tone: "diamond" },
  } as const), []);
  const spinsByLevel = summary ? { 1: summary.level_1_spins, 2: summary.level_2_spins, 3: summary.level_3_spins, 4: summary.level_4_spins, 5: summary.level_5_spins } : null;
  const nextSpinByLevel = summary ? { 1: summary.next_spin_1, 2: summary.next_spin_2, 3: summary.next_spin_3, 4: summary.next_spin_4, 5: summary.next_spin_5 } : null;
  const visibleLevels = [1, 2, 3, 4, 5] as const;
  const available = spinsByLevel?.[level] ?? null;
  const selectedMeta = levelMeta[level];
  const SelectedLevelIcon = selectedMeta.icon;
  const isDiamondView = level === 5;

  const selectedMaxMinutes = useMemo(() => Math.max(0, ...prizes.filter(p => p.reward_type === "minutes").map(p => Number(p.reward_value || 0))), [prizes]);
  const selectedMaxCoins = useMemo(() => Math.max(0, ...prizes.filter(p => p.reward_type === "coins").map(p => Number(p.reward_value || 0))), [prizes]);
  const selectedSpecial = useMemo(() => prizes.find(p => p.special) || null, [prizes]);

  const heroEyebrow = isDiamondView ? "BENEFICIO EXCLUSIVO · DIAMANTE" : "TAROT CELESTIAL · TUS RULETAS";
  const heroTitle = "Tus ruletas celestiales";
  const heroSubtitle = isDiamondView
    ? "Consulta los giros y premios disponibles según tus beneficios actuales."
    : "Cada ruleta conserva sus propios giros. Elige un nivel y descubre sus premios configurados.";
  const steps = ["Consulta tus giros", "Elige tu ruleta", "Recibe tu premio"];

  const goToBalance = useCallback(() => {
    if (!result) return;
    if (result.reward_type === "coins" || result.reward_type === "minutes") {
      router.push("/cliente/dashboard?reward=" + result.reward_type + "&spin=" + encodeURIComponent(result.spin_id) + "#saldo-" + result.reward_type);
    }
  }, [router, result]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) { goToBalance(); return; }
    const timer = setTimeout(() => setCountdown(n => n === null ? null : n - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, goToBalance]);

  async function spin(targetLevel: RouletteLevel = level) {
    if (inFlight.current || !summary) return;
    const request = pendingRef.current || { spin_id: nextSpinByLevel?.[targetLevel] || "", level: targetLevel };
    if (!request.spin_id) return;
    setLevel(request.level);
    inFlight.current = true;
    setBusy(true);
    setSpinning(false);
    requestAnimationFrame(() => arenaRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }));
    setResult(null);
    setCountdown(null);
    setMessage("");
    pendingRef.current = request;
    setPending(request);
    try { sessionStorage.setItem(storageKey(summary.cliente_id), JSON.stringify(request)); } catch {}

    try {
      const { data } = await sb.auth.getSession();
      if (!data.session) throw new Error("Tu sesión ha caducado. Vuelve a entrar para recuperar tu giro.");
      const response = await fetch("/api/cliente/ruleta", {
        method: "POST",
        headers: { Authorization: "Bearer " + data.session.access_token, "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(15000),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        if (response.status === 409 || response.status === 403) {
          pendingRef.current = null;
          setPending(null);
          try { sessionStorage.removeItem(storageKey(summary.cliente_id)); } catch {}
        }
        throw new Error(json.error || "No se ha podido confirmar el giro.");
      }
      if (!mounted.current) return;
      const awardedPrizes = arrangeWheelPrizes((json.catalogue || []).filter((p: RoulettePrize) => p.nivel === request.level), request.level);
      const index = awardedPrizes.findIndex((p: RoulettePrize) => p.id === json.reward_id);
      setSummary(json);
      setLevel(request.level);
      if (index >= 0) {
        setSpinning(true);
        setRotation(previous => winningRotation(previous, index, awardedPrizes.length));
      }
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      animation.current = setTimeout(() => {
        if (!mounted.current) return;
        setSpinning(false);
        setResult(json);
        setBusy(false);
        inFlight.current = false;
        setPending(null);
        pendingRef.current = null;
        try { sessionStorage.removeItem(storageKey(summary.cliente_id)); } catch {}
        const instant = json.reward_type === "coins" || json.reward_type === "minutes";
        announceLeoCelestial({
          id: `roulette:${json.spin_id}`,
          reaction: "roulette",
          title: ["legendary","ultra","diamond","jackpot"].includes(String(json.reward_rarity || "")) ? "¡Premio extraordinario!" : "¡Tu premio ya es tuyo!",
          message: instant ? `${prizeLabel(json)} ya está acreditado en tu cuenta.` : `${prizeLabel(json)} ha quedado activado y registrado en tu cuenta.`,
          href: instant ? `/cliente/dashboard?reward=${json.reward_type}&spin=${encodeURIComponent(json.spin_id)}#saldo-${json.reward_type}` : "/cliente/ruleta",
          actionLabel: instant ? "Ver mi nuevo saldo" : "Ver mi premio",
          duration: 9_000,
        });
        void Promise.resolve(onReward?.()).catch(() => {});
        void load();
      }, reduced || index < 0 ? 50 : WHEEL_SPIN_MS + 120);
    } catch (error) {
      if (mounted.current) {
        setMessage(error instanceof Error && !["TimeoutError", "AbortError"].includes(error.name) ? error.message : "Conexión interrumpida. Comprueba el mismo giro sin gastar otro.");
        setBusy(false);
        setSpinning(false);
      }
      inFlight.current = false;
    }
  }

  async function claimBenefit(entitlementId: string) {
    setMessage("");
    try {
      const { data } = await sb.auth.getSession();
      if (!data.session) throw new Error("Tu sesión ha caducado.");
      const response = await fetch("/api/cliente/ruleta/claim", {
        method: "POST",
        headers: { Authorization: "Bearer " + data.session.access_token, "Content-Type": "application/json" },
        body: JSON.stringify({ entitlement_id: entitlementId }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || "No se ha podido reclamar el premio.");
      setMessage(`¡Hecho! +${json.minutes} minutos FREE acreditados.`);
      await Promise.resolve(onReward?.()).catch(() => {});
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se ha podido reclamar el premio.");
    }
  }

  return (
    <section className={styles.wrap} aria-label="Ruleta Ultra Sorpresas" aria-busy={loading}>
      <header className={styles.hero} data-diamond={isDiamondView ? "true" : "false"}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>{heroEyebrow}</span>
          <h2>{heroTitle}</h2>
          <p>Elige tu ruleta y descubre sus tesoros</p>
          <div className={styles.steps} aria-label="Cómo funciona la Ruleta Ultra Sorpresas">
            <span><b>01</b> {steps[0]}</span><ArrowRight size={14}/><span><b>02</b> {steps[1]}</span><ArrowRight size={14}/><span><b>03</b> {steps[2]}</span>
          </div>
        </div>
        <div className={styles.heroSide}>
          <div className={styles.brand} data-diamond={isDiamondView ? "true" : "false"} aria-hidden="true"><Image src="/Nuevo-logo-tarot.png" alt="" width={126} height={126} priority/><span/></div>
          <div className={styles.heroBalance} data-diamond={isDiamondView ? "true" : "false"}>
            <small>{isDiamondView ? "GIROS DIAMANTE DISPONIBLES" : "GIROS DISPONIBLES"}</small>
            <strong>{available ?? "—"}</strong>
            <span>{isDiamondView ? "Saldo real de giros Diamante" : "Saldo real de giros"}</span>
          </div>
        </div>
      </header>

      <div className={styles.levels} aria-label="Elige el nivel de tu giro">
        {visibleLevels.map(n => {
          const meta = levelMeta[n];
          const count = spinsByLevel?.[n] ?? null;
          const locked = !!summary && n === 5 && !summary.diamond_access;
          const catalogue = summary?.catalogue.filter(p => p.nivel === n);
          const highlights = [...(catalogue || [])]
            .sort((a, b) => Number(Boolean(b.special)) - Number(Boolean(a.special)) ||
              Number(a.sort_order || 0) - Number(b.sort_order || 0))
            .slice(0, 3);
          const canSpin = !locked && Number(count || 0) > 0 &&
            !!catalogue?.length && !!nextSpinByLevel?.[n];
          const status = !summary ? "Cargando" : locked ? "No disponible" :
            Number(count || 0) > 0 ? "Disponible" : "Sin giros";
          const description = n === 5 ? "Acceso según rango y campaña activa" :
            n === 4 ? "Giros Especial independientes" : "Giros incluidos en tus beneficios de compra";
          const title = n === 5 ? "Diamante" : n === 4 ? "Especial" : `Nivel ${n}`;
          const selectLevel = (reveal = false) => {
            setLevel(n); setRotation(0); setResult(null); setCountdown(null);
            if (reveal) requestAnimationFrame(() =>
              arenaRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }));
          };
          return <article key={n} data-leo-anchor={`roulette-${n}`} className={styles.level}
            data-selected={level === n} data-level={n} data-tone={meta.tone}
            data-available={Number(count || 0) > 0 && !locked} data-locked={locked}>
            <button type="button" className={styles.cardSelect}
              aria-pressed={level === n} aria-label={`Seleccionar ${meta.name}: ${status}, ${count ?? "consultando"} giros`}
              disabled={busy || !!pending} onClick={() => selectLevel()}>
              <span className={styles.cardArtwork} aria-hidden="true"/>
              <span className={styles.levelStatus}>{locked && <LockKeyhole size={11}/>} {status}</span>
              <span className={styles.cardName}>{meta.name}</span>
              <span className={styles.cardInfo}>
                <span className={styles.levelMain}><strong>{title}</strong>
                  <b>{count ?? "—"} <small>{count === 1 ? "giro" : "giros"}</small></b></span>
                <span className={styles.cardDescription}>{description}</span>
              </span>
            </button>
            <div className={styles.cardRewards}>
              <span className={styles.rewardHeading}>Premios destacados</span>
              <div className={styles.rewardSlots}>
                {[0, 1, 2].map(i => {
                  const prize = locked ? undefined : highlights[i];
                  return <div key={prize?.id || i} className={styles.rewardSlot}
                    data-empty={!prize} data-rarity={prize?.rarity}
                    title={prize ? prizeLabel(prize) : locked ? "Ruleta bloqueada" : "Sin premio configurado"}>
                    {prize ? <><RouletteRewardArt type={prize.reward_type} className={styles.cardTreasure}/>
                      <span className={styles.rewardCaption}>{prizeLabel(prize)}</span></> :
                      <><span className={styles.emptyReward} aria-hidden="true">{locked ? <LockKeyhole size={23}/> : "✦"}</span>
                        <span className={styles.rewardCaption}>{!summary ? "Cargando…" : locked ? "Bloqueado" : "—"}</span></>}
                  </div>;
                })}
              </div>
              <small className={styles.levelCap}>{catalogue == null ? "Consultando premios…" : `${catalogue.length} premios`}</small>
            </div>
            <div className={styles.cardActions}>
              {canSpin && <button type="button" className={styles.cardSpin} data-leo-spin="true"
                disabled={busy || !!pending} onClick={() => void spin(n)}>
                <Sparkles size={16}/>{busy && level === n ? "Girando…" : "Girar ahora"}
              </button>}
              <button type="button" className={styles.cardExplore} data-leo-explore="true" disabled={busy || !!pending}
                onClick={() => selectLevel(true)}>
                {locked ? <><LockKeyhole size={14}/> Ver condiciones</> : <>Explorar premios <ArrowRight size={14}/></>}
              </button>
            </div>
          </article>;
        })}
      </div>
      {message && <div className={styles.message} role="alert">{message} {!pending && <button type="button" onClick={() => void load()}>Volver a cargar</button>}</div>}

      {loading ? <div className={styles.skeleton} role="status">Preparando tu experiencia…</div> : !summary ? <p>No mostramos un saldo hasta poder confirmarlo.</p> : <div ref={arenaRef} className={styles.arena} data-level={level}>
        <div className={styles.stage} data-level={level} data-special={level === 4 ? "true" : "false"} data-diamond={isDiamondView ? "true" : "false"}>
          <div className={styles.stageHead}>
            <span className={styles.stageLabel}>{isDiamondView ? `RULETA DIAMANTE · ${wheelPrizes.length} PREMIOS` : `${level === 4 ? "RULETA ESPECIAL" : "RULETA NIVEL " + level} · ${wheelPrizes.length} PREMIOS`}</span>
            <small>{selectedMeta.name}</small>
          </div>
          <CelestialWheel prizes={wheelPrizes} level={level} rotation={rotation} busy={busy} spinning={spinning}
            pending={!!pending} available={available} winner={result?.reward_id}
            disabled={busy || (!pending && (prizes.length === 0 || !available || !nextSpinByLevel?.[level] || (isDiamondView && !summary.diamond_access)))}
            onSpin={() => void spin()}/>
          <small className={styles.wheelNote}>Sectores ilustrativos. El premio se determina y acredita de forma segura antes de mostrar el resultado.</small>
        </div>

        <aside className={styles.controls} data-level={level} data-special={level === 4 ? "true" : "false"} data-diamond={isDiamondView ? "true" : "false"}>
          <div className={styles.controlsHead}>
            <span className={styles.eyebrow}>ELIGE TU MOMENTO</span>
            <span className={styles.currentLevel}><SelectedLevelIcon size={15}/> {isDiamondView ? "Ruleta Diamante" : level === 4 ? "Especial" : `Nivel ${level}`}</span>
          </div>
          <h3>Tesoros de tu ruleta</h3>
          <p>{isDiamondView && !summary?.diamond_access ? "La ruleta Diamante requiere acceso vigente y una campaña habilitada." : "Minutos, Coins y sorpresas de tu nivel. Cada giro utiliza únicamente el saldo de la ruleta seleccionada."}</p>
          <div className={styles.prizeTitle}><Gift size={16}/><span>{isDiamondView ? "Premios de la Ruleta Diamante" : "Premios de este nivel"}</span><b>{prizes.length}</b></div>
          <ul className={styles.prizes}>{prizes.map(p => <li key={p.id} data-special={p.special} data-rarity={p.rarity || "common"}>
            <span className={styles.prizeIcon}><RouletteRewardArt type={p.reward_type}/></span>
            <span>{prizeLabel(p)}<small>{rarityLabel[(p.rarity || "common") as keyof typeof rarityLabel]}{p.special ? " · PREMIO DESTACADO" : ""}</small></span>
            {p.special && <Star size={14} className={styles.specialStar}/>}
          </li>)}</ul>
          <button type="button" className={styles.spin} data-level={level} data-special={level === 4 ? "true" : "false"} data-diamond={isDiamondView ? "true" : "false"} disabled={busy || (!pending && (prizes.length === 0 || !available || !nextSpinByLevel?.[level] || (isDiamondView && !summary.diamond_access)))} onClick={() => void spin()}>
            {busy ? <RotateCw size={20}/> : isDiamondView ? <Diamond size={20}/> : <RotateCw size={20}/>} {busy ? "Descubriendo tu premio…" : prizes.length === 0 ? "Sin premios configurados" : pending ? "Comprobar mi giro pendiente" : isDiamondView ? "GIRAR · DIAMANTE" : level === 4 ? "Girar · Especial" : "Girar · Nivel " + level}
          </button>
          {!available && !pending && <Link className={styles.buy} href="/cliente/precios-ofertas">{isDiamondView ? "Ver consultas · Conseguir giro Diamante" : "Ver consultas · Desbloquear un giro"} <ArrowRight size={17}/></Link>}
          <div className={styles.trust}><ShieldCheck size={18}/><span>El premio se decide y se acredita de forma segura antes de mostrar el resultado.</span></div>
        </aside>
      </div>}

      {result && <section ref={resultRef} className={styles.result} data-special={result.special} data-level={result.spin_level} data-rarity={result.reward_rarity || "common"} role="status" aria-live="polite">
        <div className={styles.rewardIcon}><RouletteRewardArt type={result.reward_type}/></div>
        <span className={styles.eyebrow}>{["legendary","ultra","diamond","jackpot"].includes(String(result.reward_rarity || "")) ? "¡PREMIO EXTRAORDINARIO!" : result.special ? "¡PREMIO ESPECIAL CELESTIAL!" : "¡TU PREMIO YA ES TUYO!"}</span>
        <h3>{prizeLabel(result)}</h3>
        <p>{result.reward_type === "coins" || result.reward_type === "minutes" ? "Premio acreditado automáticamente en tu saldo real." : result.reward_type === "streak_minutes" ? "Tu premio diario ya está activo. Vuelve cada día para reclamarlo." : "Premio registrado en tu cuenta. Puedes seguir su estado aquí mismo."}</p>
        {(result.reward_type === "coins" || result.reward_type === "minutes")
          ? <><div className={styles.balance}><span>Antes <b>{result.balance_before}</b></span><ArrowRight/><span>Después <b>{result.balance_after}</b></span></div><button type="button" className={styles.spin} onClick={goToBalance}>Ver mi nuevo saldo <ArrowRight size={18}/></button></>
          : <div className={styles.specialResult}><Award size={18}/><span>{result.reward_rarity ? rarityLabel[result.reward_rarity] : "Premio especial"} · {result.fulfillment_mode || "registrado"}</span></div>}
      </section>}

      {summary && <section className={styles.infoGrid} aria-label="Información de la Ruleta Ultra Sorpresas">
        <article className={styles.infoCard}>
          <span className={styles.infoIcon}><RotateCw size={18}/></span>
          <div><span className={styles.eyebrow}>CÓMO FUNCIONA</span><h4>{isDiamondView ? "Compra, gira y disfruta tu privilegio" : "Compra, gira y descubre"}</h4></div>
          <ol>
            <li><b>1</b><span><strong>{isDiamondView ? "Haz una compra válida" : "Compra promo"}</strong><small>{isDiamondView ? "Los giros dependen de los beneficios configurados para tu compra." : "La promoción elegible acredita tu giro."}</small></span></li>
            <li><b>2</b><span><strong>{isDiamondView ? "Gira tu Ruleta Diamante" : "Gira"}</strong><small>{isDiamondView ? "Utiliza un giro Diamante disponible." : "Utiliza un giro del nivel disponible."}</small></span></li>
            <li><b>3</b><span><strong>Gana</strong><small>El servidor acredita o registra el premio antes de mostrarlo.</small></span></li>
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
          {selectedSpecial && <div className={styles.specialHint}><Star size={15}/><span>{isDiamondView ? "La Ruleta Diamante incluye premios premium y configurados desde Administración." : "Este nivel contiene al menos un premio especial."}</span></div>}
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

      {summary?.entitlements?.length ? <section className={styles.benefitsPanel} data-leo-anchor="roulette-entitlements">
        <div className={styles.sectionHead}><div><span className={styles.eyebrow}>PREMIOS ACTIVOS</span><h3>Tus sorpresas especiales</h3></div><span className={styles.sectionCount}>{summary.entitlements.length}</span></div>
        <div className={styles.benefitGrid}>{summary.entitlements.map((e) => {
          const ready = e.reward_type === "streak_minutes" && e.status === "active" && (!e.next_claim_at || new Date(e.next_claim_at).getTime() <= Date.now());
          return <article key={e.id} className={styles.benefitCard}>
            <span className={styles.benefitIcon}><RewardGlyph type={e.reward_type} size={20}/></span>
            <div><strong>{e.reward_name}</strong><small>{e.status === "active" ? "Activo" : "Pendiente de gestión"}{e.total_claims ? ` · ${e.claims_used || 0}/${e.total_claims} reclamados` : ""}</small></div>
            {e.reward_type === "streak_minutes" ? <button type="button" disabled={!ready} onClick={()=>void claimBenefit(e.id)}>{ready ? "Reclamar hoy" : "Próximo en breve"}</button> : <span className={styles.benefitStatus}>{e.status}</span>}
          </article>;
        })}</div>
      </section> : null}

      {summary?.history?.length ? <section className={styles.historyPanel} data-leo-anchor="roulette-history">
        <div className={styles.sectionHead}><div><span className={styles.eyebrow}>HISTORIAL</span><h3>Tus últimos premios</h3></div><Gift size={18}/></div>
        <div className={styles.historyList}>{summary.history.slice(0,8).map((item)=><article key={item.spin_id} data-rarity={item.rarity || "common"}>
          <span className={styles.historyIcon}><RewardGlyph type={item.reward_type} size={17}/></span>
          <div><strong>{item.reward_label}</strong><small>{item.level === 5 ? "Ruleta Diamante" : item.level === 4 ? "Ruleta Especial" : `Nivel ${item.level}`} · {new Date(item.used_at || item.created_at).toLocaleString("es-ES")}</small></div>
          <span className={styles.historyRarity}>{rarityLabel[(item.rarity || "common") as keyof typeof rarityLabel]}</span>
        </article>)}</div>
      </section> : null}

      <footer className={styles.footer}><Sparkles size={16}/> Tus giros de Ruleta Ultra Sorpresas son independientes del Oráculo. La Ruleta Diamante conserva su beneficio especial y cada premio queda registrado y verificable.</footer>
    </section>
  );
}
