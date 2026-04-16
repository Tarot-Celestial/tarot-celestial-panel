"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";

type Cliente = {
  nombre?: string | null;
  apellido?: string | null;
  email?: string | null;
  fecha_nacimiento?: string | null;
};

type Props = {
  open: boolean;
  cliente: Cliente | null;
  saving: boolean;
  onSave: (payload: {
    nombre: string;
    apellido: string;
    email: string;
    fecha_nacimiento: string;
    onboarding_completado: boolean;
    password: string;
    password_confirm: string;
  }) => Promise<void>;
};

const PASSWORD_HINT = "Mínimo 8 caracteres, con al menos una letra y un número.";

function validatePassword(password: string, confirm: string): string {
  if (!password) return "Debes crear una contraseña para entrar sin código la próxima vez.";
  if (password.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return PASSWORD_HINT;
  }
  if (password !== confirm) return "Las contraseñas no coinciden.";
  return "";
}

export default function OnboardingModal({ open, cliente, saving, onSave }: Props) {
  const [step, setStep] = useState(0);

  const [nombre, setNombre] = useState(cliente?.nombre || "");
  const [apellido, setApellido] = useState(cliente?.apellido || "");
  const [email, setEmail] = useState(cliente?.email || "");
  const [fechaNacimiento, setFechaNacimiento] = useState(cliente?.fecha_nacimiento || "");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  const [editNombre, setEditNombre] = useState(false);
  const [editEmail, setEditEmail] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setNombre(cliente?.nombre || "");
    setApellido(cliente?.apellido || "");
    setEmail(cliente?.email || "");
    setFechaNacimiento(cliente?.fecha_nacimiento || "");
    setPassword("");
    setPasswordConfirm("");
    setMsg("");
    setStep(0);
  }, [cliente, open]);

  const nombreCompleto = useMemo(() => [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ").trim(), [cliente]);

  if (!open || !cliente) return null;

  async function finish() {
    if (!nombre.trim()) {
      setMsg("Necesitamos tu nombre.");
      return;
    }

    const passwordError = validatePassword(password, passwordConfirm);
    if (passwordError) {
      setMsg(passwordError);
      return;
    }

    setMsg("");

    await onSave({
      nombre: nombre.trim(),
      apellido: apellido.trim(),
      email: email.trim(),
      fecha_nacimiento: fechaNacimiento.trim(),
      onboarding_completado: true,
      password,
      password_confirm: passwordConfirm,
    });
  }

  const cardStyle: CSSProperties = {
    width: "min(720px, 96vw)",
    borderRadius: 22,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "linear-gradient(180deg, rgba(23,18,14,0.98), rgba(10,9,14,0.98))",
    boxShadow: "0 24px 90px rgba(0,0,0,0.55)",
    padding: 24,
    display: "grid",
    gap: 16,
  };

  function goNext() {
    setMsg("");
    setStep((prev) => Math.min(prev + 1, 3));
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999999,
        background: "rgba(5,5,10,0.78)",
        display: "grid",
        placeItems: "center",
        padding: 16,
        backdropFilter: "blur(8px)",
      }}
    >
      <div style={cardStyle}>
        <div>
          <div className="tc-chip">Bienvenida</div>
          <div className="tc-title" style={{ fontSize: 26 }}>
            Bienvenido a Tarot Celestial ✨
          </div>
          <div className="tc-muted">Vamos a dejar tu acceso listo en menos de un minuto.</div>
        </div>

        {step === 0 && (
          <div style={{ display: "grid", gap: 12 }}>
            <div className="tc-title">¿Tu nombre es correcto?</div>

            {!editNombre ? (
              <>
                <div className="tc-card">{nombreCompleto || "Sin nombre"}</div>
                <div className="tc-row">
                  <button className="tc-btn tc-btn-ok" onClick={goNext}>
                    Sí
                  </button>
                  <button className="tc-btn" onClick={() => setEditNombre(true)}>
                    Editar
                  </button>
                </div>
              </>
            ) : (
              <>
                <input className="tc-input" placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
                <input className="tc-input" placeholder="Apellido" value={apellido} onChange={(e) => setApellido(e.target.value)} />
                <div className="tc-row">
                  <button className="tc-btn tc-btn-ok" onClick={goNext}>
                    Guardar y seguir
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {step === 1 && (
          <div style={{ display: "grid", gap: 12 }}>
            <div className="tc-title">¿Tu e-mail es correcto?</div>

            {!editEmail ? (
              <>
                <div className="tc-card">{email || "Sin e-mail"}</div>
                <div className="tc-row">
                  <button className="tc-btn tc-btn-ok" onClick={goNext}>
                    Sí
                  </button>
                  <button className="tc-btn" onClick={() => setEditEmail(true)}>
                    Editar
                  </button>
                </div>
              </>
            ) : (
              <>
                <input className="tc-input" placeholder="tu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                <div className="tc-row">
                  <button className="tc-btn tc-btn-ok" onClick={goNext}>
                    Guardar y seguir
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {step === 2 && (
          <div style={{ display: "grid", gap: 12 }}>
            <div className="tc-title">Fecha de nacimiento</div>
            <input className="tc-input" type="date" value={fechaNacimiento} onChange={(e) => setFechaNacimiento(e.target.value)} />
            <div className="tc-row">
              <button className="tc-btn tc-btn-ok" onClick={goNext}>
                Continuar
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div style={{ display: "grid", gap: 12 }}>
            <div className="tc-title">Crea tu contraseña</div>
            <div className="tc-muted">
              A partir de ahora entrarás con tu teléfono y esta contraseña, sin esperar códigos por SMS.
            </div>
            <input
              className="tc-input"
              type="password"
              placeholder="Nueva contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <input
              className="tc-input"
              type="password"
              placeholder="Repite la contraseña"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
            />
            <div className="tc-muted">{PASSWORD_HINT}</div>
            <button className="tc-btn tc-btn-gold" onClick={finish} disabled={saving}>
              {saving ? "Guardando..." : "Finalizar"}
            </button>
          </div>
        )}

        {msg ? <div className="tc-error">{msg}</div> : null}
      </div>
    </div>
  );
}
