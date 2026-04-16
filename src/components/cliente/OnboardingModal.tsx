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
  }) => Promise<void>;
};

export default function OnboardingModal({
  open,
  cliente,
  saving,
  onSave,
}: Props) {
  const [step, setStep] = useState(0);

  const [nombre, setNombre] = useState(cliente?.nombre || "");
  const [apellido, setApellido] = useState(cliente?.apellido || "");
  const [email, setEmail] = useState(cliente?.email || "");
  const [fechaNacimiento, setFechaNacimiento] = useState(cliente?.fecha_nacimiento || "");

  const [editNombre, setEditNombre] = useState(false);
  const [editEmail, setEditEmail] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setNombre(cliente?.nombre || "");
    setApellido(cliente?.apellido || "");
    setEmail(cliente?.email || "");
    setFechaNacimiento(cliente?.fecha_nacimiento || "");
  }, [cliente]);

  const nombreCompleto = useMemo(
    () => [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ").trim(),
    [cliente]
  );

  if (!open || !cliente) return null;

  async function finish() {
    if (!nombre.trim()) {
      setMsg("Necesitamos tu nombre.");
      return;
    }

    setMsg("");

    await onSave({
      nombre: nombre.trim(),
      apellido: apellido.trim(),
      email: email.trim(),
      fecha_nacimiento: fechaNacimiento.trim(),
      onboarding_completado: true,
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
          <div className="tc-muted">
            Vamos a comprobar tus datos.
          </div>
        </div>

        {/* STEP 0 - NOMBRE */}
        {step === 0 && (
          <div>
            <div className="tc-title">¿Tu nombre es correcto?</div>

            {!editNombre ? (
              <>
                <div className="tc-card">{nombreCompleto || "Sin nombre"}</div>

                <div className="tc-row">
                  <button className="tc-btn tc-btn-ok" onClick={() => setStep(1)}>
                    Sí
                  </button>
                  <button className="tc-btn tc-btn-purple" onClick={() => setEditNombre(true)}>
                    Cambiar
                  </button>
                </div>
              </>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <input
                  className="tc-input"
                  placeholder="Nombre"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                />
                <input
                  className="tc-input"
                  placeholder="Apellido"
                  value={apellido}
                  onChange={(e) => setApellido(e.target.value)}
                />
                <button className="tc-btn tc-btn-gold" onClick={() => setStep(1)}>
                  Guardar y seguir
                </button>
              </div>
            )}
          </div>
        )}

        {/* STEP 1 - EMAIL */}
        {step === 1 && (
          <div>
            <div className="tc-title">Email (opcional)</div>

            {!editEmail ? (
              <div className="tc-row">
                <button className="tc-btn tc-btn-ok" onClick={() => setStep(2)}>
                  Correcto
                </button>
                <button className="tc-btn tc-btn-purple" onClick={() => setEditEmail(true)}>
                  Cambiar
                </button>
                <button className="tc-btn" onClick={() => setStep(2)}>
                  Omitir
                </button>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <input
                  className="tc-input"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button className="tc-btn tc-btn-gold" onClick={() => setStep(2)}>
                  Guardar y seguir
                </button>
              </div>
            )}
          </div>
        )}

        {/* STEP 2 - FECHA */}
        {step === 2 && (
          <div>
            <div className="tc-title">Fecha de nacimiento</div>

            <input
              className="tc-input"
              type="text"
              placeholder="DD/MM/AAAA o YYYY-MM-DD"
              value={fechaNacimiento}
              onChange={(e) => setFechaNacimiento(e.target.value)}
            />

            <input
              className="tc-input"
              type="date"
              value={fechaNacimiento}
              onChange={(e) => setFechaNacimiento(e.target.value)}
            />

            <button className="tc-btn tc-btn-gold" onClick={finish}>
              Finalizar
            </button>
          </div>
        )}

        {msg && <div className="tc-error">{msg}</div>}
      </div>
    </div>
  );
}
