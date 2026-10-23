import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { instagramConnection, instagramGraph, InstagramError, graphId, type InstagramAccount } from './instagram-graph';
import { resolveMessageIdentity } from './instagram-message-identity';
import { acquireSocialSync, finishSocialSync, recordSocialActivity, type SocialInboxEvent } from './social-inbox-activity';
import { instagramInboundEvents } from './instagram-webhook';

export const verifiedInstagramDate = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
export const ownInstagramActor = (account: InstagramAccount, actor: any) => String(actor?.id || '') === account.accountId || (typeof actor?.username === 'string' && actor.username.toLowerCase() === account.username.toLowerCase());
export async function persistInstagramThreads(account: InstagramAccount, rows: Array<Record<string, any>>, activity: SocialInboxEvent[] = []) {
  const saved: any[] = [];
  for (let offset=0;offset<rows.length;offset+=50) {
    const result = await supabaseAdmin().rpc('tc_instagram_upsert_threads', { p_account: account.accountId, p_rows: rows.slice(offset,offset+50) });
    if (result.error || !Array.isArray(result.data)) throw new Error('INSTAGRAM_STORE_UNAVAILABLE');
    saved.push(...result.data);
  }
  await recordSocialActivity('instagram', account.accountId, activity);
  return saved;
}
const cursorToken = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_=+/-]{1,2048}$/.test(value) ? value : null;
const next = (result: any) => result?.paging?.next ? cursorToken(result?.paging?.cursors?.after) : null;
const dataArray = (result: any): any[] => {
  if (!Array.isArray(result?.data)) throw new InstagramError('META_INVALID_RESPONSE', 'Instagram no devolvió una lista válida. Se conservan los elementos recibidos.');
  return result.data;
};
type SyncCursor = { media?: string | null; conversations?: string | null; pendingPosts?: Array<{id: string; permalink?: string; after?: string | null; count?: number}>; commentError?: string | null; messageError?: string | null; pendingConversations?: Array<Record<string,any>>; conversationVersions?: Record<string,string> };
async function syncComments(account: InstagramAccount, cursor: SyncCursor, deadline: number) {
  const newest = await instagramGraph(account, `${account.accountId}/media`, {fields:'id,permalink,comments_count',limit:'4'}, undefined, deadline);
  const pending = [...(cursor.pendingPosts || [])];
  if (pending.length < 4) {
    const older = cursorToken(cursor.media) ? await instagramGraph(account, `${account.accountId}/media`, {fields:'id,permalink,comments_count',limit:'4',after:cursor.media!}, undefined, deadline) : newest;
    for (const post of dataArray(older)) if (graphId(post.id)) pending.push({id:post.id,permalink:post.permalink,count:post.comments_count});
    cursor.media = next(older);
  }
  const posts = [...dataArray(newest).filter(post=>graphId(post.id)).map(post=>({id:post.id,permalink:post.permalink,count:post.comments_count,after:null})), ...pending.splice(0,4)];
  const seen = new Set<string>();
  for (const post of posts) {
    const key = `${post.id}:${post.after || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (Date.now()>deadline-1500) { pending.push(post); continue; }
    try {
      const result = await instagramGraph(account, `${post.id}/comments`, {fields:'id,text,timestamp,from',limit:'50',...(cursorToken(post.after)?{after:post.after!}:{})}, undefined, deadline);
      const comments = dataArray(result), rows: Array<Record<string,any>> = [], activity: SocialInboxEvent[] = [];
      if (post.count && !comments.length && !post.after) cursor.commentError = 'COMMENTS_NOT_RETURNED';
      for (const comment of comments) {
        const when = verifiedInstagramDate(comment.timestamp);
        if (!graphId(comment.id) || !when || ownInstagramActor(account,comment.from)) continue;
        rows.push({kind:'comment',remote_id:comment.id,recipient_id:graphId(comment.from?.id)?comment.from.id:null,name:comment.from?.username || 'Comentario de Instagram',username:comment.from?.username || null,preview:String(comment.text||''),remote_created_at:when,remote_updated_at:when,permalink:post.permalink || null});
        activity.push({kind:'comment',remoteId:comment.id,threadRemoteId:comment.id,occurredAt:when});
      }
      await persistInstagramThreads(account,rows,activity);
      if (next(result)) pending.push({...post,after:next(result)});
    } catch (error) { pending.unshift(post); cursor.pendingPosts=pending; throw error; }
  }
  cursor.pendingPosts = pending;
}
async function syncMessages(account: InstagramAccount, cursor: SyncCursor, deadline: number) {
  const params={platform:'instagram',fields:'id,updated_time,participants',limit:'25'};
  const newest=await instagramGraph(account, account.accountId+'/conversations',params,undefined,deadline);
  const pages=[newest];
  if((cursor.pendingConversations?.length || 0)<3 && cursorToken(cursor.conversations)) {
    const older=await instagramGraph(account,account.accountId+'/conversations',{...params,after:cursor.conversations!},undefined,deadline);
    pages.push(older);cursor.conversations=next(older);
  } else if(!cursor.conversations)cursor.conversations=next(newest);
  const versions=cursor.conversationVersions || {},rows:Array<Record<string,any>>=[];
  for(const page of pages)for(const conversation of dataArray(page)) {
    const when=verifiedInstagramDate(conversation.updated_time);
    if(!graphId(conversation.id)||!when||versions[conversation.id]===when)continue;
    const people=conversation.participants?.data || [],identity=resolveMessageIdentity(account,people,[]);
    const person=people.find((p:any)=>p.id===identity.recipientId);
    rows.push({kind:'message',remote_id:conversation.id,conversation_id:conversation.id,recipient_id:identity.recipientId,name:person?.username || 'Conversación de Instagram',username:person?.username || null,remote_updated_at:when});
    versions[conversation.id]=when;
  }
  await persistInstagramThreads(account,rows);
  const queued=new Map<string,Record<string,any>>();
  for(const row of [...rows,...(cursor.pendingConversations || [])])if(!queued.has(row.conversation_id))queued.set(row.conversation_id,row);
  const queue=Array.from(queued.values());
  cursor.pendingConversations=queue;
  cursor.conversationVersions=Object.fromEntries(Object.entries(versions).sort((a,b)=>b[1].localeCompare(a[1])).slice(0,500));
  // Verify actual inbound IDs. Conversation update timestamps alone are not messages.
  for (const row of queue.slice(0,3)) {
    if (Date.now()>deadline-5000) break;
    const list=await instagramGraph(account,row.conversation_id,{fields:'messages'},undefined,deadline);
    if(!Array.isArray(list.messages?.data)) throw new InstagramError('META_INVALID_RESPONSE','Instagram no devolvió los mensajes.');
    const details=await Promise.all(list.messages.data.slice(0,20).filter((item:any)=>graphId(item.id)).map(async(item:any)=> {
      try {return await instagramGraph(account,item.id,{fields:'id,created_time,from,to,message'},undefined,deadline);}
      catch(error) {if(error instanceof InstagramError&&['META_OBJECT_UNAVAILABLE','META_MESSAGE_UNAVAILABLE'].includes(error.code))return null;throw error;}
    }));
    const available=details.filter(Boolean),identity=resolveMessageIdentity(account,[],available);
    if(!identity.recipientId){queue.shift();cursor.pendingConversations=queue;continue;}
    await recordSocialActivity('instagram',account.accountId,available.filter(message=>message.from?.id===identity.recipientId && verifiedInstagramDate(message.created_time)).map(message=>({kind:'message',remoteId:message.id,threadRemoteId:identity.recipientId!,occurredAt:verifiedInstagramDate(message.created_time)!})));
    queue.shift();cursor.pendingConversations=queue;
  }
}
export async function ensureInstagramFresh(account?: InstagramAccount) {
  const connected = account || await instagramConnection();
  const lease=await acquireSocialSync('instagram',connected.accountId,{cooldownSeconds:60});
  if (!lease) return null;
  const cursor: SyncCursor=lease.cursor, deadline=Date.now()+35000;
  let firstError: string | null=null;
  try {
    for (const [kind,run] of [['comment',syncComments],['message',syncMessages]] as const) {
      cursor[`${kind}Error`]=null;
      try { await run(connected,cursor,deadline); }
      catch(error) { const code=error instanceof InstagramError?error.code:'SERVICE_UNAVAILABLE';cursor[`${kind}Error`]=code;firstError ||= code; }
    }
  } finally { await finishSocialSync('instagram',connected.accountId,lease.token,cursor,firstError); }
  return cursor;
}
export async function processInstagramWebhook(body: unknown, account: InstagramAccount) {
  const events=instagramInboundEvents(body,account.accountId,account.username);
  const rows=events.map(event=>({kind:event.kind,remote_id:event.kind==='message'?`peer:${event.threadRemoteId}`:event.remoteId,
    recipient_id:event.senderId || null,name:event.senderName,username:event.username,preview:event.text,
    remote_created_at:event.kind==='comment'?event.occurredAt:null,remote_updated_at:event.occurredAt}));
  await persistInstagramThreads(account,rows,events);
  return {received:events.length};
}
