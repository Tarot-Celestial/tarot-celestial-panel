import 'server-only';
import { facebookConnection, facebookGraph, FacebookError, verifyFacebookAccount, type FacebookAccount } from './facebook-graph';

const required = ['pages_read_engagement', 'pages_read_user_content', 'pages_manage_engagement', 'pages_messaging', 'pages_manage_metadata'];
async function probe(account: FacebookAccount, label: string, path: string, params: Record<string, string>) {
  try { const data = await facebookGraph(account, path, params); return { label, ok: true, count: Array.isArray(data.data) ? data.data.length : null }; }
  catch (error) { return { label, ok: false, code: error instanceof FacebookError ? error.code : 'SERVICE_UNAVAILABLE' }; }
}
async function subscriptions(account: FacebookAccount) {
  const result = await facebookGraph(account, `${account.accountId}/subscribed_apps`, { fields: 'id,name,subscribed_fields' });
  if (!Array.isArray(result.data)) throw new FacebookError('META_INVALID_RESPONSE', 'Facebook no devolvió las suscripciones de la página.');
  return result.data.map((row: any) => ({ id: String(row.id || ''), name: String(row.name || ''), fields: Array.isArray(row.subscribed_fields) ? row.subscribed_fields.filter((f: unknown) => typeof f === 'string') as string[] : [] }));
}
async function tokenScopes(account: FacebookAccount) {
  const appId = String(process.env.META_APP_ID || '').trim(), secret = String(process.env.META_APP_SECRET || '').trim();
  if (!/^\d+$/.test(appId) || !secret) return { verified: false, scopes: [] as string[], missing: [] as string[], appId: null as string | null };
  // Server-only token introspection. Neither query URLs nor response bodies are logged.
  const data = await facebookGraph({ ...account, token: `${appId}|${secret}` }, 'debug_token', { input_token: account.token });
  const scopes = Array.isArray(data.data?.scopes) ? data.data.scopes.filter((scope: unknown) => typeof scope === 'string') as string[] : [];
  return { verified: data.data?.is_valid === true, scopes, missing: required.filter(scope => !scopes.includes(scope)), appId: String(data.data?.app_id || appId) };
}

export async function facebookDiagnostics() {
  const configured = !!String(process.env.FACEBOOK_PAGE_ID || '').trim() && !!String(process.env.META_ACCESS_TOKEN || '').trim();
  if (!configured) return { ok: true, configured: false, credentialSource: 'META_ACCESS_TOKEN', pageConfigured: !!process.env.FACEBOOK_PAGE_ID, requiredPermissions: required };
  const account = facebookConnection();
  let identity: { ok: boolean; name?: string; code?: string };
  try { identity = { ok: true, name: await verifyFacebookAccount(account) }; }
  catch (error) { identity = { ok: false, code: error instanceof FacebookError ? error.code : 'SERVICE_UNAVAILABLE' }; }
  if (!identity.ok) return { ok: true, configured, accountId: account.accountId, credentialSource: 'META_ACCESS_TOKEN', identity, requiredPermissions: required };
  const [scopeResult, subscriptionResult, readResults] = await Promise.all([
    tokenScopes(account).catch(error => ({ verified: false, scopes: [], missing: [], code: error instanceof FacebookError ? error.code : 'SERVICE_UNAVAILABLE' })),
    subscriptions(account).then(items => ({ ok: true, items })).catch(error => ({ ok: false, code: error instanceof FacebookError ? error.code : 'SERVICE_UNAVAILABLE' })),
    Promise.all([probe(account, 'posts', `${account.accountId}/posts`, { fields: 'id', limit: '1' }), probe(account, 'messenger', `${account.accountId}/conversations`, { platform: 'messenger', fields: 'id', limit: '1' })]),
  ]);
  return { ok: true, configured, accountId: account.accountId, credentialSource: 'META_ACCESS_TOKEN', identity, permissions: scopeResult,
    subscriptions: subscriptionResult, probes: readResults, requiredPermissions: required };
}

// An administrator explicitly invokes this after reviewing permission changes.
// Preserve existing fields (including leadgen) rather than replacing them.
export async function facebookSubscribe(input: any) {
  if (input?.confirmed !== true) throw new FacebookError('CONFIRMATION_REQUIRED', 'Confirma la conexión de mensajes y comentarios de Facebook.', 400);
  const account = facebookConnection();
  await verifyFacebookAccount(account);
  const token = await tokenScopes(account);
  if (!token.verified || !token.appId) throw new FacebookError('APP_ID_UNVERIFIED', 'Configura META_APP_ID y verifica la aplicación antes de modificar sus suscripciones.', 409);
  const current = (await subscriptions(account)).find((app: { id: string }) => app.id === token.appId);
  const fields = [...new Set([...(current?.fields || []), 'leadgen', 'feed', 'messages'])];
  const result = await facebookGraph(account, `${account.accountId}/subscribed_apps`, {}, { subscribed_fields: fields });
  if (result.success !== true) throw new FacebookError('SUBSCRIPTION_UNCERTAIN', 'Facebook no confirmó la suscripción. Comprueba la configuración antes de repetirla.');
  const verified = (await subscriptions(account)).find((app: { id: string }) => app.id === token.appId);
  if (!verified || !fields.every(field => verified.fields.includes(field))) throw new FacebookError('SUBSCRIPTION_UNCERTAIN', 'No se pudieron verificar todos los eventos suscritos. Revisa la aplicación de Meta.');
  return { ok: true, subscribedFields: verified.fields };
}
