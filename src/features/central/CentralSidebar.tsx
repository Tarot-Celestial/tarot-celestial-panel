"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import NavigationVisibilityMenu, { useHiddenNavigation } from "@/components/navigation/NavigationVisibilityMenu";
import styles from "./CentralSidebar.module.css";

export type CentralNavItem<T extends string = string> = {
  key: T;
  label: string;
  icon: LucideIcon;
  kicker?: string;
  badge?: number;
  children?: Array<{
    key: T;
    label: string;
    kicker?: string;
  }>;
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
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const { hiddenKeys, toggleHidden, resetHidden } = useHiddenNavigation("tc:navigation:hidden:central:v1");
  const visibleItems = items.filter((item) => !hiddenKeys.includes(String(item.key)));

  useEffect(() => {
    const activeParent = items.find((item) => item.children?.some((child) => child.key === activeTab));
    if (activeParent) {
      setOpenGroups((current) => ({ ...current, [String(activeParent.key)]: true }));
    }
  }, [activeTab, items]);

  return (
    <aside className={`tc-sidebar ${styles.sidebar}`}>
      <div className={`tc-sidebar-card ${styles.sidebarCard}`}>
        <div className={styles.titleRow}>
          <div className={`tc-sidebar-title ${styles.sidebarTitle}`}>Navegación centrales</div>
          <NavigationVisibilityMenu
            panelName="Centrales"
            items={items.map((item) => ({ key: String(item.key), label: item.label }))}
            hiddenKeys={hiddenKeys}
            onToggle={toggleHidden}
            onReset={resetHidden}
          />
        </div>
        <div className="tc-sidebar-nav">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const key = String(item.key);
            const hasChildren = Boolean(item.children?.length);
            const childActive = Boolean(item.children?.some((child) => child.key === activeTab));
            const active = activeTab === item.key || childActive;
            const expanded = hasChildren && (openGroups[key] ?? childActive);
            const notificationAlert = key === "notificaciones" && typeof item.badge === "number" && item.badge > 0;
            const tone = navTone(key, notificationAlert);
            const toneStyle = { "--nav-rgb": tone.rgb } as CSSProperties;
            return (
              <div key={item.key} className={hasChildren ? styles.navGroup : undefined}>
                <button
                  className={[
                    "tc-sidebtn",
                    styles.navButton,
                    active ? `tc-sidebtn-active ${styles.navButtonActive}` : "",
                    tone.className === "invoice" ? styles.invoiceButton : "",
                    tone.className === "alert" ? styles.alertButton : "",
                  ].filter(Boolean).join(" ")}
                  style={toneStyle}
                  onClick={() => {
                    onTabChange(item.key);
                    if (hasChildren) setOpenGroups((current) => ({ ...current, [key]: true }));
                  }}
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
                  {hasChildren ? (
                    <span
                      className={`${styles.chevron} ${expanded ? styles.chevronOpen : ""}`}
                      role="button"
                      aria-label={expanded ? "Cerrar submenú" : "Abrir submenú"}
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpenGroups((current) => ({ ...current, [key]: !expanded }));
                      }}
                    >
                      <ChevronDown size={16} />
                    </span>
                  ) : typeof item.badge === "number" && item.badge > 0 ? (
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
                {hasChildren ? (
                  <div className={`${styles.subnav} ${expanded ? styles.subnavOpen : ""}`} style={toneStyle}>
                    {item.children?.map((child) => {
                      const isActive = activeTab === child.key;
                      return (
                        <button
                          key={child.key}
                          type="button"
                          className={`${styles.subButton} ${isActive ? styles.subButtonActive : ""}`}
                          onClick={() => onTabChange(child.key)}
                        >
                          <span className={styles.subDot} />
                          <span>
                            <b>{child.label}</b>
                            {child.kicker ? <small>{child.kicker}</small> : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
