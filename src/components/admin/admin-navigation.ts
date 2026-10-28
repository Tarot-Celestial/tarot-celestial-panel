import { BarChart3, BookOpen, CalendarDays, CreditCard, Flame, KeyRound, LayoutDashboard, Megaphone, MessageCircle, Phone, ReceiptText, ShieldCheck, Share2, Users, Trophy, Sparkles, type LucideIcon } from "lucide-react";

type AdminNavItem = {
  key: string;
  icon: LucideIcon;
  label: string;
  kicker: string;
  tone: string;
  children?: readonly { key: string; label: string; kicker: string }[];
};

// The existing tab keys are kept so bookmarks and panel callbacks remain valid.
export const ADMIN_NAV = [
  { key: "atlas", icon: Sparkles, label: "Atlas", kicker: "Tu mano derecha", tone: "goldPurple" },
  { key: "dashboard", icon: LayoutDashboard, label: "Dashboard", kicker: "Control ejecutivo", tone: "gold" },
  { key: "panel", icon: Phone, label: "Panel", kicker: "Extensiones y llamadas", tone: "cyan" },
  { key: "facturas", icon: CreditCard, label: "Facturación", kicker: "Ingresos y cierre", tone: "emerald" },
  { key: "client-balances", icon: Sparkles, label: "Giros y saldos", kicker: "Giros, Coins y minutos", tone: "gold" },
  { key: "welldone", icon: BarChart3, label: "WELLDONE", kicker: "Minutos y coste CALL", tone: "goldPurple" },
  { key: "rank-benefits", icon: Sparkles, label: "Beneficios de rangos y paquetes", kicker: "Coins y accesos por rango", tone: "goldPurple" },
  { key: "finance-center", icon: ReceiptText, label: "Factura de gastos, ingresos y ganancias", kicker: "Control económico y pendientes", tone: "goldPurple" },
  { key: "editor", icon: BookOpen, label: "Editor", kicker: "Factura abierta", tone: "violet" },
  { key: "estadisticas", icon: BarChart3, label: "Estadísticas", kicker: "Rendimiento global", tone: "blue" },
  { key: "estadisticas-centrales", icon: Users, label: "Estadísticas de centrales", kicker: "Progreso, jornada y extras", tone: "goldPurple" },
  { key: "equipos-marcador", icon: Flame, label: "Equipos marcador", kicker: "Fuego vs Agua", tone: "goldPurple" },
  { key: "asistencia", icon: ShieldCheck, label: "Asistencia", kicker: "Control operativo", tone: "mint" },
  { key: "incidencias", icon: ShieldCheck, label: "Incidencias", kicker: "Jornada y recuperaciones", tone: "goldPurple" },
  { key: "trabajadores", icon: KeyRound, label: "Trabajadores", kicker: "Roles y accesos", tone: "purple" },
  { key: "clientes", icon: Users, label: "Clientes", kicker: "Vista premium", tone: "violet" },
  { key: "pagos-web", icon: CreditCard, label: "Pagos web", kicker: "Mollie", tone: "gold" },
  { key: "precios-hoy", icon: Sparkles, label: "Precios de hoy", kicker: "Promociones y packs", tone: "goldPurple" },
  { key: "rangos-clientes", icon: Trophy, label: "Rangos de clientes", kicker: "Gestión y auditoría", tone: "goldPurple", children: [
    { key: "rangos-clientes", label: "Gestión de rangos", kicker: "Automático y temporal" },
    { key: "clientes-web", label: "Clientes web", kicker: "Accesos y cuentas" },
    { key: "ruletas-clientes", label: "Ruletas clientes", kicker: "Premios y probabilidades" },
    { key: "rituales-clientes", label: "Rituales clientes", kicker: "Progreso y experiencias" },
  ] },
  { key: "sistema-xp", icon: Sparkles, label: "Sistema de XP", kicker: "Niveles y recompensas", tone: "goldPurple", children: [
    { key: "sistema-xp", label: "Configuración XP", kicker: "Acciones y experiencia" },
    { key: "sistema-xp-niveles", label: "Sistema de niveles telefonista", kicker: "Niveles y recompensas" },
  ] },
  { key: "bonos-tarotistas", icon: Trophy, label: "Bonos tarotistas", kicker: "Retos y premios económicos", tone: "goldPurple", children: [
    { key: "bonos-tarotistas", label: "Bonos y retos", kicker: "Premios económicos" },
    { key: "rangos-tarotistas", label: "Rangos tarotistas", kicker: "C · B · A · S" },
  ] },
  { key: "crm", icon: LayoutDashboard, label: "CRM", kicker: "Fichas y cobros", tone: "magenta" },
  { key: "sorteo", icon: Trophy, label: "Sorteo", kicker: "Selección de ganadores", tone: "goldPurple" },
  { key: "chat", icon: MessageCircle, label: "Chat", kicker: "Consultas de pago", tone: "indigo" },
  { key: "captacion", icon: Megaphone, label: "Captación", kicker: "Leads y seguimiento", tone: "orange" },
  { key: "whatsapp", icon: MessageCircle, label: "WhatsApp", kicker: "Campañas y preparación", tone: "green" },
  { key: "campanas-clientes", icon: Megaphone, label: "Campañas", kicker: "Promociones y notificaciones", tone: "goldPurple" },
  { key: "redes-sociales", icon: Share2, label: "Redes sociales", kicker: "Instagram y TikTok", tone: "goldPurple", children: [
    { key: "redes-sociales-instagram", label: "Instagram", kicker: "Posts · Reels · Stories" },
    { key: "redes-sociales-tiktok", label: "TikTok", kicker: "Vídeos · Fotos · Programación" },
  ] },
  { key: "rendimiento", icon: BarChart3, label: "Rendimiento", kicker: "Llamadas registradas", tone: "blue" },
  { key: "reservas", icon: CalendarDays, label: "Reservas", kicker: "Agenda interna", tone: "gold" },
  { key: "diario", icon: CalendarDays, label: "Diario", kicker: "Compras del día", tone: "cyan" },
] as const satisfies readonly AdminNavItem[];

