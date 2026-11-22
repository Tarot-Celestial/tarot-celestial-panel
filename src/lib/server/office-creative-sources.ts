import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { officeDepartments } from '@/features/office/catalog';
import { brainNodes } from '@/features/brain/celestial-brain-data';

type Failure = 'waiting_input' | 'waiting_connection' | 'needs_reconciliation' | 'failed' | 'limit_reached';
export type CreativeUsage = { model: string; input_tokens: number; output_tokens: number; estimated_cost_usd: number; response_id: string };
export class OfficeCreativeError extends Error {
  constructor(public status: Failure, message: string, public usage?: CreativeUsage) { super(message); }
}
const inputRequired = (message: string): never => { throw new OfficeCreativeError('waiting_input', message); };
const normalized = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[_-]/g, ' ');
const fingerprint = (s: string) => createHash('sha256').update(s).digest('hex');
const terms = /\b(?:promo(?:cion(?:es|al)?|s)?|ofertas?|descuentos?|precios?|tarifas?|paquetes?|packs?|rebajas?|gratis|eur|usd|euros?|dolares?)\b|\b\d+(?:[.,]\d+)?\s*(?:minutos?|min)\b|[$€%]/i;
export function commercialCopy(s: string) { return terms.test(normalized(s)); }
const topics = ['Oficina Celestial · Marketing', 'Oficina Celestial · Marca', 'Oficina Celestial · Instagram'];
type Task = { id: string; objective: string; expected_delivery: string; time_zone: string; revision?: number };
type Source = { id: string; version: string; label: string; text: string; approved_by?: string; updated_at?: string };
type Offer = { market: string; currency: string; promotion_id: string; package_id: string; source_fingerprint: string; promotion_version: string; package_version: string; price: number; paid: number; free: number; name: string; conditions: string; starts_at: string | null; ends_at: string | null; time_zone: string };
export type SourceSnapshot = { sources: Source[]; offer: Offer | null; promotion_id: string | null; market: string | null; currency: string | null; channel: 'instagram' };

async function checked<T>(query: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new OfficeCreativeError('waiting_connection', 'No se pudo comprobar la fuente de Oficina. Revisa la conexión y vuelve a iniciar el encargo.');
  return data;
}

async function officeKnowledge(db: any): Promise<Source[]> {
  const brain = brainNodes.find(n => n.id === 'core')!;
  const marketing = officeDepartments.find(d => d.id === 'marketing')!;
  const artPath = 'src/lib/server/office-art/brand-sky.jpg';
  const artwork = await readFile(path.join(process.cwd(), artPath));
  const sources: Source[] = [
    { id: 'cerebro:core', version: fingerprint(brain.description), label: brain.title, text: brain.description },
    { id: 'oficina:marketing', version: fingerprint(marketing.purpose), label: marketing.name, text: marketing.purpose },
    { id: 'public/Nuevo-logo-tarot.png', version: '1f58d3e58e6d878a49c7abd1d251ec6f3b468132034bedc2408ba8f7ad51b637', label: 'Marca de Tarot Celestial', text: 'La marca utilizada por el panel es Tarot Celestial.' },
    { id: artPath, version: createHash('sha256').update(artwork).digest('hex'), label: 'Plantilla de la pieza de Instagram', text: 'Fondo gráfico de marca con nebulosa y emblema de Tarot Celestial.' },
  ];
  // Only the latest explicitly approved version of each Office topic can leave Central.
  const records = await Promise.all(topics.map(topic => checked<any[]>(db.from('central_assistant_knowledge')
    .select('id,topic,content,version,approved_by,created_at').eq('topic', topic).not('approved_by', 'is', null)
    .order('version', { ascending: false }).limit(1))));
  for (const [row] of records) if (row) sources.push({ id: String(row.id), version: String(row.version), label: row.topic, text: row.content, approved_by: row.approved_by, updated_at: row.created_at });
  return sources;
}

