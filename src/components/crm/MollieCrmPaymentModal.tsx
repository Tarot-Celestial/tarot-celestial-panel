"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Banknote,
  CheckCircle2,
  Clock3,
  Copy,
  CreditCard,
  ExternalLink,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { buildInternationalPhone, getCountryByLabelOrCode } from "@/lib/countries";
import styles from "./MollieCrmPaymentModal.module.css";

type ClientRef = {
  id: string;
  nombre?: string | null;
  apellido?: string | null;
  telefono?: string | null;
  telefono_normalizado?: string | null;
  pais?: string | null;
};

type Pack = {
  id: string;
  nombre: string;
  descripcion: string;
  amount: number;
  total_minutes: number;
  roulette_level: number;
  roulette_spins: number;
  coins: number;
  oracle_credits: number;
  highlight: boolean;
};

type PaymentState = {
  attempt_id: string;
  payment_id?: string | null;
  url: string;
  amount: number;
  currency: string;
  status: string;
  remote_status?: string | null;
  pack?: Pack | null;
  manual?: boolean;
};

type Props = {
  open: boolean;
  cliente: ClientRef | null;
  getToken: () => Promise<string | null>;
  onClose: () => void;
  onPaid?: () => void | Promise<void>;
};

function money(value: number) {
  return Number(value || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

type PaymentVisualState = "waiting" | "success" | "rejected";

function paymentVisualState(status: string, remote?: string | null): PaymentVisualState {
  const localStatus = String(status || "").toLowerCase();
  const remoteStatus = String(remote || "").toLowerCase();

  if (localStatus === "completed") return "success";
  if (
    ["failed", "cancelled", "canceled"].includes(localStatus) ||
    ["failed", "expired", "cancelled", "canceled"].includes(remoteStatus)
  ) return "rejected";

  return "waiting";
}

export default function MollieCrmPaymentModal({ open, cliente, getToken, onClose, onPaid }: Props) {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [mode, setMode] = useState<"pack" | "manual">("pack");
  const [packId, setPackId] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [payment, setPayment] = useState<PaymentState | null>(null);
  const notifiedPaid = useRef(false);
  const getTokenRef = useRef(getToken);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const paymentStorageKey = cliente?.id ? `tc:crm:mollie:pending:${cliente.id}` : "";

  const nombre = useMemo(
    () => [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ").trim() || "Clienta",
    [cliente?.nombre, cliente?.apellido],
  );

  const selectedPack = useMemo(() => packs.find((pack) => pack.id === packId) || null, [packs, packId]);
  const requestedAmount = mode === "pack"
    ? Number(selectedPack?.amount || 0)
    : Number(String(manualAmount || "").replace(",", ".")) || 0;
  const visualPaymentState = payment
    ? paymentVisualState(payment.status, payment.remote_status)
    : "waiting";

  const whatsappPhone = useMemo(() => {
    const raw = String(cliente?.telefono_normalizado || cliente?.telefono || "").trim();
    if (!raw) return "";
    const country = getCountryByLabelOrCode(cliente?.pais || "España");
    return buildInternationalPhone(country, raw).replace(/\D/g, "");
  }, [cliente?.pais, cliente?.telefono, cliente?.telefono_normalizado]);

  useEffect(() => {
    if (!open || !cliente?.id) return;
    setMode("pack");
    setManualAmount("");
    setNotes("");
    setMessage("");
    notifiedPaid.current = false;

    let restoredPayment: PaymentState | null = null;
    if (paymentStorageKey) {
      try {
        const raw = window.sessionStorage.getItem(paymentStorageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as PaymentState;
          if (parsed?.attempt_id && parsed?.url && ["pending", "processing"].includes(parsed.status)) {
            restoredPayment = parsed;
          }
        }
      } catch {
        // Si el navegador bloquea sessionStorage, el cobrador sigue funcionando con estado React.
      }
    }
    setPayment(restoredPayment);

    void (async () => {
      try {
        const token = await getTokenRef.current();
        if (!token) return;
        const response = await fetch("/api/crm/pagos/mollie", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = await response.json().catch(() => null);
        if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudieron cargar los packs.");
        const nextPacks = Array.isArray(json.packs) ? json.packs : [];
        setPacks(nextPacks);
        setPackId(String(nextPacks.find((pack: Pack) => pack.highlight)?.id || nextPacks[0]?.id || ""));
      } catch (error: any) {
        setMessage(error?.message || "No se pudieron cargar los packs.");
      }
    })();
  }, [open, cliente?.id, paymentStorageKey]);

  useEffect(() => {
    if (!open || !paymentStorageKey || !payment) return;
    try {
      if (["pending", "processing"].includes(payment.status)) {
        window.sessionStorage.setItem(paymentStorageKey, JSON.stringify(payment));
      } else {
        window.sessionStorage.removeItem(paymentStorageKey);
      }
    } catch {
      // sessionStorage es solo una capa extra de recuperación; no bloquea el cobro.
    }
  }, [open, payment, paymentStorageKey]);

  async function refreshStatus(silent = false) {
    if (!payment?.attempt_id) return;
    try {
      if (!silent) setLoading(true);
      const token = await getToken();
      if (!token) return;
      const response = await fetch(`/api/crm/pagos/mollie?attempt_id=${encodeURIComponent(payment.attempt_id)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudo comprobar el pago.");
      const attempt = json.attempt || {};
      setPayment((current) => current ? {
        ...current,
        status: String(attempt.status || current.status),
        remote_status: attempt.remote_status || null,
        payment_id: attempt.payment_id || current.payment_id || null,
        url: attempt.checkout_url || current.url,
      } : current);

      if (attempt.status === "completed" && !notifiedPaid.current) {
        notifiedPaid.current = true;
        setMessage("✅ Pago confirmado por Mollie. El CRM y los beneficios ya se han actualizado.");
        await Promise.resolve(onPaid?.());
      }
    } catch (error: any) {
      if (!silent) setMessage(error?.message || "No se pudo comprobar el pago.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    if (!open || !payment?.attempt_id || !["pending", "processing"].includes(payment.status)) return;
    const timer = window.setInterval(() => void refreshStatus(true), 3000);
    return () => window.clearInterval(timer);
  }, [open, payment?.attempt_id, payment?.status]);

  async function createPayment() {
    if (!cliente?.id) return;
    if (mode === "pack" && !selectedPack) {
      setMessage("Selecciona un pack.");
      return;
    }
    if (mode === "manual" && (!Number.isFinite(requestedAmount) || requestedAmount <= 0)) {
      setMessage("Introduce un importe manual válido.");
      return;
    }

    try {
      setLoading(true);
      setMessage("");
      const token = await getToken();
      if (!token) return;
      const response = await fetch("/api/crm/pagos/mollie", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: cliente.id,
          pack_id: mode === "pack" ? selectedPack?.id : "crm_manual_amount",
          manual_amount: mode === "manual" ? requestedAmount : undefined,
          notes,
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok || !json?.url || !json?.attempt_id) {
        throw new Error(json?.error || "No se pudo generar el cobro Mollie.");
      }
      setPayment({
        attempt_id: String(json.attempt_id),
        payment_id: json.payment_id || null,
        url: String(json.url),
        amount: Number(json.amount || requestedAmount),
        currency: String(json.currency || "EUR"),
        status: "pending",
        pack: json.pack || null,
        manual: Boolean(json.manual),
      });
      setMessage("✅ Enlace seguro generado. Ábrelo en WhatsApp Web para enviárselo a la clienta.");
    } catch (error: any) {
      setMessage(`❌ ${error?.message || "No se pudo generar el cobro Mollie."}`);
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    if (!payment?.url) return;
    try {
      await navigator.clipboard.writeText(payment.url);
      setMessage("✅ Enlace de pago copiado.");
    } catch {
      setMessage("No se pudo copiar automáticamente. Selecciona el enlace manualmente.");
    }
  }

  function openWhatsApp() {
    if (!payment?.url) return;
    if (!whatsappPhone) {
      setMessage("⚠️ La ficha no tiene un teléfono válido para abrir WhatsApp.");
      return;
    }

    if (paymentStorageKey) {
      try {
        window.sessionStorage.setItem(paymentStorageKey, JSON.stringify(payment));
      } catch {
        // No bloqueamos la apertura de WhatsApp si sessionStorage no está disponible.
      }
    }

    const whatsappNombre = String(cliente?.nombre || "").trim() || nombre;
    const text = [
      `Hola ${whatsappNombre}`,
      "",
      `Te envío tu enlace seguro de pago seguro de Tarot Celestial por ${money(payment.amount)} (tu pago).`,
      "",
      payment.url,
      "",
      "Gracias por confiar en Tarot Celestial",
    ].join("\n");
    const url = `https://web.whatsapp.com/send?phone=${encodeURIComponent(whatsappPhone)}&text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  if (!open || !cliente || typeof document === "undefined") return null;

  return createPortal(
    <div className={styles.backdrop} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Cobrador Mollie">
        <button className={styles.close} type="button" onClick={onClose} aria-label="Cerrar"><X /></button>

        <header className={styles.header}>
          <div className={styles.icon}><CreditCard /></div>
          <div>
            <span className={styles.eyebrow}>COBRADOR SEGURO · MOLLIE</span>
            <h2>Realizar pago</h2>
            <p>{nombre} · {cliente.telefono_normalizado || cliente.telefono || "Sin teléfono"}</p>
          </div>
          <span className={styles.secure}><ShieldCheck /> Seguro</span>
        </header>

        {!payment ? (
          <>
            <div className={styles.modeSwitch}>
              <button type="button" data-active={mode === "pack"} onClick={() => setMode("pack")}><Sparkles /> Pack</button>
              <button type="button" data-active={mode === "manual"} onClick={() => setMode("manual")}><Banknote /> Importe manual</button>
            </div>

            {mode === "pack" ? (
              <div className={styles.packGrid}>
                {packs.map((pack) => (
                  <button key={pack.id} type="button" className={styles.pack} data-selected={packId === pack.id} onClick={() => setPackId(pack.id)}>
                    <span>{pack.nombre}</span>
                    <strong>{money(pack.amount)}</strong>
                    <small>{pack.total_minutes} min · {pack.roulette_spins} giro{pack.roulette_spins === 1 ? "" : "s"} N{pack.roulette_level}{pack.coins ? ` · +${pack.coins} Coins` : ""}{pack.oracle_credits ? ` · +${pack.oracle_credits} Oráculo` : ""}</small>
                  </button>
                ))}
              </div>
            ) : (
              <div className={styles.manualBox}>
                <label>
                  <span>Importe a cobrar</span>
                  <div className={styles.moneyInput}><input inputMode="decimal" value={manualAmount} onChange={(e) => setManualAmount(e.target.value.replace(/[^0-9.,]/g, ""))} placeholder="Ej. 27,50" /><b>€</b></div>
                </label>
                <p>El importe personalizado se registra como cobro manual de CRM. No añade minutos de un pack; conserva la lógica de Coins y Ruleta del cobro manual.</p>
              </div>
            )}

            <label className={styles.notes}>
              <span>Nota interna opcional</span>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Ej. Acuerdo telefónico / promoción especial" />
            </label>

            <div className={styles.summary}>
              <span>Total a cobrar</span><strong>{requestedAmount > 0 ? money(requestedAmount) : "—"}</strong>
            </div>

            <button className={styles.generate} type="button" disabled={loading || requestedAmount <= 0} onClick={() => void createPayment()}>
              {loading ? <RefreshCw className={styles.spinIcon} /> : <CreditCard />} {loading ? "Generando..." : "Generar enlace Mollie"}
            </button>
          </>
        ) : (
          <div className={styles.paymentView}>
            <div
              className={styles.paymentStateHero}
              data-state={visualPaymentState}
              role="status"
              aria-live="polite"
            >
              <div className={styles.paymentStateGlow} aria-hidden="true" />
              <div className={styles.paymentStateIcon} aria-hidden="true">
                {visualPaymentState === "success" ? (
                  <CheckCircle2 />
                ) : visualPaymentState === "rejected" ? (
                  <X />
                ) : (
                  <Clock3 />
                )}
              </div>

              <span className={styles.paymentStateEyebrow}>
                {visualPaymentState === "success"
                  ? "MOLLIE · PAGO CONFIRMADO"
                  : visualPaymentState === "rejected"
                    ? "MOLLIE · COBRO NO COMPLETADO"
                    : "MOLLIE · COBRO EN CURSO"}
              </span>

              <strong className={styles.paymentStateTitle}>
                {visualPaymentState === "success"
                  ? "PAGO REALIZADO CORRECTAMENTE"
                  : visualPaymentState === "rejected"
                    ? "PAGO RECHAZADO"
                    : "ESPERANDO PAGO…"}
              </strong>

              <p className={styles.paymentStateText}>
                {visualPaymentState === "success"
                  ? `Mollie ha confirmado correctamente el pago de ${money(payment.amount)}.`
                  : visualPaymentState === "rejected"
                    ? `El pago de ${money(payment.amount)} no ha podido completarse.`
                    : `Esperando la confirmación de Mollie para el cobro de ${money(payment.amount)}.`}
              </p>

              <b className={styles.paymentStateAmount}>{money(payment.amount)}</b>

              {visualPaymentState === "waiting" ? (
                <div className={styles.paymentWaitingDots} aria-hidden="true">
                  <i /><i /><i />
                </div>
              ) : null}
            </div>

            <div className={styles.linkBox}><span>Enlace seguro Mollie</span><code>{payment.url}</code></div>

            <div className={styles.actions}>
              <button className={styles.whatsapp} type="button" onClick={openWhatsApp} disabled={!whatsappPhone}><MessageCircle /> Enviar enlace por WhatsApp</button>
              <button type="button" onClick={() => void copyLink()}><Copy /> Copiar enlace</button>
              <a href={payment.url} target="_blank" rel="noreferrer"><ExternalLink /> Abrir pago</a>
              <button type="button" onClick={() => void refreshStatus()} disabled={loading}><RefreshCw className={loading ? styles.spinIcon : ""} /> Comprobar</button>
            </div>

            <p className={styles.help}>WhatsApp Web abrirá la conversación con el mensaje y el enlace ya preparados. La central solo tiene que pulsar <b>Enviar</b>. La confirmación y acreditación las hace Mollie automáticamente.</p>
          </div>
        )}

        {message ? <div className={styles.message}>{message}</div> : null}
      </section>
    </div>,
    document.body,
  );
}
