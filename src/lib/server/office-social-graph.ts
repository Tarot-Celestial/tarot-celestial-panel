import "server-only";
import { instagramConnection, instagramGraph, InstagramError } from "./instagram-graph";
import { instagramOfficeHistory, instagramSend } from "./instagram-inbox";
import { verifyOfficeInstagramIdentity } from "./office-instagram-graph";
import { facebookConnection, facebookGraph, FacebookError } from "./facebook-graph";
import { facebookOfficeHistory, facebookSend } from "./facebook-inbox";
import { facebookReplyPermissions } from "./facebook-diagnostics";
import { ensureInstagramFresh } from "./instagram-sync";
import { ensureFacebookFresh } from "./facebook-inbox";
import { DispatchDecision, openWindow, verifyHistory, type CaptureJob, type SocialProof } from "./office-social-policy";

type IG = Awaited<ReturnType<typeof instagramOfficeHistory>>;
type FB = Awaited<ReturnType<typeof facebookOfficeHistory>>;
type Context = IG | FB;
function source(job: CaptureJob, { account, row, loaded }: Context) {
  if (row.id !== job.thread_id || account.accountId !== job.account_id || row.kind !== job.kind) throw new DispatchDecision("SOURCE_CHANGED");
  const peer = row.kind === "message" ? loaded.recipientId : row.recipient_id;
  if (row.kind === "comment" && row.private_reply_sent) throw new DispatchDecision("ALREADY_ANSWERED");
  if (!peer || peer !== job.recipient_id || peer === account.accountId || (row.kind === "comment" && row.remote_id !== job.source_id)) {
    throw new DispatchDecision("RECIPIENT_UNVERIFIED");
  }
  const incoming = verifyHistory(job,loaded.messages,loaded.incompleteHistory,row.last_reply_at);
  return { peer, incoming };
}
async function igScope(account: IG["account"], messageAccess: boolean) {
  const identity = await verifyOfficeInstagramIdentity(account);
  const id = identity.ids[0];
  let rows: { permission: string; status: string }[] | null = null;
  try {
    const result = await instagramGraph(account,id + "/permissions");
    if (!Array.isArray(result.data)) throw new DispatchDecision("SCOPE_UNVERIFIED","blocked");
    rows = result.data;
  } catch (error) {
    if (!(error instanceof InstagramError) || !["META_OBJECT_UNAVAILABLE","META_REJECTED","META_PERMISSION"].includes(error.code)) throw error;
  }
  const granted = new Set(rows?.filter(p => p.status === "granted").map(p => p.permission));
  if (rows) return { comments:granted.has("instagram_business_manage_comments"), messages:granted.has("instagram_business_manage_messages") };
  // Instagram Login can omit the permissions edge. Reading the exact conversation or comment already required
  // its management permission. For a comment, verify access to messaging separately before preferring private.
  if (messageAccess) return { comments:false, messages:true };
  try {
    const result = await instagramGraph(account,id + "/conversations",{platform:"instagram",fields:"id",limit:"1"});
    return { comments:true, messages:Array.isArray(result.data) };
  } catch (error) {
    if (error instanceof InstagramError && ["META_PERMISSION","META_OBJECT_UNAVAILABLE","META_REJECTED"].includes(error.code)) return {comments:true,messages:false};
    throw error;
  }
}
async function verified(job: CaptureJob, context: Context): Promise<SocialProof> {
  const { peer, incoming } = source(job,context);
  const dm = job.kind === "message";
  if (!openWindow(incoming.createdAt,dm ? 24 : 168)) throw new DispatchDecision("WINDOW_CLOSED");
  let privateAllowed = false, publicAllowed = false;
  if (job.channel === "instagram") {
    const grants = await igScope((context as IG).account,dm);
    privateAllowed = grants.messages && (dm || (grants.comments && !context.row.private_reply_sent));
    publicAllowed = !dm && grants.comments;
  } else {
    const fb = context as FB, scopes = await facebookReplyPermissions(fb.account);
    privateAllowed = scopes.includes("pages_messaging");
    publicAllowed = !dm && scopes.includes("pages_manage_engagement");
    if (!dm && privateAllowed && !context.row.private_reply_sent) {
      try {
        const flags = await facebookGraph(fb.account,fb.row.remote_id,{fields:"id,can_reply_privately"});
        privateAllowed = flags.can_reply_privately === true;
      } catch (error) {
        if (!(error instanceof FacebookError) || !["META_PERMISSION","META_REJECTED"].includes(error.code)) throw error;
        privateAllowed = false;
      }
    } else if (!dm) privateAllowed = false;
  }
  if (!privateAllowed && !publicAllowed) throw new DispatchDecision("MISSING_REPLY_PERMISSION","blocked");
  return { accountId:job.account_id, peerId:peer, sourceId:job.source_id, sourceAt:incoming.createdAt,
    text:incoming.text, privateAllowed, publicAllowed, lastReplyAt:context.row.last_reply_at };
}
export async function readSocialProof(job: CaptureJob) {
  if (!job.thread_id || !["instagram","facebook"].includes(job.channel)) throw new DispatchDecision("INVALID_SOCIAL_SOURCE");
  const context = job.channel === "instagram" ? await instagramOfficeHistory(job.thread_id,job.account_id) : await facebookOfficeHistory(job.thread_id,job.account_id);
  return verified(job,context);
}
export async function sendSocialReply(job: CaptureJob, proof: SocialProof, body: string, mode: "public" | "private", beforeSend: () => Promise<void>) {
  if (!job.actor_user_id) throw new DispatchDecision("DELEGATION_REQUIRED","blocked");
  const recheck = async (context: Context) => {
    const fresh = await verified(job,context);
    if (fresh.text !== proof.text || fresh.peerId !== proof.peerId || fresh.accountId !== proof.accountId ||
        fresh.lastReplyAt !== proof.lastReplyAt || !(mode === "private" ? fresh.privateAllowed : fresh.publicAllowed)) throw new DispatchDecision("SOURCE_CHANGED");
    await beforeSend();
  };
  const command = { threadId:job.thread_id, requestId:job.request_id, text:body, replyMode:mode, expectedLastReplyAt:proof.lastReplyAt };
  const result = job.channel === "instagram" ? await instagramSend(job.actor_user_id,command,(account,row,loaded) => recheck({account,row,loaded})) :
    await facebookSend(job.actor_user_id,command,(account,row,loaded) => recheck({account,row,loaded}));
  if (!result.messageId) throw new DispatchDecision("RECEIPT_MISSING","uncertain");
  return String(result.messageId);
}

export async function syncOfficeSocialInboxes(allow:(channel:string,account:string)=>Promise<boolean>) {
  const checks = await Promise.allSettled([
    (async()=>{ const account=await instagramConnection();
      return await allow("instagram",account.accountId) ? ensureInstagramFresh(account) : "paused" as const; })(),
    (async()=>{ const account=facebookConnection();
      return await allow("facebook",account.accountId) ? ensureFacebookFresh(account) : "paused" as const; })(),
  ]);
  return checks.map((check,index) => {
    if (check.status === "rejected") return { channel:index ? "facebook" : "instagram",state:"blocked" };
    const cursor = check.value;
    return { channel:index ? "facebook" : "instagram",state:cursor === "paused" ? "paused" : cursor == null ? "cooldown" : cursor.messageError || cursor.commentError ? "partial" : "checked" };
  });
}
