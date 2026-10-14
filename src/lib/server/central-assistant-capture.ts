import { normalizeText, validUuid, type AssistantResult } from '@/lib/central-assistant';
import { originMatchesBrand } from './brand-filter';
import { madridMidnightUtc, madridTodayKey } from './madrid-reporting-period';
import { AssistantError, type AssistantContext } from './central-assistant';

export type CapturePeriod = { from: string; to: string };
type CaptureRequest = CapturePeriod | { clarification: string };
const DAY_MS = 86400000;
const PAGE_SIZE = 500;
const MAX_ROWS = 50000;

function shiftDay(day: string, offset: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);
}
function validDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function capturePeriod(raw: unknown, now = new Date()) {
  const value = raw as Partial<CapturePeriod> | null;
  if (!validDay(value?.from) || !validDay(value?.to)) throw new AssistantError('Indica fechas reales en formato AAAA-MM-DD.');
  const { from, to } = value;
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
  if (days < 1 || days > 366) throw new AssistantError('Elige un intervalo ordenado de entre 1 y 366 días.');
  if (to > madridTodayKey(now)) throw new AssistantError('Solo puedo contar altas registradas hasta hoy; elige un período que no esté en el futuro.');
  return { from, to, days, start: madridMidnightUtc(from).toISOString(), endExclusive: madridMidnightUtc(shiftDay(to, 1)).toISOString() };
}

export function parseCaptureRequest(question: string, tab = '', now = new Date()): CaptureRequest | null {
  const text = normalizeText(question);
  const quantity = /\b(cuantos|cuantas|cantidad|total|recuento|conteo|estadisticas|contar)\b|\bcuenta (?:los|las)\b/.test(text);
  const subject = /\bcaptacion\b/.test(text) || (tab === 'captacion' && /\b(contactos|numeros|leads|clientes|altas|entradas|entraron|entrado|llegaron)\b/.test(text));
  if (!quantity || !subject) return null;
  const clarify = (clarification: string): CaptureRequest => ({ clarification });
  if (/\b(manana|proxima|proximo)\b/.test(text)) return clarify('Puedo contar altas ya registradas. Indica hoy, ayer o un intervalo de fechas hasta hoy.');
  const explicit = text.match(/\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{4})\b/g) || [];
  let from: string | undefined, to: string | undefined;
  if (explicit.length) {
    if (explicit.length > 2) return clarify('Indica una fecha o un intervalo con fecha inicial y final.');
    const dates = explicit.map(value => {
      const parts = value.split(/[/-]/);
      const [year, month, day] = parts[0].length === 4 ? parts : [parts[2], parts[1], parts[0]];
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    });
    [from, to] = [dates[0], dates[1] || dates[0]];
  } else {
    const today = madridTodayKey(now), recent = text.match(/\bultimos?\s+(\d+)\s+dias?\b/);
    if (recent) {
      const days = Number(recent[1]);
      if (days < 1 || days > 366) return clarify('Elige un intervalo de entre 1 y 366 días.');
      from = shiftDay(today, 1 - days); to = today;
    } else {
      const offsets = [...(/\banteayer\b/.test(text) ? [-2] : []), ...(/\bayer\b/.test(text) ? [-1] : []), ...(/\bhoy\b/.test(text) ? [0] : [])];
      if (offsets.length) { from = shiftDay(today, Math.min(...offsets)); to = shiftDay(today, Math.max(...offsets)); }
    }
  }
  if (!from || !to) return clarify('¿Qué período quieres contar en Captación: hoy, ayer o un intervalo como «del 12/10/2026 al 14/10/2026»?');
  try { capturePeriod({ from, to }, now); return { from, to }; }
  catch (error) { return clarify(error instanceof Error ? error.message : 'Revisa las fechas del período.'); }
}

