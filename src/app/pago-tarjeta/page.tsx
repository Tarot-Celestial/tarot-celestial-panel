"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./payment.module.css";

type Session = { amount: number; currency: string; description: string; status: string; remote_status: string;
  can_pay: boolean; client_id?: string; client_token?: string; environment?: string; last_error?: string | null;
  checkout_kind?: string; attempt_id?: string; can_cancel?: boolean; credited?: boolean;
  purchase_summary?: { packName: string; totalMinutes: number; normalMinutes: number; freeMinutes: number }; receipt?: unknown };
type CardFields = { isEligible: () => boolean; NameField: (options?: object) => Field;
  NumberField: (options?: object) => Field; ExpiryField: (options?: object) => Field; CVVField: (options?: object) => Field;
  submit: (options?: object) => Promise<void>; getState: () => Promise<{ isFormValid: boolean }> };
type Field = { render: (selector: string) => Promise<void>; close?: () => void };
type PayPalSDK = { CardFields: (options: object) => CardFields };

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
    if (!alive.current) return;
    setSession(data);
    const clientPurchase = data.checkout_kind === "client_purchase";
    const completed = data.status === "completed" && (!clientPurchase || data.credited === true);
    setPhase(completed ? "completed" : data.status === "cancelled" ? "cancelled" : "pending");
    setMessage(completed ? clientPurchase ? "Pago realizado. Tus minutos y beneficios ya están añadidos." : "Tu compra está registrada. Gracias por confiar en Tarot Celestial."
      : data.status === "cancelled" ? data.remote_status === "CANCELLED_BY_CLIENT" ? "Has cancelado esta compra. Puedes volver a los precios y elegir otro paquete."
        : data.last_error || "El pago no se ha completado. Consulta con tu banco o con tu central antes de intentarlo de nuevo."
      : clientPurchase && data.status === "completed" ? "El pago está recibido. Estamos confirmando que tus minutos y beneficios estén añadidos. No repitas la compra."
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
    const rendered: Field[] = [];
    ref.current = new URLSearchParams(window.location.search).get("ref") || "";
    async function initialize() {
      if (!/^[0-9a-f-]{36}$/i.test(ref.current)) throw new Error("Este enlace no es válido. Solicita el enlace completo a tu central.");
      const data: Session = await api("session");
      if (stopped) return;
      setSession(data);
      if (!data.can_pay) { showResult(data); return; }
      await new Promise<void>((resolve, reject) => {
        script = document.createElement("script");
        const params = new URLSearchParams({ "client-id": data.client_id!, components: "card-fields", currency: data.currency, intent: "capture" });
        script.src = `https://www.paypal.com/sdk/js?${params}`;
        script.dataset.namespace = "tcCardPayPal";
        script.dataset.clientToken = data.client_token!;
        script.async = true;
        const timer = window.setTimeout(() => reject(new Error("PayPal no ha cargado. Revisa tu conexión y vuelve a abrir el enlace.")), 25000);
        script.onload = () => { clearTimeout(timer); resolve(); };
        script.onerror = () => { clearTimeout(timer); reject(new Error("No se pudo cargar el formulario seguro de PayPal.")); };
        document.head.appendChild(script);
      });
      if (stopped) return;
      const sdk = (window as unknown as { tcCardPayPal?: PayPalSDK }).tcCardPayPal;
      if (!sdk?.CardFields) throw new Error("El formulario de tarjeta no está disponible. Contacta con tu central.");
      const card = sdk.CardFields({
        style: { input: { "font-size": "16px", "font-family": "Arial, sans-serif", color: "#211b30" }, ".invalid": { color: "#a32138" } },
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
    void initialize().catch((error: Error) => { if (!stopped) { setPhase("unavailable"); setMessage(error.message); } });
    return () => { stopped = true; alive.current = false; fields.current = null; rendered.forEach(field => field.close?.()); script?.remove(); };
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
  const showForm = ["loading", "ready", "paying"].includes(phase) || (phase === "cancelling" && Boolean(fields.current));
  return <main className={styles.page}>
    <div className={styles.brand}><span aria-hidden="true">✦</span> TAROT CELESTIAL</div>
    <section className={styles.card} aria-labelledby="payment-title">
      <div className={styles.topline}><span>PAGO SEGURO</span><span>Tarjeta de crédito o débito</span></div>
      <h1 id="payment-title">{phase === "completed" ? "Pago confirmado" : phase === "cancelled" ? session?.remote_status === "CANCELLED_BY_STAFF" ? "Enlace cancelado" : session?.remote_status === "CANCELLED_BY_CLIENT" ? "Compra cancelada" : "Pago no completado" : "Tu consulta, a un paso"}</h1>
      <p className={styles.intro}>{phase === "completed" ? "Gracias por confiar en Tarot Celestial." : "Paga con tu tarjeta. No necesitas una cuenta PayPal."}</p>
      {session && <div className={styles.summary}><span>{session.description}<small>Importe total</small></span><strong>{money}</strong></div>}
      {clientPurchase && session.purchase_summary ? <div className={styles.purchaseSummary} aria-label="Minutos de tu compra"><strong>{session.purchase_summary.totalMinutes} <span>minutos de consulta</span></strong><p>{session.purchase_summary.normalMinutes} minutos normales{session.purchase_summary.freeMinutes > 0 ? ` + ${session.purchase_summary.freeMinutes} minutos gratis` : ""}</p><small>{phase === "completed" ? "Ya están disponibles en tu cuenta." : "Se añadirán cuando el pago quede confirmado."}</small></div> : null}
      {session?.environment === "sandbox" && <p className={styles.notice}>Modo de pruebas · No se cobra dinero real.</p>}
      <form onSubmit={pay} hidden={!showForm} className={styles.form}>
        <fieldset disabled={phase !== "ready"}>
          <label>Nombre del titular<div id="tc-card-name" className={styles.hosted} /></label>
          <label>Número de tarjeta<div id="tc-card-number" className={styles.hosted} /></label>
          <div className={styles.row}>
            <label>Caducidad<div id="tc-card-expiry" className={styles.hosted} /></label>
            <label>Código de seguridad<div id="tc-card-cvv" className={styles.hosted} /></label>
          </div>
          <details open={billingOpen} onToggle={event => setBillingOpen(event.currentTarget.open)} className={styles.billing}>
            <summary>Añadir dirección de facturación</summary>
            <p>Puede ayudar a tu banco a verificar la tarjeta.</p>
            <label>Dirección<input autoComplete="billing address-line1" maxLength={150} required={billingOpen} value={billing.addressLine1} onChange={e => setBilling({ ...billing, addressLine1: e.target.value })} /></label>
            <div className={styles.row}><label>Ciudad<input autoComplete="billing address-level2" required={billingOpen} maxLength={100} value={billing.adminArea2} onChange={e => setBilling({ ...billing, adminArea2: e.target.value })} /></label>
              <label>Código postal<input autoComplete="billing postal-code" required={billingOpen} maxLength={20} value={billing.postalCode} onChange={e => setBilling({ ...billing, postalCode: e.target.value })} /></label></div>
            <label>País (código de 2 letras)<input autoComplete="billing country" required={billingOpen} pattern="[A-Za-z]{2}" maxLength={2} placeholder="ES" value={billing.countryCode} onChange={e => setBilling({ ...billing, countryCode: e.target.value.toUpperCase() })} /></label>
          </details>
          <button className={styles.pay} disabled={phase !== "ready"} type="submit">{phase === "paying" ? "Confirmando con tu banco…" : phase === "loading" ? "Cargando formulario…" : phase === "cancelling" ? "Cancelando…" : `Pagar ${money}`}</button>
        </fieldset>
      </form>
      {message && <p role="status" aria-live="polite" className={styles.notice}>{message}</p>}
      {["pending", "checking"].includes(phase) && <><button className={styles.pay} onClick={() => void check()} disabled={phase === "checking"}>{phase === "checking" ? "Comprobando…" : "Comprobar estado del pago"}</button>
        {phase === "pending" && session?.remote_status === "CREATED" && <button className={styles.secondary} onClick={() => window.location.reload()}>Volver a cargar el formulario</button>}</>}
      {clientPurchase && session.can_cancel === true && ["ready", "pending", "unavailable", "cancelling"].includes(phase) ? <button type="button" className={styles.secondary} disabled={phase === "cancelling"} onClick={() => void cancel()}>{phase === "cancelling" ? "Comprobando cancelación…" : "Cancelar esta compra"}</button> : null}
      {phase === "completed" ? clientPurchase ? <div className={styles.resultLinks}><a className={styles.pay} href="/cliente/dashboard">Ver mis minutos y beneficios</a><a className={styles.back} href="/cliente/precios-ofertas">Volver a precios y ofertas</a></div> : <a className={styles.back} href="/cliente">Volver al panel →</a> : null}
      {clientPurchase && phase === "cancelled" ? <a className={styles.back} href="/cliente/precios-ofertas">Volver a precios y elegir otro paquete →</a> : null}
      <footer className={styles.footer}>Procesado de forma segura por <b>PayPal</b>.<br />Tu banco puede pedirte una confirmación adicional.</footer>
    </section>
    <p className={styles.help}>¿Necesitas ayuda? Responde al WhatsApp de tu central.</p>
  </main>;
}
