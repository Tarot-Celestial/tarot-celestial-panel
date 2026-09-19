"use client";
import { useRef, useState } from "react";
import { METRICS, type BonusRule } from "@/lib/bonuses/engine";
import { bonusRequest, euro, monthNow, useBonuses } from "./useBonuses";
import styles from "./Bonuses.module.css";
const blank = (month: string) => ({
  name: "",
  description: "",
  kind: "challenge",
  metric: "captadas_total",
  minimum: 0,
  maximum: null,
  target: 1,
  reward: 0,
  position: 1,
  active: true,
  start_date: `${month}-01`,
  end_date: null,
  periodicity: "monthly",
  stackable: true,
  max_claims: 1,
  sort_order: 0,
  image_url: null,
});
export default function BonusAdminPanel() {
  const [month, setMonth] = useState(monthNow),
    [tab, setTab] = useState("rules"),
    [kind, setKind] = useState("all"),
    [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all"),
    [draft, setDraft] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [closing, setClosing] = useState(false),
    [voiding, setVoiding] = useState<string | null>(null),
    [reason, setReason] = useState("");
  const lock = useRef(false);
  const {
    data,
    error: loadError,
    loading,
    load,
  } = useBonuses(`/api/admin/bonuses?month=${month}`);
  const rules = (data?.rules || []).filter(
      (r: BonusRule) =>
        (kind === "all" || r.kind === kind) &&
        (statusFilter === "all" || (statusFilter === "active" ? r.active : !r.active)),
    ),
    workers = data?.workers || [];
  const set = (key: string, value: any) =>
    setDraft((old: any) => ({ ...old, [key]: value }));
  async function mutate(body: unknown) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await bonusRequest("/api/admin/bonuses", body);
      setMessage("Guardado correctamente.");
      setDraft(null);
      setVoiding(null);
      await load();
      window.dispatchEvent(new Event("tc-counters-refresh"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function toggleRule(rule: BonusRule) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const nextActive = !rule.active;
      await bonusRequest("/api/admin/bonuses", {
        action: "toggle_active",
        id: rule.id,
        active: nextActive,
      });
      setMessage(nextActive ? `«${rule.name}» activado.` : `«${rule.name}» desactivado.`);
      if (draft?.id === rule.id) setDraft((old: any) => old ? { ...old, active: nextActive } : old);
      await load();
      window.dispatchEvent(new Event("tc-counters-refresh"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar el estado del reto.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function closeMonth() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await bonusRequest("/api/invoices/generate", { month });
      setMessage(
        `Facturas actualizadas: ${result.created + result.updated}. Bonos elegibles confirmados en las facturas editables.${result.historical_skipped ? ` Se conservaron ${result.historical_skipped} periodos históricos anteriores a la activación.` : ""}`,
      );
      setClosing(false);
      await load();
      window.dispatchEvent(new Event("tc-counters-refresh"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cerrar.");
      await load();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className={styles.shell}>
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>
            Administración · Incentivos económicos
          </span>
          <h1>Bonos tarotistas</h1>
          <p className={styles.muted}>
            Configura las recompensas y revisa su incorporación a las facturas.
          </p>
        </div>
        <div className={styles.toolbar}>
          <label>
            Periodo
            <input
              type="month"
              value={month}
              disabled={busy}
              onChange={(e) => {
                if (e.target.value) {
                  setMonth(e.target.value);
                  setClosing(false);
                  setDraft(null);
                }
              }}
            />
          </label>
          <button onClick={() => void load()} disabled={loading || busy}>
            Actualizar
          </button>
        </div>
      </header>
      <div className={styles.tabs}>
        <button
          className={tab === "rules" ? styles.active : ""}
          onClick={() => setTab("rules")}
        >
          Reglas y premios
        </button>
        <button
          className={tab === "awards" ? styles.active : ""}
          onClick={() => setTab("awards")}
        >
          Progreso, cierre e historial
        </button>
      </div>
      {(error || loadError) && (
        <p className={styles.error} role="alert">
          {error || loadError}
        </p>
      )}
      {message && (
        <p className={styles.success} role="status">
          {message}
        </p>
      )}
      {tab === "rules" ? (
        <>
          <div className={styles.sectionHeader}>
            <div className={styles.filterGroups}>
              <div className={styles.tabs}>
                {[
                  ["all", "Todas"],
                  ["tier", "Tramos captadas"],
                  ["ranking", "Ranking"],
                  ["challenge", "Retos"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    className={kind === key ? styles.active : ""}
                    onClick={() => setKind(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className={styles.tabs} aria-label="Filtrar por estado">
                {[
                  ["all", "Todos"],
                  ["active", "Activos"],
                  ["inactive", "Desactivados"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    className={statusFilter === key ? styles.active : ""}
                    onClick={() => setStatusFilter(key as "all" | "active" | "inactive")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <button
              className={styles.primary}
              disabled={busy}
              onClick={() => setDraft(blank(month))}
            >
              Crear bono / reto
            </button>
          </div>
          <div className={styles.editorLayout}>
            <div className={styles.list}>
              {rules.map((r: BonusRule) => (
                <article className={`${styles.rule} ${!r.active ? styles.ruleInactive : ""}`} key={r.id}>
                  <div>
                    <div className={styles.ruleTitleRow}>
                      <strong>{r.name}</strong>
                      <span className={`${styles.stateBadge} ${r.active ? styles.stateActive : styles.stateInactive}`}>
                        {r.active ? "● ACTIVO" : "● DESACTIVADO"}
                      </span>
                    </div>
                    <small>
                      {METRICS[r.metric]} · {euro(r.reward)}
                      {r.kind === "tier" ? " / captada" : ""}
                    </small>
                    <small>
                      Desde {r.start_date}
                      {r.end_date ? ` hasta ${r.end_date}` : ""}
                    </small>
                  </div>
                  <div className={styles.toolbar}>
                    <button disabled={busy} onClick={() => setDraft({ ...r })}>
                      Editar
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        setDraft({
                          ...r,
                          id: undefined,
                          version: undefined,
                          name: `${r.name} (copia)`,
                          active: false,
                        })
                      }
                    >
                      Duplicar
                    </button>
                    <button
                      disabled={busy}
                      className={r.active ? styles.deactivateButton : styles.activateButton}
                      onClick={() => void toggleRule(r)}
                    >
                      {r.active ? "Desactivar" : "Activar"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
            <section className={styles.section}>
              {draft ? (
                <form
                  className={styles.form}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void mutate({ action: "save", rule: draft });
                  }}
                >
                  <h2>{draft.id ? "Editar regla" : "Nueva regla"}</h2>
                  <label>
                    Nombre
                    <input
                      required
                      maxLength={120}
                      value={draft.name}
                      onChange={(e) => set("name", e.target.value)}
                    />
                  </label>
                  <label>
                    Descripción
                    <textarea
                      maxLength={2000}
                      value={draft.description}
                      onChange={(e) => set("description", e.target.value)}
                    />
                  </label>
                  <div className={styles.fields}>
                    <label>
                      Tipo
                      <select
                        value={draft.kind}
                        onChange={(e) => {
                          const k = e.target.value;
                          setDraft((d: any) => ({
                            ...d,
                            kind: k,
                            metric:
                              k === "ranking"
                                ? "rank_captadas"
                                : "captadas_total",
                            periodicity: "monthly",
                            max_claims: 1,
                          }));
                        }}
                      >
                        <option value="tier">Tramo de captadas</option>
                        <option value="ranking">Premio de ranking</option>
                        <option value="challenge">Reto</option>
                      </select>
                    </label>
                    <label>
                      Métrica
                      <select
                        value={draft.metric}
                        onChange={(e) => set("metric", e.target.value)}
                      >
                        {Object.entries(METRICS)
                          .filter(([k]) =>
                            draft.kind === "tier"
                              ? k === "captadas_total"
                              : draft.kind === "ranking"
                                ? k.startsWith("rank_")
                                : true,
                          )
                          .map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                  {draft.kind === "tier" ? (
                    <div className={styles.fields}>
                      <label>
                        Mínimo de captadas
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={draft.minimum}
                          onChange={(e) => set("minimum", e.target.value)}
                        />
                      </label>
                      <label>
                        Máximo (vacío = sin límite)
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={draft.maximum ?? ""}
                          onChange={(e) =>
                            set(
                              "maximum",
                              e.target.value === "" ? null : e.target.value,
                            )
                          }
                        />
                      </label>
                    </div>
                  ) : draft.kind === "ranking" ? (
                    <label>
                      Posición premiada
                      <input
                        type="number"
                        min="1"
                        max="100"
                        required
                        value={draft.position ?? 1}
                        onChange={(e) => set("position", e.target.value)}
                      />
                    </label>
                  ) : (
                    <label>
                      Objetivo (
                      {draft.metric.startsWith("rank_")
                        ? "puesto igual o mejor"
                        : "alcanzar o superar"}
                      )
                      <input
                        type="number"
                        required
                        min="0.01"
                        step="0.01"
                        value={draft.target}
                        onChange={(e) => set("target", e.target.value)}
                      />
                    </label>
                  )}
                  <div className={styles.fields}>
                    <label>
                      {draft.kind === "tier"
                        ? "Euros por captada"
                        : "Premio (€)"}
                      <input
                        type="number"
                        required
                        min="0"
                        max="100000"
                        step="0.01"
                        value={draft.reward}
                        onChange={(e) => set("reward", e.target.value)}
                      />
                    </label>
                    <label>
                      Orden
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={draft.sort_order}
                        onChange={(e) => set("sort_order", e.target.value)}
                      />
                    </label>
                  </div>
                  <div className={styles.fields}>
                    <label>
                      Fecha inicial
                      <input
                        type="date"
                        required
                        value={draft.start_date}
                        onChange={(e) => set("start_date", e.target.value)}
                      />
                    </label>
                    <label>
                      Fecha final (opcional)
                      <input
                        type="date"
                        value={draft.end_date || ""}
                        onChange={(e) =>
                          set("end_date", e.target.value || null)
                        }
                      />
                    </label>
                  </div>
                  {draft.kind === "challenge" && (
                    <>
                      <div className={styles.fields}>
                        <label>
                          Periodicidad
                          <select
                            value={draft.periodicity}
                            onChange={(e) => set("periodicity", e.target.value)}
                          >
                            <option value="monthly">Mensual</option>
                            <option value="once">
                              Puntual (fechas de un mismo mes)
                            </option>
                          </select>
                        </label>
                        <label>
                          Máximo de veces por periodo
                          <input
                            type="number"
                            min="1"
                            max="100"
                            value={draft.max_claims}
                            onChange={(e) => set("max_claims", e.target.value)}
                          />
                        </label>
                      </div>
                      <label className={styles.check}>
                        <input
                          type="checkbox"
                          checked={draft.stackable}
                          onChange={(e) => set("stackable", e.target.checked)}
                        />
                        Acumulable con otros retos
                      </label>
                      <p className={styles.muted}>
                        Entre los retos no acumulables se aplica solo el premio
                        mayor. Porcentajes y puestos se premian una vez; los
                        objetivos de cantidad pueden repetirse por cada bloque
                        alcanzado.
                      </p>
                    </>
                  )}
                  <label>
                    Imagen opcional · URL HTTPS
                    <input
                      type="url"
                      value={draft.image_url || ""}
                      onChange={(e) => set("image_url", e.target.value || null)}
                    />
                  </label>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={draft.active}
                      onChange={(e) => set("active", e.target.checked)}
                    />
                    Regla activa
                  </label>
                  <p className={styles.muted}>
                    Desactivar retira temporalmente la regla del panel Tarotista sin borrar el reto ni su histórico.
                    Al reactivarla, vuelve a calcular el progreso real del periodo vigente. Los premios ya confirmados no se modifican.
                  </p>
                  <div className={styles.toolbar}>
                    <button
                      type="submit"
                      className={styles.primary}
                      disabled={busy}
                    >
                      {busy ? "Guardando…" : "Guardar regla"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setDraft(null)}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <h2>Configuración centralizada</h2>
                  <p className={styles.muted}>
                    Selecciona una regla para editar sus importes, objetivos y
                    vigencia. Los bonos confirmados conservan su configuración
                    histórica.
                  </p>
                  <p className={styles.muted}>
                    La fuente de progreso es Rendimiento. Cliente y Repite son
                    porcentajes de minutos sobre el total, tal como calcula
                    actualmente el panel.
                  </p>
                </>
              )}
            </section>
          </div>
        </>
      ) : (
        <>
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2>Confirmar bonos del periodo</h2>
              <button
                className={styles.primary}
                disabled={
                  !data?.closed ||
                  month < data?.activation_month ||
                  busy ||
                  loading
                }
                onClick={() => setClosing(true)}
              >
                Cerrar bonos y generar facturas
              </button>
            </div>
            <p className={styles.muted}>
              Solo se confirma cuando el mes ha terminado. Los meses anteriores
              a la activación de este módulo conservan su facturación original.
              Genera o actualiza las facturas editables utilizando el proceso
              habitual; conserva ajustes manuales. Las facturas finalizadas no
              se modifican.
            </p>
            {closing && (
              <div className={styles.card}>
                <strong>Confirmar {month}</strong>
                <p className={styles.muted}>
                  Se fijarán los premios elegibles con la configuración y los
                  datos actuales. Revisa el progreso antes de continuar.
                </p>
                <div className={styles.toolbar}>
                  <button
                    className={styles.primary}
                    disabled={busy}
                    onClick={() => void closeMonth()}
                  >
                    {busy ? "Procesando…" : "Confirmar y generar"}
                  </button>
                  <button disabled={busy} onClick={() => setClosing(false)}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </section>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Tarotista</th>
                  <th>Captadas</th>
                  <th>Estimación</th>
                  <th>Confirmado</th>
                  <th>Factura</th>
                </tr>
              </thead>
              <tbody>
                {workers.map((w: any) => (
                  <tr key={w.worker_id}>
                    <td>
                      {w.display_name}
                      <details>
                        <summary>Ver objetivos</summary>
                        {w.progress.map((p: any) => (
                          <small key={p.rule_id}>
                            {p.name}: {p.value} / {p.target} · {euro(p.amount)}
                            {p.suppressed ? " · No acumulable" : ""}
                          </small>
                        ))}
                      </details>
                    </td>
                    <td>{w.captadas_total}</td>
                    <td>
                      {euro(
                        w.progress.reduce(
                          (n: number, p: any) => n + p.amount,
                          0,
                        ),
                      )}
                    </td>
                    <td>
                      {euro(
                        w.awards
                          .filter((a: any) => a.status === "included")
                          .reduce(
                            (n: number, a: any) => n + Number(a.amount),
                            0,
                          ),
                      )}
                    </td>
                    <td>
                      {w.invoice?.status || "Sin factura"}
                      {w.invoice?.bonus_closed_at && (
                        <small>Bonos confirmados</small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section className={styles.section}>
            <h2>Historial de premios</h2>
            {workers.flatMap((w: any) =>
              w.awards.map((a: any) => (
                <article className={styles.historyItem} key={a.id}>
                  <div>
                    <strong>
                      {w.display_name} · {a.reason}
                    </strong>
                    <small>
                      {a.invoice_month} ·{" "}
                      {new Date(a.created_at).toLocaleString("es-ES")} ·{" "}
                      {a.status === "void"
                        ? "Anulado"
                        : "Confirmado e incluido en factura"}
                    </small>
                    <small>
                      Regla v{a.rule_snapshot?.version} ·{" "}
                      {METRICS[a.rule_snapshot?.metric as keyof typeof METRICS]}
                      : {a.metrics_snapshot?.value} · {a.units} premio(s)
                    </small>
                    {a.void_reason && <small>{a.void_reason}</small>}
                  </div>
                  <div className={styles.toolbar}>
                    <strong>{euro(a.amount)}</strong>
                    {a.status !== "void" && (
                      <button
                        className={styles.danger}
                        disabled={busy}
                        onClick={() => {
                          setVoiding(a.id);
                          setReason("");
                        }}
                      >
                        Anular
                      </button>
                    )}
                  </div>
                  {voiding === a.id && (
                    <form
                      className={styles.form}
                      onSubmit={(e) => {
                        e.preventDefault();
                        void mutate({ action: "void", award_id: a.id, reason });
                      }}
                    >
                      <label>
                        Motivo de anulación
                        <textarea
                          required
                          minLength={3}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                      </label>
                      <button disabled={busy}>Confirmar anulación</button>
                      <button type="button" onClick={() => setVoiding(null)}>
                        Cancelar
                      </button>
                    </form>
                  )}
                </article>
              )),
            )}
            {!workers.some((w: any) => w.awards.length) && (
              <p className={styles.muted}>
                No hay premios confirmados en este periodo.
              </p>
            )}
          </section>
        </>
      )}
    </section>
  );
}
