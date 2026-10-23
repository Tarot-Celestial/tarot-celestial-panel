import 'server-only';
import { instagramConnection, instagramGraph, InstagramError, type InstagramAccount } from './instagram-graph';

export async function instagramSubscriptionStatus(account?: InstagramAccount) {
  const connected=account || await instagramConnection();
  const result=await instagramGraph(connected,`${connected.accountId}/subscribed_apps`);
  if(!Array.isArray(result.data))throw new InstagramError('META_INVALID_RESPONSE','Instagram no devolvió las suscripciones de la cuenta.');
  const appIds=[process.env.INSTAGRAM_APP_ID?.trim(),process.env.META_APP_ID?.trim()].filter(Boolean);
  const own=result.data.find((app:any)=>appIds.includes(String(app.id)));
  const fields=Array.isArray(own?.subscribed_fields)?own.subscribed_fields.filter((value:unknown)=>typeof value==='string'&&/^[a-z_]+$/.test(value)):[];
  return {subscribed:!!own,fields,ready:fields.includes('comments')&&fields.includes('messages')};
}
export async function subscribeInstagram(account?: InstagramAccount) {
  const connected=account || await instagramConnection();
  // Union with this app's fields; never disable existing subscriptions.
  const current=await instagramSubscriptionStatus(connected);
  const fields=[...new Set([...current.fields,'comments','messages'])];
  const result=await instagramGraph(connected,`${connected.accountId}/subscribed_apps`,{}, {subscribed_fields:fields.join(',')});
  if(result.success!==true)throw new InstagramError('SUBSCRIPTION_UNCONFIRMED','La cuenta está conectada, pero Instagram no confirmó los avisos en directo.');
  const verified=await instagramSubscriptionStatus(connected);
  if(!verified.ready)throw new InstagramError('SUBSCRIPTION_UNCONFIRMED','Instagram aún no confirma las suscripciones de mensajes y comentarios.');
  return {ok:true,...verified};
}
