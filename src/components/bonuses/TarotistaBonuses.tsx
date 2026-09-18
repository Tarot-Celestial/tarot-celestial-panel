"use client";
import {
  captureTier,
  applicable,
  METRICS,
  type BonusRule,
} from "@/lib/bonuses/engine";
import { euro, useBonuses } from "./useBonuses";
import styles from "./Bonuses.module.css";
export default function TarotistaBonuses({
  month,
  compact = false,
}: {
  month: string;
  compact?: boolean;
}) {
  const { data, error, loading, load } = useBonuses(
    `/api/bonuses?month=${encodeURIComponent(month)}`,
  );
  const progress = data?.progress || [],
    awards = data?.awards || [],
    hide = data?.money_hidden;
  const total = (list: any[]) =>
    hide
      ? null
      : list.reduce((n: number, r: any) => n + Number(r.amount || 0), 0);
  const tiers = (data?.rules || [])
    .filter((r: BonusRule) => r.kind === "tier" && applicable(r, month))
    .sort((a: BonusRule, b: BonusRule) => a.minimum - b.minimum);
  const count = Number(data?.stats?.captadas_total || 0),
    tier = captureTier(tiers, count, month),
    next = tiers.find((r: BonusRule) => r.minimum > count);
  const confirmed = awards.filter((a: any) => a.status === "included"),
    challenges = progress.filter((p: any) => p.kind === "challenge");
  return (
    <section className={styles.shell} aria-busy={loading}>
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>Tarot Celestial · Recompensas</span>
          <h1>
            {compact ? "Bonos de tu factura" : "Tu esfuerzo tiene recompensa"}
          </h1>
          <p className={styles.muted}>
            Captaciones, posiciones y retos · {month}
          </p>
        </div>
        <button onClick={() => void load()} disabled={loading}>
          {loading ? "Actualizando…" : "Actualizar"}
        </button>
      </header>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {data && (
        <>
          <div className={styles.summary}>
            <div className={styles.metric}>
              <span>Bonos confirmados del periodo</span>
              <strong>{euro(total(confirmed))}</strong>
              <small className={styles.muted}>Incluidos en tu factura.</small>
            </div>
            <div className={styles.metric}>
              <span>Estimación del periodo</span>
              <strong>{euro(total(progress))}</strong>
              <small className={styles.muted}>
                Puede variar hasta la confirmación.
              </small>
            </div>
            <div className={styles.metric}>
              <span>Ranking provisional</span>
              <strong>
                {euro(total(progress.filter((p: any) => p.kind === "ranking")))}
              </strong>
              <small className={styles.muted}>
                La posición definitiva se confirma al cierre.
              </small>
            </div>
          </div>
          <p className={styles.muted}>
            {data.invoice?.bonus_closed_at
              ? "Este periodo ya está confirmado. Los cambios posteriores de reglas no modifican los premios guardados."
              : "Los objetivos alcanzados se confirman al cerrar el periodo desde Administración."}
          </p>
          {!compact && (
            <>
              <section className={styles.section}>
                <h2>Tus retos activos</h2>
                <div className={styles.grid}>
                  {challenges.map((p: any) => (
                    <article className={styles.card} key={p.rule_id}>
                      {p.image_url && (
                        <img
                          src={p.image_url}
                          alt=""
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      )}
                      <span className={styles.badge}>
                        {p.suppressed
                          ? "No acumulable · prevalece otro premio"
                          : p.reached
                            ? data.invoice?.bonus_closed_at
                              ? "Periodo cerrado · consulta el historial"
                              : "Objetivo alcanzado · pendiente de cierre"
                            : "En progreso"}
                      </span>
                      <h3>{p.name}</h3>
                      <p className={styles.muted}>{p.description}</p>
                      <p>
                        {p.value} / {p.target}{" "}
                        <small>
                          {METRICS[p.metric as keyof typeof METRICS]}
                        </small>
                      </p>
                      <div
                        className={styles.progress}
                        role="progressbar"
                        aria-label={p.name}
                        aria-valuenow={Math.round(p.progress)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <span style={{ width: `${p.progress}%` }} />
                      </div>
                      <div className={styles.prize}>
                        <span>
                          {p.reached
                            ? "Objetivo cumplido"
                            : p.remaining === null
                              ? "Sin posición todavía"
                              : `Te faltan ${p.remaining}`}
                        </span>
                        <strong>{euro(p.reward)}</strong>
                      </div>
                    </article>
                  ))}
                </div>
                {!challenges.length && (
                  <p className={styles.muted}>
                    No hay retos configurados para este periodo.
                  </p>
                )}
              </section>
              <div className={styles.grid}>
                <section className={styles.section}>
                  <h2>Tu tramo de captadas</h2>
                  <div className={styles.metric}>
                    <span>{count} captadas registradas</span>
                    <strong>
                      {tier
                        ? `${euro(tier.reward)} / captada`
                        : "Sin tramo activo"}
                    </strong>
                    <small className={styles.muted}>
                      {next
                        ? `Siguiente tramo: ${next.minimum} captadas · ${euro(next.reward)} / captada`
                        : "No hay un tramo superior activo."}
                    </small>
                  </div>
                  {next && (
                    <div className={styles.progress}>
                      <span
                        style={{
                          width: `${Math.min(100, (count / next.minimum) * 100)}%`,
                        }}
                      />
                    </div>
                  )}
                  <div className={styles.tableWrap}>
                    <table>
                      <thead>
                        <tr>
                          <th>Tramo</th>
                          <th>Captadas</th>
                          <th>Por captada</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tiers.map((r: BonusRule) => (
                          <tr key={r.id}>
                            <td>{r.name}</td>
                            <td>
                              {r.minimum}–{r.maximum ?? "∞"}
                            </td>
                            <td>{euro(r.reward)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                <section className={styles.section}>
                  <h2>Ranking en vivo</h2>
                  <p className={styles.muted}>
                    Los empates se ordenan por el identificador estable de
                    tarotista. Sin actividad en la métrica no se concede premio.
                  </p>
                  {["captadas", "cliente", "repite"].map((key) => (
                    <div className={styles.historyItem} key={key}>
                      <div>
                        <strong>
                          {key === "captadas"
                            ? "Captadas"
                            : key === "cliente"
                              ? "Cliente"
                              : "Repite"}
                        </strong>
                        <small>
                          {data.stats?.positions?.[key]
                            ? `Puesto ${data.stats.positions[key]}`
                            : "Sin posición"}
                        </small>
                      </div>
                      <strong>
                        {euro(
                          total(
                            progress.filter(
                              (p: any) =>
                                p.kind === "ranking" &&
                                p.metric === `rank_${key}`,
                            ),
                          ),
                        )}
                      </strong>
                    </div>
                  ))}
                </section>
              </div>
            </>
          )}
          <section className={styles.section}>
            <h2>Bonos conseguidos y confirmados</h2>
            <div className={styles.history}>
              {awards.map((a: any) => (
                <div className={styles.historyItem} key={a.id}>
                  <div>
                    <strong>{a.name}</strong>
                    <small>
                      {new Date(a.created_at).toLocaleDateString("es-ES")} ·{" "}
                      {a.invoice_month} ·{" "}
                      {a.status === "void"
                        ? "Anulado"
                        : "Confirmado · incluido en factura"}
                    </small>
                    {a.void_reason && <small>{a.void_reason}</small>}
                  </div>
                  <strong>{euro(a.amount)}</strong>
                </div>
              ))}
            </div>
            {!awards.length && (
              <p className={styles.muted}>
                Todavía no hay bonos confirmados en este periodo.
              </p>
            )}
          </section>
        </>
      )}
    </section>
  );
}
