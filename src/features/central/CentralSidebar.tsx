"use client";

import { useEffect, useId, useState, type CSSProperties } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import NavigationVisibilityMenu, { useHiddenNavigation } from "@/components/navigation/NavigationVisibilityMenu";
import styles from "./CentralSidebar.module.css";

export type CentralNavItem<T extends string = string> = {
  key: T;
  label: string;
  icon: LucideIcon;
  kicker?: string;
  badge?: number;
  badgeStale?: boolean;
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
  "primera-tarotista": { rgb: "238, 197, 92" },
  captacion: { rgb: "245, 158, 11" },
  incidencias: { rgb: "239, 106, 106" },
  checklist: { rgb: "93, 214, 167" },
  rendimiento: { rgb: "110, 168, 255" },
  habituales: { rgb: "192, 132, 252" },
  whatsapp: { rgb: "37, 211, 102" },
  instagram: { rgb: "232, 117, 179" },
};

const NAV_SECTIONS = [
  { key: "turno", title: "MI TURNO", keys: ["central", "panel", "reservas", "notificaciones", "primera-tarotista", "checklist", "llamadas", "diario"] },
  { key: "clientas", title: "CLIENTAS Y SEGUIMIENTO", keys: ["mis-clientas", "recuperar-clientes", "crm", "whatsapp", "instagram", "captacion", "incidencias", "habituales"] },
  { key: "equipo", title: "EQUIPO", keys: ["equipo", "chat"] },
  { key: "progreso", title: "PROGRESO Y RECOMPENSAS", keys: ["tu-sistema-xp", "tu-sistema-xp-niveles", "tu-sistema-xp-coins", "tienda", "mi-factura", "sorteo", "rendimiento", "ranking"] },
] as const;
const SECTION_KEYS = new Set<string>(NAV_SECTIONS.flatMap(section => [...section.keys]));
const NAV_LABELS: Record<string, string> = { central: "Resumen", panel: "Panel de llamadas" };

function navTone(key: string, notificationAlert: boolean) {
  if (notificationAlert) return { rgb: "255, 66, 91", className: "alert" };
  return NAV_TONES[key] || { rgb: "215, 181, 109" };
}

