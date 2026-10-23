export type SocialProvider = 'instagram' | 'facebook';

export const SOCIAL_ATTENTION_REFRESH = 'tc-social-attention-changed';
export const SOCIAL_INBOX_INVALIDATE = 'tc-social-inbox-invalidated';

export type SocialProviderAttention = {
  count: number;
  messages: number;
  comments: number;
  revision: string;
  accountId: string | null;
  configured: boolean | null;
  error: string;
};

export const emptySocialAttention = (): SocialProviderAttention => ({
  count: 0, messages: 0, comments: 0, revision: '', accountId: null, configured: null, error: '',
});

export function parseSocialAttention(value: unknown, previous = emptySocialAttention()): SocialProviderAttention {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  if (!row) throw new Error('No se pudo comprobar el contador de redes sociales.');
  const accountId = typeof row.account_id === 'string' && row.account_id ? row.account_id : null;
  if (row.configured === false) return { ...emptySocialAttention(), configured: false };
  const sameAccount = !accountId || !previous.accountId || accountId === previous.accountId;
  if (row.error || row.ok === false || row.available === false) {
    return { ...(sameAccount ? previous : emptySocialAttention()), accountId,
      configured: row.configured === true ? true : previous.configured,
      error: 'El recuento está pendiente de actualizar. Revisa la conexión de esta cuenta.' };
  }
  for (const key of ['count', 'messages', 'comments']) {
    if (!Number.isSafeInteger(row[key]) || Number(row[key]) < 0) throw new Error('El contador de redes sociales no es válido.');
  }
  if (Number(row.count) !== Number(row.messages) + Number(row.comments)) throw new Error('El contador de redes sociales está incompleto.');
  if (typeof row.revision !== 'string' && typeof row.revision !== 'number') throw new Error('Falta la revisión de la bandeja.');
  return { count: Number(row.count), messages: Number(row.messages), comments: Number(row.comments),
    revision: String(row.revision), accountId, configured: row.configured === true ? true : null, error: '' };
}
