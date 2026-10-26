"use client";

import { useRef, useState } from "react";
import TarotistaPercentageRanksView from "@/components/tarotista/TarotistaPercentageRanksView";
import { proposedPercentageRules, validatePercentageRules, structuredBenefitWarnings, percentLabel, euros, PERCENTAGE_RANK_NAMES, type PercentageRule } from "@/lib/tarotista-percentage-ranks";
import styles from "./TarotistaPercentageRanksDraft.module.css";

type Result = { worker_id: string; display_name: string; calls_total: number; minutes_total: number; minutes_cliente: number; minutes_repite: number; current_period_rank: string | null; candidate: string | null; cliente_pct: number | null; repite_pct: number | null; difference: number | null; status: string };
type Simulation = { month: string; partial_month: boolean; generated_at: string; warnings: string[]; results: Result[]; totals: {evaluable: number; current_rank_extras: number; proposed_rank_extras: number; difference: number}; financial_scope: string };
export default function TarotistaPercentageRanksDraft({ activeRows, getToken, onBack }: {
  activeRows: Array<{code: string; benefit_config?: any}>; getToken: () => Promise<string | null>; onBack: () => void;
}) {
  const [rules, setRules] = useState<PercentageRule[]>(proposedPercentageRules);
  const [month, setMonth] = useState(() => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" }).slice(0, 7));
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [worker, setWorker] = useState("example");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const selected = simulation?.results.find(r => r.worker_id === worker);
  const warnings = [...new Set([...structuredBenefitWarnings(activeRows), ...(simulation?.warnings || [])])];
  let validation = "";
  try { validatePercentageRules(rules); } catch (err) { validation = err instanceof Error ? err.message : "Revisa la propuesta."; }
  function invalidate() { generation.current++; setSimulation(null); setWorker("example"); setError(""); setBusy(false); }
  function patch(code: string, field: keyof Omit<PercentageRule,"code">, value: string) {
    invalidate(); setRules(prev => prev.map(r => r.code === code ? {...r, [field]: value === "" ? NaN : Number(value)} : r));
  }
  async function simulate() {
    const request = ++generation.current;
    setBusy(true); setError(""); setSimulation(null); setWorker("example");
    try {
      const proposal = validatePercentageRules(rules);
      const token = await getToken();
      if (!token) throw new Error("Vuelve a iniciar sesión para simular los datos del equipo.");
      const res = await fetch("/api/admin/tarotista-ranks/simulate", { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ month, rules: proposal }) });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error || "No se pudo completar la simulación.");
      if (generation.current === request) setSimulation(body);
    } catch (err) { if (generation.current === request) setError(err instanceof Error ? err.message : "No se pudo simular."); }
    finally { if (generation.current === request) setBusy(false); }
  }
  function exportDraft() {
    try {
      const proposal = validatePercentageRules(rules);
      const contents = { kind: "tarot_leonaris_percentage_rank_proposal", version: 1, status: "draft_not_active", rules: proposal, evaluation: "Cliente / total atendido y Repite / total atendido", activation_blocked: ["Validar umbrales y reparto", "Confirmar beneficios numéricos", "Aprobar vigencia y revisión mensual", "Implementar historial de rangos y proteger facturas cerradas" ] };
      const url = URL.createObjectURL(new Blob([JSON.stringify(contents, null, 2)], {type:"application/json"}));
      const link = document.createElement("a"); link.href = url; link.download = "Propuesta_rangos_porcentajes_Leonaris.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err instanceof Error ? err.message : "Revisa la propuesta."); }
  }
  return <section className={styles.page}>
    <header className={styles.header}><div><span>ADMINISTRACIÓN · TAROT LEONARIS</span><h1>Rangos por porcentajes</h1><p>Prueba los nuevos escalones antes de cambiar las condiciones del equipo.</p></div><button type="button" onClick={onBack}>← Configuración vigente</button></header>
    <aside className={styles.safety}><strong>BORRADOR · NO PUBLICADO</strong><p>Editar o simular aquí no guarda rangos, no cambia tarifas y no modifica facturas. Los importes de esta propuesta representan los beneficios acordados, no necesariamente los campos que están activos.</p></aside>
    {warnings.length > 0 && <aside className={styles.warning}><strong>Antes de activar: revisar beneficios</strong>{warnings.map(w => <p key={w}>{w}</p>)}</aside>}
    <section className={styles.editor}><div className={styles.sectionTitle}><div><h2>1. Define tus dos objetivos</h2><p>Se deben cumplir ambos. No hay mínimos de minutos ni de captaciones para estos rangos.</p></div><button type="button" onClick={() => { invalidate(); setRules(proposedPercentageRules()); }}>Restablecer propuesta</button></div>
      <div className={styles.rules}>{rules.map(r => <article key={r.code} className={styles.rule} data-rank={r.code}><header><b>{r.code}</b><strong>{PERCENTAGE_RANK_NAMES[r.code]}</strong></header>{r.code === "C" ? <p className={styles.entry}>Rango de entrada.<br/>Sin objetivos porcentuales.</p> : <div className={styles.inputs}>
        <label>Cliente mínimo (%)<input aria-label={`Rango ${r.code}: Cliente mínimo`} type="number" min="0.01" max="100" step="0.01" value={Number.isFinite(r.cliente_pct) ? r.cliente_pct : ""} onChange={e => patch(r.code,"cliente_pct",e.target.value)}/></label>
        <label>Repite mínimo (%)<input aria-label={`Rango ${r.code}: Repite mínimo`} type="number" min="0.01" max="100" step="0.01" value={Number.isFinite(r.repite_pct) ? r.repite_pct : ""} onChange={e => patch(r.code,"repite_pct",e.target.value)}/></label>
      </div>}<div className={styles.reward}><strong>{euros(r.health_bonus+r.rank_bonus)} / mes</strong><p>{euros(r.health_bonus)} de salud + {euros(r.rank_bonus)} de rango.</p><small>Propuesta; no se aplica al editar.</small></div></article>)}</div>
      <details className={styles.benefits}><summary>Revisar importes numéricos de la propuesta</summary><p>La mejora por minuto se suma a la tarifa base. Para pasar de 0,12 € a 0,13 €, la mejora es 0,01 €, no 0,13 €.</p>{rules.map(r => <div className={styles.benefitRow} key={r.code}><b>Rango {r.code}</b>{([['health_bonus','Salud mensual (€)'],['rank_bonus','Bono de rango (€)'],['cliente_rate_bonus','Mejora Cliente (€/min)'],['repite_rate_bonus','Mejora Repite (€/min)']] as const).map(([field,label]) => <label key={field}>{label}<input aria-label={`${r.code} ${label}`} type="number" min="0" step="0.01" value={Number.isFinite(r[field]) ? r[field] : ""} onChange={e=>patch(r.code,field,e.target.value)}/></label>)}</div>)}</details>
      {validation && <div className={styles.error} role="alert">{validation}</div>}
    </section>
    <section className={styles.editor}><div className={styles.sectionTitle}><div><h2>2. Simula un periodo del equipo</h2><p>Solo lectura. Selecciona cada uno de los meses que quieras comparar.</p></div><div className={styles.controls}><label>Mes<input type="month" value={month} onChange={e => {invalidate();setMonth(e.target.value);}}/></label><button type="button" className={styles.primary} disabled={busy || !!validation || !month} onClick={()=>void simulate()}>{busy ? "Calculando…" : "Simular sin guardar"}</button></div></div>
      {error && <div className={styles.error} role="alert">{error}</div>}
      {!simulation && !error && <p className={styles.empty}>No hay una simulación calculada para esta propuesta. Ningún resultado se presenta como un rango confirmado.</p>}
      {simulation && <><div className={styles.kpis}><div><span>Tarotistas con actividad</span><b>{simulation.totals.evaluable}</b></div><div><span>Extras de rango vigentes*</span><b>{euros(simulation.totals.current_rank_extras)}</b></div><div><span>Extras de rango propuestos*</span><b>{euros(simulation.totals.proposed_rank_extras)}</b></div><div><span>Diferencia de la propuesta*</span><b>{euros(simulation.totals.difference)}</b></div></div>
        <p className={styles.scope}>* {simulation.financial_scope}{simulation.partial_month && " El mes todavía está abierto: los resultados pueden cambiar."}</p>
        <div className={styles.tableWrap}><table><thead><tr><th>Tarotista</th><th>Consultas</th><th>% Cliente</th><th>% Repite</th><th>Rango calculado vigente</th><th>Candidata con propuesta</th><th>Diferencia de extras</th></tr></thead><tbody>{simulation.results.map(r=><tr key={r.worker_id}><td>{r.display_name}</td><td>{r.calls_total}</td><td>{percentLabel(r.cliente_pct)}</td><td>{percentLabel(r.repite_pct)}</td><td>{r.current_period_rank || "—"}</td><td><b>{r.candidate || "Sin actividad"}</b><small>{r.candidate ? "Pendiente de revisión" : "No se evalúa como 0 %"}</small></td><td>{r.difference === null ? "—" : euros(r.difference)}</td></tr>)}</tbody></table></div>
      </>}
    </section>
    <section className={styles.previewSection}><div className={styles.sectionTitle}><div><h2>3. Así se entendería en el panel tarotista</h2><p>Vista previa integrada con los mismos objetivos y cálculo de la propuesta.</p></div><label>Datos de la vista<select value={worker} onChange={e=>setWorker(e.target.value)}><option value="example">Ejemplo ficticio · 32 % Cliente / 13 % Repite</option>{simulation?.results.map(r=><option key={r.worker_id} value={r.worker_id}>{r.display_name}</option>)}</select></label></div>
      {!validation && <TarotistaPercentageRanksView rules={rules} minutes={selected || {minutes_total:1000,minutes_cliente:320,minutes_repite:130}} month={month} example={!selected}/>}
    </section>
    <footer className={styles.end}><p><strong>La activación va por separado.</strong> Antes de publicar faltan validar los umbrales, confirmar importes y definir la vigencia mensual con historial. No se modifican misiones, captaciones ni pagos actuales.</p><button type="button" disabled={!!validation} onClick={exportDraft}>Descargar propuesta · JSON</button></footer>
  </section>;
}
