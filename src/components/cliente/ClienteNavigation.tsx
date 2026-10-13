"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ArrowUpRight, LogOut } from "lucide-react";
import ClientNavIcon, { type ClientNavIconName } from "./ClientNavIcon";
import styles from "./ClienteNavigation.module.css";
type Item = { path: string; label: string; description: string; icon: ClientNavIconName };
const GROUPS: { id: string; label: string; icon: ClientNavIconName; items: Item[] }[] = [
 { id: "consultar", label: "Consultar", icon: "readers", items: [
  { path: "tarotistas", label: "Tarotistas", description: "Encuentra tu conexión", icon: "readers" },
  { path: "precios-ofertas", label: "Precios y ofertas", description: "Paquetes y beneficios disponibles", icon: "offers" }] },
 { id: "camino", label: "Mi camino", icon: "ranks", items: [
  { path: "rangos", label: "Mi rango", description: "Tus ventajas y tu recorrido", icon: "ranks" },
  { path: "ritual", label: "Mi ritual", description: "Acompaña cada etapa", icon: "ritual" }] },
 { id: "experiencias", label: "Experiencias", icon: "oracle", items: [
  { path: "oraculo", label: "Oráculo", description: "Tus cartas y lecturas", icon: "oracle" },
  { path: "ruleta", label: "Mi ruleta", description: "Tus giros y premios", icon: "roulette" },
  { path: "sorteo", label: "Mi sorteo", description: "Tus números y los resultados", icon: "raffle" }] },
 { id: "cuenta", label: "Mi cuenta", icon: "profile", items: [
  { path: "perfil", label: "Perfil", description: "Tus datos y preferencias", icon: "profile" },
  { path: "notificaciones", label: "Notificaciones", description: "Novedades de tu cuenta", icon: "notifications" },
  { path: "resenas", label: "Reseñas", description: "Valora la atención recibida", icon: "reviews" }] },
];
type Props = { pathname: string; promoActive: boolean; ritualAccess: boolean; unreadNotifications: number; onLogout: () => void | Promise<void> };
export default function ClienteNavigation({ pathname, promoActive, ritualAccess, unreadNotifications, onLogout }: Props) {
 const [open, setOpen] = useState<string | null>(null);
 const nav = useRef<HTMLElement>(null);
 const triggers = useRef<Record<string, HTMLButtonElement | null>>({});
 const unread = Math.max(0, Math.floor(Number(unreadNotifications) || 0));
 const selected = GROUPS.find(group => group.id === open);
 const active = (path: string) => pathname === "/cliente/" + path || pathname.startsWith("/cliente/" + path + "/");
 useEffect(() => { setOpen(null); }, [pathname, ritualAccess]);
 useEffect(() => {
  if (!open) return;
  const outside = (event: PointerEvent) => { if (!nav.current?.contains(event.target as Node)) setOpen(null); };
  const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(null); triggers.current[open]?.focus(); } };
  document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
  return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
 }, [open]);
 return <nav ref={nav} className={styles.navigation} data-leo-anchor="navigation" aria-label="Secciones del panel de cliente" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(null); }}>
  <div className={styles.rail}>
   <Link href="/cliente/dashboard" className={styles.item} aria-current={active("dashboard") ? "page" : undefined} onClick={() => setOpen(null)}><span className={styles.art}><ClientNavIcon name="home" /></span><span>Inicio</span></Link>
   {GROUPS.map(group => <button key={group.id} ref={element => { triggers.current[group.id] = element; }} type="button" className={styles.item} data-active={group.items.some(item => active(item.path))} aria-expanded={open === group.id} aria-controls={open === group.id ? "client-nav-" + group.id : undefined} onClick={() => setOpen(value => value === group.id ? null : group.id)}>
    <span className={styles.art}><ClientNavIcon name={group.icon} /></span><span>{group.label}</span><ChevronDown className={styles.chevron} size={12} />
    {group.id === "consultar" && promoActive && <span className={styles.dot} aria-label="Promoción disponible" />}
    {group.id === "cuenta" && unread > 0 && <span className={styles.badge} aria-label={unread + " notificaciones sin leer"}>{unread > 99 ? "99+" : unread}</span>}
   </button>)}
  </div>
  {selected && <div id={"client-nav-" + selected.id} className={styles.dropdown} aria-label={selected.label}>
   <span className={styles.caption}>{selected.label}</span>
   {selected.items.filter(item => item.path !== "ritual" || ritualAccess).map(item => <Link key={item.path} href={"/cliente/" + item.path} className={styles.destination} aria-current={active(item.path) ? "page" : undefined} onClick={() => setOpen(null)}>
    <span className={styles.destinationArt}><ClientNavIcon name={item.icon} /></span><span><strong>{item.label}</strong><small>{item.description}</small></span><ArrowUpRight size={15} />
   </Link>)}
   {selected.id === "cuenta" && <button className={styles.logout} type="button" onClick={() => { setOpen(null); void onLogout(); }}><LogOut size={16} /> Cerrar sesión</button>}
  </div>}
 </nav>;
}
