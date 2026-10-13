"use client";
import ClientPurchaseAction from "@/components/cliente/ClientPurchaseAction";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowRight, Gift, Moon, PhoneCall, ShoppingBag, Sparkles, Sun, WandSparkles } from "lucide-react";
import ClienteLayout from "@/components/cliente/ClienteLayout";
import RouletteRewardArt from "@/components/cliente/RouletteRewardArt";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import type { RouletteLevel, RouletteSummary } from "@/lib/ruleta";
import styles from "./PricesOffers.module.css";

const sb = supabaseClienteBrowser();
const PURCHASE_ATTEMPT_PREFIX = "tc-client-purchase-attempt:v1:";
const attemptUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type OraclePack = { id: string; nombre: string; descripcion: string; priceEur: number; credits: number };
type QuestionPack = { id: string; nombre: string; descripcion: string; priceEur: number; questions: number };
type RankPackBenefit = { enabled?: boolean; coins?: number; oracle_credits?: number; roulette_level_1_spins?: number; roulette_level_2_spins?: number; roulette_level_3_spins?: number; roulette_special_spins?: number };
type MinutePack = { id: string; nombre: string; descripcion: string; priceUsd: number; totalMinutes: number; bonusMinutes: number; rouletteLevel: RouletteLevel; rouletteSpins: number; rewardCoins?: number; oracleCredits?: number; highlight?: boolean; packageLevel?: 1 | 2 | 3 | null; rankBenefits?: RankPackBenefit | null; rankBenefitsStatus?: string };
type PromotionPack = { id: string; name: string; description?: string | null; paid_minutes: number; free_minutes: number; price: number; regular_price?: number | null; currency: "EUR" | "USD"; roulette_level?: RouletteLevel | null; roulette_spins: number; coins: number; oracle_credits: number; extra_benefit?: string | null; is_recommended: boolean; is_active: boolean; sort_order: number; packageLevel?: 1 | 2 | 3 | null; rankBenefits?: RankPackBenefit | null; rankBenefitsStatus?: string };
type ActivePromotion = { id: string; name: string; subtitle?: string | null; description?: string | null; effective_status: string; starts_at?: string | null; ends_at?: string | null; active_until_disabled: boolean; packages: PromotionPack[] };

// Standard packs use levels 1–3; level 4 belongs to special promotions.
type StandardPackLevel = Extract<RouletteLevel, 1 | 2 | 3>;
type CheckoutFeedback = { message: string; pendingUrl: string | null };



