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
  cliente_id: string;
  attempt_id: string;
  payment_id?: string | null;
  payment_link_id?: string | null;
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
  if (remoteStatus === "capture_completed") return error ? "review" : "processing";
  if (
    ["failed", "cancelled", "canceled"].includes(localStatus) ||
    ["failed", "expired", "cancelled", "canceled"].includes(remoteStatus)
  ) return "rejected";

  return "waiting";
}

export default function PayPalCrmPaymentModal({ open, cliente, getToken, onClose, onPaid }: Props) {
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
  const [environment, setEnvironment] = useState("");
  const [initializing, setInitializing] = useState(true);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState("");
  const connectionBusy = useRef(false);
  const cancelBusy = useRef(false);
  const paymentRevision = useRef(0);

  const getTokenRef = useRef(getToken);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const paymentStorageKey = cliente?.id ? `tc:crm:paypal:pending:${cliente.id}` : "";

  async function checkConnection() {
    if (connectionBusy.current) return;
    const expectedClient = contextRef.current;
    connectionBusy.current = true;
    setCheckingConnection(true);
    setConnectionMessage("Comprobando la autenticación con PayPal…");
    try {
      const token = await getTokenRef.current();
      if (!token) throw new Error("Tu sesión ha caducado. Vuelve a entrar.");
      const response = await fetch("/api/crm/pagos/paypal", { method: "POST", cache: "no-store",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "test_connection" }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "No se pudo comprobar la conexión.");
      if (contextRef.current === expectedClient) setConnectionMessage(data.message);
    } catch (error: any) {
      if (contextRef.current === expectedClient) setConnectionMessage(error.message || "No se pudo comprobar la conexión.");
    } finally { connectionBusy.current = false; setCheckingConnection(false); }
  }

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
    const phone = buildInternationalPhone(country, raw.startsWith("00") ? `+${raw.slice(2)}` : raw).replace(/\D/g, "");
    return /^[1-9]\d{7,14}$/.test(phone) ? phone : "";
  }, [cliente?.pais, cliente?.telefono, cliente?.telefono_normalizado]);

  useEffect(() => {
    if (!open || !cliente?.id) return;
    setInitializing(true);
    setPacks([]);
    setMode("pack");
    setManualAmount("");
    setNotes("");
    setMessage("");
    setConnectionMessage("");
    notifiedPaid.current = false;

    let cancelled = false;
    // Restore from the authenticated server, never a previous operator's cached payment.
    setPayment(null);

    void (async () => {
      try {
        const token = await getTokenRef.current();
        if (!token) throw new Error("Inicia sesión para cargar el cobrador.");
        const response = await fetch(`/api/crm/pagos/paypal?cliente_id=${encodeURIComponent(cliente.id)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = await response.json().catch(() => null);
        if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudieron cargar los packs.");
        if (cancelled) return;
        const nextPacks = Array.isArray(json.packs) ? json.packs : [];
        setPacks(nextPacks);
        setEnvironment(json.environment || "");
        if (json.latest) {
          const a = json.latest;
          if (!a.checkout_url && !a.payment_id) {
            const suffix = a.pack_id === "crm_manual_amount" ? a.amount : a.pack_id;
            operationIds.current[`${paymentStorageKey}:operation:${suffix}`] = a.id;
            try { sessionStorage.setItem(`${paymentStorageKey}:operation:${suffix}`, a.id); } catch {}
            setMessage("La generación anterior quedó interrumpida. Reintenta el mismo importe para recuperar ese enlace.");
            if (a.pack_id === "crm_manual_amount") { setMode("manual"); setManualAmount(String(a.amount)); }
          } else setPayment({ cliente_id: cliente.id, attempt_id: a.id, url: a.checkout_url || "", amount: a.amount, currency: a.currency, status: a.status, remote_status: a.remote_status, last_error: a.last_error });
        }
        setPackId(String((json.latest && !json.latest.checkout_url ? json.latest.pack_id : null) || nextPacks.find((pack: Pack) => pack.highlight)?.id || nextPacks[0]?.id || ""));
      } catch (error: any) {
        if (!cancelled) setMessage(error?.message || "No se pudieron cargar los packs.");
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, cliente?.id, paymentStorageKey]);

  async function refreshStatus(silent = false, reconcile = true) {
    if (!payment?.attempt_id || payment.cliente_id !== contextRef.current || refreshBusy.current || cancelBusy.current) return;
    const revision = paymentRevision.current;
    const expectedId = payment.attempt_id;
    refreshBusy.current = true;
    try {
      if (!silent) setLoading(true);
      const token = await getToken();
      if (!token) return;
      const response = await fetch(`/api/crm/pagos/paypal?attempt_id=${encodeURIComponent(payment.attempt_id)}&reconcile=${reconcile ? "1" : "0"}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudo comprobar el pago.");
      if (currentAttempt.current !== expectedId || payment.cliente_id !== contextRef.current || revision !== paymentRevision.current) return;
      const attempt = json.attempt || {};
      setPayment((current) => current ? {
        ...current,
        status: String(attempt.status || current.status),
        remote_status: attempt.remote_status || null,
        last_error: attempt.last_error || null,
        whatsapp: attempt.whatsapp || current.whatsapp,
        payment_id: attempt.payment_id || current.payment_id || null,
        payment_link_id: attempt.payment_link_id || current.payment_link_id || null,
        url: attempt.checkout_url || current.url,
      } : current);

      if (attempt.status === "completed" && !notifiedPaid.current) {
        notifiedPaid.current = true;
        setMessage("✅ Pago confirmado y registrado. Ahora abre «Registrar llamada» y elige este pago en «Pago PayPal ya confirmado».");
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
    // Payment rows are server-only; check while this modal is visible.
    refresh();
    // Safety recovery for a missed webhook or disconnected realtime, only in a visible tab.
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [open, payment?.attempt_id]);

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

    // Open synchronously during the click; delayed window.open is blocked on mobile.
    const chatWindow = whatsappPhone ? window.open("about:blank", "_blank") : null;
    if (chatWindow) { chatWindow.opener = null; chatWindow.document.title = "Preparando WhatsApp…"; chatWindow.document.body.textContent = "Generando tu enlace de pago seguro. Esta ventana abrirá WhatsApp cuando esté listo."; }
    createBusy.current = true;
    try {
      setLoading(true);
      setMessage("Generando enlace…");
      const token = await getToken();
      if (!token) throw new Error("Tu sesión ha caducado.");
      const operationKey = `${paymentStorageKey}:operation:${mode === "pack" ? chosen?.id : requestedAmount}`;
      let requestId = operationIds.current[operationKey];
      try { requestId = window.sessionStorage.getItem(operationKey) || requestId; } catch {}
      if (!requestId) requestId = crypto.randomUUID();
      operationIds.current[operationKey] = requestId;
      try { window.sessionStorage.setItem(operationKey, requestId); } catch {}
      const response = await fetch("/api/crm/pagos/paypal", {
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
        throw new Error(json?.error || "No se pudo generar el cobro PayPal.");
      }
      if (contextRef.current !== originalClient) { chatWindow?.close(); return; }
      setPayment({
        cliente_id: originalClient!,
        attempt_id: String(json.attempt_id),
        payment_id: json.payment_id || null,
        payment_link_id: json.payment_link_id || null,
        url: String(json.url),
        amount: Number(json.amount || requestedAmount),
        currency: String(json.currency || "EUR"),
        status: json.status || "pending",
        remote_status: json.remote_status,
        whatsapp: json.whatsapp,
        pack: json.pack || null,
        manual: Boolean(json.manual),
      });
      if (json.status === "pending" && chatWindow && !chatWindow.closed) {
        chatWindow.location.replace(whatsappUrl(String(json.url), Number(json.amount), json.pack?.nombre));
        setMessage("Enlace creado. WhatsApp está preparado: pulsa Enviar en la conversación.");
      } else {
        chatWindow?.close();
        setMessage(json.status !== "pending" ? "Este cobro ya tiene un resultado. Comprueba su estado antes de continuar." : "Enlace creado. Pulsa Abrir WhatsApp para preparar el mensaje, o copia el enlace.");
      }
    } catch (error: any) {
      chatWindow?.close();
      if (contextRef.current !== originalClient) return;
      setMessage(`❌ ${error?.message || "No se pudo generar el cobro PayPal."}`);
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

  function resetPayment() {
    currentAttempt.current = "";
    operationIds.current = {};
    try {
      Object.keys(sessionStorage).filter(k => k.startsWith(`${paymentStorageKey}:operation:`)).forEach(k => sessionStorage.removeItem(k));
      sessionStorage.removeItem(paymentStorageKey);
    } catch {}
    notifiedPaid.current = false;
    setPayment(null);
  }

  async function cancelPayment(changeTariff: boolean) {
    if (!payment || cancelBusy.current || loading) return;
    cancelBusy.current = true;
    paymentRevision.current++;
    const expectedClient = contextRef.current, expectedId = payment.attempt_id;
    setLoading(true);
    try {
      const token = await getTokenRef.current();
      if (!token) throw new Error("Tu sesión ha caducado.");
      const response = await fetch("/api/crm/pagos/paypal", { method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", attempt_id: expectedId }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "No se pudo cancelar. Comprueba el estado.");
      if (contextRef.current !== expectedClient || currentAttempt.current !== expectedId) return;
      if (changeTariff) resetPayment();
      else setPayment(previous => previous ? { ...previous, status: data.attempt.status, remote_status: data.attempt.remote_status, last_error: data.attempt.last_error } : null);
      setMessage(changeTariff ? "Enlace anterior cancelado. Elige otra tarifa y genera un nuevo enlace." : "Enlace cancelado. Ya no se puede cobrar desde el panel. Esta acción no es un reembolso.");
    } catch (error: any) {
      if (contextRef.current === expectedClient) setMessage(error.message);
    } finally { cancelBusy.current = false; setLoading(false); }
  }

  function openWhatsApp() {
    if (!payment?.url) return;
    if (!whatsappPhone) {
      setMessage("⚠️ La ficha no tiene un teléfono válido para abrir WhatsApp.");
      return;
    }

    window.open(whatsappUrl(payment.url, payment.amount, payment.pack?.nombre), "_blank", "noopener,noreferrer");
  }

  function whatsappUrl(url: string, amount: number, packName?: string) {
    const who = String(cliente?.nombre || "").trim() || nombre;
    const text = `Hola, ${who}. Aquí tienes el enlace de pago de Tarot Celestial${packName ? ` para tu consulta de ${packName}` : ""} por ${money(amount)}: \n${url}\nGracias por confiar en nosotros.`;
    return `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(text)}`;
  }

  if (!open || !cliente || typeof document === "undefined") return null;
  if (payment && payment.cliente_id !== cliente.id) return null;

  return createPortal(
    <div className={styles.backdrop} onMouseDown={(event) => event.target === event.currentTarget && !loading && onClose()}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Cobrador PayPal">
        <button className={styles.close} type="button" onClick={onClose} disabled={loading} aria-label="Cerrar"><X /></button>

        <header className={styles.header}>
          <div className={styles.icon}><CreditCard /></div>
          <div>
            <span className={styles.eyebrow}>COBRADOR SEGURO · PAYPAL</span>
            <h2>Realizar pago</h2>
            <p>{nombre} · {cliente.telefono_normalizado || cliente.telefono || "Sin teléfono"}</p>
          </div>
          <span className={styles.secure}><ShieldCheck /> Seguro</span>
        </header>

        <div className={styles.actions}>
          <button type="button" disabled={checkingConnection || loading} onClick={() => void checkConnection()}>
            <RefreshCw className={checkingConnection ? styles.spinIcon : ""} /> {checkingConnection ? "Comprobando…" : "Comprobar conexión PayPal"}
          </button>
        </div>
        <p className={styles.help}>Comprueba el acceso sin generar un cobro ni abrir WhatsApp.</p>
        {connectionMessage && <p className={styles.message} role="status">{connectionMessage}</p>}
        {environment === "sandbox" && <p className={styles.message}>MODO PRUEBAS · PayPal Sandbox. No se cobra dinero real.</p>}
        {!payment ? (
          <>
            <div className={styles.modeSwitch}>
              <button type="button" data-active={mode === "pack"} onClick={() => setMode("pack")}><Sparkles /> Pack</button>
              <button type="button" data-active={mode === "manual"} onClick={() => setMode("manual")}><Banknote /> Importe manual</button>
            </div>

            {mode === "pack" ? (
              <div className={styles.packGrid}>
                {packs.map((pack) => (
                  <button key={pack.id} type="button" className={styles.pack} data-selected={packId === pack.id} disabled={loading} onClick={() => setPackId(pack.id)}>
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

            <button className={styles.generate} type="button" disabled={loading || initializing || requestedAmount <= 0} onClick={() => void createPayment()}>
              {loading ? <RefreshCw className={styles.spinIcon} /> : <CreditCard />} {loading ? "Generando..." : "Crear pago con tarjeta y abrir WhatsApp"}
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
                  ? "PAYPAL · PAGO CONFIRMADO"
                  : visualPaymentState === "rejected"
                    ? "PAYPAL · COBRO NO COMPLETADO"
                    : ["review", "processing"].includes(visualPaymentState) ? "PAYPAL · DINERO RECIBIDO" : "PAYPAL · COBRO EN CURSO"}
              </span>

              <strong className={styles.paymentStateTitle}>
                {visualPaymentState === "success"
                  ? "PAGO REALIZADO CORRECTAMENTE"
                  : visualPaymentState === "rejected"
                    ? (payment.remote_status === "expired" ? "PAGO CADUCADO" : ["canceled", "cancelled", "CANCELLED_BY_STAFF"].includes(payment.remote_status || "") ? "PAGO CANCELADO" : "PAGO RECHAZADO")
                    : visualPaymentState === "review" ? "PAGO RECIBIDO · PROCESAMIENTO PENDIENTE"
                    : visualPaymentState === "processing" ? "PAGO CONFIRMADO · PROCESANDO COMPRA"
                    : "ESPERANDO PAGO…"}
              </strong>

              <p className={styles.paymentStateText}>
                {visualPaymentState === "success"
                  ? `PayPal ha confirmado correctamente el pago de ${money(payment.amount)}.`
                  : visualPaymentState === "rejected"
                    ? `${payment.last_error || `El pago de ${money(payment.amount)} no ha podido completarse.`}`
                    : ["review", "processing"].includes(visualPaymentState) ? "El dinero ya se ha recibido. No solicites otro pago. Estamos comprobando el registro y los beneficios."
                    : `Esperando la confirmación de PayPal para el cobro de ${money(payment.amount)}.`}
              </p>

              <b className={styles.paymentStateAmount}>{money(payment.amount)}</b>

              {visualPaymentState === "waiting" ? (
                <div className={styles.paymentWaitingDots} aria-hidden="true">
                  <i /><i /><i />
                </div>
              ) : null}
            </div>

            <div className={styles.linkBox}><span>Enlace de pago seguro</span><code>{payment.url}</code></div>

            <div className={styles.actions}>
              <button className={styles.whatsapp} type="button" onClick={openWhatsApp} disabled={!whatsappPhone || visualPaymentState !== "waiting"}><MessageCircle /> Envío manual · Abrir WhatsApp</button>
              <button type="button" disabled={visualPaymentState !== "waiting"} onClick={() => void copyLink()}><Copy /> Copiar enlace</button>
              {visualPaymentState === "waiting" && <a href={payment.url} target="_blank" rel="noreferrer"><ExternalLink /> Abrir pago</a>}
              <button type="button" onClick={() => void refreshStatus()} disabled={loading}><RefreshCw className={loading ? styles.spinIcon : ""} /> Comprobar</button>
              {visualPaymentState === "waiting" && <>
                <button type="button" disabled={loading} onClick={() => void cancelPayment(false)}><X /> Cancelar enlace</button>
                <button type="button" disabled={loading} onClick={() => void cancelPayment(true)}>Cambiar tarifa</button>
              </>}
            </div>

            <p className={styles.help}>Abrir WhatsApp prepara el mensaje. La central debe pulsar Enviar; no se envía automáticamente.</p>
            {["success", "rejected"].includes(visualPaymentState) && <button className={styles.generate} disabled={loading} onClick={() => { resetPayment(); setMessage("Elige el paquete para el nuevo cobro."); }}>Elegir tarifa · Nuevo cobro</button>}
            <p className={styles.help}>El envío por WhatsApp abrirá la conversación con el mensaje y el enlace ya preparados. La central solo tiene que pulsar <b>Enviar</b>. El servidor verifica el pago en PayPal y registra la compra automáticamente.</p>
          </div>
        )}

        {message ? <div className={styles.message}>{message}</div> : null}
      </section>
    </div>,
    document.body,
  );
}
