"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Mail, Phone, ShieldCheck } from "lucide-react";
import ClienteLayout from "@/components/cliente/ClienteLayout";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

type Cliente = {
  nombre?: string | null;
  apellido?: string | null;
  email?: string | null;
  fecha_nacimiento?: string | null;
  telefono?: string | null;
  telefono_normalizado?: string | null;
  onboarding_completado?: boolean | null;
};

function normalizePhoneForSupabase(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("+")) return raw;
  const digits = raw.replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

export default function ClientePerfilPage() {
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [nombre, setNombre] = useState("");
  const [apellido, setApellido] = useState("");
  const [email, setEmail] = useState("");
  const [fechaNacimiento, setFechaNacimiento] = useState("");
  const [telefonoNuevo, setTelefonoNuevo] = useState("");
  const [telefonoCode, setTelefonoCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingPhone, setChangingPhone] = useState(false);
  const [verifyingPhone, setVerifyingPhone] = useState(false);
  const [msg, setMsg] = useState("");
  const [phoneStep, setPhoneStep] = useState<"idle" | "code">("idle");

  const currentPhone = useMemo(() => cliente?.telefono || cliente?.telefono_normalizado || "", [cliente]);

  async function loadProfile() {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/cliente/login";
      return;
    }

    const res = await fetch("/api/cliente/me", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    if (!json?.ok) {
      setMsg(json?.error || "No hemos podido cargar tu perfil.");
      setLoading(false);
      return;
    }

    const nextCliente = json.cliente || null;
    setCliente(nextCliente);
    setNombre(nextCliente?.nombre || "");
    setApellido(nextCliente?.apellido || "");
    setEmail(nextCliente?.email || "");
    setFechaNacimiento(nextCliente?.fecha_nacimiento || "");
    setLoading(false);
  }

  useEffect(() => {
    loadProfile();
  }, []);

  async function saveProfile() {
    try {
      setSaving(true);
      setMsg("");
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Sesión no válida");

      const res = await fetch("/api/cliente/perfil", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          nombre,
          apellido,
          email,
          fecha_nacimiento: fechaNacimiento,
          onboarding_completado: Boolean(cliente?.onboarding_completado),
        }),
      });

      const json = await res.json().catch(() => null);
      if (!json?.ok) throw new Error(json?.error || "No hemos podido guardar tu perfil");
      setMsg("✅ Perfil actualizado correctamente.");
      await loadProfile();
    } catch (e: any) {
      setMsg(e?.message || "No hemos podido guardar tu perfil");
    } finally {
      setSaving(false);
    }
  }

  async function startPhoneChange() {
    const phone = normalizePhoneForSupabase(telefonoNuevo);
    if (!phone) {
      setMsg("Introduce un teléfono válido para cambiarlo.");
      return;
    }
    try {
      setChangingPhone(true);
      setMsg("");
      const { error } = await sb.auth.updateUser({ phone });
      if (error) throw error;
      setPhoneStep("code");
      setMsg("Te hemos enviado un código al nuevo teléfono. Confírmalo para actualizar tu ficha.");
    } catch (e: any) {
      setMsg(e?.message || "No hemos podido iniciar el cambio de teléfono.");
    } finally {
      setChangingPhone(false);
    }
  }

  async function verifyPhoneChange() {
    const phone = normalizePhoneForSupabase(telefonoNuevo);
    if (!phone || !telefonoCode.trim()) {
      setMsg("Introduce el código del nuevo teléfono.");
      return;
    }
    try {
      setVerifyingPhone(true);
      setMsg("");
      const { error } = await sb.auth.verifyOtp({ phone, token: telefonoCode.trim(), type: "phone_change" });
      if (error) throw error;

      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("No hemos podido refrescar tu sesión.");

      const res = await fetch("/api/cliente/phone-sync", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          telefono: telefonoNuevo,
          telefono_anterior: currentPhone,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) throw new Error(json?.error || "No hemos podido sincronizar tu teléfono.");

      setMsg("✅ Teléfono actualizado y verificado correctamente.");
      setTelefonoCode("");
      setTelefonoNuevo("");
      setPhoneStep("idle");
      await loadProfile();
    } catch (e: any) {
      setMsg(e?.message || "No hemos podido verificar el cambio de teléfono.");
    } finally {
      setVerifyingPhone(false);
    }
  }

  return (
    <ClienteLayout
      title="Tu perfil"
      subtitle="Aquí puedes revisar y actualizar los datos de tu cuenta para que todo en tu panel esté siempre correcto."
      summaryItems={[
        { label: "Teléfono actual", value: currentPhone || "—", meta: "Acceso principal al panel" },
        { label: "Email", value: email || "No añadido", meta: "Para promociones y regalos" },
        { label: "Nacimiento", value: fechaNacimiento || "Pendiente", meta: "Nos ayuda con tu regalo de cumpleaños" },
      ]}
    >
      {loading ? (
        <div className="tc-card">Cargando...</div>
      ) : (
        <div className="tc-profile-grid">
          <div className="tc-card tc-golden-panel" style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div className="tc-panel-title">Tus datos personales</div>
              <div className="tc-panel-sub">Mantén tu nombre, email y fecha de nacimiento al día para disfrutar mejor de todas tus ventajas.</div>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 7 }}>
                <span className="tc-sub">Nombre</span>
                <input className="tc-input" placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: 7 }}>
                <span className="tc-sub">Apellido</span>
                <input className="tc-input" placeholder="Apellido" value={apellido} onChange={(e) => setApellido(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: 7 }}>
                <span className="tc-sub">E-mail</span>
                <input className="tc-input" placeholder="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: 7 }}>
                <span className="tc-sub">Fecha de nacimiento</span>
                <input className="tc-input" type="date" value={fechaNacimiento} onChange={(e) => setFechaNacimiento(e.target.value)} />
              </label>
            </div>

            <div className="tc-row">
              <button className="tc-btn tc-btn-gold" disabled={saving} onClick={saveProfile}>
                {saving ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gap: 16 }}>
            <div className="tc-card" style={{ display: "grid", gap: 14 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <div className="tc-panel-title">Seguridad y acceso</div>
                <div className="tc-panel-sub">Si cambias de teléfono, primero tendrás que verificarlo por SMS.</div>
              </div>

              <div className="tc-list-card">
                <div className="tc-list-item">
                  <div className="tc-row"><Phone size={16} /> <span className="tc-list-item-title">{currentPhone || "—"}</span></div>
                  <div className="tc-list-item-sub">Teléfono actual de acceso</div>
                </div>
                <div className="tc-list-item">
                  <div className="tc-row"><Mail size={16} /> <span className="tc-list-item-title">{email || "No añadido"}</span></div>
                  <div className="tc-list-item-sub">Email actual</div>
                </div>
                <div className="tc-list-item">
                  <div className="tc-row"><CalendarDays size={16} /> <span className="tc-list-item-title">{fechaNacimiento || "Pendiente"}</span></div>
                  <div className="tc-list-item-sub">Fecha de nacimiento</div>
                </div>
                <div className="tc-list-item">
                  <div className="tc-row"><ShieldCheck size={16} /> <span className="tc-list-item-title">{cliente?.onboarding_completado ? "Perfil validado" : "Pendiente de completar"}</span></div>
                  <div className="tc-list-item-sub">Estado del onboarding</div>
                </div>
              </div>
            </div>

            <div className="tc-card tc-golden-panel" style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <div className="tc-panel-title">Cambiar teléfono</div>
                <div className="tc-panel-sub">Actualiza tu número y confírmalo con un código para mantener tu acceso seguro.</div>
              </div>

              <label style={{ display: "grid", gap: 7 }}>
                <span className="tc-sub">Nuevo teléfono</span>
                <input
                  className="tc-input"
                  placeholder="Nuevo teléfono con prefijo"
                  value={telefonoNuevo}
                  onChange={(e) => setTelefonoNuevo(e.target.value)}
                />
              </label>

              {phoneStep === "code" ? (
                <label style={{ display: "grid", gap: 7 }}>
                  <span className="tc-sub">Código recibido</span>
                  <input
                    className="tc-input"
                    placeholder="Código recibido por SMS"
                    value={telefonoCode}
                    onChange={(e) => setTelefonoCode(e.target.value)}
                  />
                </label>
              ) : null}

              <div className="tc-row">
                {phoneStep === "idle" ? (
                  <button className="tc-btn tc-btn-purple" disabled={changingPhone} onClick={startPhoneChange}>
                    {changingPhone ? "Enviando código..." : "Cambiar teléfono"}
                  </button>
                ) : (
                  <button className="tc-btn tc-btn-gold" disabled={verifyingPhone} onClick={verifyPhoneChange}>
                    {verifyingPhone ? "Verificando..." : "Confirmar cambio"}
                  </button>
                )}
              </div>
            </div>

            {msg ? <div className="tc-card">{msg}</div> : null}
          </div>
        </div>
      )}
    </ClienteLayout>
  );
}
