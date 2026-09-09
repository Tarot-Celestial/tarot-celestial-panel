"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, ShieldCheck } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

export default function PaymentGatewayAdminPanel() {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

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
      if (!json?.ok) throw new Error(json?.error || "No se pudo cargar la pasarela");
    } catch (error: any) {
      setMessage(error?.message || "No se pudo cargar la configuración");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load]);

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
          <h2 style={{ margin: "5px 0 4px" }}>Mollie</h2>
          <p style={{ margin: 0, opacity: .7, fontSize: 13 }}>
            Mollie es la única pasarela activa para las compras del panel cliente.
          </p>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontWeight: 800 }}>
          <ShieldCheck size={16} /> Activa: Mollie
        </span>
      </div>

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
        <strong style={{ display: "block", marginTop: 10 }}>Mollie · ACTIVA</strong>
        <small style={{ display: "block", marginTop: 5, opacity: .65 }}>
          Checkout seguro alojado por Mollie · confirmación por webhook antes de acreditar saldo.
        </small>
      </div>
    </section>
  );
}
