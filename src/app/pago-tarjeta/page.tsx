"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./payment.module.css";

type Session = { paypal_account?: string; recipient_label?: string; amount: number; currency: string; description: string; status: string; remote_status: string;
  can_pay: boolean; client_id?: string; client_token?: string; environment?: string; last_error?: string | null;
  checkout_kind?: string; attempt_id?: string; can_cancel?: boolean; credited?: boolean;
  purchase_kind?: 'oracle' | 'minutes';
  purchase_summary?: { packName: string; purchaseKind?: 'oracle' | 'minutes'; oracleCredits?: number; oracleQuestions?: number; totalMinutes: number; normalMinutes: number; freeMinutes: number }; receipt?: unknown };
type CardFields = { isEligible: () => boolean; NameField: (options?: object) => Field;
  NumberField: (options?: object) => Field; ExpiryField: (options?: object) => Field; CVVField: (options?: object) => Field;
  submit: (options?: object) => Promise<void>; getState: () => Promise<{ isFormValid: boolean }> };
type Field = { render: (selector: string) => Promise<void>; close?: () => void };
type PayPalSDK = { CardFields: (options: object) => CardFields };
const isOraclePurchase = (session: Session | null) => session?.purchase_summary?.purchaseKind === 'oracle' || session?.purchase_kind === 'oracle';

