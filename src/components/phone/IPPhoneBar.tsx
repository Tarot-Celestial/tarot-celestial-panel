"use client";

/**
 * SIP/softphone temporarily disabled.
 *
 * This component intentionally performs no Supabase, SIP, parking, attendance,
 * or /api/operator/panel requests. Keeping it mounted as a lightweight disabled
 * bar avoids breaking layouts while stopping the ps_endpoints/reconnect storm.
 */
export default function IPPhoneBar({ forcedOpen, onOpenChange }: { forcedOpen?: boolean; onOpenChange?: (open: boolean) => void } = {}) {
  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        bottom: 18,
        transform: "translateX(-50%)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 18px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,.16)",
        background: "rgba(15,15,25,.88)",
        color: "rgba(255,255,255,.82)",
        fontSize: 13,
        boxShadow: "0 16px 40px rgba(0,0,0,.35)",
        backdropFilter: "blur(14px)",
      }}
      aria-label="Telefonía desactivada"
    >
      <span style={{ color: "#ff7b7b" }}>☎</span>
      <strong>Teléfono</strong>
      <span style={{ opacity: 0.72 }}>SIP y parking desactivados temporalmente</span>
    </div>
  );
}
