"use client";
import ClientPurchaseAction from "@/components/cliente/ClientPurchaseAction";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Crown, Gift, Gem, PhoneCall, ShoppingBag, Sparkles, WandSparkles } from "lucide-react";
import ClienteLayout from "@/components/cliente/ClienteLayout";
import RouletteBenefit from "@/components/cliente/RouletteBenefit";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import type { RouletteLevel, RouletteSummary } from "@/lib/ruleta";
import styles from "./PricesOffers.module.css";

const sb = supabaseClienteBrowser();

type OraclePack = { id: string; nombre: string; descripcion: string; priceEur: number; credits: number };
type QuestionPack = { id: string; nombre: string; descripcion: string; priceEur: number; questions: number };
type RankPackBenefit = { enabled?: boolean; coins?: number; oracle_credits?: number; roulette_level_1_spins?: number; roulette_level_2_spins?: number; roulette_level_3_spins?: number; roulette_special_spins?: number };
type MinutePack = { id: string; nombre: string; descripcion: string; priceUsd: number; totalMinutes: number; bonusMinutes: number; rouletteLevel: RouletteLevel; rouletteSpins: number; rewardCoins?: number; oracleCredits?: number; highlight?: boolean; packageLevel?: 1 | 2 | 3 | null; rankBenefits?: RankPackBenefit | null; rankBenefitsStatus?: string };
type PromotionPack = { id: string; name: string; description?: string | null; paid_minutes: number; free_minutes: number; price: number; regular_price?: number | null; currency: "EUR" | "USD"; roulette_level?: RouletteLevel | null; roulette_spins: number; coins: number; oracle_credits: number; extra_benefit?: string | null; is_recommended: boolean; is_active: boolean; sort_order: number; packageLevel?: 1 | 2 | 3 | null; rankBenefits?: RankPackBenefit | null; rankBenefitsStatus?: string };
type ActivePromotion = { id: string; name: string; subtitle?: string | null; description?: string | null; effective_status: string; starts_at?: string | null; ends_at?: string | null; active_until_disabled: boolean; packages: PromotionPack[] };

// Standard packs use levels 1–3; level 4 belongs to special promotions.
type StandardPackLevel = Extract<RouletteLevel, 1 | 2 | 3>;



