"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, Landmark, ShieldCheck } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Provider = "stripe" | "redsys";
const sb = supabaseBrowser();

export default function PaymentGatewayAdminPanel() {
  const [provider, setProvider] = useState<Provider>("redsys");
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
      const res = await fetch("/api/admin/payment-settings", { headers, cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!json?.ok) throw new Error(json?.error || "No se pudo cargar la pasarela");
      setProvider(json.provider === "stripe" ? "stripe" : "redsys");
    } catch (error: any) {
      setMessage(error?.message || "No se pudo cargar la configuración");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load]);

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
      setMessage(`✅ ${next === "redsys" ? "Redsys" : "Stripe"} queda como pasarela activa para nuevas compras de minutos.`);
    } catch (error: any) {
      setMessage(error?.message || "No se pudo guardar la configuración");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="tc-stack" style={{ gap: 16 }}>
      <section className="tc-card tc-golden-panel" style={{ display: "grid", gap: 14 }}>
        <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div className="tc-title">Pasarela de pago del panel cliente</div>
            <div className="tc-sub" style={{ marginTop: 6 }}>
              Elige qué pasarela utilizarán las nuevas compras de minutos. Stripe permanece disponible y puedes alternar entre ambas cuando quieras.
            </div>
          </div>
          <span className="tc-chip" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <ShieldCheck size={15} /> Activa: {provider === "redsys" ? "Redsys" : "Stripe"}
          </span>
        </div>

        {message ? <div className="tc-sub" style={{ padding: 12, borderRadius: 12, background: "rgba(255,255,255,.04)" }}>{message}</div> : null}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 14, opacity: loading ? .65 : 1 }}>
          <button
            type="button"
            className={`tc-card tc-click ${provider === "redsys" ? "tc-golden-panel" : ""}`}
            disabled={loading || saving}
            onClick={() => void save("redsys")}
            style={{ textAlign: "left", cursor: "pointer", minHeight: 150 }}
          >
            <div className="tc-row" style={{ justifyContent: "space-between" }}>
              <Landmark size={24} />
              {provider === "redsys" ? <span className="tc-chip">ACTIVA</span> : null}
            </div>
            <div className="tc-title" style={{ marginTop: 18 }}>Redsys</div>
            <div className="tc-sub" style={{ marginTop: 7 }}>TPV Virtual por redirección. Es la opción predeterminada del sistema.</div>
          </button>

          <button
            type="button"
            className={`tc-card tc-click ${provider === "stripe" ? "tc-golden-panel" : ""}`}
            disabled={loading || saving}
            onClick={() => void save("stripe")}
            style={{ textAlign: "left", cursor: "pointer", minHeight: 150 }}
          >
            <div className="tc-row" style={{ justifyContent: "space-between" }}>
              <CreditCard size={24} />
              {provider === "stripe" ? <span className="tc-chip">ACTIVA</span> : null}
            </div>
            <div className="tc-title" style={{ marginTop: 18 }}>Stripe</div>
            <div className="tc-sub" style={{ marginTop: 7 }}>Checkout actual de Stripe. No se elimina ni se desactiva su integración.</div>
          </button>
        </div>
      </section>
    </div>
  );
}
