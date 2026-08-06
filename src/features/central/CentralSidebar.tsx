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
            const notificationAlert = item.key === "notificaciones" && typeof item.badge === "number" && item.badge > 0;
            return (
              <button
                key={item.key}
                className={`tc-sidebtn ${active ? "tc-sidebtn-active" : ""}`}
                style={notificationAlert ? {
                  borderColor: "rgba(255, 75, 95, .72)",
                  background: "linear-gradient(135deg, rgba(130, 20, 42, .34), rgba(68, 20, 78, .24))",
                  boxShadow: "0 0 0 1px rgba(255, 68, 92, .12), 0 10px 28px rgba(164, 21, 49, .22)",
                } : undefined}
                onClick={() => onTabChange(item.key)}
                type="button"
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  <div className="tc-chip" style={{
                    width: 38,
                    height: 38,
                    display: "grid",
                    placeItems: "center",
                    padding: 0,
                    color: notificationAlert ? "#ff657b" : undefined,
                    borderColor: notificationAlert ? "rgba(255, 80, 104, .58)" : undefined,
                    boxShadow: notificationAlert ? "0 0 18px rgba(255, 64, 96, .32)" : undefined,
                  }}>
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
                      background: "linear-gradient(135deg, #ff294f, #c3123f)",
                      color: "white",
                      fontSize: 11,
                      fontWeight: 900,
                      boxShadow: "0 0 0 1px rgba(255,255,255,.16), 0 6px 18px rgba(255, 35, 75, .42)",
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
