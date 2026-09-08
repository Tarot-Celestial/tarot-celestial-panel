"use client";

import { ArrowDownRight, ArrowUpRight, Check, RotateCw, Sparkles, Star, Target, Trophy, WalletCards } from "lucide-react";
import styles from "./TarotistaInvoiceDashboard.module.css";

type Props = {
  month: string;
  invoice: any;
  lines: any[];
  insights: any;
  liveStats: any;
  incidents: any[];
  canSeeMoney: boolean;
  ackNote: string;
  onAckNoteChange: (value: string) => void;
  onRespond: (action: "accepted" | "rejected") => void;
  onReload: () => void;
};

const euro = (value: unknown) => Number(value || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
const number = (value: unknown) => Number(value || 0).toLocaleString("es-ES", { maximumFractionDigits: 0 });
const monthLabel = (key: string) => {
  const [year, month] = String(key || "").split("-").map(Number);
  if (!year || !month) return key;
  return new Date(year, month - 1, 1).toLocaleDateString("es-ES", { month: "long", year: "numeric" });
};
const percentChange = (current: number, previous: number, hasPrevious: boolean) => {
  if (!hasPrevious) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
};
const invoiceStatus = (invoice: any) => {
  const ack = String(invoice?.worker_ack || "").toLowerCase();
  return ["accepted", "rejected", "review"].includes(ack) ? ack : String(invoice?.status || "pending");
};

function Trend({ value }: { value: number | null }) {
  if (value === null) return <span className={styles.neutral}>Sin histórico comparable</span>;
  const up = value >= 0;
  return (
    <span className={up ? styles.up : styles.down}>
      {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
      {value > 0 ? "+" : ""}{value}% vs. mes anterior
    </span>
  );
}

function GoalCard({ icon, title, current, target, reward, unit, tone }: {
  icon: React.ReactNode; title: string; current: number; target: number; reward: number | null; unit: string; tone: "gold" | "violet";
}) {
  const achieved = current >= target;
  const remaining = Math.max(0, target - current);
  const progress = Math.min(100, Math.round((current / target) * 100));
  return (
    <article className={`${styles.goal} ${styles[tone]}`}>
      <div className={styles.goalTop}>
        <span className={styles.goalIcon}>{icon}</span>
        <span className={achieved ? styles.achieved : styles.active}>{achieved ? "ACTIVADO" : "EN PROGRESO"}</span>
      </div>
      <h3>{title}</h3>
      <p>{achieved
        ? `Objetivo completado. Has desbloqueado ${reward == null ? "el premio" : euro(reward)}.`
        : `Te faltan ${number(remaining)} ${unit} para desbloquear ${reward == null ? "el premio" : euro(reward)}.`}</p>
      <div className={styles.progress}><span style={{ width: `${progress}%` }} /></div>
      <div className={styles.goalNumbers}><strong>{number(current)} / {number(target)}</strong><span>{progress}%</span></div>
    </article>
  );
}

export default function TarotistaInvoiceDashboard(props: Props) {
  const { month, invoice, lines, insights, liveStats, incidents, canSeeMoney } = props;
  const currentStored = insights?.current || {};
  const previous = insights?.previous || {};
  const hasPrevious = Boolean(previous?.exists);
  const current = {
    cliente: Number(liveStats?.minutes_cliente ?? currentStored?.cliente_minutes ?? 0),
    repite: Number(liveStats?.minutes_repite ?? currentStored?.repite_minutes ?? 0),
    captadas: Number(liveStats?.captadas_total ?? currentStored?.captadas ?? 0),
  };
  const previousValues = {
    cliente: Number(previous?.cliente_minutes || 0),
    repite: Number(previous?.repite_minutes || 0),
    captadas: Number(previous?.captadas || 0),
  };
  const maxMinutes = Math.max(current.cliente, current.repite, previousValues.cliente, previousValues.repite, 1);
  const captureGoal = insights?.goals?.captaciones || { target: 10, reward: canSeeMoney ? 10 : null };
  const repeatGoal = insights?.goals?.repite || { target: 8000, reward: canSeeMoney ? 7 : null };

  return (
    <section className={styles.shell}>
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}><Sparkles size={14} /> Rendimiento y nómina</span>
          <h1>Tu mes, de un vistazo</h1>
          <p>Factura real, evolución de Cliente y Repite, y objetivos que sí cuentan.</p>
        </div>
        <button className={styles.reload} onClick={props.onReload}><RotateCw size={16} /> Actualizar datos</button>
      </header>

      <div className={styles.summaryGrid}>
        <article className={styles.totalCard}>
          <span><WalletCards size={16} /> Factura oficial · {monthLabel(month)}</span>
          <strong>{invoice ? (canSeeMoney ? euro(invoice.total) : "Importe protegido") : "Pendiente de cierre"}</strong>
          <small>{invoice ? `Estado: ${invoiceStatus(invoice)}` : "Tu producción continúa registrándose en tiempo real."}</small>
        </article>
        <article className={styles.metricCard}>
          <span>Minutos Cliente</span><strong>{number(current.cliente)}</strong>
          <Trend value={percentChange(current.cliente, previousValues.cliente, hasPrevious)} />
        </article>
        <article className={styles.metricCard}>
          <span>Minutos Repite</span><strong>{number(current.repite)}</strong>
          <Trend value={percentChange(current.repite, previousValues.repite, hasPrevious)} />
        </article>
        <article className={styles.metricCard}>
          <span>Nuevas captaciones</span><strong>{number(current.captadas)}</strong>
          <Trend value={percentChange(current.captadas, previousValues.captadas, hasPrevious)} />
        </article>
      </div>

      <div className={styles.mainGrid}>
        <article className={styles.comparison}>
          <div className={styles.sectionHeading}>
            <div><span className={styles.eyebrow}>Comparativa real</span><h2>¿Qué código te funciona mejor?</h2></div>
            <span className={styles.legend}><i /> {monthLabel(month)} <i /> {monthLabel(insights?.previous_month || "")}</span>
          </div>
          {[{ key: "cliente", label: "Cliente", current: current.cliente, previous: previousValues.cliente }, { key: "repite", label: "Repite", current: current.repite, previous: previousValues.repite }].map((item) => (
            <div className={styles.codeRow} key={item.key}>
              <div className={styles.codeTitle}><strong>{item.label}</strong><span>{number(item.current)} min</span></div>
              <div className={styles.bars}>
                <span className={styles.currentBar} style={{ width: `${Math.max(item.current ? 4 : 0, (item.current / maxMinutes) * 100)}%` }} />
                <span className={styles.previousBar} style={{ width: `${Math.max(item.previous ? 4 : 0, (item.previous / maxMinutes) * 100)}%` }} />
              </div>
              <small>Anterior: {hasPrevious ? `${number(item.previous)} min` : "sin factura"}</small>
            </div>
          ))}
        </article>

        <div className={styles.goals}>
          <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Retos del mes</span><h2>Bonos por desbloquear</h2></div><Trophy size={22} /></div>
          <GoalCard icon={<Star size={20} />} title="10 nuevas captaciones" current={current.captadas} target={Number(captureGoal.target)} reward={captureGoal.reward} unit="captaciones" tone="gold" />
          <GoalCard icon={<Target size={20} />} title="8.000 minutos Repite" current={current.repite} target={Number(repeatGoal.target)} reward={repeatGoal.reward} unit="minutos Repite" tone="violet" />
        </div>
      </div>

      <article className={styles.invoiceBlock}>
        <div className={styles.sectionHeading}>
          <div><span className={styles.eyebrow}>Documento oficial</span><h2>Detalle de tu factura</h2></div>
          {invoice && <span className={styles.status}><Check size={14} /> {invoiceStatus(invoice)}</span>}
        </div>
        {!invoice ? (
          <div className={styles.empty}>La factura todavía no está cerrada por Administración. Tus estadísticas y objetivos de arriba ya usan la actividad real del mes.</div>
        ) : (
          <>
            <div className={styles.lines}>
              {(lines || []).map((line: any) => <div className={styles.line} key={line.id}><span>{line.label}</span><strong>{canSeeMoney ? euro(line.amount) : (line?.meta?.minutes != null ? `${number(line.meta.minutes)} min` : "Protegido")}</strong></div>)}
              {!lines?.length && <div className={styles.empty}>La factura no contiene líneas todavía.</div>}
            </div>
            <div className={styles.ack}>
              <input value={props.ackNote} onChange={(event) => props.onAckNoteChange(event.target.value)} placeholder="Nota opcional para Administración" />
              <button onClick={() => props.onRespond("accepted")}>Aceptar factura</button>
              <button className={styles.reject} onClick={() => props.onRespond("rejected")}>Solicitar revisión</button>
            </div>
          </>
        )}
      </article>

      <article className={styles.incidents}>
        <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Control transparente</span><h2>Incidencias del mes</h2></div><span>{incidents?.length || 0}</span></div>
        {!incidents?.length ? <div className={styles.clean}><Check size={18} /> No tienes incidencias registradas este mes.</div> : incidents.map((incident: any) => (
          <div className={styles.incident} key={incident.id}><span>{incident.title || incident.reason || "Incidencia"}</span><strong>{canSeeMoney ? `-${euro(incident.amount)}` : "Protegido"}</strong></div>
        ))}
      </article>
    </section>
  );
}