export default function PreciosOfertasPage() {
  const [rouletteSummary, setRouletteSummary] = useState<RouletteSummary | null>(null);
  const [oraclePacks, setOraclePacks] = useState<OraclePack[]>([]);
  const [questionPack, setQuestionPack] = useState<QuestionPack | null>(null);
  const [minutePacks, setMinutePacks] = useState<MinutePack[]>([]);
  const [promotion, setPromotion] = useState<ActivePromotion | null>(null);
  const [freeAvailable, setFreeAvailable] = useState(false);
  const [credits, setCredits] = useState(0);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [promotionError, setPromotionError] = useState("");
  const loading = useRef(false);
  const [showLevelThree, setShowLevelThree] = useState(false);

  const loadPromotion = useCallback(async () => {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const response = await fetch("/api/cliente/promotions/active", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }).catch(() => null);
    const json = await response?.json().catch(() => null);
    if (!response?.ok || !json?.ok) { setPromotionError("No hemos podido actualizar la promoción. Puedes reintentar."); return; }
    setPromotion(json.promotion || null);
    setPromotionError("");
  }, []);

  const load = useCallback(async () => {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/cliente/login";
      return;
    }

    if (loading.current) return;
    loading.current = true;
    try {
    let refresh: ReturnType<typeof sb.auth.refreshSession> | undefined;
    const read = async (url: string) => {
      try {
        let response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        if (response.status === 401) {
          const session = (await (refresh ??= sb.auth.refreshSession())).data.session;
          if (!session) return null;
          response = await fetch(url, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
        }
        return response.ok ? await response.json() : null;
      } catch { return null; }
    };
    const [roulette, oracle, customer] = await Promise.all([
      read("/api/cliente/ruleta"), read("/api/cliente/oraculo"), read("/api/cliente/me"),
    ]);

    if (roulette?.ok) setRouletteSummary(roulette);
    if (oracle?.ok) {
      setOraclePacks(Array.isArray(oracle.packs) ? oracle.packs : []);
      setQuestionPack(oracle.questionPack || null);
      setCredits(Number(oracle.credits || 0));
      setFreeAvailable(Boolean(oracle.freeDailyAvailable ?? oracle.freeAvailable));
    }
    if (customer?.ok) setMinutePacks(Array.isArray(customer.packs) ? customer.packs : []);
    setLoadError(!customer?.ok ? "No hemos podido cargar los precios. Reintenta; si tu sesión ha caducado, vuelve a entrar." : !oracle?.ok || !roulette?.ok ? "Algunos beneficios no se han podido actualizar. Los precios disponibles se mantienen." : "");
    await loadPromotion();
    } finally { loading.current = false; }
  }, [loadPromotion]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const channel = sb.channel("tc-client-promotions-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "tc_client_promotions" }, () => { void loadPromotion(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "tc_client_promotion_packages" }, () => { void loadPromotion(); })
      .subscribe();
    const focus = () => void load();
    const timer = window.setInterval(() => { void load(); }, 30000);
    window.addEventListener("focus", focus);
    window.addEventListener("online", focus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", focus); window.removeEventListener("online", focus); void sb.removeChannel(channel); };
  }, [loadPromotion, load]);

  async function checkout(endpoint: string, packId: string) {
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
      if (!result?.ok || !result?.url) throw new Error(result?.error || "No hemos podido iniciar el pago");
      window.location.href = result.url;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No hemos podido iniciar el pago");
    } finally {
      setBusy("");
    }
  }

  async function checkoutPromotion(packageId: string) {
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
      if (!result?.ok || !result?.url) throw new Error(result?.error || "No hemos podido iniciar el pago");
      window.location.href = result.url;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No hemos podido iniciar el pago");
    } finally {
      setBusy("");
    }
  }

  const total = credits + (freeAvailable ? 1 : 0);
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
        { label: "Giros disponibles", value: String(Number(rouletteSummary?.available_spins || 0)), meta: "Premios por tus compras", href: "/cliente/ruleta", tone: "oracle" },
        { label: "Tiradas disponibles", value: String(total), meta: freeAvailable ? `1 gratis hoy · ${credits} compradas` : `${credits} compradas`, href: "/cliente/oraculo", tone: "oracle" },
        { label: "Packs de minutos", value: String(minutePacks.length), meta: "Tres niveles de recompensa", tone: "minutes" },
      ]}
    >
      <div className={styles.shell}>
        {(loadError || promotionError) && <div className={styles.message} role="alert">{loadError || promotionError} <button type="button" onClick={()=>void load()}>Reintentar</button></div>}
        {message ? <div className={styles.message}>{message}</div> : null}

        <section className={styles.hero}>
          <div className={styles.heroSigil}><Sparkles /></div>
          <div className={styles.heroCopy}>
            <span>🎃 TAROT CELESTIAL · ESPECIAL DE OCTUBRE</span>
            <h1>Halloween trae regalos a tus consultas</h1>
            <p>Elige tus minutos al precio habitual y acompaña tu compra con giros, Coins y sorpresas de temporada. Las tarifas y saldos siguen funcionando exactamente igual.</p>
          </div>
          <div className={styles.heroPromise}>
            <Sparkles />
            <div><strong>CADA COMPRA PUEDE TRAER UN REGALO</strong><small>Minutos + giro + Coins + sorpresa Halloween</small></div>
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
                  <ClientPurchaseAction className={styles.promoBuy}><button className={styles.promoBuy} disabled={busy === `promo:${pack.id}`} onClick={() => checkoutPromotion(pack.id)}>{busy === `promo:${pack.id}` ? "Conectando…" : "COMPRAR AHORA"}</button></ClientPurchaseAction>
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
              <h2>Elige el nivel de tu experiencia</h2>
              <p>Los precios actuales se mantienen. El nivel agrupa el paquete; cada giro conserva su nivel real configurado.</p>
            </div>
            <Link className={styles.rouletteShortcut} href="/cliente/ruleta">Ver ruleta <ArrowRight /></Link>
          </div>

          <div className={styles.levelStack}>
            <section className={styles.level} aria-labelledby="level-one-title">
              <div className={styles.levelHeader}>
                <div className={styles.levelMedallion}><Sparkles /></div>
                <div className={styles.levelIdentity}>
                  <span>PRIMER UMBRAL</span>
                  <h3 id="level-one-title">Nivel 1</h3>
                  <p>Consultas rápidas + giro con premio. Paquetes configurados como Nivel 1.</p>
                </div>
                <LevelBenefitChips />
              </div>
              <div className={styles.grid}>
                {levelOnePacks.map((pack) => <MinuteCard key={pack.id} pack={pack} summary={rouletteSummary} packageLevel={1} busy={busy === pack.id} onBuy={() => checkout("/api/cliente/pagos/checkout-v2", pack.id)} />)}
              </div>
            </section>

            <section className={`${styles.level} ${styles.levelPremium}`} aria-labelledby="level-two-title">
              <div className={styles.levelHeader}>
                <div className={`${styles.levelMedallion} ${styles.premiumMedallion}`}><Crown /></div>
                <div className={styles.levelIdentity}>
                  <span>EXPERIENCIA SUPERIOR</span>
                  <h3 id="level-two-title">Nivel 2</h3>
                  <p>Más consulta. Premios superiores. Paquetes configurados como Nivel 2.</p>
                </div>
                <LevelBenefitChips />
              </div>
              <div className={styles.grid}>
                {levelTwoPacks.map((pack) => <MinuteCard key={pack.id} pack={pack} summary={rouletteSummary} packageLevel={2} busy={busy === pack.id} onBuy={() => checkout("/api/cliente/pagos/checkout-v2", pack.id)} />)}
              </div>
            </section>

            <button className={styles.showMoreButton} type="button" aria-expanded={showLevelThree} aria-controls="level-three-packs" onClick={() => setShowLevelThree((value) => !value)}>
              <span>{showLevelThree ? "Ocultar minutos premium" : "Ver más minutos"}</span>
              {showLevelThree ? <ArrowUp /> : <ArrowDown />}
            </button>

            {showLevelThree ? <section id="level-three-packs" className={`${styles.level} ${styles.levelPremium} ${styles.levelCelestial}`} aria-labelledby="level-three-title">
              <div className={styles.celestialStage} aria-hidden="true">
                <span className={`${styles.stageOrb} ${styles.stageOrbLeft}`} />
                <span className={`${styles.stageOrb} ${styles.stageOrbRight}`} />
                <span className={styles.stageMoon}>☾</span>
                <span className={styles.stageConstellation} />
              </div>
              <div className={styles.levelHeader}>
                <div className={`${styles.levelMedallion} ${styles.celestialMedallion}`}><Gem /></div>
                <div className={styles.levelIdentity}>
                  <span>EXPERIENCIA CELESTIAL PREMIUM</span>
                  <h3 id="level-three-title">Nivel 3</h3>
                  <p>Tu compra premium desbloquea nuestros premios más exclusivos.</p>
                </div>
                <LevelBenefitChips />
              </div>
              <div className={`${styles.grid} ${styles.levelThreeGrid}`}>
                {levelThreePacks.map((pack) => <MinuteCard key={pack.id} pack={pack} summary={rouletteSummary} packageLevel={3} busy={busy === pack.id} onBuy={() => checkout("/api/cliente/pagos/checkout-v2", pack.id)} />)}
              </div>
            </section> : null}
          </div>

          {unassignedPacks.length ? <section className={styles.level} aria-labelledby="unassigned-packs-title">
            <div className={styles.levelHeader}>
              <div className={styles.levelMedallion}><ShoppingBag /></div>
              <div className={styles.levelIdentity}><span>OTROS PACKS</span><h3 id="unassigned-packs-title">Sin nivel adicional asignado</h3><p>Siguen disponibles con sus minutos y beneficios propios. Admin debe asignar Nivel 1, 2 o 3 para aplicar extras de rango.</p></div>
              <LevelBenefitChips />
            </div>
            <div className={styles.grid}>
              {unassignedPacks.map((pack) => <MinuteCard key={pack.id} pack={pack} summary={rouletteSummary} packageLevel={null} busy={busy === pack.id} onBuy={() => checkout("/api/cliente/pagos/checkout-v2", pack.id)} />)}
            </div>
          </section> : null}

          <div className={styles.maintenanceNote}>
            <PhoneCall />
            <span>Elige tu pack y disfruta de sus minutos y beneficios en tu cuenta.</span>
          </div>
        </section>

        <section className={styles.section}>
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
                <ClientPurchaseAction className={styles.buyButton}><button className={styles.buyButton} disabled={busy === pack.id} onClick={() => checkout("/api/cliente/oraculo/checkout", pack.id)}>{busy === pack.id ? "Conectando…" : "COMPRAR"}</button></ClientPurchaseAction>
              </article>
            ))}
            {questionPack ? (
              <article className={`${styles.card} ${styles.featured}`}>
                <div className={styles.serviceTop}><div className={styles.icon}>💬</div><span className={styles.badge}>{questionPack.questions} PREGUNTAS</span></div>
                <h3>{questionPack.nombre}</h3><p>{questionPack.descripcion}</p>
                <strong className={styles.price}>${questionPack.priceEur.toFixed(2).replace(".", ",")}</strong>
                <ClientPurchaseAction className={styles.buyButton}><button className={styles.buyButton} disabled={busy === questionPack.id} onClick={() => checkout("/api/cliente/oraculo/checkout", questionPack.id)}>{busy === questionPack.id ? "Conectando…" : "COMPRAR"}</button></ClientPurchaseAction>
              </article>
            ) : null}
          </div>
        </section>

        {!promotion ? <section className={`${styles.section} ${styles.coming}`}>
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

function MinuteCard({ pack, summary, packageLevel, busy, onBuy }: { pack: MinutePack; summary: RouletteSummary | null; packageLevel: StandardPackLevel | null; busy: boolean; onBuy: () => void }) {
  const rewardCoins = Number(pack.rewardCoins || 0);
  return (
    <article className={`${styles.card} ${styles.minuteCard} ${pack.highlight ? styles.featured : ""}`} data-level={packageLevel || undefined} data-highlight={pack.highlight ? "true" : "false"}>
      {pack.highlight ? <span className={styles.recommended}>{packageLevel === 3 ? "PREMIUM" : packageLevel === 2 ? "MÁS ELEGIDO" : "RECOMENDADO"}</span> : null}
      <div className={styles.cardAura} aria-hidden="true" />
      <div className={styles.serviceTop}>
        <div className={styles.icon}>{packageLevel === 3 ? <Crown /> : packageLevel === 2 ? <Gem /> : <ShoppingBag />}</div>
        <span className={styles.levelTag}>{packageLevel ? `PAQUETE NIVEL ${packageLevel}` : "SIN NIVEL DE PAQUETE"}</span>
      </div>
      <div className={styles.productCopy}><h3>{pack.nombre}</h3><p>{pack.descripcion}</p></div>
      <div className={styles.priceRow}>
        <strong className={styles.price}>${pack.priceUsd.toFixed(2).replace(".", ",")}</strong>
        <small>{pack.totalMinutes} minutos totales</small>
      </div>
      <div className={styles.visualCluster} aria-hidden="true">
        {rewardCoins > 0 ? <div className={`${styles.visualToken} ${styles.coinsToken}`}>
          <span className={styles.visualEmoji}>🪙</span>
          <small>+{rewardCoins.toLocaleString("es-ES")} Coins propias</small>
        </div> : null}
        {pack.rouletteSpins > 0 && pack.rouletteLevel ? <div className={`${styles.visualToken} ${styles.rouletteToken}`}>
          <span className={styles.visualEmoji}>🎰</span>
          <small>{pack.rouletteSpins} giro{pack.rouletteSpins === 1 ? "" : "s"} · Ruleta N{pack.rouletteLevel}</small>
        </div> : null}
        {(pack.oracleCredits || 0) > 0 ? <div className={`${styles.visualToken} ${styles.oracleToken}`}>
          <span className={styles.visualEmoji}>🔮</span>
          <small>{pack.oracleCredits || 0} tirada{(pack.oracleCredits || 0) === 1 ? "" : "s"}</small>
        </div> : null}
        {packageLevel === 3 ? <div className={`${styles.visualToken} ${styles.orbToken}`}>
          <span className={styles.visualEmoji}>{pack.highlight ? "🌙" : "✨"}</span>
          <small>{pack.highlight ? "Orbe premium" : "Bonus místico"}</small>
        </div> : null}
      </div>
      {pack.rankBenefits?.enabled ? <div className={styles.rankBenefitExtra}><strong>Beneficios adicionales por tu rango</strong><span>{rankBenefitSummary(pack.rankBenefits)}</span></div> : null}
      {pack.rankBenefitsStatus === "unavailable" ? <div className={styles.rankBenefitExtra}><strong>Beneficios de rango temporalmente no disponibles</strong><span>No se muestran como 0. El precio, los minutos y los beneficios propios del pack siguen disponibles.</span></div> : null}
      {pack.rankBenefitsStatus === "unmapped_package" ? <div className={styles.rankBenefitExtra}><strong>Sin nivel de paquete asignado</strong><span>Este pack conserva sus beneficios propios; no se aplican extras de rango hasta que Admin lo asigne.</span></div> : null}
      <RouletteBenefit level={pack.rouletteLevel} summary={summary} spins={pack.rouletteSpins} rewardCoins={rewardCoins} oracleCredits={pack.oracleCredits} />
      <ClientPurchaseAction className={styles.buyButton}><button type="button" className={styles.buyButton} disabled={busy} onClick={onBuy}>{busy ? "Conectando…" : "COMPRAR"}</button></ClientPurchaseAction>
    </article>
  );
}

function LevelBenefitChips() {
  return <div className={styles.levelBenefits}><strong>Beneficios reales</strong><span className={styles.levelBenefitChip}>Cada pack muestra sus recompensas propias y, si corresponde, las adicionales de tu rango.</span></div>;
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

