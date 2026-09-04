"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Crown, Gift, Gem, PhoneCall, ShoppingBag, Sparkles, WandSparkles } from "lucide-react";
import ClienteLayout from "@/components/cliente/ClienteLayout";
import ManualPurchaseButton from "@/components/cliente/ManualPurchaseButton";
import RouletteBenefit from "@/components/cliente/RouletteBenefit";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import type { RouletteSummary } from "@/lib/ruleta";
import styles from "./PricesOffers.module.css";

const sb = supabaseClienteBrowser();

type OraclePack = { id: string; nombre: string; descripcion: string; priceEur: number; credits: number };
type QuestionPack = { id: string; nombre: string; descripcion: string; priceEur: number; questions: number };
type MinutePack = { id: string; nombre: string; descripcion: string; priceUsd: number; totalMinutes: number; bonusMinutes: number; highlight?: boolean };

export default function PreciosOfertasPage() {
  const [rouletteSummary, setRouletteSummary] = useState<RouletteSummary | null>(null);
  const [oraclePacks, setOraclePacks] = useState<OraclePack[]>([]);
  const [questionPack, setQuestionPack] = useState<QuestionPack | null>(null);
  const [minutePacks, setMinutePacks] = useState<MinutePack[]>([]);
  const [freeAvailable, setFreeAvailable] = useState(false);
  const [credits, setCredits] = useState(0);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

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
  }, []);

  useEffect(() => { load(); }, [load]);

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

  const total = credits + (freeAvailable ? 1 : 0);
  const levelOnePacks = minutePacks.filter((pack) => Number(pack.priceUsd) < 27);
  const levelTwoPacks = minutePacks.filter((pack) => Number(pack.priceUsd) >= 27);

  return (
    <ClienteLayout
      title="Precios y ofertas"
      subtitle="Elige tu consulta y descubre el premio que puede acompañarla."
      summaryItems={[
        { label: "Giros disponibles", value: String(Number(rouletteSummary?.available_spins || 0)), meta: "Premios por tus compras", href: "/cliente/ruleta", tone: "oracle" },
        { label: "Tiradas disponibles", value: String(total), meta: freeAvailable ? `1 gratis hoy · ${credits} compradas` : `${credits} compradas`, href: "/cliente/oraculo", tone: "oracle" },
        { label: "Packs de minutos", value: String(minutePacks.length), meta: "Dos niveles de recompensa", tone: "minutes" },
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
                  <p>Consultas rápidas + giro con premio. Compras de hasta 26 €.</p>
                </div>
                <div className={styles.levelBenefits}>
                  <strong>Tu compra incluye</strong>
                  <span>🎡 1 giro Nivel 1</span><span>✨ Hasta +60 min</span><span>🪙 Hasta 400 Coins</span>
                </div>
              </div>
              <div className={styles.grid}>
                {levelOnePacks.map((pack) => <MinuteCard key={pack.id} pack={pack} summary={rouletteSummary} level={1} />)}
              </div>
            </section>

            <section className={`${styles.level} ${styles.levelPremium}`} aria-labelledby="level-two-title">
              <div className={styles.levelHeader}>
                <div className={`${styles.levelMedallion} ${styles.premiumMedallion}`}><Crown /></div>
                <div className={styles.levelIdentity}>
                  <span>EXPERIENCIA SUPERIOR</span>
                  <h3 id="level-two-title">Nivel 2</h3>
                  <p>Más consulta. Premios superiores. Compras desde 27 €.</p>
                </div>
                <div className={styles.levelBenefits}>
                  <strong>Tu compra incluye</strong>
                  <span>🎡 1 giro Nivel 2</span><span>✨ Hasta +80 min</span><span>🪙 Hasta 1.000 Coins</span>
                </div>
              </div>
              <div className={styles.grid}>
                {levelTwoPacks.map((pack) => <MinuteCard key={pack.id} pack={pack} summary={rouletteSummary} level={2} />)}
              </div>
            </section>
          </div>

          <div className={styles.maintenanceNote}>
            <PhoneCall />
            <span>Compra web temporalmente en mantenimiento. Pulsa <b>Comprar</b>, llama e indica el código <b>«Cliente web»</b> para conservar estos precios.</span>
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
                <strong className={styles.price}>{pack.priceEur.toFixed(2).replace(".", ",")} €</strong>
                <button className={styles.buyButton} disabled={busy === pack.id} onClick={() => checkout("/api/cliente/oraculo/checkout", pack.id)}>{busy === pack.id ? "Conectando…" : "COMPRAR"}</button>
              </article>
            ))}
            {questionPack ? (
              <article className={`${styles.card} ${styles.featured}`}>
                <div className={styles.serviceTop}><div className={styles.icon}>💬</div><span className={styles.badge}>{questionPack.questions} PREGUNTAS</span></div>
                <h3>{questionPack.nombre}</h3><p>{questionPack.descripcion}</p>
                <strong className={styles.price}>{questionPack.priceEur.toFixed(2).replace(".", ",")} €</strong>
                <button className={styles.buyButton} disabled={busy === questionPack.id} onClick={() => checkout("/api/cliente/oraculo/checkout", questionPack.id)}>{busy === questionPack.id ? "Conectando…" : "COMPRAR"}</button>
              </article>
            ) : null}
          </div>
        </section>

        <section className={`${styles.section} ${styles.coming}`}>
          <Gift /><div><span>OFERTAS</span><h2>Nuevas promociones próximamente</h2><p>Un espacio reservado para ventajas reales, sin urgencias ni descuentos inventados.</p></div>
        </section>
      </div>
    </ClienteLayout>
  );
}

function MinuteCard({ pack, summary, level }: { pack: MinutePack; summary: RouletteSummary | null; level: 1 | 2 }) {
  return (
    <article className={`${styles.card} ${styles.minuteCard} ${pack.highlight ? styles.featured : ""}`}>
      {pack.highlight ? <span className={styles.recommended}>{level === 2 ? "MÁS ELEGIDO" : "RECOMENDADO"}</span> : null}
      <div className={styles.serviceTop}>
        <div className={styles.icon}>{level === 2 ? <Gem /> : <ShoppingBag />}</div>
        <span className={styles.levelTag}>GIRO NIVEL {level}</span>
      </div>
      <div className={styles.productCopy}><h3>{pack.nombre}</h3><p>{pack.descripcion}</p></div>
      <div className={styles.priceRow}>
        <strong className={styles.price}>{pack.priceUsd.toFixed(2).replace(".", ",")} €</strong>
        <small>{pack.totalMinutes} minutos totales</small>
      </div>
      <RouletteBenefit amount={pack.priceUsd} summary={summary} />
      <ManualPurchaseButton className={styles.buyButton}>COMPRAR</ManualPurchaseButton>
    </article>
  );
}
