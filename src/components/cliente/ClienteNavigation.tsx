"use client";
import Link from "next/link";
import ClientNavIcon, { type ClientNavIconName } from "./ClientNavIcon";
import styles from "./ClienteNavigation.module.css";
const ITEMS: Array<{ path: string; label: string; icon: ClientNavIconName }> = [
  { path: "dashboard", label: "Inicio", icon: "home" },
  { path: "precios-ofertas", label: "Precios y ofertas", icon: "offers" },
  { path: "rangos", label: "Rangos del cliente", icon: "ranks" },
  { path: "oraculo", label: "Oráculo", icon: "oracle" },
  { path: "ruleta", label: "Ruleta", icon: "roulette" },
  { path: "sorteo", label: "Sorteo", icon: "raffle" },
  { path: "tarotistas", label: "Tarotistas", icon: "readers" },
  { path: "resenas", label: "Reseñas", icon: "reviews" },
  { path: "ritual", label: "Mi ritual", icon: "ritual" },
  { path: "notificaciones", label: "Notificaciones", icon: "notifications" },
  { path: "perfil", label: "Perfil", icon: "profile" },
];
type Props = { pathname: string; promoActive: boolean; ritualAccess: boolean; unreadNotifications: number; onLogout: () => void | Promise<void> };
export default function ClienteNavigation({ pathname, promoActive, ritualAccess, unreadNotifications, onLogout }: Props) {
  const unread = Math.max(0, Math.floor(Number(unreadNotifications) || 0));
  return <nav className={styles.navigation} data-leo-anchor="navigation" aria-label="Secciones del panel de cliente">
    {ITEMS.filter(item => item.path !== "ritual" || ritualAccess).map(item => {
      const href = `/cliente/${item.path}`;
      const active = pathname === href || pathname.startsWith(href + "/");
      return <Link key={item.path} href={href} className={styles.item} data-tone={item.icon} aria-current={active ? "page" : undefined}>
        <span className={styles.art}><ClientNavIcon name={item.icon}/></span>
        <span className={styles.label}>{item.label}</span>
        {item.icon === "offers" && promoActive && <span className={styles.promo}>HOY</span>}
        {item.icon === "notifications" && unread > 0 && <span className={styles.badge} aria-label={`${unread} notificaciones sin leer`}>{unread > 99 ? "99+" : unread}</span>}
        {active && <span className={styles.activeMark} aria-hidden="true"/>}
      </Link>;
    })}
    <button type="button" className={`${styles.item} ${styles.exit}`} data-tone="logout" onClick={onLogout}>
      <span className={styles.art}><ClientNavIcon name="logout"/></span><span className={styles.label}>Salir</span>
    </button>
  </nav>;
}