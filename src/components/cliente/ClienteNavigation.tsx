"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ArrowUpRight, LogOut } from "lucide-react";
import ClientNavIcon, { type ClientNavIconName } from "./ClientNavIcon";
import styles from "./ClienteNavigation.module.css";
type Item = { path: string; label: string; description: string; icon: ClientNavIconName };
const GROUPS: { id: string; label: string; description: string; icon: ClientNavIconName; items: Item[] }[] = [
 { id: "consultar", label: "Tarotistas", description: "Lecturas y reseñas", icon: "readers", items: [
  { path: "tarotistas", label: "Tarotistas", description: "Encuentra tu conexión", icon: "readers" },
  { path: "resenas", label: "Reseñas", description: "Valora la atención recibida", icon: "reviews" }] },
 { id: "camino", label: "Mi camino", description: "Rango y ritual", icon: "ranks", items: [
  { path: "rangos", label: "Mi rango", description: "Tus ventajas y tu recorrido", icon: "ranks" },
  { path: "ritual", label: "Mi ritual", description: "Acompaña cada etapa", icon: "ritual" }] },
 { id: "experiencias", label: "Experiencias", description: "Cartas y premios", icon: "oracle", items: [
  { path: "oraculo", label: "Oráculo", description: "Tus cartas y lecturas", icon: "oracle" },
  { path: "ruleta", label: "Mi ruleta", description: "Tus giros y premios", icon: "roulette" },
  { path: "sorteo", label: "Mi sorteo", description: "Tus números y los resultados", icon: "raffle" }] },
 { id: "cuenta", label: "Mi cuenta", description: "Perfil y avisos", icon: "profile", items: [
  { path: "perfil", label: "Perfil", description: "Tus datos y preferencias", icon: "profile" },
  { path: "notificaciones", label: "Notificaciones", description: "Novedades de tu cuenta", icon: "notifications" }] },
];
type Props = { pathname: string; promoActive: boolean; ritualAccess: boolean; unreadNotifications: number; onLogout: () => void | Promise<void> };
export default function ClienteNavigation({ pathname, promoActive, ritualAccess, unreadNotifications, onLogout }: Props) {
 const [open, setOpen] = useState<string | null>(null);
 const nav = useRef<HTMLElement>(null);
 const dropdown = useRef<HTMLDivElement>(null);
 const focusDestination = useRef(false);
 const triggers = useRef<Record<string, HTMLButtonElement | null>>({});
 const unread = Math.max(0, Math.floor(Number(unreadNotifications) || 0));
 const selected = GROUPS.find(group => group.id === open);
 const active = (path: string) => pathname === "/cliente/" + path || pathname.startsWith("/cliente/" + path + "/");
 useEffect(() => { setOpen(null); }, [pathname, ritualAccess]);
 useEffect(() => {
  if (open && focusDestination.current) {
   focusDestination.current = false;
   dropdown.current?.querySelector<HTMLAnchorElement>("a")?.focus();
  }
 }, [open]);
 useEffect(() => {
  if (!open) return;
  const outside = (event: PointerEvent) => { if (!nav.current?.contains(event.target as Node)) setOpen(null); };
  const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(null); triggers.current[open]?.focus(); } };
  document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
  return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
 }, [open]);
 return <nav ref={nav} className={styles.navigation} data-leo-anchor="navigation" aria-label="Secciones del panel de cliente" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(null); }}>
  <Link href="/cliente/precios-ofertas" className={styles.priceLink} aria-label="Precios y ofertas" aria-describedby="client-nav-prices-detail" aria-current={active("precios-ofertas") ? "page" : undefined} onClick={() => setOpen(null)}>
   <span className={styles.priceArt}><ClientNavIcon name="offers" /></span>
   <span className={styles.priceCopy}><strong>Precios y ofertas</strong><small id="client-nav-prices-detail">{promoActive ? <><span className={styles.offerDot} aria-hidden="true" />Oferta activa disponible</> : "Minutos y paquetes"}</small></span>
   <ArrowUpRight size={19} className={styles.priceArrow} aria-hidden="true" />
  </Link>
  <div className={styles.rail}>
   <Link href="/cliente/dashboard" className={styles.item} aria-label="Inicio" aria-current={active("dashboard") ? "page" : undefined} onClick={() => setOpen(null)}><span className={styles.art}><ClientNavIcon name="home" /></span><span className={styles.itemCopy}><strong>Inicio</strong><small>Tu espacio</small></span></Link>
   {GROUPS.map(group => <button key={group.id} ref={element => { triggers.current[group.id] = element; }} type="button" className={styles.item} data-active={group.items.some(item => active(item.path))} aria-label={group.label} aria-describedby={"client-nav-description-" + group.id + (group.id === "cuenta" && unread > 0 ? " client-nav-unread" : "")} aria-expanded={open === group.id} aria-controls={open === group.id ? "client-nav-" + group.id : undefined} onClick={event => {
    if (event.detail === 0 && open !== group.id) focusDestination.current = true;
    setOpen(value => value === group.id ? null : group.id);
   }} onKeyDown={event => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    if (open === group.id) dropdown.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    else { focusDestination.current = true; setOpen(group.id); }
   }}>
    <span className={styles.art}><ClientNavIcon name={group.icon} /></span><span className={styles.itemCopy}><strong>{group.label}</strong><small id={"client-nav-description-" + group.id}>{group.id === "camino" && !ritualAccess ? "Tu rango celestial" : group.description}</small></span><ChevronDown className={styles.chevron} size={13} aria-hidden="true" />
    {group.id === "cuenta" && unread > 0 && <span id="client-nav-unread" className={styles.badge} aria-label={unread + " notificaciones sin leer"}>{unread > 99 ? "99+" : unread}</span>}
   </button>)}
  </div>
  <span className={styles.scrollHint} aria-hidden="true">Desliza el menú para ver más <ChevronRight size={16}/></span>
  {selected && <div ref={dropdown} id={"client-nav-" + selected.id} className={styles.dropdown} data-group={selected.id} aria-label={selected.label}>
   <span className={styles.caption}>{selected.label}</span>
   {selected.items.filter(item => item.path !== "ritual" || ritualAccess).map(item => <Link key={item.path} href={"/cliente/" + item.path} className={styles.destination} aria-current={active(item.path) ? "page" : undefined} onClick={() => setOpen(null)}>
    <span className={styles.destinationArt}><ClientNavIcon name={item.icon} /></span><span><strong>{item.label}</strong><small>{item.description}</small></span><ArrowUpRight size={15} aria-hidden="true" />
   </Link>)}
   {selected.id === "cuenta" && <button className={styles.logout} type="button" onClick={() => { setOpen(null); void onLogout(); }}><LogOut size={16} aria-hidden="true" /> Cerrar sesión</button>}
  </div>}
 </nav>;
}
