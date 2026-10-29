"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, ShieldCheck } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

type CustomerPayPalDiagnosis = {
  environment: string; active_for_new_purchases: boolean; oauth_verified: boolean;
  merchant_configured: boolean; checks_passed: boolean; message: string;
  webhook: { configured: boolean; accessible: boolean; id_matches: boolean; url_matches: boolean; missing_events: string[] };
};

export default function PaymentGatewayAdminPanel() {
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [checkingPayPal, setCheckingPayPal] = useState(false);
  const [paypalDiagnosis, setPayPalDiagnosis] = useState<CustomerPayPalDiagnosis | null>(null);
  const [paypalError, setPayPalError] = useState("");

  const authHeaders = useCallback(async () => {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Sesión de administrador no válida");
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const headers = await authHeaders();
      const res = await fetch("/api/admin/payment-settings", { headers, cache: "no-store" });
      const json = await res.json().catch(() => null);
      setEnabled(json?.web_payments_enabled === true);
      if (!json?.ok) throw new Error(json?.error || "No se pudo cargar la pasarela");
    } catch (error: any) {
      setMessage(error?.message || "No se pudo cargar la configuración");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load]);

  async function toggle() {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/admin/payment-settings", { method: "PUT", headers: await authHeaders(), body: JSON.stringify({ provider: "mollie", web_payments_enabled: !enabled }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "No se pudo guardar.");
      setEnabled(data.web_payments_enabled === true);
      setMessage(data.web_payments_enabled ? "Pagos web habilitados." : "Mantenimiento activado. Las compras por teléfono siguen disponibles.");
    } catch (error: any) { setMessage(error.message); }
    finally { setSaving(false); }
  }

  async function checkCustomerPayPal() {
    if (checkingPayPal) return;
    setCheckingPayPal(true); setPayPalError(""); setPayPalDiagnosis(null);
    try {
      const response = await fetch("/api/admin/payment-settings", { method: "POST", cache: "no-store",
        headers: await authHeaders(), body: JSON.stringify({ action: "diagnose_paypal_customer" }) });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error || "No se pudo comprobar PayPal cliente.");
      setPayPalDiagnosis(data);
    } catch (error) { setPayPalError(error instanceof Error ? error.message : "No se pudo comprobar PayPal cliente."); }
    finally { setCheckingPayPal(false); }
  }

  return (
    <section
      style={{
        display: "grid",
        gap: 14,
        padding: 18,
        marginBottom: 18,
        border: "1px solid rgba(215,181,109,.24)",
        borderRadius: 20,
        background: "rgba(215,181,109,.055)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".14em", color: "#d7b56d" }}>
            PASARELA DE PAGOS WEB
          </div>
          <h2 style={{ margin: "5px 0 4px" }}>Pagos del panel cliente</h2>
          <p style={{ margin: 0, opacity: .7, fontSize: 13 }}>
            Este control permite habilitar las compras online o ponerlas temporalmente en mantenimiento.
          </p>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontWeight: 800 }}>
          <ShieldCheck size={16} /> {enabled ? "Pagos web habilitados" : "Pagos web en mantenimiento"}
        </span>
      </div>

      <button type="button" className="tc-btn tc-btn-gold" disabled={loading || saving} onClick={toggle}>{saving ? "Guardando…" : enabled ? "Activar mantenimiento" : "Habilitar pagos web"}</button>
      {message ? (
        <div style={{ padding: 11, borderRadius: 12, background: "rgba(255,255,255,.045)" }}>
          {message}
        </div>
      ) : null}

      <div
        style={{
          minHeight: 110,
          padding: 16,
          borderRadius: 16,
          border: "1px solid rgba(215,181,109,.5)",
          background: "rgba(215,181,109,.11)",
          opacity: loading ? .75 : 1,
        }}
      >
        <CreditCard size={22} />
        <strong style={{ display: "block", marginTop: 10 }}>{enabled ? "Compras online disponibles" : "Compras online pausadas · Código CLIENTE"}</strong>
        <small style={{ display: "block", marginTop: 5, opacity: .65 }}>
          El saldo se acredita cuando la pasarela confirma el pago.
        </small>
      </div>

      <div style={{ padding: 16, borderRadius: 16, border: "1px solid rgba(215,181,109,.3)", display: "grid", gap: 10 }}>
        <strong>Conexión PayPal del panel cliente</strong>
        <p style={{ margin: 0, opacity: .8, fontSize: 13 }}>Comprueba el acceso y el webhook de la cuenta nueva sin generar pagos. Puedes hacerlo antes de activarla.</p>
        <button type="button" className="tc-btn" disabled={checkingPayPal} onClick={() => void checkCustomerPayPal()}>
          {checkingPayPal ? "Comprobando PayPal cliente…" : "Comprobar PayPal del panel cliente"}
        </button>
        {paypalError ? <p role="alert" style={{ margin: 0 }}>{paypalError}</p> : null}
        {paypalDiagnosis ? <div role="status" style={{ fontSize: 13, lineHeight: 1.6 }}>
          <strong>{paypalDiagnosis.environment.toUpperCase()} · {paypalDiagnosis.checks_passed ? "Configuración comprobada" : "Configuración pendiente"}</strong>
          <p>{paypalDiagnosis.message}</p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>Autenticación: {paypalDiagnosis.oauth_verified ? "correcta" : "pendiente"}.</li>
            <li>Merchant ID: {paypalDiagnosis.merchant_configured ? "configurado; titularidad pendiente de verificar" : "sin configurar"}.</li>
            <li>Webhook: {paypalDiagnosis.webhook.accessible ? "accesible con esta app" : "no comprobado"}; ID {paypalDiagnosis.webhook.id_matches ? "correcto" : "pendiente"}; URL {paypalDiagnosis.webhook.url_matches ? "correcta" : "pendiente"}.</li>
            <li>Eventos: {paypalDiagnosis.webhook.missing_events.length ? `faltan ${paypalDiagnosis.webhook.missing_events.join(", ")}` : "los cinco requeridos están configurados"}.</li>
            <li>Cuenta seleccionada para compras nuevas: {paypalDiagnosis.active_for_new_purchases ? "cuenta cliente" : "cuenta anterior"}.</li>
          </ul>
        </div> : null}
      </div>
    </section>
  );
}
