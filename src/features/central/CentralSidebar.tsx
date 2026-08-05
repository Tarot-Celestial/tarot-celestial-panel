"use client";

import type { LucideIcon } from "lucide-react";

export type CentralNavItem<T extends string = string> = {
  key: T;
  label: string;
  icon: LucideIcon;
  kicker?: string;
  badge?: number;
};

type CentralSidebarProps<T extends string = string> = {
  items: CentralNavItem<T>[];
  activeTab: T;
  onTabChange: (tab: T) => void;
};

export default function CentralSidebar<T extends string = string>({ items, activeTab, onTabChange }: CentralSidebarProps<T>) {
  return (
    <aside className="tc-sidebar">
      <div className="tc-sidebar-card">
        <div className="tc-sidebar-title">Navegación centrales</div>
        <div className="tc-sidebar-nav">
          {items.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                className={`tc-sidebtn ${active ? "tc-sidebtn-active" : ""}`}
                onClick={() => onTabChange(item.key)}
                type="button"
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <div className="tc-chip" style={{ width: 38, height: 38, display: "grid", placeItems: "center", padding: 0 }}>
                    <Icon size={16} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="tc-sidebtn-main">{item.label}</div>
                    <div className="tc-sidebtn-kicker">{item.kicker}</div>
                  </div>
                </div>
                {typeof item.badge === "number" && item.badge > 0 ? (
                  <span
                    aria-label={`${item.badge} notificaciones pendientes`}
                    style={{
                      minWidth: 24,
                      height: 24,
                      padding: "0 7px",
                      borderRadius: 999,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "linear-gradient(135deg, #ff4f78, #9b5cff)",
                      color: "white",
                      fontSize: 11,
                      fontWeight: 900,
                      boxShadow: "0 6px 16px rgba(177, 77, 255, .28)",
                    }}
                  >
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                ) : (
                  <span className="tc-sidebtn-dot" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