export default function PreciosOfertasPage() {
  const [rouletteSummary, setRouletteSummary] = useState<RouletteSummary | null>(null);
  const [oraclePacks, setOraclePacks] = useState<OraclePack[]>([]);
  const [questionPack, setQuestionPack] = useState<QuestionPack | null>(null);
  const [minutePacks, setMinutePacks] = useState<MinutePack[]>([]);
  const [rankLabel, setRankLabel] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<ActivePromotion | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [pendingCheckoutUrl, setPendingCheckoutUrl] = useState<string | null>(null);
  const [checkoutMessagePack, setCheckoutMessagePack] = useState<string | null>(null);
  type Resource = "catalogue" | "roulette" | "account" | "promotion";
  type LoadState = "loading" | "ready" | "error";
  const [states, setStates] = useState<Record<Resource, LoadState>>({ catalogue: "loading", roulette: "loading", account: "loading", promotion: "loading" });
  const controllers = useRef<Partial<Record<Resource, AbortController>>>({});
  const generation = useRef(0), owner = useRef<string | null>(null), mounted = useRef(false), lastRefresh = useRef(0);
  const purchaseInFlight = useRef(false);

  const resetAccount = useCallback((id: string | null) => {
    ++generation.current; owner.current = id; lastRefresh.current = 0;
    Object.values(controllers.current).forEach(controller => controller?.abort()); controllers.current = {};
    setMinutePacks([]); setRankLabel(null); setOraclePacks([]); setQuestionPack(null); setPromotion(null); setRouletteSummary(null); setCredits(null); setMessage(""); setPendingCheckoutUrl(null); setCheckoutMessagePack(null); setBusy("");
    setStates({ catalogue: "loading", roulette: "loading", account: "loading", promotion: "loading" });
  }, []);

  const load = useCallback(async (resources: Resource[] = ["catalogue", "roulette", "account", "promotion"]) => {
    const entryGeneration = generation.current;
    try {
      const { data } = await sb.auth.getSession();
      if (!mounted.current || generation.current !== entryGeneration) return;
      const session = data.session;
      if (!session) { resetAccount(null); window.location.href = "/cliente/login"; return; }
      if (owner.current !== session.user.id) resetAccount(session.user.id);
      const currentGeneration = generation.current, id = session.user.id;
      const endpoints: Record<Resource, string> = { catalogue: "/api/cliente/catalogo", roulette: "/api/cliente/ruleta", account: "/api/cliente/state", promotion: "/api/cliente/promotions/active" };
      let refresh: ReturnType<typeof sb.auth.refreshSession> | undefined;
      lastRefresh.current = Date.now();
      // Each section commits as soon as its own response arrives; slow rewards never hold prices.
      await Promise.allSettled(resources.map(async resource => {
        if (controllers.current[resource]) return;
        const controller = new AbortController(); controllers.current[resource] = controller;
        const isCurrent = () => mounted.current && currentGeneration === generation.current && owner.current === id && controllers.current[resource] === controller;
        const timer = window.setTimeout(() => controller.abort(), 12000);
        setStates(current => ({ ...current, [resource]: "loading" }));
        try {
          const read = (token: string) => fetch(endpoints[resource], { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
          let response = await read(session.access_token);
          if (response.status === 401) {
            const renewed = (await (refresh ??= sb.auth.refreshSession())).data.session;
            if (!renewed || renewed.user.id !== id || !isCurrent()) throw new Error("session");
            response = await read(renewed.access_token);
          }
          const json = await response.json();
          if (!response.ok || !json?.ok) throw new Error("unavailable");
          if (!isCurrent()) return;
          if (resource === "catalogue") {
            if (!Array.isArray(json.packs) || !Array.isArray(json.oraclePacks)) throw new Error("catalogue");
            setMinutePacks(json.packs); setOraclePacks(json.oraclePacks); setQuestionPack(json.questionPack || null);
            setRankLabel(typeof json.rankLabel === "string" && json.rankLabel.trim() ? json.rankLabel.trim() : null);
          } else if (resource === "roulette") {
            if (!Array.isArray(json.catalogue)) throw new Error("roulette");
            setRouletteSummary(json);
          } else if (resource === "account") {
            const value = json.state?.oracle_credits;
            if (value == null || !Number.isFinite(Number(value)) || Number(value) < 0) throw new Error("credits");
            setCredits(Number(value));
          } else setPromotion(json.promotion || null);
          setStates(current => ({ ...current, [resource]: "ready" }));
        } catch {
          if (isCurrent()) {
            if (resource === "roulette") setRouletteSummary(null);
            if (resource === "account") setCredits(null);
            if (resource === "promotion") setPromotion(null);
            setStates(current => ({ ...current, [resource]: "error" }));
          }
        } finally {
          window.clearTimeout(timer);
          if (controllers.current[resource] === controller) delete controllers.current[resource];
        }
      }));
    } catch {
      if (mounted.current && generation.current === entryGeneration) setStates(current => ({ ...current, catalogue: "error" }));
    }
  }, [resetAccount]);

  useEffect(() => {
    mounted.current = true;
    void load();
    let authTimer: ReturnType<typeof setTimeout> | undefined;
    const { data: auth } = sb.auth.onAuthStateChange((_event, session) => {
      const id = session?.user.id || null;
      if (id === owner.current) return;
      resetAccount(id);
      clearTimeout(authTimer); authTimer = setTimeout(() => void load(), 0);
    });
    const channel = sb.channel("tc-client-promotions-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "tc_client_promotions" }, () => { void load(["promotion"]); })
      .on("postgres_changes", { event: "*", schema: "public", table: "tc_client_promotion_packages" }, () => { void load(["promotion"]); })
      .subscribe();
    const focus = () => { if (document.visibilityState !== "hidden" && Date.now() - lastRefresh.current > 15000) void load(); };
    const changed = () => void load();
    window.addEventListener("focus", focus);
    window.addEventListener("online", changed);
    window.addEventListener("tc-client-balances-changed", changed);
    return () => {
      mounted.current = false; ++generation.current; clearTimeout(authTimer); auth.subscription.unsubscribe();
      Object.values(controllers.current).forEach(controller => controller?.abort()); controllers.current = {};
      window.removeEventListener("focus", focus); window.removeEventListener("online", changed); window.removeEventListener("tc-client-balances-changed", changed); void sb.removeChannel(channel);
    };
  }, [load, resetAccount]);

  async function checkout(endpoint: string, packId: string) {
    const checkoutGeneration = generation.current;
    try {
      setBusy(packId);
      setMessage("");
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Sesión no válida");
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ pack_id: packId }),
      });
      const result = await response.json().catch(() => null);
      if (!mounted.current || generation.current !== checkoutGeneration || owner.current !== data.session?.user.id) return;
      if (!result?.ok || !result?.url) throw new Error(result?.error || "No hemos podido iniciar el pago");
      window.location.href = result.url;
    } catch (error) {
      if (mounted.current && generation.current === checkoutGeneration) setMessage(error instanceof Error ? error.message : "No hemos podido iniciar el pago");
    } finally {
      if (mounted.current && generation.current === checkoutGeneration) setBusy("");
    }
  }

  async function checkoutMinutes(packId: string) {
    if (purchaseInFlight.current || states.catalogue !== "ready") return;
    purchaseInFlight.current = true;
    const checkoutGeneration = generation.current;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      setBusy(packId); setMessage(""); setPendingCheckoutUrl(null); setCheckoutMessagePack(packId);
      const { data } = await sb.auth.getSession();
      const session = data.session;
      const isCurrent = () => mounted.current && generation.current === checkoutGeneration && owner.current === session?.user.id;
      if (!isCurrent()) return;
      if (!session) throw new Error("Tu sesión ha caducado. Vuelve a iniciar sesión para comprar.");
      const key = `${PURCHASE_ATTEMPT_PREFIX}${session.user.id}:${packId}`;
      let stored: { attemptId: string; url?: string } | null = null;
      try {
        const raw = localStorage.getItem(key);
        if (raw) { const parsed = JSON.parse(raw); if (attemptUuid.test(parsed?.attemptId || "")) stored = parsed; }
      } catch { /* A damaged entry is replaced below before making a request. */ }
      const attemptId = stored?.attemptId || crypto.randomUUID();
      try { localStorage.setItem(key, JSON.stringify({ attemptId, ...(stored?.url ? { url: stored.url } : {}) })); }
      catch { throw new Error("Tu navegador no puede guardar este intento de compra. Permite el almacenamiento del sitio y vuelve a intentarlo."); }
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 30000);
      const request = (token: string) => fetch("/api/cliente/pagos/paypal", { method: "POST", cache: "no-store", signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ packId, attemptId }) });
      let response = await request(session.access_token);
      if (response.status === 401) {
        const refreshed = (await sb.auth.refreshSession()).data.session;
        if (!isCurrent() || refreshed?.user.id !== session.user.id) throw new Error("Tu sesión ha caducado. Vuelve a iniciar sesión.");
        response = await request(refreshed.access_token);
      }
      const result = await response.json().catch(() => null);
      if (!isCurrent()) return;
      if (response.status === 409 && result?.url) {
        const pendingUrl = new URL(result.url, window.location.origin);
        if (pendingUrl.origin === window.location.origin && pendingUrl.pathname === "/pago-tarjeta" && attemptUuid.test(pendingUrl.searchParams.get("ref") || "")) setPendingCheckoutUrl(pendingUrl.pathname + pendingUrl.search);
      }
      if (!response.ok || !result?.ok || !result?.url) throw new Error(result?.error || "No hemos podido preparar el pago. Vuelve a intentarlo: recuperaremos la misma compra.");
      const url = new URL(result.url, window.location.origin);
      if (url.origin !== window.location.origin || url.pathname !== "/pago-tarjeta" || !attemptUuid.test(url.searchParams.get("ref") || "")) throw new Error("No hemos podido verificar el enlace de pago. Vuelve a intentarlo.");
      const confirmedAttemptId = attemptUuid.test(result.attempt_id || "") ? result.attempt_id : attemptId;
      localStorage.setItem(key, JSON.stringify({ attemptId: confirmedAttemptId, url: url.pathname + url.search }));
      window.location.href = url.pathname + url.search;
    } catch (error) {
      if (mounted.current && generation.current === checkoutGeneration) setMessage(error instanceof Error && error.name !== "AbortError" ? error.message : "La conexión ha tardado demasiado. Vuelve a intentarlo: recuperaremos el mismo intento de pago.");
    } finally {
      clearTimeout(timeout); purchaseInFlight.current = false;
      if (mounted.current && generation.current === checkoutGeneration) setBusy("");
    }
  }

  async function checkoutPromotion(packageId: string) {
    const checkoutGeneration = generation.current;
    try {
      setBusy(`promo:${packageId}`);
      setMessage("");
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Sesión no válida");
      const response = await fetch("/api/cliente/promotions/checkout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ package_id: packageId }),
      });
      const result = await response.json().catch(() => null);
      if (!mounted.current || generation.current !== checkoutGeneration || owner.current !== data.session?.user.id) return;
      if (!result?.ok || !result?.url) throw new Error(result?.error || "No hemos podido iniciar el pago");
      window.location.href = result.url;
    } catch (error) {
      if (mounted.current && generation.current === checkoutGeneration) setMessage(error instanceof Error ? error.message : "No hemos podido iniciar el pago");
    } finally {
      if (mounted.current && generation.current === checkoutGeneration) setBusy("");
    }
  }

  const packageLevel = (pack: MinutePack): StandardPackLevel | null => pack.packageLevel ?? null;
  const levelOnePacks = minutePacks.filter((pack) => packageLevel(pack) === 1);
  const levelTwoPacks = minutePacks.filter((pack) => packageLevel(pack) === 2);
  const levelThreePacks = minutePacks.filter((pack) => packageLevel(pack) === 3);
  const unassignedPacks = minutePacks.filter((pack) => packageLevel(pack) === null);

  return (
    <ClienteLayout
      title="Precios y ofertas"
      subtitle="Elige tu consulta y descubre el premio que puede acompañarla."
      summaryItems={[
        { label: "Giros disponibles", value: rouletteSummary ? String(rouletteSummary.available_spins) : "—", meta: states.roulette === "error" ? "Consulta tus giros en Ruleta" : "Premios por tus compras", href: "/cliente/ruleta", tone: "oracle" },
        { label: "Tiradas compradas", value: credits === null ? "—" : String(credits), meta: "Consulta tu carta gratis en Oráculo", href: "/cliente/oraculo", tone: "oracle" },
        { label: "Packs de minutos", value: states.catalogue === "ready" ? String(minutePacks.length) : "—", meta: "Tres niveles de recompensa", tone: "minutes" },
      ]}
    >
      <div className={styles.shell}>
        {states.catalogue === "error" && <div className={styles.message} role="alert">No hemos podido actualizar los precios. Reintenta para consultar los paquetes. <button type="button" onClick={()=>void load(["catalogue"])}>Reintentar precios</button></div>}
        {states.promotion === "error" && <div className={styles.message} role="status">No hemos podido comprobar las promociones. Los paquetes disponibles aparecen debajo. <button type="button" onClick={()=>void load(["promotion"])}>Reintentar promociones</button></div>}
        {message && !checkoutMessagePack ? <div className={styles.message} role="alert">{message}</div> : null}

        <section className={styles.hero}>
          <div className={styles.heroSigil}><Sparkles /></div>
          <div className={styles.heroCopy}>
            <span>TAROT CELESTIAL · TU TIEMPO, TU UNIVERSO</span>
            <h1>Tus minutos, <em>tus beneficios</em></h1>
            <p>Elige el tiempo para tu consulta. Descubre las Coins, tiradas y ruletas que acompañan a cada paquete.</p>
          </div>
          <div className={styles.heroPromise}>
            <ArrowDown />
            <div><strong>Todos los paquetes a la vista</strong><small>Baja para ver los niveles 1, 2 y 3</small></div>
          </div>
        </section>

        {promotion ? (
          <section className={styles.promoSection} data-leo-anchor="active-promotion">
            <div className={styles.promoAura} aria-hidden="true" />
            <div className={styles.promoHeader}>
              <div>
                <span>🔥 PROMOCIÓN DE HOY</span>
                <h2>{promotion.name}</h2>
                <p>{promotion.subtitle || promotion.description || "Una ventaja especial disponible ahora en tu panel."}</p>
              </div>
              <div className={styles.promoLive}><span /> ACTIVA AHORA</div>
            </div>
            <div className={styles.promoGrid}>
              {promotion.packages.map((pack) => (
                <article
                  key={pack.id}
                  className={`${styles.promoCard} ${pack.is_recommended ? styles.promoFeatured : ""}`}
                  data-leo-anchor={pack.is_recommended ? "promotion-featured" : undefined}
                >
                  {pack.is_recommended ? <div className={styles.promoRecommended}>MÁS ELEGIDO</div> : null}
                  <div className={styles.promoPackTop}><Gift /><span>{pack.paid_minutes} MIN {pack.free_minutes ? `+ ${pack.free_minutes} GRATIS` : ""}</span></div>
                  <h3>{pack.name}</h3>
                  {pack.description ? <p>{pack.description}</p> : null}
                  <div className={styles.promoMinutes}><strong>{pack.paid_minutes}</strong><span>minutos</span>{pack.free_minutes ? <><b>+</b><strong>{pack.free_minutes}</strong><span>GRATIS</span></> : null}</div>
                  <div className={styles.promoPrice}>{pack.regular_price && Number(pack.regular_price) > Number(pack.price) ? <del>{formatPromoMoney(pack.regular_price, pack.currency)}</del> : null}<strong>{formatPromoMoney(pack.price, pack.currency)}</strong></div>
                  <div className={styles.promoBenefits}>
                    {pack.coins > 0 ? <span>🪙 +{pack.coins} Coins</span> : null}
                    {pack.roulette_spins > 0 && pack.roulette_level ? <span>{Number(pack.roulette_level) === 4 ? `🎰 +${pack.roulette_spins} giro${pack.roulette_spins === 1 ? "" : "s"} SUPER RULETA · Nivel Especial` : `🎡 +${pack.roulette_spins} giro${pack.roulette_spins === 1 ? "" : "s"} Nivel ${pack.roulette_level}`}</span> : null}
                    {pack.oracle_credits > 0 ? <span>🔮 +{pack.oracle_credits} tirada{pack.oracle_credits === 1 ? "" : "s"} del Oráculo</span> : null}
                    {pack.extra_benefit ? <span>✦ {pack.extra_benefit}</span> : null}
                    {pack.rankBenefits?.enabled ? <span><strong>Por tu rango:</strong> {rankBenefitSummary(pack.rankBenefits)}</span> : null}
                    {pack.rankBenefitsStatus === "unavailable" ? <span><strong>Beneficios de rango:</strong> no disponibles temporalmente. El pack y su precio siguen disponibles.</span> : null}
                    {pack.rankBenefitsStatus === "unmapped_package" ? <span><strong>Beneficios de rango:</strong> esta promoción aún no tiene nivel asignado.</span> : null}
                  </div>
                  <ClientPurchaseAction className={styles.promoBuy}><button className={styles.promoBuy} disabled={busy === `promo:${pack.id}` || states.promotion !== "ready"} onClick={() => checkoutPromotion(pack.id)}>{busy === `promo:${pack.id}` ? "Conectando…" : "COMPRAR AHORA"}</button></ClientPurchaseAction>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className={`${styles.section} ${styles.minuteSection}`}>
          <div className={styles.heading}>
            <div className={styles.headingIcon}><PhoneCall /></div>
            <div>
              <span>CONSULTAS CELESTIALES</span>
              <h2>Encuentra tus minutos</h2>
              <p>Compara el tiempo, el precio y todo lo que incluye tu compra.</p>
            </div>
            <Link className={styles.rouletteShortcut} href="/cliente/ruleta">Ver ruleta <ArrowRight /></Link>
          </div>

          {states.catalogue === "loading" && minutePacks.length === 0 ? <div className={styles.catalogueLoading} role="status" aria-label="Cargando precios"><p>Preparando tus paquetes y beneficios…</p><div className={styles.loadingGrid} aria-hidden="true">{[1,2,3].map(item=><div className={styles.loadingCard} key={item}><span/><span/><span/></div>)}</div></div> : null}
          {minutePacks.length > 0 ? <div className={styles.levelStack} aria-busy={states.catalogue === "loading"}>
            {([
              { level: 1, packs: levelOnePacks, nextPacks: levelTwoPacks },
              { level: 2, packs: levelTwoPacks, nextPacks: levelThreePacks },
              { level: 3, packs: levelThreePacks, nextPacks: [] },
            ] as const).map(({ level, packs, nextPacks }) => packs.length > 0 ? (
              <section key={level} id={`nivel-${level}`} className={styles.level} data-purchase-level={level} aria-labelledby={`level-${level}-title`}>
                <div className={styles.levelContent}>
                  <div className={styles.levelHeader}>
                    <div className={styles.levelMedallion} aria-hidden="true">{level === 1 ? <Sparkles /> : level === 2 ? <Moon /> : <Sun />}</div>
                    <div className={styles.levelIdentity}>
                      <span>{level === 1 ? "TU PRIMER PASO" : level === 2 ? "MÁS TIEMPO PARA TI" : "TU CONSULTA MÁS EXTENSA"}</span>
                      <h3 id={`level-${level}-title`}>Nivel {level} <span>· {minutesRange(packs)}</span></h3>
                    </div>
                  </div>
                  <LevelPrizeBanner packs={packs} summary={rouletteSummary} />
                  <div className={styles.minuteGrid}>
                    {packs.map(pack => <MinuteCard key={pack.id} pack={pack} packageLevel={level} rankLabel={rankLabel} busy={busy === pack.id} unavailable={states.catalogue !== "ready" || Boolean(busy)} onBuy={() => checkoutMinutes(pack.id)} feedback={checkoutMessagePack === pack.id ? { message, pendingUrl: pendingCheckoutUrl } : null} />)}
                  </div>
                  {nextPacks.length > 0 ? <a className={styles.nextLevelLink} href={`#nivel-${level + 1}`}><span>{level === 1 ? "¿Quieres más tiempo?" : "¿Prefieres una consulta más larga?"}</span><strong>Ver paquetes {minutesRange(nextPacks).toLowerCase()} <ArrowDown aria-hidden="true" /></strong></a> : null}
                </div>
              </section>
            ) : null)}
          </div> : states.catalogue === "ready" ? <p className={styles.message}>Ahora mismo no hay paquetes de minutos disponibles.</p> : null}

          {unassignedPacks.length > 0 ? <section className={`${styles.level} ${styles.unassignedLevel}`} aria-labelledby="unassigned-packs-title">
            <div className={styles.levelHeader}>
              <div className={styles.levelMedallion}><ShoppingBag /></div>
              <div className={styles.levelIdentity}><span>PAQUETES DISPONIBLES</span><h3 id="unassigned-packs-title">Elige tus minutos</h3><p>Consulta el precio y los beneficios de cada paquete.</p></div>
            </div>
            <div className={styles.minuteGrid}>
              {unassignedPacks.map(pack => <MinuteCard key={pack.id} pack={pack} packageLevel={null} rankLabel={rankLabel} busy={busy === pack.id} unavailable={states.catalogue !== "ready" || Boolean(busy)} onBuy={() => checkoutMinutes(pack.id)} feedback={checkoutMessagePack === pack.id ? { message, pendingUrl: pendingCheckoutUrl } : null} />)}
            </div>
          </section> : null}

          <div className={styles.maintenanceNote}>
            <PhoneCall />
            <span>Elige tu pack y disfruta de sus minutos y beneficios en tu cuenta.</span>
          </div>
        </section>

        <section id="oraculo-packs" className={styles.section}>
          <div className={styles.heading}>
            <div className={styles.headingIcon}><WandSparkles /></div>
            <div><span>ORÁCULO</span><h2>Tiradas y preguntas</h2><p>Experiencias independientes de tus Coins y minutos.</p></div>
          </div>
          <div className={styles.grid}>
            {oraclePacks.map((pack, index) => (
              <article key={pack.id} className={`${styles.card} ${index === 1 ? styles.featured : ""}`}>
                <div className={styles.serviceTop}><div className={styles.icon}>{index === 0 ? "🔮" : "✨"}</div><span className={styles.badge}>{pack.credits} TIRADAS</span></div>
                <h3>{pack.nombre}</h3><p>{pack.descripcion}</p>
                <strong className={styles.price}>${pack.priceEur.toFixed(2).replace(".", ",")}</strong>
                <ClientPurchaseAction className={styles.buyButton}><button className={styles.buyButton} disabled={busy === pack.id || states.catalogue !== "ready"} onClick={() => checkout("/api/cliente/oraculo/checkout", pack.id)}>{busy === pack.id ? "Conectando…" : "COMPRAR"}</button></ClientPurchaseAction>
              </article>
            ))}
            {questionPack ? (
              <article className={`${styles.card} ${styles.featured}`}>
                <div className={styles.serviceTop}><div className={styles.icon}>💬</div><span className={styles.badge}>{questionPack.questions} PREGUNTAS</span></div>
                <h3>{questionPack.nombre}</h3><p>{questionPack.descripcion}</p>
                <strong className={styles.price}>${questionPack.priceEur.toFixed(2).replace(".", ",")}</strong>
                <ClientPurchaseAction className={styles.buyButton}><button className={styles.buyButton} disabled={busy === questionPack.id || states.catalogue !== "ready"} onClick={() => checkout("/api/cliente/oraculo/checkout", questionPack.id)}>{busy === questionPack.id ? "Conectando…" : "COMPRAR"}</button></ClientPurchaseAction>
              </article>
            ) : null}
          </div>
        </section>

        {!promotion && states.promotion === "ready" ? <section className={`${styles.section} ${styles.coming}`}>
          <Gift /><div><span>OFERTAS</span><h2>Nuevas promociones próximamente</h2><p>Ahora mismo ves los precios normales. Cuando haya una promoción activa aparecerá aquí automáticamente.</p></div>
        </section> : null}
      </div>
    </ClienteLayout>
  );
}

function formatPromoMoney(value: number, currency: string) {
  try { return Number(value || 0).toLocaleString("es-ES", { style: "currency", currency }); }
  catch { return `${Number(value || 0).toFixed(2)} ${currency}`; }
}

function minutesRange(packs: readonly MinutePack[]) {
  const values = packs.map(pack => pack.totalMinutes);
  const lowest = Math.min(...values), highest = Math.max(...values);
  return lowest === highest ? `${lowest} minutos` : `De ${lowest} a ${highest} minutos`;
}

function LevelPrizeBanner({ packs, summary }: { packs: readonly MinutePack[]; summary: RouletteSummary | null }) {
  // The commercial package level may differ from the wheel actually included.
  const wheelLevels = new Set(packs.filter(pack => pack.rouletteSpins > 0).map(pack => pack.rouletteLevel));
  const everyPackHasWheel = packs.length > 0 && packs.every(pack => pack.rouletteSpins > 0);
  const level = everyPackHasWheel && wheelLevels.size === 1 ? wheelLevels.values().next().value : null;
  if (!level) return <div className={styles.prizeBanner}><span className={styles.wheelIcon} aria-hidden="true"><Sun /></span><div><p>{wheelLevels.size > 0 ? "Descubre la ruleta que incluye cada paquete" : "Descubre lo que incluye tu compra"}</p><span>Consulta los beneficios que aparecen en cada tarjeta.</span></div></div>;
  const wheelLabel = level === 4 ? "Especial" : level === 5 ? "Diamante" : `Nivel ${level}`;
  const prizes = summary?.catalogue.filter(prize => prize.nivel === level) ?? [];
  const minutes = Math.max(0, ...prizes.filter(prize => prize.reward_type === "minutes").map(prize => Number(prize.reward_value) || 0));
  const coins = Math.max(0, ...prizes.filter(prize => prize.reward_type === "coins").map(prize => Number(prize.reward_value) || 0));
  return <div className={styles.prizeBanner}>
    <span className={styles.wheelIcon} aria-hidden="true"><Sun /></span>
    <div><p>{minutes > 0 || coins > 0 ? <>Tu ruleta puede darte {minutes > 0 ? <strong>hasta {minutes} min</strong> : null}{minutes > 0 && coins > 0 ? " o " : null}{coins > 0 ? <strong>{minutes > 0 ? "" : "hasta "}{coins.toLocaleString("es-ES")} Coins</strong> : null}</> : <>Descubre los premios de la ruleta {wheelLabel}</>}</p><span>Ruleta {wheelLabel} · Premios posibles, no garantizados</span></div>
    <Link href={`/cliente/ruleta?nivel=${level}`} aria-label={`Ver premios de la ruleta ${wheelLabel}`}><ArrowRight aria-hidden="true" /></Link>
  </div>;
}

function MinuteCard({ pack, packageLevel, rankLabel, busy, unavailable, onBuy, feedback }: { pack: MinutePack; packageLevel: StandardPackLevel | null; rankLabel: string | null; busy: boolean; unavailable: boolean; onBuy: () => void; feedback: CheckoutFeedback | null }) {
  const rewardCoins = Number(pack.rewardCoins || 0);
  const rank = pack.rankBenefits;
  const rankSpins = rank?.enabled ? [
    { level: 1, count: Number(rank.roulette_level_1_spins || 0) },
    { level: 2, count: Number(rank.roulette_level_2_spins || 0) },
    { level: 3, count: Number(rank.roulette_level_3_spins || 0) },
    { level: 4, count: Number(rank.roulette_special_spins || 0) },
  ].filter(item => item.count > 0) : [];
  return <article className={`${styles.card} ${styles.minuteCard} ${pack.highlight ? styles.featured : ""}`} data-level={packageLevel || undefined} data-highlight={pack.highlight ? "true" : "false"}>
    <div className={styles.cardTopline}><span>{packageLevel ? `Paquete Nivel ${packageLevel}` : "Paquete de minutos"}</span>{pack.highlight ? <span className={styles.recommended}>Recomendado</span> : null}</div>
    <div className={styles.minuteIdentity}>
      <span className={styles.miniWheel} aria-hidden="true"><Sun /></span>
      <h3 aria-label={pack.nombre}><strong>{pack.totalMinutes}</strong><span>minutos</span></h3>
    </div>
    <div className={styles.priceRow}><strong className={styles.price}>{formatPromoMoney(pack.priceUsd, "EUR")}</strong><span>Tu consulta</span></div>
    <div className={styles.includedBenefits} data-benefits="included">
      <strong className={styles.benefitLabel}>Tu paquete incluye</strong>
      {pack.rouletteSpins > 0 && pack.rouletteLevel ? <Link className={styles.includedRow} href={`/cliente/ruleta?nivel=${pack.rouletteLevel}`}><span className={styles.benefitGlyph} aria-hidden="true"><Sun /></span><span><strong>{pack.rouletteSpins} {pack.rouletteSpins === 1 ? "giro" : "giros"}</strong> · Ruleta {pack.rouletteLevel === 4 ? "Especial" : `Nivel ${pack.rouletteLevel}`}<small>Ver sus premios <ArrowRight aria-hidden="true" /></small></span></Link> : null}
      {Number(pack.oracleCredits || 0) > 0 ? <div className={styles.includedRow}><RouletteRewardArt type="oracle_credits" className={styles.benefitArt} /><span><strong>{pack.oracleCredits} {pack.oracleCredits === 1 ? "tirada" : "tiradas"}</strong> de Oráculo</span></div> : null}
      {rewardCoins > 0 ? <div className={styles.includedRow}><RouletteRewardArt type="coins" className={styles.benefitArt} /><span><strong>{rewardCoins.toLocaleString("es-ES")} Coins</strong> del paquete</span></div> : null}
      {pack.bonusMinutes > 0 ? <div className={styles.includedRow}><Sparkles aria-hidden="true" /><span><strong>{pack.bonusMinutes} minutos</strong> de regalo incluidos</span></div> : null}
    </div>
    <div className={styles.rankBenefitExtra} data-benefits="rank">
      <div className={styles.rankHeading}><strong>Beneficios por tu rango</strong>{rankLabel ? <span>{rankLabel}</span> : null}</div>
      {rank?.enabled ? <>
        {Number(rank.coins || 0) > 0 ? <div className={styles.rankCoins}><RouletteRewardArt type="coins" className={styles.coinsArt} /><span><strong>+{Number(rank.coins).toLocaleString("es-ES")}</strong> Coins</span></div> : null}
        {Number(rank.oracle_credits || 0) > 0 ? <div className={styles.rankReward}><WandSparkles aria-hidden="true" /><span>+{rank.oracle_credits} {rank.oracle_credits === 1 ? "tirada" : "tiradas"} de Oráculo</span></div> : null}
        {rankSpins.map(item => <div key={item.level} className={styles.rankReward}><Sun aria-hidden="true" /><span>+{item.count} {item.count === 1 ? "giro" : "giros"} · Ruleta {item.level === 4 ? "Especial" : `Nivel ${item.level}`}</span></div>)}
        {Number(rank.coins || 0) <= 0 && Number(rank.oracle_credits || 0) <= 0 && rankSpins.length === 0 ? <p>Este paquete no tiene extras de rango.</p> : <small>Se suman a lo incluido en tu paquete.</small>}
      </> : <p>{pack.rankBenefitsStatus === "unavailable" ? "Estamos comprobando tus beneficios. Consulta de nuevo en unos momentos." : pack.rankBenefitsStatus === "unmapped_package" ? "Los extras de este paquete todavía no están disponibles." : "Tu rango actual no añade extras a este paquete."}</p>}
    </div>
    <ClientPurchaseAction className={styles.buyButton} checkoutEnabled><button type="button" className={styles.buyButton} disabled={busy || unavailable} onClick={onBuy}>{busy ? "Preparando pago…" : <>Elegir paquete <ArrowRight aria-hidden="true" /></>}</button></ClientPurchaseAction>
    {feedback?.message ? <div className={styles.checkoutFeedback} role="alert"><p>{feedback.message}</p>{feedback.pendingUrl ? <a href={feedback.pendingUrl}>Revisar pago pendiente <ArrowRight aria-hidden="true" /></a> : null}</div> : null}
    <small className={styles.activationNote}>Beneficios al confirmar la compra.</small>
  </article>;
}

function rankBenefitSummary(value: RankPackBenefit) {
  const parts = [
    Number(value.coins || 0) > 0 ? `+${Number(value.coins).toLocaleString("es-ES")} Coins` : null,
    Number(value.oracle_credits || 0) > 0 ? `+${Number(value.oracle_credits)} Oráculo` : null,
    Number(value.roulette_level_1_spins || 0) > 0 ? `+${Number(value.roulette_level_1_spins)} giro N1` : null,
    Number(value.roulette_level_2_spins || 0) > 0 ? `+${Number(value.roulette_level_2_spins)} giro N2` : null,
    Number(value.roulette_level_3_spins || 0) > 0 ? `+${Number(value.roulette_level_3_spins)} giro N3` : null,
    Number(value.roulette_special_spins || 0) > 0 ? `+${Number(value.roulette_special_spins)} giro Especial` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Sin recompensa adicional configurada";
}

