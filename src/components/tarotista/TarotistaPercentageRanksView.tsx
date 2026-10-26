"use client";

import { evaluatePercentageRanks, percentLabel, pointsLabel, euros, PERCENTAGE_RANK_NAMES, type PercentageMinutes, type PercentageRule } from "@/lib/tarotista-percentage-ranks";
import styles from "./TarotistaPercentageRanksView.module.css";

/** The preparation preview never substitutes a live/confirmed economic rank. */
export default function TarotistaPercentageRanksView({ rules, minutes, month, example = false }: {
  rules: PercentageRule[]; minutes: PercentageMinutes; month: string; example?: boolean;
}) {
  let result;
  try { result = evaluatePercentageRanks(minutes, rules); }
  catch (error) { return <div className={styles.error} role="alert">{error instanceof Error ? error.message : "Revisa los datos de la propuesta."}</div>; }
  const next = rules.find(r => r.code === result.next);
  const current = rules.find(r => r.code === result.candidate);
  const achieved = result.goals.filter(g => g.met).length;
  return <section className={styles.page} aria-label="Vista previa de rangos por porcentajes">
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>TAROT LEONARIS · TU CAMINO DE CRECIMIENTO</span><h2>Tus resultados abren<br/>nuevos escalones.</h2><p>Cliente y Repite te acercan al siguiente rango. Los minutos y las captaciones siguen teniendo sus propias recompensas.</p></div>
      <span className={styles.preview}>VISTA PREVIA · NO ACTIVA<br/>{example ? "Ejemplo ficticio" : `Periodo ${month}`}</span>
    </header>
    <div className={styles.hero} data-rank={result.candidate || "C"}>
      <div className={styles.seal} aria-hidden="true">{result.candidate || "—"}</div>
      <div><span className={styles.eyebrow}>RESULTADO DE LA SIMULACIÓN</span><h3>{result.candidate ? `Rango ${result.candidate}` : "Sin actividad evaluable"}</h3><p>{result.candidate ? PERCENTAGE_RANK_NAMES[result.candidate] : "Esperamos consultas registradas para poder calcular tus porcentajes."}</p></div>
      <div className={styles.heroReward}><span>Bonos del rango propuesto</span><strong>{current ? euros(current.health_bonus + current.rank_bonus) : "—"}</strong><small>Por mes de aplicación confirmado.<br/>Esta vista no confirma pagos ni ascensos.</small></div>
    </div>
    {next && <section aria-label="Objetivos del siguiente rango">
      <div className={styles.sectionHead}><div><span className={styles.eyebrow}>TU SIGUIENTE ESCALÓN</span><h3>Alcanzar el rango {next.code}</h3></div><b>{achieved} de 2 objetivos cumplidos</b></div>
      <div className={styles.goals}>{result.goals.map(g => <article className={styles.goal} key={g.key} data-met={g.met}>
        <div className={styles.goalHead}><span>PORCENTAJE {g.label.toUpperCase()}</span><b>{g.met ? "✓ Cumplido" : "En progreso"}</b></div>
        <div className={styles.goalValue}><strong>{percentLabel(g.actual)}</strong><span>Objetivo: {percentLabel(g.target)}</span></div>
        <div className={styles.track} role="progressbar" aria-label={`Progreso hacia el objetivo ${g.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={g.bar}><i style={{width: `${g.bar}%`}}/></div>
        <p>{g.met ? "Ya cumples este objetivo en el periodo." : `Te faltan ${pointsLabel(g.remaining_points)} para llegar al ${percentLabel(g.target)}.`}</p>
      </article>)}</div>
      <aside className={styles.improvement}><span>LO QUE MEJORARÍA EN TU PRÓXIMO RANGO</span><strong>{euros(current ? current.health_bonus + current.rank_bonus : 0)} → {euros(next.health_bonus + next.rank_bonus)} mensuales en bonos</strong><p>El bono de salud está incluido en ese total. No se suman los bonos de todos los rangos.</p></aside>
    </section>}
    {result.candidate === "S" && <aside className={styles.improvement}><strong>Has cumplido los dos objetivos de S en esta simulación.</strong><p>La confirmación del rango y su periodo de aplicación se revisan por separado.</p></aside>}
    <section><div className={styles.sectionHead}><div><span className={styles.eyebrow}>TUS CUATRO ESCALONES</span><h3>Un camino con beneficios claros</h3></div></div>
      <div className={styles.rankGrid}>{rules.map(r => <article key={r.code} className={styles.rankCard} data-rank={r.code}>
        <div className={styles.rankTitle}><b>{r.code}</b><span>{PERCENTAGE_RANK_NAMES[r.code]}</span></div>
        <div className={styles.requirements}>{r.code === "C" ? <p>El punto de partida.<br/>Sin objetivos de entrada.</p> : <><p><b>{percentLabel(r.cliente_pct)}</b> Cliente</p><p><b>{percentLabel(r.repite_pct)}</b> Repite</p><small>Debes cumplir los dos.</small></>}</div>
        <strong className={styles.monthly}>{euros(r.health_bonus + r.rank_bonus)}<small> / mes confirmado</small></strong>
        <p>Salud: <b>{euros(r.health_bonus)}</b><br/>Bono de rango: <b>{euros(r.rank_bonus)}</b></p>
        <p className={styles.rate}>Mejora Cliente: <b>+{euros(r.cliente_rate_bonus)}/min</b><br/>Mejora Repite: <b>+{euros(r.repite_rate_bonus)}/min</b></p>
      </article>)}</div>
    </section>
    <details className={styles.details}><summary>¿Cómo se calculan mis porcentajes?</summary><p>Dividimos tus minutos Cliente o Repite entre todos tus minutos atendidos y multiplicamos por 100. El tiempo esperando llamadas no cuenta.</p><p>En esta vista: {minutes.minutes_cliente.toLocaleString("es-ES")} minutos Cliente y {minutes.minutes_repite.toLocaleString("es-ES")} Repite, sobre {minutes.minutes_total.toLocaleString("es-ES")} minutos atendidos.</p><p>Los porcentajes pueden subir o bajar al recibir consultas de otros tipos. No son puntos acumulados ni una medida completa de la calidad de tu atención.</p></details>
    <footer className={styles.notice}>Propuesta en revisión. Los objetivos de minutos y captaciones pertenecen a las misiones, no a los requisitos de estos rangos. Esta pantalla no modifica tu rango vigente ni tu factura.</footer>
  </section>;
}
