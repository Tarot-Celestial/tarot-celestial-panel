"use client";

import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import styles from "./CentralSidebar.module.css";

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

type NavTone = { rgb: string; className?: string };

const NAV_TONES: Record<string, NavTone> = {
  central: { rgb: "232, 199, 118" },
  "mis-clientas": { rgb: "154, 124, 255" },
  notificaciones: { rgb: "230, 92, 131" },
  "mi-factura": { rgb: "62, 229, 139", className: "invoice" },
  "tu-sistema-xp": { rgb: "205, 157, 255" },
  panel: { rgb: "102, 166, 255" },
  equipo: { rgb: "129, 140, 248" },
  crm: { rgb: "168, 85, 247" },
  reservas: { rgb: "217, 185, 110" },
  captacion: { rgb: "245, 158, 11" },
  incidencias: { rgb: "239, 106, 106" },
  checklist: { rgb: "93, 214, 167" },
  rendimiento: { rgb: "110, 168, 255" },
  habituales: { rgb: "192, 132, 252" },
};

function navTone(key: string, notificationAlert: boolean) {
  if (notificationAlert) return { rgb: "255, 66, 91", className: "alert" };
  return NAV_TONES[key] || { rgb: "215, 181, 109" };
}

export default function CentralSidebar<T extends string = string>({ items, activeTab, onTabChange }: CentralSidebarProps<T>) {
  return (
    <aside className={`tc-sidebar ${styles.sidebar}`}>
      <div className={`tc-sidebar-card ${styles.sidebarCard}`}>
        <div className={`tc-sidebar-title ${styles.sidebarTitle}`}>Navegación centrales</div>
        <div className="tc-sidebar-nav">
          {items.map((item) => {
            const Icon = item.icon;
            const key = String(item.key);
            const active = activeTab === item.key;
            const notificationAlert = key === "notificaciones" && typeof item.badge === "number" && item.badge > 0;
            const tone = navTone(key, notificationAlert);
            const toneStyle = { "--nav-rgb": tone.rgb } as CSSProperties;
            return (
              <button
                key={item.key}
                className={[
                  "tc-sidebtn",
                  styles.navButton,
                  active ? `tc-sidebtn-active ${styles.navButtonActive}` : "",
                  tone.className === "invoice" ? styles.invoiceButton : "",
                  tone.className === "alert" ? styles.alertButton : "",
                ].filter(Boolean).join(" ")}
                style={toneStyle}
                onClick={() => onTabChange(item.key)}
                type="button"
              >
                <div className={styles.navContent}>
                  <div className={`tc-chip ${styles.iconHud}`}>
                    <Icon size={17} strokeWidth={2.1} />
                  </div>
                  <div className={styles.labelWrap}>
                    <div className="tc-sidebtn-main">{item.label}</div>
                    <div className="tc-sidebtn-kicker">{item.kicker}</div>
                  </div>
                </div>
                {typeof item.badge === "number" && item.badge > 0 ? (
                  <span
                    aria-label={`${item.badge} notificaciones pendientes`}
                    className={styles.badge}
                  >
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                ) : (
                  <span className={`tc-sidebtn-dot ${styles.dot}`} />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
