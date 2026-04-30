"use client";

import type { CSSProperties } from "react";

type CentralHeroProps = {
  statusLabel: string;
  statusStyle: CSSProperties;
  statusTitle?: string;
  month: string;
  onMonthChange: (month: string) => void;
  onRefreshRanking: () => void;
  threadCount: number;
  activeTab: string;
};

export default function CentralHero({
  statusLabel,
  statusStyle,
  statusTitle,
  month,
  onMonthChange,
  onRefreshRanking,
  threadCount,
  activeTab,
}: CentralHeroProps) {
  return (
    <section className="tc-hero">
      <div className="tc-hero-top">
        <div>
          <div className="tc-hero-title">🎧 Central — Tarot Celestial</div>
          <div className="tc-hero-sub">Centro operativo premium para llamadas, reservas, chat, checklist y rendimiento del equipo en tiempo real.</div>
        </div>

        <div className="tc-row" style={{ flexWrap: "wrap", gap: 8 }}>
          <span className="tc-chip" style={{ ...statusStyle, padding: "6px 10px", borderRadius: 999, fontSize: 12 }} title={statusTitle}>
            {statusLabel}
          </span>
          <span className="tc-chip">Mes</span>
          <input
            className="tc-input"
            value={month}
            onChange={(e) => onMonthChange(e.target.value)}
            placeholder="2026-02"
            style={{ width: 120 }}
          />
          <button className="tc-btn tc-btn-gold" onClick={onRefreshRanking} type="button">
            Actualizar
          </button>
        </div>
      </div>

      <div className="tc-hero-kpis">
        <div className="tc-kpi-panel tc-kpi-panel-main">
          <div className="tc-kpi-label">Estado central</div>
          <div className="tc-kpi-value" style={{ fontSize: 24 }}>{statusLabel}</div>
          <div className="tc-kpi-note">Acceso rápido a tu estado operativo y al mes activo</div>
        </div>
        <div className="tc-kpi-panel">
          <div className="tc-kpi-label">Chats</div>
          <div className="tc-kpi-value">{String(threadCount || 0)}</div>
          <div className="tc-kpi-note">Conversaciones cargadas</div>
        </div>
        <div className="tc-kpi-panel">
          <div className="tc-kpi-label">Reservas</div>
          <div className="tc-kpi-value">{String(activeTab === "reservas" ? "Live" : "Activas")}</div>
          <div className="tc-kpi-note">Seguimiento operativo en tiempo real</div>
        </div>
        <div className="tc-kpi-panel">
          <div className="tc-kpi-label">Módulo activo</div>
          <div className="tc-kpi-value" style={{ fontSize: 20 }}>{String(activeTab).toUpperCase()}</div>
          <div className="tc-kpi-note">Vista lateral tipo software premium</div>
        </div>
      </div>
    </section>
  );
}
