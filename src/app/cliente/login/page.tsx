"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, Sparkles, Star, TimerReset } from "lucide-react";
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
    <div className="tc-login-shell">
      <div className="tc-login-card">
        <section className="tc-login-showcase">
          <div style={{ display: "grid", gap: 22 }}>
            <div className="tc-login-logo">
              <Image src="/Nuevo-logo-tarot.png" alt="Tarot Celestial" width={72} height={72} priority style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <div className="tc-chip" style={{ width: "fit-content" }}>Nuevo panel cliente</div>
              <div className="tc-brand-title" style={{ maxWidth: 520 }}>Tu espacio privado de Tarot Celestial</div>
              <div className="tc-brand-copy">
                Consulta en segundos tu rango, tus puntos, tus minutos disponibles y tus últimas consultas con un diseño más claro, moderno y cómodo.
              </div>
            </div>
          </div>

          <div className="tc-login-features">
            <div className="tc-login-feature">
              <div className="tc-row" style={{ gap: 10 }}><Star size={16} style={{ color: "var(--tc-gold-2)" }} /><strong>Ventajas visibles</strong></div>
              <div className="tc-list-item-sub">Tu rango y todos sus beneficios siempre a la vista.</div>
            </div>
            <div className="tc-login-feature">
              <div className="tc-row" style={{ gap: 10 }}><TimerReset size={16} style={{ color: "var(--tc-gold-2)" }} /><strong>Minutos y puntos</strong></div>
              <div className="tc-list-item-sub">Controla cuánto tienes disponible y canjea minutos gratis cuando quieras.</div>
            </div>
            <div className="tc-login-feature">
              <div className="tc-row" style={{ gap: 10 }}><Sparkles size={16} style={{ color: "var(--tc-gold-2)" }} /><strong>Experiencia premium</strong></div>
              <div className="tc-list-item-sub">Un acceso sencillo con tu teléfono para entrar a tu panel personal.</div>
            </div>
          </div>
        </section>

        <section className="tc-login-form">
          <div style={{ display: "grid", gap: 8 }}>
            <div className="tc-row" style={{ gap: 8, color: "var(--tc-gold-2)" }}><LockKeyhole size={16} /> Acceso seguro</div>
            <div className="tc-panel-title" style={{ fontSize: 30 }}>Entrar al panel</div>
            <div className="tc-panel-sub">Usa tu número de teléfono para acceder a tu área de cliente.</div>
          </div>

          {step === "phone" ? (
            <div style={{ display: "grid", gap: 14 }}>
              <label style={{ display: "grid", gap: 7 }}>
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
            <div style={{ display: "grid", gap: 14 }}>
              <div className="tc-card tc-golden-panel" style={{ padding: 14 }}>
                Código enviado a <strong>{phone}</strong>
              </div>
              <label style={{ display: "grid", gap: 7 }}>
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

          {msg ? <div className="tc-card">{msg}</div> : null}
        </section>
      </div>
    </div>
  );
}
