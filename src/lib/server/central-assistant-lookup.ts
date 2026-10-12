import { normalizeText, parseClientQuery, type AssistantResult } from '@/lib/central-assistant';

export type LookupRequest = { name: 'client_lookup' | 'raffle_numbers' | 'client_followups'; query: string };

// Parse the specific-client request before portfolio filters: +34 in a full phone
// number identifies a person here, not every person with that country prefix.
export function parseLookupRequest(question: string): LookupRequest | null {
  const normalized = normalizeText(question);
  const name = /\b(sorteo|rifa|participaciones)\b/.test(normalized) ? 'raffle_numbers'
    : /\bseguimientos?\b/.test(normalized) && !/\b(resumen|pendientes)\b/.test(normalized) ? 'client_followups'
    : /\b(ficha|localiza|encuentra)\b|\b(busca|buscame|buscar)\b/.test(normalized) && !/\b(inactiv|prefijo|oportunidad|captacion|recuperar)|sin llamar|no.*llamad/.test(normalized) ? 'client_lookup' : null;
  if (!name) return null;
  const identifier = question.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i)?.[0];
  if (identifier) return { name, query: identifier };
  const phone = question.match(/(?:\+|00)?\d[\d ()-]{5,}\d/);
  if (phone) return { name, query: phone[0].trim() };
  if (name === 'client_lookup' && /\b(?:clientes|clientas)\b/.test(normalized) && parseClientQuery(question)) return null;
  let query = question.trim().replace(/[¿?!.,]+$/g, '').replace(/\s+por favor$/i, '');
  if (name === 'raffle_numbers') query = query.replace(/^.*?\b(?:sorteo|rifa|participaciones)\b\s*(?:actual\s*)?(?:(?:que\s+tiene|para|de)\s*)?/i, '');
  else if (name === 'client_followups') query = query.replace(/^.*?\bseguimientos?\b\s*(?:(?:para|de)\s*)?/i, '');
  else query = query.replace(/^(?:por favor\s+)?(?:busca(?:me|r)?|b[uú]scame|localiza|encuentra|abre|dame|muestra(?:me)?|mu[eé]strame)\s*/i, '').replace(/^(?:la\s+)?ficha\s*(?:de\s*)?/i, '').replace(/^a\s+/i, '');
  query = query.replace(/^(?:la|el|mi|un|una)\s+client[ea]\s*/i, '').replace(/^(?:la|el)\s+/i, '').trim();
  if (/^(?:(?:esa|ese|esta|este|la|el)\s+)?client[ea]$|^(ella|el|esa|ese|esta|este|sus?|su ficha)?$/.test(normalizeText(query))) query = '';
  return { name, query };
}

export function matchClients(clients: any[], raw: string): any[] {
  const query = normalizeText(raw).replace(/\s+/g, ' ');
  if (!query) return [];
  const exactId = clients.filter(c => String(c.id).toLowerCase() === query);
  if (exactId.length) return exactId;
  const digits = query.replace(/\D/g, '');
  if (/^[+\d\s()-]+$/.test(query) && digits.length >= 4) {
    const needle = digits.startsWith('00') ? digits.slice(2) : digits;
    return clients.filter(c => [c.telefono, c.telefono_normalizado].some(p => String(p || '').replace(/\D/g, '').endsWith(needle)));
  }
  if (query.includes('@')) return clients.filter(c => normalizeText(String(c.email || '')) === query);
  const tokens = query.split(/\s+/).filter(Boolean);
  return clients.filter(c => {
    const parts = normalizeText([c.nombre, c.apellido].filter(Boolean).join(' ')).split(/\s+/);
    return tokens.every(token => parts.some(part => part === token || (token.length >= 3 && part.startsWith(token))));
  });
}

export function lastClientReference(results: Array<AssistantResult | null | undefined>): string | undefined {
  // Only use the latest client-bearing answer. A list of candidates is ambiguous;
  // never skip it and silently bind a pronoun to an older, unrelated client.
  const latest = results[0];
  const ids = new Set(latest?.cards?.map(c => c.clientId).filter((id): id is string => Boolean(id)));
  return ids.size === 1 ? [...ids][0] : undefined;
}
