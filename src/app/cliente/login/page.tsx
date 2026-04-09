"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

function normalizePhoneForSupabase(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("+")) return raw;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return `+${digits}`;
}

export default function ClienteLoginPage() {
  const router = useRouter();
  const [phoneInput, setPhoneInput] = useState("");
  const [token, setToken] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const phone = useMemo(() => normalizePhoneForSupabase(phoneInput), [phoneInput]);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      if (data.session?.user?.phone) {
        router.replace("/cliente/dashboard");
      }
    });
  }, [router]);

  async function sendOtp() {
    if (!phone) {
      setMsg("Introduce un teléfono válido.");
      return;
    }
    try {
      setLoading(true);
      setMsg("");
      const { error } = await sb.auth.signInWithOtp({ phone });
      if (error) throw error;
      setStep("otp");
      setMsg("Te hemos enviado un código por SMS.");
    } catch (e: any) {
      setMsg(e?.message || "No hemos podido enviar el código.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    if (!phone || !token.trim()) {
      setMsg("Introduce el código que has recibido.");
      return;
    }
    try {
      setLoading(true);
      setMsg("");
      const { error } = await sb.auth.verifyOtp({ phone, token: token.trim(), type: "sms" });
      if (error) throw error;
      router.replace("/cliente/dashboard");
    } catch (e: any) {
      setMsg(e?.message || "Código incorrecto.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="tc-wrap" style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <div className="tc-container" style={{ maxWidth: 520 }}>
        <div className="tc-card" style={{ display: "grid", gap: 18, padding: 24 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div className="tc-chip" style={{ width: "fit-content" }}>Nuevo panel</div>
            <div className="tc-title" style={{ fontSize: 32 }}>Área cliente Tarot Celestial</div>
            <div className="tc-muted">
              Entra con tu número de teléfono y recibe tu código de acceso por SMS.
            </div>
          </div>

          <div className="tc-hr" />

          {step === "phone" ? (
            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="tc-sub">Teléfono</span>
                <input
                  className="tc-input"
                  placeholder="+34 600 000 000"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                />
              </label>
              <button className="tc-btn tc-btn-gold" disabled={loading} onClick={sendOtp}>
                {loading ? "Enviando..." : "Recibir código"}
              </button>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <div className="tc-card" style={{ padding: 14 }}>
                Código enviado a <strong>{phone}</strong>
              </div>
              <label style={{ display: "grid", gap: 6 }}>
                <span className="tc-sub">Código SMS</span>
                <input
                  className="tc-input"
                  placeholder="123456"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </label>
              <div className="tc-row">
                <button className="tc-btn" disabled={loading} onClick={() => setStep("phone")}>
                  Cambiar teléfono
                </button>
                <button className="tc-btn tc-btn-gold" disabled={loading} onClick={verifyOtp}>
                  {loading ? "Verificando..." : "Entrar"}
                </button>
              </div>
            </div>
          )}

          {msg ? <div className="tc-muted">{msg}</div> : null}
        </div>
      </div>
    </div>
  );
}
