"use client";

import { useEffect, useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { ADMIN_NAV_GROUPS, type AdminTabKey } from "./admin-navigation";
import styles from "./AdminSidebar.module.css";

type Props = { activeTab: AdminTabKey; onTabChange: (tab: AdminTabKey) => void };

export default function AdminSidebar({ activeTab, onTabChange }: Props) {
  const id = useId().replace(/:/g, "");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const activeParent = ADMIN_NAV_GROUPS.flatMap(section => section.items)
      .find(item => item.children?.some(child => child.key === activeTab));
    if (activeParent) setOpenGroups(current => current[activeParent.key] ? current : { ...current, [activeParent.key]: true });
  }, [activeTab]);

  return (
    <aside className={`tc-sidebar ${styles.sidebar}`}>
      <div className={`tc-sidebar-card ${styles.sidebarCard}`}>
        <div className={styles.titleRow}>
          <span className={styles.title}>Tu administración</span>
          <span className={styles.subtitle}>Centro de mando</span>
        </div>
        <nav aria-label="Navegación de Administración" className={styles.navigation}>
          {ADMIN_NAV_GROUPS.map(section => (
            <section key={section.key} className={styles.section} aria-labelledby={`${id}-${section.key}`}>
              <h2 id={`${id}-${section.key}`} className={styles.sectionTitle}>{section.title}</h2>
              <div className={styles.sectionItems}>
                {section.items.map(item => {
                  const Icon = item.icon;
                  const childActive = Boolean(item.children?.some(child => child.key === activeTab));
                  const active = activeTab === item.key || childActive;
                  const expanded = Boolean(openGroups[item.key] ?? childActive);
                  const submenuId = `${id}-submenu-${item.key}`;
                  return (
                    <div key={item.key} className={styles.group} data-tone={item.tone}>
                      <div className={styles.navRow}>
                        <button
                          type="button"
                          className={`${styles.navButton} ${active ? styles.active : ""}`}
                          data-admin-nav={item.key}
                          aria-current={activeTab === item.key ? "page" : undefined}
                          onClick={() => {
                            onTabChange(item.key as AdminTabKey);
                            if (item.children) setOpenGroups(current => ({ ...current, [item.key]: true }));
                          }}
                        >
                          <Icon className={styles.icon} size={21} strokeWidth={1.7} aria-hidden="true" />
                          <span className={styles.copy}><span className={styles.label}>{item.label}</span><span className={styles.kicker}>{item.kicker}</span></span>
                          <span className={styles.dot} aria-hidden="true" />
                        </button>
                        {item.children && <button
                          type="button"
                          className={`${styles.chevron} ${expanded ? styles.chevronOpen : ""}`}
                          aria-label={`${expanded ? "Cerrar" : "Abrir"} submenú ${item.label}`}
                          aria-expanded={expanded}
                          aria-controls={submenuId}
                          onClick={() => setOpenGroups(current => ({ ...current, [item.key]: !expanded }))}
                        ><ChevronDown size={16} aria-hidden="true" /></button>}
                      </div>
                      {item.children && <div id={submenuId} className={styles.subnav} hidden={!expanded}>
                        {item.children.map(child => <button
                          key={child.key}
                          type="button"
                          className={`${styles.subButton} ${activeTab === child.key ? styles.subActive : ""}`}
                          data-admin-nav={child.key}
                          aria-current={activeTab === child.key ? "page" : undefined}
                          onClick={() => onTabChange(child.key as AdminTabKey)}
                        ><span className={styles.subDot} aria-hidden="true" /><span className={styles.copy}><span className={styles.subLabel}>{child.label}</span><span className={styles.kicker}>{child.kicker}</span></span></button>)}
                      </div>}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>
      </div>
    </aside>
  );
}
