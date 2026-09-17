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
import { supabaseBrowser } from "@/lib/supabase-browser";
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
  last_error?: string | null;
  whatsapp?: { status?: string; missing?: string[] };
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

type PaymentVisualState = "waiting" | "success" | "rejected" | "processing" | "review";

function paymentVisualState(status: string, remote?: string | null, error?: string | null): PaymentVisualState {
  const localStatus = String(status || "").toLowerCase();
  const remoteStatus = String(remote || "").toLowerCase();

  if (localStatus === "completed") return "success";
  if (remoteStatus === "paid") return error ? "review" : "processing";
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
  const createBusy = useRef(false);
  const operationIds = useRef<Record<string,string>>({});
  const contextRef = useRef("");
  contextRef.current = open ? cliente?.id || "" : "";
  const refreshBusy = useRef(false);
  const refreshRef = useRef<(silent?: boolean, reconcile?: boolean) => Promise<void>>(async () => {});
  const currentAttempt = useRef("");
  currentAttempt.current = payment?.attempt_id || "";
  const [sending, setSending] = useState(false);

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
    ? paymentVisualState(payment.status, payment.remote_status, payment.last_error)
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

    let cancelled = false;
    let restoredPayment: PaymentState | null = null;
    if (paymentStorageKey) {
      try {
        const raw = window.sessionStorage.getItem(paymentStorageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as PaymentState;
          if (parsed?.attempt_id) {
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
        const response = await fetch(`/api/crm/pagos/mollie?cliente_id=${encodeURIComponent(cliente.id)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = await response.json().catch(() => null);
        if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudieron cargar los packs.");
        if (cancelled) return;
        const nextPacks = Array.isArray(json.packs) ? json.packs : [];
        setPacks(nextPacks);
        if (!restoredPayment && json.latest) {
          const a = json.latest;
          if (!a.checkout_url && !a.payment_id) {
            const suffix = a.pack_id === "crm_manual_amount" ? a.amount : a.pack_id;
            operationIds.current[`${paymentStorageKey}:operation:${suffix}`] = a.id;
            try { sessionStorage.setItem(`${paymentStorageKey}:operation:${suffix}`, a.id); } catch {}
            setMessage("La generación anterior quedó interrumpida. Reintenta el mismo importe para recuperar ese enlace.");
            if (a.pack_id === "crm_manual_amount") { setMode("manual"); setManualAmount(String(a.amount)); }
          } else setPayment({ attempt_id: a.id, url: a.checkout_url || "", amount: a.amount, currency: a.currency, status: a.status, remote_status: a.remote_status, last_error: a.last_error, whatsapp: a.whatsapp });
        }
        setPackId(String(nextPacks.find((pack: Pack) => pack.highlight)?.id || nextPacks[0]?.id || ""));
      } catch (error: any) {
        setMessage(error?.message || "No se pudieron cargar los packs.");
      }
    })();
    return () => { cancelled = true; };
  }, [open, cliente?.id, paymentStorageKey]);

  useEffect(() => {
    if (!open || !paymentStorageKey || !payment) return;
    try {
      if (payment.attempt_id) {
        window.sessionStorage.setItem(paymentStorageKey, JSON.stringify(payment));
      } else {
        window.sessionStorage.removeItem(paymentStorageKey);
      }
    } catch {
      // sessionStorage es solo una capa extra de recuperación; no bloquea el cobro.
    }
  }, [open, payment, paymentStorageKey]);

  async function refreshStatus(silent = false, reconcile = true) {
    if (!payment?.attempt_id || refreshBusy.current) return;
    const expectedId = payment.attempt_id;
    refreshBusy.current = true;
    try {
      if (!silent) setLoading(true);
      const token = await getToken();
      if (!token) return;
      const response = await fetch(`/api/crm/pagos/mollie?attempt_id=${encodeURIComponent(payment.attempt_id)}&reconcile=${reconcile ? "1" : "0"}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudo comprobar el pago.");
      if (currentAttempt.current !== expectedId) return;
      const attempt = json.attempt || {};
      setPayment((current) => current ? {
        ...current,
        status: String(attempt.status || current.status),
        remote_status: attempt.remote_status || null,
        last_error: attempt.last_error || null,
        whatsapp: attempt.whatsapp || current.whatsapp,
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
      refreshBusy.current = false;
      if (!silent) setLoading(false);
    }
  }

  refreshRef.current = refreshStatus;
  useEffect(() => {
    if (!open || !payment?.attempt_id) return;
    const refresh = () => { if (document.visibilityState === "visible") void refreshRef.current(true, true); };
    const client = supabaseBrowser();
    const channel = client.channel(`crm-payment:${payment.attempt_id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "cliente_payment_attempts", filter: `id=eq.${payment.attempt_id}` }, () => void refreshRef.current(true, false))
      .subscribe(status => { if (status === "SUBSCRIBED") refresh(); });
    refresh();
    // Safety recovery for a missed webhook or disconnected realtime, only in a visible tab.
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer); void client.removeChannel(channel);
      window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [open, payment?.attempt_id]);

  async function sendWhatsApp(attemptId: string) {
    setSending(true);
    try {
      const token = await getTokenRef.current();
      const response = await fetch("/api/crm/pagos/mollie", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "send_whatsapp", attempt_id: attemptId }) });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error("No se pudo confirmar el envío. Comprueba su estado antes de reenviar.");
      setPayment(current => current?.attempt_id === attemptId ? { ...current, whatsapp: json.whatsapp } : current);
    } catch (error: any) { setMessage(error.message); }
    finally { setSending(false); }
  }

  async function createPayment(clickedPack?: Pack) {
    if (createBusy.current) return;
    const chosen = clickedPack || selectedPack;
    const originalClient = cliente?.id;
    if (!cliente?.id) return;
    if (mode === "pack" && !chosen) {
      setMessage("Selecciona un pack.");
      return;
    }
    if (mode === "manual" && (!Number.isFinite(requestedAmount) || requestedAmount <= 0)) {
      setMessage("Introduce un importe manual válido.");
      return;
    }

    createBusy.current = true;
    try {
      setLoading(true);
      setMessage("Generando enlace…");
      const token = await getToken();
      if (!token) return;
      const operationKey = `${paymentStorageKey}:operation:${mode === "pack" ? chosen?.id : requestedAmount}`;
      let requestId = operationIds.current[operationKey];
      try { requestId = window.sessionStorage.getItem(operationKey) || requestId; } catch {}
      if (!requestId) requestId = crypto.randomUUID();
      operationIds.current[operationKey] = requestId;
      try { window.sessionStorage.setItem(operationKey, requestId); } catch {}
      const response = await fetch("/api/crm/pagos/mollie", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: requestId,
          cliente_id: cliente.id,
          pack_id: mode === "pack" ? chosen?.id : "crm_manual_amount",
          manual_amount: mode === "manual" ? requestedAmount : undefined,
          notes,
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok || !json?.url || !json?.attempt_id) {
        throw new Error(json?.error || "No se pudo generar el cobro Mollie.");
      }
      if (contextRef.current !== originalClient) return;
      setPayment({
        attempt_id: String(json.attempt_id),
        payment_id: json.payment_id || null,
        url: String(json.url),
        amount: Number(json.amount || requestedAmount),
        currency: String(json.currency || "EUR"),
        status: json.status || "pending",
        remote_status: json.remote_status,
        whatsapp: json.whatsapp,
        pack: json.pack || null,
        manual: Boolean(json.manual),
      });
      setMessage("✅ Enlace Mollie generado. Ahora puedes abrir WhatsApp Web o copiar el enlace.");
    } catch (error: any) {
      setMessage(`❌ ${error?.message || "No se pudo generar el cobro Mollie."}`);
    } finally {
      createBusy.current = false;
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
      `Hola ${whatsappNombre} ✨`,
      "",
      `Aquí tienes tu enlace de pago seguro de *Tarot Celestial* por *${money(payment.amount)}* 💳`,
      "",
      `🔐 ${payment.url}`,
      "",
      "En cuanto completes el pago, lo veremos reflejado automáticamente.",
      "",
      "Gracias por confiar en nosotros 💜",
      "*Tarot Celestial* 🔮",
    ].join("\n");
    const url = `https://web.whatsapp.com/send?phone=${encodeURIComponent(whatsappPhone)}&text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  if (!open || !cliente || typeof document === "undefined") return null;

  return createPortal(
    <div className={styles.backdrop} onMouseDown={(event) => event.target === event.currentTarget && !loading && !sending && onClose()}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Cobrador Mollie">
        <button className={styles.close} type="button" onClick={onClose} disabled={loading || sending} aria-label="Cerrar"><X /></button>

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
                  <button key={pack.id} type="button" className={styles.pack} data-selected={packId === pack.id} disabled={loading} onClick={() => { setPackId(pack.id); void createPayment(pack); }}>
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
                    : ["review", "processing"].includes(visualPaymentState) ? "MOLLIE · DINERO RECIBIDO" : "MOLLIE · COBRO EN CURSO"}
              </span>

              <strong className={styles.paymentStateTitle}>
                {visualPaymentState === "success"
                  ? "PAGO REALIZADO CORRECTAMENTE"
                  : visualPaymentState === "rejected"
                    ? (payment.remote_status === "expired" ? "PAGO CADUCADO" : ["canceled", "cancelled"].includes(payment.remote_status || "") ? "PAGO CANCELADO" : "PAGO FALLIDO")
                    : visualPaymentState === "review" ? "PAGO RECIBIDO · PROCESAMIENTO PENDIENTE"
                    : visualPaymentState === "processing" ? "PAGO CONFIRMADO · PROCESANDO COMPRA"
                    : "ESPERANDO PAGO…"}
              </strong>

              <p className={styles.paymentStateText}>
                {visualPaymentState === "success"
                  ? `Mollie ha confirmado correctamente el pago de ${money(payment.amount)}.`
                  : visualPaymentState === "rejected"
                    ? `El pago de ${money(payment.amount)} no ha podido completarse.`
                    : ["review", "processing"].includes(visualPaymentState) ? "El dinero ya se ha recibido. No solicites otro pago. Estamos comprobando el registro y los beneficios."
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
              <button className={styles.whatsapp} type="button" onClick={openWhatsApp} disabled={!whatsappPhone || visualPaymentState !== "waiting"}><MessageCircle /> Envío manual · Abrir WhatsApp</button>
              <button type="button" disabled={visualPaymentState !== "waiting"} onClick={() => void copyLink()}><Copy /> Copiar enlace</button>
              {visualPaymentState === "waiting" && <a href={payment.url} target="_blank" rel="noreferrer"><ExternalLink /> Abrir pago</a>}
              <button type="button" onClick={() => void refreshStatus()} disabled={loading}><RefreshCw className={loading ? styles.spinIcon : ""} /> Comprobar</button>
            </div>

            <p role="status" className={styles.help}>
              {sending ? "Enviando por WhatsApp…" : payment.whatsapp?.status === "delivered" || payment.whatsapp?.status === "read" ? "WhatsApp · Entregado" : ["accepted", "sent", "queued"].includes(payment.whatsapp?.status || "") ? "WhatsApp · Aceptado por el proveedor; entrega pendiente" : payment.whatsapp?.status === "unknown" || payment.whatsapp?.status === "sending" ? "WhatsApp · Envío pendiente de confirmar. No se reenviará automáticamente." : "WhatsApp · Envío automático no realizado. Puedes utilizar el envío manual."}

            </p>
            {payment.whatsapp?.status === "failed" && visualPaymentState === "waiting" && <button className={styles.generate} disabled={sending} onClick={() => void sendWhatsApp(payment.attempt_id)}>Reintentar WhatsApp con el mismo enlace</button>}
            {["success", "rejected"].includes(visualPaymentState) && <button className={styles.generate} onClick={() => { operationIds.current = {}; try { Object.keys(sessionStorage).filter(k => k.startsWith(`${paymentStorageKey}:operation:`)).forEach(k => sessionStorage.removeItem(k)); sessionStorage.removeItem(paymentStorageKey); } catch {} notifiedPaid.current = false; setPayment(null); }}>Nuevo cobro</button>}
            <p className={styles.help}>El envío manual por WhatsApp Web abrirá la conversación con el mensaje y el enlace ya preparados. La central solo tiene que pulsar <b>Enviar</b>. El servidor verifica el pago en Mollie y registra la compra automáticamente.</p>
          </div>
        )}

        {message ? <div className={styles.message}>{message}</div> : null}
      </section>
    </div>,
    document.body,
  );
}