const marketAliases: Record<string, string[]> = {
  es: ['españa', 'spain'], pr: ['puerto rico'], us: ['estados unidos', 'eeuu', 'usa'], do: ['república dominicana'],
};
function marketMatches(market: string, request: string) {
  const key = normalized(market).trim();
  const marked = request.match(/\bmercado\s*[:=]\s*([^,\n.;]{1,65})/)?.[1]?.trim();
  if (marked === key || marked?.startsWith(key + ' ')) return true;
  const aliases = Object.entries(marketAliases).find(([code, names]) => code === key || names.map(normalized).includes(key))?.[1] || [];
  const names = [...new Set([...aliases.map(normalized), ...(key.length >= 4 ? [key] : [])])];
  return names.some(name => (' ' + request.replace(/[^\p{L}\p{N} ]/gu, ' ') + ' ').includes(' ' + name + ' '));
}

async function scopeLive(db: any, scope: { promotion_id: string; market: string; currency: string }) {
  return checked<boolean>(db.rpc('office_promotion_scope_live', { p_promotion_id: scope.promotion_id, p_market: scope.market, p_currency: scope.currency, p_channel: 'instagram' }));
}
async function liveOffer(db: any, request: string, zone: string): Promise<Offer> {
  const clean = normalized(request);
  const currencies = [/\beur(?:os?)?\b|€/i.test(clean) && 'EUR', /\busd\b|\bdolares? estadounidenses?\b/i.test(clean) && 'USD'].filter(Boolean);
  if (currencies.length !== 1) inputRequired('Indica una sola moneda explícita (EUR o USD) y el mercado de la tarifa.');
  const scopes = await checked<any[]>(db.from('office_promotion_scopes').select('promotion_id,market,currency,source_fingerprint,approved_at')
    .eq('channel', 'instagram').eq('enabled', true).eq('currency', currencies[0]).order('approved_at', { ascending: false }).limit(51));
  if (scopes.length > 50) inputRequired('Hay demasiadas ofertas aprobadas para este canal. Acota los ámbitos activos en el catálogo.');
  const candidates = scopes.filter(scope => marketMatches(scope.market, clean));
  if (!candidates.length) inputRequired('Falta un mercado explícito con una promoción aprobada para Instagram y esa moneda.');
  if (new Set(candidates.map(s => s.market)).size !== 1) inputRequired('Indica un único mercado para la campaña.');
  const approved = (await Promise.all(candidates.map(async scope => await scopeLive(db, scope) ? scope : null))).filter(Boolean);
  if (!approved.length) inputRequired('La promoción del mercado solicitado ha caducado, ha cambiado o necesita aprobación.');
  const ids = approved.map(s => s.promotion_id);
  const [headers, packages] = await Promise.all([
    checked<any[]>(db.from('tc_client_promotions').select('id,name,description,status,starts_at,ends_at,active_until_disabled,authorized_rank,max_uses_per_client,updated_at').in('id', ids)),
    checked<any[]>(db.from('tc_client_promotion_packages').select('id,name,promotion_id,description,price,currency,paid_minutes,free_minutes,updated_at').in('promotion_id', ids).eq('currency', currencies[0]).eq('is_active', true)),
  ]);
  const offers = packages.flatMap(pack => {
    const h = headers.find(row => row.id === pack.promotion_id);
    const sc = approved.find(row => row.promotion_id === pack.promotion_id);
    if (!h || !sc) return [];
    const packNamed = pack.name && clean.includes(normalized(pack.name));
    const promotionNamed = h.name && clean.includes(normalized(h.name));
    return [{ pack, h, sc, match: packNamed ? 2 : promotionNamed ? 1 : 0 }];
  });
  const bestMatch = Math.max(0, ...offers.map(o => o.match));
  const choices = offers.filter(o => o.match === bestMatch);
  if (choices.length !== 1) inputRequired('Indica el paquete exacto de la promoción aprobada; se requiere una sola tarifa vigente para esta pieza.');
  const { h, pack, sc } = choices[0];
  const expiry = h.active_until_disabled ? null : h.ends_at;
  if (!expiry && !h.active_until_disabled) inputRequired('El catálogo debe confirmar la fecha final o indicar expresamente que la oferta se mantiene hasta desactivarla.');
  const now = Date.now();
  if (!['active', 'scheduled'].includes(h.status) || (h.starts_at && !(Date.parse(h.starts_at) <= now)) || (expiry && !(Date.parse(expiry) > now))) inputRequired('La promoción no está vigente en este momento.');
  if (!Number.isFinite(Number(pack.price)) || Number(pack.price) <= 0 || !Number.isInteger(pack.paid_minutes) || !Number.isInteger(pack.free_minutes) || pack.paid_minutes < 0 || pack.free_minutes < 0) inputRequired('La tarifa aprobada contiene cifras incompletas.');
  const conditions = [...new Set([h.description, pack.description, h.authorized_rank && 'Rango ' + h.authorized_rank,
    h.max_uses_per_client && 'Máximo ' + h.max_uses_per_client + ' por cliente'].filter(Boolean))].join(' · ');
  return { market: sc.market, currency: sc.currency, promotion_id: h.id, package_id: pack.id, source_fingerprint: sc.source_fingerprint,
    promotion_version: h.updated_at, package_version: pack.updated_at, price: Number(pack.price), paid: pack.paid_minutes, free: pack.free_minutes,
    name: pack.name, conditions, starts_at: h.starts_at, ends_at: expiry, time_zone: zone };
}

