"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Crown, Gift, Gem, PhoneCall, ShoppingBag, Sparkles, WandSparkles } from "lucide-react";
import ClienteLayout from "@/components/cliente/ClienteLayout";
import RouletteBenefit from "@/components/cliente/RouletteBenefit";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import type { RouletteLevel, RouletteSummary } from "@/lib/ruleta";
import styles from "./PricesOffers.module.css";

const sb = supabaseClienteBrowser();

type OraclePack = { id: string; nombre: string; descripcion: string; priceEur: number; credits: number };
type QuestionPack = { id: string; nombre: string; descripcion: string; priceEur: number; questions: number };
type MinutePack = { id: string; nombre: string; descripcion: string; priceUsd: number; totalMinutes: number; bonusMinutes: number; rouletteLevel: RouletteLevel; rouletteSpins: number; rewardCoins?: number; oracleCredits?: number; highlight?: boolean };
type PromotionPack = { id: string; name: string; description?: string | null; paid_minutes: number; free_minutes: number; price: number; regular_price?: number | null; currency: "EUR" | "USD"; roulette_level?: RouletteLevel | null; roulette_spins: number; coins: number; oracle_credits: number; extra_benefit?: string | null; is_recommended: boolean; is_active: boolean; sort_order: number };
type ActivePromotion = { id: string; name: string; subtitle?: string | null; description?: string | null; effective_status: string; starts_at?: string | null; ends_at?: string | null; active_until_disabled: boolean; packages: PromotionPack[] };

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
  const [showLevelThree, setShowLevelThree] = useState(false);

  const loadPromotion = useCallback(async () => {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const response = await fetch("/api/cliente/promotions/active", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    const json = await response.json().catch(() => null);
    if (json?.ok) setPromotion(json.promotion || null);
  }, []);

  const load = useCallback(async () => {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/cliente/login";
      return;
    }

    const [rouletteResponse, oracleResponse, customerResponse] = await Promise.all([
      fetch("/api/cliente/ruleta", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
      fetch("/api/cliente/oraculo", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
      fetch("/api/cliente/me", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
    ]);

    const roulette = await rouletteResponse.json().catch(() => null);
    const oracle = await oracleResponse.json().catch(() => null);
    const customer = await customerResponse.json().catch(() => null);

    if (roulette?.ok) setRouletteSummary(roulette);
    if (oracle?.ok) {
      setOraclePacks(Array.isArray(oracle.packs) ? oracle.packs : []);
      setQuestionPack(oracle.questionPack || null);
      setCredits(Number(oracle.credits || 0));
      setFreeAvailable(Boolean(oracle.freeDailyAvailable ?? oracle.freeAvailable));
    }
    if (customer?.ok) setMinutePacks(Array.isArray(customer.packs) ? customer.packs : []);
    await loadPromotion();
  }, [loadPromotion]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const channel = sb.channel("tc-client-promotions-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "tc_client_promotions" }, () => { void loadPromotion(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "tc_client_promotion_packages" }, () => { void loadPromotion(); })
      .subscribe();
    const focus = () => void loadPromotion();
    const timer = window.setInterval(() => { void loadPromotion(); }, 30000);
    window.addEventListener("focus", focus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", focus); void sb.removeChannel(channel); };
  }, [loadPromotion]);

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
  const levelOnePacks = minutePacks.filter((pack) => pack.rouletteLevel === 1);
  const levelTwoPacks = minutePacks.filter((pack) => pack.rouletteLevel === 2);
  const levelThreePacks = minutePacks.filter((pack) => pack.rouletteLevel === 3);

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
        {message ? <div className={styles.message}>{message}</div> : null}

        <section className={styles.hero}>
          <div className={styles.heroSigil}><Sparkles /></div>
          <div className={styles.heroCopy}>
            <span>TAROT CELESTIAL · LA NUEVA ERA</span>
            <h1>Cada consulta abre una nueva posibilidad</h1>
            <p>Elige tus minutos al precio habitual y recibe un giro con opción a premios. Sin cambiar tus tarifas.</p>
          </div>
          <div className={styles.heroPromise}>
            <Sparkles />
            <div><strong>CADA COMPRA DESBLOQUEA UN GIRO</strong><small>Consulta + giro + premio posible</small></div>
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
                    {pack.roulette_spins > 0 && pack.roulette_level ? <span>🎡 +{pack.roulette_spins} giro{pack.roulette_spins === 1 ? "" : "s"} Nivel {pack.roulette_level}</span> : null}
                    {pack.oracle_credits > 0 ? <span>🔮 +{pack.oracle_credits} tirada{pack.oracle_credits === 1 ? "" : "s"} del Oráculo</span> : null}
                    {pack.extra_benefit ? <span>✦ {pack.extra_benefit}</span> : null}
                  </div>
                  <button className={styles.promoBuy} disabled={busy === `promo:${pack.id}`} onClick={() => checkoutPromotion(pack.id)}>{busy === `promo:${pack.id}` ? "Conectando…" : "COMPRAR AHORA"}</button>
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
              <p>Los precios actuales se mantienen. El nivel determina la categoría del giro incluido.</p>
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
                <div className={styles.levelBenefits}>
                  <strong>Tu compra incluye</strong>
                  <span>🎡 1 giro Nivel 1</span><span>✨ Hasta +60 min</span><span>🪙 Hasta 400 Coins</span>
                </div>
              </div>
              <div className={styles.grid}>
                {levelOnePacks.map((pack) => <MinuteCard key={pack.id} pack={pack} summary={rouletteSummary} level={1} busy={busy === pack.id} onBuy={() => checkout("/api/cliente/pagos/checkout-v2", pack.id)} />)}
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
                <div className={styles.levelBenefits}>
                  <strong>Tu compra incluye</strong>
                  <span>🎡 1 giro Nivel 2</span><span>✨ Hasta +80 min</span><span>🪙 Hasta 1.000 Coins</span>
                </div>
              </div>
              <div className={styles.grid}>
                {levelTwoPacks.map((pack) => <MinuteCard key={pack.id} pack={pack} summary={rouletteSummary} level={2} busy={busy === pack.id} onBuy={() => checkout("/api/cliente/pagos/checkout-v2", pack.id)} />)}
              </div>
            </section>

            <button className={styles.showMoreButton} type="button" aria-expanded={showLevelThree} aria-controls="level-three-packs" onClick={() => setShowLevelThree((value) => !value)}>
              <span>{showLevelThree ? "Ocultar minutos premium" : "Ver más minutos"}</span>
              {showLevelThree ? <ArrowUp /> : <ArrowDown />}
            </button>

            {showLevelThree ? <section id="level-three-packs" className={`${styles.level} ${styles.levelPremium} ${styles.levelCelestial}`} aria-labelledby="level-three-title">
              <div className={styles.levelHeader}>
                <div className={`${styles.levelMedallion} ${styles.celestialMedallion}`}><Gem /></div>
                <div className={styles.levelIdentity}>
                  <span>EXPERIENCIA CELESTIAL PREMIUM</span>
                  <h3 id="level-three-title">Nivel 3</h3>
                  <p>Tu compra premium desbloquea nuestros premios más exclusivos.</p>
                </div>
                <div className={styles.levelBenefits}>
                  <strong>Tu compra incluye</strong>
                  <span>🎡 1–2 giros Nivel 3</span><span>🪙 Coins por compra</span><span>🔮 2 tiradas Oráculo</span>
                </div>
              </div>
              <div className={styles.grid}>
                {levelThreePacks.map((pack) => <MinuteCard key={pack.id} pack={pack} summary={rouletteSummary} level={3} busy={busy === pack.id} onBuy={() => checkout("/api/cliente/pagos/checkout-v2", pack.id)} />)}
              </div>
            </section> : null}
          </div>

          <div className={styles.maintenanceNote}>
            <PhoneCall />
            <span>Pago seguro mediante <b>Mollie</b>. El saldo se acredita únicamente cuando Mollie confirma la operación.</span>
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
                <button className={styles.buyButton} disabled={busy === pack.id} onClick={() => checkout("/api/cliente/oraculo/checkout", pack.id)}>{busy === pack.id ? "Conectando…" : "COMPRAR"}</button>
              </article>
            ))}
            {questionPack ? (
              <article className={`${styles.card} ${styles.featured}`}>
                <div className={styles.serviceTop}><div className={styles.icon}>💬</div><span className={styles.badge}>{questionPack.questions} PREGUNTAS</span></div>
                <h3>{questionPack.nombre}</h3><p>{questionPack.descripcion}</p>
                <strong className={styles.price}>${questionPack.priceEur.toFixed(2).replace(".", ",")}</strong>
                <button className={styles.buyButton} disabled={busy === questionPack.id} onClick={() => checkout("/api/cliente/oraculo/checkout", questionPack.id)}>{busy === questionPack.id ? "Conectando…" : "COMPRAR"}</button>
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

function MinuteCard({ pack, summary, level, busy, onBuy }: { pack: MinutePack; summary: RouletteSummary | null; level: RouletteLevel; busy: boolean; onBuy: () => void }) {
  return (
    <article className={`${styles.card} ${styles.minuteCard} ${pack.highlight ? styles.featured : ""}`}>
      {pack.highlight ? <span className={styles.recommended}>{level === 3 ? "PREMIUM" : level === 2 ? "MÁS ELEGIDO" : "RECOMENDADO"}</span> : null}
      <div className={styles.serviceTop}>
        <div className={styles.icon}>{level === 3 ? <Crown /> : level === 2 ? <Gem /> : <ShoppingBag />}</div>
        <span className={styles.levelTag}>GIRO NIVEL {level}</span>
      </div>
      <div className={styles.productCopy}><h3>{pack.nombre}</h3><p>{pack.descripcion}</p></div>
      <div className={styles.priceRow}>
        <strong className={styles.price}>${pack.priceUsd.toFixed(2).replace(".", ",")}</strong>
        <small>{pack.totalMinutes} minutos totales</small>
      </div>
      <RouletteBenefit level={level} summary={summary} spins={pack.rouletteSpins} rewardCoins={pack.rewardCoins ?? Math.round(pack.priceUsd * 10)} oracleCredits={pack.oracleCredits} />
      <button type="button" className={styles.buyButton} disabled={busy} onClick={onBuy}>{busy ? "Conectando…" : "COMPRAR"}</button>
    </article>
  );
}
