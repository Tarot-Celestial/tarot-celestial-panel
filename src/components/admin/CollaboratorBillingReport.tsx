"use client";

import { useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import { Trash2 } from "lucide-react";
import styles from "./CollaboratorBillingReport.module.css";

type DeleteRecordPayload = {
  recordType: "service" | "payment";
  source: "rendimiento_llamadas" | "crm_cliente_pagos";
  recordId: string;
  reason: string;
  note?: string;
};

type Props = {
  report: any;
  loading?: boolean;
  message?: string;
  onRefresh: () => void;
  onDownload: () => void;
  onBack: () => void;
  onDeleteRecord: (payload: DeleteRecordPayload) => Promise<void>;
};

type PendingDelete = DeleteRecordPayload & {
  label: string;
  confirmationTitle: string;
  confirmationText: string;
  confirmationButton: string;
};

const DELETION_REASONS = [
  { value: "registro_prueba", label: "Registro de prueba" },
  { value: "registro_duplicado", label: "Registro duplicado" },
  { value: "importe_incorrecto", label: "Importe incorrecto" },
  { value: "cliente_incorrecto", label: "Cliente incorrecto" },
  { value: "operacion_anulada", label: "Operación anulada" },
  { value: "otro", label: "Otro" },
];

function num(value: unknown, digits = 0) {
  return (Number(value || 0) || 0).toLocaleString("es-ES", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function money(value: unknown, currency = "EUR") {
  const amount = Number(value || 0) || 0;
  try {
    return amount.toLocaleString("es-ES", { style: "currency", currency });
  } catch {
    return `${num(amount, 2)} ${currency}`;
  }
}

function dateTime(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
}

function comparisonText(item: any) {
  if (item?.reason) return String(item.reason);
  if (!item?.has_previous) return "Sin histórico";
  if (item?.change_pct === null || item?.change_pct === undefined) {
    return item?.current > 0 ? "Nuevo periodo" : "Sin variación";
  }
  const value = Number(item.change_pct) || 0;
  return `${value > 0 ? "+" : ""}${num(value, 2)} %`;
}

function trendSymbol(trend: string) {
  if (trend === "up") return "↗";
  if (trend === "down") return "↘";
  return "→";
}

function currencyBreakdown(values: Record<string, number> | undefined) {
  const entries = Object.entries(values || {});
  if (!entries.length) return "0,00 €";
  return entries.map(([currency, total]) => money(total, currency)).join(" · ");
}

function MetricCard({ label, value, comparison, icon, accent = "purple" }: any) {
  const trend = comparison?.trend || "neutral";
  return (
    <article className={`${styles.metricCard} ${styles[accent]} ${styles[`trend_${trend}`]}`}>
      <span className={styles.metricGlow} aria-hidden="true" />
      <div className={styles.metricTop}>
        <span className={styles.metricIcon}>{icon}</span>
        <span className={styles.trendBadge}>{trendSymbol(trend)} {comparisonText(comparison)}</span>
      </div>
      <strong>{value}</strong>
      <span>{label}</span>
      <small>{comparison?.has_previous ? "Frente al mes anterior" : "Sin datos anteriores"}</small>
    </article>
  );
}

function MethodCard({ label, value, icon }: any) {
  return (
    <article className={styles.methodCard}>
      <span>{icon}</span>
      <div><small>{label}</small><strong>{value}</strong></div>
    </article>
  );
}

export default function CollaboratorBillingReport({
  report,
  loading,
  message,
  onRefresh,
  onDownload,
  onBack,
  onDeleteRecord,
}: Props) {
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deletionReason, setDeletionReason] = useState("registro_prueba");
  const [deletionNote, setDeletionNote] = useState("");
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const deletingRef = useRef(false);
  const [actionMessage, setActionMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  if (!report) return null;
  const summary = report.summary || {};
  const comparisons = report.comparisons || {};
  const methodCurrencies = summary.totals_by_method_currency || {};
  const canDeleteMarioRecords = String(report.collaborator?.display_name || "").trim().toLowerCase() === "mario"
    || String(report.tag?.name || "").trim().toLowerCase() === "call mario";

  function openDelete(recordType: "service" | "payment", row: any) {
    const source = String(row?.source || "") as DeleteRecordPayload["source"];
    const recordId = String(row?.id || "").trim();
    if (!recordId || !["rendimiento_llamadas", "crm_cliente_pagos"].includes(source)) {
      setActionMessage({ type: "error", text: "No se pudo identificar el registro real. Actualiza la página e inténtalo de nuevo." });
      return;
    }

    setDeletionReason("registro_prueba");
    setDeletionNote("");
    setActionMessage(null);
    setPendingDelete({
      recordType,
      source,
      recordId,
      reason: "registro_prueba",
      label: recordType === "service" ? "servicio" : "cobro",
      confirmationTitle: recordType === "service"
        ? "¿Seguro que quieres eliminar este servicio del informe de Mario?"
        : "¿Seguro que quieres eliminar este cobro?",
      confirmationText: recordType === "service"
        ? "Esta acción marcará el registro operativo como eliminado del informe de Mario y actualizará sus totales."
        : "El importe dejará de contabilizarse en la facturación generada de Mario.",
      confirmationButton: recordType === "service" ? "Eliminar servicio" : "Eliminar cobro",
    });
  }

  function closeDeleteModal() {
    if (deletingKey) return;
    setPendingDelete(null);
    setDeletionNote("");
  }

  async function confirmDelete() {
    if (!pendingDelete || deletingKey || deletingRef.current) return;
    deletingRef.current = true;
    const key = `${pendingDelete.source}:${pendingDelete.recordId}`;
    setDeletingKey(key);
    setActionMessage(null);

    try {
      await onDeleteRecord({
        recordType: pendingDelete.recordType,
        source: pendingDelete.source,
        recordId: pendingDelete.recordId,
        reason: deletionReason,
        note: deletionNote.trim() || undefined,
      });
      setActionMessage({
        type: "success",
        text: pendingDelete.recordType === "service"
          ? "Servicio eliminado correctamente."
          : "Cobro eliminado correctamente.",
      });
      setPendingDelete(null);
      setDeletionNote("");
    } catch {
      setActionMessage({
        type: "error",
        text: "No se pudo eliminar el registro. Actualiza la página e inténtalo de nuevo.",
      });
    } finally {
      deletingRef.current = false;
      setDeletingKey(null);
    }
  }

  return (
    <div className={styles.wrapper}>
      <section className={styles.hero}>
        <span className={styles.heroGlow} aria-hidden="true" />
        <div>
          <button type="button" className={styles.backButton} onClick={onBack}>← Volver a facturas</button>
          <div className={styles.eyebrow}>COLABORADOR · {report.month}</div>
          <h2>{report.collaborator?.display_name || "Mario"}</h2>
          <p>Informe mensual en vivo de clientes vinculados a <b>{report.tag?.name || "CALL MARIO"}</b>.</p>
          <div className={styles.syncLine}>
            <span className={styles.liveDot} />
            Sincronizado con {report.sync?.source || "datos reales"}
          </div>
        </div>
        <div className={styles.heroActions}>
          <button type="button" className={styles.secondaryButton} onClick={onRefresh} disabled={loading || Boolean(deletingKey)}>
            {loading ? "Actualizando…" : "Actualizar"}
          </button>
          <button type="button" className={styles.primaryButton} onClick={onDownload} disabled={Boolean(deletingKey)}>⇩ Descargar informe</button>
        </div>
      </section>

      {message ? <div className={styles.message}>{message}</div> : null}
      {actionMessage ? (
        <div className={actionMessage.type === "success" ? styles.successMessage : styles.errorMessage} role="status">
          {actionMessage.text}
        </div>
      ) : null}

      <section className={styles.metricsGrid}>
        <MetricCard label="Clientes atendidos" value={num(summary.clients_total)} comparison={comparisons.clients} icon="♙" accent="purple" />
        <MetricCard label="Servicios realizados" value={num(summary.services_total)} comparison={comparisons.services} icon="✦" accent="blue" />
        <MetricCard label="Minutos hablados" value={`${num(summary.minutes_total)} min`} comparison={comparisons.minutes} icon="◷" accent="green" />
        <MetricCard label="Facturación generada" value={currencyBreakdown(summary.totals_by_currency)} comparison={comparisons.generated} icon="€" accent="gold" />
      </section>

      <section className={styles.methodsGrid}>
        <MethodCard label="Total TPV" value={currencyBreakdown(methodCurrencies.TPV)} icon="▣" />
        <MethodCard label="Total PayPal" value={currencyBreakdown(methodCurrencies.PayPal)} icon="P" />
        <MethodCard label="Total Bizum" value={currencyBreakdown(methodCurrencies.Bizum)} icon="B" />
        <MethodCard label="Anuladas / reembolsadas" value={num(summary.cancelled_or_refunded)} icon="!" />
      </section>

      <section className={styles.remunerationCard}>
        <div className={styles.remunerationValue}>
          <span>Importe correspondiente a Mario</span>
          <strong>{report.remuneration?.configured ? money(report.remuneration?.payable_total || 0) : "Sin fórmula configurada"}</strong>
          {!report.remuneration?.configured ? <em>Pendiente de configurar</em> : null}
        </div>
        <div className={styles.remunerationExplanation}>
          <span>Facturación generada por los clientes</span>
          <strong>{currencyBreakdown(summary.totals_by_currency)}</strong>
          <p>{report.remuneration?.note} Esta facturación no representa automáticamente el pago a Mario; todavía falta definir su fórmula o comisión.</p>
        </div>
      </section>

      <section className={styles.tableCard}>
        <div className={styles.sectionHeading}>
          <div><span>REGISTRO OPERATIVO</span><h3>Servicios prestados</h3></div>
          <b>{num(report.services?.length || 0)} registros</b>
        </div>
        <div className={styles.tableScroll}>
          <table>
            <thead><tr><th>Fecha</th><th>Cliente</th><th>Duración</th><th>Tarifa / paquete</th><th>Precio</th><th>Método</th><th>Estado</th><th>Referencia</th><th>Tarotista</th>{canDeleteMarioRecords ? <th>Acción</th> : null}</tr></thead>
            <tbody>
              {(report.services || []).map((service: any) => {
                const key = `${service.source}:${service.id}`;
                return (
                  <tr key={service.id}>
                    <td>{dateTime(service.service_at)}</td>
                    <td><strong>{service.cliente_nombre}</strong></td>
                    <td>
                      <strong>{num(service.minutes_total)} min</strong>
                      <small>{num(service.paid_minutes_used)} normales · {num(service.gift_minutes_used)} regalo</small>
                    </td>
                    <td>{service.package_label}</td>
                    <td>{service.amount > 0 ? money(service.amount, service.currency) : <span className={styles.neutralPill}>Saldo previo</span>}</td>
                    <td><span className={styles.methodPill}>{service.payment_method}</span></td>
                    <td><span className={styles.successPill}>{service.payment_status}</span></td>
                    <td>{service.payment_reference || "—"}</td>
                    <td>{service.tarotista_nombre}</td>
                    {canDeleteMarioRecords ? (
                      <td>
                        <button
                          type="button"
                          className={styles.deleteButton}
                          onClick={() => openDelete("service", service)}
                          disabled={Boolean(deletingKey) || loading}
                          aria-label={`Eliminar servicio de ${service.cliente_nombre}`}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          {deletingKey === key ? "Eliminando…" : "Eliminar"}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {(!report.services || report.services.length === 0) && (
                <tr><td colSpan={canDeleteMarioRecords ? 10 : 9}><div className={styles.empty}>No hay servicios reales vinculados a CALL MARIO en este mes.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.tableCard}>
        <div className={styles.sectionHeading}>
          <div><span>OPERACIONES REALES</span><h3>Cobros del periodo</h3></div>
          <b>{num(summary.completed_payments || 0)} completados</b>
        </div>
        <div className={styles.tableScroll}>
          <table>
            <thead><tr><th>Fecha</th><th>Cliente</th><th>Tarifa</th><th>Importe</th><th>Método</th><th>Estado</th><th>Referencia</th><th>Fuente</th>{canDeleteMarioRecords ? <th>Acción</th> : null}</tr></thead>
            <tbody>
              {(report.payments || []).map((payment: any) => {
                const key = `${payment.source}:${payment.id}`;
                return (
                  <tr key={key}>
                    <td>{dateTime(payment.created_at)}</td>
                    <td><strong>{payment.cliente_nombre}</strong></td>
                    <td>{payment.package_name || payment.package_id || "Tarifa no identificada"}</td>
                    <td>{money(payment.amount, payment.currency)}</td>
                    <td><span className={styles.methodPill}>{payment.method_group}</span></td>
                    <td><span className={payment.status_group === "completed" ? styles.successPill : styles.alertPill}>{payment.status_raw || payment.status_group}</span></td>
                    <td>{payment.reference || "—"}</td>
                    <td>{payment.source === "crm_cliente_pagos" ? "Cobros CRM" : "Rendimiento"}</td>
                    {canDeleteMarioRecords ? (
                      <td>
                        <button
                          type="button"
                          className={styles.deleteButton}
                          onClick={() => openDelete("payment", payment)}
                          disabled={Boolean(deletingKey) || loading}
                          aria-label={`Eliminar cobro de ${payment.cliente_nombre}`}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          {deletingKey === key ? "Eliminando…" : "Eliminar"}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {(!report.payments || report.payments.length === 0) && (
                <tr><td colSpan={canDeleteMarioRecords ? 9 : 8}><div className={styles.empty}>No hay operaciones registradas para este mes.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {pendingDelete ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
          if (event.target === event.currentTarget) closeDeleteModal();
        }}>
          <section className={styles.confirmModal} role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title">
            <span className={styles.modalGlow} aria-hidden="true" />
            <div className={styles.warningIcon} aria-hidden="true">!</div>
            <h3 id="delete-dialog-title">{pendingDelete.confirmationTitle}</h3>
            <p>{pendingDelete.confirmationText}</p>

            <label className={styles.fieldLabel} htmlFor="mario-delete-reason">Motivo de la eliminación</label>
            <select
              id="mario-delete-reason"
              className={styles.reasonSelect}
              value={deletionReason}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => setDeletionReason(event.target.value)}
              disabled={Boolean(deletingKey)}
            >
              {DELETION_REASONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
            </select>

            <label className={styles.fieldLabel} htmlFor="mario-delete-note">Observación opcional</label>
            <textarea
              id="mario-delete-note"
              className={styles.reasonNote}
              value={deletionNote}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setDeletionNote(event.target.value.slice(0, 300))}
              placeholder="Añade una aclaración breve para la auditoría"
              disabled={Boolean(deletingKey)}
            />

            <div className={styles.modalActions}>
              <button type="button" className={styles.cancelButton} onClick={closeDeleteModal} disabled={Boolean(deletingKey)}>Cancelar</button>
              <button type="button" className={styles.confirmDeleteButton} onClick={() => void confirmDelete()} disabled={Boolean(deletingKey)}>
                {deletingKey ? "Eliminando…" : pendingDelete.confirmationButton}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