export async function readOfficeSources(db: any, task: Task, correction = ''): Promise<SourceSnapshot> {
  const request = [task.objective, task.expected_delivery, correction].filter(Boolean).join('\n');
  const scopeRequest = request.replace(/\bsin (?:precios?|promociones?|ofertas?|descuentos?)(?:\s+(?:ni|y)\s+(?:precios?|promociones?|ofertas?|descuentos?))*/gi, '');
  const offer = commercialCopy(scopeRequest) ? await liveOffer(db, request, task.time_zone) : null;
  const sources = await officeKnowledge(db);
  if (offer) sources.push({ id: offer.package_id, version: offer.source_fingerprint, label: 'Catálogo aprobado de promociones', text: offer.name, updated_at: offer.package_version });
  return { sources, offer, promotion_id: offer?.promotion_id || null, market: offer?.market || null, currency: offer?.currency || null, channel: 'instagram' };
}

export async function validateOfficeSources(db: any, _task: Task, brief: any) {
  const snapshot: SourceSnapshot = brief?.source_snapshot ?? brief;
  if (!Array.isArray(snapshot?.sources) || !snapshot.sources.length || snapshot.channel !== 'instagram') inputRequired('Falta la referencia de fuentes del briefing de Atlas.');
  const live = await officeKnowledge(db);
  const original = snapshot.sources.filter(s => s.id !== snapshot.offer?.package_id);
  if (live.length !== original.length || live.some(s => !original.some(o => o.id === s.id && o.version === s.version && o.text === s.text))) inputRequired('Las fuentes de la Oficina han cambiado. Inicia una nueva revisión del encargo.');
  if (snapshot.offer) {
    const offer = snapshot.offer;
    const scope = await checked<any>(db.from('office_promotion_scopes').select('source_fingerprint').eq('promotion_id', offer.promotion_id).eq('market', offer.market).eq('currency', offer.currency).eq('channel', 'instagram').eq('enabled', true).maybeSingle());
    if (!scope || scope.source_fingerprint !== offer.source_fingerprint || !await scopeLive(db, offer)) inputRequired('La oferta aprobada ha caducado o ha cambiado. Comprueba el catálogo antes de producir la pieza.');
  }
}