export default function CentralSidebar<T extends string = string>({ items, activeTab, onTabChange }: CentralSidebarProps<T>) {
  const sidebarId = useId().replace(/:/g, "");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [chatUnread, setChatUnread] = useState(0);
  const { hiddenKeys, toggleHidden, resetHidden } = useHiddenNavigation("tc:navigation:hidden:central:v1");
  const visibleItems = items.filter((item) => !hiddenKeys.includes(String(item.key)) || (String(item.key) === "captacion" && (item.badge || 0) > 0));
  const sections = NAV_SECTIONS.map(section => ({
    ...section,
    items: section.keys.flatMap(key => visibleItems.filter(item => String(item.key) === key)),
  }));
  const extraItems = visibleItems.filter(item => !SECTION_KEYS.has(String(item.key)));
  const visibleSections = [...sections, { key: "otros", title: "MÁS APARTADOS", items: extraItems }].filter(section => section.items.length);

  useEffect(() => {
    const activeParent = items.find((item) => item.children?.some((child) => child.key === activeTab));
    if (activeParent) {
      setOpenGroups((current) => ({ ...current, [String(activeParent.key)]: true }));
    }
  }, [activeTab, items]);

  useEffect(() => {
    const update = (event: Event) => setChatUnread(Math.max(0, Number((event as CustomEvent<{ count?: number }>).detail?.count || 0)));
    window.addEventListener("tc-chat-unread", update as EventListener);
    return () => window.removeEventListener("tc-chat-unread", update as EventListener);
  }, []);

  return (
    <aside className={`tc-sidebar ${styles.sidebar}`}>
      <div className={`tc-sidebar-card ${styles.sidebarCard}`}>
        <div className={styles.titleRow}>
          <div className={styles.sidebarTitle}>Tu central</div>
          <NavigationVisibilityMenu
            panelName="Centrales"
            items={items.map((item) => ({ key: String(item.key), label: item.label }))}
            hiddenKeys={hiddenKeys}
            onToggle={toggleHidden}
            onReset={resetHidden}
          />
        </div>
        <nav className={styles.navigation} aria-label="Navegación de Central">
          {visibleSections.map(section => <section className={styles.section} key={section.key} aria-labelledby={`${sidebarId}-${section.key}`}>
          <h2 id={`${sidebarId}-${section.key}`} className={styles.sectionTitle}>{section.title}</h2>
          <div className={styles.sectionItems}>{section.items.map((item) => {
            const Icon = item.icon;
            const key = String(item.key);
            const hasChildren = Boolean(item.children?.length);
            const childActive = Boolean(item.children?.some((child) => child.key === activeTab));
            const active = activeTab === item.key || childActive;
            const expanded = hasChildren && (openGroups[key] ?? childActive);
            const notificationAlert = key === "notificaciones" && typeof item.badge === "number" && item.badge > 0;
            const captacionUrgent = key === "captacion" && typeof item.badge === "number" && item.badge > 0;
            const tone = navTone(key, notificationAlert || captacionUrgent);
            const toneStyle = { "--nav-rgb": tone.rgb } as CSSProperties;
            const label = NAV_LABELS[key] || item.label;
            const submenuId = `${sidebarId}-submenu-${key}`;
            return (
              <div key={item.key} className={hasChildren ? styles.navGroup : undefined}>
                <div className={styles.navRow} style={toneStyle}>
                <button
                  data-companion-nav={item.key}
                  data-captacion-pending={captacionUrgent ? item.badge : undefined}
                  className={[
                    styles.navButton,
                    active ? styles.navButtonActive : "",
                    tone.className === "invoice" ? styles.invoiceButton : "",
                    tone.className === "alert" ? styles.alertButton : "",
                    captacionUrgent ? styles.captacionUrgent : "",
                  ].filter(Boolean).join(" ")}
                  style={toneStyle}
                  onClick={() => {
                    onTabChange(item.key);
                    if (hasChildren) setOpenGroups((current) => ({ ...current, [key]: true }));
                  }}
                  type="button"
                  aria-current={activeTab === item.key ? "page" : undefined}
                  aria-label={captacionUrgent ? `Captación: ${item.badge} contactos nuevos pendientes${item.badgeStale ? ", pendiente de actualizar" : ""}` : undefined}
                  title={captacionUrgent ? (item.badgeStale ? "Último recuento confirmado. Recuperando la conexión." : "Hay contactos nuevos pendientes. Atiéndelos ahora.") : undefined}
                >
                  <div className={styles.navContent}>
                    <div className={styles.iconHud} aria-hidden="true">
                      <Icon size={21} strokeWidth={1.7} />
                    </div>
                    <div className={styles.labelWrap}>
                      <span className={styles.label}>{label}</span>
                      {item.kicker && <span className={styles.kicker}>{item.kicker}</span>}
                    </div>
                  </div>
                  {typeof item.badge === "number" && item.badge > 0 ? (
                    <span
                      aria-label={captacionUrgent ? `${item.badge} contactos nuevos pendientes` : `${item.badge} notificaciones pendientes`}
                      className={`${styles.badge} ${captacionUrgent ? styles.captacionBadge : ""}`}
                    >
                      {captacionUrgent ? item.badge : item.badge > 99 ? "99+" : item.badge}
                    </span>
                  ) : (
                    <span className={styles.dot} aria-hidden="true" />
                  )}
                </button>
                {hasChildren && <button type="button" className={`${styles.chevron} ${expanded ? styles.chevronOpen : ""}`} aria-expanded={expanded} aria-controls={submenuId} aria-label={`${expanded ? "Cerrar" : "Abrir"} submenú ${item.label}`} onClick={() => setOpenGroups(current => ({ ...current, [key]: !expanded }))}><ChevronDown size={16} /></button>}
                </div>
                {hasChildren ? (
                  <div id={submenuId} className={`${styles.subnav} ${expanded ? styles.subnavOpen : ""}`} style={toneStyle} hidden={!expanded}>
                    {item.children?.map((child) => {
                      const isActive = activeTab === child.key;
                      return (
                        <button
                          key={child.key}
                          data-companion-nav={child.key}
                          type="button"
                          className={`${styles.subButton} ${isActive ? styles.subButtonActive : ""}`}
                          aria-current={isActive ? "page" : undefined}
                          onClick={() => onTabChange(child.key)}
                        >
                          <span className={styles.subDot} />
                          <span>
                            <b>{child.label}</b>
                            {String(child.key) === "chat" && chatUnread > 0 ? <em className={styles.badge}>{chatUnread > 99 ? "99+" : chatUnread}</em> : null}
                            {child.kicker ? <small>{child.kicker}</small> : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}</div></section>)}
        </nav>
      </div>
    </aside>
  );
}