export async function captureSummary(ctx: AssistantContext, raw: unknown, now = new Date()): Promise<AssistantResult> {
  const period = capturePeriod(raw, now), updatedAt = now.toISOString();
  if (!validUuid(ctx.worker.id) || !['central', 'admin'].includes(ctx.worker.role)) throw new AssistantError('No tienes acceso a Captación.', 403);
  // Captación requires an explicitly active central/admin. Recheck that same
  // worker, rather than broadening the scope to every identity in the portfolio.
  const actor = await ctx.db.from('workers').select('id,role,is_active').eq('id', ctx.worker.id).maybeSingle();
  if (actor.error) throw new AssistantError('No he podido verificar el acceso a Captación. Vuelve a intentarlo.', 503);
  if (actor.data?.is_active !== true || !['central', 'admin'].includes(actor.data.role)) throw new AssistantError('No tienes acceso a Captación.', 403);
  const role = actor.data.role;
  const end = period.endExclusive < updatedAt ? period.endExclusive : updatedAt;
  const rows = new Map<string, any>();
  let expected: number | undefined;
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    let query = ctx.db.from('captacion_leads')
      .select('id,created_at,origen,assigned_worker_id,cliente:crm_clientes(origen)', { count: 'exact' })
      .gte('created_at', period.start).lt('created_at', end);
    if (role === 'central') query = query.or(`assigned_worker_id.is.null,assigned_worker_id.eq.${ctx.worker.id}`);
    const page = await query.order('created_at').order('id').range(offset, offset + PAGE_SIZE - 1);
    if (page.error || !Array.isArray(page.data) || typeof page.count !== 'number' || !Number.isSafeInteger(page.count) || page.count < 0) throw new AssistantError('No he podido consultar las altas de Captación. Vuelve a intentarlo; no puedo confirmar una cifra.', 503);
    if (expected !== undefined && expected !== page.count) throw new AssistantError('Las altas de Captación cambiaron durante la consulta. Vuelve a pedir el recuento.', 409);
    expected = page.count;
    if (expected > MAX_ROWS) throw new AssistantError('Hay demasiadas altas para este intervalo. Reduce el período.', 422);
    for (const row of page.data) rows.set(String(row.id), row);
    if (offset + page.data.length >= expected) break;
    if (page.data.length < PAGE_SIZE) throw new AssistantError('No he podido obtener el recuento completo de Captación. Vuelve a intentarlo.', 503);
  }
  // Never count a repeated page twice or claim a partial page set is complete.
  if (rows.size !== expected) throw new AssistantError('El recuento de Captación no está completo. Vuelve a intentarlo.', 503);
  const daily = new Map<string, number>();
  for (let day = period.from; day <= period.to; day = shiftDay(day, 1)) daily.set(day, 0);
  let total = 0;
  for (const row of rows.values()) {
    if (role === 'central' && row.assigned_worker_id && String(row.assigned_worker_id) !== ctx.worker.id) continue;
    const client = Array.isArray(row.cliente) ? row.cliente[0] : row.cliente;
    if (!originMatchesBrand(client?.origen || row.origen, 'celestial')) continue;
    const date = new Date(row.created_at);
    if (!Number.isFinite(date.getTime()) || date.toISOString() < period.start || date.toISOString() >= end) throw new AssistantError('Las fechas del recuento de Captación no son válidas. Vuelve a intentarlo.', 503);
    const day = madridTodayKey(date);
    daily.set(day, (daily.get(day) || 0) + 1); total++;
  }
  const scope = role === 'admin' ? 'Todas las altas de Tarot Celestial accesibles como administrador.' : 'Tu ámbito de Captación: altas sin asignar o asignadas a ti.';
  const label = period.from === period.to ? period.from : `${period.from} a ${period.to}`;
  const breakdown = [...daily].map(([day, count]) => `${day}: ${count}`).join(' · ');
  return {
    text: `${label} (Europe/Madrid): ${total} altas registradas en Captación.${period.days > 1 ? ` Por día: ${breakdown}.` : ''} ${scope} Se cuenta cada alta una vez, en cualquier estado; no son teléfonos únicos ni formularios recibidos de Meta.`,
    total, updatedAt,
    cards: [{ id: `capture:${period.from}:${period.to}`, title: `${total} altas en Captación`, detail: `${breakdown}. ${scope} Fecha de alta en Captación, Europe/Madrid.`, tab: 'captacion', priority: 'info', source: 'Captación · captacion_leads.created_at' }],
  };
}