type RootItem = (typeof ADMIN_NAV)[number];
type ChildKey<T> = T extends { children: readonly { key: infer Key }[] } ? Key : never;
export type AdminTabKey = RootItem["key"] | ChildKey<RootItem>;

export const ADMIN_TAB_KEYS = new Set<string>(ADMIN_NAV.flatMap((item) => [
  item.key, ...("children" in item ? item.children.map(child => child.key) : []),
]));

export const ADMIN_NAV_SECTIONS = [
  { key: "resumen", title: "Resumen", keys: ["dashboard", "atlas", "estadisticas", "estadisticas-centrales"] },
  { key: "operativa", title: "Operativa diaria", keys: ["panel", "reservas", "diario", "rendimiento"] },
  { key: "clientas", title: "Clientas y seguimiento", keys: ["clientes", "crm", "captacion", "rangos-clientes"] },
  { key: "comunicacion", title: "Comunicación", keys: ["whatsapp", "chat", "campanas-clientes", "redes-sociales"] },
  { key: "equipo", title: "Equipo", keys: ["trabajadores", "asistencia", "incidencias", "equipos-marcador", "sistema-xp", "bonos-tarotistas"] },
  { key: "recompensas", title: "Precios y recompensas", keys: ["precios-hoy", "client-balances", "rank-benefits", "sorteo"] },
  { key: "finanzas", title: "Finanzas", keys: ["facturas", "finance-center", "welldone", "editor", "pagos-web"] },
] as const satisfies readonly { key: string; title: string; keys: readonly RootItem["key"][] }[];

const itemsByKey = new Map<string, AdminNavItem>(ADMIN_NAV.map(item => [item.key, item]));
export const ADMIN_NAV_GROUPS = ADMIN_NAV_SECTIONS.map(section => ({
  ...section,
  items: section.keys.map(key => itemsByKey.get(key)!),
}));
