"use client";

import type { CSSProperties } from "react";
import { BellRing, Smartphone } from "lucide-react";
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
  pushEnabled: boolean;
  pushBusy: boolean;
  pushPermission: NotificationPermission | "unsupported";
  onEnablePush: () => Promise<void>;
  onSave: (payload: {
    nombre: string;
    apellido: string;
    email: string;
    fecha_nacimiento: string;
    onboarding_completado: boolean;
  }) => Promise<void>;
};

export default function OnboardingModal({ open, cliente, saving, pushEnabled, pushBusy, pushPermission, onEnablePush, onSave }: Props) {
  const [step, setStep] = useState(0);
  const [confirmNombre, setConfirmNombre] = useState<boolean | null>(null);
  const [confirmEmail, setConfirmEmail] = useState<boolean | null>(null);
  const [confirmNacimiento, setConfirmNacimiento] = useState<boolean | null>(null);
  const [nombre, setNombre] = useState(cliente?.nombre || "");
  const [apellido, setApellido] = useState(cliente?.apellido || "");
  const [email, setEmail] = useState(cliente?.email || "");
  const [fechaNacimiento, setFechaNacimiento] = useState(cliente?.fecha_nacimiento || "");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setNombre(cliente?.nombre || "");
    setApellido(cliente?.apellido || "");
    setEmail(cliente?.email || "");
    setFechaNacimiento(cliente?.fecha_nacimiento || "");
  }, [cliente?.apellido, cliente?.email, cliente?.fecha_nacimiento, cliente?.nombre]);

  const nombreCompleto = useMemo(() => [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ").trim(), [cliente]);

  if (!open || !cliente) return null;

  async function finish() {
    if (!nombre.trim()) {
      setMsg("Necesitamos al menos tu nombre para continuar.");
      return;
    }
    if (!pushEnabled) {
      setMsg("Activa las notificaciones para terminar el acceso al panel.");
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
        <div style={{ display: "grid", gap: 6 }}>
          <div className="tc-chip" style={{ width: "fit-content", borderColor: "rgba(244,216,159,0.18)", background: "rgba(244,216,159,0.08)" }}>Bienvenida</div>
          <div className="tc-title" style={{ fontSize: 26 }}>
            Hola, bienvenido al panel cliente de Tarot Celestial ✨
          </div>
          <div className="tc-muted">
            Antes de continuar vamos a comprobar unos datos para dejar tu área personal correcta.
          </div>
        </div>

        <div className="tc-hr" />

        {step === 0 ? (
          <div style={{ display: "grid", gap: 14 }}>
            <div className="tc-title" style={{ fontSize: 18 }}>¿Tu nombre y apellido es correcto?</div>
            <div className="tc-card" style={{ padding: 16 }}>
              {nombreCompleto || "Todavía no tenemos tu nombre guardado."}
            </div>
            <div className="tc-row">
              <button className="tc-btn tc-btn-ok" onClick={() => { setConfirmNombre(true); setStep(1); }}>
                Sí, está correcto
              </button>
              <button className="tc-btn tc-btn-purple" onClick={() => setConfirmNombre(false)}>
                No, quiero corregirlo
              </button>
            </div>
            {confirmNombre === false ? (
              <div style={{ display: "grid", gap: 10 }}>
                <input className="tc-input" placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
                <input className="tc-input" placeholder="Apellido" value={apellido} onChange={(e) => setApellido(e.target.value)} />
                <div className="tc-row">
                  <button className="tc-btn tc-btn-gold" onClick={() => setStep(1)}>Guardar y seguir</button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 1 ? (
          <div style={{ display: "grid", gap: 14 }}>
            <div className="tc-title" style={{ fontSize: 18 }}>
              {cliente?.email ? "¿Tu e-mail es correcto?" : "¿Quieres dejarnos tu e-mail para enviarte promociones y regalos?"}
            </div>
            {cliente?.email ? (
              <div className="tc-card" style={{ padding: 16 }}>{cliente.email}</div>
            ) : (
              <div className="tc-muted">El e-mail es opcional, pero nos ayuda a avisarte de promociones y regalos.</div>
            )}
            <div className="tc-row">
              {cliente?.email ? (
                <button className="tc-btn tc-btn-ok" onClick={() => { setConfirmEmail(true); setStep(2); }}>
                  Sí, está correcto
                </button>
              ) : null}
              <button className="tc-btn tc-btn-purple" onClick={() => setConfirmEmail(false)}>
                {cliente?.email ? "No, quiero cambiarlo" : "Quiero añadir mi e-mail"}
              </button>
              {!cliente?.email ? (
                <button className="tc-btn" onClick={() => { setConfirmEmail(true); setStep(2); }}>
                  Prefiero dejarlo vacío
                </button>
              ) : null}
            </div>
            {confirmEmail === false ? (
              <div style={{ display: "grid", gap: 10 }}>
                <input className="tc-input" placeholder="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                <div className="tc-row">
                  <button className="tc-btn tc-btn-gold" onClick={() => setStep(2)}>Guardar y seguir</button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 2 ? (
          <div style={{ display: "grid", gap: 14 }}>
            <div className="tc-title" style={{ fontSize: 18 }}>
              ¿Tu fecha de nacimiento es correcta? Recuerda que cada año por tu cumpleaños te regalamos minutos.
            </div>
            {cliente?.fecha_nacimiento ? (
              <div className="tc-card" style={{ padding: 16 }}>{cliente.fecha_nacimiento}</div>
            ) : (
              <div className="tc-muted">Si la guardas, podremos prepararte tu regalo de cumpleaños.</div>
            )}
            <div className="tc-row">
              {cliente?.fecha_nacimiento ? (
                <button className="tc-btn tc-btn-ok" onClick={() => setConfirmNacimiento(true)}>
                  Sí, está correcta
                </button>
              ) : null}
              <button className="tc-btn tc-btn-purple" onClick={() => setConfirmNacimiento(false)}>
                {cliente?.fecha_nacimiento ? "No, quiero cambiarla" : "Quiero añadirla"}
              </button>
            </div>
            {(confirmNacimiento === false || !cliente?.fecha_nacimiento) ? (
              <div style={{ display: "grid", gap: 10 }}>
                <input className="tc-input" type="date" value={fechaNacimiento} onChange={(e) => setFechaNacimiento(e.target.value)} />
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div style={{ display: "grid", gap: 14 }}>
            <div className="tc-title" style={{ fontSize: 18 }}>Activa las notificaciones para terminar</div>
            <div className="tc-card" style={{ padding: 16, display: "grid", gap: 10 }}>
              <div className="tc-row" style={{ gap: 10, alignItems: "flex-start" }}>
                <BellRing size={18} style={{ color: "var(--tc-gold-2)", marginTop: 2 }} />
                <div>
                  <div className="tc-list-item-title">
                    {pushPermission === "unsupported"
                      ? "Este dispositivo no soporta notificaciones web"
                      : pushEnabled
                      ? "Notificaciones activadas"
                      : "Activa las notificaciones en este dispositivo"}
                  </div>
                  <div className="tc-list-item-sub" style={{ marginTop: 4 }}>
                    {pushPermission === "unsupported"
                      ? "Prueba desde Chrome o Safari actualizados y con HTTPS real."
                      : pushEnabled
                      ? "Perfecto. Ya podremos avisarte de promociones, minutos, novedades y mensajes importantes."
                      : "Es necesario activarlas para terminar el acceso al panel y recibir avisos importantes."}
                  </div>
                </div>
              </div>
              <button className="tc-btn tc-btn-gold" disabled={pushBusy || pushPermission === "unsupported" || pushEnabled} onClick={onEnablePush}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Smartphone size={16} /> {pushEnabled ? "Notificaciones activadas" : pushBusy ? "Activando..." : "Activar notificaciones"}</span>
              </button>
            </div>
          </div>
        ) : null}

        {msg ? <div style={{ color: "#ff9baa", fontSize: 13 }}>{msg}</div> : null}

        <div className="tc-row" style={{ justifyContent: "space-between" }}>
          <div className="tc-sub">Paso {step + 1} de 4</div>
          <div className="tc-row">
            {step > 0 ? (
              <button className="tc-btn" disabled={saving || pushBusy} onClick={() => setStep((s) => Math.max(0, s - 1))}>
                Atrás
              </button>
            ) : null}
            {step < 3 ? (
              <button className="tc-btn tc-btn-gold" disabled={saving || pushBusy} onClick={() => setStep((s) => Math.min(3, s + 1))}>
                Siguiente
              </button>
            ) : (
              <button className="tc-btn tc-btn-gold" disabled={saving || pushBusy || !pushEnabled} onClick={finish}>
                {saving ? "Guardando..." : "Entrar al panel"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
