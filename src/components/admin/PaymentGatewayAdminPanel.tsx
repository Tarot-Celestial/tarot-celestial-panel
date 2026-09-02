"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, Landmark, ShieldCheck } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();
type Provider = "stripe" | "redsys";

export default function PaymentGatewayAdminPanel() {
  const [provider, setProvider] = useState<Provider>("stripe");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
      const res = await fetch("/api/admin/payment-settings", {
        headers,
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) throw new Error(json?.error || "No se pudo cargar la pasarela");
      setProvider(json.provider === "redsys" ? "redsys" : "stripe");
    } catch (error: any) {
      setMessage(error?.message || "No se pudo cargar la configuración");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(next: Provider) {
    try {
      setSaving(true);
      setMessage("");
      const headers = await authHeaders();
      const res = await fetch("/api/admin/payment-settings", {
        method: "PUT",
        headers,
        body: JSON.stringify({ provider: next }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) throw new Error(json?.error || "No se pudo guardar la pasarela");
      setProvider(next);
      setMessage(
        `✅ ${next === "redsys" ? "Redsys" : "Stripe"} queda activa para las nuevas compras de minutos.`,
      );
    } catch (error: any) {
      setMessage(error?.message || "No se pudo guardar la configuración");
    } finally {
      setSaving(false);
    }
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
          <h2 style={{ margin: "5px 0 4px" }}>Stripe / Redsys</h2>
          <p style={{ margin: 0, opacity: .7, fontSize: 13 }}>
            El cambio afecta únicamente a las nuevas compras de minutos del panel cliente.
          </p>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontWeight: 800 }}>
          <ShieldCheck size={16} /> Activa: {provider === "redsys" ? "Redsys" : "Stripe"}
        </span>
      </div>

      {message ? (
        <div style={{ padding: 11, borderRadius: 12, background: "rgba(255,255,255,.045)" }}>
          {message}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
        <button
          type="button"
          disabled={loading || saving}
          onClick={() => void save("stripe")}
          style={{
            minHeight: 110,
            padding: 16,
            textAlign: "left",
            borderRadius: 16,
            border: provider === "stripe" ? "1px solid rgba(215,181,109,.5)" : "1px solid rgba(255,255,255,.1)",
            background: provider === "stripe" ? "rgba(215,181,109,.11)" : "rgba(255,255,255,.035)",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          <CreditCard size={22} />
          <strong style={{ display: "block", marginTop: 10 }}>Stripe {provider === "stripe" ? "· ACTIVA" : ""}</strong>
          <small style={{ display: "block", marginTop: 5, opacity: .65 }}>Cobro actual en USD.</small>
        </button>

        <button
          type="button"
          disabled={loading || saving}
          onClick={() => void save("redsys")}
          style={{
            minHeight: 110,
            padding: 16,
            textAlign: "left",
            borderRadius: 16,
            border: provider === "redsys" ? "1px solid rgba(215,181,109,.5)" : "1px solid rgba(255,255,255,.1)",
            background: provider === "redsys" ? "rgba(215,181,109,.11)" : "rgba(255,255,255,.035)",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          <Landmark size={22} />
          <strong style={{ display: "block", marginTop: 10 }}>Redsys {provider === "redsys" ? "· ACTIVA" : ""}</strong>
          <small style={{ display: "block", marginTop: 5, opacity: .65 }}>TPV Virtual por redirección · terminal EUR.</small>
        </button>
      </div>
    </section>
  );
}
