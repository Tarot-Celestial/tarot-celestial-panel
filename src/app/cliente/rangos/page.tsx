"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Clock3, Medal, RefreshCw, Sparkles } from "lucide-react";
import ClienteLayout from "@/components/cliente/ClienteLayout";
import CrystalEmblem from "@/components/benefits/CrystalEmblem";
import RankDailyBonus from "@/components/cliente/RankDailyBonus";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import { useRouletteSignal } from "@/hooks/useRouletteSignal";
import { guideProgress, rankMoney, type ClientRankGuide } from "@/lib/client-rank-guide";
import { matrixBenefitLabels } from "@/lib/rank-benefit-config";
import styles from "./Ranks.module.css";

const sb = supabaseClienteBrowser();

export default function ClientRanksPage() {
  const router = useRouter();
  const [guide, setGuide] = useState<ClientRankGuide | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (mounted.current) { setLoading(true); setError(""); }
    try {
      const { data } = await sb.auth.getSession();
      if (controller.signal.aborted || !mounted.current) return;
      if (!data.session) {
        setGuide(null);
        router.replace("/cliente/login?next=rangos");
        return;
      }
      const response = await fetch("/api/cliente/rangos", {
        headers: { Authorization: "Bearer " + data.session.access_token },
        cache: "no-store", signal: controller.signal,
      });
      if (controller.signal.aborted || !mounted.current) return;
      if (response.status === 401) {
        setGuide(null); router.replace("/cliente/login?next=rangos"); return;
      }
      const result = await response.json();
      if (controller.signal.aborted || !mounted.current) return;
      if (!response.ok || !result.ok) throw new Error(result.error || "No hemos podido consultar tus rangos.");
      setGuide(result);
    } catch (err) {
      if (!controller.signal.aborted && mounted.current) {
        setGuide(null);
        setError(err instanceof Error ? err.message : "No hemos podido consultar tus rangos.");
      }
    } finally {
      if (mounted.current && request.current === controller) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    mounted.current = true;
    void load();
    let authTimer: ReturnType<typeof setTimeout> | undefined;
    const { data: auth } = sb.auth.onAuthStateChange(event => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT") return;
      request.current?.abort();
      setGuide(null);
      clearTimeout(authTimer);
      authTimer = setTimeout(() => void load(), 0);
    });
    return () => {
      mounted.current = false;
      request.current?.abort();
      clearTimeout(authTimer);
      auth.subscription.unsubscribe();
    };
  }, [load]);
  useRouletteSignal(sb, guide?.cliente_id, load);

  const progress = guide ? guideProgress(guide) : null;
  const current = guide?.ranks.find(rank => rank.key === guide.state.effective);
  const automatic = guide?.ranks.find(rank => rank.key === guide.state.automatic);
  const dailyLabels = guide?.daily_bonus ? matrixBenefitLabels(guide.daily_bonus) : [];

  return <ClienteLayout title="Rangos del cliente" eyebrow="Tu camino celestial"
    subtitle="Descubre cómo alcanzar Bronce, Plata, Oro y Diamante, y las ventajas de cada rango.">
    <div className={styles.wrap}>
      {error && <section className={styles.error} role="alert">
        <p>{error}</p><button type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16}/> Volver a consultar</button>
      </section>}
      {loading && !guide && <section className={styles.loading} role="status">Consultando tu rango y sus condiciones…</section>}
      {guide && progress && <>
        <section className={styles.journey} data-leo-anchor="rank-progress" aria-labelledby="rank-journey-title" aria-busy={loading}>
          <div className={styles.journeyCopy}>
            <span className={styles.eyebrow}><Sparkles size={14}/> CADA PASO SUMA</span>
            <h2 id="rank-journey-title">Tu camino entre las estrellas</h2>
            <p>Tu rango se calcula con el gasto de los últimos <strong>{guide.window_days} días</strong>. Descubre dónde estás y cuál es tu próximo objetivo.</p>
            <div className={styles.current}><CrystalEmblem size={66} tone={current?.key || "bronce"}/>
              <div><small>Tu rango actual</small><strong>{current?.label || "Sin rango"}</strong>
                {guide.state.has_override && <span>Asignación especial activa</span>}</div>
            </div>
          </div>
          <div className={styles.progressPanel}>
            <div className={styles.progressTop}><span><Clock3 size={14}/> Últimos {guide.window_days} días</span>
              <button type="button" disabled={loading} onClick={() => void load()} aria-label="Actualizar mi rango"><RefreshCw size={16}/></button></div>
            <strong className={styles.spend}>{rankMoney(guide.state.total)}</strong>
            <span className={styles.spendCaption}>Gasto contabilizado para tu rango</span>
            <div className={styles.progressLabels}><span>Progreso por compras</span><strong>{progress.next ? "Hacia " + progress.next.label : "Objetivo Diamante cumplido"}</strong></div>
            <div className={styles.progressTrack} role="progressbar" aria-label="Progreso por compras al siguiente rango"
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(progress.percent.toFixed(1))}
              aria-valuetext={progress.next ? rankMoney(progress.remaining) + " para alcanzar " + progress.next.label : "Objetivo máximo cumplido"}>
              <span style={{ width: progress.percent + "%" }}/></div>
            <p className={styles.remaining}>{progress.next?.key === "bronce" && progress.next.min_spend <= 0.01 ? <>Tu primera compra válida activa <strong>Bronce</strong> y comienza tu camino.</> : progress.next ? <>Te faltan <strong>{rankMoney(progress.remaining)}</strong> para alcanzar <strong>{progress.next.label}</strong>.</> :
              <>Tu gasto de los últimos 30 días cumple el objetivo de <strong>Diamante</strong>.</>}</p>
            {guide.state.has_override && <p className={styles.override}>Tu rango por compras es <strong>{automatic?.label || "Sin rango"}</strong>. La asignación especial puede cambiar tu rango actual y sus accesos.
              {guide.state.override_ends_at && <> Vigente hasta {new Date(guide.state.override_ends_at).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" })}.</>}</p>}
            <Link href="/cliente/precios-ofertas" className={styles.primary}>Ver precios y ofertas <ArrowRight size={16}/></Link>
          </div>
        </section>

        <section aria-labelledby="all-ranks-title">
          <div className={styles.sectionHead}><div><span className={styles.eyebrow}>CUATRO RANGOS · UN CAMINO</span><h2 id="all-ranks-title">Descubre tu próximo rango</h2></div>
            <span className={styles.period}>Importes en USD · últimos 30 días</span></div>
          <div className={styles.ranks}>
            {guide.ranks.map((rank, index) => {
              const next = guide.ranks[index + 1];
              const isCurrent = rank.key === guide.state.effective;
              const meetsTarget = guide.state.total >= rank.min_spend;
              return <article key={rank.key} id={"rango-" + rank.key} className={styles.rankCard}
                data-rank={rank.key} data-current={isCurrent} aria-labelledby={"title-" + rank.key}>
                <div className={styles.rankArt}><span className={styles.rankBadge}>{isCurrent ? "Tu rango actual" : meetsTarget ? "Objetivo cumplido" : "Tu próximo horizonte"}</span>
                  <CrystalEmblem tone={rank.key} size={126}/><span className={styles.rankNumber}>{["I", "II", "III", "IV"][index]}</span></div>
                <h3 id={"title-" + rank.key}>{rank.label}</h3>
                <div className={styles.requirement}><small>{rank.key === "bronce" ? "Comienza con una compra válida" : "Alcanza un gasto de"}</small>
                  <strong>{rank.key === "bronce" && rank.min_spend <= 0.01 ? "Primera compra" : rankMoney(rank.min_spend)}</strong><span>en los últimos {guide.window_days} días</span></div>
                <p className={styles.band}>{next ? (rank.key === "bronce" && rank.min_spend <= 0.01 ? "Gasto positivo y menos de " : "Desde " + rankMoney(rank.min_spend) + " y menos de ") + rankMoney(next.min_spend) + "." : "Desde " + rankMoney(rank.min_spend) + ", el rango más alto."}</p>
                <div className={styles.benefitHeading}><Medal size={15}/> Ventajas del rango</div>
                {rank.active ? <ul className={styles.benefits}>{rank.benefits.map(label => <li key={label}><Check size={13}/><span>{label}</span></li>)}</ul> :
                  <p className={styles.muted}>Los beneficios de este rango están desactivados actualmente.</p>}
                <details className={styles.extras}>
                  <summary>Extras según tu paquete</summary>
                  {rank.package_benefits === null ? <p>No hemos podido consultar estos extras.</p> :
                    !rank.active ? <p>Beneficios desactivados.</p> :
                    [1, 2, 3].map(level => {
                      const config = rank.package_benefits?.find(row => row.package_level === level);
                      const labels = config?.enabled ? matrixBenefitLabels(config) : [];
                      return <div key={level} className={styles.package}><strong>Paquete nivel {level}</strong>
                        <p>{labels.length ? labels.join(" · ") : "Sin extras de rango activos para este nivel."}</p></div>;
                    })}
                  <p className={styles.extraNote}>Son adicionales a los beneficios propios del paquete. Se aplican al confirmar una compra con nivel asignado.</p>
                </details>
                <a href="#rank-conditions" className={styles.conditionsLink}>Consultar condiciones <ArrowRight size={13}/></a>
              </article>;
            })}
          </div>
        </section>

        <section className={styles.diamond} aria-labelledby="diamond-bonus-title">
          <CrystalEmblem tone="diamante" size={88}/>
          <div><span className={styles.eyebrow}>UN DETALLE CADA DÍA</span><h2 id="diamond-bonus-title">Bono diario Diamante</h2>
            {!guide.daily_bonus_available ? <p>La configuración del bono no está disponible. Vuelve a consultar más tarde.</p> :
              guide.daily_bonus ? <><p>{guide.daily_bonus.description || "Una recompensa diaria exclusiva para clientes Diamante."}</p>
                <div className={styles.bonusLabels}>{dailyLabels.map(label => <span key={label}>{label}</span>)}</div>
                <small>Requiere rango Diamante vigente. Un uso por día natural, según el horario de Madrid.</small></> :
                <p>No hay un bono diario activo actualmente. Aquí verás sus recompensas cuando esté habilitado.</p>}
          </div>
        </section>
        {guide.state.effective === "diamante" && guide.daily_bonus && <RankDailyBonus/>}
        {guide.warnings.length > 0 && <div className={styles.notice} role="status">{guide.warnings.join(" ")}</div>}

        <section className={styles.faq} id="rank-conditions" aria-labelledby="rank-conditions-title">
          <span className={styles.eyebrow}>TODO CLARO DESDE EL PRINCIPIO</span><h2 id="rank-conditions-title">Cómo alcanzar y mantener tu rango</h2>
          <details open><summary>¿Qué gasto cuenta para subir de rango?</summary><p>Cuenta el importe confirmado que registra tu cuenta para el rango durante los últimos 30 días. Tu progreso utiliza el mismo cálculo que el resto del panel. Los importes se muestran en USD; no se calculan con Coins ni con minutos consumidos.</p></details>
          <details><summary>¿Necesito una sola compra para alcanzar Diamante?</summary><p>No. Puedes alcanzarlo sumando varias compras válidas dentro de los últimos 30 días. El objetivo actual es {rankMoney(guide.ranks.find(rank => rank.key === "diamante")!.min_spend)} en ese período.</p></details>
          <details><summary>¿El rango se conserva para siempre?</summary><p>El cálculo se mueve día a día: las compras de hace más de 30 días salen del período. Para mantener tu rango por compras debes conservar el importe requerido dentro de esa ventana. Tu cuenta puede tener una asignación especial; si existe, la mostramos por separado.</p></details>
          <details><summary>¿Cuándo recibo las ventajas y los extras?</summary><p>Diamante recibe 15 minutos GRATIS adicionales en cada compra confirmada, incluidas las promociones. Para Plata y Oro, los minutos adicionales indicados para precio regular corresponden a compras a precio regular. Los tres pases de 7 minutos requieren alguna compra confirmada en los últimos cuatro meses y se ofrecen cada 30 días. Los extras por paquete dependen del rango efectivo y del nivel asignado a la compra; las promociones conservan sus propios beneficios.</p></details>
          <details><summary>¿Mi rango es lo mismo que el nivel de ruleta?</summary><p>No. Bronce, Plata, Oro y Diamante son rangos del cliente. El nivel del paquete y la ruleta son independientes. Una compra válida con rango Diamante aporta un giro Diamante, además de los giros que correspondan por el paquete.</p></details>
        </section>
      </>}
    </div>
  </ClienteLayout>;
}