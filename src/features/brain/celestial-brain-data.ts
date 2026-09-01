export type BrainStatus = "stable" | "attention" | "error" | "realtime" | "automation" | "unknown";

export type BrainNode = {
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  status: BrainStatus;
  position: { x: number; y: number };
  components: string[];
  apis: string[];
  data: string[];
  realtime: string[];
  timers: string[];
  inputs: string[];
  outputs: string[];
  importance: string;
  impact: string;
  sources: string[];
  lastChecked: string;
  recentErrors: string[];
  children: string[];
};

export const statusMeta: Record<BrainStatus, { label: string; color: string }> = {
  stable: { label: "Estable", color: "#49e39a" },
  attention: { label: "Requiere atención", color: "#f4c45e" },
  error: { label: "Error detectado", color: "#ff667f" },
  realtime: { label: "Tiempo real", color: "#57c9ff" },
  automation: { label: "Automatización", color: "#ad7cff" },
  unknown: { label: "Sin auditar", color: "#87909f" },
};

export const brainNodes: BrainNode[] = [
  {
    id: "core",
    title: "Cerebro Celestial",
    eyebrow: "NÚCLEO DE ARQUITECTURA",
    description: "Mapa central de los sistemas auditados de Tarot Celestial. Esta vista observa la arquitectura sin ejecutar procesos operativos.",
    status: "stable",
    position: { x: 760, y: 430 },
    components: ["AppHeader", "OpsProvider", "ReservasGlobalWatcher", "PaymentMotivationWatcher"],
    apis: ["188 rutas API detectadas"],
    data: ["Supabase · proyecto eparrucwxmebscsgvldj"],
    realtime: ["39 canales creados en el código", "106 manejadores postgres_changes"],
    timers: ["45 temporizadores detectados en el código"],
    inputs: ["Panel admin", "Panel central", "Panel tarotista", "Panel cliente"],
    outputs: ["Operación", "Alertas", "Datos", "Recompensas", "Facturación"],
    importance: "Crítica",
    impact: "Una degradación transversal puede afectar acceso, presencia, reservas y operaciones de los paneles.",
    sources: ["src/app/layout.tsx", "src/components/AppHeader.tsx", "src/context/OpsProvider.tsx"],
    lastChecked: "1 sep 2026 · auditoría del ZIP",
    recentErrors: ["No se detectaron errores propios de esta vista."],
    children: ["clients", "team", "realtime", "xp", "billing", "infra"],
  },
  {
    id: "clients",
    title: "Clientes y CRM",
    eyebrow: "RELACIÓN CON CLIENTES",
    description: "Fichas, captación, seguimientos, reservas, sorteos y avisos relacionados con cada cliente.",
    status: "attention",
    position: { x: 180, y: 90 },
    components: ["CRMClientesPanel", "ClientCapturesAdminPanel", "ReservasPanel", "ReservasGlobalWatcher"],
    apis: ["/api/crm/clientes/*", "/api/crm/reservas/*", "/api/central/raffle", "/api/cliente/raffle"],
    data: ["crm_clientes", "crm_client_followups", "crm_client_capture_assignments", "reservas", "raffles", "raffle_entries"],
    realtime: ["Reservas próximas", "Seguimientos", "Cambios en fichas", "Sorteos"],
    timers: ["Comprobación ligera de reservas próximas"],
    inputs: ["Centrales", "Panel cliente", "Captación"],
    outputs: ["Notificaciones", "Reservas", "Historial CRM", "Participaciones"],
    importance: "Crítica",
    impact: "Una vinculación incorrecta impide mostrar reservas, seguimientos o números de sorteo al cliente adecuado.",
    sources: ["src/components/crm/CRMClientesPanel.tsx", "src/components/reservas/ReservasGlobalWatcher.tsx", "src/app/api/cliente/raffle/route.ts"],
    lastChecked: "1 sep 2026 · código y esquema",
    recentErrors: ["Las tablas públicas relacionadas requieren una auditoría separada de políticas RLS."],
    children: ["Fichas", "Seguimientos", "Reservas", "Sorteos", "Notificaciones"],
  },
  {
    id: "realtime",
    title: "Operación en tiempo real",
    eyebrow: "MONITOR LIGERO",
    description: "Presencia, estados de trabajo, llamadas, leads, alertas urgentes y notificaciones que deben seguir vivas.",
    status: "attention",
    position: { x: 105, y: 430 },
    components: ["OpsProvider", "AppHeader", "GlobalBottomBar", "ReservasGlobalWatcher"],
    apis: ["/api/attendance/*", "/api/notifications/*", "/api/crm/reservas/ready"],
    data: ["attendance_state", "attendance_events", "notifications", "captacion_leads", "reservas", "chat_messages"],
    realtime: ["Presencia", "Leads", "Reservas", "Notificaciones", "Mensajes"],
    timers: ["Respaldo de notificaciones cada 120 s", "Comprobación de reservas", "Contadores operativos"],
    inputs: ["Supabase Realtime", "Eventos de asistencia", "Telefonía"],
    outputs: ["Barra superior", "Ventanas urgentes", "Contadores", "Estado operativo"],
    importance: "Crítica",
    impact: "Demasiadas suscripciones simultáneas pueden presionar el pool de conexiones y retrasar Auth o las alertas.",
    sources: ["src/context/OpsProvider.tsx", "src/components/AppHeader.tsx", "src/components/global/GlobalBottomBar.tsx"],
    lastChecked: "1 sep 2026 · auditoría estática",
    recentErrors: ["Historial reportado: timeouts y cola de conexiones Realtime."],
    children: ["Presencia", "Estados", "Llamadas", "Eventos urgentes", "Contadores"],
  },
  {
    id: "billing",
    title: "Facturación",
    eyebrow: "DINERO E HISTORIA",
    description: "Pagos, cobros diarios, facturas, líneas, contabilidad e historial de producción.",
    status: "stable",
    position: { x: 190, y: 770 },
    components: ["DashboardPanel", "DiarioPanel", "ManualInvoiceModal", "CollaboratorBillingReport"],
    apis: ["/api/admin/invoices/*", "/api/admin/dashboard", "/api/crm/*pagos*"],
    data: ["invoices", "invoice_lines", "manual_invoices", "crm_cliente_pagos", "accounting_entries", "rendimiento_llamadas"],
    realtime: ["Pagos confirmados", "Resumen diario"],
    timers: ["Actualizaciones de respaldo cuando la vista está activa"],
    inputs: ["Compras", "Rendimiento", "Ajustes manuales"],
    outputs: ["Facturas", "Diario", "Informes", "XP por compra"],
    importance: "Alta",
    impact: "Duplicados o referencias débiles pueden alterar importes, XP y cierres mensuales.",
    sources: ["src/components/diario/DiarioPanel.tsx", "src/components/admin/DashboardPanel.tsx", "src/app/admin/page.tsx"],
    lastChecked: "1 sep 2026 · auditoría estática",
    recentErrors: ["Sin error activo confirmado en este inventario."],
    children: ["Pagos", "Facturas", "Diario", "Contabilidad", "Historial"],
  },
  {
    id: "team",
    title: "Equipo y accesos",
    eyebrow: "PERSONAS Y ROLES",
    description: "Administradores, centrales, tarotistas, equipos, permisos, horarios y estado de asistencia.",
    status: "stable",
    position: { x: 1325, y: 90 },
    components: ["WorkersPanel", "AdminClientesTab", "AppHeader", "useAttendance"],
    apis: ["/api/me", "/api/admin/workers/*", "/api/attendance/*"],
    data: ["workers", "worker_schedules", "attendance_state", "attendance_events"],
    realtime: ["Presencia y cambios de estado"],
    timers: ["Heartbeat y refresco de asistencia"],
    inputs: ["Supabase Auth", "Administración", "Eventos operativos"],
    outputs: ["Permisos", "Equipo asignado", "Panel correspondiente", "Estado"],
    importance: "Crítica",
    impact: "Un rol o equipo incoherente puede bloquear accesos o atribuir resultados a la persona equivocada.",
    sources: ["src/app/admin/page.tsx", "src/lib/panel-access.ts", "src/hooks/useAttendance.ts"],
    lastChecked: "1 sep 2026 · código y esquema",
    recentErrors: ["Errores históricos corregidos de restricciones workers_team_check y tarotista_level."],
    children: ["Admins", "Centrales", "Tarotistas", "Equipos", "Horarios"],
  },
  {
    id: "xp",
    title: "XP y recompensas",
    eyebrow: "PROGRESIÓN",
    description: "Eventos de experiencia, reglas, niveles, rangos, misiones, recompensas y saldo de cada trabajador.",
    status: "attention",
    position: { x: 1400, y: 430 },
    components: ["XpSystemAdminPanel", "XpLevelsAdminPanel", "useCentralXpData", "PaymentMotivationWatcher"],
    apis: ["/api/xp/*", "/api/admin/xp/*"],
    data: ["worker_xp_events", "worker_xp_rules", "worker_xp_wallets", "worker_xp_rewards", "worker_xp_reward_claims", "worker_xp_reward_processing"],
    realtime: ["Eventos XP", "Carteras", "Premios", "Misiones"],
    timers: ["Respaldo de motivación cada 120 s", "Refrescos cuando la pestaña está activa"],
    inputs: ["Compras", "Llamadas", "Misiones", "Acciones operativas"],
    outputs: ["XP", "Rango", "Recompensas", "Notificaciones"],
    importance: "Alta",
    impact: "Un reintento sin idempotencia puede duplicar recompensas; las claves claim_id y operation_id deben seguir siendo únicas.",
    sources: ["src/features/central/useCentralXpData.ts", "src/components/admin/XpSystemAdminPanel.tsx", "src/components/motivation/PaymentMotivationWatcher.tsx"],
    lastChecked: "1 sep 2026 · auditoría estática",
    recentErrors: ["Historial: worker_xp_reward_processing.claim_id inexistente antes de la migración."],
    children: ["Eventos", "Reglas", "Niveles", "Misiones", "Recompensas"],
  },
  {
    id: "infra",
    title: "Infraestructura",
    eyebrow: "SERVICIOS EXTERNOS",
    description: "Servicios que alojan datos, autenticación, código y despliegues. La vista no los consulta de forma continua.",
    status: "attention",
    position: { x: 1315, y: 770 },
    components: ["Supabase", "Vercel", "GitHub"],
    apis: ["Supabase Auth / PostgREST / Realtime", "Vercel Functions", "GitHub integration"],
    data: ["Supabase eu-west-1 · PostgreSQL 17", "Vercel project nextjs-boilerplate", "GitHub Tarot-Celestial/tarot-celestial-panel"],
    realtime: ["La salud profunda se consulta bajo demanda, no desde este lienzo"],
    timers: ["Ninguno añadido por Cerebro Celestial"],
    inputs: ["Código GitHub", "Despliegue Vercel", "Datos Supabase"],
    outputs: ["Aplicación web", "APIs", "Auth", "Persistencia", "Realtime"],
    importance: "Crítica",
    impact: "Una degradación de base de datos puede manifestarse como fallos de acceso, sincronización y timeouts en cascada.",
    sources: ["GitHub: Tarot-Celestial/tarot-celestial-panel", "Vercel: prj_YLALQMWsmRPHM57nru1y5v8wCK0x", "Supabase: eparrucwxmebscsgvldj"],
    lastChecked: "1 sep 2026 · conectores oficiales",
    recentErrors: [
      "Hallazgo crítico: múltiples tablas públicas tienen RLS desactivado; requiere plan de políticas antes de activarlo.",
      "Supabase detecta índices duplicados y políticas permisivas repetidas que conviene depurar con una migración controlada.",
      "Auth está configurado con un máximo absoluto de 10 conexiones; Supabase recomienda asignación porcentual al escalar.",
    ],
    children: ["Supabase", "Vercel", "GitHub", "Auth", "Realtime"],
  },
];

export const brainConnections = brainNodes
  .filter((node) => node.id !== "core")
  .map((node) => ({ from: "core", to: node.id }));

export const auditSummary = [
  { value: "188", label: "rutas API" },
  { value: "39", label: "canales creados" },
  { value: "106", label: "eventos DB" },
  { value: "45", label: "temporizadores" },
];