export default function CardPayment() {
  const [session, setSession] = useState<Session | null>(null);
  const [phase, setPhase] = useState("loading");
  const [message, setMessage] = useState("Preparando tu pago seguro…");
  const [billingOpen, setBillingOpen] = useState(false);
  const [billing, setBilling] = useState({ addressLine1: "", adminArea2: "", postalCode: "", countryCode: "ES" });
  const fields = useRef<CardFields | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const ref = useRef("");
  const receiptSignalled = useRef(false);

  async function api(action: string): Promise<any> {
    const response = await fetch("/api/paypal-crm/card", { method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: ref.current, action }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "No se pudo consultar el pago. Contacta con tu central.");
    return data;
  }
  function showResult(data: Session) {
    if (["CAPTURE_REFUNDED", "CAPTURE_PARTIALLY_REFUNDED"].includes(data.remote_status)) { setSession(data); setPhase("refunded"); setMessage(data.remote_status === "CAPTURE_PARTIALLY_REFUNDED" ? "Este pago tiene un reembolso parcial. Contacta con tu central para conocer su detalle." : "Este pago ha sido reembolsado. Contacta con tu central si necesitas ayuda."); return; }
    if (!alive.current) return;
    setSession(data);
    const clientPurchase = data.checkout_kind === "client_purchase";
    const completed = data.status === "completed" && (!clientPurchase || data.credited === true);
    setPhase(completed ? "completed" : data.status === "cancelled" ? "cancelled" : "pending");
    setMessage(completed ? clientPurchase ? isOraclePurchase(data) ? "Pago realizado. Tu compra del Oráculo ya está disponible." : "Pago realizado. Tus minutos y beneficios ya están añadidos." : "Cobro confirmado. Central registra la compra por separado desde «Registrar llamada»."
      : data.status === "cancelled" ? data.remote_status === "CANCELLED_BY_CLIENT" ? "Has cancelado esta compra. Puedes volver a los precios y elegir otro paquete."
        : data.last_error || "El pago no se ha completado. Consulta con tu banco o con tu central antes de intentarlo de nuevo."
      : clientPurchase && data.status === "completed" ? isOraclePurchase(data) ? "El pago está recibido. Estamos confirmando que tu compra del Oráculo esté disponible. No repitas la compra." : "El pago está recibido. Estamos confirmando que tus minutos y beneficios estén añadidos. No repitas la compra."
      : data.last_error || "Estamos comprobando el resultado. No repitas el pago; consulta su estado en unos instantes.");
    if (clientPurchase && (completed || data.status === "cancelled")) {
      clearFinishedAttempt(data.attempt_id);
      if (completed && !receiptSignalled.current) {
        receiptSignalled.current = true;
        window.dispatchEvent(new Event("tc-client-balances-changed"));
      }
    }
  }

  function clearFinishedAttempt(attemptId?: string) {
    // Clear only the attempt confirmed by this checkout. Unknown outcomes keep
    // their idempotency key, so a reload can never silently start another order.
    try {
      const keys: string[] = [];
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key?.startsWith("tc-client-purchase-attempt:v1:")) keys.push(key);
      }
      for (const key of keys) {
        try {
          const stored = JSON.parse(localStorage.getItem(key) || "null");
          const sameAttempt = attemptId && stored?.attemptId === attemptId;
          const sameReference = stored?.url && new URL(stored.url, window.location.origin).searchParams.get("ref") === ref.current;
          if (sameAttempt || sameReference) localStorage.removeItem(key);
        } catch { /* An unrelated damaged entry must not block this receipt. */ }
      }
    } catch { /* Payment state remains authoritative if browser storage is unavailable. */ }
  }
  async function paymentError(fallback = "No se pudo completar el proceso. Comprueba el estado antes de volver a introducir tu tarjeta.") {
    try {
      const data: Session = await api("status");
      if (!alive.current) return;
      showResult(data);
      if (data.status !== "completed" && data.status !== "cancelled") setMessage(data.last_error || fallback);
    } catch { if (alive.current) { setPhase("pending"); setMessage(fallback); } }
  }
  async function check() {
    if (busy.current) return;
    busy.current = true; setPhase("checking");
    try { showResult(await api("capture")); }
    catch (error: any) { if (alive.current) { setPhase("pending"); setMessage(error.message); } }
    finally { busy.current = false; }
  }

  async function cancel() {
    if (busy.current || session?.checkout_kind !== "client_purchase" || session.can_cancel !== true || !["ready", "pending", "unavailable"].includes(phase)) return;
    busy.current = true; setPhase("cancelling"); setMessage("Comprobando si podemos cancelar esta compra…");
    try { showResult(await api("cancel")); }
    catch (error: any) { if (alive.current) await paymentError(error.message || "No se ha confirmado la cancelación. Comprueba el estado antes de elegir otra compra."); }
    finally { busy.current = false; }
  }

  useEffect(() => {
    alive.current = true;
    let stopped = false, script: HTMLScriptElement | null = null;
    // A removed script can still finish loading. Give every effect its own SDK
    // global so an earlier account/token can never replace the current SDK.
    const sdkNamespace = `tcCardPayPal_${window.crypto.randomUUID().replace(/-/g, "")}`;
    const sdkWindow = window as unknown as Record<string, PayPalSDK | undefined>;
    let sdkDiscarded = false, finishSdkWait: (() => void) | undefined;
    function discardSdk() {
      sdkDiscarded = true;
      script?.remove();
      delete sdkWindow[sdkNamespace];
    }
    const rendered: Field[] = [];
    ref.current = new URLSearchParams(window.location.search).get("ref") || "";
    async function initialize() {
      if (!/^[0-9a-f-]{36}$/i.test(ref.current)) throw new Error("Este enlace no es válido. Solicita el enlace completo a tu central.");
      const data: Session = await api("session");
      if (stopped) return;
      setSession(data);
      if (!data.can_pay) { showResult(data); return; }
      if (!data.client_id || !data.client_token) throw new Error("El formulario de tarjeta no está disponible. Contacta con tu central.");
      await new Promise<void>((resolve, reject) => {
        script = document.createElement("script");
        const params = new URLSearchParams({ "client-id": data.client_id!, components: "card-fields", currency: data.currency, intent: "capture" });
        script.src = `https://www.paypal.com/sdk/js?${params}`;
        script.dataset.namespace = sdkNamespace;
        script.dataset.clientToken = data.client_token!;
        script.async = true;
        const timer = window.setTimeout(() => {
          discardSdk();
          reject(new Error("PayPal no ha cargado. Revisa tu conexión y vuelve a abrir el enlace."));
        }, 25000);
        finishSdkWait = () => { clearTimeout(timer); resolve(); };
        script.onload = () => {
          if (stopped || sdkDiscarded) delete sdkWindow[sdkNamespace];
          finishSdkWait?.();
        };
        script.onerror = () => {
          clearTimeout(timer); discardSdk();
          reject(new Error("No se pudo cargar el formulario seguro de PayPal."));
        };
        document.head.appendChild(script);
      });
      if (stopped) return;
      const sdk = sdkWindow[sdkNamespace];
      if (!sdk?.CardFields) throw new Error("El formulario de tarjeta no está disponible. Contacta con tu central.");
      const card = sdk.CardFields({
        style: { input: { "font-size": "16px", "font-family": "Arial, sans-serif", color: "#20242b", border: "none", "border-radius": "0", padding: "0 12px", height: "50px", "line-height": "24px", background: "#ffffff" }, ".invalid": { color: "#b42335" } },
        createOrder: async () => {
          const result = await api("order");
          if (!result.order_id) { showResult(result); throw new Error("El pago ya está en proceso."); }
          return result.order_id;
        },
        onApprove: async () => { try { showResult(await api("capture")); }
          catch (error: any) { if (!stopped) await paymentError(error.message); } },
        onError: async () => { if (!stopped) await paymentError(); },
      });
      if (!card.isEligible()) throw new Error("El pago directo con tarjeta no está disponible en este momento. Contacta con tu central; no necesitas crear una cuenta PayPal.");
      fields.current = card;
      const entries: [Field, string][] = [[card.NameField({ placeholder: "Como aparece en tu tarjeta" }), "#tc-card-name"],
        [card.NumberField({ placeholder: "Número de tarjeta" }), "#tc-card-number"],
        [card.ExpiryField({ placeholder: "MM/AA" }), "#tc-card-expiry"], [card.CVVField({ placeholder: "CVV" }), "#tc-card-cvv"]];
      for (const [field, selector] of entries) { rendered.push(field); await field.render(selector); if (stopped) { field.close?.(); return; } }
      setMessage(""); setPhase("ready");
    }
    void initialize().catch((error: Error) => { discardSdk(); if (!stopped) { setPhase("unavailable"); setMessage(error.message); } });
    return () => { stopped = true; alive.current = false; fields.current = null; rendered.forEach(field => field.close?.()); discardSdk(); finishSdkWait?.(); };
  }, []);

  async function pay(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current || !fields.current || phase !== "ready") return;
    busy.current = true;
    try {
      const state = await fields.current.getState();
      if (!state.isFormValid) { setMessage("Revisa los datos de la tarjeta antes de continuar."); return; }
      setPhase("paying"); setMessage("Confirma el pago en tu banco si te lo solicita. Mantén esta página abierta.");
      await fields.current.submit(billingOpen ? { billingAddress: billing } : undefined);
    } catch {
      if (alive.current) await paymentError();
    } finally { busy.current = false; }
  }
  const money = session ? new Intl.NumberFormat("es-ES", { style: "currency", currency: session.currency }).format(session.amount) : "";
  const clientPurchase = session?.checkout_kind === "client_purchase";
  const oraclePurchase = clientPurchase && isOraclePurchase(session);
  const oracleCredits = Number(session?.purchase_summary?.oracleCredits || 0);
  const oracleQuestions = Number(session?.purchase_summary?.oracleQuestions || 0);
  const showForm = ["loading", "ready", "paying"].includes(phase) || (phase === "cancelling" && Boolean(fields.current));
  const inProgress = ["paying", "checking", "cancelling"].includes(phase);
  const title = phase === "completed" ? "Pago confirmado"
    : phase === "refunded" ? "Detalle del reembolso"
    : phase === "cancelled" ? session?.remote_status === "CANCELLED_BY_STAFF" ? "Enlace cancelado" : session?.remote_status === "CANCELLED_BY_CLIENT" ? "Compra cancelada" : "Pago no completado"
    : ["pending", "checking"].includes(phase) ? "Estado de tu pago"
    : phase === "unavailable" ? "Revisa tu enlace de pago" : "Pagar con tarjeta";
  return <main className={styles.page}>
    <div className={styles.checkout}>
      <section className={styles.order} aria-labelledby="order-title">
        <div className={styles.orderTop}>
          {!inProgress && <a className={styles.back} href={clientPurchase ? "/cliente/precios-ofertas" : "/cliente"}><span aria-hidden="true">←</span> Volver al panel</a>}
          <span className={styles.secure}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg> Pago con tarjeta</span>
        </div>
        <h2 id="order-title" className={styles.eyebrow}>Resumen de compra</h2>
        {session ? <>
          <h3 className={styles.productTitle}>{session.purchase_summary?.packName || session.description}</h3>
          <p className={styles.amount}>{money}</p>
          <p className={styles.paymentType}>Pago único <span aria-hidden="true">·</span> {session.currency}</p>
          <div className={styles.summary}><span>Importe total</span><strong>{money}</strong></div>
          {clientPurchase && session.purchase_summary ? oraclePurchase ? <div className={styles.purchaseSummary} aria-label="Oráculo de tu compra">
            <p className={styles.summaryLabel}>Tu compra incluye</p>
            {oracleCredits > 0 ? <p><strong>{oracleCredits}</strong> {oracleCredits === 1 ? "tirada del Oráculo" : "tiradas del Oráculo"}</p> : null}
            {oracleQuestions > 0 ? <p><strong>{oracleQuestions}</strong> {oracleQuestions === 1 ? "pregunta adicional" : "preguntas adicionales"}</p> : null}
            <p className={styles.fulfillment}>{phase === "completed" ? "Ya está disponible en tu Oráculo." : phase === "cancelled" || phase === "refunded" ? "Consulta el estado de este pago para más información." : "Se añadirá a tu Oráculo cuando el pago quede confirmado."}</p>
          </div> : <div className={styles.purchaseSummary} aria-label="Minutos de tu compra">
            <p className={styles.summaryLabel}>Tu compra incluye</p>
            <p><strong>{session.purchase_summary.totalMinutes}</strong> minutos de consulta</p>
            <p className={styles.minuteDetail}>{session.purchase_summary.normalMinutes} minutos normales{session.purchase_summary.freeMinutes > 0 ? ` + ${session.purchase_summary.freeMinutes} minutos gratis` : ""}</p>
            <p className={styles.fulfillment}>{phase === "completed" ? "Ya están disponibles en tu cuenta." : phase === "cancelled" || phase === "refunded" ? "Consulta el estado de este pago para más información." : "Se añadirán cuando el pago quede confirmado."}</p>
          </div> : <p className={styles.fulfillment}>Conserva la confirmación de tu pago. Tu central te ayudará con los detalles de la consulta.</p>}
        </> : <p className={styles.emptySummary}>{phase === "loading" ? "Cargando el resumen de tu compra…" : "Abre el enlace de tu compra para consultar el importe y sus detalles."}</p>}
        <div className={styles.orderHelp}>
          <p>¿Necesitas ayuda con tu compra?</p>
          <span>Responde al WhatsApp de tu central.</span>
        </div>
      </section>
      <section className={styles.card} aria-labelledby="payment-title">
        {phase === "completed" && <div className={styles.successIcon} aria-hidden="true">✓</div>}
        <h1 id="payment-title">{title}</h1>
        <p className={styles.intro}>{phase === "completed" ? "Gracias. Aquí tienes la confirmación de tu pago." : showForm ? "Introduce los datos de tu tarjeta. No necesitas una cuenta PayPal." : "Consulta la información de tu operación a continuación."}</p>
        {session?.environment === "sandbox" && <p className={styles.notice}>Modo de pruebas · No se cobra dinero real.</p>}
        <form onSubmit={pay} hidden={!showForm} className={styles.form}>
          <fieldset disabled={phase !== "ready"}>
            <div className={styles.paymentMethod}>
              <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M3 10h18M6 15h4" /></svg>Tarjeta de crédito o débito</span>
              <div className={styles.cardBrands} aria-label="Visa y Mastercard">
                <span className={styles.visa} aria-label="Visa">VISA</span>
                <svg className={styles.mastercard} viewBox="0 0 40 26" role="img" aria-label="Mastercard"><rect x=".5" y=".5" width="39" height="25" rx="4" fill="white" stroke="#e0e3e8" /><circle cx="16" cy="13" r="8" fill="#eb001b" /><circle cx="25" cy="13" r="8" fill="#f79e1b" /><path d="M20.5 6.39a8 8 0 0 1 0 13.22 8 8 0 0 1 0-13.22Z" fill="#ff5f00" /></svg>
              </div>
            </div>
            <div className={styles.fieldGroup}>
              <label>Número de tarjeta<div id="tc-card-number" className={styles.hosted} /></label>
              <div className={styles.row}>
                <label>Caducidad<div id="tc-card-expiry" className={styles.hosted} /></label>
                <label>Código de seguridad<div id="tc-card-cvv" className={styles.hosted} /></label>
              </div>
            </div>
            <label>Nombre del titular<div id="tc-card-name" className={styles.hosted} /></label>
            <details open={billingOpen} onToggle={event => setBillingOpen(event.currentTarget.open)} className={styles.billing}>
              <summary>Añadir dirección de facturación</summary>
              <p>Puede ayudar a tu banco a verificar la tarjeta.</p>
              <label>Dirección<input autoComplete="billing address-line1" maxLength={150} required={billingOpen} value={billing.addressLine1} onChange={e => setBilling({ ...billing, addressLine1: e.target.value })} /></label>
              <div className={styles.row}><label>Ciudad<input autoComplete="billing address-level2" required={billingOpen} maxLength={100} value={billing.adminArea2} onChange={e => setBilling({ ...billing, adminArea2: e.target.value })} /></label>
                <label>Código postal<input autoComplete="billing postal-code" required={billingOpen} maxLength={20} value={billing.postalCode} onChange={e => setBilling({ ...billing, postalCode: e.target.value })} /></label></div>
              <label>País (código de 2 letras)<input autoComplete="billing country" required={billingOpen} pattern="[A-Za-z]{2}" maxLength={2} placeholder="ES" value={billing.countryCode} onChange={e => setBilling({ ...billing, countryCode: e.target.value.toUpperCase() })} /></label>
            </details>
            <button className={styles.pay} disabled={phase !== "ready"} type="submit">{phase === "paying" ? "Confirmando con tu banco…" : phase === "loading" ? "Cargando formulario…" : phase === "cancelling" ? "Cancelando…" : `Pagar ${money}`}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg></button>
          </fieldset>
        </form>
        {message && <p role="status" aria-live="polite" className={`${styles.notice} ${phase === "completed" ? styles.success : ""}`}>{message}</p>}
        {["pending", "checking"].includes(phase) && <><button className={styles.pay} onClick={() => void check()} disabled={phase === "checking"}>{phase === "checking" ? "Comprobando…" : "Comprobar estado del pago"}</button>
          {phase === "pending" && session?.remote_status === "CREATED" && <button className={styles.secondary} onClick={() => window.location.reload()}>Volver a cargar el formulario</button>}</>}
        {clientPurchase && session.can_cancel === true && ["ready", "pending", "unavailable", "cancelling"].includes(phase) ? <button type="button" className={styles.secondary} disabled={phase === "cancelling"} onClick={() => void cancel()}>{phase === "cancelling" ? "Comprobando cancelación…" : "Cancelar esta compra"}</button> : null}
        {phase === "completed" ? clientPurchase ? <div className={styles.resultLinks}><a className={styles.pay} href={oraclePurchase ? "/cliente/oraculo" : "/cliente/dashboard"}>{oraclePurchase ? "Volver a mi Oráculo" : "Ver mis minutos y beneficios"}</a><a className={styles.back} href="/cliente/precios-ofertas">Volver a precios y ofertas</a></div> : <a className={styles.back} href="/cliente">Volver al panel →</a> : null}
        {clientPurchase && phase === "cancelled" ? <a className={styles.back} href="/cliente/precios-ofertas">Volver a precios y elegir otro paquete →</a> : null}
        <footer className={styles.footer}><p>Pago procesado por <strong>PayPal</strong></p><span>Tu banco puede pedirte una confirmación adicional.</span></footer>
      </section>
    </div>
    <nav className={styles.legal} aria-label="Información legal del pago"><a href="/aviso-legal" target="_blank" rel="noopener noreferrer">Información del comercio</a><a href="/privacidad" target="_blank" rel="noopener noreferrer">Privacidad</a><a href="/terminos" target="_blank" rel="noopener noreferrer">Condiciones</a></nav>
  </main>;
}
