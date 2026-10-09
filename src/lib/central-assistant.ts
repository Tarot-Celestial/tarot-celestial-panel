export type PetId = 'sol' | 'draco';
export type PetState = 'idle' | 'listening' | 'thinking' | 'working' | 'pointing' | 'celebrating' | 'concerned' | 'sleeping' | 'error' | 'walking' | 'break';
export const PETS = {
  sol: { name: 'Sol', accent: '#ffba66', description: 'Tu chispa para un gran turno', personality: 'Cálido, enérgico y bromista. Humor amable, breve y nunca insistente.' },
  draco: { name: 'Draco', accent: '#bca1ff', description: 'Una mirada atenta, siempre contigo', personality: 'Astuto, leal y tranquilo, con humor pícaro y respetuoso.' },
} as const;
export const ASSISTANT_SECTIONS: Record<string, { label: string; help: string }> = {
  central: { label: 'Inicio', help: 'Revisemos pendientes y decidamos por dónde empezar.' },
  'mis-clientas': { label: 'Mis clientas', help: 'Puedo buscar por prefijo, inactividad o afinidad con una tarotista.' },
  'recuperar-clientes': { label: 'Recuperar clientes', help: 'Busquemos personas de tu cartera con llamadas anteriores y un período de inactividad.' },
  notificaciones: { label: 'Notificaciones', help: 'Revisemos novedades y seguimientos pendientes.' },
  'mi-factura': { label: 'Mi factura', help: 'Consulta aquí los importes y conceptos de tu factura.' },
  'tu-sistema-xp': { label: 'Mi progreso', help: 'Te explico el XP usando la configuración disponible.' },
  'tu-sistema-xp-niveles': { label: 'Niveles', help: 'Revisa requisitos y recompensas de cada nivel.' },
  'tu-sistema-xp-coins': { label: 'Coins', help: 'Comprobemos saldo y reglas de conversión antes de canjear.' },
  tienda: { label: 'Tienda', help: 'Revisa condiciones y saldo antes de confirmar un canje.' },
  panel: { label: 'Panel operativo', help: 'Estoy aquí si necesitas consultar algo mientras gestionas las llamadas.' },
  equipo: { label: 'Equipo', help: 'Consulta la disponibilidad del equipo y sus pendientes.' },
  crm: { label: 'CRM', help: 'Puedo localizar clientes de tu cartera y abrir su ficha.' },
  sorteo: { label: 'Sorteo', help: 'Aquí puedes consultar los sorteos del panel.' },
  chat: { label: 'Chat', help: 'Puedes coordinarte con el equipo desde aquí.' },
  reservas: { label: 'Reservas', help: 'Revisa fechas, disponibilidad y reservas próximas.' },
  'primera-tarotista': { label: 'Primera tarotista', help: 'Consulta las reservas para una primera atención.' },
  captacion: { label: 'Captación', help: 'Preparemos propuestas explicables, respetando asignaciones y contactos pendientes.' },
  incidencias: { label: 'Incidencias', help: 'Confirma si el tiempo pendiente se ha recuperado o justificado antes de resolver.' },
  checklist: { label: 'Checklist', help: 'Revisa lo que queda por completar durante tu turno.' },
  rendimiento: { label: 'Rendimiento', help: 'Compara períodos equivalentes y distingue ingresos, comisiones y coins.' },
  habituales: { label: 'Habituales', help: 'Consulta las relaciones habituales entre clientes y tarotistas.' },
  ranking: { label: 'Ranking', help: 'Consulta el progreso del equipo con el período indicado.' },
};
export type AssistantCard = { id: string; title: string; detail: string; tab: string; clientId?: string; date?: string; priority: 'attention' | 'info' | 'success'; source?: string };
export type AssistantProposal = ({ type: 'memory'; topic: string; content: string } | { type: 'task'; title: string; kind: 'reminder'|'inactive'|'opportunities'; due_at: string; recurrence:'none'|'daily'|'weekly'; days:number }) & { operationId?:string };
export type AssistantResult = { text: string; cards: AssistantCard[]; updatedAt: string; total?: number; page?: number; pages?: number; query?: ClientQuery; unavailable?: string[]; proposal?: AssistantProposal };
export type ClientQuery = { kind: 'inactive' | 'prefix' | 'affinity' | 'opportunities'; days: number; prefix: string; tarotist: string; metric: 'calls' | 'minutes'; page: number };
export type AssistantTask = { id: string; title: string; kind: 'reminder' | 'inactive' | 'opportunities'; due_at: string; recurrence: 'none' | 'daily' | 'weekly'; status: string; result?: AssistantResult; last_error?: string; days: number };
export type AssistantMemory = { id: string; topic: string; content: string; updated_at: string };
export type Preferences = { motion: boolean; humor: boolean; proactive: boolean; sound: boolean };
export const DEFAULT_PREFERENCES: Preferences = { motion: true, humor: true, proactive: true, sound: false };
export function normalizeText(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
export function dayKey(now = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
export function madridDayEnd(now = new Date()) {
  const [y,m,d] = dayKey(now).split('-').map(Number); const desired = Date.UTC(y,m-1,d+1); let instant = desired;
  for (let i=0;i<4;i++) { const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant)).map(p=>[p.type,p.value])); const represented=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute),Number(parts.second));instant+=desired-represented; }
  return new Date(instant).toISOString();
}
export function safeTab(tab: unknown): tab is string { return typeof tab === 'string' && Object.hasOwn(ASSISTANT_SECTIONS, tab); }
export function validUuid(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
export function normalizePhone(value: unknown) { const raw = String(value || '').trim(); const digits = raw.replace(/\D/g, ''); return raw.startsWith('00') ? '+' + digits.slice(2) : raw.startsWith('+') ? '+' + digits : digits.length > 9 ? '+' + digits : digits; }
export function parseClientQuery(text: string): ClientQuery | null {
  const q = normalizeText(text); const days = Math.min(3650, Math.max(1, Number(q.match(/(\d+)\s*dias?/)?.[1] || 30)));
  const base: ClientQuery = { kind: 'inactive', days, prefix: '+34', tarotist: '', metric: 'calls', page: 1 };
  if (/captacion|oportunidad|recuperar cliente/.test(q)) return { ...base, kind: 'opportunities' };
  if (/\+\d{1,4}|prefijo|clientes.*espana/.test(q)) return { ...base, kind: 'prefix', prefix: q.match(/\+\d{1,4}/)?.[0] || '+34' };
  if (/no.*llamad|inactiv|sin llamar/.test(q)) return base;
  if (/tarotista|luna/.test(q) && /mas|utiliz|consulta|cliente/.test(q)) return { ...base, kind: 'affinity', tarotist: text.match(/tarotista\s+([\p{L}\s-]+?)(?:[.,?!]|$)/iu)?.[1]?.trim() || (/luna/.test(q) ? 'Luna' : ''), metric: /minuto/.test(q) ? 'minutes' : 'calls' };
  return null;
}
export function validateQuery(value: any): ClientQuery {
  if (!value || !['inactive', 'prefix', 'affinity', 'opportunities'].includes(value.kind)) throw new Error('Consulta no válida.');
  const days = Number(value.days ?? 30), page = Number(value.page ?? 1);
  if (!Number.isInteger(days) || days < 1 || days > 3650 || !Number.isInteger(page) || page < 1 || page > 10000) throw new Error('Período o página no válidos.');
  const prefix = String(value.prefix || '+34'); if (!/^\+\d{1,4}$/.test(prefix)) throw new Error('Prefijo no válido.');
  return { kind: value.kind, days, page, prefix, tarotist: String(value.tarotist || '').slice(0, 80), metric: value.metric === 'minutes' ? 'minutes' : 'calls' };
}
export function safePosition(x: number, y: number, width: number, height: number, size = 136) {
  return { x: Math.max(8, Math.min(Math.max(8, width - size - 8), x)), y: Math.max(72, Math.min(Math.max(72, height - size - 52), y)) };
}
export function selectClientResults(clients: any[], calls: any[], query: ClientQuery, now = new Date(), tarotistId?: string) {
  const cutoff = now.getTime() - query.days * 86400000;
  const byClient = new Map<string, any[]>();
  for (const call of calls) {
    const date = Date.parse(call.fecha_hora || call.created_at || '');
    if (!(Number(call.tiempo) > 0) || !Number.isFinite(date) || date > now.getTime()) continue;
    const list = byClient.get(String(call.cliente_id)) || []; list.push({ ...call, date }); byClient.set(String(call.cliente_id), list);
  }
  let neverCalled = 0;
  const rows = clients.flatMap(client => {
    const history = byClient.get(String(client.id)) || [];
    const last = history.length ? Math.max(...history.map(c => c.date)) : null;
    if (!last) neverCalled++;
    const filteredCalls = history.filter(c => c.date >= cutoff && (!tarotistId || String(c.tarotista_worker_id || c.tarotista_id) === tarotistId));
    const minutes = filteredCalls.reduce((n, c) => n + Number(c.tiempo), 0);
    const prefixMatch = [client.telefono, client.telefono_normalizado].some(p => normalizePhone(p).startsWith(query.prefix));
    const match = query.kind === 'prefix' ? prefixMatch : query.kind === 'affinity' ? filteredCalls.length > 0 : last !== null && last < cutoff;
    return match ? [{ client, last, count: filteredCalls.length, minutes, totalCalls: history.length }] : [];
  });
  rows.sort((a, b) => query.kind === 'affinity' ? (query.metric === 'minutes' ? b.minutes - a.minutes : b.count - a.count) : (a.last || 0) - (b.last || 0));
  return { rows, neverCalled };
}
