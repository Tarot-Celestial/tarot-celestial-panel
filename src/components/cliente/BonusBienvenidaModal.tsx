"use client";

import { Gift, Sparkles } from "lucide-react";

type Props = {
  open: boolean;
  minutes?: number;
  onClose: () => void;
};

export default function BonusBienvenidaModal({ open, minutes = 10, onClose }: Props) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(5,8,18,.76)",
        display: "grid",
        placeItems: "center",
        zIndex: 90,
        padding: 16,
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        className="tc-card tc-golden-panel"
        style={{
          width: "min(580px, 100%)",
          display: "grid",
          gap: 18,
          padding: 28,
          textAlign: "center",
          boxShadow: "0 26px 80px rgba(0,0,0,.48)",
        }}
      >
        <div
          style={{
            width: 82,
            height: 82,
            margin: "0 auto",
            borderRadius: 28,
            display: "grid",
            placeItems: "center",
            background: "rgba(215,181,109,.18)",
            border: "1px solid rgba(215,181,109,.28)",
          }}
        >
          <Gift size={36} />
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <div className="tc-chip" style={{ width: "fit-content", margin: "0 auto", display: "inline-flex", gap: 8, alignItems: "center" }}>
            <Sparkles size={14} /> Regalo de bienvenida
          </div>
          <div className="tc-title" style={{ fontSize: 32 }}>Felicidades</div>
          <div style={{ fontSize: 19, fontWeight: 800 }}>Acabas de ganar {minutes} minutos gratis de consulta.</div>
          <div className="tc-muted">
            Ya los hemos añadido a tus minutos free pendientes para que puedas disfrutarlos en tu próxima consulta.
          </div>
        </div>
        <div className="tc-row" style={{ justifyContent: "center" }}>
          <button className="tc-btn tc-btn-gold" onClick={onClose}>¡Qué bien!</button>
        </div>
      </div>
    </div>
  );
}
