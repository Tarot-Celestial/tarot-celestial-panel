export type AtlasCard = { id: string; kind: string; title: string; description: string; href?: string; prompt?: string };
export type AtlasProposal = {
  id: string; kind: string; title: string; description: string;
  details: { label: string; value: string }[]; requiresPassword?: boolean;
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled';
};
export type AtlasMessage = { id: string; role: 'user' | 'assistant'; text: string; cards: AtlasCard[]; proposal?: AtlasProposal; created_at?: string; sensitiveFollowup?: boolean };
export type AtlasAnswer = Omit<AtlasMessage, 'id' | 'role'>;
export const atlasUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const atlasNormalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
// A password belongs only in the secure action form, never in chat/model/history.
export function atlasRedactSecrets(text: string) {
  return text.replace(/((?:contrase[nñ]a|password|clave)\s*(?:nueva|es|ser[aá]|[:=])?\s*[:=]\s*)\S+/gi, '$1[oculta]');
}
