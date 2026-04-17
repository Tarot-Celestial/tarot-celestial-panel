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

export default function OnboardingModal({ open, cliente, saving, onSave }: Props) {
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
    setMsg("");
    setStep(0);
  }, [cliente, open]);

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

  function goNext() {
  setMsg("");

  if (step === 2) {
    finish(); // 🔥 TERMINA AQUÍ
    return;
  }

  setStep((prev) => prev + 1);
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
          <div className="tc-muted">
            Vamos a dejar tu acceso listo en menos de un minuto.
          </div>
        </div>

        {/* STEP 0 */}
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
                <button className="tc-btn tc-btn-ok" onClick={goNext}>
                  Guardar y seguir
                </button>
              </>
            )}
          </div>
        )}

        {/* STEP 1 */}
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
                <button className="tc-btn tc-btn-ok" onClick={goNext}>
                  Guardar y seguir
                </button>
              </>
            )}
          </div>
        )}

        {/* STEP 2 PRO */}
        {step === 2 && (
          <div style={{ display: "grid", gap: 12 }}>
            <div className="tc-title">Fecha de nacimiento</div>

            <input
              className="tc-input"
              placeholder="DD/MM/YYYY"
              value={fechaNacimiento}
              onChange={(e) => {
                let value = e.target.value.replace(/[^\d]/g, "");

                if (value.length > 8) value = value.slice(0, 8);

                if (value.length >= 5) {
                  value = `${value.slice(0, 2)}/${value.slice(2, 4)}/${value.slice(4)}`;
                } else if (value.length >= 3) {
                  value = `${value.slice(0, 2)}/${value.slice(2)}`;
                }

                setFechaNacimiento(value);
              }}
            />

            <div className="tc-muted">Ejemplo: 07/03/1995</div>

            <button
              className="tc-btn tc-btn-ok"
              onClick={() => {
                const parts = fechaNacimiento.split("/");
                if (parts.length !== 3) return setMsg("Formato inválido");

                const [dd, mm, yyyy] = parts;
                if (yyyy.length !== 4) return setMsg("Año inválido");

                setFechaNacimiento(`${yyyy}-${mm}-${dd}`);
                goNext();
              }}
            >
              Continuar
            </button>
          </div>
        )}

        {/* STEP 3 */}
      

        {msg && <div className="tc-error">{msg}</div>}
      </div>
    </div>
  );
}
